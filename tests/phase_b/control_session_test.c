#include <assert.h>
#include <stdio.h>
#include <string.h>

#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "esp_system.h"
#include "sailball/board.h"
#include "sailball/diagnostics.h"
#include "sailball/gnss.h"
#include "sailball/recorder.h"
#include "sailball/storage.h"
#include "sailball/supervisor.h"
#include "sailball/transfer.h"
#include "sailball/ble.h"
#include "sailball/wifi.h"
#include "sailball/ui.h"
#include "sailball/validation.h"

#include "../../components/sailball_control/src/control.c"
static uint32_t s_fake_storage_epoch=1u;
uint32_t sb_storage_epoch_generation(void){return s_fake_storage_epoch;}

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
static sb_recorder_state_t s_test_recorder_state=SB_RECORDER_STOPPED;
static uint32_t s_test_recorder_session=22u;
static sb_storage_state_t s_test_storage_state=SB_STORAGE_READY;
static sb_ble_state_t s_test_ble_state=SB_BLE_IDLE;
static sb_wifi_snapshot_t s_test_wifi_snapshot;
static size_t s_test_wifi_result_count;
static uint8_t s_test_ui_page;
static sb_error_record_t s_test_error;
static uint32_t s_test_error_oldest,s_test_error_newest;
static bool s_test_critical_healthy=true;
static uint32_t s_expected_test_tx_sequence;

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
{ (void)entry; (void)name; (void)stack; (void)arg; (void)priority; (void)storage; (void)state; return &s_task; }
unsigned uxTaskGetStackHighWaterMark(TaskHandle_t task) { (void)task; return 1024u; }
void vTaskDelay(TickType_t ticks) { (void)ticks; }

esp_reset_reason_t esp_reset_reason(void) { return ESP_RST_POWERON; }
void esp_restart(void) { assert(false); }
void sb_board_get_info(sb_board_info_t *out)
{ memset(out, 0, sizeof(*out)); out->device_id = UINT64_C(0x1122334455667788); out->boot_id = 9u; out->hardware_revision = "fake"; }
uint64_t sb_monotonic_us(void) { return 1000u; }
uint32_t sb_fix_to_sp(sb_gnss_fix_type_t fix) { return (uint32_t)fix; }
void sb_diag_increment(sb_diag_group_t group, unsigned counter) { (void)group; (void)counter; }
void sb_diag_add(sb_diag_group_t group, unsigned counter, uint64_t amount) { (void)group; (void)counter; (void)amount; }
void sb_diag_snapshot(sb_diag_snapshot_t *out) { memset(out, 0, sizeof(*out)); }
size_t sb_diag_get_errors(uint32_t after, bool has_after, size_t limit, sb_error_record_t *out,
                          uint32_t *oldest, uint32_t *newest)
{ (void)after;(void)has_after;if(oldest)*oldest=s_test_error_oldest;if(newest)*newest=s_test_error_newest;if(out&&limit&&s_test_error_newest){out[0]=s_test_error;return 1u;}return 0u; }
void sb_diag_clear_errors(void) {}
void sb_gnss_get_snapshot(sb_gnss_fix_t *fix, sb_gnss_state_t *state, uint64_t *rx, uint64_t *last_fix)
{ if (fix) memset(fix, 0, sizeof(*fix)); if (state) *state=SB_GNSS_OFF; if (rx) *rx=0; if (last_fix) *last_fix=0; }
void sb_gnss_request_restart(void) {}
void sb_gnss_note_live_stream_drop(void) {}
sb_recorder_state_t sb_unused_recorder_state(void) { return SB_RECORDER_STOPPED; }
void sb_recorder_get_snapshot(sb_recorder_state_t *state, bool *intent, uint32_t *session,
                              uint32_t *block, uint64_t *start, uint64_t *sample, uint64_t *commit)
{ if(state)*state=s_test_recorder_state;if(intent)*intent=false;if(session)*session=s_test_recorder_session;if(block)*block=0;if(start)*start=0;if(sample)*sample=0;if(commit)*commit=0; }
void sb_recorder_get_utc_start(int64_t *utc, bool *valid) { if (utc) *utc=0; if (valid) *valid=false; }
sb_status_t sb_recorder_request_start(void) { return SB_OK; }
sb_status_t sb_recorder_request_stop(void) { return SB_OK; }
bool sb_recorder_can_format_storage(void) { return true; }
sb_storage_state_t sb_storage_get_state(void) { return s_test_storage_state; }
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
bool sb_supervisor_critical_healthy(void) { return s_test_critical_healthy; }
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
sb_ble_state_t sb_ble_get_state(void) { return s_test_ble_state; }
bool sb_ble_get_mtu(uint16_t *mtu) { if(mtu)*mtu=23;return true; }
void sb_ble_mark_hello_complete(void) {}
sb_status_t sb_ble_set_advertising(bool enabled,sb_source_t source) { (void)enabled;(void)source;return SB_OK; }
sb_status_t sb_ble_disconnect(sb_source_t source) { (void)source;return SB_OK; }
sb_wifi_state_t sb_wifi_get_state(void) { return SB_WIFI_OFF; }
void sb_wifi_get_snapshot(sb_wifi_snapshot_t *out) { *out=s_test_wifi_snapshot; }
size_t sb_wifi_get_scan_results(sb_wifi_ap_t *out,size_t capacity,uint32_t *generation)
{ (void)out;if(generation)*generation=s_test_wifi_snapshot.scan_generation;return s_test_wifi_result_count<capacity?s_test_wifi_result_count:capacity; }
void sb_wifi_mark_hello_complete(void) {}
sb_status_t sb_wifi_request_scan(sb_source_t source) { (void)source;return SB_OK; }
sb_status_t sb_wifi_request_connect(sb_source_t source,const uint8_t address[4],uint16_t port,uint32_t id)
{ (void)source;(void)address;(void)port;(void)id;return SB_OK; }
sb_status_t sb_wifi_request_disconnect(sb_source_t source) { (void)source;return SB_OK; }
sb_status_t sb_wifi_request_forget(sb_source_t source) { (void)source;return SB_OK; }
sb_status_t sb_wifi_request_set_config(sb_source_t source,const uint8_t *ssid,size_t ssid_n,
                                       const uint8_t *password,size_t password_n)
{ (void)source;(void)ssid;(void)ssid_n;(void)password;(void)password_n;return SB_OK; }
uint8_t sb_ui_get_page(void) { return s_test_ui_page; }
bool sb_ui_set_page(uint8_t page) { (void)page;return true; }
void sb_validation_note_stack(sb_validation_task_t task,uint32_t bytes) { (void)task;(void)bytes; }

static void queue_hello_for(sb_source_t source,uint32_t generation, uint32_t request_id, uint32_t sequence)
{
    request_t hello={.source=source,.type=SB_SP_REQUEST,.service=1,.message=1,
        .request=request_id,.sequence=sequence,.generation=generation,.length=5u};
    hello.payload[0]=0xA1u; hello.payload[1]=0u; hello.payload[2]=0x19u;
    hello.payload[3]=0x01u; hello.payload[4]=0x00u; /* {0: 256} */
    process_control_request(&hello);
}
static void queue_hello(uint32_t generation,uint32_t request_id,uint32_t sequence)
{queue_hello_for(SB_SOURCE_USB,generation,request_id,sequence);}

static void subscribe_one(sb_source_t source,uint32_t generation,uint16_t service,uint32_t request_id)
{
    request_t r={.source=source,.type=SB_SP_REQUEST,.service=1u,.message=4u,
        .request=request_id,.sequence=s_rx_expected[source],.generation=generation,.length=4u};
    r.payload[0]=0xA1u;r.payload[1]=0u;r.payload[2]=0x81u;r.payload[3]=(uint8_t)service;
    process_control_request(&r);
    sb_sp_frame_t frame;uint8_t payload[SB_SP_MAX_RX_PAYLOAD];uint32_t actual_generation=0;
    assert(sb_control_receive_for_generation(source,&frame,payload,sizeof(payload),&actual_generation));
    assert(frame.type==SB_SP_RESPONSE&&frame.request_id==request_id&&actual_generation==generation);
    s_expected_test_tx_sequence=frame.sequence+1u;
    sb_cbor_map_t result;assert(sb_cbor_parse_map(frame.payload,frame.payload_length,&result));
    const sb_cbor_value_t *status=sb_cbor_get(&result,0u);assert(status&&status->kind==SB_CBOR_UINT&&status->u==SB_OK);
}

static void assert_event(sb_source_t source,uint16_t service,uint16_t message,
                         const uint64_t *values,size_t fields)
{
    sb_sp_frame_t frame;uint8_t payload[SB_SP_MAX_RX_PAYLOAD];uint32_t generation=0;
    assert(sb_control_receive_for_generation(source,&frame,payload,sizeof(payload),&generation));
    assert(frame.type==SB_SP_EVENT&&frame.request_id==0u&&frame.service_id==service&&
           frame.message_id==message&&frame.payload_length>0u&&frame.sequence==s_expected_test_tx_sequence++);
    sb_cbor_map_t map;assert(sb_cbor_parse_map(frame.payload,frame.payload_length,&map));
    assert(map.count==fields);
    for(size_t i=0;i<fields;++i){const sb_cbor_value_t *v=sb_cbor_get(&map,(uint8_t)i);
        assert(v&&v->kind==SB_CBOR_UINT&&v->u==values[i]);}
}

int main(void)
{
    assert(sb_control_start()==ESP_OK);
    assert(sb_control_session_generation(SB_SOURCE_USB)==1u);
    uint8_t payload[]={0xA0u};
    sb_sp_frame_t old_request={.major=1,.minor=0,.type=SB_SP_REQUEST,.service_id=1,
        .message_id=2,.request_id=10,.sequence=1,.payload=payload,.payload_length=sizeof(payload)};
    assert(sb_control_submit_for_generation(SB_SOURCE_USB,1u,&old_request));
    request_t copied_request;
    assert(xQueuePeek(s_rx_q,&copied_request,0)==pdTRUE&&copied_request.payload[0]==0xA0u);
    payload[0]=0xFFu; /* Transport may now reuse its decoded/RX scratch. */
    assert(xQueuePeek(s_rx_q,&copied_request,0)==pdTRUE&&copied_request.payload[0]==0xA0u);
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
    sb_control_transport_start(SB_SOURCE_WIFI);apply_pending_disconnects();
    uint32_t wifi_generation=sb_control_session_generation(SB_SOURCE_WIFI);
    queue_hello_for(SB_SOURCE_WIFI,wifi_generation,301u,0u);
    assert(sb_control_receive_for_generation(SB_SOURCE_WIFI,&frame,response,sizeof(response),&response_generation));
    assert(frame.request_id==301u&&frame.sequence==1u&&response_generation==wifi_generation);
    assert(s_tx_sequence[SB_SOURCE_WIFI]==2u);
    queue_hello_for(SB_SOURCE_WIFI,wifi_generation,302u,0u);
    uint32_t wifi_reset_generation=sb_control_session_generation(SB_SOURCE_WIFI);
    assert(wifi_reset_generation!=wifi_generation);
    assert(sb_control_receive_for_generation(SB_SOURCE_WIFI,&frame,response,sizeof(response),&response_generation));
    assert(frame.request_id==302u&&frame.sequence==0u&&response_generation==wifi_reset_generation);
    assert(s_tx_sequence[SB_SOURCE_WIFI]==1u);
    request_t next_wifi={.source=SB_SOURCE_WIFI,.type=SB_SP_REQUEST,.service=1,.message=2,
        .request=303u,.sequence=1u,.generation=wifi_reset_generation,.length=1u};
    next_wifi.payload[0]=0xa0u;process_control_request(&next_wifi);
    assert(sb_control_receive_for_generation(SB_SOURCE_WIFI,&frame,response,sizeof(response),&response_generation));
    assert(frame.request_id==303u&&frame.sequence==1u);
    queue_hello_for(SB_SOURCE_WIFI,wifi_reset_generation,304u,1u);
    assert(sb_control_receive_for_generation(SB_SOURCE_WIFI,&frame,response,sizeof(response),&response_generation));
    assert(frame.request_id==304u&&frame.sequence==2u);
    sb_control_transport_start(SB_SOURCE_USB);apply_pending_disconnects();
    uint32_t fairness_generation=sb_control_session_generation(SB_SOURCE_USB);
    queue_hello(fairness_generation,401u,0u);
    assert(sb_control_receive_for_generation(SB_SOURCE_USB,&frame,response,sizeof(response),&response_generation));
    response_t pending_bulk={.source=SB_SOURCE_USB,.generation=fairness_generation,
        .frame={.major=1,.type=SB_SP_BULK,.request_id=402u,.storage_epoch=1u}};
    assert(tx_enqueue(&pending_bulk));
    for(unsigned i=0;i<CONTROL_TX_TERMINAL_BURST_MAX;++i){
        response_t next={.source=SB_SOURCE_USB,.generation=fairness_generation,
            .frame={.major=1,.type=SB_SP_RESPONSE,.request_id=410u+i}};
        assert(tx_enqueue(&next));
        assert(sb_control_receive_for_generation(SB_SOURCE_USB,&frame,response,sizeof(response),&response_generation));
        assert(frame.type==SB_SP_RESPONSE&&frame.request_id==410u+i);
    }
    response_t next_terminal={.source=SB_SOURCE_USB,.generation=fairness_generation,
        .frame={.major=1,.type=SB_SP_RESPONSE,.request_id=420u}};
    assert(tx_enqueue(&next_terminal));
    assert(sb_control_receive_for_generation(SB_SOURCE_USB,&frame,response,sizeof(response),&response_generation));
    assert(frame.type==SB_SP_BULK&&frame.request_id==402u);
    sb_control_tx_completed(SB_SOURCE_USB,fairness_generation,SB_SP_BULK,402u,false);
    assert(sb_control_receive_for_generation(SB_SOURCE_USB,&frame,response,sizeof(response),&response_generation));
    assert(frame.type==SB_SP_RESPONSE&&frame.request_id==420u);
    uint32_t epoch_generation=sb_control_session_generation(SB_SOURCE_WIFI);
    response_t stale_epoch_bulk={.source=SB_SOURCE_WIFI,.generation=epoch_generation,
        .frame={.major=1,.type=SB_SP_BULK,.request_id=501u,.storage_epoch=1u}};
    assert(tx_enqueue(&stale_epoch_bulk));
    s_fake_storage_epoch=2u;
    assert(!sb_control_receive_for_generation(SB_SOURCE_WIFI,&frame,response,sizeof(response),&response_generation));
    assert(sb_control_session_generation(SB_SOURCE_WIFI)!=epoch_generation);

    /* Two-phase Control→Transport handoff: a candidate is only peeked. A
     * second P5 logical reset replaces it before acceptance; commit must leave
     * the new generation's terminal response available. */
    sb_control_transport_start(SB_SOURCE_WIFI);apply_pending_disconnects();
    uint32_t handoff_generation=sb_control_session_generation(SB_SOURCE_WIFI);
    queue_hello_for(SB_SOURCE_WIFI,handoff_generation,601u,0u);
    sb_control_tx_candidate_t candidate;
    assert(sb_control_peek_tx_for_generation(SB_SOURCE_WIFI,&candidate));
    assert(candidate.frame.request_id==601u&&candidate.generation==handoff_generation);
    queue_hello_for(SB_SOURCE_WIFI,handoff_generation,602u,0u);
    uint32_t latest_generation=sb_control_session_generation(SB_SOURCE_WIFI);
    assert(latest_generation!=handoff_generation);
    assert(!sb_control_commit_peeked_tx(SB_SOURCE_WIFI,&candidate));
    assert(sb_control_peek_tx_for_generation(SB_SOURCE_WIFI,&candidate));
    assert(candidate.frame.request_id==602u&&candidate.frame.sequence==0u&&candidate.generation==latest_generation);
    assert(sb_control_commit_peeked_tx(SB_SOURCE_WIFI,&candidate));
    assert(!sb_control_peek_tx_for_generation(SB_SOURCE_WIFI,&candidate));

    /* BLE fast invalidation is the generation advance. A queued old request
     * may be drained later but must not reach dispatch after that point. */
    uint32_t old_ble_generation=sb_control_session_generation(SB_SOURCE_BLE);
    sb_sp_frame_t old_ble_request={.major=1u,.minor=0u,.type=SB_SP_REQUEST,.service_id=1u,
        .message_id=2u,.request_id=701u,.sequence=0u,.payload=payload,.payload_length=sizeof(payload)};
    assert(sb_control_submit_for_generation(SB_SOURCE_BLE,old_ble_generation,&old_ble_request));
    assert(sb_control_invalidate_session_fast(SB_SOURCE_BLE,old_ble_generation));
    uint32_t invalid_ble_generation=sb_control_session_generation(SB_SOURCE_BLE);
    assert(invalid_ble_generation!=old_ble_generation);
    apply_pending_disconnects();
    request_t invalidated_request;assert(xQueueReceive(s_rx_q,&invalidated_request,0)==pdTRUE);
    process_control_request(&invalidated_request);
    assert(sb_control_session_generation(SB_SOURCE_BLE)==invalid_ble_generation);
    assert(uxQueueMessagesWaiting(s_terminal_q[SB_SOURCE_BLE])==0u);

    /* A deferred fast-invalidation cleanup belongs to the generation it
     * invalidated. A valid same-link HELLO may establish a newer generation
     * before the Control loop services that cleanup. */
    queue_hello_for(SB_SOURCE_BLE,invalid_ble_generation,710u,0u);
    assert(s_online[SB_SOURCE_BLE]);
    assert(sb_control_receive_for_generation(SB_SOURCE_BLE,&frame,response,sizeof(response),&response_generation));
    assert(frame.request_id==710u&&frame.sequence==0u&&response_generation==invalid_ble_generation);
    uint32_t ble_old_generation=sb_control_session_generation(SB_SOURCE_BLE);
    s_subscribed[SB_SOURCE_BLE][3]=true;
    assert(sb_control_invalidate_session_fast(SB_SOURCE_BLE,ble_old_generation));
    uint32_t ble_invalid_generation=sb_control_session_generation(SB_SOURCE_BLE);
    assert(s_cleanup_pending[SB_SOURCE_BLE].pending&&
           s_cleanup_pending[SB_SOURCE_BLE].target_generation==ble_old_generation);
    /* No cleanup yet: the same physical BLE link completes a fresh HELLO. */
    queue_hello_for(SB_SOURCE_BLE,ble_invalid_generation,711u,0u);
    uint32_t ble_fresh_generation=sb_control_session_generation(SB_SOURCE_BLE);
    assert(ble_fresh_generation==next_generation(ble_invalid_generation));
    assert(s_online[SB_SOURCE_BLE]);
    s_subscribed[SB_SOURCE_BLE][4]=true; /* newer-generation state */
    apply_pending_disconnects();
    assert(s_online[SB_SOURCE_BLE]&&sb_control_session_generation(SB_SOURCE_BLE)==ble_fresh_generation);
    assert(s_subscribed[SB_SOURCE_BLE][4]);
    assert(!s_cleanup_pending[SB_SOURCE_BLE].pending);
    assert(sb_control_peek_tx_for_generation(SB_SOURCE_BLE,&candidate));
    assert(candidate.frame.type==SB_SP_RESPONSE&&candidate.frame.request_id==711u&&
           candidate.frame.sequence==0u&&candidate.generation==ble_fresh_generation);
    assert(sb_control_commit_peeked_tx(SB_SOURCE_BLE,&candidate));
    assert(!sb_control_peek_tx_for_generation(SB_SOURCE_BLE,&candidate));

    /* Without a fresh HELLO the successor generation still owns the old
     * invalidated state, so cleanup must run and remove it. */
    uint32_t cleanup_generation=sb_control_session_generation(SB_SOURCE_BLE);
    assert(sb_control_invalidate_session_fast(SB_SOURCE_BLE,cleanup_generation));
    assert(s_cleanup_pending[SB_SOURCE_BLE].pending&&
           s_cleanup_pending[SB_SOURCE_BLE].target_generation==cleanup_generation);
    apply_pending_disconnects();
    assert(!s_online[SB_SOURCE_BLE]&&!s_subscribed[SB_SOURCE_BLE][4]);
    assert(!s_cleanup_pending[SB_SOURCE_BLE].pending);

    /* Repeated invalidations coalesce to the latest invalidated generation.
     * With no fresh HELLO, the merged token still cleans the old state. */
    uint32_t multi_start=sb_control_session_generation(SB_SOURCE_BLE);
    queue_hello_for(SB_SOURCE_BLE,multi_start,712u,0u);
    assert(sb_control_receive_for_generation(SB_SOURCE_BLE,&frame,response,sizeof(response),&response_generation));
    uint32_t multi_g=sb_control_session_generation(SB_SOURCE_BLE);
    s_subscribed[SB_SOURCE_BLE][5]=true;
    assert(sb_control_invalidate_session_fast(SB_SOURCE_BLE,multi_g));
    uint32_t multi_g1=sb_control_session_generation(SB_SOURCE_BLE);
    assert(sb_control_invalidate_session_fast(SB_SOURCE_BLE,multi_g1));
    uint32_t multi_g2=sb_control_session_generation(SB_SOURCE_BLE);
    assert(s_cleanup_pending[SB_SOURCE_BLE].target_generation==multi_g1);
    apply_pending_disconnects();
    assert(!s_online[SB_SOURCE_BLE]&&!s_subscribed[SB_SOURCE_BLE][5]);
    assert(!s_cleanup_pending[SB_SOURCE_BLE].pending);

    /* A later merged token also becomes stale if a fresh HELLO is processed
     * before cleanup; its terminal remains available exactly once. */
    queue_hello_for(SB_SOURCE_BLE,multi_g2,713u,0u);
    assert(sb_control_receive_for_generation(SB_SOURCE_BLE,&frame,response,sizeof(response),&response_generation));
    uint32_t fresh_race_g=sb_control_session_generation(SB_SOURCE_BLE);
    assert(sb_control_invalidate_session_fast(SB_SOURCE_BLE,fresh_race_g));
    uint32_t fresh_race_invalid=sb_control_session_generation(SB_SOURCE_BLE);
    assert(sb_control_invalidate_session_fast(SB_SOURCE_BLE,fresh_race_invalid));
    uint32_t fresh_race_multi=sb_control_session_generation(SB_SOURCE_BLE);
    queue_hello_for(SB_SOURCE_BLE,fresh_race_multi,714u,0u);
    uint32_t multi_fresh=sb_control_session_generation(SB_SOURCE_BLE);
    assert(s_online[SB_SOURCE_BLE]);
    apply_pending_disconnects();
    assert(s_online[SB_SOURCE_BLE]&&sb_control_session_generation(SB_SOURCE_BLE)==multi_fresh);
    assert(sb_control_peek_tx_for_generation(SB_SOURCE_BLE,&candidate));
    assert(candidate.frame.request_id==714u&&candidate.generation==multi_fresh);
    assert(sb_control_commit_peeked_tx(SB_SOURCE_BLE,&candidate));
    assert(!sb_control_peek_tx_for_generation(SB_SOURCE_BLE,&candidate));

    /* Frozen H07 golden schemas traverse production subscription/state-event
     * logic and then the production SP/CBOR encoder. */
    uint32_t event_generation=sb_control_session_generation(SB_SOURCE_BLE);
    subscribe_one(SB_SOURCE_BLE,event_generation,3u,801u);
    send_state_events(); /* establish the baseline without a synthetic event */
    s_test_recorder_state=SB_RECORDER_RECORDING;s_test_recorder_session=23u;send_state_events();
    {const uint64_t expected[]={SB_RECORDER_RECORDING,23u};assert_event(SB_SOURCE_BLE,3u,1u,expected,2u);}

    subscribe_one(SB_SOURCE_BLE,event_generation,4u,802u);send_state_events();
    s_test_storage_state=SB_STORAGE_ERROR;send_state_events();
    {const uint64_t expected[]={SB_STORAGE_ERROR};assert_event(SB_SOURCE_BLE,4u,1u,expected,1u);}

    subscribe_one(SB_SOURCE_BLE,event_generation,6u,803u);send_state_events();
    s_test_wifi_snapshot.state=SB_WIFI_ERROR;s_test_wifi_snapshot.last_error=3u;
    s_test_wifi_snapshot.last_error_valid=true;send_state_events();
    {const uint64_t expected[]={SB_WIFI_ERROR,3u};assert_event(SB_SOURCE_BLE,6u,1u,expected,2u);}
    send_state_events();assert(!sb_control_receive_for_generation(SB_SOURCE_BLE,&frame,response,sizeof(response),NULL));
    s_test_wifi_result_count=2u;s_test_wifi_snapshot.scan_generation=1u;send_state_events();
    {const uint64_t expected[]={1u,2u};assert_event(SB_SOURCE_BLE,6u,2u,expected,2u);}

    subscribe_one(SB_SOURCE_BLE,event_generation,7u,804u);send_state_events();
    s_test_ble_state=SB_BLE_CONNECTED;send_state_events();
    {const uint64_t expected[]={SB_BLE_CONNECTED};assert_event(SB_SOURCE_BLE,7u,1u,expected,1u);}

    subscribe_one(SB_SOURCE_BLE,event_generation,9u,805u);send_state_events();
    s_test_ui_page=2u;send_state_events();
    {const uint64_t expected[]={2u};assert_event(SB_SOURCE_BLE,9u,1u,expected,1u);}

    subscribe_one(SB_SOURCE_BLE,event_generation,8u,806u);send_state_events();
    s_test_error=(sb_error_record_t){.error_id=1u,.service_id=4u,.error_code=2u,.severity=1u};
    s_test_error_oldest=s_test_error_newest=1u;send_state_events();
    {const uint64_t expected[]={1u,4u,2u,1u};assert_event(SB_SOURCE_BLE,8u,1u,expected,4u);}

    /* Critical health is read by system/UI state, not invented as CORE event. */
    subscribe_one(SB_SOURCE_BLE,event_generation,3u,807u);send_state_events();
    s_test_critical_healthy=!s_test_critical_healthy;send_state_events();
    assert(!sb_control_receive_for_generation(SB_SOURCE_BLE,&frame,response,sizeof(response),NULL));

    /* Frozen permits up to 32 subscription IDs; unknown/unsupported services
     * are ignored while supported IDs become the exact set. */
    request_t too_many={.source=SB_SOURCE_BLE,.type=SB_SP_REQUEST,.service=1u,.message=4u,
        .request=808u,.sequence=s_rx_expected[SB_SOURCE_BLE],.generation=event_generation,.length=7u};
    {const uint8_t body[]={0xA1u,0u,0x83u,3u,4u,6u};memcpy(too_many.payload,body,sizeof(body));too_many.length=sizeof(body);}
    process_control_request(&too_many);
    assert(sb_control_receive_for_generation(SB_SOURCE_BLE,&frame,response,sizeof(response),NULL));
    assert(frame.type==SB_SP_RESPONSE&&frame.request_id==808u);
    assert(sb_cbor_parse_map(frame.payload,frame.payload_length,&result));status=sb_cbor_get(&result,0u);
    assert(status&&status->kind==SB_CBOR_UINT&&status->u==SB_OK);
    assert(s_subscribed[SB_SOURCE_BLE][3]&&s_subscribed[SB_SOURCE_BLE][4]&&s_subscribed[SB_SOURCE_BLE][6]);

    /* M05 validation order: offline session state precedes unknown command;
     * permission precedes parsing a forbidden command's malformed body. */
    sb_control_disconnect(SB_SOURCE_USB);apply_pending_disconnects();
    assert(!s_online[SB_SOURCE_USB]);
    request_t offline_unknown={.source=SB_SOURCE_USB,.type=SB_SP_REQUEST,.service=9u,.message=2u,
        .request=809u,.sequence=0u,.generation=sb_control_session_generation(SB_SOURCE_USB),.length=1u};
    offline_unknown.payload[0]=0xFFu;process_control_request(&offline_unknown);
    assert(sb_control_receive_for_generation(SB_SOURCE_USB,&frame,response,sizeof(response),NULL));
    assert(frame.request_id==809u&&sb_cbor_parse_map(frame.payload,frame.payload_length,&result));
    status=sb_cbor_get(&result,0u);assert(status&&status->u==SB_INVALID_STATE);

    request_t forbidden={.source=SB_SOURCE_BLE,.type=SB_SP_REQUEST,.service=3u,.message=1u,
        .request=810u,.sequence=s_rx_expected[SB_SOURCE_BLE],.generation=event_generation,.length=1u};
    forbidden.payload[0]=0xFFu;process_control_request(&forbidden);
    assert(sb_control_receive_for_generation(SB_SOURCE_BLE,&frame,response,sizeof(response),NULL));
    assert(frame.request_id==810u&&sb_cbor_parse_map(frame.payload,frame.payload_length,&result));
    status=sb_cbor_get(&result,0u);assert(status&&status->u==SB_PERMISSION_DENIED);

    /* Busy Transfer does not hide malformed READ CBOR. */
    response_t occupied={.source=SB_SOURCE_BLE,.generation=event_generation,
        .frame={.major=1u,.type=SB_SP_BULK,.request_id=811u,.storage_epoch=s_fake_storage_epoch}};
    assert(tx_enqueue(&occupied)&&s_bulk_busy);
    request_t malformed_read={.source=SB_SOURCE_BLE,.type=SB_SP_REQUEST,.service=5u,.message=2u,
        .request=812u,.sequence=s_rx_expected[SB_SOURCE_BLE],.generation=event_generation,.length=1u};
    malformed_read.payload[0]=0x80u;process_control_request(&malformed_read);
    assert(sb_control_receive_for_generation(SB_SOURCE_BLE,&frame,response,sizeof(response),NULL));
    assert(frame.request_id==812u&&sb_cbor_parse_map(frame.payload,frame.payload_length,&result));
    status=sb_cbor_get(&result,0u);assert(status&&status->u==SB_INVALID_REQUEST);
    assert(sb_control_receive_for_generation(SB_SOURCE_BLE,&frame,response,sizeof(response),NULL));
    assert(frame.type==SB_SP_BULK&&frame.request_id==811u);sb_control_tx_completed(SB_SOURCE_BLE,event_generation,SB_SP_BULK,811u,false);

    puts("PASS production Control session/deferred cleanup and Phase C EVENT/precedence cases");
    return 0;
}
