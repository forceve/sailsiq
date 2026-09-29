#pragma once

#include "sailball/common.h"
#include <stdbool.h>
#include <stdint.h>

typedef enum {
    SB_PROGRESS_IDLE = 0,
    SB_PROGRESS_HEALTHY,
    SB_PROGRESS_STORAGE_NOT_READY,
    SB_PROGRESS_GNSS_NO_RX,
    SB_PROGRESS_GNSS_ERROR,
    SB_PROGRESS_RECORDER_NOT_READY,
    SB_PROGRESS_RECORDER_NOT_CONSUMING,
    SB_PROGRESS_AWAITING_FIRST_COMMIT,
    SB_PROGRESS_STORAGE_COMMIT_STALLED
} sb_progress_cause_t;

typedef struct {
    uint64_t now_us;
    uint64_t gnss_last_rx_us;
    uint64_t recorder_start_mono_us;
    uint64_t recorder_last_sample_us;
    uint64_t recorder_last_commit_us;
    uint64_t sample_timeout_ms;
    uint64_t commit_grace_ms;
    bool recording_intent;
    sb_gnss_state_t gnss_state;
    sb_recorder_state_t recorder_state;
    sb_storage_state_t storage_state;
} sb_progress_input_t;

sb_progress_cause_t sb_progress_evaluate(const sb_progress_input_t *input);
