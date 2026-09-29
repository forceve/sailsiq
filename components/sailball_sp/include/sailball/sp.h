#pragma once
#include "sailball/common.h"
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define SB_SP_HEADER_SIZE 24u
#define SB_SP_CRC_SIZE 4u
#define SB_SP_BOOTSTRAP_MIN_RX_PAYLOAD 256u
#define SB_SP_MAX_RX_PAYLOAD 2048u
#define SB_SP_MAX_FRAME (SB_SP_HEADER_SIZE + SB_SP_MAX_RX_PAYLOAD + SB_SP_CRC_SIZE)
#define SB_SP_COBS_MAX_ENCODED (SB_SP_MAX_FRAME + (SB_SP_MAX_FRAME / 254u) + 1u)

typedef enum { SB_SP_REQUEST=1, SB_SP_RESPONSE=2, SB_SP_EVENT=3, SB_SP_STREAM=4, SB_SP_BULK=5 } sb_sp_type_t;
typedef struct {
    uint8_t major, minor, type, flags, channel, reserved;
    uint16_t service_id, message_id;
    uint32_t request_id, sequence, payload_length;
    const uint8_t *payload;
    uint32_t storage_epoch; /* Internal BULK provenance; never encoded on wire. */
} sb_sp_frame_t;

bool sb_sp_frame_encode(const sb_sp_frame_t *frame, uint8_t *out, size_t capacity, size_t *written);
bool sb_sp_frame_decode(const uint8_t *data, size_t length, uint32_t max_payload, sb_sp_frame_t *frame);
bool sb_cobs_encode(const uint8_t *input, size_t input_length, uint8_t *output, size_t capacity, size_t *written);
bool sb_cobs_decode(const uint8_t *input, size_t input_length, uint8_t *output, size_t capacity, size_t *written);
/* Streams header, payload, and CRC into COBS output. Payload/output must not overlap. */
bool sb_sp_cobs_encode_delimited(const sb_sp_frame_t *frame, uint8_t *output,
                                 size_t capacity, size_t *wire_length);
typedef bool (*sb_sp_cobs_frame_fn)(void *context, const sb_sp_frame_t *frame);
typedef struct { uint8_t encoded[SB_SP_COBS_MAX_ENCODED]; size_t used; bool discard_until_delimiter; } sb_sp_cobs_stream_t;
void sb_sp_cobs_stream_reset(sb_sp_cobs_stream_t *stream);
/* Bounded COBS(Frame)+0 parser; callback payload is valid only during callback. */
bool sb_sp_cobs_stream_feed(sb_sp_cobs_stream_t *stream, const uint8_t *bytes, size_t length,
                            uint32_t max_payload, sb_sp_cobs_frame_fn on_frame, void *context,
                            uint32_t *frame_errors);

typedef enum { SB_CBOR_UINT, SB_CBOR_NINT, SB_CBOR_BOOL, SB_CBOR_BYTES, SB_CBOR_TEXT, SB_CBOR_ARRAY, SB_CBOR_MAP, SB_CBOR_OTHER } sb_cbor_kind_t;
typedef struct { sb_cbor_kind_t kind; uint64_t u; int64_t i; bool boolean; const uint8_t *bytes; size_t length; const uint8_t *encoded; size_t encoded_length; } sb_cbor_value_t;
typedef struct { const uint8_t *data; size_t length; uint8_t count; uint8_t key[32]; sb_cbor_value_t value[32]; } sb_cbor_map_t;
bool sb_cbor_parse_map(const uint8_t *data, size_t length, sb_cbor_map_t *map);
const sb_cbor_value_t *sb_cbor_get(const sb_cbor_map_t *map, uint8_t key);
bool sb_cbor_array_get(const sb_cbor_value_t *array, size_t index, sb_cbor_value_t *value);
bool sb_cbor_put_uint(uint8_t *out, size_t capacity, size_t *length, uint64_t value);
bool sb_cbor_put_int(uint8_t *out, size_t capacity, size_t *length, int64_t value);
bool sb_cbor_put_bool(uint8_t *out, size_t capacity, size_t *length, bool value);
bool sb_cbor_put_array(uint8_t *out, size_t capacity, size_t *length, size_t count);
bool sb_cbor_put_bytes(uint8_t *out, size_t capacity, size_t *length, const void *bytes, size_t count);
bool sb_cbor_put_text(uint8_t *out, size_t capacity, size_t *length, const char *text, size_t count);
bool sb_cbor_put_map(uint8_t *out, size_t capacity, size_t *length, size_t pairs);
bool sb_sp_command_allowed(uint16_t service, uint16_t command, sb_source_t source);
