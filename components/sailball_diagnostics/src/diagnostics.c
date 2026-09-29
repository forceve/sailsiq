#include "sailball/diagnostics.h"
#include "sailball/validation.h"
#include "sailball/common.h"
#include "sailball/startup_metrics.h"
#include "esp_heap_caps.h"
#include "freertos/FreeRTOS.h"
#include "freertos/portmacro.h"
#include <string.h>

static portMUX_TYPE s_lock = portMUX_INITIALIZER_UNLOCKED;
static sb_diag_snapshot_t s_counters;
static sb_error_record_t s_errors[SB_ERROR_RING_CAPACITY];
static size_t s_head, s_count;
static uint32_t s_next_error_id = 1;
static bool s_error_ids_exhausted;
static sb_startup_diagnostics_t s_startup_diagnostics;
#ifdef CONFIG_SAILBALL_VALIDATION_METRICS
static sb_validation_metrics_t s_validation;
static sb_startup_heap_t s_startup_heap[SB_STARTUP_PHASE_COUNT];
static sb_wireless_admission_t s_wireless_admission[SB_WIRELESS_COUNT];
#endif

static void note_startup_failure(uint16_t service_id, esp_err_t result, sb_startup_reason_t reason)
{
    if (result == ESP_OK) return;
    uint64_t now=sb_monotonic_us();
    portENTER_CRITICAL(&s_lock);
    s_startup_diagnostics.failure_count=sb_sat_add_u64(s_startup_diagnostics.failure_count,1);
    unsigned slot=s_startup_diagnostics.next_slot;
    s_startup_diagnostics.errors[slot]=(sb_startup_error_t){.mono_us=now,.service_id=service_id,.result=result,.reason=(uint8_t)reason};
    s_startup_diagnostics.next_slot=(slot+1u)%4u;
    portEXIT_CRITICAL(&s_lock);
}
void sb_startup_note_failure(uint16_t service_id, esp_err_t result)
{
    note_startup_failure(service_id,result,SB_STARTUP_SDK_FAILURE);
}
void sb_startup_note_resource_failure(sb_wireless_kind_t kind)
{
    if (kind==SB_WIRELESS_BLE)
        note_startup_failure(7,ESP_ERR_NO_MEM,BLE_RESOURCE_ADMISSION_FAILED);
    else if (kind==SB_WIRELESS_WIFI||kind==SB_WIRELESS_WIFI_START)
        note_startup_failure(6,ESP_ERR_NO_MEM,WIFI_RESOURCE_ADMISSION_FAILED);
}
void sb_validation_note_admission(sb_wireless_kind_t kind, const sb_wireless_admission_t *report)
{
#ifdef CONFIG_SAILBALL_VALIDATION_METRICS
    if ((unsigned)kind>=SB_WIRELESS_COUNT||report==NULL) return;
    portENTER_CRITICAL(&s_lock);s_wireless_admission[kind]=*report;portEXIT_CRITICAL(&s_lock);
#else
    (void)kind;(void)report;
#endif
}
void sb_validation_get_admissions(sb_wireless_admission_t out[SB_WIRELESS_COUNT])
{
    if (out==NULL) return;
#ifdef CONFIG_SAILBALL_VALIDATION_METRICS
    portENTER_CRITICAL(&s_lock);memcpy(out,s_wireless_admission,sizeof(s_wireless_admission));portEXIT_CRITICAL(&s_lock);
#else
    memset(out,0,sizeof(sb_wireless_admission_t)*SB_WIRELESS_COUNT);
#endif
}
void sb_validation_note_admission_after(sb_wireless_kind_t kind)
{
#ifdef CONFIG_SAILBALL_VALIDATION_METRICS
    if ((unsigned)kind>=SB_WIRELESS_COUNT) return;
    sb_wireless_heap_t after=sb_wireless_measure_heap();
    portENTER_CRITICAL(&s_lock);
    if (s_wireless_admission[kind].observed) {
        s_wireless_admission[kind].after=after;
        s_wireless_admission[kind].after_observed=1;
    }
    portEXIT_CRITICAL(&s_lock);
#else
    (void)kind;
#endif
}
void sb_startup_get_diagnostics(sb_startup_diagnostics_t *out)
{
    if (!out) return;
    portENTER_CRITICAL(&s_lock);*out=s_startup_diagnostics;portEXIT_CRITICAL(&s_lock);
}
void sb_validation_note_startup(sb_startup_phase_t phase, esp_err_t result)
{
#ifdef CONFIG_SAILBALL_VALIDATION_METRICS
    if ((unsigned)phase>=SB_STARTUP_PHASE_COUNT) return;
    sb_startup_heap_t sample={.free_bytes=heap_caps_get_free_size(MALLOC_CAP_INTERNAL|MALLOC_CAP_8BIT),
        .minimum_free_bytes=heap_caps_get_minimum_free_size(MALLOC_CAP_INTERNAL|MALLOC_CAP_8BIT),
        .largest_free_block_bytes=heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL|MALLOC_CAP_8BIT),
        .result=result,.observed=1};
    portENTER_CRITICAL(&s_lock);s_startup_heap[phase]=sample;portEXIT_CRITICAL(&s_lock);
#else
    (void)phase;(void)result;
#endif
}
void sb_validation_get_startup(sb_startup_heap_t out[SB_STARTUP_PHASE_COUNT])
{
    if (!out) return;
#ifdef CONFIG_SAILBALL_VALIDATION_METRICS
    portENTER_CRITICAL(&s_lock);memcpy(out,s_startup_heap,sizeof(s_startup_heap));portEXIT_CRITICAL(&s_lock);
#else
    memset(out,0,sizeof(sb_startup_heap_t)*SB_STARTUP_PHASE_COUNT);
#endif
}

void sb_validation_note_stack(sb_validation_task_t task, uint32_t free_bytes)
{
#ifdef CONFIG_SAILBALL_VALIDATION_METRICS
    if ((unsigned)task >= SB_VALIDATION_TASK_COUNT) return;
    portENTER_CRITICAL(&s_lock);
    uint32_t bit = UINT32_C(1) << (unsigned)task;
    if ((s_validation.stack_observed_mask & bit) == 0 ||
        free_bytes < s_validation.stack_low_water_bytes[task]) {
        s_validation.stack_low_water_bytes[task] = free_bytes;
    }
    s_validation.stack_observed_mask |= bit;
    portEXIT_CRITICAL(&s_lock);
#else
    (void)task;
    (void)free_bytes;
#endif
}

void sb_validation_update_heap(uint32_t free_bytes, uint32_t minimum_free_bytes,
                               uint32_t largest_free_block_bytes)
{
#ifdef CONFIG_SAILBALL_VALIDATION_METRICS
    portENTER_CRITICAL(&s_lock);
    s_validation.free_heap_bytes = free_bytes;
    s_validation.minimum_free_heap_bytes = minimum_free_bytes;
    s_validation.largest_free_block_bytes = largest_free_block_bytes;
    s_validation.heap_observed = true;
    portEXIT_CRITICAL(&s_lock);
#else
    (void)free_bytes;
    (void)minimum_free_bytes;
    (void)largest_free_block_bytes;
#endif
}

void sb_validation_get_metrics(sb_validation_metrics_t *out)
{
    if (out == NULL) return;
#ifdef CONFIG_SAILBALL_VALIDATION_METRICS
    portENTER_CRITICAL(&s_lock);
    *out = s_validation;
    portEXIT_CRITICAL(&s_lock);
#else
    memset(out, 0, sizeof(*out));
#endif
}

void sb_diag_add(sb_diag_group_t group, unsigned counter, uint64_t amount)
{
    if ((unsigned)group >= SB_DIAG_GROUP_COUNT || counter >= SB_DIAG_COUNTERS_PER_GROUP) return;
    portENTER_CRITICAL(&s_lock);
    s_counters.value[group][counter] = sb_sat_add_u64(s_counters.value[group][counter], amount);
    portEXIT_CRITICAL(&s_lock);
}
void sb_diag_increment(sb_diag_group_t group, unsigned counter) { sb_diag_add(group, counter, 1); }
void sb_diag_max(sb_diag_group_t group, unsigned counter, uint64_t value)
{
    if ((unsigned)group >= SB_DIAG_GROUP_COUNT || counter >= SB_DIAG_COUNTERS_PER_GROUP) return;
    portENTER_CRITICAL(&s_lock);
    if (value > s_counters.value[group][counter]) s_counters.value[group][counter] = value;
    portEXIT_CRITICAL(&s_lock);
}
void sb_diag_snapshot(sb_diag_snapshot_t *out)
{
    if (out == NULL) return;
    portENTER_CRITICAL(&s_lock); memcpy(out, &s_counters, sizeof(*out)); portEXIT_CRITICAL(&s_lock);
}
uint32_t sb_diag_raise(uint16_t service_id, uint16_t error_code, uint8_t severity, bool utc_valid, int64_t utc_us)
{
    bool known_error=(service_id==2u&&error_code>=1u&&error_code<=3u)||
                     (service_id==3u&&error_code>=1u&&error_code<=3u)||
                     (service_id==4u&&error_code>=1u&&error_code<=5u);
    if(!known_error||severity>2u)return 0u;
    uint64_t now = sb_monotonic_us();
    sb_error_record_t e;
    portENTER_CRITICAL(&s_lock);
    if (s_error_ids_exhausted) { portEXIT_CRITICAL(&s_lock); return 0; }
    uint32_t id = s_next_error_id;
    if(s_next_error_id==UINT32_MAX)s_error_ids_exhausted=true;
    else ++s_next_error_id;
    e = (sb_error_record_t){ .error_id=id, .first_mono_us=now, .last_mono_us=now,
        .service_id=service_id, .error_code=error_code, .severity=severity,
        .occurrence_count=1, .utc_us=utc_us, .utc_valid=utc_valid };
    s_errors[s_head] = e; s_head = (s_head + 1u) % SB_ERROR_RING_CAPACITY;
    if (s_count < SB_ERROR_RING_CAPACITY) ++s_count;
    portEXIT_CRITICAL(&s_lock);
    return id;
}
void sb_diag_clear_errors(void)
{
    portENTER_CRITICAL(&s_lock); s_count = 0; s_head = 0; portEXIT_CRITICAL(&s_lock);
}
size_t sb_diag_get_errors(uint32_t after_id, bool has_after, size_t limit, sb_error_record_t *out,
                          uint32_t *oldest_id, uint32_t *newest_id)
{
    if (limit > 32) limit = 32;
    portENTER_CRITICAL(&s_lock);
    size_t first = (s_head + SB_ERROR_RING_CAPACITY - s_count) % SB_ERROR_RING_CAPACITY;
    if (oldest_id != NULL) *oldest_id = s_count ? s_errors[first].error_id : 0;
    if (newest_id != NULL) *newest_id = s_count ? s_errors[(s_head + SB_ERROR_RING_CAPACITY - 1u) % SB_ERROR_RING_CAPACITY].error_id : 0;
    size_t skip = 0;
    if (has_after) while (skip < s_count && s_errors[(first + skip) % SB_ERROR_RING_CAPACITY].error_id <= after_id) ++skip;
    else if (s_count > limit) skip = s_count - limit;
    size_t n = 0;
    while (skip < s_count && n < limit) {
        if (out != NULL) out[n] = s_errors[(first + skip) % SB_ERROR_RING_CAPACITY];
        ++n; ++skip;
    }
    portEXIT_CRITICAL(&s_lock);
    return n;
}
