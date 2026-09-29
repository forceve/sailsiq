#include <assert.h>
#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/portmacro.h"
#include "sailball/ble.h"
#include "sailball/control.h"
#include "sailball/diagnostics.h"
#include "sailball/usb.h"
#include "sailball/transport_quantum.h"
#include "ble_reassembly.h"

#define BLE_RX_QUEUE_DEPTH 4u
#define BLE_FRAGMENT_QUEUE_DEPTH 4u
#define BLE_HS_CONN_HANDLE_NONE UINT16_MAX
#define BLE_GATT_ACCESS_OP_WRITE_CHR 1
#define BLE_ATT_ERR_UNLIKELY 14
#define BLE_ATT_ERR_INVALID_ATTR_VALUE_LEN 13
#define BLE_ATT_ERR_INSUFFICIENT_RES 17
#define BLE_GAP_EVENT_CONNECT 1
#define BLE_GAP_EVENT_DISCONNECT 2
#define BLE_GAP_EVENT_SUBSCRIBE 3
#define BLE_GAP_EVENT_MTU 4
#define BLE_GAP_EVENT_ADV_COMPLETE 5
#define BLE_ERR_REM_USER_CONN_TERM 19
#define USB_TX_QUANTUM 512u
#define USB_TX_STALL_TIMEOUT_US UINT64_C(5000000)
#define WIFI_TX_QUANTUM 512u
#define WIFI_TX_STALL_TIMEOUT_US UINT64_C(5000000)
#ifndef EWOULDBLOCK
#define EWOULDBLOCK EAGAIN
#endif
#define OS_MBUF_PKTLEN(om) ((om)->length)
struct os_mbuf { uint16_t length; uint8_t bytes[SB_BLE_FRAGMENT_MAX_VALUE]; };
struct ble_gatt_access_ctxt { int op; struct os_mbuf *om; };
struct ble_gap_event {
    int type;
    struct { int status; uint16_t conn_handle; } connect;
    struct { uint16_t attr_handle; int cur_notify; } subscribe;
    struct { uint16_t value; } mtu;
};
typedef struct { sb_sp_frame_t frame; uint32_t session_generation; uint8_t payload[SB_SP_MAX_RX_PAYLOAD]; } ble_frame_item_t;
typedef struct { uint32_t generation,session_generation; uint64_t received_us; uint16_t length; uint8_t value[SB_BLE_FRAGMENT_MAX_VALUE]; } ble_fragment_item_t;
typedef struct { uint32_t connection_generation,session_generation; } reassembly_context_t;
typedef struct { sb_sp_frame_t frame; uint32_t session_generation; uint8_t payload[SB_SP_MAX_RX_PAYLOAD]; } wifi_frame_item_t;
static StaticQueue_t s_rx_queue_struct,s_fragment_queue_struct;
static StaticQueue_t s_wifi_tx_queue_struct;
static uint8_t s_rx_queue_storage[BLE_RX_QUEUE_DEPTH*sizeof(ble_frame_item_t)];
static uint8_t s_fragment_queue_storage[BLE_FRAGMENT_QUEUE_DEPTH*sizeof(ble_fragment_item_t)];
static QueueHandle_t s_rx_queue,s_fragment_queue,s_tx_queue;
static ble_frame_item_t s_tx_item;
static uint8_t s_wifi_tx_queue_storage[2u*sizeof(wifi_frame_item_t)];
static QueueHandle_t s_wifi_tx_queue;
static portMUX_TYPE s_mux;
static bool s_connected,s_notify_enabled,s_adv_running,s_adv_update_pending,s_disconnect_pending;
static bool s_hello_complete,s_session_end_pending,s_session_start_pending,s_fragment_handoff_overflow;
static uint32_t s_session_end_generation;
static bool s_session_end_control_invalidated;
static uint16_t s_conn_handle=BLE_HS_CONN_HANDLE_NONE,s_current_mtu=23u,s_tx_frame_id,s_tx_value_handle=27u;
static uint64_t s_connected_at_us,s_now_us=UINT64_C(1000000);
static uint32_t s_connection_generation,s_owner_generation,s_sp_session_generation=1u,s_reassembly_session_generation;
static int s_terminate_result;
static sb_ble_state_t s_state;
static sb_ble_reassembly_t s_reassembly;
static bool s_tx_active,s_tx_bulk_publication_claimed;
static uint64_t s_tx_bulk_publication_claim_id;
static unsigned s_fragment_errors,s_received_frames,s_transport_polls;
static uint8_t s_payload[SB_SP_MAX_RX_PAYLOAD],s_out[SB_SP_MAX_FRAME+16u],s_decoded[SB_SP_MAX_FRAME];
static union { sb_control_tx_candidate_t candidate; uint8_t decoded[SB_SP_MAX_FRAME]; } s_decoded_scratch;
static bool s_usb_tx_active,s_usb_resync_pending,s_usb_tx_reboot,s_usb_response_available=true;
static bool s_usb_bulk_publication_claimed; static uint64_t s_usb_bulk_publication_claim_id;
static bool s_usb_next_bulk,s_abort_epoch_on_usb_write;
static size_t s_usb_tx_length,s_usb_tx_offset,s_usb_bytes_sent;
static uint32_t s_usb_tx_generation,s_usb_tx_request_id;
static uint32_t s_usb_tx_storage_epoch;
static uint8_t s_usb_tx_type;
static uint64_t s_usb_tx_started_us;
static uint32_t s_test_storage_epoch=1u;
static unsigned s_usb_disconnects,s_usb_completions;
uint32_t sb_storage_epoch_generation(void){return s_test_storage_epoch;}
bool sb_storage_claim_bulk_publication(uint32_t epoch,uint64_t *id){if(id)*id=1u;return epoch==s_test_storage_epoch;}
bool sb_storage_finish_bulk_publication(uint32_t epoch,uint64_t id){(void)id;return epoch==s_test_storage_epoch;}
void sb_storage_release_bulk_publication(uint32_t epoch,uint64_t id){(void)epoch;(void)id;}
static wifi_frame_item_t s_wifi_tx_item;
static uint8_t s_wifi_tx_buffer[SB_SP_MAX_FRAME+16u];
static size_t s_wifi_tx_length,s_wifi_tx_offset,s_wifi_bytes_sent;
static uint64_t s_wifi_tx_started_us;
static uint32_t s_wifi_tx_completed_generation,s_wifi_tx_completed_request_id,s_wifi_session_generation=1u;
static uint8_t s_wifi_tx_completed_type;
static bool s_wifi_tx_active,s_wifi_tx_bootstrap,s_wifi_tx_resync_pending,s_wifi_tx_completion_pending;
static bool s_wifi_tx_bulk_publication_claimed;
static int s_wifi_socket=3;
static void release_bulk_publication(void)
{if(s_tx_bulk_publication_claimed)sb_storage_release_bulk_publication(s_tx_item.frame.storage_epoch,s_tx_bulk_publication_claim_id);s_tx_bulk_publication_claimed=false;}
static void release_usb_bulk_publication(void)
{if(s_usb_bulk_publication_claimed)sb_storage_release_bulk_publication(s_usb_tx_storage_epoch,s_usb_bulk_publication_claim_id);s_usb_bulk_publication_claimed=false;}

typedef struct { StaticQueue_t *identity; uint8_t *data; unsigned depth,size,head,count; } fake_queue_t;
static fake_queue_t s_queues[3];static unsigned s_queue_count;
static fake_queue_t *queue(QueueHandle_t id)
{for(unsigned i=0;i<s_queue_count;++i)if(s_queues[i].identity==id)return &s_queues[i];assert(0);return NULL;}
QueueHandle_t xQueueCreateStatic(unsigned depth,unsigned size,uint8_t *data,StaticQueue_t *identity)
{assert(s_queue_count<3u);s_queues[s_queue_count++]=(fake_queue_t){identity,data,depth,size,0u,0u};return identity;}
int xQueueSend(QueueHandle_t id,const void *item,TickType_t ticks)
{(void)ticks;fake_queue_t *q=queue(id);if(q->count==q->depth)return pdFALSE;
    memcpy(q->data+(size_t)((q->head+q->count)%q->depth)*q->size,item,q->size);++q->count;return pdTRUE;}
int xQueueReceive(QueueHandle_t id,void *out,TickType_t ticks)
{(void)ticks;fake_queue_t *q=queue(id);if(!q->count)return pdFALSE;
    memcpy(out,q->data+(size_t)q->head*q->size,q->size);q->head=(q->head+1u)%q->depth;--q->count;return pdTRUE;}
int xQueueReset(QueueHandle_t id){fake_queue_t *q=queue(id);q->head=q->count=0u;return pdTRUE;}
unsigned uxQueueMessagesWaiting(QueueHandle_t id){return queue(id)->count;}
int ble_hs_mbuf_to_flat(struct os_mbuf *om,void *out,uint16_t capacity,uint16_t *actual)
{if(om->length>capacity)return -1;memcpy(out,om->bytes,om->length);*actual=om->length;return 0;}
uint16_t ble_att_mtu(uint16_t handle){(void)handle;return 247u;}
int ble_gap_adv_stop(void){return 0;}
int ble_gap_terminate(uint16_t handle,int reason){(void)handle;(void)reason;return s_terminate_result;}
int64_t esp_timer_get_time(void){return (int64_t)s_now_us;}
void sb_diag_increment(sb_diag_group_t group,unsigned counter)
{if(group==SB_DIAG_PROTOCOL&&counter==8u)++s_fragment_errors;
    if(group==SB_DIAG_PROTOCOL&&counter==0u)++s_received_frames;}
uint32_t sb_diag_raise(uint16_t service,uint16_t error,uint8_t severity,bool utc,int64_t when)
{(void)service;(void)error;(void)severity;(void)utc;(void)when;return 1u;}
static bool ble_started(void){return true;}
static bool should_advertise(void){return false;}
static int start_advertising(void){s_adv_running=true;return 0;}
static void set_state(sb_ble_state_t state){s_state=state;}
static void process_control_tx(void){++s_transport_polls;}
uint32_t sb_control_session_generation(sb_source_t source){assert(source==SB_SOURCE_USB);return 1u;}
bool sb_control_receive_for_generation(sb_source_t source,sb_sp_frame_t *frame,uint8_t *payload,
                                       size_t capacity,uint32_t *generation)
{
    assert(source==SB_SOURCE_USB&&capacity>=600u);
    if(!s_usb_response_available)return false;s_usb_response_available=false;
    for(unsigned i=0;i<600u;++i)payload[i]=(uint8_t)(i*17u);
    *frame=(sb_sp_frame_t){.major=1,.minor=0,.type=s_usb_next_bulk?SB_SP_BULK:SB_SP_RESPONSE,.service_id=1,.message_id=1,
        .request_id=55u,.sequence=1u,.payload_length=600u,.payload=payload,.storage_epoch=s_test_storage_epoch};
    s_usb_next_bulk=false;
    *generation=1u;return true;
}
bool sb_control_peek_tx_for_generation(sb_source_t source,sb_control_tx_candidate_t *candidate)
{
    bool available=s_usb_response_available;s_usb_response_available=false;
    if(!available)return false;
    s_usb_response_available=true;
    if(!sb_control_receive_for_generation(source,&candidate->frame,candidate->payload,
                                          sizeof(candidate->payload),&candidate->generation))return false;
    s_usb_response_available=true;
    candidate->source=source;candidate->ticket=1u;candidate->priority=0u;
    candidate->reserved_kind=SB_CONTROL_TX_KIND_TERMINAL;
    candidate->frame.payload=candidate->payload;
    return true;
}
bool sb_control_commit_peeked_tx(sb_source_t source,sb_control_tx_candidate_t *candidate)
{
    if(source!=SB_SOURCE_USB||candidate->generation!=1u||candidate->ticket!=1u||
       candidate->reserved_kind!=SB_CONTROL_TX_KIND_TERMINAL||!s_usb_response_available)return false;
    s_usb_response_available=false;return true;
}
bool sb_control_usb_response_is_reboot(const sb_sp_frame_t *frame){(void)frame;return false;}
void sb_control_tx_completed(sb_source_t source,uint32_t generation,uint8_t type,uint32_t request,bool reboot)
{(void)source;(void)generation;(void)type;(void)request;(void)reboot;++s_usb_completions;}
void sb_control_disconnect(sb_source_t source){(void)source;++s_usb_disconnects;}
int sb_usb_write(const uint8_t *bytes,size_t length,uint32_t timeout)
{(void)bytes;(void)timeout;assert(length<=USB_TX_QUANTUM);++s_usb_bytes_sent;
 if(s_abort_epoch_on_usb_write){s_abort_epoch_on_usb_write=false;++s_test_storage_epoch;}
 return length?1:0;}
static int fake_tcp_send(int socket,const void *bytes,size_t length,int flags)
{(void)bytes;(void)flags;assert(socket==3&&length<=WIFI_TX_QUANTUM);++s_wifi_bytes_sent;return length?1:0;}
static void fail_or_recover(uint8_t reason){(void)reason;assert(0);}

#include "ble_owner_adapter.inc" /* verbatim current production callback, owner poll and GAP event */
#include "usb_tx_adapter.inc" /* verbatim bounded physical USB TX owner */
#define s_tx_queue s_wifi_tx_queue
#define s_tx_item s_wifi_tx_item
#define s_tx_buffer s_wifi_tx_buffer
#define s_tx_length s_wifi_tx_length
#define s_tx_offset s_wifi_tx_offset
#define s_tx_active s_wifi_tx_active
#define s_tx_bulk_publication_claimed s_wifi_tx_bulk_publication_claimed
#define s_tx_bootstrap s_wifi_tx_bootstrap
#define s_tx_started_us s_wifi_tx_started_us
#define s_tx_resync_pending s_wifi_tx_resync_pending
#define s_tx_completed_generation s_wifi_tx_completed_generation
#define s_tx_completed_request_id s_wifi_tx_completed_request_id
#define s_tx_completed_type s_wifi_tx_completed_type
#define s_tx_completion_pending s_wifi_tx_completion_pending
#define s_socket s_wifi_socket
#define s_session_generation s_wifi_session_generation
#define send fake_tcp_send
#include "wifi_tx_adapter.inc" /* verbatim bounded TCP sender, with local symbol aliasing */
#undef send
#undef s_session_generation
#undef s_socket
#undef s_tx_completion_pending
#undef s_tx_completed_type
#undef s_tx_completed_request_id
#undef s_tx_completed_generation
#undef s_tx_resync_pending
#undef s_tx_started_us
#undef s_tx_bootstrap
#undef s_tx_active
#undef s_tx_bulk_publication_claimed
#undef s_tx_offset
#undef s_tx_length
#undef s_tx_buffer
#undef s_tx_item
#undef s_tx_queue

static size_t make_frame(uint8_t frame[SB_SP_MAX_FRAME],uint32_t request_id)
{
    static uint8_t payload[600];for(size_t i=0;i<sizeof(payload);++i)payload[i]=(uint8_t)(i*17u);
    sb_sp_frame_t value={.major=1,.minor=0,.type=SB_SP_REQUEST,.service_id=1,.message_id=1,
        .request_id=request_id,.sequence=request_id,.payload=payload,.payload_length=sizeof(payload)};
    size_t length=0;assert(sb_sp_frame_encode(&value,frame,SB_SP_MAX_FRAME,&length));return length;
}
static int deliver_fragment(const uint8_t *frame,size_t total,uint16_t id,uint16_t offset,size_t part)
{
    assert(part+6u<=SB_BLE_FRAGMENT_MAX_VALUE);
    struct os_mbuf mbuf={.length=(uint16_t)(part+6u)};
    sb_write_le16(mbuf.bytes,id);sb_write_le16(mbuf.bytes+2,offset);sb_write_le16(mbuf.bytes+4,(uint16_t)total);
    memcpy(mbuf.bytes+6,frame+offset,part);
    struct ble_gatt_access_ctxt context={BLE_GATT_ACCESS_OP_WRITE_CHR,&mbuf};
    return rx_access(s_conn_handle,s_tx_value_handle,&context,NULL);
}
static int deliver_fragment_with_total(const uint8_t *frame,size_t actual_total,uint16_t announced_total,
                                       uint16_t id,uint16_t offset,size_t part)
{
    assert((size_t)offset+part<=actual_total&&part+6u<=SB_BLE_FRAGMENT_MAX_VALUE);
    struct os_mbuf mbuf={.length=(uint16_t)(part+6u)};
    sb_write_le16(mbuf.bytes,id);sb_write_le16(mbuf.bytes+2,offset);
    sb_write_le16(mbuf.bytes+4,announced_total);
    memcpy(mbuf.bytes+6,frame+offset,part);
    struct ble_gatt_access_ctxt context={BLE_GATT_ACCESS_OP_WRITE_CHR,&mbuf};
    return rx_access(s_conn_handle,s_tx_value_handle,&context,NULL);
}
static void connect_link(uint16_t handle)
{struct ble_gap_event e={.type=BLE_GAP_EVENT_CONNECT,.connect={0,handle}};assert(gap_event(&e,NULL)==0);assert(s_connected);}
static void disconnect_link(void)
{struct ble_gap_event e={.type=BLE_GAP_EVENT_DISCONNECT};assert(gap_event(&e,NULL)==0);assert(!s_connected);}
int main(void)
{
    s_rx_queue=xQueueCreateStatic(BLE_RX_QUEUE_DEPTH,sizeof(ble_frame_item_t),s_rx_queue_storage,&s_rx_queue_struct);
    s_fragment_queue=xQueueCreateStatic(BLE_FRAGMENT_QUEUE_DEPTH,sizeof(ble_fragment_item_t),s_fragment_queue_storage,&s_fragment_queue_struct);
    s_wifi_tx_queue=xQueueCreateStatic(2u,sizeof(wifi_frame_item_t),s_wifi_tx_queue_storage,&s_wifi_tx_queue_struct);
    uint8_t frame[SB_SP_MAX_FRAME];size_t n=make_frame(frame,41u);assert(n>508u);
    connect_link(7u);
    assert(deliver_fragment(frame,n,0u,0u,508u)==0);
    assert(deliver_fragment(frame,n,0u,508u,n-508u)==0);
    assert(uxQueueMessagesWaiting(s_fragment_queue)==2u&&uxQueueMessagesWaiting(s_rx_queue)==0u);
    sb_ble_transport_poll();assert(uxQueueMessagesWaiting(s_rx_queue)==1u&&s_received_frames==1u);
    ble_frame_item_t received;assert(xQueueReceive(s_rx_queue,&received,0)==pdTRUE);
    assert(received.frame.request_id==41u&&received.frame.payload_length==600u);
    assert(memcmp(received.payload,frame+24u,600u)==0);

    /* Callback queue overflow is an explicit ATT error; owner invalidates and recovers. */
    for(unsigned i=0;i<4u;++i)assert(deliver_fragment(frame,n,1u,0u,30u)==0);
    assert(deliver_fragment(frame,n,1u,0u,30u)==BLE_ATT_ERR_INSUFFICIENT_RES);
    unsigned errors=s_fragment_errors;sb_ble_transport_poll();
    assert(s_fragment_errors==errors+1u&&uxQueueMessagesWaiting(s_fragment_queue)==0u);
    assert(deliver_fragment(frame,n,17u,0u,508u)==0);
    assert(deliver_fragment(frame,n,17u,508u,n-508u)==0);
    sb_ble_transport_poll();assert(uxQueueMessagesWaiting(s_rx_queue)==1u);
    assert(xQueueReceive(s_rx_queue,&received,0)==pdTRUE);

    /* Disconnect discards both pending fragments and partial owner assembly. */
    assert(deliver_fragment(frame,n,18u,0u,30u)==0);sb_ble_transport_poll();
    assert(deliver_fragment(frame,n,18u,30u,30u)==0);disconnect_link();
    assert(uxQueueMessagesWaiting(s_fragment_queue)==0u);
    connect_link(8u);sb_ble_transport_poll();
    assert(deliver_fragment(frame,n,0u,0u,508u)==0);
    assert(deliver_fragment(frame,n,0u,508u,n-508u)==0);sb_ble_transport_poll();
    assert(uxQueueMessagesWaiting(s_rx_queue)==1u);
    assert(s_transport_polls>=4u);
    /* A slow USB partial send consumes one bounded quantum per Transport turn,
     * while the production BLE callback queue continues to receive owner service. */
    assert(deliver_fragment(frame,n,1u,0u,508u)==0);
    send_ready_responses();sb_ble_transport_poll();
    assert(s_usb_tx_active&&s_usb_tx_offset==1u);
    assert(deliver_fragment(frame,n,1u,508u,n-508u)==0);
    send_ready_responses();sb_ble_transport_poll();
    assert(s_usb_tx_active&&s_usb_tx_offset==2u&&s_usb_bytes_sent==2u);
    assert(uxQueueMessagesWaiting(s_rx_queue)==2u);
    wifi_frame_item_t wifi_item={.session_generation=1u,.frame={.major=1,.type=SB_SP_RESPONSE,
        .service_id=1,.message_id=1,.request_id=77u,.sequence=1u,.payload_length=600u}};
    for(unsigned i=0;i<600u;++i)wifi_item.payload[i]=(uint8_t)(i*17u);
    assert(xQueueSend(s_wifi_tx_queue,&wifi_item,0)==pdTRUE);
    assert(deliver_fragment(frame,n,2u,0u,508u)==0);
    send_queued_tcp();sb_ble_transport_poll();
    assert(s_wifi_tx_active&&s_wifi_tx_offset==1u);
    assert(deliver_fragment(frame,n,2u,508u,n-508u)==0);
    send_queued_tcp();sb_ble_transport_poll();
    assert(s_wifi_tx_active&&s_wifi_tx_offset==2u&&s_wifi_bytes_sent==2u);
    assert(uxQueueMessagesWaiting(s_rx_queue)==3u);
    while(xQueueReceive(s_rx_queue,&received,0)==pdTRUE){}
    /* Malformed fragments pass through the real callback handoff and owner,
     * then a new offset-zero frame recovers the same connection. */
    uint16_t bad_id=3u;
    for(unsigned kind=0;kind<4u;++kind){
        assert(deliver_fragment(frame,n,bad_id,0u,30u)==0);sb_ble_transport_poll();
        uint32_t before=s_reassembly.errors;
        if(kind==0u)assert(deliver_fragment(frame,n,bad_id,0u,30u)==0); /* duplicate */
        if(kind==1u)assert(deliver_fragment(frame,n,bad_id,20u,20u)==0); /* overlap */
        if(kind==2u)assert(deliver_fragment(frame,n,bad_id,40u,20u)==0); /* gap */
        if(kind==3u)assert(deliver_fragment_with_total(frame,n,(uint16_t)(n-1u),bad_id,30u,20u)==0);
        sb_ble_transport_poll();assert(s_reassembly.errors>before);
        ++bad_id;
        assert(deliver_fragment(frame,n,bad_id,0u,508u)==0);
        assert(deliver_fragment(frame,n,bad_id,508u,n-508u)==0);
        sb_ble_transport_poll();assert(xQueueReceive(s_rx_queue,&received,0)==pdTRUE);
        ++bad_id;
    }
    assert(deliver_fragment(frame,n,bad_id,0u,30u)==0);sb_ble_transport_poll();
    s_now_us+=SB_BLE_REASSEMBLY_TIMEOUT_US+1u;
    uint32_t before_timeout=s_reassembly.errors;
    assert(deliver_fragment(frame,n,bad_id,30u,20u)==0);
    sb_ble_transport_poll();assert(s_reassembly.errors>before_timeout);
    assert(deliver_fragment(frame,n,(uint16_t)(bad_id+1u),0u,508u)==0);
    assert(deliver_fragment(frame,n,(uint16_t)(bad_id+1u),508u,n-508u)==0);
    sb_ble_transport_poll();assert(xQueueReceive(s_rx_queue,&received,0)==pdTRUE);
    /* A new frame ID at offset zero replaces an incomplete assembly. */
    assert(deliver_fragment(frame,n,(uint16_t)(bad_id+2u),0u,30u)==0);
    sb_ble_transport_poll();
    assert(deliver_fragment(frame,n,(uint16_t)(bad_id+3u),0u,508u)==0);
    assert(deliver_fragment(frame,n,(uint16_t)(bad_id+3u),508u,n-508u)==0);
    sb_ble_transport_poll();assert(xQueueReceive(s_rx_queue,&received,0)==pdTRUE);
    disconnect_link();connect_link(9u);sb_ble_transport_poll();
    assert(deliver_fragment(frame,n,0u,0u,508u)==0);
    assert(deliver_fragment(frame,n,0u,508u,n-508u)==0);
    sb_ble_transport_poll();assert(xQueueReceive(s_rx_queue,&received,0)==pdTRUE);
    assert(deliver_fragment(frame,n,1u,0u,508u)==0);
    assert(deliver_fragment(frame,n,1u,508u,n-508u)==0);
    sb_ble_transport_poll();assert(xQueueReceive(s_rx_queue,&received,0)==pdTRUE);
    /* Seed only the production parser's expected ID to represent a long-lived
     * connection after 65,534 prior frames; callback/owner still do the work. */
    s_reassembly.expected_id=UINT16_MAX;
    assert(deliver_fragment(frame,n,UINT16_MAX,0u,508u)==0);
    assert(deliver_fragment(frame,n,UINT16_MAX,508u,n-508u)==0);
    sb_ble_transport_poll();assert(xQueueReceive(s_rx_queue,&received,0)==pdTRUE);
    assert(deliver_fragment(frame,n,0u,0u,508u)==0);
    assert(deliver_fragment(frame,n,0u,508u,n-508u)==0);
    sb_ble_transport_poll();assert(xQueueReceive(s_rx_queue,&received,0)==pdTRUE);
    /* Logical invalidation is committed before best-effort physical teardown. */
    s_hello_complete=false;s_session_end_pending=true;s_disconnect_pending=true;s_terminate_result=-1;
    sb_ble_transport_poll();
    assert(s_connected&&s_state==SB_BLE_CONNECTED&&s_session_end_pending&&!s_hello_complete);
    /* USB publication revalidates after its physical write can yield. A
     * partial COBS BULK accepted concurrently with epoch abort is not
     * completed successfully; the logical USB session is closed and the byte
     * stream is scheduled for delimiter resynchronization. */
    s_usb_tx_active=false;s_usb_tx_length=s_usb_tx_offset=0u;s_usb_resync_pending=false;
    s_usb_response_available=true;s_usb_next_bulk=true;
    uint32_t usb_epoch=s_test_storage_epoch;unsigned disconnects=s_usb_disconnects;
    unsigned completions=s_usb_completions;s_abort_epoch_on_usb_write=true;
    send_ready_responses();
    assert(s_test_storage_epoch!=usb_epoch&&s_usb_disconnects==disconnects+1u);
    assert(!s_usb_tx_active&&s_usb_resync_pending&&!s_usb_bulk_publication_claimed);
    assert(s_usb_completions==completions);
    puts("PASS production BLE callback -> bounded handoff -> owner reassembly under slow production USB/TCP send, overflow and reconnect");
    return 0;
}
