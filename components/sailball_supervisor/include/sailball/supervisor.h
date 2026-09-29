#pragma once
#include "sailball/common.h"
#include "sailball/progress.h"
#include "esp_err.h"
#include <stdbool.h>
#include <stdint.h>

typedef struct {
    bool critical_path_healthy;
    sb_progress_cause_t cause;
    uint64_t gnss_last_rx_us;
    uint64_t gnss_last_fix_us;
    uint64_t recorder_last_sample_us;
    uint64_t recorder_last_commit_us;
} sb_supervisor_snapshot_t;

typedef void (*sb_supervisor_shutdown_hook_t)(void);
esp_err_t sb_supervisor_start(void);
bool sb_supervisor_critical_healthy(void);
void sb_supervisor_get_snapshot(sb_supervisor_snapshot_t *out);
void sb_supervisor_request_reboot(void);
void sb_supervisor_set_shutdown_hook(sb_supervisor_shutdown_hook_t hook);
