/* Deterministic fake scheduling around the production Transfer implementation.
 * Storage is a fake async owner using the same production completion barrier. */
#include <assert.h>
#include <stdio.h>
#include <string.h>
#include "../../components/sailball_transfer/src/transfer.c"

static struct fake_task control_handle, transfer_handle;
static TaskHandle_t current;
static transfer_request_t queued;
static int queued_valid, stage, mode, owner_waiting, completions, injected_wait_failure;
static uint32_t storage_epoch=1;
static uint32_t session_generation=1;
static unsigned storage_reads;
static uint64_t *storage_size;
static bool *storage_active;

TaskHandle_t xTaskGetCurrentTaskHandle(void) { return current; }
int xTaskNotifyIndexed(TaskHandle_t task,unsigned index,uint32_t value,int action)
{ (void)action;assert(index<2);assert(!task->pending[index]);task->value[index]=value;task->pending[index]=1;return pdTRUE; }
int xTaskNotifyGiveIndexed(TaskHandle_t task,unsigned index)
{ assert(index==SB_CONTROL_WAKE_INDEX);task->value[index]++;task->pending[index]=1;return pdTRUE; }
uint32_t ulTaskNotifyTakeIndexed(unsigned index,int clear,TickType_t ticks)
{ (void)clear;(void)ticks;uint32_t n=current->value[index];current->pending[index]=0;current->value[index]=0;return n; }
static void inject_control(void)
{ if(mode==5||mode==6)(void)sb_transfer_shutdown();else {if(++session_generation==0u)++session_generation;sb_transfer_set_session_generation(SB_SOURCE_USB,session_generation);} }
int xTaskNotifyWaitIndexed(unsigned index,uint32_t clear_in,uint32_t clear_out,uint32_t *value,TickType_t ticks)
{
    (void)clear_in;(void)clear_out;assert(index==SB_RPC_COMPLETION_INDEX);assert(ticks==portMAX_DELAY);
    if(current==&control_handle&&!current->pending[index]) {
        assert(queued_valid);current=&transfer_handle;queued_valid=0;process_request(&queued);current=&control_handle;
    } else if(current==&transfer_handle&&!current->pending[index]) {
        assert(owner_waiting&&storage_size&&storage_active);
        if(stage==0){stage=1;if(mode==1||mode==5)inject_control();injected_wait_failure++;return pdFALSE;}
        if(stage==1){stage=2;if(mode==2||mode==6)inject_control();
            /* Cancellation cannot release caller output storage before this write. */
            *storage_size=12345;*storage_active=true;sb_rpc_complete(current,SB_OK);completions++;
            if(mode==3)inject_control();
        }
    }
    assert(current->pending[index]);*value=current->value[index];current->pending[index]=0;current->value[index]=0;return pdTRUE;
}
QueueHandle_t xQueueCreateStatic(unsigned depth,unsigned size,uint8_t *data,StaticQueue_t *state)
{ (void)depth;(void)size;(void)data;return state; }
int xQueueSend(QueueHandle_t queue,const void *item,TickType_t ticks)
{ (void)queue;(void)ticks;assert(!queued_valid);queued=*(const transfer_request_t*)item;queued_valid=1;return pdTRUE; }
int xQueueReceive(QueueHandle_t queue,void *out,TickType_t ticks)
{ (void)queue;(void)ticks;if(!queued_valid)return pdFALSE;*(transfer_request_t*)out=queued;queued_valid=0;return pdTRUE; }
TaskHandle_t xTaskCreateStatic(void (*fn)(void*),const char *name,unsigned size,void *arg,unsigned priority,StackType_t *stack,StaticTask_t *state)
{ (void)fn;(void)name;(void)size;(void)arg;(void)priority;(void)stack;(void)state;return &transfer_handle; }
unsigned uxTaskGetStackHighWaterMark(TaskHandle_t task){(void)task;return 1024;}
void vTaskDelay(TickType_t ticks){(void)ticks;}
void sb_validation_note_stack(sb_validation_task_t task,uint32_t value){(void)task;(void)value;}
void sb_diag_increment(sb_diag_group_t group,unsigned counter){(void)group;(void)counter;}
void sb_diag_add(sb_diag_group_t group,unsigned counter,uint64_t amount){(void)group;(void)counter;(void)amount;}
sb_status_t sb_storage_transfer_open(const char *name,uint64_t *size,bool *active)
{ (void)name;owner_waiting=1;storage_size=size;storage_active=active;sb_status_t r=(sb_status_t)sb_rpc_wait_completion();owner_waiting=0;storage_size=NULL;storage_active=NULL;return r; }
sb_status_t sb_storage_transfer_read(uint64_t offset,uint32_t length,uint8_t *out,size_t capacity,uint32_t *actual)
{(void)offset;(void)length;(void)out;(void)capacity;(void)actual;storage_reads++;return SB_IO_ERROR;}
sb_status_t sb_storage_transfer_close(void){return SB_OK;}
bool sb_storage_transfer_close_async(void){return true;}
uint32_t sb_storage_epoch_generation(void){return storage_epoch;}
bool sb_storage_claim_bulk_publication(uint32_t epoch,uint64_t *id){if(id)*id=1u;return epoch==storage_epoch;}
bool sb_storage_finish_bulk_publication(uint32_t epoch,uint64_t id){(void)id;return epoch==storage_epoch;}
void sb_storage_release_bulk_publication(uint32_t epoch,uint64_t id){(void)epoch;(void)id;}

static void reset_fixture(void)
{
    memset(&control_handle,0,sizeof(control_handle));memset(&transfer_handle,0,sizeof(transfer_handle));
    s_command_queue=NULL;s_active=s_open_pending=s_read_pending=s_shutting_down=false;
    storage_epoch=1;storage_reads=0;session_generation=1;
    s_active_snapshot=false;s_reset_mask=0;memset(s_session_generation,0,sizeof(s_session_generation));queued_valid=stage=owner_waiting=completions=injected_wait_failure=0;
    current=&control_handle;assert(sb_transfer_start()==ESP_OK);sb_transfer_set_session_generation(SB_SOURCE_USB,session_generation);
}
int main(void)
{
    const char *names[]={"reset before RPC","reset while pending","reset before completion","completion then reset",
                         "back-to-back RPC","shutdown while pending","late completion after shutdown intent"};
    for(mode=0;mode<7;++mode){
        reset_fixture();uint64_t token=sb_transfer_session_token(SB_SOURCE_USB,session_generation);if(mode==0)inject_control();
        uint32_t id=0;uint64_t size=0;bool active=false;
        sb_status_t open_status=sb_transfer_open("test.ldc",token,&id,&size,&active);
        if(mode==4){assert(open_status==SB_OK);assert(id&&size==12345&&active&&completions==1&&injected_wait_failure==1);}
        else {assert(open_status==SB_INVALID_STATE);assert(id==0&&size==0&&!active);if(mode==0)assert(completions==0);else assert(completions==1);}
        assert(!control_handle.pending[1]&&!transfer_handle.pending[1]&&!owner_waiting);
        current=&transfer_handle;(void)ulTaskNotifyTakeIndexed(SB_CONTROL_WAKE_INDEX,pdTRUE,0);process_reset_requests();current=&control_handle;
        if(mode==4){assert(sb_transfer_close(token,id,false)==SB_OK);stage=0;
            token=sb_transfer_session_token(SB_SOURCE_USB,session_generation);
            assert(sb_transfer_open("test.ldc",token,&id,&size,&active)==SB_OK);assert(completions==2);}
        assert(!control_handle.pending[1]&&!transfer_handle.pending[1]);
        puts(names[mode]);
    }
    reset_fixture();mode=4;
    uint32_t id=0;uint64_t size=0;bool active=false;
    uint64_t token=sb_transfer_session_token(SB_SOURCE_USB,session_generation);
    assert(sb_transfer_open("epoch.ldc",token,&id,&size,&active)==SB_OK);
    assert(sb_transfer_is_active());
    ++storage_epoch;observe_storage_epoch();
    assert(!sb_transfer_is_active()&&!s_active&&s_id==0);
    uint8_t output[8];size_t actual=0;
    assert(sb_transfer_read(token,id,0,4,output,sizeof(output),&actual)==SB_NOT_FOUND);
    assert(storage_reads==0);
    puts("storage epoch abort invalidates active Transfer snapshot without stale read");
    puts("PASS 7 production Transfer/RPC fake schedules; cancellation deferred until completion");return 0;
}
