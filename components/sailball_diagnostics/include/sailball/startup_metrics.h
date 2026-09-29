#pragma once
#include <stdint.h>
#include "esp_err.h"
#include "sailball/wireless_admission.h"

typedef enum { SB_STARTUP_CORE, SB_STARTUP_TASKS, SB_STARTUP_BLE,
               SB_STARTUP_WIFI, SB_STARTUP_PHASE_COUNT } sb_startup_phase_t;
typedef struct {
    uint32_t free_bytes, minimum_free_bytes, largest_free_block_bytes;
    esp_err_t result;
    uint8_t observed;
} sb_startup_heap_t;
typedef struct {
    uint64_t mono_us;
    uint16_t service_id; /* internal only: no allocated wire error_code */
    esp_err_t result;
    uint8_t reason;
} sb_startup_error_t;
typedef enum { SB_STARTUP_SDK_FAILURE, BLE_RESOURCE_ADMISSION_FAILED,
               WIFI_RESOURCE_ADMISSION_FAILED } sb_startup_reason_t;
typedef struct {
    uint64_t failure_count;
    sb_startup_error_t errors[4];
    uint32_t next_slot;
} sb_startup_diagnostics_t;
void sb_startup_note_failure(uint16_t service_id, esp_err_t result);
void sb_startup_note_resource_failure(sb_wireless_kind_t kind);
void sb_startup_get_diagnostics(sb_startup_diagnostics_t *out);
void sb_validation_note_startup(sb_startup_phase_t phase, esp_err_t result);
void sb_validation_get_startup(sb_startup_heap_t out[SB_STARTUP_PHASE_COUNT]);
void sb_validation_note_admission(sb_wireless_kind_t kind, const sb_wireless_admission_t *report);
void sb_validation_note_admission_after(sb_wireless_kind_t kind);
void sb_validation_get_admissions(sb_wireless_admission_t out[SB_WIRELESS_COUNT]);
