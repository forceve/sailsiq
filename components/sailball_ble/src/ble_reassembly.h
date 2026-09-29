#pragma once
#include "sailball/sp.h"
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define SB_BLE_FRAGMENT_HEADER_SIZE 6u
#define SB_BLE_FRAGMENT_MAX_VALUE 514u
#define SB_BLE_REASSEMBLY_TIMEOUT_US UINT64_C(3000000)
typedef enum { SB_BLE_RX_INCOMPLETE=0, SB_BLE_RX_COMPLETE, SB_BLE_RX_ERROR } sb_ble_rx_result_t;
typedef struct {
    uint8_t frame[SB_SP_MAX_FRAME];
    uint16_t expected_id,active_id,total,used;
    uint64_t last_fragment_us;
    bool active,resync_any_id;
    uint32_t errors;
} sb_ble_reassembly_t;
typedef bool (*sb_ble_frame_fn)(void *context,const sb_sp_frame_t *frame);
void sb_ble_reassembly_reset(sb_ble_reassembly_t *state);
/* Logical SP reset preserves the physical connection's next frame_id. */
void sb_ble_reassembly_clear_logical(sb_ble_reassembly_t *state);
void sb_ble_reassembly_invalidate(sb_ble_reassembly_t *state);
bool sb_ble_reassembly_expire(sb_ble_reassembly_t *state,uint64_t now_us);
sb_ble_rx_result_t sb_ble_reassembly_feed(sb_ble_reassembly_t *state,const uint8_t *value,size_t length,
                                          uint64_t now_us,sb_ble_frame_fn on_frame,void *context);
