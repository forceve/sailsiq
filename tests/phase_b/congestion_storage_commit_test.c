/* Production Control + Transport + Recorder + Storage under deterministic
 * congested physical transports and a fake filesystem. */
#define SB_FOUR_OWNER_TEST 1
#include "epoch_three_owner_test.c"

#define s_task_struct control_task_struct
#define s_stack control_stack
#define s_shutting_down control_shutting_down
#include "../../components/sailball_control/src/control.c"
#undef s_shutting_down
#undef s_stack
#undef s_task_struct

#include "sailball/control.h"
#include "sailball/usb.h"
#include "sailball/ble.h"
#include "sailball/wifi.h"
#include "sailball/ui.h"
#include "sailball/supervisor.h"
#include "esp_timer.h"
#include "esp_system.h"
#include "congestion_adapters.h"

static unsigned s_usb_write_calls;
static size_t s_usb_wire_bytes;
static bool s_usb_physical_send_enabled;
static bool s_usb_connected=true;
static bool s_ble_started,s_wifi_started;
static bool s_abort_storage_epoch_on_physical_send;

void sb_test_abort_storage_epoch_on_physical_send(void)
{s_abort_storage_epoch_on_physical_send=true;}
void sb_test_storage_abort_at_physical_send(void)
{if(s_abort_storage_epoch_on_physical_send){s_abort_storage_epoch_on_physical_send=false;abort_epoch();}}

int64_t esp_timer_get_time(void){return (int64_t)s_now_us;}
esp_err_t sb_usb_init(void){return ESP_OK;}
bool sb_usb_is_connected(void){return s_usb_connected;}
int sb_usb_read(uint8_t *bytes,size_t capacity,uint32_t timeout_ms)
{(void)bytes;(void)capacity;(void)timeout_ms;return 0;}
int sb_usb_write(const uint8_t *bytes,size_t length,uint32_t timeout_ms)
{(void)bytes;(void)timeout_ms;++s_usb_write_calls;if(!s_usb_physical_send_enabled)return 0;
 s_usb_wire_bytes+=length;sb_test_storage_abort_at_physical_send();return (int)length;}
sb_ble_state_t sb_ble_get_state(void){return SB_BLE_CONNECTED;}
bool sb_ble_get_mtu(uint16_t *mtu){if(mtu)*mtu=23u;return true;}
void sb_ble_mark_hello_complete(void){}
bool sb_ble_take_session_start(void){if(s_ble_started)return false;s_ble_started=true;return true;}
sb_status_t sb_ble_set_advertising(bool enabled,sb_source_t source)
{(void)enabled;(void)source;return SB_OK;}
sb_status_t sb_ble_disconnect(sb_source_t source){(void)source;return SB_OK;}
bool sb_ble_receive_frame_for_generation(sb_sp_frame_t *frame,uint8_t *payload,size_t capacity,uint32_t *generation)
{(void)frame;(void)payload;(void)capacity;(void)generation;return false;}
sb_wifi_state_t sb_wifi_get_state(void){return SB_WIFI_OFF;}
void sb_wifi_get_snapshot(sb_wifi_snapshot_t *out){memset(out,0,sizeof(*out));}
size_t sb_wifi_get_scan_results(sb_wifi_ap_t *out,size_t capacity,uint32_t *generation)
{(void)out;(void)capacity;if(generation)*generation=0u;return 0u;}
void sb_wifi_mark_hello_complete(void){}
sb_status_t sb_wifi_request_scan(sb_source_t source){(void)source;return SB_OK;}
sb_status_t sb_wifi_request_connect(sb_source_t source,const uint8_t address[4],uint16_t port,uint32_t id)
{(void)source;(void)address;(void)port;(void)id;return SB_OK;}
sb_status_t sb_wifi_request_disconnect(sb_source_t source){(void)source;return SB_OK;}
sb_status_t sb_wifi_request_forget(sb_source_t source){(void)source;return SB_OK;}
sb_status_t sb_wifi_request_set_config(sb_source_t source,const uint8_t *ssid,size_t ssid_n,
                                        const uint8_t *password,size_t password_n)
{(void)source;(void)ssid;(void)ssid_n;(void)password;(void)password_n;return SB_OK;}
bool sb_wifi_receive_frame_for_generation(sb_sp_frame_t *frame,uint8_t *payload,size_t capacity,uint32_t *generation)
{(void)frame;(void)payload;(void)capacity;(void)generation;return false;}
bool sb_wifi_take_session_start(void){if(s_wifi_started)return false;s_wifi_started=true;return true;}
bool sb_wifi_take_session_end(void){return false;}
uint8_t sb_ui_get_page(void){return 0u;}
bool sb_ui_set_page(uint8_t page){(void)page;return true;}
bool sb_supervisor_critical_healthy(void){return true;}
void sb_gnss_get_snapshot(sb_gnss_fix_t *fix,sb_gnss_state_t *state,uint64_t *rx,uint64_t *last_fix)
{if(fix)memset(fix,0,sizeof(*fix));if(state)*state=SB_GNSS_RUNNING;if(rx)*rx=s_now_us;if(last_fix)*last_fix=s_now_us;}
void sb_gnss_request_restart(void){}
void sb_gnss_note_live_stream_drop(void){}
uint32_t sb_fix_to_sp(sb_gnss_fix_type_t type){return (uint32_t)type;}
void sb_diag_snapshot(sb_diag_snapshot_t *out){memset(out,0,sizeof(*out));}
size_t sb_diag_get_errors(uint32_t after,bool has_after,size_t limit,sb_error_record_t *out,
                          uint32_t *oldest,uint32_t *newest)
{(void)after;(void)has_after;(void)limit;(void)out;*oldest=*newest=0u;return 0u;}
void sb_diag_clear_errors(void){}
void esp_restart(void){assert(false);}
esp_reset_reason_t esp_reset_reason(void){return ESP_RST_POWERON;}

static void foreground_step(void (*entry)(void *))
{
    TaskHandle_t saved=s_current_handle;s_current_handle=&s_caller_handle;
    s_running_foreground=true;
    if(setjmp(s_foreground_yield)==0)entry(NULL);
    s_running_foreground=false;s_current_handle=saved;
}

static void verify_generation_handoff(sb_source_t source,uint32_t first_request)
{
    sb_control_tx_candidate_t candidate;sb_sp_frame_t frame;uint8_t payload[SB_SP_MAX_RX_PAYLOAD];
    uint32_t g=sb_control_session_generation(source);
    uint8_t hello[]={0xA1u,0u,0x19u,0x01u,0u};
    sb_sp_frame_t request={.major=1u,.minor=0u,.type=SB_SP_REQUEST,.service_id=1u,.message_id=1u,
        .request_id=first_request-1u,.sequence=0u,.payload=hello,.payload_length=sizeof(hello)};
    assert(sb_control_submit_for_generation(source,g,&request));foreground_step(s_control_entry);
    g=sb_control_session_generation(source);
    assert(sb_control_peek_tx_for_generation(source,&candidate));
    frame=candidate.frame;memcpy(payload,candidate.payload,frame.payload_length);frame.payload=payload;
    assert(frame.type==SB_SP_RESPONSE&&candidate.generation==g);
    bool queued=source==SB_SOURCE_BLE?
        (sb_ble_set_session_generation(g),sb_ble_queue_tx(&frame,g)):
        (sb_wifi_set_session_generation(g),sb_wifi_queue_tx(&frame,g));
    assert(queued);
    request.request_id=first_request;
    assert(sb_control_submit_for_generation(source,g,&request));foreground_step(s_control_entry);
    uint32_t g1=sb_control_session_generation(source);assert(g1!=g);
    assert(!sb_control_commit_peeked_tx(source,&candidate));

    assert(sb_control_peek_tx_for_generation(source,&candidate));
    frame=candidate.frame;memcpy(payload,candidate.payload,frame.payload_length);frame.payload=payload;
    assert(frame.request_id==first_request&&frame.sequence==0u&&candidate.generation==g1);
    queued=source==SB_SOURCE_BLE?
        (sb_ble_set_session_generation(g1),sb_ble_queue_tx(&frame,g1)):
        (sb_wifi_set_session_generation(g1),sb_wifi_queue_tx(&frame,g1));
    assert(queued);
    request.request_id=first_request+1u;
    assert(sb_control_submit_for_generation(source,g1,&request));foreground_step(s_control_entry);
    uint32_t g2=sb_control_session_generation(source);assert(g2!=g1);
    assert(!sb_control_commit_peeked_tx(source,&candidate));

    if(source==SB_SOURCE_BLE)sb_ble_set_session_generation(g2);else sb_wifi_set_session_generation(g2);
    assert(sb_control_peek_tx_for_generation(source,&candidate));
    frame=candidate.frame;memcpy(payload,candidate.payload,frame.payload_length);frame.payload=payload;
    assert(frame.request_id==first_request+1u&&frame.sequence==0u&&candidate.generation==g2);
    queued=source==SB_SOURCE_BLE?sb_ble_queue_tx(&frame,g2):sb_wifi_queue_tx(&frame,g2);
    assert(queued&&sb_control_commit_peeked_tx(source,&candidate));
}

int main(void)
{
    sb_test_ble_adapter_init();sb_test_wifi_adapter_init();
    sb_test_ble_notify_mode(1u);sb_test_wifi_send_mode(1u);
    assert(sb_storage_start()==ESP_OK);s_state=SB_STORAGE_READY;
    assert(sb_recorder_start()==ESP_OK&&sb_transfer_start()==ESP_OK);
    assert(sb_control_start()==ESP_OK&&sb_transport_start()==ESP_OK);
    recorder_step();storage_step();recorder_step();
    assert(recorder_state==SB_RECORDER_RECORDING);
    unsigned sync_before=s_sync_count;
    foreground_step(s_transport_entry);
    assert(s_ble_started&&s_wifi_started);
    uint8_t hello_payload[]={0xA1u,0u,0x19u,0x01u,0u};
    for(unsigned source=SB_SOURCE_USB;source<=SB_SOURCE_WIFI;++source){
        uint32_t generation=sb_control_session_generation((sb_source_t)source);
        assert(generation!=0u);
        sb_sp_frame_t hello={.major=1u,.minor=0u,.type=SB_SP_REQUEST,.service_id=1u,
            .message_id=1u,.request_id=1u,.sequence=0u,.payload=hello_payload,
            .payload_length=sizeof(hello_payload)};
        assert(sb_control_submit_for_generation((sb_source_t)source,generation,&hello));
        foreground_step(s_control_entry);
    }
    /* Control P5 has advanced the logical generation while Transport P4 still
     * owns the older adapter generation. Its next production poll must hand
     * off adapter state before dequeuing the new HELLO terminal. */
    sb_test_ble_notify_mode(0u);sb_test_wifi_send_mode(0u);
    unsigned ble_hello_before=sb_test_ble_terminal_sent(),wifi_hello_before=sb_test_wifi_terminal_sent();
    for(unsigned i=0;i<8u;++i)foreground_step(s_transport_entry);
    uint32_t ble_generation=sb_control_session_generation(SB_SOURCE_BLE);
    uint32_t wifi_generation=sb_control_session_generation(SB_SOURCE_WIFI);
    assert(sb_test_ble_terminal_sent()==ble_hello_before+1u&&
           sb_test_ble_last_terminal_generation()==ble_generation&&
           sb_test_ble_last_terminal_request()==1u&&sb_test_ble_last_terminal_sequence()==0u);
    assert(sb_test_wifi_terminal_sent()==wifi_hello_before+1u&&
           sb_test_wifi_last_terminal_generation()==wifi_generation&&
           sb_test_wifi_last_terminal_request()==1u&&sb_test_wifi_last_terminal_sequence()==1u);
    /* A same-physical-link logical HELLO reset gets sequence zero; adapter
     * generation handoff precedes exactly-once terminal delivery. */
    for(unsigned source=SB_SOURCE_BLE;source<=SB_SOURCE_WIFI;++source){
        uint32_t old_generation=sb_control_session_generation((sb_source_t)source);
        sb_sp_frame_t hello={.major=1u,.minor=0u,.type=SB_SP_REQUEST,.service_id=1u,
            .message_id=1u,.request_id=2u,.sequence=0u,.payload=hello_payload,
            .payload_length=sizeof(hello_payload)};
        assert(sb_control_submit_for_generation((sb_source_t)source,old_generation,&hello));
        foreground_step(s_control_entry);
        uint32_t next_generation=sb_control_session_generation((sb_source_t)source);
        assert(next_generation!=old_generation);
        unsigned sent_before=source==SB_SOURCE_BLE?sb_test_ble_terminal_sent():sb_test_wifi_terminal_sent();
        for(unsigned i=0;i<8u;++i)foreground_step(s_transport_entry);
        if(source==SB_SOURCE_BLE)assert(sb_test_ble_terminal_sent()==sent_before+1u&&
            sb_test_ble_last_terminal_generation()==next_generation&&sb_test_ble_last_terminal_sequence()==0u);
        else assert(sb_test_wifi_terminal_sent()==sent_before+1u&&
            sb_test_wifi_last_terminal_generation()==next_generation&&sb_test_wifi_last_terminal_sequence()==0u);
    }
    /* P4 adapter acceptance is generation-specific and Control keeps queue
     * ownership until commit. Exercise G→G+1→G+2 before the old candidate's
     * ownership transfer for both radio/socket adapters. */
    verify_generation_handoff(SB_SOURCE_BLE,811u);
    verify_generation_handoff(SB_SOURCE_WIFI,821u);
    sb_test_ble_notify_mode(1u);sb_test_wifi_send_mode(1u);
    uint32_t generation=sb_control_session_generation(SB_SOURCE_USB);
    for(unsigned source=SB_SOURCE_USB;source<=SB_SOURCE_WIFI;++source){
        response_t terminal={.source=(sb_source_t)source,
            .generation=sb_control_session_generation((sb_source_t)source),
            .frame={.major=1u,.type=SB_SP_RESPONSE,.request_id=100u+source}};
        assert(tx_enqueue(&terminal));
        response_t event={.source=(sb_source_t)source,.generation=terminal.generation,
            .frame={.major=1u,.type=SB_SP_EVENT,.service_id=4u}};
        (void)tx_enqueue(&event);
        response_t live={.source=(sb_source_t)source,.generation=terminal.generation,
            .frame={.major=1u,.type=SB_SP_STREAM,.service_id=3u}};
        for(unsigned flood=0;flood<32u;++flood)(void)tx_enqueue(&live);
    }
    response_t bulk={.source=SB_SOURCE_WIFI,
        .generation=sb_control_session_generation(SB_SOURCE_WIFI),
        .frame={.major=1u,.type=SB_SP_BULK,.request_id=400u,.storage_epoch=1u}};
    assert(tx_enqueue(&bulk)&&s_bulk_busy);
    unsigned sync_at_ewouldblock=0u,sync_at_zero=0u,sync_at_partial=0u;
    for(unsigned i=0;i<40u;++i){
        if(i==12u){sync_at_ewouldblock=s_sync_count;sb_test_wifi_send_mode(2u);}
        if(i==20u){sync_at_zero=s_sync_count;sb_test_wifi_send_mode(4u);}
        if(i==26u)sb_test_ble_notify_mode(0u);
        foreground_step(s_control_entry);
        foreground_step(s_transport_entry);
        push_fix(UINT64_C(2000000)+(uint64_t)i*UINT64_C(1000000),i,(i&1u)==0u);
        recorder_step();
        if(uxQueueMessagesWaiting(s_req_q)!=0u)storage_step();
        recorder_step();
        if(i==39u)sync_at_partial=s_sync_count;
    }
    while(uxQueueMessagesWaiting(s_req_q)!=0u){storage_step();recorder_step();}
    assert(s_critical_serviced>=3u&&s_recorder_committed>=2u);
    assert(s_sync_count-sync_before>=4u); /* Two durable LDC commits, two flushes each. */
    assert(s_readable_size>SB_LDC_DATA_OFFSET&&s_usb_write_calls>0u);
    assert(s_recorder_consumed==40u);
    assert(s_record_fd>=0&&s_fds[s_record_fd].open);
    assert(s_readable_size==s_files[s_fds[s_record_fd].file].length);
    assert(memcmp(s_files[s_fds[s_record_fd].file].bytes+s_readable_size-4u,"LDCM",4u)==0);
    assert(writing_buffers()==0u);
    assert(sb_test_ble_notify_failures()>0u&&sb_test_ble_notify_successes()>0u);
    assert(sb_test_wifi_wouldblock_calls()>0u&&sb_test_wifi_zero_calls()>0u&&sb_test_wifi_partial_calls()>0u);
    assert(sync_at_ewouldblock>sync_before&&sync_at_zero>sync_at_ewouldblock&&sync_at_partial>sync_at_zero);
    assert(sb_control_session_generation(SB_SOURCE_USB)==generation);
    unsigned ble_attempts=sb_test_ble_notify_calls(),tcp_attempts=sb_test_wifi_send_calls();
    size_t sent_before=sb_test_wifi_sent_length();sb_test_wifi_send_mode(2u);
    for(unsigned i=0;i<4u;++i)foreground_step(s_transport_entry);
    assert(sb_test_wifi_send_calls()>=tcp_attempts+4u&&sb_test_wifi_sent_length()==sent_before);
    sb_test_ble_notify_mode(0u);sb_test_wifi_send_mode(4u); /* notify recovers; TCP sends 3 bytes per turn */
    for(unsigned i=0;i<160u;++i)foreground_step(s_transport_entry);
    assert(sb_test_ble_notify_successes()>0u&&sb_test_ble_notify_calls()>=ble_attempts);
    assert(sb_test_wifi_send_calls()>tcp_attempts+1u&&sb_test_wifi_sent_length()>0u);
    assert(!sb_test_ble_active()&&!sb_test_wifi_active());
    assert(sb_test_ble_terminal_sent()>0u&&sb_test_wifi_terminal_sent()>0u);
    assert(sb_test_wifi_bulk_sent()>0u);
    assert(!s_bulk_busy); /* queued BULK received service after terminal work */
    assert(sb_control_session_generation(SB_SOURCE_BLE)!=0u&&
           sb_control_session_generation(SB_SOURCE_WIFI)!=0u);
    sb_sp_frame_t during_disconnect={.major=1u,.type=SB_SP_RESPONSE,.request_id=901u};
    sb_test_ble_notify_mode(1u);sb_test_wifi_send_mode(1u);
    assert(sb_ble_queue_tx(&during_disconnect,sb_control_session_generation(SB_SOURCE_BLE)));
    assert(sb_wifi_queue_tx(&during_disconnect,sb_control_session_generation(SB_SOURCE_WIFI)));
    foreground_step(s_transport_entry);
    assert(sb_test_ble_active()&&sb_test_wifi_active());
    sb_test_ble_disconnect();sb_test_wifi_disconnect();
    assert(!sb_test_ble_active()&&!sb_test_wifi_active());
    sb_control_disconnect(SB_SOURCE_BLE);sb_control_disconnect(SB_SOURCE_WIFI);
    sb_ble_set_session_generation(sb_control_session_generation(SB_SOURCE_BLE));
    sb_wifi_set_session_generation(sb_control_session_generation(SB_SOURCE_WIFI));
    /* The extracted production notify path must not hold a terminal frame
     * forever when notifications, mbufs, or the stack remain unavailable. */
    sb_test_ble_reconnect();sb_test_ble_notify_mode(0u);sb_test_ble_notify_enabled(false);
    sb_ble_set_session_generation(sb_control_session_generation(SB_SOURCE_BLE));
    s_now_us=UINT64_C(100000000);
    assert(sb_ble_queue_tx(&during_disconnect,sb_control_session_generation(SB_SOURCE_BLE)));
    sb_ble_transport_poll();assert(sb_test_ble_active()&&!sb_test_ble_session_ended());
    s_now_us+=UINT64_C(4999999);sb_ble_transport_poll();
    assert(sb_test_ble_active()&&!sb_test_ble_session_ended());
    s_now_us+=2u;sb_ble_transport_poll();
    assert(!sb_test_ble_active()&&sb_test_ble_session_ended());
    sb_test_ble_reconnect();sb_ble_set_session_generation(sb_control_session_generation(SB_SOURCE_BLE));
    sb_test_ble_notify_enabled(true);sb_test_ble_mbuf_available(false);
    s_now_us+=UINT64_C(10000000);
    assert(sb_test_ble_session_generation()==sb_control_session_generation(SB_SOURCE_BLE));
    assert(sb_ble_queue_tx(&during_disconnect,sb_control_session_generation(SB_SOURCE_BLE)));
    sb_ble_transport_poll();assert(sb_test_ble_active());
    s_now_us+=UINT64_C(5000000);sb_ble_transport_poll();
    assert(!sb_test_ble_active()&&sb_test_ble_session_ended());
    sb_test_ble_reconnect();sb_ble_set_session_generation(sb_control_session_generation(SB_SOURCE_BLE));
    sb_test_ble_mbuf_available(true);sb_test_ble_notify_mode(1u);
    s_now_us+=UINT64_C(10000000);
    assert(sb_ble_queue_tx(&during_disconnect,sb_control_session_generation(SB_SOURCE_BLE)));
    sb_ble_transport_poll();assert(sb_test_ble_active());
    s_now_us+=UINT64_C(1000);sb_test_ble_notify_mode(0u);
    for(unsigned i=0;i<10u&&sb_test_ble_active();++i)sb_ble_transport_poll();
    assert(!sb_test_ble_active()&&!sb_test_ble_session_ended());

    /* Publication completion and abort race through the production Storage
     * mux. A stale release token cannot release a newer claim. */
    uint32_t publication_epoch=sb_storage_epoch_generation();
    sb_test_wifi_reconnect();
    uint64_t publication_claim=0u;
    assert(sb_storage_claim_bulk_publication(publication_epoch,&publication_claim));
    assert(publication_claim!=0u&&sb_storage_finish_bulk_publication(publication_epoch,publication_claim));
    uint64_t invalidated_publication_claim=0u;
    assert(sb_storage_claim_bulk_publication(publication_epoch,&invalidated_publication_claim));
    abort_epoch();
    assert(!sb_storage_finish_bulk_publication(publication_epoch,invalidated_publication_claim));
    publication_epoch=sb_storage_epoch_generation();
    uint64_t winning_publication_claim=0u;
    assert(sb_storage_claim_bulk_publication(publication_epoch,&winning_publication_claim));
    sb_storage_release_bulk_publication(publication_epoch,invalidated_publication_claim);
    assert(sb_storage_finish_bulk_publication(publication_epoch,winning_publication_claim));
    sb_sp_frame_t epoch_bulk={.major=1u,.type=SB_SP_BULK,.request_id=990u,
        .storage_epoch=publication_epoch};
    uint32_t ble_generation_now=sb_control_session_generation(SB_SOURCE_BLE);
    uint32_t wifi_generation_now=sb_control_session_generation(SB_SOURCE_WIFI);
    sb_ble_set_session_generation(ble_generation_now);
    sb_wifi_set_session_generation(wifi_generation_now);
    /* Keep an old request queued across fast invalidation, then let Control
     * run before Transport performs deferred session cleanup. */
    sb_sp_frame_t old_ble_hello={.major=1u,.minor=0u,.type=SB_SP_REQUEST,.service_id=1u,
        .message_id=1u,.request_id=989u,.sequence=0u,.payload=hello_payload,
        .payload_length=sizeof(hello_payload)};
    assert(sb_control_submit_for_generation(SB_SOURCE_BLE,ble_generation_now,&old_ble_hello));
    sb_test_ble_notify_mode(0u);
    assert(sb_ble_queue_tx(&epoch_bulk,ble_generation_now));
    sb_ble_transport_poll();
    assert(sb_test_ble_active());
    abort_epoch();
    sb_ble_transport_poll();
    assert(sb_test_ble_session_ended()&&sb_test_ble_connected()&&!sb_test_ble_active());
    uint32_t fast_invalidated_generation=sb_control_session_generation(SB_SOURCE_BLE);
    assert(fast_invalidated_generation!=ble_generation_now);
    foreground_step(s_control_entry);
    assert(sb_control_session_generation(SB_SOURCE_BLE)==fast_invalidated_generation);
    uint64_t invalid_claim=0u;
    assert(!sb_storage_claim_bulk_publication(publication_epoch,&invalid_claim));
    uint32_t new_publication_epoch=sb_storage_epoch_generation();
    uint64_t new_claim=0u;
    assert(new_publication_epoch!=publication_epoch&&sb_storage_claim_bulk_publication(new_publication_epoch,&new_claim));
    sb_storage_release_bulk_publication(new_publication_epoch,new_claim);
    /* BLE atomically rejects successful completion if Storage aborts while a
     * notify call is in flight; the physical link may remain connected. */
    sb_test_ble_reconnect();
    ble_generation_now=sb_control_session_generation(SB_SOURCE_BLE);
    sb_ble_set_session_generation(ble_generation_now);
    epoch_bulk.storage_epoch=new_publication_epoch;
    assert(sb_ble_queue_tx(&epoch_bulk,ble_generation_now));
    unsigned ble_sent_before_race=sb_test_ble_terminal_sent();
    unsigned ble_notify_before_race=sb_test_ble_notify_successes();
    sb_test_ble_notify_mode(0u);sb_test_abort_storage_epoch_on_physical_send();
    sb_ble_transport_poll();
    assert(sb_storage_epoch_generation()!=new_publication_epoch);
    assert(sb_test_ble_session_ended()&&sb_test_ble_connected()&&!sb_test_ble_active());
    uint32_t stale_completion_generation;uint8_t stale_completion_type;uint32_t stale_completion_request;
    assert(sb_test_ble_notify_successes()==ble_notify_before_race+1u&&
           !sb_ble_take_tx_completion(&stale_completion_generation,&stale_completion_type,&stale_completion_request));
    assert(sb_test_ble_terminal_sent()==ble_sent_before_race);
    uint32_t ended_ble_generation=sb_control_session_generation(SB_SOURCE_BLE);
    /* Consume the production BLE session-end event with the actual Transport
     * owner. The failed physical disconnect leaves the link present, but
     * Control closes the old logical session and accepts a fresh HELLO. */
    foreground_step(s_transport_entry);
    assert(sb_test_ble_connected()&&!sb_test_ble_session_ended());
    uint32_t recovery_ble_generation=sb_control_session_generation(SB_SOURCE_BLE);
    assert(recovery_ble_generation==ended_ble_generation); /* no second deferred generation bump */
    foreground_step(s_control_entry); /* apply the queued logical disconnect */
    sb_sp_frame_t recovery_hello={.major=1u,.minor=0u,.type=SB_SP_REQUEST,.service_id=1u,
        .message_id=1u,.request_id=991u,.sequence=0u,.payload=hello_payload,
        .payload_length=sizeof(hello_payload)};
    assert(sb_control_submit_for_generation(SB_SOURCE_BLE,recovery_ble_generation,&recovery_hello));
    foreground_step(s_control_entry);
    unsigned recovery_sent=sb_test_ble_terminal_sent();
    sb_test_ble_notify_mode(0u);
    for(unsigned i=0;i<8u;++i)foreground_step(s_transport_entry);
    assert(sb_test_ble_connected()&&sb_control_session_generation(SB_SOURCE_BLE)==recovery_ble_generation);
    assert(sb_test_ble_terminal_sent()==recovery_sent+1u&&
           sb_test_ble_last_terminal_generation()==recovery_ble_generation&&
           sb_test_ble_last_terminal_request()==991u&&sb_test_ble_last_terminal_sequence()==0u);
    /* Also force abort inside a successful partial TCP syscall. */
    uint32_t tcp_race_epoch=sb_storage_epoch_generation();
    sb_test_wifi_reconnect();wifi_generation_now=sb_control_session_generation(SB_SOURCE_WIFI);
    sb_wifi_set_session_generation(wifi_generation_now);epoch_bulk.storage_epoch=tcp_race_epoch;
    unsigned tcp_bulk_before_race=sb_test_wifi_bulk_sent();
    size_t tcp_wire_before_race=sb_test_wifi_sent_length();
    assert(sb_wifi_queue_tx(&epoch_bulk,wifi_generation_now));
    sb_test_wifi_send_mode(4u);sb_test_abort_storage_epoch_on_physical_send();
    sb_wifi_transport_poll();
    assert(sb_storage_epoch_generation()!=tcp_race_epoch);
    assert(!sb_test_wifi_connected()&&!sb_test_wifi_active());
    assert(sb_test_wifi_sent_length()==tcp_wire_before_race+3u&&
           !sb_wifi_take_tx_completion(&stale_completion_generation,&stale_completion_type,&stale_completion_request));
    assert(sb_test_wifi_bulk_sent()==tcp_bulk_before_race);
    /* USB accepts the complete short frame before the fake Storage abort.
     * Transport must invalidate the logical session and avoid TX success. */
    uint32_t usb_race_epoch=sb_storage_epoch_generation();
    uint32_t usb_race_generation=sb_control_session_generation(SB_SOURCE_USB);
    response_t usb_epoch_bulk={.source=SB_SOURCE_USB,.generation=usb_race_generation,
        .frame={.major=1u,.type=SB_SP_BULK,.request_id=992u,.payload_length=1u,
                .storage_epoch=usb_race_epoch},.payload={0x5Au}};
    assert(tx_enqueue(&usb_epoch_bulk));
    size_t usb_bytes_before=s_usb_wire_bytes;
    s_usb_physical_send_enabled=true;sb_test_abort_storage_epoch_on_physical_send();
    foreground_step(s_transport_entry);
    s_usb_physical_send_enabled=false;
    assert(sb_storage_epoch_generation()!=usb_race_epoch&&s_usb_wire_bytes>usb_bytes_before);
    assert(sb_control_session_generation(SB_SOURCE_USB)!=usb_race_generation);
    foreground_step(s_control_entry);
    assert(!s_bulk_busy);
    puts("PASS production Control+Transport+Recorder+Storage: accepted USB/BLE/TCP bytes followed by Storage epoch abort never report BULK TX success; congestion and durable commits progress");
    return 0;
}
