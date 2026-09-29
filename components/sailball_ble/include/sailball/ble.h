#pragma once
#include "sailball/common.h"
#include "sailball/sp.h"
#include "esp_err.h"
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
typedef bool (*sb_ble_session_invalidator_t)(uint32_t old_generation);
esp_err_t sb_ble_init(void);
sb_ble_state_t sb_ble_get_state(void);
bool sb_ble_get_advertising_intent(void);
bool sb_ble_get_mtu(uint16_t *mtu);
void sb_ble_wifi_online(bool online);
void sb_ble_mark_hello_complete(void);
bool sb_ble_take_session_end(uint32_t *old_generation, bool *control_invalidated);
bool sb_ble_take_session_start(void);
void sb_ble_set_session_generation(uint32_t generation);
void sb_ble_set_session_invalidator(sb_ble_session_invalidator_t invalidator);
sb_status_t sb_ble_set_advertising(bool enabled, sb_source_t source);
sb_status_t sb_ble_disconnect(sb_source_t source);
bool sb_ble_can_queue_tx(void);
bool sb_ble_queue_tx(const sb_sp_frame_t *frame, uint32_t generation);
bool sb_ble_receive_frame(sb_sp_frame_t *frame, uint8_t *payload, size_t capacity);
bool sb_ble_receive_frame_for_generation(sb_sp_frame_t *frame, uint8_t *payload, size_t capacity,
                                         uint32_t *generation);
bool sb_ble_take_tx_completion(uint32_t *generation, uint8_t *type, uint32_t *request_id);
void sb_ble_transport_poll(void);
