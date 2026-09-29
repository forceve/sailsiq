#include "sailball/time_grid.h"
#include <limits.h>

static uint16_t gcd_u16(uint16_t a, uint16_t b)
{
    while (b != 0u) { uint16_t r = (uint16_t)(a % b); a = b; b = r; }
    return a;
}

static bool normalize_rate(uint16_t *num, uint16_t *den)
{
    if (*num == 0u || *den == 0u) return false;
    uint16_t gcd = gcd_u16(*num, *den);
    *num = (uint16_t)(*num / gcd);
    *den = (uint16_t)(*den / gcd);
    return true;
}

bool sb_recorder_grid_slot(uint16_t num, uint16_t den, uint64_t start,
                           uint64_t sample, uint16_t *slot_out)
{
    if (slot_out == NULL || !normalize_rate(&num, &den)) return false;
    if (sample <= start) { *slot_out = 0u; return true; }
    uint64_t delta = sample - start;
    if (delta > UINT64_MAX / num) return false;
    uint64_t numerator = delta * num;
    uint64_t denominator = UINT64_C(1000000) * den;
    if (numerator > UINT64_MAX - denominator / 2u) return false;
    uint64_t rounded = (numerator + denominator / 2u) / denominator;
    if (rounded > UINT16_MAX) return false;
    *slot_out = (uint16_t)rounded;
    return true;
}

bool sb_recorder_grid_duration(uint16_t num, uint16_t den, uint16_t slots,
                               uint64_t start, uint64_t exclusive_end,
                               uint32_t *duration_out)
{
    if (duration_out == NULL || slots == 0u || !normalize_rate(&num, &den)) return false;
    const uint64_t scale = UINT64_C(1000000) * den;
    uint64_t top = (uint64_t)slots * scale;
    uint64_t duration = top / num; /* floor keeps ceil(duration * rate) == slots. */
    if (duration == 0u || duration > UINT32_MAX) return false;
    if (exclusive_end != 0u) {
        if (exclusive_end <= start) return false;
        uint64_t delta = exclusive_end - start;
        if (delta < duration) duration = delta;
    }
    uint64_t lowest_valid = ((uint64_t)(slots - 1u) * scale) / num + 1u;
    if (duration < lowest_valid || duration > UINT32_MAX) return false;
    /* The LDC header derives nominal_slots from this same integer duration. */
    uint64_t check = (duration * num + scale - 1u) / scale;
    if (check != slots) return false;
    *duration_out = (uint32_t)duration;
    return true;
}
