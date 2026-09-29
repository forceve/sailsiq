#pragma once
#include "nmea_parser.h"
#include "sailball/gnss.h"

typedef enum {
    SB_GNSS_BACKEND_CONFIGURING = 0,
    SB_GNSS_BACKEND_VERIFYING,
    SB_GNSS_BACKEND_READY,
    SB_GNSS_BACKEND_FAILED
} sb_gnss_backend_state_t;

typedef struct {
    bool (*write)(const uint8_t *data, size_t length, void *context);
    bool (*set_baud)(uint32_t baud, void *context);
    void (*reset_rx)(void *context);
    void *context;
} sb_gnss_backend_io_t;

typedef struct {
    uint32_t (*initial_baud)(void);
    void (*start)(const sb_gnss_runtime_config_t *config, const sb_gnss_backend_io_t *io,
                  uint64_t now_us);
    sb_gnss_backend_state_t (*step)(uint64_t now_us);
    void (*restart)(const sb_gnss_runtime_config_t *config,
                    const sb_gnss_backend_io_t *io, uint64_t now_us);
    void (*reset_parser)(void);
    void (*consume_bytes)(const uint8_t *,size_t,uint64_t,sb_gnss_emit_fix_fn,void *);
    void (*tick)(uint64_t,sb_gnss_emit_fix_fn,void *);
    uint32_t (*valid_sentence_count)(void);
    uint32_t capabilities;
} sb_gnss_backend_t;

const sb_gnss_backend_t *sb_gnss_atgm336h_backend(void);
