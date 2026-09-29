#include "sailball/wifi.h"
#include "sailball/transport_quantum.h"
#include "sailball/ble.h"
#include "sailball/board.h"
#include "sailball/diagnostics.h"
#include "sailball/startup_metrics.h"
#include "sailball/storage.h"
#include "esp_wifi_default.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/portmacro.h"
#include "esp_err.h"
#include "esp_event.h"
#include "esp_netif.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "nvs.h"
#include "lwip/inet.h"
#include "lwip/sockets.h"
#include <errno.h>
#include <fcntl.h>
#include <string.h>
#include <sys/select.h>

#define WIFI_COMMAND_DEPTH 8u
#define WIFI_EVENT_DEPTH 12u
#define WIFI_RX_QUEUE_DEPTH 4u
#define WIFI_TX_QUEUE_DEPTH 2u
#define WIFI_RETRY_LIMIT 3u
#define WIFI_RX_QUANTUM 512u
#define WIFI_TX_QUANTUM 512u
#define WIFI_CONNECT_TIMEOUT_US UINT64_C(15000000)
#define WIFI_TCP_TIMEOUT_US UINT64_C(10000000)
#define WIFI_HELLO_TIMEOUT_US UINT64_C(15000000)
#define WIFI_TX_STALL_TIMEOUT_US UINT64_C(5000000)

typedef enum { CMD_SCAN=1, CMD_CONNECT, CMD_DISCONNECT } wifi_command_type_t;
typedef struct {
    wifi_command_type_t type;
    uint8_t address[4];
    uint16_t port;
    uint32_t handover_id;
} wifi_command_t;
typedef enum { EV_SCAN_DONE=1, EV_STA_CONNECTED, EV_STA_DISCONNECTED, EV_GOT_IP, EV_LOST_IP, EV_HELLO } wifi_event_type_t;
typedef struct {
    wifi_event_type_t type;
    int32_t reason;
    uint8_t ipv4[4];
} wifi_event_item_t;
typedef struct { sb_sp_frame_t frame; uint32_t session_generation; uint8_t payload[SB_SP_MAX_RX_PAYLOAD]; } wifi_frame_item_t;
typedef struct { uint32_t generation; } tcp_rx_context_t;
typedef struct {
    uint32_t magic;
    uint8_t ssid_length, password_length;
    uint8_t ssid[SB_WIFI_SSID_MAX], password[64];
} wifi_profile_t;

static StaticQueue_t s_command_queue_struct, s_event_queue_struct, s_rx_queue_struct, s_tx_queue_struct;
static uint8_t s_command_queue_storage[WIFI_COMMAND_DEPTH * sizeof(wifi_command_t)];
static uint8_t s_event_queue_storage[WIFI_EVENT_DEPTH * sizeof(wifi_event_item_t)];
static uint8_t s_rx_queue_storage[WIFI_RX_QUEUE_DEPTH * sizeof(wifi_frame_item_t)];
static uint8_t s_tx_queue_storage[WIFI_TX_QUEUE_DEPTH * sizeof(wifi_frame_item_t)];
static QueueHandle_t s_command_queue, s_event_queue, s_rx_queue, s_tx_queue;
static portMUX_TYPE s_mux = portMUX_INITIALIZER_UNLOCKED;
static sb_wifi_snapshot_t s_snapshot = { .state=SB_WIFI_OFF };
static wifi_profile_t s_profile;
static bool s_started, s_wifi_started, s_ap_connected, s_operation_reserved, s_disconnect_queued, s_initializing;
/* Heavy framework resources are owned/initialized by Transport on first use.
 * A failed first attempt is latched for this boot; no init retry storm. */
static bool s_driver_ready, s_driver_init_attempted, s_wireless_unavailable;
static bool s_user_disconnect, s_scan_active, s_session_started, s_session_end_pending,s_session_start_pending;
static bool s_tcp_connect_started, s_rx_pending_overflow, s_recovering_from_ap_loss;
static bool s_peer_fin_pending;
static uint32_t s_tcp_connection_generation,s_fin_connection_generation;
static wifi_command_t s_reserved_connect;
static esp_netif_t *s_netif;
static sb_wifi_ap_t s_ap_cache[SB_WIFI_AP_CACHE_MAX];
static size_t s_ap_count;
static uint32_t s_scan_generation, s_handover_id;
static uint8_t s_endpoint[4];
static uint16_t s_endpoint_port;
static uint32_t s_session_generation;
static uint8_t s_retry_count;
static TickType_t s_retry_at;
static uint64_t s_stage_started_us;
static int s_socket = -1;
static esp_err_t wifi_ensure_driver(void);
static uint8_t s_tcp_rx_quantum[WIFI_RX_QUANTUM];
static uint8_t s_tx_buffer[SB_SP_MAX_FRAME + 16u];
static sb_sp_cobs_stream_t s_rx_stream;
static size_t s_tx_length, s_tx_offset;
static bool s_tx_active, s_tx_bootstrap,s_tx_resync_pending,s_tx_completion_pending;
static bool s_tx_bulk_publication_claimed;
static uint64_t s_tx_bulk_publication_claim_id;
static uint64_t s_tx_started_us;
static uint32_t s_tx_completed_generation,s_tx_completed_request_id;
static uint8_t s_tx_completed_type;
static wifi_frame_item_t s_tx_item;

static void release_bulk_publication(void)
{
    if(s_tx_bulk_publication_claimed)sb_storage_release_bulk_publication(s_tx_item.frame.storage_epoch,s_tx_bulk_publication_claim_id);
    s_tx_bulk_publication_claimed=false;
    s_tx_bulk_publication_claim_id=0u;
}

/* Publish all initialized queue/driver state before Transport may use it. */
static bool wifi_started(void)
{
    portENTER_CRITICAL(&s_mux);bool ready=s_started;portEXIT_CRITICAL(&s_mux);return ready;
}

static void wifi_set_state(sb_wifi_state_t state)
{
    portENTER_CRITICAL(&s_mux); s_snapshot.state=state; portEXIT_CRITICAL(&s_mux);
    sb_ble_wifi_online(state==SB_WIFI_ONLINE);
}

static void wifi_set_error(uint8_t reason)
{
    portENTER_CRITICAL(&s_mux); s_snapshot.last_error=reason; s_snapshot.last_error_valid=true; portEXIT_CRITICAL(&s_mux);
}

static void wifi_event_handler(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    (void)arg;
    wifi_event_item_t event={0}; bool deliver=false;
    if (base==WIFI_EVENT && id==WIFI_EVENT_SCAN_DONE) { event.type=EV_SCAN_DONE; deliver=true; }
    else if (base==WIFI_EVENT && id==WIFI_EVENT_STA_CONNECTED) { event.type=EV_STA_CONNECTED; deliver=true; }
    else if (base==WIFI_EVENT && id==WIFI_EVENT_STA_DISCONNECTED) {
        event.type=EV_STA_DISCONNECTED; event.reason=((wifi_event_sta_disconnected_t *)data)->reason; deliver=true;
    } else if (base==IP_EVENT && id==IP_EVENT_STA_GOT_IP) {
        event.type=EV_GOT_IP; esp_netif_ip_info_t *info=&((ip_event_got_ip_t *)data)->ip_info;
        memcpy(event.ipv4,&info->ip.addr,sizeof(event.ipv4)); deliver=true;
    } else if (base==IP_EVENT && id==IP_EVENT_STA_LOST_IP) { event.type=EV_LOST_IP; deliver=true; }
    if (deliver && s_event_queue!=NULL && xQueueSend(s_event_queue,&event,0)!=pdTRUE) {
        portENTER_CRITICAL(&s_mux); s_rx_pending_overflow=true; portEXIT_CRITICAL(&s_mux);
    }
}

static uint8_t wifi_reason_from_driver(int32_t reason)
{
    switch (reason) {
    case WIFI_REASON_NO_AP_FOUND: return 1;
    case WIFI_REASON_AUTH_FAIL:
    case WIFI_REASON_AUTH_EXPIRE:
    case WIFI_REASON_4WAY_HANDSHAKE_TIMEOUT:
    case WIFI_REASON_HANDSHAKE_TIMEOUT: return 2;
    default: return 6;
    }
}

static uint8_t security_from_auth(wifi_auth_mode_t mode)
{
    switch (mode) {
    case WIFI_AUTH_OPEN: return 0;
    case WIFI_AUTH_WPA_PSK: return 1;
    case WIFI_AUTH_WPA2_PSK: return 2;
#ifdef WIFI_AUTH_WPA3_PSK
    case WIFI_AUTH_WPA3_PSK: return 3;
#endif
    case WIFI_AUTH_WPA_WPA2_PSK: return 4;
#if defined(WIFI_AUTH_WPA2_WPA3_PSK)
    case WIFI_AUTH_WPA2_WPA3_PSK: return 5;
#endif
    default: return 255;
    }
}

static void close_socket(void)
{
    if (s_socket>=0) { shutdown(s_socket,SHUT_RDWR); close(s_socket); s_socket=-1; ++s_tcp_connection_generation; }
    s_peer_fin_pending=false;
    s_tcp_connect_started=false; sb_sp_cobs_stream_reset(&s_rx_stream); s_tx_active=false;s_tx_resync_pending=false;release_bulk_publication();s_tx_length=s_tx_offset=0;
}

static void clear_frame_queues(void)
{
    if (s_rx_queue) (void)xQueueReset(s_rx_queue);
    if (s_tx_queue) (void)xQueueReset(s_tx_queue);
}

static void mark_session_ended(void)
{
    if (s_session_started) {
        s_session_end_pending=true;
        s_session_started=false;
    }
    clear_frame_queues();
}

static void stop_wifi(void)
{
    close_socket(); mark_session_ended();
    if (s_wifi_started) {
        (void)esp_wifi_disconnect();
        (void)esp_wifi_stop();
        s_wifi_started=false;
    }
    s_ap_connected=false; s_user_disconnect=false; s_scan_active=false;
    portENTER_CRITICAL(&s_mux); s_snapshot.rssi_valid=false; s_snapshot.ipv4_valid=false; portEXIT_CRITICAL(&s_mux);
    wifi_set_state(SB_WIFI_OFF);
}

static bool start_wifi_impl(void)
{
    if (s_wifi_started) return true;
    if (s_wireless_unavailable) {wifi_set_state(SB_WIFI_ERROR);return false;}
    if (wifi_ensure_driver()!=ESP_OK) return false;
    sb_wireless_admission_t admission=sb_wireless_admit(SB_WIRELESS_WIFI_START);
    sb_validation_note_admission(SB_WIRELESS_WIFI_START,&admission);
    if (admission.decision!=SB_ADMISSION_ALLOW) {
        s_wireless_unavailable=true;wifi_set_state(SB_WIFI_ERROR);
        sb_startup_note_resource_failure(SB_WIRELESS_WIFI_START);
        sb_validation_note_admission_after(SB_WIRELESS_WIFI_START);
        return false;
    }
    esp_err_t err=esp_wifi_set_mode(WIFI_MODE_STA);
    if (err==ESP_OK) err=esp_wifi_start();
    admission.after=sb_wireless_measure_heap();admission.after_observed=1;
    sb_validation_note_admission(SB_WIRELESS_WIFI_START,&admission);
    if (err!=ESP_OK) {
        s_wireless_unavailable=true;wifi_set_state(SB_WIFI_ERROR);
        sb_startup_note_failure(6,err);return false;
    }
    s_wifi_started=true;
    return true;
}

static bool start_wifi(void)
{
    if(s_wifi_started)return true;
    /* Cold ESP-NETIF/lwIP/driver init is synchronous in the Transport owner.
     * During this interval BLE callbacks may fill the bounded four-fragment
     * handoff; an overflow is rejected by ATT and invalidates that assembly
     * before Transport resumes RX service. The snapshot ABI stays unchanged. */
    portENTER_CRITICAL(&s_mux);s_initializing=true;portEXIT_CRITICAL(&s_mux);
    bool started=start_wifi_impl();
    portENTER_CRITICAL(&s_mux);s_initializing=false;portEXIT_CRITICAL(&s_mux);
    return started;
}

static bool send_transport_ready(void)
{
    uint8_t payload[64]; size_t n=0;
    sb_board_info_t board; sb_board_get_info(&board);
    uint8_t device_id[8]; sb_write_le64(device_id,board.device_id);
    if (!sb_cbor_put_map(payload,sizeof(payload),&n,6) ||
        !sb_cbor_put_uint(payload,sizeof(payload),&n,0) || !sb_cbor_put_bytes(payload,sizeof(payload),&n,device_id,sizeof(device_id)) ||
        !sb_cbor_put_uint(payload,sizeof(payload),&n,1) || !sb_cbor_put_uint(payload,sizeof(payload),&n,board.boot_id) ||
        !sb_cbor_put_uint(payload,sizeof(payload),&n,2) || !sb_cbor_put_uint(payload,sizeof(payload),&n,2) ||
        !sb_cbor_put_uint(payload,sizeof(payload),&n,3) || !sb_cbor_put_uint(payload,sizeof(payload),&n,1) ||
        !sb_cbor_put_uint(payload,sizeof(payload),&n,4) || !sb_cbor_put_uint(payload,sizeof(payload),&n,0) ||
        !sb_cbor_put_uint(payload,sizeof(payload),&n,5) || !sb_cbor_put_uint(payload,sizeof(payload),&n,s_handover_id)) return false;
    sb_sp_frame_t frame={.major=1,.minor=0,.type=SB_SP_EVENT,.service_id=1,.message_id=1,.request_id=0,.sequence=0,.payload_length=(uint32_t)n,.payload=payload};
    if (!sb_sp_cobs_encode_delimited(&frame,s_tx_buffer,sizeof(s_tx_buffer),&s_tx_length)) return false;
    s_tx_offset=0; s_tx_active=true; s_tx_bootstrap=true;
    s_tx_started_us=(uint64_t)esp_timer_get_time();
    s_session_started=true;s_session_start_pending=true;
    s_stage_started_us=(uint64_t)esp_timer_get_time();
    wifi_set_state(SB_WIFI_SP_HANDSHAKE);
    return true;
}

static bool begin_tcp_connect(void)
{
    close_socket();
    s_socket=socket(AF_INET,SOCK_STREAM,IPPROTO_IP);
    if (s_socket<0) return false;
    ++s_tcp_connection_generation;
    int flags=fcntl(s_socket,F_GETFL,0);
    if (flags<0 || fcntl(s_socket,F_SETFL,flags|O_NONBLOCK)<0) { close_socket(); return false; }
    struct sockaddr_in address={0}; address.sin_family=AF_INET; address.sin_port=htons(s_endpoint_port);
    memcpy(&address.sin_addr.s_addr,s_endpoint,sizeof(s_endpoint));
    int rc=connect(s_socket,(struct sockaddr *)&address,sizeof(address));
    if (rc==0) {
        wifi_set_state(SB_WIFI_SP_HANDSHAKE); s_stage_started_us=(uint64_t)esp_timer_get_time();
        if (!send_transport_ready()) return false;
    } else if (errno==EINPROGRESS || errno==EWOULDBLOCK) {
        s_tcp_connect_started=true; s_stage_started_us=(uint64_t)esp_timer_get_time(); wifi_set_state(SB_WIFI_TCP_CONNECTING);
    } else { close_socket(); return false; }
    return true;
}

static void fail_or_recover(uint8_t reason)
{
    wifi_set_error(reason); close_socket(); mark_session_ended();
    if (!s_user_disconnect && s_retry_count<WIFI_RETRY_LIMIT && s_profile.magic==UINT32_C(0x53425746)) {
        ++s_retry_count; s_recovering_from_ap_loss=!s_ap_connected;
        s_retry_at=xTaskGetTickCount()+pdMS_TO_TICKS(500u << (s_retry_count-1u));
        s_stage_started_us=(uint64_t)esp_timer_get_time(); wifi_set_state(SB_WIFI_RECOVERING);
    } else {
        stop_wifi(); wifi_set_error(reason); wifi_set_state(SB_WIFI_ERROR);
    }
}

static void finish_user_disconnect(void)
{
    stop_wifi(); wifi_set_state(SB_WIFI_OFF);
}

static void start_scan(void)
{
    if (!start_wifi()) { wifi_set_error(0); wifi_set_state(SB_WIFI_ERROR); return; }
    wifi_scan_config_t config={0};
    if (esp_wifi_scan_start(&config,false)!=ESP_OK) { stop_wifi(); wifi_set_state(SB_WIFI_OFF); return; }
    s_scan_active=true; wifi_set_state(SB_WIFI_SCANNING);
}

static void complete_scan(void)
{
    wifi_ap_record_t driver_records[SB_WIFI_AP_CACHE_MAX];
    sb_wifi_ap_t new_cache[SB_WIFI_AP_CACHE_MAX];
    uint16_t count=SB_WIFI_AP_CACHE_MAX;
    if (esp_wifi_scan_get_ap_records(&count,driver_records)==ESP_OK) {
        for (uint16_t i=0;i<count;++i) {
            sb_wifi_ap_t *ap=&new_cache[i]; memset(ap,0,sizeof(*ap));
            size_t len=strnlen((const char *)driver_records[i].ssid,sizeof(driver_records[i].ssid));
            if (len>SB_WIFI_SSID_MAX) len=SB_WIFI_SSID_MAX;
            memcpy(ap->ssid,driver_records[i].ssid,len); ap->ssid_length=(uint8_t)len;
            ap->rssi=driver_records[i].rssi; ap->security=security_from_auth(driver_records[i].authmode);
            ap->channel=driver_records[i].primary; memcpy(ap->bssid,driver_records[i].bssid,sizeof(ap->bssid));
        }
    } else count=0;
    portENTER_CRITICAL(&s_mux);
    if (count) memcpy(s_ap_cache,new_cache,(size_t)count*sizeof(s_ap_cache[0]));
    s_ap_count=count; ++s_scan_generation; s_snapshot.scan_generation=s_scan_generation;
    portEXIT_CRITICAL(&s_mux);
    s_scan_active=false; (void)esp_wifi_stop(); s_wifi_started=false; wifi_set_state(SB_WIFI_OFF);
}

static void process_event(const wifi_event_item_t *event)
{
    if (event->type==EV_SCAN_DONE) { if (s_scan_active) complete_scan(); return; }
    if (event->type==EV_STA_CONNECTED) { s_ap_connected=true; return; }
    if (event->type==EV_GOT_IP) {
        s_ap_connected=true;
        portENTER_CRITICAL(&s_mux); memcpy(s_snapshot.ipv4,event->ipv4,4); s_snapshot.ipv4_valid=true; s_snapshot.last_error_valid=false; portEXIT_CRITICAL(&s_mux);
        if (s_snapshot.state==SB_WIFI_AP_CONNECTING || s_snapshot.state==SB_WIFI_RECOVERING) {
        s_stage_started_us=(uint64_t)esp_timer_get_time(); wifi_set_state(SB_WIFI_IP_READY);
        }
        return;
    }
    if (event->type==EV_HELLO) { if (sb_wifi_get_state()==SB_WIFI_SP_HANDSHAKE) { s_retry_count=0; wifi_set_state(SB_WIFI_ONLINE); } return; }
    if (event->type==EV_LOST_IP) { s_ap_connected=false; if (!s_user_disconnect) fail_or_recover(6); return; }
    if (event->type==EV_STA_DISCONNECTED) {
        s_ap_connected=false;
        if (s_scan_active) return;
        if (s_user_disconnect) { finish_user_disconnect(); return; }
        uint8_t reason=wifi_reason_from_driver(event->reason);
        if (s_snapshot.state==SB_WIFI_AP_CONNECTING) fail_or_recover(reason);
        else if (s_snapshot.state!=SB_WIFI_OFF && s_snapshot.state!=SB_WIFI_ERROR) fail_or_recover(6);
    }
}

static void process_commands(void)
{
    wifi_command_t command;
    while (xQueueReceive(s_command_queue,&command,0)==pdTRUE) {
        portENTER_CRITICAL(&s_mux); s_operation_reserved=false; s_disconnect_queued=false; portEXIT_CRITICAL(&s_mux);
        if (command.type==CMD_SCAN) { if (s_snapshot.state==SB_WIFI_OFF) start_scan(); continue; }
        if (command.type==CMD_DISCONNECT) { s_user_disconnect=true; finish_user_disconnect(); continue; }
        if (command.type==CMD_CONNECT) {
            portENTER_CRITICAL(&s_mux); memcpy(s_endpoint,command.address,4); s_endpoint_port=command.port; s_handover_id=command.handover_id; portEXIT_CRITICAL(&s_mux);
            s_retry_count=0; s_user_disconnect=false; s_ap_connected=false; s_session_started=false;
            portENTER_CRITICAL(&s_mux); s_snapshot.rssi_valid=false; s_snapshot.ipv4_valid=false; s_snapshot.last_error_valid=false; portEXIT_CRITICAL(&s_mux);
            if (!start_wifi()) { wifi_set_error(0); wifi_set_state(SB_WIFI_ERROR); continue; }
            wifi_profile_t profile; portENTER_CRITICAL(&s_mux); profile=s_profile; portEXIT_CRITICAL(&s_mux);
            wifi_config_t config={0};
            memcpy(config.sta.ssid,profile.ssid,profile.ssid_length);
            memcpy(config.sta.password,profile.password,profile.password_length);
            config.sta.threshold.authmode=WIFI_AUTH_OPEN;
            if (esp_wifi_set_config(WIFI_IF_STA,&config)!=ESP_OK || esp_wifi_connect()!=ESP_OK) {
                fail_or_recover(1); continue;
            }
            s_stage_started_us=(uint64_t)esp_timer_get_time(); wifi_set_state(SB_WIFI_AP_CONNECTING);
        }
    }
}

static void send_queued_tcp(void)
{
    if (s_socket<0 || !s_tx_active) {
        if (s_socket<0 || s_tx_queue==NULL || xQueueReceive(s_tx_queue,&s_tx_item,0)!=pdTRUE) return;
        if(s_tx_item.session_generation!=s_session_generation)return;
        sb_sp_frame_t frame=s_tx_item.frame; frame.payload=s_tx_item.payload;
        if (!sb_sp_cobs_encode_delimited(&frame,s_tx_buffer,sizeof(s_tx_buffer),&s_tx_length)) {
            sb_diag_increment(SB_DIAG_TRANSPORT,SB_SOURCE_WIFI*5u+2u); return;
        }
        s_tx_offset=0; s_tx_active=true; s_tx_bootstrap=false;s_tx_bulk_publication_claimed=false;s_tx_started_us=(uint64_t)esp_timer_get_time();
    }
    if(!s_tx_bootstrap&&s_tx_item.session_generation!=s_session_generation){
        if(s_tx_offset!=0u)s_tx_resync_pending=true;
        s_tx_active=false;s_tx_length=s_tx_offset=0;release_bulk_publication();return;
    }
    if(!s_tx_bootstrap&&s_tx_item.frame.type==SB_SP_BULK&&
       s_tx_item.frame.storage_epoch!=sb_storage_epoch_generation()){
        fail_or_recover(6);return;
    }
    if(!s_tx_bootstrap&&s_tx_item.frame.type==SB_SP_BULK&&!s_tx_bulk_publication_claimed){
        if(!sb_storage_claim_bulk_publication(s_tx_item.frame.storage_epoch,&s_tx_bulk_publication_claim_id)){fail_or_recover(6);return;}
        s_tx_bulk_publication_claimed=true;
    }
    if(s_tx_resync_pending){
        const uint8_t delimiter=0;
        int resync=(int)send(s_socket,&delimiter,1u,0);
        if(resync==1)s_tx_resync_pending=false;
        else if(resync<0&&errno!=EAGAIN&&errno!=EWOULDBLOCK&&errno!=EINTR)fail_or_recover(6);
        return;
    }
    size_t quantum=sb_transport_tx_quantum(s_tx_length-s_tx_offset,WIFI_TX_QUANTUM);
    int n=(int)send(s_socket,s_tx_buffer+s_tx_offset,quantum,0);
    if (n>0) {
        s_tx_offset=sb_transport_tx_advance(s_tx_offset,s_tx_length,(size_t)n);
        /* send() can yield while Storage aborts the epoch. A partial or even
         * completed frame accepted across that boundary is not a successful
         * live Transfer continuation; tear down this TCP session. */
        if(!s_tx_bootstrap&&s_tx_item.frame.type==SB_SP_BULK&&
           s_tx_item.frame.storage_epoch!=sb_storage_epoch_generation()){
            fail_or_recover(6);return;
        }
    }
    else if (n<0 && errno!=EAGAIN && errno!=EWOULDBLOCK && errno!=EINTR) { fail_or_recover(6); return; }
    else if((uint64_t)esp_timer_get_time()-s_tx_started_us>WIFI_TX_STALL_TIMEOUT_US){fail_or_recover(6);return;}
    if (s_tx_active && s_tx_offset==s_tx_length) {
        bool bootstrap=s_tx_bootstrap;
        if(!bootstrap&&s_tx_item.frame.type==SB_SP_BULK&&
           !sb_storage_finish_bulk_publication(s_tx_item.frame.storage_epoch,s_tx_bulk_publication_claim_id)){
            fail_or_recover(6);return;
        }
        s_tx_bulk_publication_claimed=false;s_tx_bulk_publication_claim_id=0u;
        s_tx_active=false; s_tx_length=s_tx_offset=0;
        if(!bootstrap){s_tx_completed_generation=s_tx_item.session_generation;s_tx_completed_type=s_tx_item.frame.type;s_tx_completed_request_id=s_tx_item.frame.request_id;s_tx_completion_pending=true;}
        sb_diag_increment(SB_DIAG_TRANSPORT,SB_SOURCE_WIFI*5u+1u);
        if (bootstrap) s_tx_bootstrap=false;
    }
}

static bool queue_tcp_frame(void *context,const sb_sp_frame_t *frame)
{
    sb_diag_increment(SB_DIAG_PROTOCOL,0); sb_diag_increment(SB_DIAG_TRANSPORT,SB_SOURCE_WIFI*5u);
    const tcp_rx_context_t *rx_context=context;
    wifi_frame_item_t item={0}; item.frame=*frame; item.frame.payload=NULL;item.session_generation=rx_context->generation;
    if (frame->payload_length) memcpy(item.payload,frame->payload,frame->payload_length);
    if (xQueueSend(s_rx_queue,&item,0)!=pdTRUE) { sb_diag_increment(SB_DIAG_PROTOCOL,9); return false; }
    return true;
}

static void receive_tcp(void)
{
    if (s_socket<0 || s_peer_fin_pending) return;
    size_t received=0u;
    bool peer_closed=false;
    while (received<sizeof(s_tcp_rx_quantum)) {
        int n=(int)recv(s_socket,s_tcp_rx_quantum+received,sizeof(s_tcp_rx_quantum)-received,0);
        if (n>0) received+=(size_t)n;
        else if (n==0) { peer_closed=true; break; }
        else if (errno==EAGAIN || errno==EWOULDBLOCK || errno==EINTR) break;
        else { fail_or_recover(6); return; }
    }
    if(received!=0u){uint32_t errors=0u;tcp_rx_context_t context={.generation=s_session_generation};if(!sb_sp_cobs_stream_feed(&s_rx_stream,s_tcp_rx_quantum,received,
        SB_SP_MAX_RX_PAYLOAD,queue_tcp_frame,&context,&errors)){fail_or_recover(5);return;}
        while(errors--)sb_diag_increment(SB_DIAG_PROTOCOL,4);}
    if(peer_closed){
        /* A complete final frame remains owned by the RX queue. TCP FIN only
         * closes the inbound half until Control and terminal TX have drained. */
        s_peer_fin_pending=true;s_fin_connection_generation=s_tcp_connection_generation;
        sb_sp_cobs_stream_reset(&s_rx_stream);
    }
}

void sb_wifi_finish_peer_fin_if_drained(bool control_pending)
{
    if(!s_peer_fin_pending||s_fin_connection_generation!=s_tcp_connection_generation)return;
    if(control_pending||(s_rx_queue&&uxQueueMessagesWaiting(s_rx_queue)!=0u)||
       (s_tx_queue&&uxQueueMessagesWaiting(s_tx_queue)!=0u)||s_tx_active)return;
    finish_user_disconnect();
}

static void poll_tcp_connect(void)
{
    if (s_socket<0 || !s_tcp_connect_started) return;
    fd_set write_set; FD_ZERO(&write_set); FD_SET(s_socket,&write_set);
    struct timeval timeout={0,0}; int rc=select(s_socket+1,NULL,&write_set,NULL,&timeout);
    if (rc==0) return;
    if (rc<0) { fail_or_recover(4); return; }
    int error=0; socklen_t error_length=sizeof(error);
    if (getsockopt(s_socket,SOL_SOCKET,SO_ERROR,&error,&error_length)<0 || error!=0) { fail_or_recover(4); return; }
    s_tcp_connect_started=false;
    if (!send_transport_ready()) fail_or_recover(4);
}

static void recover_if_due(void)
{
    if (s_snapshot.state!=SB_WIFI_RECOVERING || xTaskGetTickCount()<s_retry_at) return;
    if (s_recovering_from_ap_loss || !s_ap_connected) {
        if (!s_wifi_started && !start_wifi()) { fail_or_recover(6); return; }
        if (esp_wifi_connect()!=ESP_OK) { fail_or_recover(6); return; }
        s_stage_started_us=(uint64_t)esp_timer_get_time(); wifi_set_state(SB_WIFI_AP_CONNECTING);
    } else {
        s_stage_started_us=(uint64_t)esp_timer_get_time(); wifi_set_state(SB_WIFI_IP_READY);
    }
}

static esp_err_t wifi_ensure_driver(void)
{
    if (s_driver_ready) return ESP_OK;
    if (s_driver_init_attempted) return ESP_ERR_INVALID_STATE;
    s_driver_init_attempted=true;
    bool driver_initialized=false, wifi_handler=false, ip_handler=false;
    esp_err_t err=ESP_OK;
    sb_wireless_admission_t admission=sb_wireless_admit(SB_WIRELESS_WIFI);
    sb_validation_note_admission(SB_WIRELESS_WIFI,&admission);
    if (admission.decision!=SB_ADMISSION_ALLOW) {
        s_wireless_unavailable=true;
        wifi_set_state(SB_WIFI_ERROR);
        sb_startup_note_resource_failure(SB_WIRELESS_WIFI);
        sb_validation_note_admission_after(SB_WIRELESS_WIFI);
        return ESP_ERR_NO_MEM;
    }
    err=esp_netif_init(); if (err!=ESP_OK && err!=ESP_ERR_INVALID_STATE) goto failed;
    err=esp_event_loop_create_default(); if (err!=ESP_OK && err!=ESP_ERR_INVALID_STATE) goto failed;
    /* The convenience creator uses ESP_ERROR_CHECK on allocation/attach failures. */
    esp_netif_config_t netif_config=ESP_NETIF_DEFAULT_WIFI_STA();
    s_netif=esp_netif_new(&netif_config);
    if (!s_netif) {err=ESP_ERR_NO_MEM;goto failed;}
    if ((err=esp_netif_attach_wifi_station(s_netif))!=ESP_OK) goto failed;
    if ((err=esp_wifi_set_default_wifi_sta_handlers())!=ESP_OK) goto failed;
    wifi_init_config_t config=WIFI_INIT_CONFIG_DEFAULT();
    err=esp_wifi_init(&config); if (err!=ESP_OK) goto failed;
    driver_initialized=true;
    if ((err=esp_wifi_set_storage(WIFI_STORAGE_RAM))!=ESP_OK) goto failed;
    if ((err=esp_wifi_set_mode(WIFI_MODE_STA))!=ESP_OK) goto failed;
    if ((err=esp_event_handler_register(WIFI_EVENT,ESP_EVENT_ANY_ID,wifi_event_handler,NULL))!=ESP_OK) goto failed;
    wifi_handler=true;
    if ((err=esp_event_handler_register(IP_EVENT,ESP_EVENT_ANY_ID,wifi_event_handler,NULL))!=ESP_OK) goto failed;
    ip_handler=true;
    s_driver_ready=true;
    admission.after=sb_wireless_measure_heap();admission.after_observed=1;
    sb_validation_note_admission(SB_WIRELESS_WIFI,&admission);
    return ESP_OK;
failed:
    s_wireless_unavailable=true;
    if (ip_handler) (void)esp_event_handler_unregister(IP_EVENT,ESP_EVENT_ANY_ID,wifi_event_handler);
    if (wifi_handler) (void)esp_event_handler_unregister(WIFI_EVENT,ESP_EVENT_ANY_ID,wifi_event_handler);
    if (driver_initialized) (void)esp_wifi_deinit();
    if (s_netif) {
        (void)esp_wifi_clear_default_wifi_driver_and_handlers(s_netif);
        esp_netif_destroy(s_netif);s_netif=NULL;
    }
    /* Global lwIP/default event loop are retained. They are not reinitialized
     * for CONNECT/SCAN, and a failed first-init is never retried this boot. */
    admission.after=sb_wireless_measure_heap();admission.after_observed=1;
    sb_validation_note_admission(SB_WIRELESS_WIFI,&admission);
    wifi_set_state(SB_WIFI_ERROR);
    sb_startup_note_failure(6,err);
    return err;
}

esp_err_t sb_wifi_init(void)
{
    if (wifi_started()) return ESP_OK;
    if (sb_wifi_get_state()==SB_WIFI_ERROR) return ESP_ERR_INVALID_STATE;
    s_command_queue=xQueueCreateStatic(WIFI_COMMAND_DEPTH,sizeof(wifi_command_t),s_command_queue_storage,&s_command_queue_struct);
    s_event_queue=xQueueCreateStatic(WIFI_EVENT_DEPTH,sizeof(wifi_event_item_t),s_event_queue_storage,&s_event_queue_struct);
    s_rx_queue=xQueueCreateStatic(WIFI_RX_QUEUE_DEPTH,sizeof(wifi_frame_item_t),s_rx_queue_storage,&s_rx_queue_struct);
    s_tx_queue=xQueueCreateStatic(WIFI_TX_QUEUE_DEPTH,sizeof(wifi_frame_item_t),s_tx_queue_storage,&s_tx_queue_struct);
    if (!s_command_queue||!s_event_queue||!s_rx_queue||!s_tx_queue) {
        wifi_set_state(SB_WIFI_ERROR);sb_startup_note_failure(6,ESP_ERR_NO_MEM);return ESP_ERR_NO_MEM;
    }
    nvs_handle_t handle;
    if (nvs_open("sailball_wifi",NVS_READONLY,&handle)==ESP_OK) {
        size_t size=sizeof(s_profile); wifi_profile_t profile;
        if (nvs_get_blob(handle,"profile",&profile,&size)==ESP_OK && size==sizeof(profile) && profile.magic==UINT32_C(0x53425746) &&
            profile.ssid_length>=1 && profile.ssid_length<=SB_WIFI_SSID_MAX && profile.password_length<=64) {
            portENTER_CRITICAL(&s_mux); s_profile=profile; s_snapshot.configured=true; s_snapshot.ssid_length=profile.ssid_length; memcpy(s_snapshot.ssid,profile.ssid,profile.ssid_length); portEXIT_CRITICAL(&s_mux);
        }
        nvs_close(handle);
    }
    portENTER_CRITICAL(&s_mux);s_started=true;portEXIT_CRITICAL(&s_mux);
    return ESP_OK;
}

sb_wifi_state_t sb_wifi_get_state(void)
{
    portENTER_CRITICAL(&s_mux); sb_wifi_state_t state=s_snapshot.state; portEXIT_CRITICAL(&s_mux); return state;
}

bool sb_wifi_is_online(void) { return sb_wifi_get_state()==SB_WIFI_ONLINE; }

bool sb_wifi_is_initializing(void)
{
    portENTER_CRITICAL(&s_mux);bool initializing=s_initializing;portEXIT_CRITICAL(&s_mux);
    return initializing;
}

void sb_wifi_get_snapshot(sb_wifi_snapshot_t *out)
{
    if (!out) return;
    portENTER_CRITICAL(&s_mux); *out=s_snapshot; portEXIT_CRITICAL(&s_mux);
}

size_t sb_wifi_get_scan_results(sb_wifi_ap_t *out,size_t capacity,uint32_t *generation)
{
    portENTER_CRITICAL(&s_mux);
    if (generation) *generation=s_scan_generation;
    size_t count=s_ap_count<capacity?s_ap_count:capacity;
    if (out && count) memcpy(out,s_ap_cache,count*sizeof(*out));
    portEXIT_CRITICAL(&s_mux);
    return count;
}

sb_status_t sb_wifi_request_scan(sb_source_t source)
{
    if (source==SB_SOURCE_WIFI) return SB_PERMISSION_DENIED;
    if (!wifi_started()) return SB_INVALID_STATE;
    portENTER_CRITICAL(&s_mux); bool allowed=s_snapshot.state==SB_WIFI_OFF&&!s_operation_reserved; if (allowed) s_operation_reserved=true; portEXIT_CRITICAL(&s_mux);
    if (!allowed) return sb_wifi_get_state()==SB_WIFI_SCANNING?SB_BUSY:SB_INVALID_STATE;
    wifi_command_t command={.type=CMD_SCAN};
    if (xQueueSend(s_command_queue,&command,0)!=pdTRUE) { portENTER_CRITICAL(&s_mux);s_operation_reserved=false;portEXIT_CRITICAL(&s_mux);return SB_BUSY; }
    return SB_ACCEPTED;
}

sb_status_t sb_wifi_request_set_config(sb_source_t source,const uint8_t *ssid,size_t ssid_length,
                                       const uint8_t *password,size_t password_length)
{
    if (source==SB_SOURCE_WIFI) return SB_PERMISSION_DENIED;
    if (!wifi_started() || ssid==NULL || ssid_length==0 || ssid_length>SB_WIFI_SSID_MAX || password_length>64 || (password_length&&password==NULL)) return SB_INVALID_REQUEST;
    if (sb_wifi_get_state()!=SB_WIFI_OFF) return SB_INVALID_STATE;
    wifi_profile_t profile={0}; profile.magic=UINT32_C(0x53425746); profile.ssid_length=(uint8_t)ssid_length; profile.password_length=(uint8_t)password_length;
    memcpy(profile.ssid,ssid,ssid_length); if (password_length) memcpy(profile.password,password,password_length);
    nvs_handle_t handle; esp_err_t err=nvs_open("sailball_wifi",NVS_READWRITE,&handle);
    if (err!=ESP_OK) return SB_IO_ERROR;
    err=nvs_set_blob(handle,"profile",&profile,sizeof(profile)); if (err==ESP_OK) err=nvs_commit(handle); nvs_close(handle);
    if (err!=ESP_OK) { memset(&profile,0,sizeof(profile)); return SB_IO_ERROR; }
    portENTER_CRITICAL(&s_mux); s_profile=profile; portEXIT_CRITICAL(&s_mux);
    portENTER_CRITICAL(&s_mux); s_snapshot.configured=true; s_snapshot.ssid_length=(uint8_t)ssid_length; memcpy(s_snapshot.ssid,ssid,ssid_length); portEXIT_CRITICAL(&s_mux);
    return SB_OK;
}

static bool same_connect_request(const wifi_command_t *command)
{
    return command->handover_id==s_handover_id&&command->port==s_endpoint_port&&memcmp(command->address,s_endpoint,4)==0;
}

sb_status_t sb_wifi_request_connect(sb_source_t source,const uint8_t address[4],uint16_t port,uint32_t handover_id)
{
    if (source==SB_SOURCE_WIFI) return SB_PERMISSION_DENIED;
    if (!wifi_started() || address==NULL || port==0 || handover_id==0) return SB_INVALID_REQUEST;
    if (!s_snapshot.configured) return SB_INVALID_STATE;
    wifi_command_t command={.type=CMD_CONNECT,.port=port,.handover_id=handover_id}; memcpy(command.address,address,4);
    sb_wifi_state_t state=sb_wifi_get_state();
    if (state==SB_WIFI_ONLINE) return same_connect_request(&command)?SB_OK:SB_INVALID_STATE;
    if (state==SB_WIFI_AP_CONNECTING||state==SB_WIFI_IP_READY||state==SB_WIFI_TCP_CONNECTING||state==SB_WIFI_SP_HANDSHAKE||state==SB_WIFI_RECOVERING) {
        if (same_connect_request(&command)) return SB_ACCEPTED;
        return SB_BUSY;
    }
    if (state==SB_WIFI_SCANNING||state==SB_WIFI_ERROR) return state==SB_WIFI_SCANNING?SB_BUSY:SB_INVALID_STATE;
    portENTER_CRITICAL(&s_mux); bool reserved=s_operation_reserved; if (!reserved) { s_operation_reserved=true; s_reserved_connect=command; } portEXIT_CRITICAL(&s_mux);
    if (reserved) {
        bool same=s_reserved_connect.handover_id==command.handover_id&&s_reserved_connect.port==command.port&&memcmp(s_reserved_connect.address,command.address,4)==0;
        return same?SB_ACCEPTED:SB_BUSY;
    }
    if (xQueueSend(s_command_queue,&command,0)!=pdTRUE) { portENTER_CRITICAL(&s_mux);s_operation_reserved=false;portEXIT_CRITICAL(&s_mux);return SB_BUSY; }
    return SB_ACCEPTED;
}

sb_status_t sb_wifi_request_disconnect(sb_source_t source)
{
    if (source==SB_SOURCE_WIFI) return SB_PERMISSION_DENIED;
    if (!wifi_started()) return SB_INVALID_STATE;
    if (sb_wifi_get_state()==SB_WIFI_OFF) return SB_OK;
    portENTER_CRITICAL(&s_mux); bool queued=s_disconnect_queued; if (!queued) s_disconnect_queued=true; portEXIT_CRITICAL(&s_mux);
    if (queued) return SB_ACCEPTED;
    wifi_command_t command={.type=CMD_DISCONNECT};
    if (xQueueSend(s_command_queue,&command,0)!=pdTRUE) { portENTER_CRITICAL(&s_mux);s_disconnect_queued=false;portEXIT_CRITICAL(&s_mux);return SB_BUSY; }
    return SB_ACCEPTED;
}

sb_status_t sb_wifi_request_forget(sb_source_t source)
{
    if (source==SB_SOURCE_WIFI) return SB_PERMISSION_DENIED;
    if (!wifi_started()) return SB_INVALID_STATE;
    if (sb_wifi_get_state()!=SB_WIFI_OFF) return SB_INVALID_STATE;
    nvs_handle_t handle; esp_err_t err=nvs_open("sailball_wifi",NVS_READWRITE,&handle);
    if (err!=ESP_OK) return SB_IO_ERROR;
    err=nvs_erase_key(handle,"profile"); if (err==ESP_ERR_NVS_NOT_FOUND) err=ESP_OK;
    if (err==ESP_OK) err=nvs_commit(handle);
    nvs_close(handle);
    if (err!=ESP_OK) return SB_IO_ERROR;
    portENTER_CRITICAL(&s_mux); memset(&s_profile,0,sizeof(s_profile)); s_snapshot.configured=false; s_snapshot.ssid_length=0; memset(s_snapshot.ssid,0,sizeof(s_snapshot.ssid)); portEXIT_CRITICAL(&s_mux);
    return SB_OK;
}

bool sb_wifi_can_queue_tx(void) { return wifi_started()&&s_tx_queue!=NULL&&uxQueueSpacesAvailable(s_tx_queue)!=0; }

bool sb_wifi_queue_tx(const sb_sp_frame_t *frame,uint32_t generation)
{
    if (!wifi_started()||!frame||!s_tx_queue||frame->payload_length>SB_SP_MAX_RX_PAYLOAD||(frame->payload_length&& !frame->payload)) return false;
    if(generation!=s_session_generation)return false;
    wifi_frame_item_t item={0}; item.frame=*frame; item.frame.payload=NULL;item.session_generation=generation;
    if (frame->payload_length) memcpy(item.payload,frame->payload,frame->payload_length);
    return xQueueSend(s_tx_queue,&item,0)==pdTRUE;
}

bool sb_wifi_receive_frame(sb_sp_frame_t *frame,uint8_t *payload,size_t capacity)
{
    return sb_wifi_receive_frame_for_generation(frame,payload,capacity,NULL);
}

bool sb_wifi_receive_frame_for_generation(sb_sp_frame_t *frame,uint8_t *payload,size_t capacity,uint32_t *generation)
{
    if (!wifi_started()||!frame||!payload||!s_rx_queue) return false;
    wifi_frame_item_t item;
    if (xQueuePeek(s_rx_queue,&item,0)!=pdTRUE||item.frame.payload_length>capacity) return false;
    if (xQueueReceive(s_rx_queue,&item,0)!=pdTRUE) return false;
    *frame=item.frame; if (item.frame.payload_length) memcpy(payload,item.payload,item.frame.payload_length); frame->payload=payload;
    if(generation)*generation=item.session_generation;
    return true;
}

void sb_wifi_set_session_generation(uint32_t generation)
{
    if(s_session_generation==generation)return;
    bool keep_bootstrap=s_tx_active&&s_tx_bootstrap;
    if(s_tx_active&&!s_tx_bootstrap&&s_tx_offset!=0u)s_tx_resync_pending=true;
    s_session_generation=generation;
    if(s_rx_queue)(void)xQueueReset(s_rx_queue);
    if(s_tx_queue)(void)xQueueReset(s_tx_queue);
    sb_sp_cobs_stream_reset(&s_rx_stream);
    if(!keep_bootstrap){s_tx_active=false;s_tx_length=s_tx_offset=0;release_bulk_publication();}
    s_tx_completion_pending=false;
}

bool sb_wifi_take_session_start(void)
{
    bool pending=s_session_start_pending;s_session_start_pending=false;return pending;
}

bool sb_wifi_take_tx_completion(uint32_t *generation,uint8_t *type,uint32_t *request_id)
{
    if(!s_tx_completion_pending)return false;
    if(generation)*generation=s_tx_completed_generation;
    if(type)*type=s_tx_completed_type;
    if(request_id)*request_id=s_tx_completed_request_id;
    s_tx_completion_pending=false;return true;
}

void sb_wifi_mark_hello_complete(void)
{
    wifi_event_item_t event={.type=EV_HELLO}; if (s_event_queue) (void)xQueueSend(s_event_queue,&event,0);
}

bool sb_wifi_take_session_end(void)
{
    bool pending=s_session_end_pending; s_session_end_pending=false; return pending;
}

void sb_wifi_transport_poll(void)
{
    if (!wifi_started()) return;
    process_commands();
    wifi_event_item_t event; while (xQueueReceive(s_event_queue,&event,0)==pdTRUE) process_event(&event);
    portENTER_CRITICAL(&s_mux); bool queue_overflow=s_rx_pending_overflow; s_rx_pending_overflow=false; portEXIT_CRITICAL(&s_mux);
    if (queue_overflow) sb_diag_increment(SB_DIAG_PROTOCOL,9);
    recover_if_due();
    uint64_t now=(uint64_t)esp_timer_get_time();
    sb_wifi_state_t state=sb_wifi_get_state();
    if (state==SB_WIFI_AP_CONNECTING && now-s_stage_started_us>WIFI_CONNECT_TIMEOUT_US) { fail_or_recover(s_ap_connected?3:1); return; }
    if (state==SB_WIFI_TCP_CONNECTING && now-s_stage_started_us>WIFI_TCP_TIMEOUT_US) { fail_or_recover(4); return; }
    if (state==SB_WIFI_SP_HANDSHAKE && now-s_stage_started_us>WIFI_HELLO_TIMEOUT_US) { fail_or_recover(5); return; }
    if (state==SB_WIFI_IP_READY) {
        if (begin_tcp_connect()==false) { fail_or_recover(4); return; }
    }
    poll_tcp_connect();
    send_queued_tcp();
    /* Transport must advance the logical generation before bytes from a new
     * TCP connection are accepted into the COBS receive queue. */
    if(s_session_start_pending)return;
    receive_tcp();
    if (s_ap_connected && (state==SB_WIFI_ONLINE || state==SB_WIFI_SP_HANDSHAKE)) {
        wifi_ap_record_t ap; if (esp_wifi_sta_get_ap_info(&ap)==ESP_OK) { portENTER_CRITICAL(&s_mux);s_snapshot.rssi=ap.rssi;s_snapshot.rssi_valid=true;portEXIT_CRITICAL(&s_mux); }
    }
}
