#include "sailball/recorder.h"
#include "sailball/gnss.h"
#include "sailball/storage.h"
#include "sailball/diagnostics.h"
#include "sailball/validation.h"
#include "sailball/ldc.h"
#include "sailball/board.h"
#include "sailball/time_grid.h"
#include "sailball/recorder_pool_config.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "freertos/portmacro.h"
#include "esp_err.h"
#include "esp_random.h"
#include "esp_task_wdt.h"
#include "sdkconfig.h"
#include <stdlib.h>
#include <string.h>

#define RECORDER_STACK_WORDS 4096
#define RECORDER_COMMAND_DEPTH 8
#define SB_LDC_BLOCK_CAPACITY 8192u
#define SB_RECORDER_SAFE_SLOTS 80u
#define SB_RECORDER_MAX_FIELDS 7u
#define SB_RECORDER_OPEN_RETRY_MS 5000u
#define SB_RECORDER_WRITE_RETRY_MS 500u

typedef enum { CMD_START = 1, CMD_STOP, CMD_DISCONTINUITY } recorder_command_t;
typedef enum { POOL_FREE = 0, POOL_FILLING, POOL_READY, POOL_WRITING } pool_state_t;
typedef struct {
    sb_gnss_fix_t fix;
    uint16_t slot;
} recorder_sample_t;

static StaticQueue_t s_cmd_q_struct;
static uint8_t s_cmd_q_data[RECORDER_COMMAND_DEPTH * sizeof(recorder_command_t)];
static QueueHandle_t s_cmd_q;
static StaticTask_t s_task_struct;
static StackType_t s_stack[RECORDER_STACK_WORDS];
static portMUX_TYPE s_mux = portMUX_INITIALIZER_UNLOCKED;
static sb_recorder_state_t s_state = SB_RECORDER_STARTING;
static bool s_intent = true;
static uint32_t s_session_id, s_block_sequence;
static uint64_t s_start_mono_us, s_last_sample_us, s_last_commit_us;
static int64_t s_start_utc_us;
static bool s_start_utc_valid;
static uint32_t s_last_input_sample_seq;
static bool s_have_input_sample_seq;

/* The pool and its ownership states are private to recorder_task. */
static uint8_t s_block_pool[SB_RECORDER_BLOCK_POOL_COUNT][SB_LDC_BLOCK_CAPACITY];
static pool_state_t s_pool_state[SB_RECORDER_BLOCK_POOL_COUNT];
static uint16_t s_pool_sample_count[SB_RECORDER_BLOCK_POOL_COUNT];
static recorder_sample_t s_samples[SB_RECORDER_SAFE_SLOTS];
static size_t s_sample_count;
static uint8_t s_field_mask;
static bool s_block_open, s_block_time_discontinuity, s_next_time_discontinuity;
static bool s_block_utc_valid, s_file_open, s_create_pending, s_close_pending;
static bool s_rollover_pending;
static bool s_new_session_required = true;
static uint8_t s_utc_source;
static uint32_t s_file_sequence, s_active_file_sequence;
static uint64_t s_last_block_end_mono_us;
static TickType_t s_open_retry_at;
static uint32_t s_seen_gnss_restart_generation;

static void fatal_invariant(void)
{
    abort();
}

static uint16_t rate_num(void) { return CONFIG_SAILBALL_GNSS_SAMPLE_RATE_NUM; }
static uint16_t rate_den(void) { return CONFIG_SAILBALL_GNSS_SAMPLE_RATE_DEN; }

static uint16_t gcd_u16(uint16_t a, uint16_t b)
{
    while (b != 0) { uint16_t r = (uint16_t)(a % b); a = b; b = r; }
    return a;
}

static uint16_t reduced_rate_num(void) { uint16_t g = gcd_u16(rate_num(), rate_den()); return (uint16_t)(rate_num() / g); }
static uint16_t reduced_rate_den(void) { uint16_t g = gcd_u16(rate_num(), rate_den()); return (uint16_t)(rate_den() / g); }

static uint8_t fix_availability(const sb_gnss_fix_t *fix)
{
    uint8_t mask = 0;
    if (fix->position_valid) mask |= (1u << 0) | (1u << 1);
    if (fix->altitude_valid) mask |= 1u << 2;
    if (fix->ground_speed_valid) mask |= 1u << 3;
    if (fix->course_valid) mask |= 1u << 4;
    if (fix->satellites_valid) mask |= 1u << 5;
    mask |= 1u << 6; /* Unknown fix states are preserved as the unassigned value 255. */
    return mask;
}

static bool sample_utc_mapping_changed(const sb_gnss_fix_t *fix)
{
    if (!s_block_open || fix->utc_valid != s_block_utc_valid) return true;
    if (!fix->utc_valid) return false;
    if (s_utc_source != 1u) return true;
    const sb_gnss_fix_t *first = &s_samples[0].fix;
    if (fix->mono_us < first->mono_us) return true;
    uint64_t mono_delta = fix->mono_us - first->mono_us;
    if (fix->utc_us < first->utc_us) return true;
    uint64_t utc_delta = (uint64_t)fix->utc_us - (uint64_t)first->utc_us;
    uint64_t difference = utc_delta > mono_delta ? utc_delta - mono_delta : mono_delta - utc_delta;
    return difference > UINT64_C(2000000);
}

static uint16_t slot_for_fix(const sb_gnss_fix_t *fix)
{
    uint16_t slot = UINT16_MAX;
    if (!sb_recorder_grid_slot(rate_num(), rate_den(), s_samples[0].fix.mono_us,
                               fix->mono_us, &slot)) return UINT16_MAX;
    return slot;
}

static uint16_t max_slots_per_block(void)
{
    uint64_t n = (uint64_t)reduced_rate_num() * 15u;
    uint64_t d = reduced_rate_den();
    uint64_t slots = (n + d - 1u) / d;
    if (slots > SB_RECORDER_SAFE_SLOTS) slots = SB_RECORDER_SAFE_SLOTS;
    if (slots == 0) slots = 1;
    return (uint16_t)slots;
}

static bool append_uvar(uint8_t *out, size_t capacity, size_t *cursor, uint64_t value)
{
    uint8_t bytes[10]; size_t count = 0;
    if (!sb_ldc_uvar_encode(value, bytes, &count) || count > capacity - *cursor) return false;
    memcpy(out + *cursor, bytes, count); *cursor += count;
    return true;
}

static bool append_absolute(uint8_t *out, size_t capacity, size_t *cursor, uint64_t value)
{
    return append_uvar(out, capacity, cursor, value);
}

static int acquire_pool_buffer(void)
{
    for (unsigned i = 0; i < SB_RECORDER_BLOCK_POOL_COUNT; ++i) {
        if (s_pool_state[i] == POOL_FREE) {
            s_pool_state[i] = POOL_FILLING;
            return (int)i;
        }
    }
    return -1;
}

static void pool_transition(unsigned id, pool_state_t from, pool_state_t to)
{
    if (id >= SB_RECORDER_BLOCK_POOL_COUNT || s_pool_state[id] != from) fatal_invariant();
    s_pool_state[id] = to;
}

static bool field_has(uint8_t id)
{
    return id >= 1u && id <= 7u && (s_field_mask & (1u << (id - 1u))) != 0;
}

static uint64_t sample_unsigned(const sb_gnss_fix_t *fix, uint8_t field)
{
    switch (field) {
    case 4: return fix->ground_speed_centi_kn;
    case 5: return fix->course_centi_deg;
    case 6: return fix->satellites_used;
    case 7: return sb_fix_to_ldc(fix->fix_type);
    default: return 0;
    }
}

static int64_t sample_signed(const sb_gnss_fix_t *fix, uint8_t field)
{
    switch (field) {
    case 1: return fix->latitude_e7;
    case 2: return fix->longitude_e7;
    case 3: return fix->altitude_cm;
    default: return 0;
    }
}

static bool append_change_stream(uint8_t *payload, size_t capacity, size_t *length,
                                 uint8_t field, uint16_t *value_count)
{
    size_t cursor = 0;
    uint64_t previous = sample_unsigned(&s_samples[0].fix, field);
    if (!append_absolute(payload, capacity, &cursor, previous)) return false;
    uint16_t events = 0;
    uint16_t previous_slot = 0;
    for (size_t i = 1; i < s_sample_count; ++i) {
        uint64_t current = sample_unsigned(&s_samples[i].fix, field);
        if (current == previous) continue;
        if (s_samples[i].slot <= previous_slot || !append_uvar(payload, capacity, &cursor, s_samples[i].slot - previous_slot) ||
            !append_absolute(payload, capacity, &cursor, current)) return false;
        previous_slot = s_samples[i].slot;
        previous = current;
        if (events == UINT16_MAX - 1u) return false;
        ++events;
    }
    *length = cursor;
    *value_count = (uint16_t)(events + 1u);
    return true;
}

static bool build_block(uint8_t *block, size_t capacity, size_t *block_length,
                        uint64_t exclusive_end_us)
{
    if (s_sample_count == 0 || block == NULL || block_length == NULL) return false;
    uint16_t num = reduced_rate_num(), den = reduced_rate_den();
    uint16_t last_slot = s_samples[s_sample_count - 1u].slot;
    uint16_t nominal_slots = (uint16_t)(last_slot + 1u);
    uint32_t duration_us = 0;
    if (!sb_recorder_grid_duration(num, den, nominal_slots, s_samples[0].fix.mono_us,
                                   exclusive_end_us, &duration_us) ||
        duration_us > SB_LDC_MAX_BLOCK_US) return false;

    uint16_t descriptor_count = 0;
    uint32_t payload_cursor = SB_LDC_BLOCK_HEADER_SIZE + SB_RECORDER_MAX_FIELDS * SB_LDC_DESCRIPTOR_SIZE;
    memset(block, 0, capacity);
    for (uint8_t field = 1; field <= 7; ++field) {
        if (!field_has(field)) continue;
        sb_ldc_descriptor_t d = { .local_field_id=field, .definition_version=1,
            .codec=(field <= 5u ? 1u : 2u), .flags=0,
            .payload_offset=payload_cursor };
        size_t stream_length = 0;
        uint8_t *stream = block + payload_cursor;
        size_t stream_capacity = capacity - payload_cursor;
        if (field <= 5u) {
            int64_t signed_values[SB_RECORDER_SAFE_SLOTS];
            uint64_t unsigned_values[SB_RECORDER_SAFE_SLOTS];
            for (size_t i = 0; i < s_sample_count; ++i) {
                if (field <= 3u) signed_values[i] = sample_signed(&s_samples[i].fix, field);
                else unsigned_values[i] = sample_unsigned(&s_samples[i].fix, field);
            }
            if (!sb_ldc_delta_encode(signed_values, unsigned_values, s_sample_count, field <= 3u,
                                     field == 5u, field == 5u ? 36000u : 0u,
                                     stream, stream_capacity, &stream_length)) return false;
            d.value_count = (uint16_t)s_sample_count;
        } else if (!append_change_stream(stream, stream_capacity, &stream_length, field, &d.value_count)) {
            return false;
        }
        d.payload_length = (uint32_t)stream_length;
        if (!sb_ldc_descriptor_encode(&d, block + SB_LDC_BLOCK_HEADER_SIZE + descriptor_count * SB_LDC_DESCRIPTOR_SIZE)) return false;
        payload_cursor += (uint32_t)stream_length;
        ++descriptor_count;
    }

    uint32_t directory_length = (uint32_t)descriptor_count * SB_LDC_DESCRIPTOR_SIZE;
    uint32_t payload_offset = SB_LDC_BLOCK_HEADER_SIZE + directory_length;
    /* The payload was built after the maximum directory reservation; pack it down to the actual directory end. */
    uint32_t reserved_payload_offset = SB_LDC_BLOCK_HEADER_SIZE + SB_RECORDER_MAX_FIELDS * SB_LDC_DESCRIPTOR_SIZE;
    uint32_t payload_length = payload_cursor - reserved_payload_offset;
    if (payload_offset != reserved_payload_offset) {
        memmove(block + payload_offset, block + reserved_payload_offset, payload_length);
        for (uint16_t i = 0; i < descriptor_count; ++i) {
            uint8_t *raw = block + SB_LDC_BLOCK_HEADER_SIZE + (size_t)i * SB_LDC_DESCRIPTOR_SIZE;
            sb_write_le32(raw + 8, sb_read_le32(raw + 8) - reserved_payload_offset + payload_offset);
        }
    }

    uint8_t presence[(SB_RECORDER_SAFE_SLOTS + 7u) / 8u] = {0};
    uint16_t valid_slots = 0;
    for (size_t i = 0; i < s_sample_count; ++i) {
        uint16_t slot = s_samples[i].slot;
        if (slot >= nominal_slots || (presence[slot / 8u] & (1u << (slot % 8u))) != 0) return false;
        presence[slot / 8u] |= (uint8_t)(1u << (slot % 8u));
        ++valid_slots;
    }
    bool has_presence = valid_slots != nominal_slots;
    uint16_t bitmap_length = has_presence ? (uint16_t)((nominal_slots + 7u) / 8u) : 0;
    uint32_t bitmap_offset = has_presence ? payload_offset + payload_length : 0;
    uint32_t total_length = payload_offset + payload_length + bitmap_length + SB_LDC_FOOTER_SIZE;
    if (total_length > capacity || total_length < SB_LDC_BLOCK_HEADER_SIZE + SB_LDC_FOOTER_SIZE) return false;
    if (has_presence) memcpy(block + bitmap_offset, presence, bitmap_length);

    sb_ldc_block_header_t header = {
        .block_sequence=s_block_sequence,
        .block_length=total_length,
        .start_mono_us=s_samples[0].fix.mono_us,
        .start_utc_us=s_block_utc_valid ? s_samples[0].fix.utc_us : 0,
        .sample_rate_num=num, .sample_rate_den=den,
        .nominal_slots=nominal_slots, .valid_slots=valid_slots,
        .stream_count=descriptor_count, .directory_length=(uint16_t)directory_length,
        .payload_offset=payload_offset, .payload_length=payload_length,
        .presence_bitmap_offset=bitmap_offset, .presence_bitmap_length=bitmap_length,
        .time_source=s_block_utc_valid ? s_utc_source : 0,
        .time_flags=s_block_utc_valid ? 1u : 0u,
        .time_accuracy_us=UINT32_MAX, .duration_us=duration_us,
        .flags=(uint16_t)((has_presence ? 1u : 0u) | (s_block_time_discontinuity ? 2u : 0u))
    };
    if (!sb_ldc_header_encode(&header, block)) return false;
    uint8_t *footer = block + total_length - SB_LDC_FOOTER_SIZE;
    sb_write_le32(footer, sb_crc32c(block, total_length - SB_LDC_FOOTER_SIZE));
    sb_write_le32(footer + 4, total_length);
    sb_write_le32(footer + 8, s_block_sequence);
    memcpy(footer + 12, "LDCM", 4);
    if (!sb_ldc_block_validate(block, total_length, s_block_sequence)) return false;
    *block_length = total_length;
    return true;
}

static void clear_block(void)
{
    s_sample_count = 0;
    s_block_open = false;
    s_field_mask = 0;
}

static bool finalize_block_until(uint64_t exclusive_end_us)
{
    if (s_sample_count == 0) { clear_block(); return true; }
    if (!s_file_open || (s_state != SB_RECORDER_RECORDING && s_state != SB_RECORDER_STOPPING)) {
        sb_diag_add(SB_DIAG_RECORDER, 2, s_sample_count);
        clear_block();
        return false;
    }
    int id = acquire_pool_buffer();
    if (id < 0) {
        sb_diag_increment(SB_DIAG_RECORDER, 4); /* buffer_exhaustions */
        sb_diag_add(SB_DIAG_RECORDER, 2, s_sample_count);
        clear_block();
        return false;
    }
    size_t length = 0;
    if (!build_block(s_block_pool[id], SB_LDC_BLOCK_CAPACITY, &length, exclusive_end_us)) {
        pool_transition((unsigned)id, POOL_FILLING, POOL_FREE);
        clear_block();
        fatal_invariant();
    }
    sb_ldc_block_header_t header;
    if (!sb_ldc_header_decode(s_block_pool[id], &header)) fatal_invariant();
    if (header.start_mono_us <= UINT64_MAX - header.duration_us)
        s_last_block_end_mono_us = header.start_mono_us + header.duration_us;
    pool_transition((unsigned)id, POOL_FILLING, POOL_READY);
    s_pool_sample_count[id] = (uint16_t)s_sample_count;
    sb_diag_increment(SB_DIAG_RECORDER, 3);
    if (s_block_sequence == UINT32_MAX) {
        pool_transition((unsigned)id, POOL_READY, POOL_FREE);
        sb_diag_add(SB_DIAG_RECORDER, 2, s_pool_sample_count[id]);
        s_pool_sample_count[id] = 0;
        clear_block();
        s_file_open = false;
        if (s_active_file_sequence == UINT32_MAX) {
            s_new_session_required = true;
            portENTER_CRITICAL(&s_mux); s_state = SB_RECORDER_ERROR; portEXIT_CRITICAL(&s_mux);
        } else {
            s_new_session_required = false;
            s_file_sequence = s_active_file_sequence + 1u;
            portENTER_CRITICAL(&s_mux); s_state = SB_RECORDER_STARTING; portEXIT_CRITICAL(&s_mux);
        }
        s_block_sequence = 0;
        return false;
    }
    if (!sb_storage_submit_block((uint8_t)id, s_block_sequence, s_block_pool[id], length)) {
        pool_transition((unsigned)id, POOL_READY, POOL_FREE);
        s_pool_sample_count[id] = 0;
        sb_diag_add(SB_DIAG_RECORDER, 2, s_sample_count);
        clear_block();
        return false;
    }
    pool_transition((unsigned)id, POOL_READY, POOL_WRITING);
    portENTER_CRITICAL(&s_mux); ++s_block_sequence; portEXIT_CRITICAL(&s_mux);
    clear_block();
    return true;
}

static bool finalize_block(void)
{
    return finalize_block_until(0u);
}

static uint8_t make_session_id(uint8_t out[16])
{
    uint8_t any = 0;
    for (unsigned i = 0; i < 4; ++i) {
        uint32_t random = esp_random();
        sb_write_le32(out + i * 4u, random);
        any |= out[i * 4u] | out[i * 4u + 1u] | out[i * 4u + 2u] | out[i * 4u + 3u];
    }
    return any;
}

static void begin_create(void)
{
    bool rollover_start=s_rollover_pending&&s_state==SB_RECORDER_STOPPING;
    if ((s_state != SB_RECORDER_STARTING&&!rollover_start) || s_create_pending || s_file_open ||
        (!s_intent&&!s_rollover_pending) || s_close_pending || xTaskGetTickCount() < s_open_retry_at) return;
    if (sb_storage_get_state() != SB_STORAGE_READY) return;
    if(!s_rollover_pending)
        for (unsigned i = 0; i < SB_RECORDER_BLOCK_POOL_COUNT; ++i) if (s_pool_state[i] == POOL_WRITING) return;
    if (s_new_session_required) {
        if (s_session_id == UINT32_MAX) { portENTER_CRITICAL(&s_mux); s_state = SB_RECORDER_ERROR; portEXIT_CRITICAL(&s_mux); return; }
        portENTER_CRITICAL(&s_mux); ++s_session_id; portEXIT_CRITICAL(&s_mux);
        s_file_sequence = 0;
        portENTER_CRITICAL(&s_mux); s_block_sequence = 0; s_start_mono_us = sb_monotonic_us(); s_start_utc_us = 0; s_start_utc_valid = false; portEXIT_CRITICAL(&s_mux);
        s_new_session_required = false;
    }
    uint8_t file_session[16];
    if (make_session_id(file_session) == 0) { fatal_invariant(); }
    sb_board_info_t board; sb_board_get_info(&board);
    if (!sb_storage_create_recording(board.boot_id, s_session_id, s_file_sequence, board.device_id, file_session)) {
        s_open_retry_at = xTaskGetTickCount() + pdMS_TO_TICKS(SB_RECORDER_OPEN_RETRY_MS);
        sb_diag_increment(SB_DIAG_RECORDER, 7);
        return;
    }
    s_create_pending = true;
}

static void enter_storage_error(void)
{
    if (s_sample_count != 0) {
        sb_diag_add(SB_DIAG_RECORDER, 2, s_sample_count);
        clear_block();
    }
    s_file_open = false;
    s_close_pending = false;
    s_new_session_required = true;
    s_open_retry_at = xTaskGetTickCount() + pdMS_TO_TICKS(SB_RECORDER_OPEN_RETRY_MS);
    portENTER_CRITICAL(&s_mux);
    s_state = s_intent ? SB_RECORDER_ERROR : SB_RECORDER_STOPPING;
    portEXIT_CRITICAL(&s_mux);
}

static void handle_ack(const sb_storage_ack_t *ack)
{
    if (ack->op == SB_STORAGE_OP_CREATE) {
        if (!s_create_pending) fatal_invariant();
        s_create_pending = false;
        if(ack->status!=SB_OK)s_rollover_pending=false;
        if (ack->status == SB_OK) {
            s_file_open = true;
            s_active_file_sequence = ack->file_sequence;
            s_file_sequence = ack->file_sequence;
            s_rollover_pending=false;
            portENTER_CRITICAL(&s_mux); s_block_sequence = ack->committed_block_sequence; portEXIT_CRITICAL(&s_mux);
            if (s_intent) {
                portENTER_CRITICAL(&s_mux);
                s_state = SB_RECORDER_RECORDING;
                if (s_start_mono_us == 0) s_start_mono_us = sb_monotonic_us();
                portEXIT_CRITICAL(&s_mux);
            }
        } else if (ack->reason == SB_STORAGE_REASON_NO_SPACE) {
            s_open_retry_at = xTaskGetTickCount() + pdMS_TO_TICKS(SB_RECORDER_OPEN_RETRY_MS);
            if (s_intent) { portENTER_CRITICAL(&s_mux); s_state = SB_RECORDER_ERROR; portEXIT_CRITICAL(&s_mux); }
            else { portENTER_CRITICAL(&s_mux); s_state = SB_RECORDER_STOPPING; portEXIT_CRITICAL(&s_mux); }
            sb_diag_increment(SB_DIAG_RECORDER, 7);
        } else {
            enter_storage_error();
        }
        return;
    }
    if (ack->op == SB_STORAGE_OP_WRITE_BLOCK) {
        if (ack->buffer_id >= SB_RECORDER_BLOCK_POOL_COUNT) fatal_invariant();
        if(ack->status==SB_ACCEPTED&&ack->reason==SB_STORAGE_REASON_SIZE_LIMIT){
            /* Storage still owns this WRITING buffer and will return the
             * terminal write ack after the next file is durable. */
            s_file_open=false;s_rollover_pending=true;
            if(s_active_file_sequence==UINT32_MAX){
                s_rollover_pending=false;s_new_session_required=true;s_file_sequence=0;
                portENTER_CRITICAL(&s_mux);s_state=s_intent?SB_RECORDER_ERROR:SB_RECORDER_STOPPING;portEXIT_CRITICAL(&s_mux);
                return;
            }
            s_new_session_required=false;s_file_sequence=s_active_file_sequence+1u;
            portENTER_CRITICAL(&s_mux);s_block_sequence=0;s_state=s_intent?SB_RECORDER_STARTING:SB_RECORDER_STOPPING;portEXIT_CRITICAL(&s_mux);
            return;
        }
        pool_transition(ack->buffer_id, POOL_WRITING, POOL_FREE);
        if (ack->status == SB_OK) {
            sb_diag_add(SB_DIAG_RECORDER, 1, s_pool_sample_count[ack->buffer_id]);
            s_pool_sample_count[ack->buffer_id] = 0;
            portENTER_CRITICAL(&s_mux); s_last_commit_us = sb_monotonic_us(); portEXIT_CRITICAL(&s_mux);
        } else if (ack->reason == SB_STORAGE_REASON_NO_SPACE) {
            sb_diag_add(SB_DIAG_RECORDER, 2, s_pool_sample_count[ack->buffer_id]);
            s_pool_sample_count[ack->buffer_id] = 0;
            s_file_open = false;
            s_new_session_required = true;
            s_open_retry_at = xTaskGetTickCount() + pdMS_TO_TICKS(SB_RECORDER_OPEN_RETRY_MS);
            portENTER_CRITICAL(&s_mux); s_state = s_intent ? SB_RECORDER_ERROR : SB_RECORDER_STOPPED; portEXIT_CRITICAL(&s_mux);
            sb_diag_increment(SB_DIAG_RECORDER, 7);
        } else if (ack->reason == SB_STORAGE_REASON_SIZE_LIMIT || ack->reason == SB_STORAGE_REASON_METADATA_FULL) {
            sb_diag_add(SB_DIAG_RECORDER, 2, s_pool_sample_count[ack->buffer_id]);
            s_pool_sample_count[ack->buffer_id] = 0;
            s_file_open = false;
            if (s_active_file_sequence == UINT32_MAX) {
                s_new_session_required = true;
                s_file_sequence = 0;
            } else {
                s_new_session_required = false;
                s_file_sequence = s_active_file_sequence + 1u;
            }
            portENTER_CRITICAL(&s_mux); s_block_sequence = 0; portEXIT_CRITICAL(&s_mux);
            if (s_intent) {
                portENTER_CRITICAL(&s_mux); s_state = SB_RECORDER_STARTING; portEXIT_CRITICAL(&s_mux);
            }
            sb_diag_increment(SB_DIAG_RECORDER, 7);
        } else {
            sb_diag_add(SB_DIAG_RECORDER, 2, s_pool_sample_count[ack->buffer_id]);
            s_pool_sample_count[ack->buffer_id] = 0;
            enter_storage_error();
        }
        return;
    }
    if (ack->op == SB_STORAGE_OP_CLOSE) {
        if (!s_close_pending) fatal_invariant();
        s_close_pending = false;
        s_file_open = false;
        if (ack->status != SB_OK) {
            if (s_intent) { s_new_session_required = true; portENTER_CRITICAL(&s_mux); s_state = SB_RECORDER_ERROR; portEXIT_CRITICAL(&s_mux); }
            else { portENTER_CRITICAL(&s_mux); s_state = SB_RECORDER_STOPPED; portEXIT_CRITICAL(&s_mux); }
        } else if (!s_intent) {
            s_new_session_required = true;
            portENTER_CRITICAL(&s_mux); s_state = SB_RECORDER_STOPPED; portEXIT_CRITICAL(&s_mux);
        }
        return;
    }
    fatal_invariant();
}

static void handle_command(recorder_command_t command)
{
    if (command == CMD_START) {
        sb_recorder_state_t old_state;
        portENTER_CRITICAL(&s_mux);
        old_state = s_state;
        s_intent = true;
        if (s_state == SB_RECORDER_STOPPED || s_state == SB_RECORDER_ERROR) s_state = SB_RECORDER_STARTING;
        portEXIT_CRITICAL(&s_mux);
        if (old_state == SB_RECORDER_STOPPED || old_state == SB_RECORDER_ERROR) s_new_session_required = true;
    } else if (command == CMD_STOP) {
        portENTER_CRITICAL(&s_mux); s_intent = false; if (s_state != SB_RECORDER_STOPPED) s_state = SB_RECORDER_STOPPING; portEXIT_CRITICAL(&s_mux);
    } else if (command == CMD_DISCONTINUITY) {
        if (s_sample_count != 0) (void)finalize_block();
        s_next_time_discontinuity = true;
    } else {
        fatal_invariant();
    }
}

static void append_fix(const sb_gnss_fix_t *fix)
{
    portENTER_CRITICAL(&s_mux); s_last_sample_us = fix->mono_us; portEXIT_CRITICAL(&s_mux);
    if (s_have_input_sample_seq) {
        uint32_t gap = fix->sample_seq - s_last_input_sample_seq - 1u;
        if (gap != 0) {
            sb_diag_add(SB_DIAG_RECORDER, 5, gap);
            if (s_intent) sb_diag_add(SB_DIAG_RECORDER, 2, gap);
        }
    }
    s_last_input_sample_seq = fix->sample_seq;
    s_have_input_sample_seq = true;
    if (!s_intent || s_state != SB_RECORDER_RECORDING || !s_file_open) {
        if (s_intent) sb_diag_increment(SB_DIAG_RECORDER, 2);
        return;
    }
    if (fix->utc_valid && !s_start_utc_valid) {
        portENTER_CRITICAL(&s_mux); s_start_utc_us = fix->utc_us; s_start_utc_valid = true; portEXIT_CRITICAL(&s_mux);
    }
    uint8_t availability = fix_availability(fix);
    bool time_changed = sample_utc_mapping_changed(fix);
    bool discontinuity = s_next_time_discontinuity || (s_block_open && time_changed && fix->utc_valid == s_block_utc_valid);
    uint16_t slot = s_block_open ? slot_for_fix(fix) : 0;
    bool close_for_boundary = s_block_open &&
        (availability != s_field_mask || fix->utc_valid != s_block_utc_valid || time_changed ||
         slot >= max_slots_per_block());
    if (s_block_open && !close_for_boundary && slot <= s_samples[s_sample_count - 1u].slot) {
        sb_diag_increment(SB_DIAG_RECORDER, 2);
        sb_diag_increment(SB_DIAG_RECORDER, 6);
        return;
    }
    if (!s_block_open && s_last_block_end_mono_us != 0 && fix->mono_us < s_last_block_end_mono_us) {
        sb_diag_increment(SB_DIAG_RECORDER, 2);
        sb_diag_increment(SB_DIAG_RECORDER, 6);
        return;
    }
    if (close_for_boundary) {
        if (time_changed || s_next_time_discontinuity) discontinuity = true;
        (void)finalize_block_until(fix->mono_us);
        s_next_time_discontinuity = discontinuity;
        s_block_open = false;
        slot = 0;
        if (s_last_block_end_mono_us != 0u && fix->mono_us < s_last_block_end_mono_us) {
            sb_diag_increment(SB_DIAG_RECORDER, 2);
            sb_diag_increment(SB_DIAG_RECORDER, 6);
            return;
        }
    }
    if (!s_block_open) {
        s_field_mask = availability;
        s_block_utc_valid = fix->utc_valid;
        s_utc_source = fix->utc_valid ? 1u : 0u;
        s_block_time_discontinuity = s_next_time_discontinuity;
        s_next_time_discontinuity = false;
        s_block_open = true;
    }
    if (s_sample_count >= SB_RECORDER_SAFE_SLOTS) {
        (void)finalize_block();
        s_field_mask = availability;
        s_block_utc_valid = fix->utc_valid;
        s_utc_source = fix->utc_valid ? 1u : 0u;
        s_block_time_discontinuity = false;
        s_block_open = true;
        slot = 0;
    }
    if (slot >= max_slots_per_block()) {
        /* A delayed observation starts a fresh block without fabricating intermediate samples. */
        (void)finalize_block();
        s_field_mask = availability;
        s_block_utc_valid = fix->utc_valid;
        s_utc_source = fix->utc_valid ? 1u : 0u;
        s_block_time_discontinuity = false;
        s_block_open = true;
        slot = 0;
    }
    if (s_sample_count >= SB_RECORDER_SAFE_SLOTS) fatal_invariant();
    s_samples[s_sample_count++] = (recorder_sample_t){ .fix=*fix, .slot=slot };
    if (slot + 1u >= max_slots_per_block()) (void)finalize_block();
}

static unsigned writing_buffers(void)
{
    unsigned count = 0;
    for (unsigned i = 0; i < SB_RECORDER_BLOCK_POOL_COUNT; ++i) if (s_pool_state[i] == POOL_WRITING) ++count;
    return count;
}

static void recorder_task(void *arg)
{
    (void)arg;
    if (esp_task_wdt_add(NULL) != ESP_OK) abort();
    for (;;) {
        recorder_command_t command;
        while (xQueueReceive(s_cmd_q, &command, 0) == pdTRUE) handle_command(command);
        sb_storage_ack_t ack;
        while (sb_storage_try_ack(&ack)) handle_ack(&ack);

        uint32_t restart_generation = sb_gnss_get_restart_generation();
        if (restart_generation != s_seen_gnss_restart_generation) {
            s_seen_gnss_restart_generation = restart_generation;
            if (s_sample_count != 0) (void)finalize_block();
            s_next_time_discontinuity = true;
        }

        if (s_file_open && sb_storage_get_state() != SB_STORAGE_READY) enter_storage_error();
        if ((s_intent && (s_state == SB_RECORDER_STARTING || s_state == SB_RECORDER_ERROR)) ||
            s_rollover_pending) begin_create();

        sb_gnss_fix_t fix;
        while (sb_gnss_try_receive(&fix)) {
            sb_diag_increment(SB_DIAG_RECORDER, 0);
            append_fix(&fix);
        }

        if (!s_intent && s_state == SB_RECORDER_STOPPING) {
            if (s_sample_count != 0) (void)finalize_block();
            if (!s_create_pending && writing_buffers() == 0 && !s_close_pending) {
                if (s_file_open && sb_storage_get_state() == SB_STORAGE_READY) {
                    if (sb_storage_close_recording()) s_close_pending = true;
                } else {
                    s_file_open = false;
                    portENTER_CRITICAL(&s_mux); s_state = SB_RECORDER_STOPPED; portEXIT_CRITICAL(&s_mux);
                }
            }
        }
        if (s_intent && s_state == SB_RECORDER_ERROR && sb_storage_get_state() == SB_STORAGE_READY &&
            writing_buffers() == 0 && xTaskGetTickCount() >= s_open_retry_at) {
            portENTER_CRITICAL(&s_mux); s_state = SB_RECORDER_STARTING; portEXIT_CRITICAL(&s_mux);
        }
        (void)esp_task_wdt_reset();
        sb_validation_note_stack(SB_VALIDATION_TASK_RECORDER,
                                 (uint32_t)uxTaskGetStackHighWaterMark(NULL));
        vTaskDelay(pdMS_TO_TICKS(10));
    }
}

esp_err_t sb_recorder_start(void)
{
    if (s_cmd_q != NULL) return ESP_OK;
    if (rate_num() == 0 || rate_den() == 0 || reduced_rate_num() == 0 || reduced_rate_den() == 0) return ESP_ERR_INVALID_ARG;
    s_cmd_q = xQueueCreateStatic(RECORDER_COMMAND_DEPTH, sizeof(recorder_command_t), s_cmd_q_data, &s_cmd_q_struct);
    if (s_cmd_q == NULL) return ESP_ERR_NO_MEM;
    if (xTaskCreateStatic(recorder_task, "recorder_task", RECORDER_STACK_WORDS, NULL, 8, s_stack, &s_task_struct) == NULL) return ESP_ERR_NO_MEM;
    return ESP_OK;
}

sb_status_t sb_recorder_request_start(void)
{
    if (s_cmd_q == NULL) return SB_INVALID_STATE;
    if (sb_storage_get_state() == SB_STORAGE_FORMATTING) return SB_INVALID_STATE;
    sb_recorder_state_t state;
    portENTER_CRITICAL(&s_mux); state = s_state; portEXIT_CRITICAL(&s_mux);
    if (state == SB_RECORDER_RECORDING) return SB_OK;
    if (state == SB_RECORDER_STOPPING) return SB_BUSY;
    recorder_command_t command = CMD_START;
    return xQueueSend(s_cmd_q, &command, 0) == pdTRUE ? SB_ACCEPTED : SB_BUSY;
}

bool sb_recorder_can_format_storage(void)
{
    sb_recorder_state_t state;
    bool intent;
    portENTER_CRITICAL(&s_mux); state = s_state; intent = s_intent; portEXIT_CRITICAL(&s_mux);
    return state == SB_RECORDER_STOPPED && !intent && s_cmd_q != NULL && uxQueueMessagesWaiting(s_cmd_q) == 0;
}

sb_status_t sb_recorder_request_stop(void)
{
    if (s_cmd_q == NULL) return SB_INVALID_STATE;
    sb_recorder_state_t state;
    portENTER_CRITICAL(&s_mux); state = s_state; portEXIT_CRITICAL(&s_mux);
    if (state == SB_RECORDER_STOPPED) return SB_OK;
    recorder_command_t command = CMD_STOP;
    return xQueueSend(s_cmd_q, &command, 0) == pdTRUE ? SB_ACCEPTED : SB_BUSY;
}

void sb_recorder_get_snapshot(sb_recorder_state_t *state, bool *intent,
                              uint32_t *session, uint32_t *block_sequence,
                              uint64_t *start, uint64_t *last_sample,
                              uint64_t *last_commit)
{
    portENTER_CRITICAL(&s_mux);
    if (state) *state = s_state;
    if (intent) *intent = s_intent;
    if (session) *session = s_session_id;
    if (block_sequence) *block_sequence = s_block_sequence;
    if (start) *start = s_start_mono_us;
    if (last_sample) *last_sample = s_last_sample_us;
    if (last_commit) *last_commit = s_last_commit_us;
    portEXIT_CRITICAL(&s_mux);
}

void sb_recorder_get_utc_start(int64_t *utc_us, bool *valid)
{
    portENTER_CRITICAL(&s_mux);
    if (utc_us) *utc_us=(int64_t)s_start_utc_us;
    if (valid) *valid=s_start_utc_valid;
    portEXIT_CRITICAL(&s_mux);
}

bool sb_recorder_get_healthy(void)
{
    sb_recorder_state_t state; bool intent;
    sb_recorder_get_snapshot(&state, &intent, NULL, NULL, NULL, NULL, NULL);
    return intent ? state == SB_RECORDER_RECORDING : state == SB_RECORDER_STOPPED;
}

void sb_recorder_gnss_discontinuity(void)
{
    recorder_command_t command = CMD_DISCONTINUITY;
    if (s_cmd_q != NULL && xQueueSend(s_cmd_q, &command, 0) != pdTRUE) sb_diag_increment(SB_DIAG_RECORDER, 7);
}
