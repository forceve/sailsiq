#pragma once
#include "sailball/common.h"
#include <stddef.h>
#include <stdint.h>

#define SB_GNSS_NMEA_SENTENCE_MAX 96u
typedef bool (*sb_gnss_emit_fix_fn)(void *context,const sb_gnss_fix_t *fix);
typedef struct {
    char sentence[SB_GNSS_NMEA_SENTENCE_MAX];
    size_t used;
    bool collecting, dropping;
    bool epoch_active, epoch_has_valid_data, epoch_gsa_valid, gsa_valid, gsa_satellites_valid;
    bool vtg_course_valid, vtg_speed_valid;
    uint64_t epoch_tod_us, last_epoch_update_us, gsa_update_us, vtg_update_us;
    sb_gnss_fix_t epoch;
    sb_gnss_fix_type_t gsa_fix_type;
    uint16_t gsa_satellites;
    uint16_t vtg_course_centi_deg;
    uint32_t vtg_speed_centi_kn;
    uint32_t valid_sentences, invalid_sentences, overlength_sentences;
} sb_gnss_nmea_parser_t;

void sb_gnss_nmea_reset(sb_gnss_nmea_parser_t *parser);
void sb_gnss_nmea_feed(sb_gnss_nmea_parser_t *parser,const uint8_t *bytes,size_t length,
                       uint64_t now_us,sb_gnss_emit_fix_fn emit,void *context);
void sb_gnss_nmea_tick(sb_gnss_nmea_parser_t *parser,uint64_t now_us,
                       sb_gnss_emit_fix_fn emit,void *context);
