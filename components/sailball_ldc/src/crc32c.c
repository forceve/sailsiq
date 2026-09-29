#include "sailball/ldc.h"

uint32_t sb_crc32c(const void *data, size_t length)
{
    const uint8_t *p = data;
    uint32_t crc = UINT32_C(0xFFFFFFFF);
    for (size_t i = 0; i < length; ++i) {
        crc ^= p[i];
        for (unsigned bit = 0; bit < 8; ++bit)
            crc = (crc >> 1) ^ ((crc & 1u) ? UINT32_C(0x82F63B78) : 0u);
    }
    return crc ^ UINT32_C(0xFFFFFFFF);
}
