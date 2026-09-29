#include "sailball/ble.h"
#include "sailball/board.h"
#include "sailball/diagnostics.h"
#include "sailball/storage.h"
#include "sailball/startup_metrics.h"
#include "sailball/sp.h"
#include "ble_reassembly.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "freertos/portmacro.h"
#include "esp_err.h"
#include "esp_timer.h"
#include "host/ble_hs.h"
#include "host/ble_uuid.h"
#include "host/ble_att.h"
#include "nimble/nimble_port.h"
#include "nimble/nimble_port_freertos.h"
#include "services/gap/ble_svc_gap.h"
#include "services/gatt/ble_svc_gatt.h"
#include "os/os_mbuf.h"
#include <stdio.h>
#include <string.h>

#define BLE_POLL_MS 10u
#define BLE_RX_QUEUE_DEPTH 4u
#define BLE_TX_QUEUE_DEPTH 2u
#define BLE_FRAGMENT_QUEUE_DEPTH 4u
#define BLE_TX_STALL_TIMEOUT_US UINT64_C(5000000)

typedef struct { sb_sp_frame_t frame; uint32_t session_generation; uint8_t payload[SB_SP_MAX_RX_PAYLOAD]; } ble_frame_item_t;
typedef struct { uint32_t generation,session_generation; uint64_t received_us; uint16_t length; uint8_t value[SB_BLE_FRAGMENT_MAX_VALUE]; } ble_fragment_item_t;
typedef struct { uint32_t connection_generation,session_generation; } reassembly_context_t;
static StaticQueue_t s_rx_queue_struct, s_tx_queue_struct, s_fragment_queue_struct;
static uint8_t s_rx_queue_storage[BLE_RX_QUEUE_DEPTH * sizeof(ble_frame_item_t)];
static uint8_t s_tx_queue_storage[BLE_TX_QUEUE_DEPTH * sizeof(ble_frame_item_t)];
static uint8_t s_fragment_queue_storage[BLE_FRAGMENT_QUEUE_DEPTH * sizeof(ble_fragment_item_t)];
static QueueHandle_t s_rx_queue, s_tx_queue, s_fragment_queue;
static ble_frame_item_t s_tx_item;

static const ble_uuid128_t s_service_uuid = BLE_UUID128_INIT(
    0x73,0x95,0x0a,0xfd,0xbc,0xb7,0x0d,0x81,0xc9,0x51,0xd6,0x0e,0xcf,0xc6,0x26,0xff);
static const ble_uuid128_t s_rx_uuid = BLE_UUID128_INIT(
    0x68,0x2d,0x04,0xf0,0xae,0x5a,0x75,0x8c,0xe8,0x51,0xcf,0xc2,0xd8,0xc9,0x7f,0xdc);
static const ble_uuid128_t s_tx_uuid = BLE_UUID128_INIT(
    0xa7,0xfb,0x97,0x12,0xc1,0x54,0x88,0xbe,0x2b,0x56,0x70,0x66,0x5c,0x87,0x53,0x06);

static portMUX_TYPE s_mux = portMUX_INITIALIZER_UNLOCKED;
static sb_ble_state_t s_state = SB_BLE_OFF;
static bool s_advertising_intent = true, s_wifi_online, s_connected, s_notify_enabled;
static bool s_adv_running, s_adv_update_pending, s_disconnect_pending;
static uint16_t s_conn_handle = BLE_HS_CONN_HANDLE_NONE, s_tx_value_handle;
static uint16_t s_current_mtu = 23u, s_tx_frame_id;
static uint8_t s_tx_frame[SB_SP_MAX_FRAME];
static uint64_t s_connected_at_us;
static bool s_tx_active, s_hello_complete, s_session_end_pending, s_session_start_pending;
static bool s_tx_bulk_publication_claimed;
static uint64_t s_tx_bulk_publication_claim_id;
static uint32_t s_sp_session_generation, s_reassembly_session_generation;
static bool s_tx_completion_pending;
static uint32_t s_tx_completed_generation, s_tx_completed_request_id;
static uint8_t s_tx_completed_type;
static sb_ble_session_invalidator_t s_session_invalidator;
static uint32_t s_session_end_generation;
static bool s_session_end_control_invalidated;

static void release_bulk_publication(void)
{
    if(s_tx_bulk_publication_claimed)sb_storage_release_bulk_publication(s_tx_item.frame.storage_epoch,s_tx_bulk_publication_claim_id);
    s_tx_bulk_publication_claimed=false;
    s_tx_bulk_publication_claim_id=0u;
}

static void end_logical_session(bool request_disconnect)
{
    portENTER_CRITICAL(&s_mux);uint32_t old_generation=s_sp_session_generation;portEXIT_CRITICAL(&s_mux);
    /* This callback's generation advance is the logical invalidation point.
     * Deferred queue/Transfer cleanup and physical GAP termination follow. */
    bool has_invalidator=s_session_invalidator!=NULL;
    bool invalidated=has_invalidator&&s_session_invalidator(old_generation);
    portENTER_CRITICAL(&s_mux);
    if(s_sp_session_generation==old_generation){
        if(has_invalidator&&!invalidated){portEXIT_CRITICAL(&s_mux);return;}
        s_hello_complete=false;
        s_session_end_pending=true;
        s_session_end_generation=old_generation;
        s_session_end_control_invalidated=invalidated;
        if(request_disconnect)s_disconnect_pending=true;
    }
    portEXIT_CRITICAL(&s_mux);
}
static uint16_t s_tx_length, s_tx_offset;
static uint64_t s_tx_started_us;
static uint8_t s_device_name[16];
static bool s_started;
static sb_ble_reassembly_t s_reassembly;
static uint32_t s_connection_generation, s_owner_generation;
static bool s_fragment_handoff_overflow;

static int gap_event(struct ble_gap_event *event, void *arg);
static int start_advertising(void);

/* Publish all initialized queue/driver state before Transport may use it. */
static bool ble_started(void)
{
    portENTER_CRITICAL(&s_mux);bool ready=s_started;portEXIT_CRITICAL(&s_mux);return ready;
}

static void set_state(sb_ble_state_t state)
{
    portENTER_CRITICAL(&s_mux); s_state = state; portEXIT_CRITICAL(&s_mux);
}

static void fragment_error(void)
{
    sb_ble_reassembly_invalidate(&s_reassembly);
    sb_diag_increment(SB_DIAG_PROTOCOL, 8); /* Internal BLE fragment errors. */
}

static bool queue_complete_frame(void *context,const sb_sp_frame_t *frame)
{
    const reassembly_context_t *expected=context;portENTER_CRITICAL(&s_mux);
    bool current=s_connected&&s_connection_generation==expected->connection_generation&&s_sp_session_generation==expected->session_generation;portEXIT_CRITICAL(&s_mux);if(!current)return false;
    sb_diag_increment(SB_DIAG_PROTOCOL,0);sb_diag_increment(SB_DIAG_TRANSPORT,SB_SOURCE_BLE*5u);
    ble_frame_item_t item={0};item.frame=*frame;item.frame.payload=NULL;item.session_generation=expected->session_generation;
    if(frame->payload_length)memcpy(item.payload,frame->payload,frame->payload_length);
    return s_rx_queue!=NULL&&xQueueSend(s_rx_queue,&item,0)==pdTRUE;
}

static void process_fragment_handoff(void)
{
    uint32_t generation,session_generation;bool connected,overflow;
    portENTER_CRITICAL(&s_mux);generation=s_connection_generation;connected=s_connected;
    session_generation=s_sp_session_generation;
    overflow=s_fragment_handoff_overflow;s_fragment_handoff_overflow=false;portEXIT_CRITICAL(&s_mux);
    if(generation!=s_owner_generation){sb_ble_reassembly_reset(&s_reassembly);s_owner_generation=generation;}
    if(session_generation!=s_reassembly_session_generation){sb_ble_reassembly_clear_logical(&s_reassembly);s_reassembly_session_generation=session_generation;}
    if(overflow){
        if(s_fragment_queue)(void)xQueueReset(s_fragment_queue);
        fragment_error();
        return;
    }
    for(unsigned count=0;count<BLE_FRAGMENT_QUEUE_DEPTH;++count){
        ble_fragment_item_t item;if(!s_fragment_queue||xQueueReceive(s_fragment_queue,&item,0)!=pdTRUE)break;
        if(!connected||item.generation!=generation)continue;
        if(item.session_generation!=session_generation){fragment_error();continue;}
        reassembly_context_t context={generation,session_generation};
        sb_ble_rx_result_t result=sb_ble_reassembly_feed(&s_reassembly,item.value,item.length,item.received_us,
                                                        queue_complete_frame,&context);
        if(result==SB_BLE_RX_ERROR)sb_diag_increment(SB_DIAG_PROTOCOL,8);
    }
}

static int rx_access(uint16_t conn_handle, uint16_t attr_handle,
                     struct ble_gatt_access_ctxt *ctxt, void *arg)
{
    (void)attr_handle; (void)arg;
    if (ctxt->op != BLE_GATT_ACCESS_OP_WRITE_CHR || conn_handle != s_conn_handle) return BLE_ATT_ERR_UNLIKELY;
    uint16_t packet_length = OS_MBUF_PKTLEN(ctxt->om);
    ble_fragment_item_t item={0};uint16_t flat_length=0;
    if (packet_length < SB_BLE_FRAGMENT_HEADER_SIZE+1u || packet_length > sizeof(item.value) ||
        ble_hs_mbuf_to_flat(ctxt->om,item.value,sizeof(item.value),&flat_length) != 0 || flat_length != packet_length) {
        portENTER_CRITICAL(&s_mux);s_fragment_handoff_overflow=true;portEXIT_CRITICAL(&s_mux);
        return BLE_ATT_ERR_INVALID_ATTR_VALUE_LEN;
    }
    portENTER_CRITICAL(&s_mux);item.generation=s_connection_generation;item.session_generation=s_sp_session_generation;portEXIT_CRITICAL(&s_mux);
    item.length=flat_length;item.received_us=(uint64_t)esp_timer_get_time();
    if(s_fragment_queue==NULL||xQueueSend(s_fragment_queue,&item,0)!=pdTRUE){
        portENTER_CRITICAL(&s_mux);s_fragment_handoff_overflow=true;portEXIT_CRITICAL(&s_mux);
        return BLE_ATT_ERR_INSUFFICIENT_RES;
    }
    return 0;
}

static const struct ble_gatt_chr_def s_characteristics[] = {
    { .uuid=&s_rx_uuid.u, .access_cb=rx_access, .flags=BLE_GATT_CHR_F_WRITE },
    { .uuid=&s_tx_uuid.u, .flags=BLE_GATT_CHR_F_NOTIFY, .val_handle=&s_tx_value_handle },
    { 0 }
};
static const struct ble_gatt_svc_def s_services[] = {
    { .type=BLE_GATT_SVC_TYPE_PRIMARY, .uuid=&s_service_uuid.u, .characteristics=s_characteristics },
    { 0 }
};

static int start_advertising(void)
{
    uint8_t address_type;
    int rc = ble_hs_id_infer_auto(0, &address_type);
    if (rc != 0) return rc;
    struct ble_hs_adv_fields fields = {0};
    fields.flags = BLE_HS_ADV_F_DISC_GEN | BLE_HS_ADV_F_BREDR_UNSUP;
    fields.uuids128 = &s_service_uuid; fields.num_uuids128 = 1; fields.uuids128_is_complete = 1;
    rc = ble_gap_adv_set_fields(&fields);
    if (rc != 0) return rc;
    struct ble_hs_adv_fields scan = {0};
    scan.name = s_device_name; scan.name_len = (uint8_t)strlen((char *)s_device_name); scan.name_is_complete = 1;
    rc = ble_gap_adv_rsp_set_fields(&scan);
    if (rc != 0) return rc;
    struct ble_gap_adv_params params = {0};
    params.conn_mode = BLE_GAP_CONN_MODE_UND; params.disc_mode = BLE_GAP_DISC_MODE_GEN;
    rc = ble_gap_adv_start(address_type, NULL, BLE_HS_FOREVER, &params, gap_event, NULL);
    if (rc == 0) {
        s_adv_running = true;
        set_state(SB_BLE_ADVERTISING);
    }
    return rc;
}

static bool should_advertise(void)
{
    bool intent, wifi, connected;
    portENTER_CRITICAL(&s_mux); intent=s_advertising_intent; wifi=s_wifi_online; connected=s_connected; portEXIT_CRITICAL(&s_mux);
    return intent && !wifi && !connected;
}

static void process_control_tx(void)
{
    portENTER_CRITICAL(&s_mux);bool session_ending=s_session_end_pending;portEXIT_CRITICAL(&s_mux);
    if(session_ending)return;
    bool connected, notify;
    portENTER_CRITICAL(&s_mux); connected=s_connected; notify=s_notify_enabled; portEXIT_CRITICAL(&s_mux);
    if (!connected || s_conn_handle == BLE_HS_CONN_HANDLE_NONE || s_tx_queue == NULL) return;
    if (!s_tx_active) {
        if (xQueueReceive(s_tx_queue, &s_tx_item, 0) != pdTRUE) return;
        portENTER_CRITICAL(&s_mux);uint32_t session_generation=s_sp_session_generation;portEXIT_CRITICAL(&s_mux);
        if(s_tx_item.session_generation!=session_generation)return;
        sb_sp_frame_t frame = s_tx_item.frame;
        frame.payload = s_tx_item.payload;
        size_t written = 0;
        if (!sb_sp_frame_encode(&frame, s_tx_frame, sizeof(s_tx_frame), &written) || written > UINT16_MAX) {
            sb_diag_increment(SB_DIAG_TRANSPORT, SB_SOURCE_BLE * 5u + 2u);
            return;
        }
        s_tx_length = (uint16_t)written; s_tx_offset = 0; s_tx_active = true;s_tx_bulk_publication_claimed=false;
        s_tx_started_us=(uint64_t)esp_timer_get_time();
    }
    portENTER_CRITICAL(&s_mux);uint32_t current_session_generation=s_sp_session_generation;portEXIT_CRITICAL(&s_mux);
    if(s_tx_item.session_generation!=current_session_generation){s_tx_active=false;s_tx_length=s_tx_offset=0;release_bulk_publication();return;}
    if(s_tx_item.frame.type==SB_SP_BULK&&s_tx_item.frame.storage_epoch!=sb_storage_epoch_generation()){
        s_tx_active=false;s_tx_length=s_tx_offset=0;
        release_bulk_publication();
        end_logical_session(true);
        return;
    }
    if(s_tx_item.frame.type==SB_SP_BULK&&!s_tx_bulk_publication_claimed){
        if(!sb_storage_claim_bulk_publication(s_tx_item.frame.storage_epoch,&s_tx_bulk_publication_claim_id)){
            s_tx_active=false;s_tx_length=s_tx_offset=0;
            end_logical_session(true);
            return;
        }
        s_tx_bulk_publication_claimed=true;
    }
    uint64_t now=(uint64_t)esp_timer_get_time();
    if(now>=s_tx_started_us&&now-s_tx_started_us>=BLE_TX_STALL_TIMEOUT_US){
        bool terminal=s_tx_item.frame.type==SB_SP_RESPONSE||s_tx_item.frame.type==SB_SP_BULK;
        s_tx_active=false;s_tx_length=s_tx_offset=0;release_bulk_publication();
        sb_diag_increment(SB_DIAG_TRANSPORT,SB_SOURCE_BLE*5u+2u);
        if(terminal){
            end_logical_session(true);
        }
        return;
    }
    if(!notify)return;
    portENTER_CRITICAL(&s_mux); uint16_t mtu=s_current_mtu; uint16_t conn_handle=s_conn_handle; portEXIT_CRITICAL(&s_mux);
    if (mtu <= 9u) return;
    uint16_t part = (uint16_t)(mtu - 9u);
    uint16_t remaining = (uint16_t)(s_tx_length - s_tx_offset);
    if (part > remaining) part = remaining;
    uint8_t value[SB_BLE_FRAGMENT_MAX_VALUE];
    if (part + 6u > sizeof(value)) return;
    sb_write_le16(value, s_tx_frame_id); sb_write_le16(value + 2, s_tx_offset); sb_write_le16(value + 4, s_tx_length);
    memcpy(value + 6, s_tx_frame + s_tx_offset, part);
    struct os_mbuf *om = os_msys_get_pkthdr((uint16_t)(part + 6u), 0);
    if (om == NULL || os_mbuf_append(om, value, (uint16_t)(part + 6u)) != 0) {
        if (om) os_mbuf_free_chain(om);
        sb_diag_increment(SB_DIAG_TRANSPORT, SB_SOURCE_BLE * 5u + 2u);
        return;
    }
    int rc = ble_gatts_notify_custom(conn_handle, s_tx_value_handle, om);
    if (rc != 0) {
        sb_diag_increment(SB_DIAG_TRANSPORT, SB_SOURCE_BLE * 5u + 2u);
        return;
    }
    /* NimBLE notify may yield. If the Storage epoch changes during that call,
     * the fragment has crossed the physical boundary but the Transfer must
     * not be completed or continued in a valid logical session. */
    if(s_tx_item.frame.type==SB_SP_BULK&&
       s_tx_item.frame.storage_epoch!=sb_storage_epoch_generation()){
        s_tx_active=false;s_tx_length=s_tx_offset=0;release_bulk_publication();
        end_logical_session(true);
        return;
    }
    s_tx_offset = (uint16_t)(s_tx_offset + part);
    s_tx_started_us=(uint64_t)esp_timer_get_time();
    if (s_tx_offset == s_tx_length) {
        if(s_tx_item.frame.type==SB_SP_BULK&&
           !sb_storage_finish_bulk_publication(s_tx_item.frame.storage_epoch,s_tx_bulk_publication_claim_id)){
            s_tx_active=false;s_tx_length=s_tx_offset=0;release_bulk_publication();
            end_logical_session(true);
            return;
        }
        s_tx_bulk_publication_claimed=false;s_tx_bulk_publication_claim_id=0u;
        s_tx_active = false; s_tx_length = s_tx_offset = 0; ++s_tx_frame_id;
        s_tx_completed_generation=s_tx_item.session_generation;
        s_tx_completed_type=s_tx_item.frame.type;
        s_tx_completed_request_id=s_tx_item.frame.request_id;
        s_tx_completion_pending=true;
        sb_diag_increment(SB_DIAG_TRANSPORT, SB_SOURCE_BLE * 5u + 1u);
    }
}

void sb_ble_transport_poll(void)
{
    if (!ble_started()) return;
    process_fragment_handoff();
    bool want = should_advertise();
    if (s_adv_update_pending || want != s_adv_running) {
        s_adv_update_pending = false;
        if (want && !s_adv_running) {
            if (start_advertising() != 0) {
                set_state(SB_BLE_ERROR);
            }
        } else if (!want && s_adv_running) {
            (void)ble_gap_adv_stop(); s_adv_running = false;
            if (!s_connected) set_state(SB_BLE_IDLE);
        }
    }
    if (s_disconnect_pending && s_connected) {
        s_disconnect_pending = false; set_state(SB_BLE_DISCONNECTING);
        if (ble_gap_terminate(s_conn_handle, BLE_ERR_REM_USER_CONN_TERM) != 0) set_state(SB_BLE_CONNECTED);
    }
    if (s_connected && !s_hello_complete && (uint64_t)esp_timer_get_time()-s_connected_at_us>UINT64_C(15000000)) {
        set_state(SB_BLE_DISCONNECTING);
        if (ble_gap_terminate(s_conn_handle,BLE_ERR_REM_USER_CONN_TERM)!=0) set_state(SB_BLE_CONNECTED);
    }
    if(sb_ble_reassembly_expire(&s_reassembly,(uint64_t)esp_timer_get_time()))
        sb_diag_increment(SB_DIAG_PROTOCOL,8);
    process_control_tx();
}

static int gap_event(struct ble_gap_event *event, void *arg)
{
    (void)arg;
    switch (event->type) {
    case BLE_GAP_EVENT_CONNECT:
        if (event->connect.status == 0) {
            portENTER_CRITICAL(&s_mux);
            s_connected = true; s_conn_handle = event->connect.conn_handle; s_notify_enabled = false;
            if(++s_connection_generation==0u)++s_connection_generation;
            s_current_mtu = ble_att_mtu(event->connect.conn_handle); s_state = SB_BLE_CONNECTED;
            portEXIT_CRITICAL(&s_mux);
            s_hello_complete=false;s_connected_at_us=(uint64_t)esp_timer_get_time();
            s_adv_running = false; s_tx_frame_id = 0; s_tx_active = false;
            portENTER_CRITICAL(&s_mux);s_session_start_pending=true;portEXIT_CRITICAL(&s_mux);
            if(s_fragment_queue)(void)xQueueReset(s_fragment_queue);
            if(s_rx_queue)(void)xQueueReset(s_rx_queue);
            if(s_tx_queue)(void)xQueueReset(s_tx_queue);
            sb_diag_increment(SB_DIAG_TRANSPORT, SB_SOURCE_BLE * 5u + 3u);
        } else {
            s_adv_running = false; s_adv_update_pending = true;
        }
        break;
    case BLE_GAP_EVENT_DISCONNECT: {
        portENTER_CRITICAL(&s_mux);
        uint32_t ended_generation=s_sp_session_generation;
        s_connected = false; s_notify_enabled = false; s_conn_handle = BLE_HS_CONN_HANDLE_NONE; s_current_mtu = 23u;
        if(++s_connection_generation==0u)++s_connection_generation;
        s_state = SB_BLE_IDLE;
        portEXIT_CRITICAL(&s_mux);
        s_adv_running = false; s_tx_active = false;release_bulk_publication();
        s_hello_complete=false;portENTER_CRITICAL(&s_mux);
        s_session_end_pending=true;s_session_start_pending=false;s_session_end_generation=ended_generation;
        s_session_end_control_invalidated=false;portEXIT_CRITICAL(&s_mux);
        if(s_fragment_queue)(void)xQueueReset(s_fragment_queue);
        if(s_rx_queue)(void)xQueueReset(s_rx_queue);
        if(s_tx_queue)(void)xQueueReset(s_tx_queue);
        sb_diag_increment(SB_DIAG_TRANSPORT, SB_SOURCE_BLE * 5u + 4u);
        s_adv_update_pending = true;
        break;
    }
    case BLE_GAP_EVENT_SUBSCRIBE:
        if (event->subscribe.attr_handle == s_tx_value_handle) {
            portENTER_CRITICAL(&s_mux); s_notify_enabled = event->subscribe.cur_notify != 0; portEXIT_CRITICAL(&s_mux);
        }
        break;
    case BLE_GAP_EVENT_MTU:
        portENTER_CRITICAL(&s_mux); s_current_mtu = event->mtu.value; portEXIT_CRITICAL(&s_mux);
        break;
    case BLE_GAP_EVENT_ADV_COMPLETE:
        s_adv_running = false; s_adv_update_pending = true;
        break;
    default:
        break;
    }
    return 0;
}

static void on_reset(int reason)
{
    (void)reason;
    portENTER_CRITICAL(&s_mux); s_state = SB_BLE_ERROR; s_connected = false; s_conn_handle = BLE_HS_CONN_HANDLE_NONE; portEXIT_CRITICAL(&s_mux);
    s_adv_running = false; s_adv_update_pending = true;
}

static void on_sync(void)
{
    s_adv_update_pending = true;
}

static void host_task(void *arg)
{
    (void)arg; nimble_port_run(); vTaskDelete(NULL);
}

static esp_err_t ble_init_failed(esp_err_t err, bool port_initialized)
{
    if (port_initialized) (void)nimble_port_deinit();
    sb_validation_note_admission_after(SB_WIRELESS_BLE);
    portENTER_CRITICAL(&s_mux);s_state=SB_BLE_ERROR;s_started=false;portEXIT_CRITICAL(&s_mux);
    sb_startup_note_failure(7,err);
    return err;
}

esp_err_t sb_ble_init(void)
{
    if (ble_started()) return ESP_OK;
    if (sb_ble_get_state()==SB_BLE_ERROR) return ESP_ERR_INVALID_STATE;
    s_rx_queue=xQueueCreateStatic(BLE_RX_QUEUE_DEPTH,sizeof(ble_frame_item_t),s_rx_queue_storage,&s_rx_queue_struct);
    s_tx_queue=xQueueCreateStatic(BLE_TX_QUEUE_DEPTH,sizeof(ble_frame_item_t),s_tx_queue_storage,&s_tx_queue_struct);
    s_fragment_queue=xQueueCreateStatic(BLE_FRAGMENT_QUEUE_DEPTH,sizeof(ble_fragment_item_t),s_fragment_queue_storage,&s_fragment_queue_struct);
    if (!s_rx_queue||!s_tx_queue||!s_fragment_queue) return ble_init_failed(ESP_ERR_NO_MEM,false);
    sb_board_info_t board;sb_board_get_info(&board);
    snprintf((char *)s_device_name,sizeof(s_device_name),"Sailball-%04lX",(unsigned long)(board.device_id&0xFFFFu));
    sb_wireless_admission_t admission=sb_wireless_admit(SB_WIRELESS_BLE);
    sb_validation_note_admission(SB_WIRELESS_BLE,&admission);
    if (admission.decision!=SB_ADMISSION_ALLOW) {
        portENTER_CRITICAL(&s_mux);s_state=SB_BLE_ERROR;s_started=false;portEXIT_CRITICAL(&s_mux);
        sb_startup_note_resource_failure(SB_WIRELESS_BLE);
        sb_validation_note_admission_after(SB_WIRELESS_BLE);
        return ESP_ERR_NO_MEM;
    }
    esp_err_t err=nimble_port_init();
    admission.after=sb_wireless_measure_heap();admission.after_observed=1;
    sb_validation_note_admission(SB_WIRELESS_BLE,&admission);
    if (err!=ESP_OK) return ble_init_failed(err,false);
    ble_hs_cfg.reset_cb=on_reset;ble_hs_cfg.sync_cb=on_sync;
    ble_svc_gap_init();ble_svc_gatt_init();
    if (ble_gatts_count_cfg(s_services)!=0||ble_gatts_add_svcs(s_services)!=0||
        ble_svc_gap_device_name_set((const char *)s_device_name)!=0)
        return ble_init_failed(ESP_FAIL,true);
    /* IDF 6.1's esp_nimble_enable returns ESP_OK without checking task creation.
     * Create the same internal NimBLE host task with an explicit result check. */
    TaskHandle_t host_handle=NULL;
    if (xTaskCreatePinnedToCore(host_task,"nimble_host",CONFIG_BT_NIMBLE_HOST_TASK_STACK_SIZE,
        NULL,configMAX_PRIORITIES-4,&host_handle,CONFIG_BT_NIMBLE_PINNED_TO_CORE)!=pdPASS)
        return ble_init_failed(ESP_ERR_NO_MEM,true);
    admission.after=sb_wireless_measure_heap();
    sb_validation_note_admission(SB_WIRELESS_BLE,&admission);
    portENTER_CRITICAL(&s_mux);s_started=true;portEXIT_CRITICAL(&s_mux);
    return ESP_OK;
}

sb_ble_state_t sb_ble_get_state(void)
{
    portENTER_CRITICAL(&s_mux); sb_ble_state_t state=s_state; portEXIT_CRITICAL(&s_mux); return state;
}

bool sb_ble_get_advertising_intent(void)
{
    portENTER_CRITICAL(&s_mux); bool enabled=s_advertising_intent; portEXIT_CRITICAL(&s_mux); return enabled;
}

bool sb_ble_get_mtu(uint16_t *mtu)
{
    if (mtu == NULL) return false;
    portENTER_CRITICAL(&s_mux); bool connected=s_connected; uint16_t value=s_current_mtu; portEXIT_CRITICAL(&s_mux);
    if (!connected || value < 23u) return false;
    *mtu=value; return true;
}

void sb_ble_wifi_online(bool online)
{
    portENTER_CRITICAL(&s_mux); s_wifi_online=online; portEXIT_CRITICAL(&s_mux);
    s_adv_update_pending=true;
}

void sb_ble_mark_hello_complete(void) { s_hello_complete=true; }

bool sb_ble_take_session_end(uint32_t *old_generation,bool *control_invalidated)
{
    portENTER_CRITICAL(&s_mux);bool pending=s_session_end_pending;
    if(pending){if(old_generation)*old_generation=s_session_end_generation;
        if(control_invalidated)*control_invalidated=s_session_end_control_invalidated;
        s_session_end_pending=false;s_session_end_control_invalidated=false;}
    portEXIT_CRITICAL(&s_mux);return pending;
}

bool sb_ble_take_session_start(void)
{
    portENTER_CRITICAL(&s_mux);bool pending=s_session_start_pending;s_session_start_pending=false;portEXIT_CRITICAL(&s_mux);return pending;
}

void sb_ble_set_session_generation(uint32_t generation)
{
    portENTER_CRITICAL(&s_mux);bool changed=s_sp_session_generation!=generation;s_sp_session_generation=generation;portEXIT_CRITICAL(&s_mux);
    if(changed){sb_ble_reassembly_clear_logical(&s_reassembly);s_reassembly_session_generation=generation;s_tx_active=false;release_bulk_publication();s_tx_length=s_tx_offset=0;s_tx_completion_pending=false;
        if(s_fragment_queue)(void)xQueueReset(s_fragment_queue);
        if(s_tx_queue)(void)xQueueReset(s_tx_queue);}
}

void sb_ble_set_session_invalidator(sb_ble_session_invalidator_t invalidator)
{
    portENTER_CRITICAL(&s_mux);s_session_invalidator=invalidator;portEXIT_CRITICAL(&s_mux);
}

bool sb_ble_take_tx_completion(uint32_t *generation,uint8_t *type,uint32_t *request_id)
{
    if(!s_tx_completion_pending)return false;
    if(generation)*generation=s_tx_completed_generation;
    if(type)*type=s_tx_completed_type;
    if(request_id)*request_id=s_tx_completed_request_id;
    s_tx_completion_pending=false;return true;
}

sb_status_t sb_ble_set_advertising(bool enabled, sb_source_t source)
{
    if (source == SB_SOURCE_BLE) return SB_PERMISSION_DENIED;
    portENTER_CRITICAL(&s_mux); s_advertising_intent=enabled; portEXIT_CRITICAL(&s_mux);
    s_adv_update_pending=true;
    return SB_OK;
}

sb_status_t sb_ble_disconnect(sb_source_t source)
{
    if (source == SB_SOURCE_BLE) return SB_PERMISSION_DENIED;
    portENTER_CRITICAL(&s_mux); bool connected=s_connected; portEXIT_CRITICAL(&s_mux);
    if (!connected) return SB_OK;
    s_disconnect_pending=true;
    return SB_ACCEPTED;
}

bool sb_ble_can_queue_tx(void)
{
    return ble_started() && s_tx_queue != NULL && uxQueueSpacesAvailable(s_tx_queue) != 0;
}

bool sb_ble_queue_tx(const sb_sp_frame_t *frame,uint32_t generation)
{
    if (!ble_started() || frame == NULL || s_tx_queue == NULL || frame->payload_length > SB_SP_MAX_RX_PAYLOAD ||
        (frame->payload_length != 0 && frame->payload == NULL)) return false;
    portENTER_CRITICAL(&s_mux);bool current=generation==s_sp_session_generation;portEXIT_CRITICAL(&s_mux);if(!current)return false;
    ble_frame_item_t item = {0}; item.frame = *frame; item.frame.payload = NULL;item.session_generation=generation;
    if (frame->payload_length != 0) memcpy(item.payload, frame->payload, frame->payload_length);
    return xQueueSend(s_tx_queue, &item, 0) == pdTRUE;
}

bool sb_ble_receive_frame(sb_sp_frame_t *frame, uint8_t *payload, size_t capacity)
{
    return sb_ble_receive_frame_for_generation(frame,payload,capacity,NULL);
}

bool sb_ble_receive_frame_for_generation(sb_sp_frame_t *frame,uint8_t *payload,size_t capacity,uint32_t *generation)
{
    if (!ble_started() || frame == NULL || payload == NULL || s_rx_queue == NULL) return false;
    ble_frame_item_t item;
    if (xQueuePeek(s_rx_queue, &item, 0) != pdTRUE || item.frame.payload_length > capacity) return false;
    if (xQueueReceive(s_rx_queue, &item, 0) != pdTRUE) return false;
    *frame=item.frame;
    if (item.frame.payload_length != 0) memcpy(payload,item.payload,item.frame.payload_length);
    frame->payload=payload;
    if(generation)*generation=item.session_generation;
    return true;
}
