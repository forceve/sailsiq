#pragma once
#include "sailball/common.h"
#include "sailball/sp.h"
#include "esp_err.h"
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define SB_WIFI_SSID_MAX 32u
#define SB_WIFI_AP_CACHE_MAX 16u

typedef struct {
    uint8_t ssid[SB_WIFI_SSID_MAX];
    uint8_t ssid_length;
    int8_t rssi;
    uint8_t security, channel, bssid[6];
} sb_wifi_ap_t;

typedef struct {
    sb_wifi_state_t state;
    bool configured, rssi_valid, ipv4_valid, last_error_valid;
    uint8_t ssid[SB_WIFI_SSID_MAX], ssid_length;
    int8_t rssi;
    uint8_t ipv4[4], last_error;
    uint32_t scan_generation;
} sb_wifi_snapshot_t;

esp_err_t sb_wifi_init(void);
sb_wifi_state_t sb_wifi_get_state(void);
bool sb_wifi_is_online(void);
/* Internal lifecycle signal; not part of the Frozen SP status ABI. */
bool sb_wifi_is_initializing(void);
void sb_wifi_get_snapshot(sb_wifi_snapshot_t *out);
size_t sb_wifi_get_scan_results(sb_wifi_ap_t *out, size_t capacity, uint32_t *generation);
sb_status_t sb_wifi_request_scan(sb_source_t source);
sb_status_t sb_wifi_request_set_config(sb_source_t source, const uint8_t *ssid, size_t ssid_length,
                                       const uint8_t *password, size_t password_length);
sb_status_t sb_wifi_request_connect(sb_source_t source, const uint8_t address[4], uint16_t port, uint32_t handover_id);
sb_status_t sb_wifi_request_disconnect(sb_source_t source);
sb_status_t sb_wifi_request_forget(sb_source_t source);
bool sb_wifi_can_queue_tx(void);
bool sb_wifi_queue_tx(const sb_sp_frame_t *frame, uint32_t generation);
bool sb_wifi_receive_frame(sb_sp_frame_t *frame, uint8_t *payload, size_t capacity);
bool sb_wifi_receive_frame_for_generation(sb_sp_frame_t *frame, uint8_t *payload, size_t capacity,
                                          uint32_t *generation);
void sb_wifi_set_session_generation(uint32_t generation);
bool sb_wifi_take_session_start(void);
bool sb_wifi_take_tx_completion(uint32_t *generation, uint8_t *type, uint32_t *request_id);
void sb_wifi_mark_hello_complete(void);
bool sb_wifi_take_session_end(void);
/* Peer FIN is half-close: drain complete RX and terminal TX before closing. */
void sb_wifi_finish_peer_fin_if_drained(bool control_pending);
void sb_wifi_transport_poll(void);
