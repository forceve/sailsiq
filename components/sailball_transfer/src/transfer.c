#include "sailball/transfer.h"
#include "sailball/storage.h"
#include "sailball/diagnostics.h"
#include "sailball/validation.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "sailball/rpc_completion.h"
#include "freertos/portmacro.h"
#include <string.h>

#define TRANSFER_STACK_WORDS 2048u
#define TRANSFER_COMMAND_DEPTH 4u

typedef enum { TRANSFER_OPEN=1, TRANSFER_READ, TRANSFER_CLOSE } transfer_op_t;
typedef struct {
    transfer_op_t op;
    TaskHandle_t waiter;
    uint64_t session_token;
    uint32_t id;
    char file_name[64];
    uint64_t offset;
    uint32_t length;
    uint8_t *out;
    size_t capacity;
    size_t *actual_out;
    uint32_t *id_out;
    uint64_t *size_out;
    bool *active_out;
} transfer_request_t;

static StaticTask_t s_task_struct;
static StackType_t s_stack[TRANSFER_STACK_WORDS];
static StaticQueue_t s_command_queue_struct;
static uint8_t s_command_queue_storage[TRANSFER_COMMAND_DEPTH * sizeof(transfer_request_t)];
static QueueHandle_t s_command_queue;
static TaskHandle_t s_task_handle;
static portMUX_TYPE s_mux = portMUX_INITIALIZER_UNLOCKED;

/* Transfer state is changed by transfer_task; this snapshot only supports admission checks. */
static bool s_active, s_open_pending, s_read_pending, s_shutting_down;
static uint32_t s_id, s_next_id=1;
static uint64_t s_session_token;
static uint64_t s_readable_size;
static uint32_t s_reset_mask;
static uint32_t s_session_generation[SB_SOURCE_COUNT];
static uint32_t s_storage_epoch_seen;

static bool s_active_snapshot;
static uint32_t s_id_snapshot;
static uint64_t s_session_snapshot;
static uint64_t s_size_snapshot;
static uint32_t s_storage_epoch_snapshot;
static void publish_snapshot(void);

uint64_t sb_transfer_session_token(sb_source_t source,uint32_t generation)
{
    return ((uint64_t)generation<<8u)|(uint8_t)source;
}

static bool token_current(uint64_t token)
{
    sb_source_t source=(sb_source_t)(token&UINT64_C(0xFF));
    uint32_t generation=(uint32_t)(token>>8u);
    if((unsigned)source>=SB_SOURCE_COUNT)return false;
    portENTER_CRITICAL(&s_mux);bool current=s_session_generation[source]==generation;portEXIT_CRITICAL(&s_mux);
    return current;
}

static bool token_current_locked(uint64_t token)
{
    sb_source_t source=(sb_source_t)(token&UINT64_C(0xFF));
    uint32_t generation=(uint32_t)(token>>8u);
    return (unsigned)source<SB_SOURCE_COUNT&&s_session_generation[source]==generation;
}

void sb_transfer_set_session_generation(sb_source_t source,uint32_t generation)
{
    if((unsigned)source>=SB_SOURCE_COUNT)return;
    portENTER_CRITICAL(&s_mux);s_session_generation[source]=generation;s_reset_mask|=UINT32_C(1)<<(unsigned)source;portEXIT_CRITICAL(&s_mux);
    if(s_task_handle!=NULL)(void)xTaskNotifyGiveIndexed(s_task_handle,SB_CONTROL_WAKE_INDEX);
}

static void observe_storage_epoch(void)
{
    uint32_t current = sb_storage_epoch_generation();
    if (current == s_storage_epoch_seen) return;
    s_storage_epoch_seen = current;
    /* Storage already closed its descriptor and invalidated the frozen snapshot. */
    if (s_active) {
        s_active = false; s_id = 0; s_session_token = 0; s_readable_size = 0;
        sb_diag_increment(SB_DIAG_TRANSFER, 4);
        publish_snapshot();
    }
}

static void publish_snapshot(void)
{
    portENTER_CRITICAL(&s_mux);
    s_active_snapshot=s_active; s_id_snapshot=s_id; s_session_snapshot=s_session_token;
    s_size_snapshot=s_readable_size; s_storage_epoch_snapshot=s_storage_epoch_seen;
    portEXIT_CRITICAL(&s_mux);
}

static void notify_waiter(TaskHandle_t waiter, sb_status_t status)
{
    sb_rpc_complete(waiter, (uint32_t)status);
}

static bool close_storage_after_failure(void)
{
    sb_status_t result=sb_storage_transfer_close();
    if (result==SB_OK) return true;
    if (result==SB_BUSY) return false;
    return sb_storage_transfer_close_async();
}

static void release_owner_state(void)
{
    s_active=false; s_id=0; s_session_token=0; s_readable_size=0;
    publish_snapshot();
}

static bool close_active(bool retry_busy)
{
    sb_status_t result=sb_storage_transfer_close();
    if (result==SB_BUSY && retry_busy) return false;
    if (result!=SB_OK && !sb_storage_transfer_close_async()) return false;
    release_owner_state();
    return true;
}

static void process_reset_requests(void)
{
    uint32_t pending,generation[SB_SOURCE_COUNT];
    portENTER_CRITICAL(&s_mux); pending=s_reset_mask;memcpy(generation,s_session_generation,sizeof(generation));portEXIT_CRITICAL(&s_mux);
    for (uint32_t source=0;source<SB_SOURCE_COUNT;++source) {
        uint32_t bit=UINT32_C(1)<<source;
        if ((pending&bit)==0) continue;
        uint32_t active_source=(uint32_t)(s_session_token&UINT64_C(0xFF));
        uint32_t active_generation=(uint32_t)(s_session_token>>8u);
        bool matching=s_active&&active_source==source&&active_generation!=generation[source];
        bool closed=!matching||close_active(true);
        if (closed) {
            portENTER_CRITICAL(&s_mux); s_reset_mask&=~bit; portEXIT_CRITICAL(&s_mux);
        }
    }
}

static void process_request(transfer_request_t *request)
{
    if (request->op==TRANSFER_OPEN) {
        portENTER_CRITICAL(&s_mux); bool shutting_down=s_shutting_down; portEXIT_CRITICAL(&s_mux);
        sb_status_t result=SB_INVALID_STATE;
        uint64_t size=0; bool active=false;
        if (!shutting_down && !s_active && token_current(request->session_token)) {
            result=sb_storage_transfer_open(request->file_name,&size,&active);
            if (result==SB_OK) {
                portENTER_CRITICAL(&s_mux);shutting_down=s_shutting_down;portEXIT_CRITICAL(&s_mux);
                if(shutting_down||!token_current(request->session_token)){
                    (void)close_storage_after_failure();
                    result=SB_INVALID_STATE;
                    goto open_complete;
                }
                uint32_t id=s_next_id++;
                if (id==0) id=s_next_id++;
                if (id==0) {
                    (void)close_storage_after_failure();
                    result=SB_INTERNAL_ERROR;
                } else {
                    s_active=true; s_id=id; s_session_token=request->session_token;
                    s_readable_size=size; publish_snapshot();
                    if (request->id_out) *request->id_out=id;
                    if (request->size_out) *request->size_out=size;
                    if (request->active_out) *request->active_out=active;
                    sb_diag_increment(SB_DIAG_TRANSFER,0);
                }
            }
        }
open_complete:
        portENTER_CRITICAL(&s_mux); s_open_pending=false; portEXIT_CRITICAL(&s_mux);
        notify_waiter(request->waiter,result);
        return;
    }
    if (request->op==TRANSFER_READ) {
        portENTER_CRITICAL(&s_mux); bool shutting_down=s_shutting_down; portEXIT_CRITICAL(&s_mux);
        if (shutting_down || !token_current(request->session_token) || !s_active || request->id!=s_id || request->session_token!=s_session_token) {
            portENTER_CRITICAL(&s_mux); s_read_pending=false; portEXIT_CRITICAL(&s_mux);
            notify_waiter(request->waiter,shutting_down?SB_INVALID_STATE:SB_NOT_FOUND); return;
        }
        if (request->length==0 || request->offset>=s_readable_size || request->length>request->capacity || request->out==NULL) {
            portENTER_CRITICAL(&s_mux); s_read_pending=false; portEXIT_CRITICAL(&s_mux);
            notify_waiter(request->waiter,SB_OUT_OF_RANGE); return;
        }
        sb_diag_increment(SB_DIAG_TRANSFER,1);
        uint32_t actual32=0;
        uint32_t read_epoch=s_storage_epoch_seen;
        sb_status_t result=sb_storage_transfer_read(request->offset,request->length,request->out,
                                                    request->capacity,&actual32);
        if(result==SB_OK&&read_epoch!=sb_storage_epoch_generation())result=SB_NOT_FOUND;
        if(!token_current(request->session_token))result=SB_INVALID_STATE;
        size_t actual=actual32;
        if (result==SB_OK) {
            uint64_t remaining=s_readable_size-request->offset;
            size_t expected=remaining<request->length?(size_t)remaining:request->length;
            if (actual!=expected) result=SB_IO_ERROR;
        }
        if (request->actual_out && result==SB_OK) *request->actual_out=actual;
        portENTER_CRITICAL(&s_mux); s_read_pending=false; portEXIT_CRITICAL(&s_mux);
        if (result==SB_OK) sb_diag_add(SB_DIAG_TRANSFER,2,actual);
        else sb_diag_increment(SB_DIAG_TRANSFER,4);
        notify_waiter(request->waiter,result);
        return;
    }
    if (request->op==TRANSFER_CLOSE) {
        if (!s_active) { notify_waiter(request->waiter,SB_OK); return; }
        if (!token_current(request->session_token) || request->id!=s_id || request->session_token!=s_session_token) {
            notify_waiter(request->waiter,SB_NOT_FOUND); return;
        }
        sb_status_t result=sb_storage_transfer_close();
        if (result==SB_OK) release_owner_state();
        notify_waiter(request->waiter,result);
    }
}

static void transfer_task(void *arg)
{
    (void)arg;
    for (;;) {
        sb_validation_note_stack(SB_VALIDATION_TASK_TRANSFER,
                                 (uint32_t)uxTaskGetStackHighWaterMark(NULL));
        observe_storage_epoch();
        (void)ulTaskNotifyTakeIndexed(SB_CONTROL_WAKE_INDEX,pdTRUE,0);
        process_reset_requests();
        portENTER_CRITICAL(&s_mux); bool shutting_down=s_shutting_down; portEXIT_CRITICAL(&s_mux);
        if (shutting_down) {
            if (s_active) (void)close_active(true);
            transfer_request_t pending;
            while (xQueueReceive(s_command_queue,&pending,0)==pdTRUE) {
                if (pending.op==TRANSFER_OPEN) { portENTER_CRITICAL(&s_mux); s_open_pending=false; portEXIT_CRITICAL(&s_mux); }
                if (pending.op==TRANSFER_READ) { portENTER_CRITICAL(&s_mux); s_read_pending=false; portEXIT_CRITICAL(&s_mux); }
                notify_waiter(pending.waiter,SB_INVALID_STATE);
            }
            vTaskDelay(pdMS_TO_TICKS(10));
            continue;
        }
        transfer_request_t request;
        if (xQueueReceive(s_command_queue,&request,pdMS_TO_TICKS(20))==pdTRUE) process_request(&request);
    }
}

esp_err_t sb_transfer_start(void)
{
    if (s_command_queue!=NULL) return ESP_OK;
    s_storage_epoch_seen=sb_storage_epoch_generation();
    s_command_queue=xQueueCreateStatic(TRANSFER_COMMAND_DEPTH,sizeof(transfer_request_t),
                                       s_command_queue_storage,&s_command_queue_struct);
    if (s_command_queue==NULL) return ESP_ERR_NO_MEM;
    s_task_handle=xTaskCreateStatic(transfer_task,"transfer_task",TRANSFER_STACK_WORDS,NULL,3,s_stack,&s_task_struct);
    return s_task_handle?ESP_OK:ESP_ERR_NO_MEM;
}

static sb_status_t submit_sync(transfer_request_t *request)
{
    if (s_command_queue==NULL || request==NULL) return SB_INVALID_STATE;
    request->waiter=xTaskGetCurrentTaskHandle();
    if (xQueueSend(s_command_queue,request,0)!=pdTRUE) return SB_BUSY;
    uint32_t result=SB_INTERNAL_ERROR;
    result=sb_rpc_wait_completion();
    return (sb_status_t)result;
}

sb_status_t sb_transfer_open(const char *file_name,uint64_t session_token,uint32_t *id,uint64_t *size,bool *active)
{
    if(file_name==NULL||id==NULL||size==NULL||active==NULL)return SB_INVALID_REQUEST;
    if(s_command_queue==NULL||!token_current(session_token))return SB_INVALID_STATE;
    size_t n=strnlen(file_name,64);
    if(n==0||n>=64)return SB_OUT_OF_RANGE;
    portENTER_CRITICAL(&s_mux);
    if(s_shutting_down){portEXIT_CRITICAL(&s_mux);return SB_INVALID_STATE;}
    if(s_active_snapshot||s_open_pending||s_read_pending){portEXIT_CRITICAL(&s_mux);sb_diag_increment(SB_DIAG_TRANSFER,3);return SB_BUSY;}
    s_open_pending=true;
    portEXIT_CRITICAL(&s_mux);
    transfer_request_t request={.op=TRANSFER_OPEN,.session_token=session_token,.id_out=id,.size_out=size,.active_out=active};
    memcpy(request.file_name,file_name,n+1u);
    sb_status_t result=submit_sync(&request);
    if(result==SB_BUSY||result==SB_INVALID_STATE){portENTER_CRITICAL(&s_mux);s_open_pending=false;portEXIT_CRITICAL(&s_mux);}
    return result;
}

sb_status_t sb_transfer_read(uint64_t session_token,uint32_t id,uint64_t offset,uint32_t length,uint8_t *out,size_t capacity,size_t *actual)
{
    if(actual)*actual=0;
    if(s_command_queue==NULL)return SB_INVALID_STATE;
    portENTER_CRITICAL(&s_mux);
    if(s_shutting_down){portEXIT_CRITICAL(&s_mux);return SB_INVALID_STATE;}
    if(s_read_pending){portEXIT_CRITICAL(&s_mux);sb_diag_increment(SB_DIAG_TRANSFER,3);return SB_BUSY;}
    if(!token_current_locked(session_token)||!s_active_snapshot||id!=s_id_snapshot||session_token!=s_session_snapshot||
       s_storage_epoch_snapshot!=sb_storage_epoch_generation()){portEXIT_CRITICAL(&s_mux);return SB_NOT_FOUND;}
    if(length==0||offset>=s_size_snapshot||length>capacity||out==NULL){portEXIT_CRITICAL(&s_mux);return SB_OUT_OF_RANGE;}
    s_read_pending=true;
    portEXIT_CRITICAL(&s_mux);
    transfer_request_t request={.op=TRANSFER_READ,.session_token=session_token,.id=id,.offset=offset,
        .length=length,.out=out,.capacity=capacity,.actual_out=actual};
    sb_status_t result=submit_sync(&request);
    if(result==SB_BUSY){portENTER_CRITICAL(&s_mux);s_read_pending=false;portEXIT_CRITICAL(&s_mux);}
    return result;
}

sb_status_t sb_transfer_close(uint64_t session_token,uint32_t id,bool read_outstanding)
{
    if(s_command_queue==NULL)return SB_INVALID_STATE;
    portENTER_CRITICAL(&s_mux);
    if(read_outstanding||s_read_pending){portEXIT_CRITICAL(&s_mux);return SB_BUSY;}
    if(!s_active_snapshot){portEXIT_CRITICAL(&s_mux);return SB_OK;}
    if(!token_current_locked(session_token)||s_storage_epoch_snapshot!=sb_storage_epoch_generation()){portEXIT_CRITICAL(&s_mux);return SB_NOT_FOUND;}
    if(id!=s_id_snapshot||session_token!=s_session_snapshot){portEXIT_CRITICAL(&s_mux);return SB_NOT_FOUND;}
    if(s_shutting_down){portEXIT_CRITICAL(&s_mux);return SB_INVALID_STATE;}
    portEXIT_CRITICAL(&s_mux);
    transfer_request_t request={.op=TRANSFER_CLOSE,.session_token=session_token,.id=id};
    return submit_sync(&request);
}

bool sb_transfer_is_active(void)
{
    portENTER_CRITICAL(&s_mux);
    bool active=s_active_snapshot||s_open_pending||s_read_pending;
    portEXIT_CRITICAL(&s_mux);
    return active;
}

bool sb_transfer_shutdown(void)
{
    portENTER_CRITICAL(&s_mux);s_shutting_down=true;bool active=s_active_snapshot||s_open_pending||s_read_pending;portEXIT_CRITICAL(&s_mux);
    if(s_task_handle!=NULL)(void)xTaskNotifyGiveIndexed(s_task_handle,SB_CONTROL_WAKE_INDEX);
    return !active;
}
