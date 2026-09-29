#include "sailball/ldc.h"

bool sb_ldc_uvar_encode(uint64_t value, uint8_t out[10], size_t *written)
{
    if (out == NULL || written == NULL) return false;
    size_t n = 0;
    do {
        uint8_t b = (uint8_t)(value & 0x7Fu);
        value >>= 7;
        if (value != 0) b |= 0x80u;
        out[n++] = b;
    } while (value != 0 && n < 10);
    *written = n;
    return value == 0;
}

bool sb_ldc_uvar_decode(const uint8_t *data, size_t length, uint64_t *value, size_t *consumed)
{
    if (data == NULL || value == NULL || consumed == NULL) return false;
    uint64_t result = 0;
    for (size_t i = 0; i < length && i < 10; ++i) {
        uint8_t b = data[i];
        if (i == 9 && (b & 0xFEu) != 0) return false;
        result |= (uint64_t)(b & 0x7Fu) << (i * 7);
        if ((b & 0x80u) == 0) {
            if (i > 0 && (b & 0x7Fu) == 0) return false;
            *value = result;
            *consumed = i + 1;
            return true;
        }
    }
    return false;
}

bool sb_ldc_svar_encode(int64_t value, uint8_t out[10], size_t *written)
{
    uint64_t zigzag = value >= 0 ? ((uint64_t)value << 1) : (((uint64_t)(-(value + 1)) << 1) | 1u);
    return sb_ldc_uvar_encode(zigzag, out, written);
}

bool sb_ldc_svar_decode(const uint8_t *data, size_t length, int64_t *value, size_t *consumed)
{
    uint64_t zigzag;
    if (value == NULL || !sb_ldc_uvar_decode(data, length, &zigzag, consumed)) return false;
    uint64_t magnitude = zigzag >> 1;
    if ((zigzag & 1u) == 0) {
        if (magnitude > INT64_MAX) return false;
        *value = (int64_t)magnitude;
    } else {
        if (magnitude > INT64_MAX) return false;
        *value = -1 - (int64_t)magnitude;
    }
    return true;
}
