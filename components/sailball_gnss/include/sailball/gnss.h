#pragma once
#include "sailball/common.h"
#include "esp_err.h"

typedef struct {
    uint32_t runtime_baud;
    uint32_t update_rate_hz;
} sb_gnss_runtime_config_t;

esp_err_t sb_gnss_start(void);
void sb_gnss_get_snapshot(sb_gnss_fix_t *fix, sb_gnss_state_t *state, uint64_t *last_rx_us, uint64_t *last_fix_us);
uint32_t sb_gnss_get_restart_generation(void);
bool sb_gnss_receive_normalized(const sb_gnss_fix_t *fix);
bool sb_gnss_try_receive(sb_gnss_fix_t *fix);
void sb_gnss_request_restart(void);
/* Cross-task telemetry request; the GNSS owner applies the public counter. */
void sb_gnss_note_live_stream_drop(void);
