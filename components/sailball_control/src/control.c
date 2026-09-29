#include "sailball/control.h"
#include "sailball/control_tx_policy.h"
#include "sailball/control_sources.h"
#include "sailball/board.h"
#include "sailball/diagnostics.h"
#include "sailball/validation.h"
#include "sailball/gnss.h"
#include "sailball/recorder.h"
#include "sailball/storage.h"
#include "sailball/supervisor.h"
#include "sailball/transfer.h"
#include "sailball/ble.h"
#include "sailball/wifi.h"
#include "sailball/ui.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "freertos/portmacro.h"
#include "esp_system.h"
#include "esp_err.h"
#include "sdkconfig.h"
#include <string.h>

#define CONTROL_Q_DEPTH 4
#define CONTROL_TX_Q_DEPTH 2
#define CONTROL_TX_MISC_DEPTH 1
#define CONTROL_BULK_Q_DEPTH 1
#define CONTROL_TX_MISC_PAYLOAD 128u
#define CONTROL_PENDING_DEPTH 8
#define CONTROL_TX_IMPORTANT_BURST_MAX 4u
#define CONTROL_TX_TERMINAL_BURST_MAX 4u
#define CONTROL_STACK_WORDS 4096
typedef struct { sb_source_t source; uint8_t type,minor,flags,channel,reserved; uint16_t service,message; uint32_t request,sequence,generation; uint32_t length; uint8_t payload[SB_SP_MAX_RX_PAYLOAD]; } request_t;
typedef sb_control_tx_candidate_t response_t;
typedef struct { sb_source_t source; uint32_t generation,ticket; uint8_t priority; sb_sp_frame_t frame; uint8_t payload[CONTROL_TX_MISC_PAYLOAD]; } misc_response_t;
/* Only control_task and its synchronous helpers use these workspaces. Public
 * transport-facing APIs retain their own stack objects; no cross-task scratch. */
static response_t s_control_response;
static union {
    sb_cbor_map_t map;
    sb_storage_file_info_t entries[SB_STORAGE_LIST_MAX];
    sb_error_record_t errors[32];
    sb_diag_snapshot_t counters;
    sb_wifi_ap_t aps[SB_WIFI_AP_CACHE_MAX];
} s_encode_scratch;
static StaticQueue_t s_rx_q_struct,s_terminal_q_struct[SB_CONTROL_ACTIVE_TX_QUEUES],s_misc_q_struct[SB_CONTROL_ACTIVE_TX_QUEUES],s_bulk_q_struct;
static uint8_t s_rx_q_data[CONTROL_Q_DEPTH*sizeof(request_t)],s_terminal_q_data[SB_CONTROL_ACTIVE_TX_QUEUES][CONTROL_TX_Q_DEPTH*sizeof(response_t)];
static uint8_t s_misc_q_data[SB_CONTROL_ACTIVE_TX_QUEUES][CONTROL_TX_MISC_DEPTH*sizeof(misc_response_t)],s_bulk_q_data[CONTROL_BULK_Q_DEPTH*sizeof(response_t)];
static QueueHandle_t s_rx_q,s_terminal_q[SB_CONTROL_ACTIVE_TX_QUEUES],s_misc_q[SB_CONTROL_ACTIVE_TX_QUEUES],s_bulk_q;static StaticTask_t s_task_struct;static StackType_t s_stack[CONTROL_STACK_WORDS];
static bool s_online[SB_SOURCE_COUNT];static uint32_t s_client_rx_limit[SB_SOURCE_COUNT],s_tx_sequence[SB_SOURCE_COUNT],s_rx_expected[SB_SOURCE_COUNT];
static bool s_subscribed[SB_SOURCE_COUNT][11],s_live_enabled[SB_SOURCE_COUNT];
static bool s_event_state_valid[10];
static uint32_t s_event_state[10];
static bool s_wifi_scan_event_valid;
static uint32_t s_wifi_scan_event_generation;
static uint32_t s_live_mask[SB_SOURCE_COUNT],s_live_interval_ms[SB_SOURCE_COUNT];
static uint64_t s_live_last_mono_us[SB_SOURCE_COUNT],s_live_drop_observed_us[SB_SOURCE_COUNT];
static uint32_t s_boot_id;
typedef struct { bool active; sb_source_t source; uint32_t generation,request_id; } pending_request_t;
static pending_request_t s_pending[CONTROL_PENDING_DEPTH];
static portMUX_TYPE s_pending_mux=portMUX_INITIALIZER_UNLOCKED;
/* A deferred cleanup names the logical generation which was invalidated.
 * The generation advances immediately; Control may process a fresh HELLO
 * before it services this record. In that case current != next(target), so
 * the old cleanup is discarded instead of clearing the new session. */
typedef struct { bool pending; uint32_t target_generation; } pending_cleanup_t;
static pending_cleanup_t s_cleanup_pending[SB_SOURCE_COUNT];
static bool s_usb_connected;
static uint32_t s_session_generation[SB_SOURCE_COUNT];
static uint32_t s_next_tx_ticket=1u;
static bool s_bulk_busy;
static sb_source_t s_bulk_source;
static uint32_t s_bulk_generation;
static uint8_t s_important_streak[SB_CONTROL_ACTIVE_TX_QUEUES];
static uint8_t s_terminal_streak[SB_CONTROL_ACTIVE_TX_QUEUES];
static portMUX_TYPE s_tx_state_mux=portMUX_INITIALIZER_UNLOCKED;
static portMUX_TYPE s_session_mux=portMUX_INITIALIZER_UNLOCKED;
/* Serializes generation advance against the bounded final dequeue. Queue calls
 * use zero wait and are the only work performed while this mux is held. */
static portMUX_TYPE s_tx_handoff_mux=portMUX_INITIALIZER_UNLOCKED;
static bool s_shutting_down;
static portMUX_TYPE s_shutdown_mux=portMUX_INITIALIZER_UNLOCKED;
static sb_control_reboot_handler_t s_reboot_handler;
static void pending_clear_source(sb_source_t source);
static uint32_t next_generation(uint32_t generation);

static void apply_disconnect(sb_source_t source)
{
    if((unsigned)source>=SB_CONTROL_ACTIVE_TX_QUEUES)return;
    s_online[source]=false;s_client_rx_limit[source]=0;s_tx_sequence[source]=0;s_rx_expected[source]=0;
    s_live_enabled[source]=false;s_live_mask[source]=0;s_live_last_mono_us[source]=0;s_live_drop_observed_us[source]=0;
    s_important_streak[source]=0u;
    s_terminal_streak[source]=0u;
    memset(s_subscribed[source],0,sizeof(s_subscribed[source]));
    pending_clear_source(source);
    if(s_terminal_q[source]) (void)xQueueReset(s_terminal_q[source]);
    if(s_misc_q[source]) (void)xQueueReset(s_misc_q[source]);
    portENTER_CRITICAL(&s_tx_state_mux);bool clear_bulk=s_bulk_busy&&s_bulk_source==source;if(clear_bulk)s_bulk_busy=false;portEXIT_CRITICAL(&s_tx_state_mux);
    if(clear_bulk&&s_bulk_q)(void)xQueueReset(s_bulk_q);
}

static void apply_pending_disconnects(void)
{
    for(unsigned source=0;source<SB_CONTROL_ACTIVE_TX_QUEUES;++source){
        bool apply=false;
        portENTER_CRITICAL(&s_tx_handoff_mux);
        portENTER_CRITICAL(&s_session_mux);
        pending_cleanup_t cleanup=s_cleanup_pending[source];
        if(cleanup.pending){
            /* The only generation at which this cleanup may run is the
             * immediate successor of the invalidated logical generation.
             * A HELLO/reset advances again and makes this token stale. */
            if(s_session_generation[source]==next_generation(cleanup.target_generation))apply=true;
            s_cleanup_pending[source].pending=false;
        }
        portEXIT_CRITICAL(&s_session_mux);
        portEXIT_CRITICAL(&s_tx_handoff_mux);
        /* Control is the sole owner of online/subscription/queue state. No
         * new HELLO can be dispatched between this decision and cleanup. */
        if(apply)apply_disconnect((sb_source_t)source);
    }
}

static uint32_t advance_generation_and_queue_cleanup(sb_source_t source)
{
    if((unsigned)source>=SB_CONTROL_ACTIVE_TX_QUEUES)return 0;
    portENTER_CRITICAL(&s_tx_handoff_mux);
    portENTER_CRITICAL(&s_session_mux);
    uint32_t target=s_session_generation[source];
    uint32_t generation=next_generation(target);
    s_session_generation[source]=generation;
    s_cleanup_pending[source]=(pending_cleanup_t){.pending=true,.target_generation=target};
    portEXIT_CRITICAL(&s_session_mux);
    portEXIT_CRITICAL(&s_tx_handoff_mux);
    sb_transfer_set_session_generation(source,generation);
    return generation;
}

static bool pending_reserve(sb_source_t source,uint32_t generation,uint32_t request_id)
{
    bool duplicate=false,inserted=false;
    portENTER_CRITICAL(&s_pending_mux);
    for(unsigned i=0;i<CONTROL_PENDING_DEPTH;++i)if(s_pending[i].active&&s_pending[i].source==source&&s_pending[i].generation==generation&&s_pending[i].request_id==request_id){duplicate=true;break;}
    if(!duplicate)for(unsigned i=0;i<CONTROL_PENDING_DEPTH;++i)if(!s_pending[i].active){s_pending[i]=(pending_request_t){.active=true,.source=source,.generation=generation,.request_id=request_id};inserted=true;break;}
    portEXIT_CRITICAL(&s_pending_mux);
    if(duplicate)sb_diag_increment(SB_DIAG_PROTOCOL,6);
    return inserted;
}
static void pending_release(sb_source_t source,uint32_t generation,uint32_t request_id)
{
    portENTER_CRITICAL(&s_pending_mux);
    for(unsigned i=0;i<CONTROL_PENDING_DEPTH;++i)if(s_pending[i].active&&s_pending[i].source==source&&s_pending[i].generation==generation&&s_pending[i].request_id==request_id){s_pending[i].active=false;break;}
    portEXIT_CRITICAL(&s_pending_mux);
}
static void pending_clear_source(sb_source_t source)
{
    portENTER_CRITICAL(&s_pending_mux);
    for(unsigned i=0;i<CONTROL_PENDING_DEPTH;++i)if(s_pending[i].active&&s_pending[i].source==source)s_pending[i].active=false;
    portEXIT_CRITICAL(&s_pending_mux);
}

static uint32_t next_generation(uint32_t generation)
{
    if(++generation==0u)++generation;
    return generation;
}

static uint32_t advance_generation(sb_source_t source)
{
    if((unsigned)source>=SB_SOURCE_COUNT)return 0;
    portENTER_CRITICAL(&s_tx_handoff_mux);
    portENTER_CRITICAL(&s_session_mux);
    uint32_t generation=next_generation(s_session_generation[source]);
    s_session_generation[source]=generation;
    portEXIT_CRITICAL(&s_session_mux);
    portEXIT_CRITICAL(&s_tx_handoff_mux);
    sb_transfer_set_session_generation(source,generation);
    return generation;
}

static uint32_t current_generation(sb_source_t source)
{
    if((unsigned)source>=SB_SOURCE_COUNT)return 0;
    portENTER_CRITICAL(&s_session_mux);uint32_t generation=s_session_generation[source];portEXIT_CRITICAL(&s_session_mux);
    return generation;
}

static void reset_logical_session(sb_source_t source,bool advance)
{
    if(advance)(void)advance_generation(source);
    apply_disconnect(source);
}

static uint8_t tx_priority(const response_t *response)
{
    return sb_control_tx_priority(response->frame.type,response->frame.service_id);
}

static bool tx_enqueue(response_t *response)
{
    if(response==NULL||(unsigned)response->source>=SB_CONTROL_ACTIVE_TX_QUEUES||
       response->generation!=current_generation(response->source))return false;
    if(response->frame.type==SB_SP_BULK&&response->frame.storage_epoch!=sb_storage_epoch_generation()){
        reset_logical_session(response->source,true);return false;
    }
    response->priority=tx_priority(response);
    portENTER_CRITICAL(&s_tx_handoff_mux);
    if(++s_next_tx_ticket==0u)++s_next_tx_ticket;
    response->ticket=s_next_tx_ticket;
    portEXIT_CRITICAL(&s_tx_handoff_mux);
    /* Queued items own their payload array; never retain the producer's raw pointer. */
    response->frame.payload=NULL;
    bool queued=false;
    if(response->priority==SB_CONTROL_TX_PRIORITY_RESPONSE){
        portENTER_CRITICAL(&s_tx_handoff_mux);
        bool generation_current=s_session_generation[response->source]==response->generation;
        queued=generation_current&&s_terminal_q[response->source]&&
               xQueueSend(s_terminal_q[response->source],response,0)==pdTRUE;
        portEXIT_CRITICAL(&s_tx_handoff_mux);
        if(!generation_current)return false;
        if(!queued){sb_diag_increment(SB_DIAG_TRANSPORT,response->source*5u+2u);reset_logical_session(response->source,true);}
        return queued;
    }
    if(response->priority==SB_CONTROL_TX_PRIORITY_BULK){
        portENTER_CRITICAL(&s_tx_handoff_mux);
        bool generation_current=s_session_generation[response->source]==response->generation;
        portENTER_CRITICAL(&s_tx_state_mux);bool available=generation_current&&!s_bulk_busy;
        if(available){s_bulk_busy=true;s_bulk_source=response->source;s_bulk_generation=response->generation;}
        portEXIT_CRITICAL(&s_tx_state_mux);
        queued=available&&s_bulk_q&&xQueueSend(s_bulk_q,response,0)==pdTRUE;
        if(available&&!queued){portENTER_CRITICAL(&s_tx_state_mux);
            if(s_bulk_busy&&s_bulk_source==response->source&&s_bulk_generation==response->generation)s_bulk_busy=false;
            portEXIT_CRITICAL(&s_tx_state_mux);}
        portEXIT_CRITICAL(&s_tx_handoff_mux);
        if(!generation_current)return false;
        if(!queued){
            sb_diag_increment(SB_DIAG_TRANSPORT,response->source*5u+2u);reset_logical_session(response->source,true);return false;
        }
        return true;
    }
    if(response->frame.payload_length>CONTROL_TX_MISC_PAYLOAD){sb_diag_increment(SB_DIAG_TRANSPORT,response->source*5u+2u);return false;}
    QueueHandle_t queue=s_misc_q[response->source];if(queue==NULL)return false;
    misc_response_t item={.source=response->source,.generation=response->generation,.ticket=response->ticket,.priority=response->priority,.frame=response->frame};
    item.frame.payload=NULL;
    if(item.frame.payload_length)memcpy(item.payload,response->payload,item.frame.payload_length);
    misc_response_t existing;
    portENTER_CRITICAL(&s_tx_handoff_mux);
    bool generation_current=s_session_generation[response->source]==response->generation;
    if(!generation_current){portEXIT_CRITICAL(&s_tx_handoff_mux);return false;}
    if(xQueuePeek(queue,&existing,0)!=pdTRUE){queued=xQueueSend(queue,&item,0)==pdTRUE;portEXIT_CRITICAL(&s_tx_handoff_mux);return queued;}
    if(sb_control_tx_misc_replace(existing.priority,response->priority)){
        /* Events are recoverable through status/error history; Live keeps the newest fix. */
        queued=xQueueOverwrite(queue,&item)==pdTRUE;portEXIT_CRITICAL(&s_tx_handoff_mux);return queued;
    }
    portEXIT_CRITICAL(&s_tx_handoff_mux);
    sb_diag_increment(SB_DIAG_TRANSPORT,response->source*5u+2u);
    return false;
}

static bool tx_has_queued(sb_source_t source)
{
    portENTER_CRITICAL(&s_tx_state_mux);bool bulk_busy=s_bulk_busy&&s_bulk_source==source;portEXIT_CRITICAL(&s_tx_state_mux);
    return (s_terminal_q[source]&&uxQueueMessagesWaiting(s_terminal_q[source])!=0u)||
           (s_misc_q[source]&&uxQueueMessagesWaiting(s_misc_q[source])!=0u)||
           bulk_busy;
}

static bool command_exists(uint16_t s,uint16_t c)
{
    static const uint8_t counts[10]={0,5,3,2,4,3,6,2,3,1};
    return s>=1&&s<=9&&c>=1&&c<=counts[s];
}
static bool put_key(uint8_t*b,size_t cap,size_t*n,uint8_t key){return sb_cbor_put_uint(b,cap,n,key);}
static bool put_status(uint8_t*out,size_t cap,size_t*n,sb_status_t status,const uint8_t*data,size_t data_n)
{
    if(!sb_cbor_put_map(out,cap,n,data_n?2:1)||!put_key(out,cap,n,0)||!sb_cbor_put_uint(out,cap,n,status))return false;
    if(data_n){if(!put_key(out,cap,n,1)||data_n>cap-*n)return false;memcpy(out+*n,data,data_n);*n+=data_n;}return true;
}
static bool encode_hello(sb_source_t source,bool logical_reset,const sb_cbor_map_t*map,uint8_t*out,size_t cap,size_t*n,sb_status_t*status)
{
    const sb_cbor_value_t*v=sb_cbor_get(map,0);if(!v||v->kind!=SB_CBOR_UINT){*status=SB_INVALID_REQUEST;return true;}
    const sb_cbor_value_t*name=sb_cbor_get(map,1);if(name&&name->kind!=SB_CBOR_TEXT){*status=SB_INVALID_REQUEST;return true;}
    if(v->u<SB_SP_BOOTSTRAP_MIN_RX_PAYLOAD||v->u>UINT32_MAX){*status=SB_OUT_OF_RANGE;return true;}
    uint8_t data[256];size_t d=0;sb_board_info_t board;sb_board_get_info(&board);
    uint8_t id[8];sb_write_le64(id,board.device_id);
    if(!sb_cbor_put_map(data,sizeof(data),&d,8)||!put_key(data,sizeof(data),&d,0)||!sb_cbor_put_bytes(data,sizeof(data),&d,id,sizeof(id))||
       !put_key(data,sizeof(data),&d,1)||!sb_cbor_put_uint(data,sizeof(data),&d,s_boot_id)||
       !put_key(data,sizeof(data),&d,2)||!sb_cbor_put_uint(data,sizeof(data),&d,1)||
       !put_key(data,sizeof(data),&d,3)||!sb_cbor_put_uint(data,sizeof(data),&d,0)||
       !put_key(data,sizeof(data),&d,4)||!sb_cbor_put_uint(data,sizeof(data),&d,source)||
       !put_key(data,sizeof(data),&d,5)||!sb_cbor_put_uint(data,sizeof(data),&d,SB_SP_MAX_RX_PAYLOAD)||
       !put_key(data,sizeof(data),&d,6)||!sb_cbor_put_uint(data,sizeof(data),&d,1024)||
       !put_key(data,sizeof(data),&d,7)||!sb_cbor_put_array(data,sizeof(data),&d,9))return false;
    for(uint16_t service=1;service<=9;++service)if(!sb_cbor_put_uint(data,sizeof(data),&d,service))return false;
    s_online[source]=true;s_client_rx_limit[source]=(uint32_t)v->u;
    s_tx_sequence[source]=(source==SB_SOURCE_WIFI&&!logical_reset?2u:1u);s_rx_expected[source]=1;
    if(source==SB_SOURCE_WIFI)sb_wifi_mark_hello_complete();
    if(source==SB_SOURCE_BLE)sb_ble_mark_hello_complete();
    if(d>cap)return false;
    memcpy(out,data,d);*n=d;*status=SB_OK;return true;
}
static bool encode_info(uint8_t*out,size_t cap,size_t*n)
{
    sb_board_info_t b;sb_board_get_info(&b);if(!sb_cbor_put_map(out,cap,n,5))return false;
    return put_key(out,cap,n,0)&&sb_cbor_put_text(out,cap,n,"Sailball",8)&&put_key(out,cap,n,1)&&sb_cbor_put_text(out,cap,n,"ESP32-C3",8)&&
        put_key(out,cap,n,2)&&sb_cbor_put_text(out,cap,n,b.hardware_revision,strlen(b.hardware_revision))&&put_key(out,cap,n,3)&&sb_cbor_put_text(out,cap,n,"1.0.0",5)&&
        put_key(out,cap,n,4)&&sb_cbor_put_text(out,cap,n,"ESP-IDF",7);
}
static uint32_t status_age_ms(uint64_t now,uint64_t then)
{
    uint64_t age=now>=then?(now-then)/1000u:0;
    return age>=UINT32_MAX?UINT32_MAX-1u:(uint32_t)age;
}

static uint16_t gcd_status(uint16_t a,uint16_t b)
{
    while(b){uint16_t r=(uint16_t)(a%b);a=b;b=r;}return a;
}

static bool encode_status_group(uint8_t*out,size_t cap,size_t*n,uint32_t bit)
{
    sb_gnss_fix_t fix={0};sb_gnss_state_t gs;uint64_t last_rx=0,last_fix=0;
    sb_gnss_get_snapshot(&fix,&gs,&last_rx,&last_fix);
    uint64_t now=sb_monotonic_us();
    if(bit==0){
        esp_reset_reason_t r=esp_reset_reason();uint8_t rr=r==ESP_RST_POWERON?1:r==ESP_RST_SW?2:
            (r==ESP_RST_TASK_WDT||r==ESP_RST_WDT)?3:r==ESP_RST_BROWNOUT?4:r==ESP_RST_DEEPSLEEP?5:r==ESP_RST_EXT?6:0;
        return sb_cbor_put_map(out,cap,n,3)&&put_key(out,cap,n,0)&&sb_cbor_put_uint(out,cap,n,now/1000u)&&
            put_key(out,cap,n,1)&&sb_cbor_put_bool(out,cap,n,sb_supervisor_critical_healthy())&&
            put_key(out,cap,n,2)&&sb_cbor_put_uint(out,cap,n,rr);
    }
    if(bit==1){
        size_t count=7u+(fix.satellites_valid?1u:0u)+(last_fix?1u:0u);
        uint64_t rx_age=last_rx?status_age_ms(now,last_rx):UINT32_MAX;
        uint16_t num=CONFIG_SAILBALL_GNSS_SAMPLE_RATE_NUM,den=CONFIG_SAILBALL_GNSS_SAMPLE_RATE_DEN;
        uint16_t gcd=gcd_status(num,den);if(gcd){num=(uint16_t)(num/gcd);den=(uint16_t)(den/gcd);}
        if(!sb_cbor_put_map(out,cap,n,count)||!put_key(out,cap,n,0)||!sb_cbor_put_uint(out,cap,n,gs)||
           !put_key(out,cap,n,1)||!sb_cbor_put_uint(out,cap,n,sb_fix_to_sp(fix.fix_type)))return false;
        if(fix.satellites_valid&&(!put_key(out,cap,n,2)||!sb_cbor_put_uint(out,cap,n,fix.satellites_used)))return false;
        if(!put_key(out,cap,n,3)||!sb_cbor_put_bool(out,cap,n,fix.position_valid)||
           !put_key(out,cap,n,4)||!sb_cbor_put_bool(out,cap,n,fix.utc_valid)||
           !put_key(out,cap,n,5)||!sb_cbor_put_uint(out,cap,n,rx_age))return false;
        if(last_fix&&(!put_key(out,cap,n,6)||!sb_cbor_put_uint(out,cap,n,status_age_ms(now,last_fix))))return false;
        return put_key(out,cap,n,7)&&sb_cbor_put_uint(out,cap,n,num)&&put_key(out,cap,n,8)&&sb_cbor_put_uint(out,cap,n,den);
    }
    if(bit==2){
        sb_recorder_state_t rs;uint32_t session,block;uint64_t start,unused,last_commit;int64_t start_utc;bool utc_valid;
        sb_recorder_get_snapshot(&rs,NULL,&session,&block,&start,&unused,&last_commit);
        sb_recorder_get_utc_start(&start_utc,&utc_valid);
        if(rs==SB_RECORDER_STOPPED)return sb_cbor_put_map(out,cap,n,1)&&put_key(out,cap,n,0)&&sb_cbor_put_uint(out,cap,n,rs);
        char file_name[64]={0};uint64_t readable_size;bool active;
        sb_storage_get_file_snapshot(file_name,&readable_size,&active);(void)readable_size;
        bool name_valid=active&&file_name[0]!=0;
        size_t count=3u+(start?1u:0u)+(utc_valid?1u:0u)+(last_commit?1u:0u)+(name_valid?1u:0u);
        if(!sb_cbor_put_map(out,cap,n,count)||!put_key(out,cap,n,0)||!sb_cbor_put_uint(out,cap,n,rs)||
           !put_key(out,cap,n,1)||!sb_cbor_put_uint(out,cap,n,session))return false;
        if(start&&(!put_key(out,cap,n,2)||!sb_cbor_put_uint(out,cap,n,start)))return false;
        if(utc_valid&&(!put_key(out,cap,n,3)||!sb_cbor_put_int(out,cap,n,start_utc)))return false;
        if(!put_key(out,cap,n,4)||!sb_cbor_put_uint(out,cap,n,block))return false;
        if(last_commit&&(!put_key(out,cap,n,5)||!sb_cbor_put_uint(out,cap,n,status_age_ms(now,last_commit))))return false;
        return !name_valid||(put_key(out,cap,n,6)&&sb_cbor_put_text(out,cap,n,file_name,strlen(file_name)));
    }
    if(bit==3){
        uint64_t total=0,free_bytes=0;sb_storage_get_size_snapshot(&total,&free_bytes);sb_storage_state_t state=sb_storage_get_state();
        bool known=state==SB_STORAGE_READY&&total!=0;
        size_t count=1u+(known?2u:0u);
        return sb_cbor_put_map(out,cap,n,count)&&put_key(out,cap,n,0)&&sb_cbor_put_uint(out,cap,n,state)&&
            (!known||(put_key(out,cap,n,1)&&sb_cbor_put_uint(out,cap,n,total)&&put_key(out,cap,n,2)&&sb_cbor_put_uint(out,cap,n,free_bytes)));
    }
    if(bit==4){
        portENTER_CRITICAL(&s_session_mux);bool physically_connected=s_usb_connected;portEXIT_CRITICAL(&s_session_mux);
        uint8_t state=!physically_connected?0:s_online[SB_SOURCE_USB]?2:1;
        return sb_cbor_put_map(out,cap,n,1)&&put_key(out,cap,n,0)&&sb_cbor_put_uint(out,cap,n,state);
    }
    if(bit==5){
        uint16_t mtu;bool have_mtu=sb_ble_get_mtu(&mtu);
        return sb_cbor_put_map(out,cap,n,have_mtu?2:1)&&put_key(out,cap,n,0)&&sb_cbor_put_uint(out,cap,n,sb_ble_get_state())&&
            (!have_mtu||(put_key(out,cap,n,1)&&sb_cbor_put_uint(out,cap,n,mtu)));
    }
    if(bit==6){
        sb_wifi_snapshot_t wifi;sb_wifi_get_snapshot(&wifi);size_t count=3u+(wifi.configured?1u:0u)+(wifi.rssi_valid?1u:0u)+(wifi.ipv4_valid?1u:0u)+(wifi.last_error_valid?1u:0u);
        if(!sb_cbor_put_map(out,cap,n,count)||!put_key(out,cap,n,0)||!sb_cbor_put_uint(out,cap,n,wifi.state)||
           !put_key(out,cap,n,1)||!sb_cbor_put_bool(out,cap,n,wifi.configured))return false;
        if(wifi.configured&&(!put_key(out,cap,n,2)||!sb_cbor_put_bytes(out,cap,n,wifi.ssid,wifi.ssid_length)))return false;
        if(wifi.rssi_valid&&(!put_key(out,cap,n,3)||!sb_cbor_put_int(out,cap,n,wifi.rssi)))return false;
        if(wifi.ipv4_valid&&(!put_key(out,cap,n,4)||!sb_cbor_put_bytes(out,cap,n,wifi.ipv4,4)))return false;
        if(!put_key(out,cap,n,5)||!sb_cbor_put_uint(out,cap,n,wifi.scan_generation))return false;
        return !wifi.last_error_valid||(put_key(out,cap,n,6)&&sb_cbor_put_uint(out,cap,n,wifi.last_error));
    }
    if(bit==8)return sb_cbor_put_map(out,cap,n,1)&&put_key(out,cap,n,0)&&sb_cbor_put_uint(out,cap,n,sb_ui_get_page());
    return false;
}
static bool encode_get_status(const sb_cbor_map_t*m,uint8_t*out,size_t cap,size_t*n,sb_status_t*status)
{
    const sb_cbor_value_t*v=sb_cbor_get(m,0);if(!v||v->kind!=SB_CBOR_UINT||v->u==0||v->u>UINT32_MAX){*status=SB_INVALID_REQUEST;return true;}
    uint32_t requested=(uint32_t)v->u,returned=requested&0x17Fu;uint8_t *data=out;size_t d=0;size_t groups=0;
    for(uint32_t bit=0;bit<9;++bit)if((returned&(1u<<bit))&&bit!=7)++groups;
    if(!sb_cbor_put_map(data,cap,&d,groups+1)||!put_key(data,cap,&d,0)||!sb_cbor_put_uint(data,cap,&d,returned))return false;
    for(uint32_t bit=0;bit<9;++bit){if((returned&(1u<<bit))==0||bit==7)continue;if(!put_key(data,cap,&d,(uint8_t)(bit+1))||!encode_status_group(data,cap,&d,bit))return false;}
    *n=d;*status=SB_OK;return true;
}

static bool encode_scan_results(uint8_t *out,size_t capacity,size_t *length)
{
    sb_wifi_ap_t *aps=s_encode_scratch.aps;uint32_t generation=0;
    size_t count=sb_wifi_get_scan_results(aps,SB_WIFI_AP_CACHE_MAX,&generation),n=0;
    if(!sb_cbor_put_map(out,capacity,&n,2)||!sb_cbor_put_uint(out,capacity,&n,0)||!sb_cbor_put_uint(out,capacity,&n,generation)||
       !sb_cbor_put_uint(out,capacity,&n,1)||!sb_cbor_put_array(out,capacity,&n,count))return false;
    for(size_t i=0;i<count;++i){
        if(!sb_cbor_put_map(out,capacity,&n,5)||!sb_cbor_put_uint(out,capacity,&n,0)||!sb_cbor_put_bytes(out,capacity,&n,aps[i].ssid,aps[i].ssid_length)||
           !sb_cbor_put_uint(out,capacity,&n,1)||!sb_cbor_put_int(out,capacity,&n,aps[i].rssi)||
           !sb_cbor_put_uint(out,capacity,&n,2)||!sb_cbor_put_uint(out,capacity,&n,aps[i].security)||
           !sb_cbor_put_uint(out,capacity,&n,3)||!sb_cbor_put_uint(out,capacity,&n,aps[i].channel)||
           !sb_cbor_put_uint(out,capacity,&n,4)||!sb_cbor_put_bytes(out,capacity,&n,aps[i].bssid,sizeof(aps[i].bssid)))return false;
    }
    *length=n;return true;
}

static bool encode_storage_list(const sb_cbor_map_t *map, sb_source_t source,
                                uint8_t *out, size_t capacity, size_t *length, sb_status_t *status)
{
    const sb_cbor_value_t *offset_value = sb_cbor_get(map, 0), *limit_value = sb_cbor_get(map, 1);
    if (offset_value == NULL || limit_value == NULL || offset_value->kind != SB_CBOR_UINT ||
        limit_value->kind != SB_CBOR_UINT) { *status = SB_INVALID_REQUEST; return true; }
    if (offset_value->u > UINT32_MAX || limit_value->u < 1 || limit_value->u > SB_STORAGE_LIST_MAX) {
        *status = SB_OUT_OF_RANGE; return true;
    }

    uint32_t offset=(uint32_t)offset_value->u;
    uint8_t limit=(uint8_t)limit_value->u;
    sb_storage_file_info_t *entries=s_encode_scratch.entries;
    size_t count = 0;
    uint32_t next_offset = 0;
    bool complete = false;
    *status = sb_storage_list_files(offset, limit, entries,
                                    SB_STORAGE_LIST_MAX, &count, &next_offset, &complete);
    if (*status != SB_OK) return true;

    size_t data_capacity = capacity;
    uint32_t client_limit = s_client_rx_limit[source];
    if (client_limit < data_capacity + 8u) data_capacity = client_limit > 8u ? client_limit - 8u : 0u;
    size_t chosen = count;
    for (;;) {
        size_t n = 0;
        bool page_complete = complete && chosen == count;
        bool ok = sb_cbor_put_map(out, data_capacity, &n, 3) &&
                  sb_cbor_put_uint(out, data_capacity, &n, 0) &&
                  sb_cbor_put_array(out, data_capacity, &n, chosen);
        for (size_t i = 0; ok && i < chosen; ++i) {
            ok = sb_cbor_put_map(out, data_capacity, &n, 3) &&
                 sb_cbor_put_uint(out, data_capacity, &n, 0) &&
                 sb_cbor_put_text(out, data_capacity, &n, entries[i].file_name, strlen(entries[i].file_name)) &&
                 sb_cbor_put_uint(out, data_capacity, &n, 1) &&
                 sb_cbor_put_uint(out, data_capacity, &n, entries[i].readable_size) &&
                 sb_cbor_put_uint(out, data_capacity, &n, 2) &&
                 sb_cbor_put_bool(out, data_capacity, &n, entries[i].active);
        }
        if (ok) ok = sb_cbor_put_uint(out, data_capacity, &n, 1) &&
                     sb_cbor_put_uint(out, data_capacity, &n, offset + (uint32_t)chosen) &&
                     sb_cbor_put_uint(out, data_capacity, &n, 2) &&
                     sb_cbor_put_bool(out, data_capacity, &n, page_complete);
        if (ok) { *length = n; *status = SB_OK; return true; }
        if (chosen == 0) { *status = SB_OUT_OF_RANGE; return true; }
        --chosen;
    }
}

static bool parse_storage_name(const sb_cbor_map_t *map, char file_name[64])
{
    const sb_cbor_value_t *value = sb_cbor_get(map, 0);
    if (value == NULL || value->kind != SB_CBOR_TEXT) return false;
    if (value->length == 0 || value->length >= 64 || memchr(value->bytes, 0, value->length) != NULL) return false;
    memcpy(file_name, value->bytes, value->length);
    file_name[value->length] = '\0';
    return true;
}

static bool supported_event_service(uint64_t service)
{
    return service==1||service==3||service==4||service==6||service==7||service==8||service==9;
}

static bool encode_counters(const sb_cbor_map_t *map,uint8_t *out,size_t capacity,size_t *length,sb_status_t *status)
{
    const sb_cbor_value_t *mask=sb_cbor_get(map,0);
    if(!mask||mask->kind!=SB_CBOR_UINT||mask->u==0||mask->u>UINT32_MAX){*status=SB_INVALID_REQUEST;return true;}
    uint32_t requested=(uint32_t)mask->u,returned=requested&0x3Fu;
    sb_diag_snapshot_t *snapshot=&s_encode_scratch.counters;sb_diag_snapshot(snapshot);
    size_t groups=0;for(unsigned i=0;i<6;++i)if(returned&(1u<<i))++groups;
    size_t n=0;if(!sb_cbor_put_map(out,capacity,&n,groups+1)||!sb_cbor_put_uint(out,capacity,&n,0)||!sb_cbor_put_uint(out,capacity,&n,returned))return false;
    for(unsigned group=0;group<6;++group){
        if((returned&(1u<<group))==0)continue;
        if(!sb_cbor_put_uint(out,capacity,&n,group+1))return false;
        if(group==4){
            if(!sb_cbor_put_map(out,capacity,&n,SB_SOURCE_COUNT))return false;
            for(unsigned source=0;source<SB_SOURCE_COUNT;++source){if(!sb_cbor_put_uint(out,capacity,&n,source)||!sb_cbor_put_map(out,capacity,&n,5))return false;
                for(unsigned counter=0;counter<5;++counter)if(!sb_cbor_put_uint(out,capacity,&n,counter)||!sb_cbor_put_uint(out,capacity,&n,snapshot->value[SB_DIAG_TRANSPORT][source*5u+counter]))return false;}
        }else{
            unsigned internal=(group==5)?SB_DIAG_PROTOCOL:group;
            unsigned count=group==0?6u:group==1?5u:group==2?8u:group==3?5u:8u;
            if(!sb_cbor_put_map(out,capacity,&n,count))return false;
            for(unsigned counter=0;counter<count;++counter)if(!sb_cbor_put_uint(out,capacity,&n,counter)||!sb_cbor_put_uint(out,capacity,&n,snapshot->value[internal][counter]))return false;
        }
    }
    *length=n;*status=SB_OK;return true;
}

static bool encode_error_entry(const sb_error_record_t *error,uint8_t *out,size_t capacity,size_t *length)
{
    size_t n=0;size_t pairs=error->utc_valid?8u:7u;
    if(!sb_cbor_put_map(out,capacity,&n,pairs)||!sb_cbor_put_uint(out,capacity,&n,0)||!sb_cbor_put_uint(out,capacity,&n,error->error_id)||
       !sb_cbor_put_uint(out,capacity,&n,1)||!sb_cbor_put_uint(out,capacity,&n,error->first_mono_us)||
       !sb_cbor_put_uint(out,capacity,&n,2)||!sb_cbor_put_uint(out,capacity,&n,error->last_mono_us)||
       !sb_cbor_put_uint(out,capacity,&n,3)||!sb_cbor_put_uint(out,capacity,&n,error->service_id)||
       !sb_cbor_put_uint(out,capacity,&n,4)||!sb_cbor_put_uint(out,capacity,&n,error->error_code)||
       !sb_cbor_put_uint(out,capacity,&n,5)||!sb_cbor_put_uint(out,capacity,&n,error->severity)||
       !sb_cbor_put_uint(out,capacity,&n,6)||!sb_cbor_put_uint(out,capacity,&n,error->occurrence_count))return false;
    if(error->utc_valid&&(!sb_cbor_put_uint(out,capacity,&n,7)||!sb_cbor_put_int(out,capacity,&n,error->utc_us)))return false;
    *length=n;return true;
}

static bool encode_errors(const sb_cbor_map_t *map,uint8_t *out,size_t capacity,size_t *length,sb_status_t *status)
{
    const sb_cbor_value_t *after=sb_cbor_get(map,0),*limit_value=sb_cbor_get(map,1);
    bool has_after=after!=NULL;uint32_t after_id=0;size_t limit=16;
    if(after){if(after->kind!=SB_CBOR_UINT||after->u>UINT32_MAX){*status=SB_INVALID_REQUEST;return true;}after_id=(uint32_t)after->u;}
    if(limit_value){if(limit_value->kind!=SB_CBOR_UINT){*status=SB_INVALID_REQUEST;return true;}if(limit_value->u<1||limit_value->u>32){*status=SB_OUT_OF_RANGE;return true;}limit=(size_t)limit_value->u;}
    sb_error_record_t *errors=s_encode_scratch.errors;uint32_t oldest=0,newest=0;
    size_t count=sb_diag_get_errors(after_id,has_after,limit,errors,&oldest,&newest);
    size_t chosen=count,n=0;
    for(;;){
        n=0;bool ok=sb_cbor_put_map(out,capacity,&n,3)&&sb_cbor_put_uint(out,capacity,&n,0)&&sb_cbor_put_array(out,capacity,&n,chosen);
        for(size_t i=0;ok&&i<chosen;++i){size_t entry_n=0;ok=encode_error_entry(&errors[i],out+n,capacity-n,&entry_n);n+=entry_n;}
        if(ok)ok=sb_cbor_put_uint(out,capacity,&n,1)&&sb_cbor_put_uint(out,capacity,&n,oldest)&&sb_cbor_put_uint(out,capacity,&n,2)&&sb_cbor_put_uint(out,capacity,&n,newest);
        if(ok){*length=n;*status=SB_OK;return true;}
        if(chosen==0){*status=SB_OUT_OF_RANGE;return true;}
        --chosen;
    }
}
static sb_status_t dispatch(uint8_t *payload,size_t *payload_n,const request_t*r)
{
    portENTER_CRITICAL(&s_shutdown_mux);bool shutting_down=s_shutting_down;portEXIT_CRITICAL(&s_shutdown_mux);
    if(shutting_down)return SB_INVALID_STATE;
    if(r->service==1&&r->message==1){
        if(r->sequence!=0)return SB_INVALID_STATE;
        sb_cbor_map_t *hello=&s_encode_scratch.map;if(!sb_cbor_parse_map(r->payload,r->length,hello))return SB_INVALID_REQUEST;
        const sb_cbor_value_t*max_rx=sb_cbor_get(hello,0);const sb_cbor_value_t*name=sb_cbor_get(hello,1);
        if(!max_rx||max_rx->kind!=SB_CBOR_UINT||(name&&name->kind!=SB_CBOR_TEXT))return SB_INVALID_REQUEST;
        if(max_rx->u<SB_SP_BOOTSTRAP_MIN_RX_PAYLOAD||max_rx->u>UINT32_MAX)return SB_OUT_OF_RANGE;
        bool logical_reset=s_online[r->source];
        if(logical_reset)reset_logical_session(r->source,true);
        memset(s_subscribed[r->source],0,sizeof(s_subscribed[r->source]));s_live_enabled[r->source]=false;s_live_last_mono_us[r->source]=0;
        sb_status_t status;if(!encode_hello(r->source,logical_reset,hello,payload,SB_SP_MAX_RX_PAYLOAD,payload_n,&status))return SB_INTERNAL_ERROR;return status;
    }
    if(!s_online[r->source])return SB_INVALID_STATE;
    if(r->sequence!=s_rx_expected[r->source])sb_diag_increment(SB_DIAG_PROTOCOL,5);
    s_rx_expected[r->source]=r->sequence+1u;
    sb_cbor_map_t *map=&s_encode_scratch.map;if(!sb_cbor_parse_map(r->payload,r->length,map))return SB_INVALID_REQUEST;
    if(r->service==1&&r->message==2){return encode_info(payload,SB_SP_MAX_RX_PAYLOAD,payload_n)?SB_OK:SB_INTERNAL_ERROR;}
    if(r->service==1&&r->message==3){sb_status_t status;if(!encode_get_status(map,payload,SB_SP_MAX_RX_PAYLOAD,payload_n,&status))return SB_INTERNAL_ERROR;if(status!=SB_OK)*payload_n=0;return status;}
    if(r->service==1&&r->message==5)return SB_ACCEPTED;
    if(r->service==1&&r->message==4){
        const sb_cbor_value_t*v=sb_cbor_get(map,0);if(!v||v->kind!=SB_CBOR_ARRAY)return SB_INVALID_REQUEST;if(v->u>32)return SB_OUT_OF_RANGE;
        bool next[11]={0};for(size_t i=0;i<(size_t)v->u;++i){sb_cbor_value_t item;if(!sb_cbor_array_get(v,i,&item)||item.kind!=SB_CBOR_UINT)return SB_INVALID_REQUEST;if(item.u<=UINT16_MAX&&supported_event_service(item.u))next[item.u]=true;}
        memcpy(s_subscribed[r->source],next,sizeof(next));return SB_OK;
    }
    if(r->service==2&&r->message==1){
        const sb_cbor_value_t*v=sb_cbor_get(map,0),*interval=sb_cbor_get(map,1);if(!v||v->kind!=SB_CBOR_UINT||v->u==0||v->u>UINT32_MAX)return SB_INVALID_REQUEST;
        if(interval&&(interval->kind!=SB_CBOR_UINT||interval->u>UINT32_MAX))return SB_INVALID_REQUEST;
        uint32_t mask=(uint32_t)v->u&0x7Fu;if(mask==0)return SB_UNSUPPORTED;
        uint32_t min_interval=interval?(uint32_t)interval->u:0;size_t n=0;
        if(!sb_cbor_put_map(payload,SB_SP_MAX_RX_PAYLOAD,&n,2)||!sb_cbor_put_uint(payload,SB_SP_MAX_RX_PAYLOAD,&n,0)||!sb_cbor_put_uint(payload,SB_SP_MAX_RX_PAYLOAD,&n,mask)||!sb_cbor_put_uint(payload,SB_SP_MAX_RX_PAYLOAD,&n,1)||!sb_cbor_put_uint(payload,SB_SP_MAX_RX_PAYLOAD,&n,min_interval))return SB_INTERNAL_ERROR;
        *payload_n=n;s_live_mask[r->source]=mask;s_live_interval_ms[r->source]=min_interval;s_live_last_mono_us[r->source]=0;s_live_enabled[r->source]=true;return SB_OK;
    }
    if(r->service==2&&r->message==2){s_live_enabled[r->source]=false;s_live_mask[r->source]=0;return SB_OK;}
    if(r->service==2&&r->message==3)return r->source==SB_SOURCE_USB?(sb_gnss_request_restart(),SB_ACCEPTED):SB_PERMISSION_DENIED;
    if(r->service==3&&r->message==1)return sb_recorder_request_start();
    if(r->service==3&&r->message==2)return sb_recorder_request_stop();
    if(r->service==7&&r->message==1){const sb_cbor_value_t*v=sb_cbor_get(map,0);if(!v||v->kind!=SB_CBOR_BOOL)return SB_INVALID_REQUEST;return sb_ble_set_advertising(v->boolean,r->source);}
    if(r->service==7&&r->message==2)return sb_ble_disconnect(r->source);
    if(r->service==6&&r->message==1)return sb_wifi_request_scan(r->source);
    if(r->service==6&&r->message==2)return encode_scan_results(payload,SB_SP_MAX_RX_PAYLOAD,payload_n)?SB_OK:SB_INTERNAL_ERROR;
    if(r->service==6&&r->message==3){
        const sb_cbor_value_t*ssid=sb_cbor_get(map,0),*password=sb_cbor_get(map,1);
        if(!ssid||!password||ssid->kind!=SB_CBOR_BYTES||password->kind!=SB_CBOR_BYTES)return SB_INVALID_REQUEST;
        if(ssid->length<1||ssid->length>SB_WIFI_SSID_MAX||password->length>64)return SB_OUT_OF_RANGE;
        return sb_wifi_request_set_config(r->source,ssid->bytes,ssid->length,password->bytes,password->length);
    }
    if(r->service==6&&r->message==4){
        const sb_cbor_value_t*type=sb_cbor_get(map,0),*address=sb_cbor_get(map,1),*port=sb_cbor_get(map,2),*handover=sb_cbor_get(map,3);
        if(!type||!address||!port||!handover||type->kind!=SB_CBOR_UINT||address->kind!=SB_CBOR_BYTES||port->kind!=SB_CBOR_UINT||handover->kind!=SB_CBOR_UINT)return SB_INVALID_REQUEST;
        if(type->u>2)return SB_OUT_OF_RANGE;
        if(type->u!=0)return SB_UNSUPPORTED;
        if(address->length!=4||port->u==0||port->u>UINT16_MAX||handover->u==0||handover->u>UINT32_MAX)return SB_OUT_OF_RANGE;
        return sb_wifi_request_connect(r->source,address->bytes,(uint16_t)port->u,(uint32_t)handover->u);
    }
    if(r->service==6&&r->message==5)return sb_wifi_request_disconnect(r->source);
    if(r->service==6&&r->message==6)return sb_wifi_request_forget(r->source);
    if(r->service==4&&r->message==1){sb_status_t result;if(!encode_storage_list(map,r->source,payload,SB_SP_MAX_RX_PAYLOAD,payload_n,&result))return SB_INTERNAL_ERROR;return result;}
    if(r->service==4&&r->message==2){
        char file_name[64];if(!parse_storage_name(map,file_name))return SB_INVALID_REQUEST;
        sb_storage_file_info_t info;sb_status_t result=sb_storage_get_file_info(file_name,&info);if(result!=SB_OK)return result;
        size_t n=0;if(!sb_cbor_put_map(payload,SB_SP_MAX_RX_PAYLOAD,&n,3)||!sb_cbor_put_uint(payload,SB_SP_MAX_RX_PAYLOAD,&n,0)||!sb_cbor_put_text(payload,SB_SP_MAX_RX_PAYLOAD,&n,info.file_name,strlen(info.file_name))||
            !sb_cbor_put_uint(payload,SB_SP_MAX_RX_PAYLOAD,&n,1)||!sb_cbor_put_uint(payload,SB_SP_MAX_RX_PAYLOAD,&n,info.readable_size)||!sb_cbor_put_uint(payload,SB_SP_MAX_RX_PAYLOAD,&n,2)||!sb_cbor_put_bool(payload,SB_SP_MAX_RX_PAYLOAD,&n,info.active))return SB_INTERNAL_ERROR;
        *payload_n=n;return SB_OK;
    }
    if(r->service==4&&r->message==3){char file_name[64];if(!parse_storage_name(map,file_name))return SB_INVALID_REQUEST;return sb_storage_delete_file(file_name);}
    if(r->service==4&&r->message==4){
        const sb_cbor_value_t *confirm=sb_cbor_get(map,0);
        if(confirm==NULL||confirm->kind!=SB_CBOR_BOOL)return SB_INVALID_REQUEST;
        if(!confirm->boolean)return SB_INVALID_STATE;
        if(!sb_recorder_can_format_storage()||sb_transfer_is_active())return SB_INVALID_STATE;
        return sb_storage_request_format();
    }
    if(r->service==9&&r->message==1){const sb_cbor_value_t*v=sb_cbor_get(map,0);if(!v||v->kind!=SB_CBOR_UINT)return SB_INVALID_REQUEST;return v->u>6?SB_OUT_OF_RANGE:(sb_ui_set_page((uint8_t)v->u)?SB_OK:SB_INTERNAL_ERROR);}
    if(r->service==8&&r->message==1){sb_status_t result;if(!encode_counters(map,payload,SB_SP_MAX_RX_PAYLOAD,payload_n,&result))return SB_INTERNAL_ERROR;return result;}
    if(r->service==8&&r->message==2){size_t cap=SB_SP_MAX_RX_PAYLOAD;uint32_t client_limit=s_client_rx_limit[r->source];if(client_limit<cap)cap=client_limit>8u?client_limit-8u:0u;sb_status_t result;if(!encode_errors(map,payload,cap,payload_n,&result))return SB_INTERNAL_ERROR;return result;}
    if(r->service==8&&r->message==3){sb_diag_clear_errors();return SB_OK;}
    if(r->service==5&&r->message==1){
        const sb_cbor_value_t*v=sb_cbor_get(map,0);if(!v||v->kind!=SB_CBOR_TEXT)return SB_INVALID_REQUEST;
        if(v->length==0||v->length>=64||memchr(v->bytes,0,v->length)!=NULL)return SB_OUT_OF_RANGE;
        char file_name[64];memcpy(file_name,v->bytes,v->length);file_name[v->length]='\0';
        uint64_t token=sb_transfer_session_token(r->source,r->generation);uint32_t id;uint64_t size;bool active;sb_status_t status=sb_transfer_open(file_name,token,&id,&size,&active);
        if(status!=SB_OK)return status;
        size_t n=0;if(!sb_cbor_put_map(payload,SB_SP_MAX_RX_PAYLOAD,&n,3)||!sb_cbor_put_uint(payload,SB_SP_MAX_RX_PAYLOAD,&n,0)||!sb_cbor_put_uint(payload,SB_SP_MAX_RX_PAYLOAD,&n,id)||!sb_cbor_put_uint(payload,SB_SP_MAX_RX_PAYLOAD,&n,1)||!sb_cbor_put_uint(payload,SB_SP_MAX_RX_PAYLOAD,&n,size)||!sb_cbor_put_uint(payload,SB_SP_MAX_RX_PAYLOAD,&n,2)||!sb_cbor_put_bool(payload,SB_SP_MAX_RX_PAYLOAD,&n,active))return SB_INTERNAL_ERROR;
        *payload_n=n;return SB_OK;
    }
    if(r->service==5&&r->message==3){const sb_cbor_value_t*v=sb_cbor_get(map,0);if(!v||v->kind!=SB_CBOR_UINT||v->u>UINT32_MAX)return SB_INVALID_REQUEST;return sb_transfer_close(sb_transfer_session_token(r->source,r->generation),(uint32_t)v->u,false);}
    return SB_UNSUPPORTED;
}

static sb_status_t encode_transfer_read(const request_t *request,response_t *response)
{
    sb_cbor_map_t *map=&s_encode_scratch.map;if(!sb_cbor_parse_map(request->payload,request->length,map))return SB_INVALID_REQUEST;
    const sb_cbor_value_t *id=sb_cbor_get(map,0),*offset=sb_cbor_get(map,1),*length=sb_cbor_get(map,2);
    if(!id||!offset||!length||id->kind!=SB_CBOR_UINT||id->u>UINT32_MAX||offset->kind!=SB_CBOR_UINT||length->kind!=SB_CBOR_UINT||length->u>UINT32_MAX)return SB_INVALID_REQUEST;
    uint32_t max_raw=SB_SP_MAX_RX_PAYLOAD-16u;
    if(s_client_rx_limit[request->source]<16u)return SB_OUT_OF_RANGE;
    uint32_t client_max=s_client_rx_limit[request->source]-16u;if(client_max<max_raw)max_raw=client_max;
    if(length->u==0||length->u>max_raw)return SB_OUT_OF_RANGE;
    portENTER_CRITICAL(&s_tx_state_mux);bool bulk_busy=s_bulk_busy;portEXIT_CRITICAL(&s_tx_state_mux);
    if(bulk_busy)return SB_BUSY;
    size_t actual=0;
    uint32_t storage_epoch=sb_storage_epoch_generation();
    sb_status_t status=sb_transfer_read(sb_transfer_session_token(request->source,request->generation),(uint32_t)id->u,offset->u,(uint32_t)length->u,
                                        response->payload+16u,max_raw,&actual);
    if(status!=SB_OK)return status;
    if(storage_epoch!=sb_storage_epoch_generation())return SB_NOT_FOUND;
    if(actual==0||actual>length->u||actual>max_raw)return SB_IO_ERROR;
    sb_write_le32(response->payload,(uint32_t)id->u);
    sb_write_le64(response->payload+4u,offset->u);
    sb_write_le32(response->payload+12u,(uint32_t)actual);
    response->source=request->source;
    response->frame=(sb_sp_frame_t){.major=1,.minor=0,.type=SB_SP_BULK,.service_id=5,.message_id=1,
        .request_id=request->request,.sequence=s_tx_sequence[request->source]++,
        .payload_length=(uint32_t)(16u+actual),.payload=response->payload,.storage_epoch=storage_epoch};
    return SB_OK;
}

static void send_live_samples(void)
{
    for(unsigned source=0;source<SB_SOURCE_COUNT;++source){
        if(!s_online[source]||!s_live_enabled[source]||tx_has_queued((sb_source_t)source))continue;
        sb_gnss_fix_t fix={0};sb_gnss_get_snapshot(&fix,NULL,NULL,NULL);
        if(fix.mono_us==0||fix.mono_us<=s_live_last_mono_us[source])continue;
        if(s_live_interval_ms[source]!=0&&s_live_last_mono_us[source]!=0&&
           fix.mono_us-s_live_last_mono_us[source]<(uint64_t)s_live_interval_ms[source]*1000u)continue;
        size_t fields=1;
        if((s_live_mask[source]&(1u<<0))&&fix.utc_valid)++fields;
        if((s_live_mask[source]&(1u<<1))&&fix.position_valid)fields+=2;
        if((s_live_mask[source]&(1u<<2))&&fix.altitude_valid)++fields;
        if((s_live_mask[source]&(1u<<3))&&fix.ground_speed_valid)++fields;
        if((s_live_mask[source]&(1u<<4))&&fix.course_valid)++fields;
        if((s_live_mask[source]&(1u<<5))&&fix.satellites_valid)++fields;
        if(s_live_mask[source]&(1u<<6))++fields;
        uint8_t *payload=s_control_response.payload;size_t n=0;
        bool ok=sb_cbor_put_map(payload,sizeof(s_control_response.payload),&n,fields)&&sb_cbor_put_uint(payload,sizeof(s_control_response.payload),&n,0)&&sb_cbor_put_uint(payload,sizeof(s_control_response.payload),&n,fix.mono_us);
        if(ok&&(s_live_mask[source]&(1u<<0))&&fix.utc_valid)ok=sb_cbor_put_uint(payload,sizeof(s_control_response.payload),&n,1)&&sb_cbor_put_int(payload,sizeof(s_control_response.payload),&n,fix.utc_us);
        if(ok&&(s_live_mask[source]&(1u<<1))&&fix.position_valid)ok=sb_cbor_put_uint(payload,sizeof(s_control_response.payload),&n,2)&&sb_cbor_put_int(payload,sizeof(s_control_response.payload),&n,fix.latitude_e7)&&sb_cbor_put_uint(payload,sizeof(s_control_response.payload),&n,3)&&sb_cbor_put_int(payload,sizeof(s_control_response.payload),&n,fix.longitude_e7);
        if(ok&&(s_live_mask[source]&(1u<<2))&&fix.altitude_valid)ok=sb_cbor_put_uint(payload,sizeof(s_control_response.payload),&n,4)&&sb_cbor_put_int(payload,sizeof(s_control_response.payload),&n,fix.altitude_cm);
        if(ok&&(s_live_mask[source]&(1u<<3))&&fix.ground_speed_valid)ok=sb_cbor_put_uint(payload,sizeof(s_control_response.payload),&n,5)&&sb_cbor_put_uint(payload,sizeof(s_control_response.payload),&n,fix.ground_speed_centi_kn);
        if(ok&&(s_live_mask[source]&(1u<<4))&&fix.course_valid)ok=sb_cbor_put_uint(payload,sizeof(s_control_response.payload),&n,6)&&sb_cbor_put_uint(payload,sizeof(s_control_response.payload),&n,fix.course_centi_deg);
        if(ok&&(s_live_mask[source]&(1u<<5))&&fix.satellites_valid)ok=sb_cbor_put_uint(payload,sizeof(s_control_response.payload),&n,7)&&sb_cbor_put_uint(payload,sizeof(s_control_response.payload),&n,fix.satellites_used);
        if(ok&&(s_live_mask[source]&(1u<<6)))ok=sb_cbor_put_uint(payload,sizeof(s_control_response.payload),&n,8)&&sb_cbor_put_uint(payload,sizeof(s_control_response.payload),&n,sb_fix_to_sp(fix.fix_type));
        if(!ok||n>s_client_rx_limit[source]){sb_gnss_note_live_stream_drop();s_live_drop_observed_us[source]=fix.mono_us;continue;}
        response_t *frame=&s_control_response;frame->source=(sb_source_t)source;frame->generation=current_generation((sb_source_t)source);frame->frame=(sb_sp_frame_t){.major=1,.minor=0,.type=SB_SP_STREAM,.service_id=2,.message_id=1,.request_id=0,.sequence=s_tx_sequence[source]++,.payload_length=(uint32_t)n,.payload=frame->payload};
        /* Physical TX owners count a frame only after bytes/fragments really
         * leave the adapter; queue acceptance is not a transmitted frame. */
        if(tx_enqueue(frame)){s_live_last_mono_us[source]=fix.mono_us;}
        else if(fix.mono_us>s_live_drop_observed_us[source]){s_live_drop_observed_us[source]=fix.mono_us;sb_gnss_note_live_stream_drop();}
    }
}

static bool read_event_state(uint16_t service, uint32_t *value)
{
    if (value == NULL) return false;
    switch (service) {
    case 3: { sb_recorder_state_t state; sb_recorder_get_snapshot(&state,NULL,NULL,NULL,NULL,NULL,NULL); *value=(uint32_t)state; return true; }
    case 4: *value=(uint32_t)sb_storage_get_state(); return true;
    case 6: {
        sb_wifi_snapshot_t wifi;sb_wifi_get_snapshot(&wifi);
        *value=(uint32_t)wifi.state|((uint32_t)wifi.last_error<<8u)|((uint32_t)wifi.last_error_valid<<16u);
        return true;
    }
    case 7: *value=(uint32_t)sb_ble_get_state(); return true;
    case 9: *value=(uint32_t)sb_ui_get_page(); return true;
    default: return false;
    }
}

static void send_state_events(void)
{
    /* CORE event 0x0001 is TRANSPORT_READY only. There is no CORE health
     * STATE_CHANGED event in Frozen v1. */
    static const uint8_t services[] = {3,4,6,7,9};
    for (size_t i=0;i<sizeof(services);++i) {
        uint16_t service=services[i]; uint32_t value=0;
        if (!read_event_state(service,&value)) continue;
        if (!s_event_state_valid[service]) { s_event_state_valid[service]=true; s_event_state[service]=value; continue; }
        if (s_event_state[service]==value) continue;
        s_event_state[service]=value;
        uint8_t payload[16]; size_t n=0;
        uint32_t state=value&0xFFu;
        uint32_t reason=(value>>8u)&0xFFu;
        bool has_reason=(value&(1u<<16u))!=0u;
        size_t fields=(service==3&&state!=SB_RECORDER_STOPPED)?2u:
                      (service==6&&has_reason)?2u:1u;
        if (!sb_cbor_put_map(payload,sizeof(payload),&n,fields)||!sb_cbor_put_uint(payload,sizeof(payload),&n,0)||
            !sb_cbor_put_uint(payload,sizeof(payload),&n,state)) continue;
        if(service==3&&state!=SB_RECORDER_STOPPED){
            uint32_t session=0;sb_recorder_get_snapshot(NULL,NULL,&session,NULL,NULL,NULL,NULL);
            if(!sb_cbor_put_uint(payload,sizeof(payload),&n,1)||!sb_cbor_put_uint(payload,sizeof(payload),&n,session))continue;
        }else if(service==6&&has_reason){
            if(!sb_cbor_put_uint(payload,sizeof(payload),&n,1)||!sb_cbor_put_uint(payload,sizeof(payload),&n,reason))continue;
        }
        for (unsigned source=0;source<SB_SOURCE_COUNT;++source) {
            if (!s_online[source]||!s_subscribed[source][service]||n>s_client_rx_limit[source]) continue;
            response_t *event=&s_control_response;memset(event,0,sizeof(*event)); event->source=(sb_source_t)source;event->generation=current_generation((sb_source_t)source);
            event->frame=(sb_sp_frame_t){.major=1,.minor=0,.type=SB_SP_EVENT,.service_id=service,.message_id=1,
                .request_id=0,.sequence=s_tx_sequence[source]++,.payload_length=(uint32_t)n,.payload=event->payload};
            memcpy(event->payload,payload,n);
            (void)tx_enqueue(event);
        }
    }

    /* ERROR_RAISED is a distinct, fixed four-field schema, never the state
     * event's single-value shape. Clearing history is not a new error. */
    sb_error_record_t error;uint32_t oldest=0,newest=0;
    (void)sb_diag_get_errors(0,false,1,&error,&oldest,&newest);
    if(!s_event_state_valid[8]){s_event_state_valid[8]=true;s_event_state[8]=newest;}
    else if(newest!=0u&&newest!=s_event_state[8]){
        s_event_state[8]=newest;
        uint8_t payload[32];size_t n=0;
        if(sb_cbor_put_map(payload,sizeof(payload),&n,4)&&sb_cbor_put_uint(payload,sizeof(payload),&n,0)&&sb_cbor_put_uint(payload,sizeof(payload),&n,error.error_id)&&
           sb_cbor_put_uint(payload,sizeof(payload),&n,1)&&sb_cbor_put_uint(payload,sizeof(payload),&n,error.service_id)&&
           sb_cbor_put_uint(payload,sizeof(payload),&n,2)&&sb_cbor_put_uint(payload,sizeof(payload),&n,error.error_code)&&
           sb_cbor_put_uint(payload,sizeof(payload),&n,3)&&sb_cbor_put_uint(payload,sizeof(payload),&n,error.severity)){
            for(unsigned source=0;source<SB_SOURCE_COUNT;++source){
                if(!s_online[source]||!s_subscribed[source][8]||n>s_client_rx_limit[source])continue;
                response_t *event=&s_control_response;memset(event,0,sizeof(*event));event->source=(sb_source_t)source;event->generation=current_generation((sb_source_t)source);
                event->frame=(sb_sp_frame_t){.major=1,.minor=0,.type=SB_SP_EVENT,.service_id=8,.message_id=1,.request_id=0,
                    .sequence=s_tx_sequence[source]++,.payload_length=(uint32_t)n,.payload=event->payload};
                memcpy(event->payload,payload,n);(void)tx_enqueue(event);
            }
        }
    }

    /* SCAN_COMPLETE carries a generation and count, rather than WIFI state. */
    sb_wifi_snapshot_t wifi;sb_wifi_get_snapshot(&wifi);
    if(!s_wifi_scan_event_valid){s_wifi_scan_event_valid=true;s_wifi_scan_event_generation=wifi.scan_generation;}
    else if(wifi.scan_generation!=s_wifi_scan_event_generation){
        s_wifi_scan_event_generation=wifi.scan_generation;
        size_t count=sb_wifi_get_scan_results(s_encode_scratch.aps,SB_WIFI_AP_CACHE_MAX,NULL),n=0;uint8_t payload[24];
        if(sb_cbor_put_map(payload,sizeof(payload),&n,2)&&sb_cbor_put_uint(payload,sizeof(payload),&n,0)&&sb_cbor_put_uint(payload,sizeof(payload),&n,wifi.scan_generation)&&
           sb_cbor_put_uint(payload,sizeof(payload),&n,1)&&sb_cbor_put_uint(payload,sizeof(payload),&n,count)){
            for(unsigned source=0;source<SB_SOURCE_COUNT;++source){
                if(!s_online[source]||!s_subscribed[source][6]||n>s_client_rx_limit[source])continue;
                response_t *event=&s_control_response;memset(event,0,sizeof(*event));event->source=(sb_source_t)source;event->generation=current_generation((sb_source_t)source);
                event->frame=(sb_sp_frame_t){.major=1,.minor=0,.type=SB_SP_EVENT,.service_id=6,.message_id=2,.request_id=0,
                    .sequence=s_tx_sequence[source]++,.payload_length=(uint32_t)n,.payload=event->payload};
                memcpy(event->payload,payload,n);(void)tx_enqueue(event);
            }
        }
    }
}

static bool request_generation_current(const request_t *request)
{
    return request!=NULL&&(unsigned)request->source<SB_CONTROL_ACTIVE_TX_QUEUES&&
           request->generation==current_generation(request->source);
}

static void process_control_request(request_t *request)
{
    if(!request_generation_current(request)){
        if(request!=NULL&&request->request!=0)pending_release(request->source,request->generation,request->request);
        return;
    }
    if(request->type!=SB_SP_REQUEST)return;
    if(request->request==0){sb_diag_increment(SB_DIAG_PROTOCOL,6);return;}
    sb_status_t status;
    if(request->minor!=0||request->flags!=0||request->channel!=0||request->reserved!=0)status=SB_UNSUPPORTED;
    else if(!(request->service==1u&&request->message==1u)&&!s_online[request->source])status=SB_INVALID_STATE;
    else if(!command_exists(request->service,request->message))status=SB_UNSUPPORTED;
    else if(!sb_sp_command_allowed(request->service,request->message,request->source))status=SB_PERMISSION_DENIED;
    else if(request->service==5&&request->message==2){
        memset(&s_control_response,0,sizeof(s_control_response));status=encode_transfer_read(request,&s_control_response);
        s_control_response.generation=request->generation;
        if(status==SB_OK){(void)tx_enqueue(&s_control_response);send_live_samples();return;}
        memset(&s_control_response,0,sizeof(s_control_response));s_control_response.source=request->source;s_control_response.generation=request->generation;s_control_response.frame=(sb_sp_frame_t){.major=1,.minor=0,.type=SB_SP_RESPONSE,.service_id=request->service,.message_id=request->message,.request_id=request->request,.sequence=s_tx_sequence[request->source]++};
        size_t result_n=0;if(!put_status(s_control_response.payload,sizeof(s_control_response.payload),&result_n,status,NULL,0))result_n=0;s_control_response.frame.payload_length=(uint32_t)result_n;
        (void)tx_enqueue(&s_control_response);
        send_live_samples();
        return;
    }
    else {/* CBOR scalars are copied into the parsed map. Each adapter consumes
         * borrowed strings before encoding; request bytes are dead afterwards. */
        bool wifi_logical_hello=request->source==SB_SOURCE_WIFI&&request->service==1&&request->message==1&&s_online[SB_SOURCE_WIFI];
        uint8_t *response_payload=request->payload;size_t n=0;status=dispatch(response_payload,&n,request);if(status!=SB_OK)n=0;
        bool successful_hello=request->service==1&&request->message==1&&status==SB_OK;
        uint32_t response_sequence=successful_hello?(request->source==SB_SOURCE_WIFI&&!wifi_logical_hello?1u:0u):s_tx_sequence[request->source]++;
        memset(&s_control_response,0,sizeof(s_control_response));s_control_response.source=request->source;s_control_response.generation=successful_hello?current_generation(request->source):request->generation;s_control_response.frame=(sb_sp_frame_t){.major=1,.minor=0,.type=SB_SP_RESPONSE,.service_id=request->service,.message_id=request->message,.request_id=request->request,.sequence=response_sequence,.payload_length=(uint32_t)n,.payload=s_control_response.payload};

        uint8_t *result=s_control_response.payload;size_t result_n=0;
        if(!put_status(result,sizeof(s_control_response.payload),&result_n,status,n?response_payload:NULL,n)){result_n=0;status=SB_INTERNAL_ERROR;put_status(result,sizeof(s_control_response.payload),&result_n,status,NULL,0);}
        if(result_n>s_client_rx_limit[request->source]){result_n=0;put_status(result,sizeof(s_control_response.payload),&result_n,SB_OUT_OF_RANGE,NULL,0);}
        s_control_response.frame.payload_length=(uint32_t)result_n;
        (void)tx_enqueue(&s_control_response);
        return;
    }
    memset(&s_control_response,0,sizeof(s_control_response));s_control_response.source=request->source;s_control_response.generation=request->generation;s_control_response.frame=(sb_sp_frame_t){.major=1,.minor=0,.type=SB_SP_RESPONSE,.service_id=request->service,.message_id=request->message,.request_id=request->request,.sequence=s_tx_sequence[request->source]++};
    size_t n=0;put_status(s_control_response.payload,sizeof(s_control_response.payload),&n,status,NULL,0);s_control_response.frame.payload_length=(uint32_t)n;
    (void)tx_enqueue(&s_control_response);
    send_live_samples();
}

static void control_task(void*arg)
{
    (void)arg;
    for(;;){
        sb_validation_note_stack(SB_VALIDATION_TASK_CONTROL,(uint32_t)uxTaskGetStackHighWaterMark(NULL));
        apply_pending_disconnects();
        request_t request;
        if(xQueueReceive(s_rx_q,&request,pdMS_TO_TICKS(20))!=pdTRUE){
            apply_pending_disconnects();send_state_events();send_live_samples();continue;
        }
        process_control_request(&request);
    }
}
esp_err_t sb_control_start(void)
{
    s_rx_q=xQueueCreateStatic(CONTROL_Q_DEPTH,sizeof(request_t),s_rx_q_data,&s_rx_q_struct);
    if(!s_rx_q)return ESP_ERR_NO_MEM;
    s_bulk_q=xQueueCreateStatic(CONTROL_BULK_Q_DEPTH,sizeof(response_t),s_bulk_q_data,&s_bulk_q_struct);
    if(!s_bulk_q)return ESP_ERR_NO_MEM;
    for(unsigned source=0;source<SB_CONTROL_ACTIVE_TX_QUEUES;++source){
        s_terminal_q[source]=xQueueCreateStatic(CONTROL_TX_Q_DEPTH,sizeof(response_t),s_terminal_q_data[source],&s_terminal_q_struct[source]);
        s_misc_q[source]=xQueueCreateStatic(CONTROL_TX_MISC_DEPTH,sizeof(misc_response_t),s_misc_q_data[source],&s_misc_q_struct[source]);
        if(!s_terminal_q[source]||!s_misc_q[source])return ESP_ERR_NO_MEM;
    }
    sb_board_info_t board;sb_board_get_info(&board);s_boot_id=board.boot_id;
    for(unsigned source=0;source<SB_CONTROL_ACTIVE_TX_QUEUES;++source){s_session_generation[source]=1u;sb_transfer_set_session_generation((sb_source_t)source,1u);}
    return xTaskCreateStatic(control_task,"control_task",CONTROL_STACK_WORDS,NULL,5,s_stack,&s_task_struct)?ESP_OK:ESP_ERR_NO_MEM;
}
bool sb_control_submit(sb_source_t source,const sb_sp_frame_t*f)
{
    return sb_control_submit_for_generation(source,current_generation(source),f);
}
bool sb_control_submit_for_generation(sb_source_t source,uint32_t generation,const sb_sp_frame_t*f)
{
    if(!sb_control_source_has_tx_queue(source)||f==NULL||f->payload_length>SB_SP_MAX_RX_PAYLOAD)return false;
    if(generation!=current_generation(source))return false;
    request_t r={.source=source,.type=f->type,.minor=f->minor,.flags=f->flags,.channel=f->channel,.reserved=f->reserved,.service=f->service_id,.message=f->message_id,.request=f->request_id,.sequence=f->sequence,.generation=generation,.length=f->payload_length};
    if(r.length)memcpy(r.payload,f->payload,r.length);
    if(!s_rx_q)return false;
    bool reserved=false;
    if(r.type==SB_SP_REQUEST&&r.request!=0){if(!pending_reserve(source,generation,r.request))return false;reserved=true;}
    if(xQueueSend(s_rx_q,&r,0)!=pdTRUE){if(reserved)pending_release(source,generation,r.request);return false;}
    return true;
}
uint32_t sb_control_session_generation(sb_source_t source){return current_generation(source);}
bool sb_control_has_pending_for_generation(sb_source_t source,uint32_t generation)
{
    bool pending=false;
    portENTER_CRITICAL(&s_pending_mux);
    for(unsigned i=0;i<CONTROL_PENDING_DEPTH;++i)
        if(s_pending[i].active&&s_pending[i].source==source&&s_pending[i].generation==generation){pending=true;break;}
    portEXIT_CRITICAL(&s_pending_mux);
    return pending;
}
bool sb_control_receive(sb_sp_frame_t*f,uint8_t*payload,size_t capacity,sb_source_t*source)
{
    if(!f||!payload||!source)return false;
    uint32_t generation;
    if(!sb_control_receive_for_generation(SB_SOURCE_USB,f,payload,capacity,&generation))return false;
    *source=SB_SOURCE_USB;return true;
}

bool sb_control_receive_for(sb_source_t source,sb_sp_frame_t*f,uint8_t*payload,size_t capacity)
{
    return sb_control_receive_for_generation(source,f,payload,capacity,NULL);
}

static bool receive_response_item(QueueHandle_t queue,sb_source_t source,response_t *out)
{
    if(queue==NULL)return false;
    while(xQueueReceive(queue,out,0)==pdTRUE){
        if(out->source==source&&out->generation==current_generation(source)&&
           out->frame.type==SB_SP_BULK&&out->frame.storage_epoch!=sb_storage_epoch_generation()){
            /* A once-valid READ became stale while queued. A terminal BULK
             * cannot disappear while this logical session stays ONLINE. */
            reset_logical_session(source,true);
            return false;
        }
        if(out->source==source&&out->generation==current_generation(source)&&
           (out->frame.type!=SB_SP_BULK||out->frame.storage_epoch==sb_storage_epoch_generation()))return true;
        if(out->source==source&&out->frame.request_id!=0)pending_release(source,out->generation,out->frame.request_id);
        if(out->frame.type==SB_SP_BULK){portENTER_CRITICAL(&s_tx_state_mux);if(s_bulk_busy&&s_bulk_source==out->source&&s_bulk_generation==out->generation)s_bulk_busy=false;portEXIT_CRITICAL(&s_tx_state_mux);}
    }
    return false;
}

static bool receive_misc_item(sb_source_t source,response_t *out)
{
    if((unsigned)source>=SB_CONTROL_ACTIVE_TX_QUEUES||out==NULL||s_misc_q[source]==NULL)return false;
    misc_response_t item;
    while(xQueueReceive(s_misc_q[source],&item,0)==pdTRUE){
        if(item.source!=source||item.generation!=current_generation(source))continue;
        if(item.frame.payload_length>sizeof(out->payload))return false;
        out->source=item.source;
        out->generation=item.generation;
        out->priority=item.priority;
        out->frame=item.frame;
        if(item.frame.payload_length)memcpy(out->payload,item.payload,item.frame.payload_length);
        out->frame.payload=out->payload;
        return true;
    }
    return false;
}

bool sb_control_receive_for_generation(sb_source_t source,sb_sp_frame_t*f,uint8_t*payload,size_t capacity,uint32_t*generation)
{
    if((unsigned)source>=SB_CONTROL_ACTIVE_TX_QUEUES||!f||!payload)return false;
    response_t r={0};
    misc_response_t misc_peek={0};
    bool found=false;
    for(unsigned attempt=0;attempt<4u&&!found;++attempt){
        bool terminal=s_terminal_q[source]&&uxQueueMessagesWaiting(s_terminal_q[source])!=0u;
        bool misc=s_misc_q[source]&&xQueuePeek(s_misc_q[source],&misc_peek,0)==pdTRUE;
        bool important=misc&&misc_peek.priority==SB_CONTROL_TX_PRIORITY_IMPORTANT_EVENT;
        bool bulk=s_bulk_q&&xQueuePeek(s_bulk_q,&r,0)==pdTRUE&&r.source==source;
        switch(sb_control_tx_select_fair(terminal,important,bulk,misc,
                                         s_terminal_streak[source],CONTROL_TX_TERMINAL_BURST_MAX,
                                         s_important_streak[source],CONTROL_TX_IMPORTANT_BURST_MAX)){
        case SB_CONTROL_TX_QUEUE_TERMINAL:
            found=receive_response_item(s_terminal_q[source],source,&r);
            if(found){if(bulk&&s_terminal_streak[source]<UINT8_MAX)++s_terminal_streak[source];else if(!bulk)s_terminal_streak[source]=0u;}
            break;
        case SB_CONTROL_TX_QUEUE_IMPORTANT:
            found=receive_misc_item(source,&r);
            if(found&&bulk&&s_important_streak[source]<UINT8_MAX)++s_important_streak[source];
            break;
        case SB_CONTROL_TX_QUEUE_BULK:
            found=receive_response_item(s_bulk_q,source,&r);
            if(found){s_important_streak[source]=0u;s_terminal_streak[source]=0u;}
            break;
        case SB_CONTROL_TX_QUEUE_MISC:
            found=receive_misc_item(source,&r);break;
        default:
            attempt=4u;break;
        }
    }
    if(found){
        if(r.frame.payload_length>capacity)return false;
        *f=r.frame;memcpy(payload,r.payload,r.frame.payload_length);f->payload=payload;
        if(generation)*generation=r.generation;
        return true;
    }
    return false;
}

bool sb_control_peek_tx_for_generation(sb_source_t source,response_t*out)
{
    if((unsigned)source>=SB_CONTROL_ACTIVE_TX_QUEUES||out==NULL)return false;
    misc_response_t misc_item={0};
    bool terminal=s_terminal_q[source]&&uxQueueMessagesWaiting(s_terminal_q[source])!=0u;
    bool misc=s_misc_q[source]&&xQueuePeek(s_misc_q[source],&misc_item,0)==pdTRUE;
    bool important=misc&&misc_item.priority==SB_CONTROL_TX_PRIORITY_IMPORTANT_EVENT;
    portENTER_CRITICAL(&s_tx_state_mux);bool bulk=s_bulk_busy&&s_bulk_source==source;portEXIT_CRITICAL(&s_tx_state_mux);
    uint8_t selected=(uint8_t)sb_control_tx_select_fair(terminal,important,bulk,misc,
        s_terminal_streak[source],CONTROL_TX_TERMINAL_BURST_MAX,
        s_important_streak[source],CONTROL_TX_IMPORTANT_BURST_MAX);
    uint8_t kind=0u;
    if(selected==SB_CONTROL_TX_QUEUE_TERMINAL){
        if(!s_terminal_q[source]||xQueuePeek(s_terminal_q[source],out,0)!=pdTRUE)return false;
        kind=SB_CONTROL_TX_KIND_TERMINAL;
    }
    else if(selected==SB_CONTROL_TX_QUEUE_BULK){
        if(!s_bulk_q||xQueuePeek(s_bulk_q,out,0)!=pdTRUE)return false;
        kind=SB_CONTROL_TX_KIND_BULK;
    }
    else if(selected==SB_CONTROL_TX_QUEUE_IMPORTANT||selected==SB_CONTROL_TX_QUEUE_MISC){
        if(!misc||misc_item.frame.payload_length>sizeof(out->payload))return false;
        memset(out,0,sizeof(*out));out->source=misc_item.source;out->generation=misc_item.generation;
        out->ticket=misc_item.ticket;out->priority=misc_item.priority;out->frame=misc_item.frame;
        if(misc_item.frame.payload_length)memcpy(out->payload,misc_item.payload,misc_item.frame.payload_length);
        kind=selected==SB_CONTROL_TX_QUEUE_IMPORTANT?SB_CONTROL_TX_KIND_IMPORTANT:SB_CONTROL_TX_KIND_MISC;
    } else return false;
    if(out->source!=source||out->generation!=current_generation(source))return false;
    if(out->frame.type==SB_SP_BULK&&out->frame.storage_epoch!=sb_storage_epoch_generation()){
        reset_logical_session(source,true);return false;
    }
    if(out->frame.payload_length>sizeof(out->payload))return false;
    out->frame.payload=out->payload;out->source=source;
    out->reserved_kind=kind;
    return true;
}

bool sb_control_commit_peeked_tx(sb_source_t source,response_t*candidate)
{
    if((unsigned)source>=SB_CONTROL_ACTIVE_TX_QUEUES||candidate==NULL||candidate->ticket==0u)return false;
    uint32_t generation=candidate->generation,ticket=candidate->ticket;
    uint8_t kind=candidate->reserved_kind;
    bool committed=false,bulk_pending=false;
    portENTER_CRITICAL(&s_tx_handoff_mux);
    uint32_t current=s_session_generation[source];
    if(current==generation){
        if(kind==SB_CONTROL_TX_KIND_TERMINAL){
            if(s_terminal_q[source]&&xQueuePeek(s_terminal_q[source],candidate,0)==pdTRUE&&candidate->ticket==ticket&&
               xQueueReceive(s_terminal_q[source],candidate,0)==pdTRUE){committed=true;}
        } else if(kind==SB_CONTROL_TX_KIND_BULK){
            if(s_bulk_q&&xQueuePeek(s_bulk_q,candidate,0)==pdTRUE&&candidate->ticket==ticket&&candidate->source==source&&
               xQueueReceive(s_bulk_q,candidate,0)==pdTRUE){
                committed=true;portENTER_CRITICAL(&s_tx_state_mux);
                if(s_bulk_busy&&s_bulk_source==source&&s_bulk_generation==generation)s_bulk_busy=false;
                portEXIT_CRITICAL(&s_tx_state_mux);
            }
        } else if(kind==SB_CONTROL_TX_KIND_IMPORTANT||kind==SB_CONTROL_TX_KIND_MISC){
            misc_response_t head,removed;
            if(s_misc_q[source]&&xQueuePeek(s_misc_q[source],&head,0)==pdTRUE&&head.ticket==ticket&&
               xQueueReceive(s_misc_q[source],&removed,0)==pdTRUE)committed=true;
        }
        bulk_pending=s_bulk_q&&uxQueueMessagesWaiting(s_bulk_q)!=0u;
        if(committed){
            if(kind==SB_CONTROL_TX_KIND_TERMINAL){if(bulk_pending&&s_terminal_streak[source]<UINT8_MAX)++s_terminal_streak[source];else if(!bulk_pending)s_terminal_streak[source]=0u;}
            else if(kind==SB_CONTROL_TX_KIND_IMPORTANT){if(bulk_pending&&s_important_streak[source]<UINT8_MAX)++s_important_streak[source];}
            else if(kind==SB_CONTROL_TX_KIND_BULK){s_important_streak[source]=0u;s_terminal_streak[source]=0u;}
        }
    }
    portEXIT_CRITICAL(&s_tx_handoff_mux);
    return committed;
}

void sb_control_transport_start(sb_source_t source)
{
    if((unsigned)source>=SB_CONTROL_ACTIVE_TX_QUEUES)return;
    (void)advance_generation_and_queue_cleanup(source);
}

void sb_control_disconnect(sb_source_t source)
{
    if((unsigned)source>=SB_CONTROL_ACTIVE_TX_QUEUES)return;
    (void)advance_generation_and_queue_cleanup(source);
}

void sb_control_set_usb_connected(bool connected)
{
    portENTER_CRITICAL(&s_session_mux);s_usb_connected=connected;portEXIT_CRITICAL(&s_session_mux);
}

bool sb_control_get_usb_connected(void)
{
    portENTER_CRITICAL(&s_session_mux);bool connected=s_usb_connected;portEXIT_CRITICAL(&s_session_mux);return connected;
}

void sb_control_set_reboot_handler(sb_control_reboot_handler_t handler)
{
    s_reboot_handler = handler;
}

void sb_control_begin_shutdown(void)
{
    portENTER_CRITICAL(&s_shutdown_mux); s_shutting_down = true; portEXIT_CRITICAL(&s_shutdown_mux);
}

bool sb_control_usb_response_is_reboot(const sb_sp_frame_t *frame)
{
    if (frame == NULL || frame->type != SB_SP_RESPONSE || frame->service_id != 1 || frame->message_id != 5) return false;
    sb_cbor_map_t result;
    if (!sb_cbor_parse_map(frame->payload, frame->payload_length, &result)) return false;
    const sb_cbor_value_t *status = sb_cbor_get(&result, 0);
    return status != NULL && status->kind == SB_CBOR_UINT && status->u == SB_ACCEPTED;
}

bool sb_control_disconnect_if_generation(sb_source_t source,uint32_t expected_generation)
{
    if((unsigned)source>=SB_CONTROL_ACTIVE_TX_QUEUES)return false;
    portENTER_CRITICAL(&s_tx_handoff_mux);
    portENTER_CRITICAL(&s_session_mux);
    bool current=s_session_generation[source]==expected_generation;
    uint32_t generation=current?next_generation(expected_generation):s_session_generation[source];
    if(current){
        s_session_generation[source]=generation;
        s_cleanup_pending[source]=(pending_cleanup_t){.pending=true,.target_generation=expected_generation};
    }
    portEXIT_CRITICAL(&s_session_mux);
    portEXIT_CRITICAL(&s_tx_handoff_mux);
    if(current)sb_transfer_set_session_generation(source,generation);
    return current;
}

bool sb_control_invalidate_session_fast(sb_source_t source,uint32_t expected_generation)
{
    /* The generation advance is the fast invalidation linearization point.
     * Control's task performs heavier Transfer/subscription/TX cleanup later. */
    return sb_control_disconnect_if_generation(source,expected_generation);
}

void sb_control_tx_completed(sb_source_t source,uint32_t generation,uint8_t type,uint32_t request_id,bool reboot_response)
{
    if((unsigned)source>=SB_CONTROL_ACTIVE_TX_QUEUES||generation!=current_generation(source))return;
    if((type==SB_SP_RESPONSE||type==SB_SP_BULK)&&request_id!=0)pending_release(source,generation,request_id);
    if(type==SB_SP_BULK){portENTER_CRITICAL(&s_tx_state_mux);if(s_bulk_busy&&s_bulk_source==source&&s_bulk_generation==generation)s_bulk_busy=false;portEXIT_CRITICAL(&s_tx_state_mux);}
    if(source==SB_SOURCE_USB&&reboot_response){sb_control_begin_shutdown();if(s_reboot_handler!=NULL)s_reboot_handler();}
}
