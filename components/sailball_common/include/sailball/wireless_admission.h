#pragma once
#include <stdbool.h>
#include <stdint.h>

/* Internal resource policy. No SP service, counter, error or disk ABI. */
typedef enum { SB_WIRELESS_BLE, SB_WIRELESS_WIFI, SB_WIRELESS_WIFI_START,
               SB_WIRELESS_COUNT } sb_wireless_kind_t;
typedef enum {
    SB_ADMISSION_ALLOW, SB_ADMISSION_INVALID_BUDGET,
    SB_ADMISSION_INTERNAL_FREE, SB_ADMISSION_INTERNAL_FRAGMENTED,
    SB_ADMISSION_DMA_FREE, SB_ADMISSION_DMA_FRAGMENTED
} sb_admission_result_t;
typedef struct {
    uint32_t free_internal, minimum_internal, largest_internal;
    uint32_t free_dma, minimum_dma, largest_dma;
} sb_wireless_heap_t;
typedef struct {
    /* DMA is a subset of internal; do not add the two totals. Opaque
     * allowances are estimates, not certified SDK allocation upper bounds. */
    uint32_t future_internal, future_dma;
    uint32_t opaque_internal, opaque_dma;
    uint32_t critical_internal, critical_dma;
    uint32_t margin_internal, margin_dma;
    uint32_t largest_internal_alloc, largest_dma_alloc;
    uint32_t fragment_internal, fragment_dma;
} sb_wireless_budget_t;
typedef struct {
    sb_wireless_heap_t before, after;
    sb_wireless_budget_t budget;
    uint32_t required_internal_free, required_dma_free;
    uint32_t required_internal_largest, required_dma_largest;
    sb_admission_result_t decision;
    uint8_t observed, after_observed;
} sb_wireless_admission_t;

bool sb_wireless_admission_decide(const sb_wireless_heap_t *heap,
    const sb_wireless_budget_t *budget, sb_wireless_admission_t *out);
sb_wireless_heap_t sb_wireless_measure_heap(void);
sb_wireless_admission_t sb_wireless_admit(sb_wireless_kind_t kind);
