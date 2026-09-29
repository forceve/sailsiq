#pragma once
#include "sailball/common.h"
#include "esp_err.h"
#include <stdbool.h>
#include <stdint.h>

esp_err_t sb_recorder_start(void);
sb_status_t sb_recorder_request_start(void);
sb_status_t sb_recorder_request_stop(void);
void sb_recorder_get_snapshot(sb_recorder_state_t *state, bool *recording_intent,
                              uint32_t *session_id, uint32_t *block_sequence,
                              uint64_t *start_mono_us, uint64_t *last_sample_us,
                              uint64_t *last_commit_us);
void sb_recorder_get_utc_start(int64_t *utc_us, bool *valid);
bool sb_recorder_get_healthy(void);
bool sb_recorder_can_format_storage(void);
void sb_recorder_gnss_discontinuity(void);
