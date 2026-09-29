#pragma once
#include "sailball/common.h"
#include "sailball/sp.h"
#include "esp_err.h"

typedef void (*sb_control_reboot_handler_t)(void);

esp_err_t sb_control_start(void);
bool sb_control_submit(sb_source_t source, const sb_sp_frame_t *frame);
bool sb_control_submit_for_generation(sb_source_t source, uint32_t generation, const sb_sp_frame_t *frame);
bool sb_control_receive(sb_sp_frame_t *frame, uint8_t *payload, size_t capacity, sb_source_t *source);
bool sb_control_receive_for(sb_source_t source, sb_sp_frame_t *frame, uint8_t *payload, size_t capacity);
bool sb_control_receive_for_generation(sb_source_t source, sb_sp_frame_t *frame, uint8_t *payload,
                                       size_t capacity, uint32_t *generation);
enum { SB_CONTROL_TX_KIND_TERMINAL=1, SB_CONTROL_TX_KIND_IMPORTANT=2,
       SB_CONTROL_TX_KIND_BULK=3, SB_CONTROL_TX_KIND_MISC=4 };
typedef struct {
    sb_source_t source;
    uint32_t generation, ticket;
    uint8_t priority, reserved_kind;
    sb_sp_frame_t frame;
    uint8_t payload[SB_SP_MAX_RX_PAYLOAD];
} sb_control_tx_candidate_t;
bool sb_control_peek_tx_for_generation(sb_source_t source, sb_control_tx_candidate_t *candidate);
bool sb_control_commit_peeked_tx(sb_source_t source, sb_control_tx_candidate_t *candidate);
uint32_t sb_control_session_generation(sb_source_t source);
bool sb_control_has_pending_for_generation(sb_source_t source, uint32_t generation);
void sb_control_transport_start(sb_source_t source);
void sb_control_disconnect(sb_source_t source);
bool sb_control_disconnect_if_generation(sb_source_t source, uint32_t expected_generation);
bool sb_control_invalidate_session_fast(sb_source_t source, uint32_t expected_generation);
void sb_control_set_usb_connected(bool connected);
bool sb_control_get_usb_connected(void);
void sb_control_set_reboot_handler(sb_control_reboot_handler_t handler);
bool sb_control_usb_response_is_reboot(const sb_sp_frame_t *frame);
void sb_control_tx_completed(sb_source_t source, uint32_t generation, uint8_t type,
                             uint32_t request_id, bool reboot_response);
void sb_control_begin_shutdown(void);
