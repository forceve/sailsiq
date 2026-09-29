#pragma once

#include <stdbool.h>
#include <stdint.h>

typedef enum {
    SB_VALIDATION_TASK_GNSS = 0,
    SB_VALIDATION_TASK_RECORDER,
    SB_VALIDATION_TASK_STORAGE,
    SB_VALIDATION_TASK_SUPERVISOR,
    SB_VALIDATION_TASK_CONTROL,
    SB_VALIDATION_TASK_TRANSPORT,
    SB_VALIDATION_TASK_TRANSFER,
    SB_VALIDATION_TASK_UI,
    SB_VALIDATION_TASK_COUNT
} sb_validation_task_t;

typedef struct {
    uint32_t stack_low_water_bytes[SB_VALIDATION_TASK_COUNT];
    uint32_t free_heap_bytes;
    uint32_t minimum_free_heap_bytes;
    uint32_t largest_free_block_bytes;
    uint32_t stack_observed_mask;
    bool heap_observed;
} sb_validation_metrics_t;

/* Internal validation metrics; these values are not part of the Sailball Protocol. */
void sb_validation_note_stack(sb_validation_task_t task, uint32_t free_bytes);
void sb_validation_update_heap(uint32_t free_bytes, uint32_t minimum_free_bytes,
                               uint32_t largest_free_block_bytes);
void sb_validation_get_metrics(sb_validation_metrics_t *out);
