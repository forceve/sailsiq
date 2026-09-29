#include <assert.h>
#include <setjmp.h>
#include <stdio.h>
#include <string.h>

#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "esp_random.h"
#include "esp_task_wdt.h"
#include "esp_system.h"
#include "sailball/board.h"
#include "sailball/diagnostics.h"
#include "sailball/gnss.h"
#include "sailball/ldc.h"
#include "sailball/recorder.h"
#include "sailball/storage.h"
#include "sailball/supervisor.h"
#include "sailball/transfer.h"
#include "sailball/ble.h"
#include "sailball/wifi.h"
#include "sailball/ui.h"
#include "sailball/validation.h"

#include "../../components/sailball_control/src/control.c"
uint32_t sb_storage_epoch_generation(void){return 1u;}
bool sb_storage_claim_bulk_publication(uint32_t epoch,uint64_t *id){if(id)*id=1u;return epoch==1u;}
bool sb_storage_finish_bulk_publication(uint32_t epoch,uint64_t id){(void)id;return epoch==1u;}
void sb_storage_release_bulk_publication(uint32_t epoch,uint64_t id){(void)epoch;(void)id;}

typedef struct {
    StaticQueue_t *identity;
    uint8_t *storage;
    unsigned depth, item_size, head, count;
} test_queue_t;

static test_queue_t s_queues[12];
static size_t s_queue_count;
static struct fake_task s_task;
static uint32_t s_transfer_generation[SB_SOURCE_COUNT];
static bool s_transfer_active;
static unsigned s_reset_count;
static void (*s_recorder_task)(void *);
static jmp_buf s_stop_recorder;
static bool s_recorder_running;
static uint64_t s_now_us=UINT64_C(1000000);
static sb_gnss_fix_t s_fixes[32];
static unsigned s_fix_head,s_fix_count,s_consumed,s_submitted,s_committed;
static sb_storage_ack_t s_storage_acks[8];
static unsigned s_ack_head,s_ack_count;

QueueHandle_t xQueueCreateStatic(unsigned depth, unsigned item_size, uint8_t *storage,
                                 StaticQueue_t *identity)
{
    assert(s_queue_count < sizeof(s_queues) / sizeof(s_queues[0]));
    test_queue_t *q = &s_queues[s_queue_count++];
    *q = (test_queue_t){identity, storage, depth, item_size, 0u, 0u};
    return identity;
}
static test_queue_t *queue_for(QueueHandle_t handle)
{
    for (size_t i = 0; i < s_queue_count; ++i)
        if (s_queues[i].identity == handle) return &s_queues[i];
    return NULL;
}
int xQueueSend(QueueHandle_t handle, const void *item, TickType_t ticks)
{
    (void)ticks; test_queue_t *q = queue_for(handle); assert(q && item);
    if (q->count == q->depth) return pdFALSE;
    unsigned tail = (q->head + q->count) % q->depth;
    memcpy(q->storage + (size_t)tail * q->item_size, item, q->item_size); ++q->count; return pdTRUE;
}
int xQueueReceive(QueueHandle_t handle, void *out, TickType_t ticks)
{
    (void)ticks; test_queue_t *q = queue_for(handle); assert(q && out);
    if (!q->count) return pdFALSE;
    memcpy(out, q->storage + (size_t)q->head * q->item_size, q->item_size);
    q->head = (q->head + 1u) % q->depth; --q->count; return pdTRUE;
}
int xQueuePeek(QueueHandle_t handle, void *out, TickType_t ticks)
{
    (void)ticks; test_queue_t *q = queue_for(handle); assert(q && out);
    if (!q->count) return pdFALSE;
    memcpy(out, q->storage + (size_t)q->head * q->item_size, q->item_size); return pdTRUE;
}
int xQueueReset(QueueHandle_t handle)
{ test_queue_t *q = queue_for(handle); assert(q); q->head = q->count = 0u; return pdTRUE; }
int xQueueOverwrite(QueueHandle_t handle, const void *item)
{
    test_queue_t *q = queue_for(handle); assert(q && item && q->depth == 1u);
    if (q->count) memcpy(q->storage + (size_t)q->head * q->item_size, item, q->item_size);
    else { memcpy(q->storage, item, q->item_size); q->count = 1u; }
    return pdTRUE;
}
unsigned uxQueueMessagesWaiting(QueueHandle_t handle)
{ test_queue_t *q = queue_for(handle); assert(q); return q->count; }
TaskHandle_t xTaskGetCurrentTaskHandle(void) { return &s_task; }
TaskHandle_t xTaskCreateStatic(void (*entry)(void *), const char *name, unsigned stack,
                               void *arg, unsigned priority, StackType_t *storage, StaticTask_t *state)
{ (void)stack; (void)arg; (void)priority; (void)storage; (void)state;
  if(strcmp(name,"recorder_task")==0)s_recorder_task=entry;return &s_task; }
unsigned uxTaskGetStackHighWaterMark(TaskHandle_t task) { (void)task; return 1024u; }
void vTaskDelay(TickType_t ticks) { s_now_us+=(uint64_t)ticks*1000u;if(s_recorder_running)longjmp(s_stop_recorder,1); }
TickType_t xTaskGetTickCount(void){return (TickType_t)(s_now_us/1000u);}
esp_err_t esp_task_wdt_add(void *task){(void)task;return ESP_OK;}
esp_err_t esp_task_wdt_reset(void){return ESP_OK;}
static void recorder_step(void)
{assert(s_recorder_task);s_recorder_running=true;if(setjmp(s_stop_recorder)==0)s_recorder_task(NULL);s_recorder_running=false;}

esp_reset_reason_t esp_reset_reason(void) { return ESP_RST_POWERON; }
void esp_restart(void) { assert(false); }
void sb_board_get_info(sb_board_info_t *out)
{ memset(out, 0, sizeof(*out)); out->device_id = UINT64_C(0x1122334455667788); out->boot_id = 9u; out->hardware_revision = "fake"; }
uint64_t sb_monotonic_us(void) { return s_now_us; }
uint32_t esp_random(void){static uint32_t value=1u;return ++value;}
uint32_t sb_fix_to_sp(sb_gnss_fix_type_t fix) { return (uint32_t)fix; }
uint8_t sb_fix_to_ldc(sb_gnss_fix_type_t fix){return (uint8_t)fix;}
void sb_diag_increment(sb_diag_group_t group, unsigned counter)
{if(group==SB_DIAG_RECORDER&&counter==0u)++s_consumed;}
void sb_diag_add(sb_diag_group_t group, unsigned counter, uint64_t amount)
{if(group==SB_DIAG_RECORDER&&counter==1u)s_committed+=(unsigned)amount;}
void sb_diag_snapshot(sb_diag_snapshot_t *out) { memset(out, 0, sizeof(*out)); }
size_t sb_diag_get_errors(uint32_t after, bool has_after, size_t limit, sb_error_record_t *out,
                          uint32_t *oldest, uint32_t *newest)
{ (void)after; (void)has_after; (void)limit; (void)out; *oldest = *newest = 0u; return 0u; }
void sb_diag_clear_errors(void) {}
void sb_gnss_get_snapshot(sb_gnss_fix_t *fix, sb_gnss_state_t *state, uint64_t *rx, uint64_t *last_fix)
{ if (fix) memset(fix, 0, sizeof(*fix)); if (state) *state=SB_GNSS_OFF; if (rx) *rx=0; if (last_fix) *last_fix=0; }
void sb_gnss_request_restart(void) {}
void sb_gnss_note_live_stream_drop(void) {}
uint32_t sb_gnss_get_restart_generation(void){return 0u;}
bool sb_gnss_try_receive(sb_gnss_fix_t *fix)
{if(!s_fix_count)return false;*fix=s_fixes[s_fix_head++];--s_fix_count;return true;}
sb_storage_state_t sb_storage_get_state(void) { return SB_STORAGE_READY; }
static void storage_ack(sb_storage_ack_t ack)
{assert(s_ack_count<8u);s_storage_acks[(s_ack_head+s_ack_count)%8u]=ack;++s_ack_count;}
bool sb_storage_create_recording(uint32_t boot,uint32_t session,uint32_t file,uint64_t device,const uint8_t id[16])
{(void)boot;(void)session;(void)device;(void)id;storage_ack((sb_storage_ack_t){.op=SB_STORAGE_OP_CREATE,.status=SB_OK,.file_sequence=file});return true;}
bool sb_storage_submit_block(uint8_t buffer,uint32_t sequence,uint8_t *data,size_t length)
{assert(sb_ldc_block_validate(data,length,sequence));++s_submitted;
 storage_ack((sb_storage_ack_t){.op=SB_STORAGE_OP_WRITE_BLOCK,.buffer_id=buffer,.status=SB_OK,
                                .committed_block_sequence=sequence});return true;}
bool sb_storage_close_recording(void)
{storage_ack((sb_storage_ack_t){.op=SB_STORAGE_OP_CLOSE,.status=SB_OK});return true;}
bool sb_storage_try_ack(sb_storage_ack_t *ack)
{if(!s_ack_count)return false;*ack=s_storage_acks[s_ack_head];s_ack_head=(s_ack_head+1u)%8u;--s_ack_count;return true;}
void sb_storage_get_size_snapshot(uint64_t *total, uint64_t *free_bytes) { if(total)*total=1024;if(free_bytes)*free_bytes=512; }
void sb_storage_get_file_snapshot(char name[64], uint64_t *size, bool *active)
{ if(name)memset(name,0,64);if(size)*size=0;if(active)*active=false; }
sb_status_t sb_storage_list_files(uint32_t offset,uint8_t limit,sb_storage_file_info_t *entries,
                                  size_t capacity,size_t *count,uint32_t *next,bool *complete)
{ (void)offset;(void)limit;(void)entries;(void)capacity;*count=0;*next=0;*complete=true;return SB_OK; }
sb_status_t sb_storage_get_file_info(const char *name,sb_storage_file_info_t *info)
{ (void)name;(void)info;return SB_NOT_FOUND; }
sb_status_t sb_storage_delete_file(const char *name) { (void)name; return SB_OK; }
sb_status_t sb_storage_request_format(void) { return SB_OK; }
bool sb_supervisor_critical_healthy(void) { return true; }
uint64_t sb_transfer_session_token(sb_source_t source,uint32_t generation)
{ return ((uint64_t)generation << 8u) | source; }
void sb_transfer_set_session_generation(sb_source_t source,uint32_t generation)
{ s_transfer_generation[source] = generation; ++s_reset_count; }
bool sb_transfer_is_active(void) { return s_transfer_active; }
sb_status_t sb_transfer_open(const char *name,uint64_t token,uint32_t *id,uint64_t *size,bool *active)
{ (void)name;(void)token;*id=1;*size=0;*active=false;return SB_OK; }
sb_status_t sb_transfer_read(uint64_t token,uint32_t id,uint64_t offset,uint32_t length,
                             uint8_t *out,size_t cap,size_t *actual)
{ (void)token;(void)id;(void)offset;(void)length;(void)out;(void)cap;*actual=0;return SB_OK; }
sb_status_t sb_transfer_close(uint64_t token,uint32_t id,bool outstanding)
{ (void)token;(void)id;(void)outstanding;return SB_OK; }
sb_ble_state_t sb_ble_get_state(void) { return SB_BLE_IDLE; }
bool sb_ble_get_mtu(uint16_t *mtu) { if(mtu)*mtu=23;return true; }
void sb_ble_mark_hello_complete(void) {}
sb_status_t sb_ble_set_advertising(bool enabled,sb_source_t source) { (void)enabled;(void)source;return SB_OK; }
sb_status_t sb_ble_disconnect(sb_source_t source) { (void)source;return SB_OK; }
sb_wifi_state_t sb_wifi_get_state(void) { return SB_WIFI_OFF; }
void sb_wifi_get_snapshot(sb_wifi_snapshot_t *out) { memset(out,0,sizeof(*out)); }
size_t sb_wifi_get_scan_results(sb_wifi_ap_t *out,size_t capacity,uint32_t *generation)
{ (void)out;(void)capacity;if(generation)*generation=0;return 0; }
void sb_wifi_mark_hello_complete(void) {}
sb_status_t sb_wifi_request_scan(sb_source_t source) { (void)source;return SB_OK; }
sb_status_t sb_wifi_request_connect(sb_source_t source,const uint8_t address[4],uint16_t port,uint32_t id)
{ (void)source;(void)address;(void)port;(void)id;return SB_OK; }
sb_status_t sb_wifi_request_disconnect(sb_source_t source) { (void)source;return SB_OK; }
sb_status_t sb_wifi_request_forget(sb_source_t source) { (void)source;return SB_OK; }
sb_status_t sb_wifi_request_set_config(sb_source_t source,const uint8_t *ssid,size_t ssid_n,
                                       const uint8_t *password,size_t password_n)
{ (void)source;(void)ssid;(void)ssid_n;(void)password;(void)password_n;return SB_OK; }
uint8_t sb_ui_get_page(void) { return 0; }
bool sb_ui_set_page(uint8_t page) { (void)page;return true; }
void sb_validation_note_stack(sb_validation_task_t task,uint32_t bytes) { (void)task;(void)bytes; }

static void queue_hello(uint32_t generation, uint32_t request_id, uint32_t sequence)
{
    request_t hello={.source=SB_SOURCE_USB,.type=SB_SP_REQUEST,.service=1,.message=1,
        .request=request_id,.sequence=sequence,.generation=generation,.length=5u};
    hello.payload[0]=0xA1u; hello.payload[1]=0u; hello.payload[2]=0x19u;
    hello.payload[3]=0x01u; hello.payload[4]=0x00u; /* {0: 256} */
    process_control_request(&hello);
}

int main(void)
{
    assert(sb_control_start()==ESP_OK);
    assert(sb_control_session_generation(SB_SOURCE_USB)==1u);
    uint8_t payload[]={0xA0u};
    sb_sp_frame_t old_request={.major=1,.minor=0,.type=SB_SP_REQUEST,.service_id=1,
        .message_id=2,.request_id=10,.sequence=1,.payload=payload,.payload_length=sizeof(payload)};
    assert(sb_control_submit_for_generation(SB_SOURCE_USB,1u,&old_request));
    assert(s_pending[0].active&&s_pending[0].request_id==10u);

    s_online[SB_SOURCE_USB]=true; s_client_rx_limit[SB_SOURCE_USB]=512u;
    s_tx_sequence[SB_SOURCE_USB]=21u; s_rx_expected[SB_SOURCE_USB]=20u;
    s_subscribed[SB_SOURCE_USB][3]=true; s_live_enabled[SB_SOURCE_USB]=true;
    s_live_mask[SB_SOURCE_USB]=1u; s_transfer_active=true;
    response_t old_terminal={.source=SB_SOURCE_USB,.generation=1u,
        .frame={.major=1,.type=SB_SP_RESPONSE,.request_id=8u}};
    assert(tx_enqueue(&old_terminal));
    response_t old_bulk={.source=SB_SOURCE_USB,.generation=1u,
        .frame={.major=1,.type=SB_SP_BULK,.request_id=9u,.storage_epoch=1u}};
    assert(tx_enqueue(&old_bulk));
    assert(s_bulk_busy);

    queue_hello(1u,77u,0u);
    assert(sb_control_session_generation(SB_SOURCE_USB)==2u);
    assert(s_transfer_generation[SB_SOURCE_USB]==2u&&s_reset_count>1u);
    assert(s_online[SB_SOURCE_USB]&&s_client_rx_limit[SB_SOURCE_USB]==256u);
    assert(!s_subscribed[SB_SOURCE_USB][3]&&!s_live_enabled[SB_SOURCE_USB]);
    assert(!s_pending[0].active&&!s_bulk_busy);
    assert(uxQueueMessagesWaiting(s_terminal_q[SB_SOURCE_USB])==1u);
    assert(uxQueueMessagesWaiting(s_misc_q[SB_SOURCE_USB])==0u);
    assert(uxQueueMessagesWaiting(s_bulk_q)==0u);

    request_t stale; assert(xQueueReceive(s_rx_q,&stale,0)==pdTRUE);
    assert(stale.generation==1u&&!request_generation_current(&stale));
    process_control_request(&stale); /* old business request is discarded before dispatch */
    sb_sp_frame_t frame; uint8_t response[SB_SP_MAX_RX_PAYLOAD]; uint32_t response_generation=0;
    assert(sb_control_receive_for_generation(SB_SOURCE_USB,&frame,response,sizeof(response),&response_generation));
    assert(frame.type==SB_SP_RESPONSE&&frame.request_id==77u&&frame.sequence==0u&&response_generation==2u);
    sb_cbor_map_t result; assert(sb_cbor_parse_map(frame.payload,frame.payload_length,&result));
    const sb_cbor_value_t *status=sb_cbor_get(&result,0u); assert(status&&status->kind==SB_CBOR_UINT&&status->u==SB_OK);
    sb_control_tx_completed(SB_SOURCE_USB,1u,SB_SP_RESPONSE,77u,false);
    assert(sb_control_session_generation(SB_SOURCE_USB)==2u);

    queue_hello(2u,78u,1u); /* ONLINE HELLO must use sequence zero. */
    assert(sb_control_session_generation(SB_SOURCE_USB)==2u&&s_online[SB_SOURCE_USB]);
    assert(sb_control_receive_for_generation(SB_SOURCE_USB,&frame,response,sizeof(response),&response_generation));
    assert(frame.request_id==78u&&frame.sequence==1u&&response_generation==2u);
    assert(sb_cbor_parse_map(frame.payload,frame.payload_length,&result));
    status=sb_cbor_get(&result,0u);assert(status&&status->u==SB_INVALID_STATE);

    sb_control_transport_start(SB_SOURCE_USB);
    apply_pending_disconnects();
    uint32_t restarted_generation=sb_control_session_generation(SB_SOURCE_USB);
    assert(restarted_generation==3u&&!s_online[SB_SOURCE_USB]);
    queue_hello(restarted_generation,79u,0u);
    assert(s_online[SB_SOURCE_USB]&&sb_control_session_generation(SB_SOURCE_USB)==3u);
    assert(sb_control_receive_for_generation(SB_SOURCE_USB,&frame,response,sizeof(response),&response_generation));
    assert(frame.request_id==79u&&frame.sequence==0u&&response_generation==3u);

    response_t bulk={.source=SB_SOURCE_USB,.generation=3u,
        .frame={.major=1,.type=SB_SP_BULK,.request_id=100u,.storage_epoch=1u}};
    assert(tx_enqueue(&bulk));
    for(uint32_t i=0;i<CONTROL_TX_IMPORTANT_BURST_MAX;++i){
        response_t important={.source=SB_SOURCE_USB,.generation=3u,
            .frame={.major=1,.type=SB_SP_EVENT,.service_id=3u,.message_id=(uint16_t)(i+1u)}};
        assert(tx_enqueue(&important));
        assert(sb_control_receive_for_generation(SB_SOURCE_USB,&frame,response,sizeof(response),&response_generation));
        assert(frame.type==SB_SP_EVENT&&response_generation==3u);
    }
    response_t next_important={.source=SB_SOURCE_USB,.generation=3u,
        .frame={.major=1,.type=SB_SP_EVENT,.service_id=3u,.message_id=9u}};
    assert(tx_enqueue(&next_important));
    assert(sb_control_receive_for_generation(SB_SOURCE_USB,&frame,response,sizeof(response),&response_generation));
    assert(frame.type==SB_SP_BULK&&frame.request_id==100u);
    sb_control_tx_completed(SB_SOURCE_USB,3u,SB_SP_BULK,100u,false);

    response_t terminal={.source=SB_SOURCE_USB,.generation=3u,
        .frame={.major=1,.type=SB_SP_RESPONSE,.request_id=201u}};
    assert(tx_enqueue(&terminal));
    assert(sb_control_receive_for_generation(SB_SOURCE_USB,&frame,response,sizeof(response),&response_generation));
    assert(frame.type==SB_SP_RESPONSE&&frame.request_id==201u);
    terminal.frame.request_id=202u;assert(tx_enqueue(&terminal));
    terminal.frame.request_id=203u;assert(tx_enqueue(&terminal));
    terminal.frame.request_id=204u;assert(!tx_enqueue(&terminal));
    assert(sb_control_session_generation(SB_SOURCE_USB)==4u&&!s_online[SB_SOURCE_USB]);
    assert(uxQueueMessagesWaiting(s_terminal_q[SB_SOURCE_USB])==0u);
    assert(!sb_control_receive_for_generation(SB_SOURCE_USB,&frame,response,sizeof(response),&response_generation));
    /* Keep all three physical consumers stalled with queued terminal, BULK,
     * ordinary event and live data while the real Recorder owner runs. */
    for(unsigned source=0;source<SB_CONTROL_ACTIVE_TX_QUEUES;++source){
        s_online[source]=true;
        response_t terminal_pressure={.source=(sb_source_t)source,.generation=s_session_generation[source],
            .frame={.major=1,.type=SB_SP_RESPONSE,.request_id=300u+source}};
        assert(tx_enqueue(&terminal_pressure));
        response_t event={.source=(sb_source_t)source,.generation=s_session_generation[source],
            .frame={.major=1,.type=SB_SP_EVENT,.service_id=4u}};
        (void)tx_enqueue(&event);
        response_t live={.source=(sb_source_t)source,.generation=s_session_generation[source],
            .frame={.major=1,.type=SB_SP_STREAM,.service_id=3u}};
        for(unsigned flood=0;flood<32u;++flood)(void)tx_enqueue(&live);
    }
    response_t backlog={.source=SB_SOURCE_WIFI,.generation=s_session_generation[SB_SOURCE_WIFI],
        .frame={.major=1,.type=SB_SP_BULK,.request_id=400u,.storage_epoch=1u}};
    assert(tx_enqueue(&backlog));
    assert(sb_recorder_start()==ESP_OK);recorder_step();recorder_step();
    sb_recorder_state_t rs;sb_recorder_get_snapshot(&rs,NULL,NULL,NULL,NULL,NULL,NULL);
    assert(rs==SB_RECORDER_RECORDING);
    for(unsigned i=0;i<15u;++i){
        sb_gnss_fix_t *fix=&s_fixes[i];memset(fix,0,sizeof(*fix));
        fix->sample_seq=i;fix->mono_us=UINT64_C(10000000)+(uint64_t)i*UINT64_C(1000000);
        fix->position_valid=true;fix->latitude_e7=481173000;fix->longitude_e7=115166667;
        fix->fix_type=SB_GNSS_FIX_3D;
    }
    s_fix_head=0u;s_fix_count=15u;recorder_step();recorder_step();
    assert(s_consumed==15u&&s_submitted>=1u&&s_committed>=15u);
    for(unsigned source=0;source<SB_CONTROL_ACTIVE_TX_QUEUES;++source)
        assert(uxQueueMessagesWaiting(s_terminal_q[source])>=1u);
    assert(s_bulk_busy);
    puts("PASS production Control congestion + Recorder owner: three stalled sessions, event/live flood, BULK backlog, fix consumption and LDC commit submission");
    return 0;
}
