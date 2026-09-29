/* Current production BLE TX/notify and generation functions are extracted at
 * test time. NimBLE primitives and selected connection lifecycle are fake. */
#include <assert.h>
#include <stdbool.h>
#include <stdint.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/portmacro.h"
#include "sailball/ble.h"
#include "sailball/diagnostics.h"
#include "sailball/storage.h"
#include "sailball/sp.h"
#include "ble_reassembly.h"
#include "congestion_adapters.h"
#define BLE_HS_CONN_HANDLE_NONE UINT16_MAX
#define BLE_TX_STALL_TIMEOUT_US UINT64_C(5000000)
typedef struct { sb_sp_frame_t frame; uint32_t session_generation; uint8_t payload[SB_SP_MAX_RX_PAYLOAD]; } ble_frame_item_t;
struct os_mbuf { uint16_t length; uint8_t bytes[SB_BLE_FRAGMENT_MAX_VALUE]; };
static StaticQueue_t s_tx_queue_struct;
static uint8_t s_tx_queue_storage[2u*sizeof(ble_frame_item_t)];
static QueueHandle_t s_tx_queue;
static ble_frame_item_t s_tx_item;
static portMUX_TYPE s_mux;
static bool s_connected=true,s_notify_enabled=true,s_tx_active,s_tx_completion_pending,s_tx_bulk_publication_claimed;
static uint64_t s_tx_bulk_publication_claim_id;
static bool s_disconnect_pending,s_session_end_pending,s_hello_complete=true;
static uint16_t s_conn_handle=3u,s_tx_value_handle=5u,s_current_mtu=23u,s_tx_frame_id;
static uint16_t s_tx_length,s_tx_offset;
static uint8_t s_tx_frame[SB_SP_MAX_FRAME];
static sb_ble_reassembly_t s_reassembly;
static uint32_t s_reassembly_session_generation;
static QueueHandle_t s_fragment_queue;
static uint64_t s_tx_started_us;
static uint32_t s_sp_session_generation,s_tx_completed_generation,s_tx_completed_request_id;
static uint8_t s_tx_completed_type;
static sb_ble_session_invalidator_t s_session_invalidator;
static uint32_t s_session_end_generation;
static bool s_session_end_control_invalidated;
static unsigned s_notify_mode,s_notify_calls,s_notify_successes,s_notify_failures,s_terminal_sent;
static uint32_t s_last_terminal_generation,s_last_terminal_request,s_last_terminal_sequence;
static bool s_mbuf_available=true;
static void release_bulk_publication(void)
{if(s_tx_bulk_publication_claimed)sb_storage_release_bulk_publication(s_tx_item.frame.storage_epoch,s_tx_bulk_publication_claim_id);s_tx_bulk_publication_claimed=false;s_tx_bulk_publication_claim_id=0u;}
static bool ble_started(void){return true;}
extern int64_t esp_timer_get_time(void);
static struct os_mbuf s_mbuf;
static struct os_mbuf *os_msys_get_pkthdr(uint16_t length,int flags)
{(void)flags;assert(length<=sizeof(s_mbuf.bytes));if(!s_mbuf_available)return NULL;s_mbuf.length=0u;return &s_mbuf;}
static int os_mbuf_append(struct os_mbuf *mbuf,const void *data,uint16_t length)
{assert(length<=sizeof(mbuf->bytes));memcpy(mbuf->bytes,data,length);mbuf->length=length;return 0;}
static void os_mbuf_free_chain(struct os_mbuf *mbuf){assert(mbuf==&s_mbuf);}
static int ble_gatts_notify_custom(uint16_t connection,uint16_t attribute,struct os_mbuf *mbuf)
{assert(connection==3u&&attribute==5u&&mbuf==&s_mbuf);++s_notify_calls;
 if(s_notify_mode==1u){++s_notify_failures;return -1;}
 ++s_notify_successes;
 if((s_tx_item.frame.type==SB_SP_RESPONSE||s_tx_item.frame.type==SB_SP_BULK)&&
    (uint32_t)s_tx_offset+(uint32_t)mbuf->length-6u==s_tx_length){++s_terminal_sent;
    s_last_terminal_generation=s_tx_item.session_generation;s_last_terminal_request=s_tx_item.frame.request_id;
    s_last_terminal_sequence=s_tx_item.frame.sequence;}
 sb_test_storage_abort_at_physical_send();
 return 0;}
#include "ble_congestion_adapter.inc"
void sb_ble_transport_poll(void){process_control_tx();}
void sb_test_ble_adapter_init(void)
{s_tx_queue=xQueueCreateStatic(2u,sizeof(ble_frame_item_t),s_tx_queue_storage,&s_tx_queue_struct);
 assert(s_tx_queue);s_connected=s_notify_enabled=true;s_conn_handle=3u;s_current_mtu=23u;}
void sb_test_ble_notify_mode(unsigned mode){s_notify_mode=mode;}
unsigned sb_test_ble_notify_calls(void){return s_notify_calls;}
unsigned sb_test_ble_notify_successes(void){return s_notify_successes;}
unsigned sb_test_ble_notify_failures(void){return s_notify_failures;}
unsigned sb_test_ble_terminal_sent(void){return s_terminal_sent;}
uint32_t sb_test_ble_last_terminal_generation(void){return s_last_terminal_generation;}
uint32_t sb_test_ble_last_terminal_request(void){return s_last_terminal_request;}
uint32_t sb_test_ble_last_terminal_sequence(void){return s_last_terminal_sequence;}
bool sb_test_ble_session_ended(void){return s_session_end_pending;}
bool sb_test_ble_connected(void){return s_connected;}
uint32_t sb_test_ble_session_generation(void){return s_sp_session_generation;}
void sb_test_ble_reconnect(void)
{s_connected=s_notify_enabled=true;s_conn_handle=3u;s_tx_active=s_session_end_pending=s_disconnect_pending=false;
 s_tx_length=s_tx_offset=0u;if(s_tx_queue)xQueueReset(s_tx_queue);}
void sb_test_ble_notify_enabled(bool enabled){s_notify_enabled=enabled;}
void sb_test_ble_mbuf_available(bool available){s_mbuf_available=available;}
bool sb_test_ble_active(void){return s_tx_active||uxQueueMessagesWaiting(s_tx_queue)!=0u;}
void sb_test_ble_disconnect(void){s_connected=false;s_conn_handle=BLE_HS_CONN_HANDLE_NONE;s_tx_active=false;xQueueReset(s_tx_queue);}
