#include <assert.h>
#include <errno.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "sailball/diagnostics.h"
#include "sailball/board.h"
#include "sailball/sp.h"
#include "sailball/transport_quantum.h"

#ifndef EWOULDBLOCK
#define EWOULDBLOCK EAGAIN
#endif
#ifndef EPIPE
#define EPIPE 32
#endif

#define WIFI_RX_QUANTUM 512u
#define WIFI_TX_QUANTUM 512u
#define WIFI_TX_STALL_TIMEOUT_US UINT64_C(5000000)

typedef struct {
    sb_sp_frame_t frame;
    uint32_t session_generation;
    uint8_t payload[SB_SP_MAX_RX_PAYLOAD];
} wifi_frame_item_t;
typedef struct { uint32_t generation; } tcp_rx_context_t;
typedef struct { wifi_frame_item_t item[4]; unsigned head, count; } fake_queue_t;

static fake_queue_t s_fake_rx_queue, s_fake_tx_queue;
static QueueHandle_t s_rx_queue, s_tx_queue;
static int s_socket;
static uint32_t s_session_generation;
static uint8_t s_tcp_rx_quantum[WIFI_RX_QUANTUM], s_tx_buffer[SB_SP_MAX_FRAME + 16u];
static bool s_peer_fin_pending;
static uint32_t s_tcp_connection_generation,s_fin_connection_generation;
static sb_sp_cobs_stream_t s_rx_stream;
static size_t s_tx_length, s_tx_offset;
static bool s_tx_active, s_tx_bootstrap, s_tx_resync_pending, s_tx_completion_pending, s_tx_bulk_publication_claimed;
static uint64_t s_tx_bulk_publication_claim_id;
static uint64_t s_tx_started_us, s_now_us;
static uint64_t s_stage_started_us;
static uint32_t s_handover_id;
static bool s_session_started,s_session_start_pending;
void sb_board_get_info(sb_board_info_t *out)
{ memset(out,0,sizeof(*out));out->device_id=UINT64_C(0x12345678);out->boot_id=12u; }
static void wifi_set_state(int state){(void)state;}
static bool wifi_started(void){return true;}
#define SB_WIFI_SP_HANDSHAKE 5
uint32_t sb_storage_epoch_generation(void){return 1u;}
bool sb_storage_claim_bulk_publication(uint32_t epoch,uint64_t *id){if(id)*id=1u;return epoch==1u;}
bool sb_storage_finish_bulk_publication(uint32_t epoch,uint64_t id){(void)id;return epoch==1u;}
void sb_storage_release_bulk_publication(uint32_t epoch,uint64_t id){(void)epoch;(void)id;}
static uint32_t s_tx_completed_generation, s_tx_completed_request_id;
static uint8_t s_tx_completed_type;
static wifi_frame_item_t s_tx_item;
static void release_bulk_publication(void)
{if(s_tx_bulk_publication_claimed)sb_storage_release_bulk_publication(s_tx_item.frame.storage_epoch,s_tx_bulk_publication_claim_id);s_tx_bulk_publication_claimed=false;}
static uint8_t s_incoming[SB_SP_COBS_MAX_ENCODED * 2u + 256u];
static size_t s_incoming_length, s_incoming_offset, s_recv_allowance;
static bool s_fin_after_bytes;
static uint8_t s_sent[SB_SP_COBS_MAX_ENCODED * 2u];
static size_t s_sent_length, s_send_chunk;
static int s_send_error, s_disconnects, s_failures;
static unsigned s_frame_ok, s_frame_errors, s_rx_frames_before_disconnect;
static uint8_t s_payload[SB_SP_MAX_RX_PAYLOAD];
/* The extracted production Transport RX body uses Transport-owned scratch.
 * This harness exercises only its decoded view, not the TX candidate overlay. */
static struct { uint8_t decoded[SB_SP_MAX_FRAME]; } s_decoded_scratch;
static unsigned s_control_submissions;
static uint32_t s_control_last_request;
bool sb_control_submit_for_generation(sb_source_t source,uint32_t generation,const sb_sp_frame_t *frame)
{
    assert(source==SB_SOURCE_WIFI && generation==9u);
    ++s_control_submissions;s_control_last_request=frame->request_id;return true;
}

static int fake_recv(int socket, void *out, size_t capacity, int flags)
{
    (void)flags; assert(socket == 3);
    if (s_incoming_offset == s_incoming_length) {
        if (s_fin_after_bytes) { s_fin_after_bytes = false; return 0; }
        errno = EAGAIN; return -1;
    }
    if (s_recv_allowance == 0u) { errno = EAGAIN; return -1; }
    size_t amount = s_incoming_length - s_incoming_offset;
    if (amount > capacity) amount = capacity;
    if (amount > s_recv_allowance) amount = s_recv_allowance;
    memcpy(out, s_incoming + s_incoming_offset, amount);
    s_incoming_offset += amount; s_recv_allowance -= amount;
    return (int)amount;
}
static int fake_send(int socket, const void *data, size_t length, int flags)
{
    (void)flags; assert(socket == 3);
    if (s_send_error != 0) { errno = s_send_error; s_send_error = 0; return -1; }
    if (s_send_chunk == 0u) return 0;
    if (length > s_send_chunk) length = s_send_chunk;
    assert(s_sent_length + length <= sizeof(s_sent));
    memcpy(s_sent + s_sent_length, data, length); s_sent_length += length;
    return (int)length;
}
static uint64_t esp_timer_get_time(void) { return s_now_us; }
void sb_diag_increment(sb_diag_group_t group, unsigned counter)
{
    if (group == SB_DIAG_PROTOCOL && counter == 0u) ++s_frame_ok;
    if (group == SB_DIAG_PROTOCOL && counter == 4u) ++s_frame_errors;
}
static void finish_user_disconnect(void)
{
    s_rx_frames_before_disconnect = s_fake_rx_queue.count;
    ++s_disconnects; s_socket = -1;
    s_peer_fin_pending = false;
    s_fake_rx_queue.head = s_fake_rx_queue.count = 0u;
    sb_sp_cobs_stream_reset(&s_rx_stream);
}
static void fail_or_recover(uint8_t reason)
{ (void)reason; ++s_failures; s_socket = -1; sb_sp_cobs_stream_reset(&s_rx_stream); }

int xQueueSend(QueueHandle_t handle, const void *item, TickType_t ticks)
{
    (void)ticks; fake_queue_t *queue = (fake_queue_t *)handle;
    assert(queue == &s_fake_rx_queue || queue == &s_fake_tx_queue);
    if (queue->count == 4u) return pdFALSE;
    queue->item[(queue->head + queue->count) % 4u] = *(const wifi_frame_item_t *)item;
    ++queue->count; return pdTRUE;
}
int xQueueReceive(QueueHandle_t handle, void *out, TickType_t ticks)
{
    (void)ticks; fake_queue_t *queue = (fake_queue_t *)handle;
    assert(queue == &s_fake_rx_queue || queue == &s_fake_tx_queue);
    if (queue->count == 0u) return pdFALSE;
    *(wifi_frame_item_t *)out = queue->item[queue->head];
    queue->head = (queue->head + 1u) % 4u; --queue->count; return pdTRUE;
}
int xQueuePeek(QueueHandle_t handle, void *out, TickType_t ticks)
{
    (void)ticks;fake_queue_t *queue=(fake_queue_t *)handle;
    if(queue->count==0u)return pdFALSE;
    *(wifi_frame_item_t *)out=queue->item[queue->head];return pdTRUE;
}
unsigned uxQueueMessagesWaiting(QueueHandle_t handle)
{ return ((fake_queue_t *)handle)->count; }

#define recv fake_recv
#define send fake_send
#include "wifi_tcp_adapter.inc"
#undef recv
#undef send
#include "wifi_rx_transport.inc"

static void reset_adapter(void)
{
    memset(&s_fake_rx_queue, 0, sizeof(s_fake_rx_queue));
    memset(&s_fake_tx_queue, 0, sizeof(s_fake_tx_queue));
    memset(&s_tx_item, 0, sizeof(s_tx_item));
    s_rx_queue = &s_fake_rx_queue; s_tx_queue = &s_fake_tx_queue;
    s_socket = 3; s_session_generation = 9u;
    s_peer_fin_pending=false;s_tcp_connection_generation=1u;s_fin_connection_generation=0u;
    s_incoming_length = s_incoming_offset = s_recv_allowance = 0u;
    s_fin_after_bytes = false; s_sent_length = 0u; s_send_chunk = 512u;
    s_send_error = s_disconnects = s_failures = 0;
    s_frame_ok = s_frame_errors = s_rx_frames_before_disconnect = 0u;
    s_control_submissions=0u;s_control_last_request=0u;
    s_tx_length = s_tx_offset = 0u;
    s_tx_active = s_tx_bootstrap = s_tx_resync_pending = s_tx_completion_pending = false;
    s_tx_started_us = s_now_us = 1000u;
    sb_sp_cobs_stream_reset(&s_rx_stream);
}
static size_t make_wire(uint8_t *out, const uint8_t *payload, size_t payload_length, uint32_t request)
{
    sb_sp_frame_t frame = {.major=1u,.minor=0u,.type=SB_SP_REQUEST,.service_id=1u,
        .message_id=1u,.request_id=request,.sequence=request,.payload_length=(uint32_t)payload_length,
        .payload=payload};
    size_t amount = 0u;
    assert(sb_sp_cobs_encode_delimited(&frame, out, SB_SP_COBS_MAX_ENCODED, &amount));
    return amount;
}
static void incoming_bytes(const uint8_t *data, size_t amount, size_t allowance, bool fin)
{
    assert(amount <= sizeof(s_incoming));
    memcpy(s_incoming, data, amount);
    s_incoming_length = amount; s_incoming_offset = 0u;
    s_recv_allowance = allowance; s_fin_after_bytes = fin;
}
static void receive_to_end(size_t allowance)
{
    for (size_t turns = 0; turns < sizeof(s_incoming) + 2u && s_incoming_offset < s_incoming_length; ++turns) {
        s_recv_allowance = allowance; receive_tcp();
    }
    assert(s_incoming_offset == s_incoming_length);
}
static void assert_frame(uint32_t request, const uint8_t *payload, size_t length)
{
    sb_sp_frame_t frame;uint8_t decoded[SB_SP_MAX_RX_PAYLOAD];uint32_t generation=0;
    assert(sb_wifi_receive_frame_for_generation(&frame,decoded,sizeof(decoded),&generation));
    assert(frame.request_id == request && frame.payload_length == length);
    assert(generation == 9u);
    assert(memcmp(decoded, payload, length) == 0);
}
static void test_rx(void)
{
    uint8_t wire[3u * 100u], payload[] = {0u, 0x11u, 0u, 0x22u};
    size_t n = make_wire(wire, payload, sizeof(payload), 1u);
    reset_adapter(); incoming_bytes(wire, n, n, false); receive_tcp();
    assert(s_frame_ok == 1u && s_fake_rx_queue.count == 1u); assert_frame(1u, payload, sizeof(payload));

    reset_adapter(); incoming_bytes(wire, n, 1u, false); receive_to_end(1u);
    assert(s_frame_ok == 1u); assert_frame(1u, payload, sizeof(payload));

    reset_adapter(); incoming_bytes(wire, n, n - 1u, false); receive_tcp();
    assert(s_fake_rx_queue.count == 0u);
    s_recv_allowance = 1u; receive_tcp(); assert_frame(1u, payload, sizeof(payload));

    size_t n2 = make_wire(wire + n, payload, sizeof(payload), 2u);
    size_t n3 = make_wire(wire + n + n2, payload, sizeof(payload), 3u);
    reset_adapter(); incoming_bytes(wire, n + n2, n + n2, false); receive_tcp();
    assert_frame(1u, payload, sizeof(payload)); assert_frame(2u, payload, sizeof(payload));
    reset_adapter(); incoming_bytes(wire, n + n2 + n3, n + n2 + n3, false); receive_tcp();
    assert_frame(1u, payload, sizeof(payload)); assert_frame(2u, payload, sizeof(payload));
    assert_frame(3u, payload, sizeof(payload));

    reset_adapter(); const uint8_t empty[] = {0u, 0u}; incoming_bytes(empty, sizeof(empty), sizeof(empty), false);
    receive_tcp(); assert(s_fake_rx_queue.count == 0u && s_frame_errors == 0u);
    reset_adapter(); const uint8_t malformed[] = {3u, 1u, 0u};
    incoming_bytes(malformed, sizeof(malformed), sizeof(malformed), false);
    receive_tcp(); assert(s_frame_errors == 1u && s_fake_rx_queue.count == 0u);

    reset_adapter(); uint8_t oversized[SB_SP_COBS_MAX_ENCODED + 2u];
    memset(oversized, 1, sizeof(oversized)); oversized[sizeof(oversized) - 1u] = 0u;
    incoming_bytes(oversized, sizeof(oversized), sizeof(oversized), false); receive_to_end(512u);
    assert(s_frame_errors == 1u && s_fake_rx_queue.count == 0u);

    reset_adapter(); uint8_t raw[SB_SP_MAX_FRAME], corrupt[SB_SP_COBS_MAX_ENCODED];
    sb_sp_frame_t frame = {.major=1u,.type=SB_SP_REQUEST,.service_id=1u,.message_id=1u,
        .request_id=4u,.sequence=4u,.payload_length=(uint32_t)sizeof(payload),.payload=payload};
    size_t raw_n = 0u, corrupt_n = 0u;
    assert(sb_sp_frame_encode(&frame, raw, sizeof(raw), &raw_n)); raw[raw_n - 1u] ^= 1u;
    assert(sb_cobs_encode(raw, raw_n, corrupt, sizeof(corrupt) - 1u, &corrupt_n));
    corrupt[corrupt_n++] = 0u; incoming_bytes(corrupt, corrupt_n, corrupt_n, false);
    receive_tcp(); assert(s_frame_errors == 1u && s_fake_rx_queue.count == 0u);

    reset_adapter(); incoming_bytes(wire, n - 1u, n - 1u, true); receive_tcp();
    assert(s_peer_fin_pending && s_fake_rx_queue.count == 0u && s_rx_stream.used == 0u);
    sb_wifi_finish_peer_fin_if_drained(false);
    assert(s_disconnects == 1);
    reset_adapter(); incoming_bytes(wire, n, n, true); receive_tcp();
    assert(s_peer_fin_pending && s_disconnects == 0 && s_fake_rx_queue.count == 1u);
    sb_wifi_finish_peer_fin_if_drained(false);
    assert(s_disconnects == 0);
    drain_wifi_rx();
    assert(s_control_submissions==1u && s_control_last_request==1u);
    sb_wifi_finish_peer_fin_if_drained(true);
    assert(s_disconnects == 0);
    sb_wifi_finish_peer_fin_if_drained(false);
    assert(s_disconnects == 1 && s_rx_frames_before_disconnect == 0u);
    reset_adapter();incoming_bytes(wire,n,n,true);receive_tcp();assert(s_peer_fin_pending);
    ++s_tcp_connection_generation;sb_wifi_finish_peer_fin_if_drained(false);
    assert(s_disconnects==0); /* stale FIN cannot end a reused physical socket */
}
static void test_tx(void)
{
    uint8_t payload[] = {0u, 7u, 0u, 9u};
    sb_sp_frame_t frame = {.major=1u,.type=SB_SP_RESPONSE,.service_id=1u,.message_id=1u,
        .request_id=5u,.sequence=5u,.payload_length=(uint32_t)sizeof(payload),.payload=payload};
    uint8_t raw[SB_SP_MAX_FRAME], expected[SB_SP_COBS_MAX_ENCODED];
    size_t raw_n = 0u, encoded_n = 0u;
    assert(sb_sp_frame_encode(&frame, raw, sizeof(raw), &raw_n));
    assert(sb_cobs_encode(raw, raw_n, expected, sizeof(expected) - 1u, &encoded_n));
    expected[encoded_n++] = 0u;

    reset_adapter(); wifi_frame_item_t item = {.frame=frame,.session_generation=9u};
    item.frame.payload = NULL; memcpy(item.payload, payload, sizeof(payload));
    assert(xQueueSend(s_tx_queue, &item, 0) == pdTRUE);
    send_queued_tcp();
    assert(s_tx_completion_pending && s_sent_length == encoded_n);
    assert(memcmp(s_sent, expected, encoded_n) == 0);

    reset_adapter(); assert(xQueueSend(s_tx_queue, &item, 0) == pdTRUE);
    s_send_chunk = 3u;
    for (unsigned i = 0u; i < 100u && !s_tx_completion_pending; ++i) send_queued_tcp();
    assert(s_tx_completion_pending && s_sent_length == encoded_n);
    assert(memcmp(s_sent, expected, encoded_n) == 0);

    reset_adapter(); assert(xQueueSend(s_tx_queue, &item, 0) == pdTRUE);
    s_send_error = EWOULDBLOCK; send_queued_tcp();
    assert(s_sent_length == 0u && s_tx_active && s_failures == 0);
    s_send_chunk = 0u; send_queued_tcp(); assert(s_tx_active && s_failures == 0);
    s_send_chunk = 512u; send_queued_tcp();
    assert(s_tx_completion_pending && s_sent_length == encoded_n);

    reset_adapter(); assert(xQueueSend(s_tx_queue, &item, 0) == pdTRUE);
    s_send_chunk = 2u; send_queued_tcp(); assert(s_tx_active);
    s_send_error = EPIPE; send_queued_tcp(); assert(s_failures == 1 && s_socket < 0);

    reset_adapter();s_now_us=UINT64_C(1000000000);s_send_chunk=0u;
    assert(send_transport_ready());
    assert(s_tx_started_us==s_now_us && s_tx_bootstrap && s_tx_active);
    send_queued_tcp();assert(s_failures==0 && s_tx_active);
    s_now_us+=WIFI_TX_STALL_TIMEOUT_US+1u;
    send_queued_tcp();assert(s_failures==1 && s_socket<0);
}
int main(void)
{
    test_rx(); test_tx();
    puts("PASS production Wi-Fi TCP adapter fake socket: COBS RX/TX, partial I/O, errors and FIN");
    return 0;
}
