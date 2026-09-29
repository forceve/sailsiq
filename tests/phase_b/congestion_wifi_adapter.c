/* Current production TCP TX/COBS and generation functions are extracted at
 * test time. Socket send and selected recovery/lifecycle behavior are fake. */
#include <assert.h>
#include <errno.h>
#include <stdbool.h>
#include <stdint.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "sailball/wifi.h"
#include "sailball/diagnostics.h"
#include "sailball/storage.h"
#include "sailball/sp.h"
#include "sailball/transport_quantum.h"
#include "congestion_adapters.h"
#define WIFI_TX_QUANTUM 512u
#define WIFI_TX_STALL_TIMEOUT_US UINT64_C(5000000)
#ifndef EWOULDBLOCK
#define EWOULDBLOCK EAGAIN
#endif
typedef struct { sb_sp_frame_t frame; uint32_t session_generation; uint8_t payload[SB_SP_MAX_RX_PAYLOAD]; } wifi_frame_item_t;
static StaticQueue_t s_tx_queue_struct;
static uint8_t s_tx_queue_storage[2u*sizeof(wifi_frame_item_t)];
static QueueHandle_t s_tx_queue;
static QueueHandle_t s_rx_queue;
static sb_sp_cobs_stream_t s_rx_stream;
static wifi_frame_item_t s_tx_item;
static int s_socket=3;
static uint32_t s_session_generation;
static bool s_peer_fin_pending;
static uint32_t s_tcp_connection_generation,s_fin_connection_generation;
static uint8_t s_tx_buffer[SB_SP_MAX_FRAME+16u];
static size_t s_tx_length,s_tx_offset;
static bool s_tx_active,s_tx_bootstrap,s_tx_resync_pending,s_tx_completion_pending,s_tx_bulk_publication_claimed;
static uint64_t s_tx_bulk_publication_claim_id;
static uint64_t s_tx_started_us;
static uint32_t s_tx_completed_generation,s_tx_completed_request_id;
static uint8_t s_tx_completed_type;
static unsigned s_send_mode,s_send_calls,s_send_wouldblock_calls,s_send_zero_calls,s_send_partial_calls,s_terminal_sent,s_bulk_sent;
static uint32_t s_last_terminal_generation,s_last_terminal_request,s_last_terminal_sequence;
static uint8_t s_wire[SB_SP_COBS_MAX_ENCODED*4u];
static size_t s_wire_length;
static bool wifi_started(void){return true;}
static void release_bulk_publication(void)
{if(s_tx_bulk_publication_claimed)sb_storage_release_bulk_publication(s_tx_item.frame.storage_epoch,s_tx_bulk_publication_claim_id);s_tx_bulk_publication_claimed=false;}
extern int64_t esp_timer_get_time(void);
static void fail_or_recover(uint8_t reason){(void)reason;s_socket=-1;s_tx_active=false;}
static void finish_user_disconnect(void){s_socket=-1;s_peer_fin_pending=false;}
static int fake_send(int socket,const void *bytes,size_t length,int flags)
{(void)flags;assert(socket==3);++s_send_calls;
 if(s_send_mode==1u){++s_send_wouldblock_calls;errno=EWOULDBLOCK;return -1;}
 if(s_send_mode==2u){++s_send_zero_calls;return 0;}
 if(s_send_mode==3u){errno=EPIPE;return -1;}
 if(s_send_mode==4u&&length>3u){length=3u;++s_send_partial_calls;}
 assert(s_wire_length+length<=sizeof(s_wire));memcpy(s_wire+s_wire_length,bytes,length);s_wire_length+=length;
 if(s_tx_offset+length==s_tx_length){
  if(s_tx_item.frame.type==SB_SP_RESPONSE){++s_terminal_sent;s_last_terminal_generation=s_tx_item.session_generation;
   s_last_terminal_request=s_tx_item.frame.request_id;s_last_terminal_sequence=s_tx_item.frame.sequence;}
  if(s_tx_item.frame.type==SB_SP_BULK)++s_bulk_sent;
 }
 sb_test_storage_abort_at_physical_send();
 return (int)length;}
#define send fake_send
#include "wifi_congestion_adapter.inc"
#undef send
void sb_wifi_transport_poll(void){send_queued_tcp();}
void sb_test_wifi_adapter_init(void)
{s_tx_queue=xQueueCreateStatic(2u,sizeof(wifi_frame_item_t),s_tx_queue_storage,&s_tx_queue_struct);assert(s_tx_queue);}
void sb_test_wifi_send_mode(unsigned mode){s_send_mode=mode;}
unsigned sb_test_wifi_send_calls(void){return s_send_calls;}
unsigned sb_test_wifi_wouldblock_calls(void){return s_send_wouldblock_calls;}
unsigned sb_test_wifi_zero_calls(void){return s_send_zero_calls;}
unsigned sb_test_wifi_partial_calls(void){return s_send_partial_calls;}
size_t sb_test_wifi_sent_length(void){return s_wire_length;}
unsigned sb_test_wifi_terminal_sent(void){return s_terminal_sent;}
uint32_t sb_test_wifi_last_terminal_generation(void){return s_last_terminal_generation;}
uint32_t sb_test_wifi_last_terminal_request(void){return s_last_terminal_request;}
uint32_t sb_test_wifi_last_terminal_sequence(void){return s_last_terminal_sequence;}
unsigned sb_test_wifi_bulk_sent(void){return s_bulk_sent;}
bool sb_test_wifi_active(void){return s_tx_active||uxQueueMessagesWaiting(s_tx_queue)!=0u;}
void sb_test_wifi_disconnect(void){s_socket=-1;s_tx_active=false;xQueueReset(s_tx_queue);}
void sb_test_wifi_reconnect(void){s_socket=3;s_tx_active=false;s_tx_offset=s_tx_length=0u;s_peer_fin_pending=false;
 if(s_tx_queue)xQueueReset(s_tx_queue);}
bool sb_test_wifi_connected(void){return s_socket>=0;}
