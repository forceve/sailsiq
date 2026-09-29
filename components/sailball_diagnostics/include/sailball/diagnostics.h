#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef enum { SB_DIAG_GNSS=0, SB_DIAG_RECORDER, SB_DIAG_STORAGE, SB_DIAG_TRANSFER, SB_DIAG_TRANSPORT, SB_DIAG_PROTOCOL, SB_DIAG_GROUP_COUNT } sb_diag_group_t;
#define SB_DIAG_COUNTERS_PER_GROUP 20
#define SB_ERROR_RING_CAPACITY 32

typedef struct {
    uint32_t error_id;
    uint64_t first_mono_us, last_mono_us;
    uint16_t service_id, error_code;
    uint8_t severity;
    uint32_t occurrence_count;
    int64_t utc_us;
    bool utc_valid;
} sb_error_record_t;

typedef struct { uint64_t value[SB_DIAG_GROUP_COUNT][SB_DIAG_COUNTERS_PER_GROUP]; } sb_diag_snapshot_t;

void sb_diag_increment(sb_diag_group_t group, unsigned counter);
void sb_diag_add(sb_diag_group_t group, unsigned counter, uint64_t amount);
void sb_diag_max(sb_diag_group_t group, unsigned counter, uint64_t value);
void sb_diag_snapshot(sb_diag_snapshot_t *out);
uint32_t sb_diag_raise(uint16_t service_id, uint16_t error_code, uint8_t severity, bool utc_valid, int64_t utc_us);
void sb_diag_clear_errors(void);
size_t sb_diag_get_errors(uint32_t after_id, bool has_after, size_t limit, sb_error_record_t *out,
                          uint32_t *oldest_id, uint32_t *newest_id);
