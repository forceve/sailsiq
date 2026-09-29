#include "sailball/wireless_admission.h"
#include <string.h>

bool sb_wireless_admission_decide(const sb_wireless_heap_t *heap,
    const sb_wireless_budget_t *budget, sb_wireless_admission_t *out)
{
    if (out == NULL) return false;
    memset(out, 0, sizeof(*out));
    out->observed = 1;
    out->decision = SB_ADMISSION_INVALID_BUDGET;
    if (heap == NULL || budget == NULL) return false;
    out->before = *heap;
    out->budget = *budget;
    uint64_t ip = (uint64_t)budget->future_internal + budget->opaque_internal;
    uint64_t dp = (uint64_t)budget->future_dma + budget->opaque_dma;
    uint64_t it = ip + budget->critical_internal + budget->margin_internal;
    uint64_t dt = dp + budget->critical_dma + budget->margin_dma;
    uint64_t il = (uint64_t)budget->largest_internal_alloc + budget->fragment_internal;
    uint64_t dl = (uint64_t)budget->largest_dma_alloc + budget->fragment_dma;
    if (ip == 0 || budget->critical_internal == 0 ||
        budget->future_dma > budget->future_internal || budget->opaque_dma > budget->opaque_internal ||
        budget->critical_dma > budget->critical_internal || budget->margin_dma > budget->margin_internal ||
        ip < dp || it < dt || il < dl ||
        budget->largest_internal_alloc > ip || budget->largest_dma_alloc > dp ||
        il == 0 || (dp != 0 && dl == 0) || it > UINT32_MAX || dt > UINT32_MAX ||
        il > UINT32_MAX || dl > UINT32_MAX) return false;
    out->required_internal_free = (uint32_t)it;
    out->required_dma_free = (uint32_t)dt;
    out->required_internal_largest = (uint32_t)il;
    out->required_dma_largest = (uint32_t)dl;
    if (heap->free_internal < it) out->decision = SB_ADMISSION_INTERNAL_FREE;
    else if (heap->largest_internal < il) out->decision = SB_ADMISSION_INTERNAL_FRAGMENTED;
    else if (heap->free_dma < dt) out->decision = SB_ADMISSION_DMA_FREE;
    else if (heap->largest_dma < dl) out->decision = SB_ADMISSION_DMA_FRAGMENTED;
    else out->decision = SB_ADMISSION_ALLOW;
    return out->decision == SB_ADMISSION_ALLOW;
}
