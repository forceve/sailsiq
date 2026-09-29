#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef enum {
    SB_OK = 0,
    SB_ACCEPTED,
    SB_INVALID_REQUEST,
    SB_UNSUPPORTED,
    SB_PERMISSION_DENIED,
    SB_BUSY,
    SB_NOT_FOUND,
    SB_INVALID_STATE,
    SB_IO_ERROR,
    SB_TIMEOUT,
    SB_OUT_OF_RANGE,
    SB_INTERNAL_ERROR
} sb_status_t;

typedef enum {
    SB_SOURCE_USB = 0,
    SB_SOURCE_BLE = 1,
    SB_SOURCE_WIFI = 2,
    SB_SOURCE_CELLULAR = 3,
    SB_SOURCE_COUNT = 4
} sb_source_t;

typedef enum {
    SB_GNSS_FIX_NONE = 0,
    SB_GNSS_FIX_DEAD_RECKONING,
    SB_GNSS_FIX_2D,
    SB_GNSS_FIX_3D,
    SB_GNSS_FIX_GNSS_DR,
    SB_GNSS_FIX_TIME_ONLY,
    SB_GNSS_FIX_UNKNOWN
} sb_gnss_fix_type_t;

typedef struct {
    uint32_t sample_seq;
    uint64_t mono_us;
    int64_t utc_us;
    bool utc_valid;
    int32_t latitude_e7;
    int32_t longitude_e7;
    bool position_valid;
    int32_t altitude_cm;
    bool altitude_valid;
    uint32_t ground_speed_centi_kn;
    bool ground_speed_valid;
    uint16_t course_centi_deg;
    bool course_valid;
    uint16_t satellites_used;
    bool satellites_valid;
    sb_gnss_fix_type_t fix_type;
} sb_gnss_fix_t;

typedef enum {
    SB_GNSS_OFF = 0, SB_GNSS_STARTING, SB_GNSS_RUNNING,
    SB_GNSS_RESTARTING, SB_GNSS_ERROR
} sb_gnss_state_t;
typedef enum {
    SB_RECORDER_STOPPED = 0, SB_RECORDER_STARTING, SB_RECORDER_RECORDING,
    SB_RECORDER_STOPPING, SB_RECORDER_ERROR
} sb_recorder_state_t;
typedef enum {
    SB_STORAGE_UNAVAILABLE = 0, SB_STORAGE_MOUNTING, SB_STORAGE_READY,
    SB_STORAGE_ERROR, SB_STORAGE_FORMATTING
} sb_storage_state_t;
typedef enum {
    SB_BLE_OFF = 0, SB_BLE_IDLE, SB_BLE_ADVERTISING, SB_BLE_CONNECTED,
    SB_BLE_DISCONNECTING, SB_BLE_ERROR
} sb_ble_state_t;
typedef enum {
    SB_WIFI_OFF = 0, SB_WIFI_SCANNING, SB_WIFI_AP_CONNECTING, SB_WIFI_IP_READY,
    SB_WIFI_TCP_CONNECTING, SB_WIFI_SP_HANDSHAKE, SB_WIFI_ONLINE,
    SB_WIFI_RECOVERING, SB_WIFI_ERROR
} sb_wifi_state_t;

static inline uint16_t sb_read_le16(const uint8_t *p)
{
    return (uint16_t)p[0] | ((uint16_t)p[1] << 8);
}
static inline uint32_t sb_read_le32(const uint8_t *p)
{
    return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}
static inline uint64_t sb_read_le64(const uint8_t *p)
{
    return (uint64_t)sb_read_le32(p) | ((uint64_t)sb_read_le32(p + 4) << 32);
}
static inline void sb_write_le16(uint8_t *p, uint16_t v)
{
    p[0] = (uint8_t)v; p[1] = (uint8_t)(v >> 8);
}
static inline void sb_write_le32(uint8_t *p, uint32_t v)
{
    p[0] = (uint8_t)v; p[1] = (uint8_t)(v >> 8); p[2] = (uint8_t)(v >> 16); p[3] = (uint8_t)(v >> 24);
}
static inline void sb_write_le64(uint8_t *p, uint64_t v)
{
    sb_write_le32(p, (uint32_t)v); sb_write_le32(p + 4, (uint32_t)(v >> 32));
}
static inline uint64_t sb_sat_add_u64(uint64_t a, uint64_t b)
{
    return UINT64_MAX - a < b ? UINT64_MAX : a + b;
}

uint64_t sb_monotonic_us(void);
uint32_t sb_fix_to_sp(sb_gnss_fix_type_t fix);
uint8_t sb_fix_to_ldc(sb_gnss_fix_type_t fix);
