#pragma once

#include <stdbool.h>
#include <stdint.h>

/* Shared recorder/LDC rational-grid arithmetic. Rate is samples per second. */
bool sb_recorder_grid_slot(uint16_t rate_num, uint16_t rate_den,
                           uint64_t block_start_us, uint64_t sample_us,
                           uint16_t *slot_out);

/*
 * Select the greatest legal integer-microsecond duration for required_slots,
 * optionally capped by an exclusive boundary relative to block_start_us.
 * exclusive_end_us == 0 means no early-close boundary.
 */
bool sb_recorder_grid_duration(uint16_t rate_num, uint16_t rate_den,
                               uint16_t required_slots, uint64_t block_start_us,
                               uint64_t exclusive_end_us, uint32_t *duration_us_out);
