#include "sailball/common.h"
#include "esp_timer.h"

uint64_t sb_monotonic_us(void)
{
    int64_t value = esp_timer_get_time();
    return value < 0 ? 0 : (uint64_t)value;
}

uint32_t sb_fix_to_sp(sb_gnss_fix_type_t fix)
{
    switch (fix) {
    case SB_GNSS_FIX_NONE: return 0;
    case SB_GNSS_FIX_2D: return 1;
    case SB_GNSS_FIX_3D: return 2;
    case SB_GNSS_FIX_TIME_ONLY: return 0;
    default: return 255;
    }
}

uint8_t sb_fix_to_ldc(sb_gnss_fix_type_t fix)
{
    switch (fix) {
    case SB_GNSS_FIX_NONE: return 0;
    case SB_GNSS_FIX_DEAD_RECKONING: return 1;
    case SB_GNSS_FIX_2D: return 2;
    case SB_GNSS_FIX_3D: return 3;
    case SB_GNSS_FIX_GNSS_DR: return 4;
    case SB_GNSS_FIX_TIME_ONLY: return 5;
    default: return 255;
    }
}
