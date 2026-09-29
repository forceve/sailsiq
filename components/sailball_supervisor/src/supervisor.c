#include "sailball/supervisor.h"
#include "sailball/gnss.h"
#include "sailball/recorder.h"
#include "sailball/storage.h"
#include "sailball/transfer.h"
#include "sailball/board.h"
#include "sailball/validation.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/portmacro.h"
#include "esp_err.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "esp_task_wdt.h"
#include "esp_heap_caps.h"
#include "sdkconfig.h"
#include <stdlib.h>

#define SUPERVISOR_STACK_WORDS 2048
static StaticTask_t s_task_struct;
static StackType_t s_stack[SUPERVISOR_STACK_WORDS];
static portMUX_TYPE s_mux = portMUX_INITIALIZER_UNLOCKED;
static sb_supervisor_snapshot_t s_snapshot;
static sb_supervisor_shutdown_hook_t s_shutdown_hook;
static bool s_reboot_requested;
static portMUX_TYPE s_reboot_mux = portMUX_INITIALIZER_UNLOCKED;

static uint64_t sample_period_ms(void)
{
    uint64_t num = CONFIG_SAILBALL_GNSS_SAMPLE_RATE_NUM;
    uint64_t den = CONFIG_SAILBALL_GNSS_SAMPLE_RATE_DEN;
    if (num == 0 || den == 0) return CONFIG_SAILBALL_PROGRESS_GNSS_STALL_MS;
    return (den * 1000u + num - 1u) / num;
}

static void publish_health(sb_progress_cause_t cause, bool healthy,
                           uint64_t last_rx, uint64_t last_fix,
                           uint64_t last_sample, uint64_t last_commit)
{
    sb_supervisor_snapshot_t snapshot = {
        .critical_path_healthy = healthy,
        .cause = cause,
        .gnss_last_rx_us = last_rx,
        .gnss_last_fix_us = last_fix,
        .recorder_last_sample_us = last_sample,
        .recorder_last_commit_us = last_commit
    };
    portENTER_CRITICAL(&s_mux);
    s_snapshot = snapshot;
    portEXIT_CRITICAL(&s_mux);
}

static void evaluate_progress(const sb_board_info_t *board, uint64_t *last_restart_us)
{
    const uint64_t now = (uint64_t)esp_timer_get_time();
    const uint64_t period_ms = sample_period_ms();
    const uint64_t sample_timeout_ms = period_ms * 3u > CONFIG_SAILBALL_PROGRESS_GNSS_STALL_MS
        ? period_ms * 3u : CONFIG_SAILBALL_PROGRESS_GNSS_STALL_MS;
    sb_gnss_state_t gnss_state;
    uint64_t last_rx = 0, last_fix = 0;
    sb_gnss_get_snapshot(NULL, &gnss_state, &last_rx, &last_fix);
    sb_recorder_state_t recorder_state;
    bool intent = false;
    uint64_t recorder_start = 0, last_sample = 0, last_commit = 0;
    sb_recorder_get_snapshot(&recorder_state, &intent, NULL, NULL, &recorder_start, &last_sample, &last_commit);
    sb_storage_state_t storage_state = sb_storage_get_state();
    sb_progress_input_t input = {
        .now_us=now, .gnss_last_rx_us=last_rx, .recorder_start_mono_us=recorder_start,
        .recorder_last_sample_us=last_sample,
        .recorder_last_commit_us=last_commit, .sample_timeout_ms=sample_timeout_ms,
        .commit_grace_ms=CONFIG_SAILBALL_PROGRESS_COMMIT_GRACE_MS,
        .recording_intent=intent, .gnss_state=gnss_state,
        .recorder_state=recorder_state, .storage_state=storage_state
    };
    sb_progress_cause_t cause=sb_progress_evaluate(&input);
    bool healthy=cause==SB_PROGRESS_IDLE||cause==SB_PROGRESS_HEALTHY;
    publish_health(cause,healthy,last_rx,last_fix,last_sample,last_commit);
    if (healthy) *last_restart_us = 0;
    if (board->gnss_configured &&
        (cause == SB_PROGRESS_GNSS_NO_RX || cause == SB_PROGRESS_GNSS_ERROR) &&
        (*last_restart_us == 0 || now - *last_restart_us >=
         (uint64_t)CONFIG_SAILBALL_PROGRESS_GNSS_RESTART_INTERVAL_MS * 1000u)) {
        sb_gnss_request_restart();
        *last_restart_us = now;
    }
}

static void graceful_reboot(void)
{
    if (s_shutdown_hook != NULL) s_shutdown_hook();
    const int64_t deadline = esp_timer_get_time() + INT64_C(6000000);
    bool stop_queued = false;
    for (;;) {
        (void)esp_task_wdt_reset();
        (void)sb_transfer_shutdown();
        sb_recorder_state_t state = SB_RECORDER_ERROR;
        bool intent = false, file_active = false;
        sb_recorder_get_snapshot(&state, &intent, NULL, NULL, NULL, NULL, NULL);
        sb_storage_get_file_snapshot(NULL, NULL, &file_active);
        if (state == SB_RECORDER_STOPPED && !intent && !file_active &&
            !sb_transfer_is_active() && !sb_storage_transfer_is_active()) esp_restart();
        if (!stop_queued) {
            sb_status_t status = sb_recorder_request_stop();
            stop_queued = status == SB_OK || status == SB_ACCEPTED;
        }
        if (esp_timer_get_time() >= deadline) esp_restart();
        vTaskDelay(pdMS_TO_TICKS(10));
    }
}

static void supervisor_task(void *arg)
{
    (void)arg;
    if (esp_task_wdt_add(NULL) != ESP_OK) abort();
    sb_board_info_t board;
    sb_board_get_info(&board);
    uint64_t last_gnss_restart_us = 0;
    for (;;) {
        (void)esp_task_wdt_reset();
        sb_validation_note_stack(SB_VALIDATION_TASK_SUPERVISOR,
                                 (uint32_t)uxTaskGetStackHighWaterMark(NULL));
        sb_validation_update_heap((uint32_t)heap_caps_get_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT),
                                  (uint32_t)heap_caps_get_minimum_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT),
                                  (uint32_t)heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT));
        portENTER_CRITICAL(&s_reboot_mux); bool reboot = s_reboot_requested; portEXIT_CRITICAL(&s_reboot_mux);
        if (reboot) graceful_reboot();
        evaluate_progress(&board, &last_gnss_restart_us);
        vTaskDelay(pdMS_TO_TICKS(250));
    }
}
esp_err_t sb_supervisor_start(void)
{
    return xTaskCreateStatic(supervisor_task,"supervisor_task",SUPERVISOR_STACK_WORDS,NULL,6,s_stack,&s_task_struct) ? ESP_OK : ESP_ERR_NO_MEM;
}
bool sb_supervisor_critical_healthy(void)
{
    portENTER_CRITICAL(&s_mux); bool v=s_snapshot.critical_path_healthy; portEXIT_CRITICAL(&s_mux); return v;
}

void sb_supervisor_get_snapshot(sb_supervisor_snapshot_t *out)
{
    if (out == NULL) return;
    portENTER_CRITICAL(&s_mux);
    *out = s_snapshot;
    portEXIT_CRITICAL(&s_mux);
}

void sb_supervisor_request_reboot(void)
{
    portENTER_CRITICAL(&s_reboot_mux); s_reboot_requested = true; portEXIT_CRITICAL(&s_reboot_mux);
}

void sb_supervisor_set_shutdown_hook(sb_supervisor_shutdown_hook_t hook)
{
    s_shutdown_hook = hook;
}
