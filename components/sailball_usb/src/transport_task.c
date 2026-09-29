#include "sailball/usb.h"
#include "sailball/control.h"
#include "sailball/ble.h"
#include "sailball/wifi.h"
#include "sailball/sp.h"
#include "sailball/transport_quantum.h"
#include "sailball/diagnostics.h"
#include "sailball/validation.h"
#include "sailball/storage.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_err.h"
#include "esp_timer.h"
#include <string.h>

#define TRANSPORT_STACK_WORDS 4096
#define USB_TX_QUANTUM 512u
#define USB_TX_STALL_TIMEOUT_US UINT64_C(5000000)
static StaticTask_t s_task_struct;
static StackType_t s_stack[TRANSPORT_STACK_WORDS];
static uint8_t s_encoded[SB_SP_MAX_FRAME+16];
static union { sb_control_tx_candidate_t candidate; uint8_t decoded[SB_SP_MAX_FRAME]; } s_decoded_scratch;
static uint8_t s_out[SB_SP_MAX_FRAME+16];
static size_t s_encoded_length;
static bool s_usb_was_connected;
static bool s_usb_tx_active,s_usb_resync_pending,s_usb_tx_reboot;
static size_t s_usb_tx_length,s_usb_tx_offset;
static uint32_t s_usb_tx_generation,s_usb_tx_request_id;
static uint8_t s_usb_tx_type;
static uint32_t s_usb_tx_storage_epoch;
static bool s_usb_bulk_publication_claimed;
static uint64_t s_usb_bulk_publication_claim_id;
static uint64_t s_usb_tx_started_us;
static uint32_t s_usb_rx_generation;

static bool invalidate_ble_control_session(uint32_t old_generation)
{
    return sb_control_invalidate_session_fast(SB_SOURCE_BLE,old_generation);
}

static void release_usb_bulk_publication(void)
{
    if(s_usb_bulk_publication_claimed)
        sb_storage_release_bulk_publication(s_usb_tx_storage_epoch,s_usb_bulk_publication_claim_id);
    s_usb_bulk_publication_claimed=false;
    s_usb_bulk_publication_claim_id=0u;
}

static void send_ready_responses(void)
{
    uint32_t current=sb_control_session_generation(SB_SOURCE_USB);
    if(s_usb_tx_active&&s_usb_tx_generation!=current){
        if(s_usb_tx_offset!=0u)s_usb_resync_pending=true;
        s_usb_tx_active=false;s_usb_tx_length=s_usb_tx_offset=0;release_usb_bulk_publication();
    }
    if(s_usb_resync_pending){
        const uint8_t delimiter=0;int n=sb_usb_write(&delimiter,1u,0);
        if(n==1)s_usb_resync_pending=false;
        return;
    }
    if(!s_usb_tx_active){
        sb_control_tx_candidate_t *candidate=&s_decoded_scratch.candidate;
        if(!sb_control_peek_tx_for_generation(SB_SOURCE_USB,candidate))return;
        sb_sp_frame_t frame=candidate->frame;uint32_t generation=candidate->generation;
        /* The candidate owns an immutable payload copy until this synchronous
         * encoder has consumed it. Keep COBS input distinct from s_out. */
        frame.payload=candidate->payload;
        size_t enc_n=0;
        if(!sb_sp_cobs_encode_delimited(&frame,s_out,sizeof(s_out),&enc_n)){
            sb_diag_increment(SB_DIAG_TRANSPORT,SB_SOURCE_USB*5u+2u);return;
        }
        if(!sb_control_commit_peeked_tx(SB_SOURCE_USB,candidate))return;
        s_usb_tx_generation=generation;s_usb_tx_request_id=frame.request_id;s_usb_tx_type=frame.type;
        s_usb_tx_storage_epoch=frame.storage_epoch;
        s_usb_tx_reboot=sb_control_usb_response_is_reboot(&frame);
        s_usb_bulk_publication_claimed=false;
        s_usb_tx_length=enc_n;s_usb_tx_offset=0;s_usb_tx_active=true;s_usb_tx_started_us=(uint64_t)esp_timer_get_time();
    }
    if(s_usb_tx_generation!=sb_control_session_generation(SB_SOURCE_USB)){
        if(s_usb_tx_offset!=0u)s_usb_resync_pending=true;
        s_usb_tx_active=false;s_usb_tx_length=s_usb_tx_offset=0;release_usb_bulk_publication();return;
    }
    if(s_usb_tx_type==SB_SP_BULK&&s_usb_tx_storage_epoch!=sb_storage_epoch_generation()){
        if(s_usb_tx_offset!=0u)s_usb_resync_pending=true;
        s_usb_tx_active=false;s_usb_tx_length=s_usb_tx_offset=0;
        release_usb_bulk_publication();
        sb_control_disconnect(SB_SOURCE_USB);return;
    }
    if(s_usb_tx_type==SB_SP_BULK&&!s_usb_bulk_publication_claimed){
        if(!sb_storage_claim_bulk_publication(s_usb_tx_storage_epoch,&s_usb_bulk_publication_claim_id)){
            s_usb_tx_active=false;s_usb_tx_length=s_usb_tx_offset=0;
            sb_control_disconnect(SB_SOURCE_USB);return;
        }
        s_usb_bulk_publication_claimed=true;
    }
    size_t quantum=sb_transport_tx_quantum(s_usb_tx_length-s_usb_tx_offset,USB_TX_QUANTUM);
    int written=sb_usb_write(s_out+s_usb_tx_offset,quantum,0);
    if(written>0){
        s_usb_tx_offset=sb_transport_tx_advance(s_usb_tx_offset,s_usb_tx_length,(size_t)written);
        /* USB writes may yield inside the driver. Storage can invalidate the
         * epoch after the pre-send lease check but before bytes are accepted.
         * Once any bytes were accepted, end the logical session; if the COBS
         * frame is incomplete, first resynchronize the byte stream. */
        if(s_usb_tx_type==SB_SP_BULK&&s_usb_tx_storage_epoch!=sb_storage_epoch_generation()){
            if(s_usb_tx_offset<s_usb_tx_length)s_usb_resync_pending=true;
            s_usb_tx_active=false;s_usb_tx_length=s_usb_tx_offset=0;release_usb_bulk_publication();
            sb_control_disconnect(SB_SOURCE_USB);return;
        }
    }
    else if((uint64_t)esp_timer_get_time()-s_usb_tx_started_us>USB_TX_STALL_TIMEOUT_US){
        sb_diag_increment(SB_DIAG_TRANSPORT,SB_SOURCE_USB*5u+2u);s_usb_tx_active=false;s_usb_tx_length=s_usb_tx_offset=0;
        release_usb_bulk_publication();
        sb_control_disconnect(SB_SOURCE_USB);return;
    }
    if(s_usb_tx_active&&s_usb_tx_offset==s_usb_tx_length){
        if(s_usb_tx_type==SB_SP_BULK&&
           !sb_storage_finish_bulk_publication(s_usb_tx_storage_epoch,s_usb_bulk_publication_claim_id)){
            s_usb_tx_active=false;s_usb_tx_length=s_usb_tx_offset=0;release_usb_bulk_publication();
            sb_control_disconnect(SB_SOURCE_USB);return;
        }
        s_usb_bulk_publication_claimed=false;s_usb_bulk_publication_claim_id=0u;
        sb_diag_increment(SB_DIAG_TRANSPORT,SB_SOURCE_USB*5u+1u);
        sb_control_tx_completed(SB_SOURCE_USB,s_usb_tx_generation,s_usb_tx_type,s_usb_tx_request_id,s_usb_tx_reboot);
        s_usb_tx_active=false;s_usb_tx_length=s_usb_tx_offset=0;
    }
}

static void service_ble_transport(void)
{
    if(sb_ble_take_session_start()){
        sb_control_transport_start(SB_SOURCE_BLE);
        sb_ble_set_session_generation(sb_control_session_generation(SB_SOURCE_BLE));
    }
    sb_sp_frame_t incoming;
    uint32_t generation;
    while (sb_ble_receive_frame_for_generation(&incoming, s_decoded_scratch.decoded,
                                                SB_SP_MAX_RX_PAYLOAD,&generation)) {
        if (!sb_control_submit_for_generation(SB_SOURCE_BLE,generation,&incoming)) sb_diag_increment(SB_DIAG_PROTOCOL, 6);
    }
    /* Keep Control's queue ownership until BLE accepts this exact generation.
     * A later HELLO reset makes commit fail and the stale adapter queue is
     * synchronously purged by applying the current generation. */
    while (sb_ble_can_queue_tx()) {
        sb_control_tx_candidate_t *candidate=&s_decoded_scratch.candidate;
        if (!sb_control_peek_tx_for_generation(SB_SOURCE_BLE,candidate)) break;
        sb_sp_frame_t outgoing=candidate->frame;generation=candidate->generation;
        /* sb_ble_queue_tx copies the frame payload before it returns. */
        outgoing.payload = candidate->payload;
        sb_ble_set_session_generation(generation);
        if(!sb_ble_can_queue_tx()||!sb_ble_queue_tx(&outgoing,generation))break;
        if(!sb_control_commit_peeked_tx(SB_SOURCE_BLE,candidate)){
            uint32_t current=sb_control_session_generation(SB_SOURCE_BLE);
            sb_ble_set_session_generation(current);
            if(current==generation)(void)sb_control_disconnect_if_generation(SB_SOURCE_BLE,generation);
            break;
        }
    }
    sb_ble_set_session_generation(sb_control_session_generation(SB_SOURCE_BLE));
    sb_ble_transport_poll();
    uint32_t ended_generation;bool control_invalidated;
    if(sb_ble_take_session_end(&ended_generation,&control_invalidated)&&!control_invalidated)
        (void)sb_control_disconnect_if_generation(SB_SOURCE_BLE,ended_generation);
    uint8_t type;uint32_t request_id;
    if(sb_ble_take_tx_completion(&generation,&type,&request_id))sb_control_tx_completed(SB_SOURCE_BLE,generation,type,request_id,false);
}

static void drain_wifi_rx(void)
{
    sb_sp_frame_t incoming;
    uint32_t generation;
    while(sb_wifi_receive_frame_for_generation(&incoming,s_decoded_scratch.decoded,
                                                SB_SP_MAX_RX_PAYLOAD,&generation))
        if(!sb_control_submit_for_generation(SB_SOURCE_WIFI,generation,&incoming))
            sb_diag_increment(SB_DIAG_PROTOCOL,6);
}

static void transport_task(void *arg)
{
    (void)arg;(void)sb_usb_init();
    for(;;){
        sb_validation_note_stack(SB_VALIDATION_TASK_TRANSPORT,(uint32_t)uxTaskGetStackHighWaterMark(NULL));
        bool usb_connected=sb_usb_is_connected();
        sb_control_set_usb_connected(usb_connected);
        uint32_t usb_generation=sb_control_session_generation(SB_SOURCE_USB);
        if(usb_generation!=s_usb_rx_generation){s_encoded_length=0;s_usb_rx_generation=usb_generation;}
        if(usb_connected&&!s_usb_was_connected){sb_diag_increment(SB_DIAG_TRANSPORT,SB_SOURCE_USB*5u+3u);sb_control_transport_start(SB_SOURCE_USB);s_usb_rx_generation=sb_control_session_generation(SB_SOURCE_USB);s_encoded_length=0;}
        if(!usb_connected&&s_usb_was_connected){sb_control_disconnect(SB_SOURCE_USB);sb_diag_increment(SB_DIAG_TRANSPORT,SB_SOURCE_USB*5u+4u);}
        s_usb_was_connected=usb_connected;
        uint8_t bytes[256];int n=sb_usb_read(bytes,sizeof(bytes),10);
        if(n>0){for(int i=0;i<n;++i){uint8_t b=bytes[i];if(b!=0){if(s_encoded_length<sizeof(s_encoded))s_encoded[s_encoded_length++]=b;else{s_encoded_length=0;sb_diag_increment(SB_DIAG_PROTOCOL,4);}continue;}
                if(s_encoded_length==0)continue;
                size_t frame_n=0;
                bool ok=sb_cobs_decode(s_encoded,s_encoded_length,s_decoded_scratch.decoded,sizeof(s_decoded_scratch.decoded),&frame_n);
                s_encoded_length=0;
                if(!ok){sb_diag_increment(SB_DIAG_PROTOCOL,4);continue;}
                sb_sp_frame_t frame;if(!sb_sp_frame_decode(s_decoded_scratch.decoded,frame_n,SB_SP_MAX_RX_PAYLOAD,&frame)){sb_diag_increment(SB_DIAG_PROTOCOL,1);continue;}
                sb_diag_increment(SB_DIAG_PROTOCOL,0);sb_diag_increment(SB_DIAG_TRANSPORT,0);
                if(!sb_control_submit_for_generation(SB_SOURCE_USB,s_usb_rx_generation,&frame))sb_diag_increment(SB_DIAG_PROTOCOL,6);
            }}
        send_ready_responses();
        sb_wifi_set_session_generation(sb_control_session_generation(SB_SOURCE_WIFI));
        sb_wifi_transport_poll();
        if(sb_wifi_take_session_start())sb_control_transport_start(SB_SOURCE_WIFI);
        sb_wifi_set_session_generation(sb_control_session_generation(SB_SOURCE_WIFI));
        if(sb_wifi_take_session_end())sb_control_disconnect(SB_SOURCE_WIFI);
        uint32_t wifi_generation;
        drain_wifi_rx();
        /* Synchronize a logical HELLO reset before selecting its response. */
        sb_wifi_set_session_generation(sb_control_session_generation(SB_SOURCE_WIFI));
        while(sb_wifi_can_queue_tx()){
            sb_control_tx_candidate_t *candidate=&s_decoded_scratch.candidate;
            if(!sb_control_peek_tx_for_generation(SB_SOURCE_WIFI,candidate))break;
            sb_sp_frame_t wifi_outgoing=candidate->frame;wifi_generation=candidate->generation;
            /* sb_wifi_queue_tx copies the frame payload before it returns. */
            wifi_outgoing.payload=candidate->payload;
            sb_wifi_set_session_generation(wifi_generation);
            if(!sb_wifi_can_queue_tx()||!sb_wifi_queue_tx(&wifi_outgoing,wifi_generation))break;
            if(!sb_control_commit_peeked_tx(SB_SOURCE_WIFI,candidate)){
                uint32_t current=sb_control_session_generation(SB_SOURCE_WIFI);
                sb_wifi_set_session_generation(current);
                if(current==wifi_generation)(void)sb_control_disconnect_if_generation(SB_SOURCE_WIFI,wifi_generation);
                break;
            }
        }
        uint8_t wifi_type;uint32_t wifi_request_id;
        if(sb_wifi_take_tx_completion(&wifi_generation,&wifi_type,&wifi_request_id))sb_control_tx_completed(SB_SOURCE_WIFI,wifi_generation,wifi_type,wifi_request_id,false);
        sb_wifi_finish_peer_fin_if_drained(sb_control_has_pending_for_generation(
            SB_SOURCE_WIFI,sb_control_session_generation(SB_SOURCE_WIFI)));
        sb_ble_set_session_generation(sb_control_session_generation(SB_SOURCE_BLE));
        service_ble_transport();
        vTaskDelay(pdMS_TO_TICKS(1));
    }
}
esp_err_t sb_transport_start(void)
{
    sb_ble_set_session_invalidator(invalidate_ble_control_session);
    return xTaskCreateStatic(transport_task,"transport_task",TRANSPORT_STACK_WORDS,NULL,4,s_stack,&s_task_struct)?ESP_OK:ESP_ERR_NO_MEM;
}
