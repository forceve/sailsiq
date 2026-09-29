#include "sailball/common.h"
#include "sailball/ldc.h"
#include "sailball/sp.h"
#include "sailball/progress.h"
#include "sailball/time_grid.h"
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define CHECK(expr) do { if (!(expr)) { \
    fprintf(stderr, "FAIL %s:%d: %s\n", __FILE__, __LINE__, #expr); return false; \
} } while (0)

static bool test_crc_and_varints(void)
{
    static const char check[] = "123456789";
    CHECK(sb_crc32c(check, 9) == UINT32_C(0xE3069283));
    CHECK(sb_crc32c(NULL, 0) == 0);
    const uint64_t values[] = {0, 1, 127, 128, 255, 16384, UINT32_MAX, UINT64_MAX};
    for (size_t i = 0; i < sizeof(values) / sizeof(values[0]); ++i) {
        uint8_t encoded[10]; size_t length = 0, consumed = 0; uint64_t decoded = 0;
        CHECK(sb_ldc_uvar_encode(values[i], encoded, &length));
        CHECK(length >= 1 && length <= 10);
        CHECK(sb_ldc_uvar_decode(encoded, length, &decoded, &consumed));
        CHECK(decoded == values[i] && consumed == length);
    }
    static const uint8_t overlong[] = {0x80, 0x00};
    static const uint8_t overflow[] = {0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0x02};
    uint64_t u = 0; size_t used = 0;
    CHECK(!sb_ldc_uvar_decode(overlong, sizeof(overlong), &u, &used));
    CHECK(!sb_ldc_uvar_decode(overflow, sizeof(overflow), &u, &used));
    const int64_t signed_values[] = {INT64_MIN, -1000000, -1, 0, 1, 1000000, INT64_MAX};
    for (size_t i = 0; i < sizeof(signed_values) / sizeof(signed_values[0]); ++i) {
        uint8_t encoded[10]; size_t length = 0, consumed = 0; int64_t decoded = 0;
        CHECK(sb_ldc_svar_encode(signed_values[i], encoded, &length));
        CHECK(sb_ldc_svar_decode(encoded, length, &decoded, &consumed));
        CHECK(decoded == signed_values[i] && consumed == length);
    }
    return true;
}

static bool test_delta_codec(void)
{
    const int64_t signed_input[] = {-10, -8, 0, 15, INT64_MAX};
    uint8_t encoded[128]; size_t length = 0; int64_t signed_output[5] = {0};
    CHECK(sb_ldc_delta_encode(signed_input, NULL, 5, true, false, 0, encoded, sizeof(encoded), &length));
    CHECK(sb_ldc_delta_decode(encoded, length, 5, true, false, 0, signed_output, NULL));
    CHECK(memcmp(signed_input, signed_output, sizeof(signed_input)) == 0);
    const uint64_t unsigned_input[] = {UINT64_MAX - 2, UINT64_MAX - 1, UINT64_MAX};
    uint64_t unsigned_output[3] = {0};
    CHECK(sb_ldc_delta_encode(NULL, unsigned_input, 3, false, false, 0, encoded, sizeof(encoded), &length));
    CHECK(sb_ldc_delta_decode(encoded, length, 3, false, false, 0, NULL, unsigned_output));
    CHECK(memcmp(unsigned_input, unsigned_output, sizeof(unsigned_input)) == 0);
    const uint64_t circular_input[] = {358, 359, 0, 1, 359};
    uint64_t circular_output[5] = {0};
    CHECK(sb_ldc_delta_encode(NULL, circular_input, 5, false, true, 360, encoded, sizeof(encoded), &length));
    CHECK(sb_ldc_delta_decode(encoded, length, 5, false, true, 360, NULL, circular_output));
    CHECK(memcmp(circular_input, circular_output, sizeof(circular_input)) == 0);
    CHECK(!sb_ldc_delta_encode(NULL, circular_input, 5, false, true, 0, encoded, sizeof(encoded), &length));
    return true;
}

static bool test_ldc_blocks(void)
{
    sb_ldc_block_header_t input = {
        .block_sequence=7, .block_length=112, .start_mono_us=123456,
        .sample_rate_num=1, .sample_rate_den=1, .nominal_slots=1, .valid_slots=1,
        .payload_offset=SB_LDC_BLOCK_HEADER_SIZE, .time_accuracy_us=UINT32_MAX,
        .duration_us=1000000
    };
    uint8_t header[SB_LDC_BLOCK_HEADER_SIZE]; sb_ldc_block_header_t decoded;
    CHECK(sb_ldc_header_encode(&input, header));
    CHECK(sb_ldc_header_decode(header, &decoded));
    CHECK(decoded.block_sequence == input.block_sequence && decoded.block_length == input.block_length);
    uint8_t block[112] = {0}; memcpy(block, header, sizeof(header));
    uint8_t *footer = block + 96;
    sb_write_le32(footer, sb_crc32c(block, 96));
    sb_write_le32(footer + 4, (uint32_t)sizeof(block));
    sb_write_le32(footer + 8, input.block_sequence);
    memcpy(footer + 12, "LDCM", 4);
    CHECK(sb_ldc_block_validate(block, sizeof(block), input.block_sequence));
    CHECK(!sb_ldc_block_validate(block, sizeof(block), input.block_sequence + 1));
    block[20] ^= 1;
    CHECK(!sb_ldc_block_validate(block, sizeof(block), input.block_sequence));
    return true;
}

static bool test_ldc_fully_specified_golden_block(void)
{
    static const uint8_t expected[132] = {
        0x4c,0x44,0x42,0x4b,0x01,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x84,0x00,0x00,0x00,
        0x40,0x42,0x0f,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x0a,0x00,0x01,0x00,0x03,0x00,0x03,0x00,0x01,0x00,0x10,0x00,0x60,0x00,0x00,0x00,
        0x70,0x00,0x00,0x00,0x04,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0xff,0xff,0xff,0xff,0xd6,0xdd,0xd3,0x2e,0xe0,0x93,0x04,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x01,0x00,0x01,0x00,0x01,0x00,0x03,0x00,0x70,0x00,0x00,0x00,0x04,0x00,0x00,0x00,
        0xc8,0x01,0x06,0x01,0x0d,0xef,0xb9,0x02,0x84,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x4c,0x44,0x43,0x4d
    };
    uint8_t block[sizeof(expected)] = {0};
    sb_ldc_block_header_t header = {
        .block_sequence=0, .block_length=132, .start_mono_us=1000000,
        .sample_rate_num=10, .sample_rate_den=1, .nominal_slots=3, .valid_slots=3,
        .stream_count=1, .directory_length=SB_LDC_DESCRIPTOR_SIZE,
        .payload_offset=112, .payload_length=4, .time_accuracy_us=UINT32_MAX,
        .duration_us=300000
    };
    CHECK(sb_ldc_header_encode(&header, block));
    sb_ldc_descriptor_t descriptor = {.local_field_id=1, .definition_version=1,
        .codec=1, .value_count=3, .payload_offset=112, .payload_length=4};
    CHECK(sb_ldc_descriptor_encode(&descriptor, block + SB_LDC_BLOCK_HEADER_SIZE));
    static const uint8_t stream[] = {0xc8,0x01,0x06,0x01};
    memcpy(block + 112, stream, sizeof(stream));
    uint8_t *footer = block + sizeof(block) - SB_LDC_FOOTER_SIZE;
    sb_write_le32(footer, sb_crc32c(block, sizeof(block) - SB_LDC_FOOTER_SIZE));
    sb_write_le32(footer + 4, sizeof(block));
    sb_write_le32(footer + 8, 0);
    memcpy(footer + 12, "LDCM", 4);
    for (size_t i=0;i<sizeof(expected);++i) {
        if (block[i]!=expected[i]) {
            fprintf(stderr,"golden mismatch at %zu: got %02x expected %02x\n",i,block[i],expected[i]);
            return false;
        }
    }
    CHECK(sb_read_le32(block + 68) == UINT32_C(0x2ED3DDD6));
    CHECK(sb_read_le32(footer) == UINT32_C(0x02B9EF0D));
    CHECK(sb_ldc_block_validate(block, sizeof(block), 0));
    return true;
}

static bool test_presence_bitmap(void)
{
    static const uint8_t example[] = {0x05,0x02};
    static const uint8_t wrong_count[] = {0x05,0x00};
    static const uint8_t nonzero_unused_bits[] = {0x05,0x82};
    CHECK(sb_ldc_presence_validate(example, sizeof(example), 10, 3));
    CHECK(!sb_ldc_presence_validate(wrong_count, sizeof(wrong_count), 10, 3));
    CHECK(!sb_ldc_presence_validate(nonzero_unused_bits, sizeof(nonzero_unused_bits), 10, 3));
    CHECK(!sb_ldc_presence_validate(example, 1, 10, 3));
    return true;
}

static bool test_progress_watchdog_causes(void)
{
    sb_progress_input_t input={
        .now_us=UINT64_C(60000000),.gnss_last_rx_us=UINT64_C(59000000),
        .recorder_start_mono_us=UINT64_C(1000000),
        .recorder_last_sample_us=UINT64_C(59000000),.recorder_last_commit_us=UINT64_C(50000000),
        .sample_timeout_ms=5000,.commit_grace_ms=30000,.recording_intent=true,
        .gnss_state=SB_GNSS_RUNNING,.recorder_state=SB_RECORDER_RECORDING,
        .storage_state=SB_STORAGE_READY
    };
    CHECK(sb_progress_evaluate(&input)==SB_PROGRESS_HEALTHY); /* No fix is required when messages progress. */
    input.recording_intent=false;input.recorder_state=SB_RECORDER_STOPPED;input.storage_state=SB_STORAGE_UNAVAILABLE;
    CHECK(sb_progress_evaluate(&input)==SB_PROGRESS_IDLE);
    input.storage_state=SB_STORAGE_ERROR;
    CHECK(sb_progress_evaluate(&input)==SB_PROGRESS_STORAGE_NOT_READY);
    input.recording_intent=true;input.storage_state=SB_STORAGE_READY;input.gnss_state=SB_GNSS_RUNNING;
    input.recorder_state=SB_RECORDER_RECORDING;input.recorder_last_sample_us=UINT64_C(59000000);
    input.recorder_start_mono_us=UINT64_C(55000000);input.recorder_last_commit_us=0;
    CHECK(sb_progress_evaluate(&input)==SB_PROGRESS_AWAITING_FIRST_COMMIT);
    input.now_us=UINT64_C(86000001);input.gnss_last_rx_us=input.now_us;input.recorder_last_sample_us=input.now_us;
    CHECK(sb_progress_evaluate(&input)==SB_PROGRESS_STORAGE_COMMIT_STALLED);
    input.now_us=UINT64_C(60000000);input.gnss_last_rx_us=input.now_us;input.recorder_last_sample_us=UINT64_C(59000000);input.recorder_last_commit_us=UINT64_C(59000000);
    CHECK(sb_progress_evaluate(&input)==SB_PROGRESS_HEALTHY); /* valid NO_FIX message progress is enough GNSS activity */
    input.recorder_start_mono_us=UINT64_C(59500000); /* a prior-session commit cannot restore post-recovery health */
    CHECK(sb_progress_evaluate(&input)==SB_PROGRESS_AWAITING_FIRST_COMMIT);
    input.recorder_start_mono_us=UINT64_C(1000000);input.recorder_last_commit_us=UINT64_C(50000000);
    input.gnss_last_rx_us=UINT64_C(54000000);
    CHECK(sb_progress_evaluate(&input)==SB_PROGRESS_GNSS_NO_RX);
    input.gnss_state=SB_GNSS_ERROR;input.gnss_last_rx_us=UINT64_C(59000000);
    CHECK(sb_progress_evaluate(&input)==SB_PROGRESS_GNSS_ERROR);
    input.gnss_state=SB_GNSS_RUNNING;input.recorder_state=SB_RECORDER_STARTING;
    CHECK(sb_progress_evaluate(&input)==SB_PROGRESS_RECORDER_NOT_READY);
    input.recorder_state=SB_RECORDER_RECORDING;input.recorder_last_sample_us=UINT64_C(54000000);
    CHECK(sb_progress_evaluate(&input)==SB_PROGRESS_RECORDER_NOT_CONSUMING);
    input.recorder_last_sample_us=UINT64_C(59000000);input.recorder_last_commit_us=UINT64_C(10000000);
    CHECK(sb_progress_evaluate(&input)==SB_PROGRESS_STORAGE_COMMIT_STALLED);
    input.sample_timeout_ms=300000;input.recorder_last_commit_us=UINT64_C(50000000);
    CHECK(sb_progress_evaluate(&input)==SB_PROGRESS_HEALTHY); /* Slow configured input widens the commit window. */
    return true;
}

typedef struct {
    uint8_t live[256], durable[256];
    unsigned writes, flushes, fail_write, fail_flush;
} block_storage_t;

static bool block_storage_write(void *context, uint64_t offset, const void *data, size_t length)
{
    block_storage_t *storage=context;
    if (offset>sizeof(storage->live)||length>sizeof(storage->live)-(size_t)offset) return false;
    ++storage->writes;
    if (storage->writes==storage->fail_write) {
        memcpy(storage->live+(size_t)offset,data,length/2u);
        return false;
    }
    memcpy(storage->live+(size_t)offset,data,length); return true;
}

static bool block_storage_flush(void *context)
{
    block_storage_t *storage=context;
    ++storage->flushes;
    if (storage->flushes==storage->fail_flush) return false;
    memcpy(storage->durable,storage->live,sizeof(storage->durable)); return true;
}

static bool build_test_block(uint8_t block[112], uint32_t sequence)
{
    sb_ldc_block_header_t header={.block_sequence=sequence,.block_length=112,.start_mono_us=77,
        .sample_rate_num=1,.sample_rate_den=1,.nominal_slots=1,.valid_slots=1,
        .payload_offset=SB_LDC_BLOCK_HEADER_SIZE,.time_accuracy_us=UINT32_MAX,.duration_us=1000000};
    memset(block,0,112);
    if(!sb_ldc_header_encode(&header,block))return false;
    uint8_t *footer=block+96;
    sb_write_le32(footer,sb_crc32c(block,96)); sb_write_le32(footer+4,112);
    sb_write_le32(footer+8,sequence); memcpy(footer+12,"LDCM",4);
    return sb_ldc_block_validate(block,112,sequence);
}

static bool test_two_stage_block_commit(void)
{
    uint8_t block[112]; CHECK(build_test_block(block,11));
    for(unsigned fail_write=0;fail_write<=2;++fail_write){
        for(unsigned fail_flush=0;fail_flush<=2;++fail_flush){
            if(fail_write==0&&fail_flush==0)continue;
            block_storage_t storage={0};storage.fail_write=fail_write;storage.fail_flush=fail_flush;
            sb_ldc_commit_io_t io={.context=&storage,.write=block_storage_write,.flush=block_storage_flush};
            bool ok=sb_ldc_block_commit(&io,32,block,sizeof(block),11);
            if(fail_write==0&&fail_flush==0)CHECK(ok);
            else CHECK(!ok);
            memcpy(storage.live,storage.durable,sizeof(storage.live));
            CHECK(!sb_ldc_block_validate(storage.live+32,sizeof(block),11));
        }
    }
    block_storage_t storage={0};
    sb_ldc_commit_io_t io={.context=&storage,.write=block_storage_write,.flush=block_storage_flush};
    CHECK(sb_ldc_block_commit(&io,32,block,sizeof(block),11));
    CHECK(sb_ldc_block_validate(storage.durable+32,sizeof(block),11));
    CHECK(!sb_ldc_block_commit(&io,32,block,sizeof(block),12));
    return true;
}

static bool test_cobs_and_sp(void)
{
    uint8_t input[520], encoded[540], decoded[520];
    for (size_t i = 0; i < sizeof(input); ++i) input[i] = (uint8_t)((i % 7u) == 0 ? 0 : i);
    size_t encoded_length = 0, decoded_length = 0;
    CHECK(sb_cobs_encode(input, sizeof(input), encoded, sizeof(encoded), &encoded_length));
    CHECK(sb_cobs_decode(encoded, encoded_length, decoded, sizeof(decoded), &decoded_length));
    CHECK(decoded_length == sizeof(input) && memcmp(input, decoded, sizeof(input)) == 0);
    uint8_t empty_code = 1;
    CHECK(sb_cobs_encode(NULL, 0, &empty_code, 1, &encoded_length) && encoded_length == 1 && empty_code == 1);
    CHECK(sb_cobs_decode(&empty_code, 1, decoded, sizeof(decoded), &decoded_length) && decoded_length == 0);

    const uint8_t payload[] = {0xA1, 0x00, 0x01}; uint8_t frame_bytes[64]; size_t frame_length = 0;
    sb_sp_frame_t frame = {.major=1, .minor=0, .type=SB_SP_REQUEST, .service_id=4,
        .message_id=1, .request_id=9, .sequence=3, .payload_length=sizeof(payload), .payload=payload};
    CHECK(sb_sp_frame_encode(&frame, frame_bytes, sizeof(frame_bytes), &frame_length));
    sb_sp_frame_t result;
    CHECK(sb_sp_frame_decode(frame_bytes, frame_length, SB_SP_MAX_RX_PAYLOAD, &result));
    CHECK(result.service_id == frame.service_id && result.message_id == frame.message_id &&
          result.request_id == frame.request_id && result.sequence == frame.sequence &&
          result.payload_length == sizeof(payload) && memcmp(result.payload, payload, sizeof(payload)) == 0);
    for (size_t n=0;n<frame_length;++n) CHECK(!sb_sp_frame_decode(frame_bytes,n,SB_SP_MAX_RX_PAYLOAD,&result));
    frame_bytes[frame_length - 1] ^= 0x80;
    CHECK(!sb_sp_frame_decode(frame_bytes, frame_length, SB_SP_MAX_RX_PAYLOAD, &result));
    CHECK(sb_sp_command_allowed(1, 5, SB_SOURCE_USB));
    CHECK(!sb_sp_command_allowed(1, 5, SB_SOURCE_WIFI));
    CHECK(sb_sp_command_allowed(4, 1, SB_SOURCE_BLE));
    CHECK(!sb_sp_command_allowed(4, 3, SB_SOURCE_BLE));
    CHECK(!sb_sp_command_allowed(4, 4, SB_SOURCE_WIFI));
    CHECK(sb_sp_command_allowed(3, 1, SB_SOURCE_USB));
    CHECK(!sb_sp_command_allowed(3, 1, SB_SOURCE_BLE));
    return true;
}

static bool test_full_permission_matrix(void)
{
    static const uint8_t command_counts[10]={0,5,3,2,4,3,6,2,3,1};
    static const uint8_t allowed[10][7]={
        {0},
        {0,15,15,15,15,1},
        {0,15,15,1},
        {0,1,1},
        {0,15,15,1,1},
        {0,15,15,15},
        {0,11,15,11,11,11,11},
        {0,13,13},
        {0,15,15,1},
        {0,15}
    };
    for(uint16_t service=1;service<=9;++service){
        for(uint16_t command=1;command<=command_counts[service];++command){
            for(unsigned source=0;source<SB_SOURCE_COUNT;++source){
                bool expected=(allowed[service][command]&(1u<<source))!=0;
                CHECK(sb_sp_command_allowed(service,command,(sb_source_t)source)==expected);
            }
        }
    }
    CHECK(!sb_sp_command_allowed(10,1,SB_SOURCE_USB));
    CHECK(!sb_sp_command_allowed(1,6,SB_SOURCE_USB));
    CHECK(!sb_sp_command_allowed(3,1,SB_SOURCE_COUNT));
    return true;
}

static bool test_cbor(void)
{
    static const uint8_t valid[] = {0xA4,0x00,0x01,0x01,0xF5,0x02,0x42,0x01,0x02,0x03,0x82,0x20,0x61,0x78};
    sb_cbor_map_t map;
    CHECK(sb_cbor_parse_map(valid, sizeof(valid), &map));
    CHECK(sb_cbor_get(&map, 0)->u == 1 && sb_cbor_get(&map, 1)->boolean);
    CHECK(sb_cbor_get(&map, 2)->kind == SB_CBOR_BYTES && sb_cbor_get(&map, 2)->length == 2);
    sb_cbor_value_t array_item;
    CHECK(sb_cbor_array_get(sb_cbor_get(&map, 3), 0, &array_item));
    CHECK(array_item.kind == SB_CBOR_NINT && array_item.i == -1);
    CHECK(sb_cbor_array_get(sb_cbor_get(&map, 3), 1, &array_item));
    CHECK(array_item.kind == SB_CBOR_TEXT && array_item.length == 1 && array_item.bytes[0] == 'x');
    static const uint8_t duplicate[] = {0xA2,0x00,0x01,0x00,0x02};
    static const uint8_t noncanonical[] = {0xA1,0x00,0x18,0x01};
    static const uint8_t bad_utf8[] = {0xA1,0x00,0x61,0xFF};
    static const uint8_t valid_utf8[] = {0xA1,0x00,0x63,0xE2,0x82,0xAC};
    static const uint8_t nested_text_key[] = {0xA1,0x00,0xA1,0x61,0x78,0x01};
    static const uint8_t nested_duplicate[] = {0xA1,0x00,0xA2,0x00,0x01,0x00,0x02};
    static const uint8_t nested_large_key[] = {0xA1,0x00,0xA1,0x19,0x01,0x00,0x01};
    static const uint8_t utf8_truncated[] = {0xA1,0x00,0x62,0xC2};
    static const uint8_t utf8_overlong[] = {0xA1,0x00,0x63,0xE0,0x80,0x80};
    static const uint8_t utf8_surrogate[] = {0xA1,0x00,0x63,0xED,0xA0,0x80};
    static const uint8_t utf8_too_large[] = {0xA1,0x00,0x64,0xF4,0x90,0x80,0x80};
    static const uint8_t utf8_bad_continuation[] = {0xA1,0x00,0x63,0xE2,0x28,0xA1};
    static const uint8_t depth_ok[] = {0xA1,0x00,0x81,0x81,0x81,0x81,0x81,0x00};
    static const uint8_t depth_bad[] = {0xA1,0x00,0x81,0x81,0x81,0x81,0x81,0x81,0x00};
    CHECK(!sb_cbor_parse_map(duplicate, sizeof(duplicate), &map));
    CHECK(!sb_cbor_parse_map(noncanonical, sizeof(noncanonical), &map));
    CHECK(!sb_cbor_parse_map(bad_utf8, sizeof(bad_utf8), &map));
    CHECK(sb_cbor_parse_map(valid_utf8,sizeof(valid_utf8),&map));
    CHECK(sb_cbor_get(&map,0)->kind==SB_CBOR_TEXT&&sb_cbor_get(&map,0)->length==3);
    CHECK(!sb_cbor_parse_map(nested_text_key,sizeof(nested_text_key),&map));
    CHECK(!sb_cbor_parse_map(nested_duplicate,sizeof(nested_duplicate),&map));
    CHECK(!sb_cbor_parse_map(nested_large_key,sizeof(nested_large_key),&map));
    CHECK(!sb_cbor_parse_map(utf8_truncated,sizeof(utf8_truncated),&map));
    CHECK(!sb_cbor_parse_map(utf8_overlong,sizeof(utf8_overlong),&map));
    CHECK(!sb_cbor_parse_map(utf8_surrogate,sizeof(utf8_surrogate),&map));
    CHECK(!sb_cbor_parse_map(utf8_too_large,sizeof(utf8_too_large),&map));
    CHECK(!sb_cbor_parse_map(utf8_bad_continuation,sizeof(utf8_bad_continuation),&map));
    CHECK(sb_cbor_parse_map(depth_ok,sizeof(depth_ok),&map));
    CHECK(!sb_cbor_parse_map(depth_bad,sizeof(depth_bad),&map));
    for(size_t n=0;n<sizeof(valid);++n)CHECK(!sb_cbor_parse_map(valid,n,&map));
    for(size_t n=0;n<sizeof(utf8_overlong);++n)CHECK(!sb_cbor_parse_map(utf8_overlong,n,&map));
    uint8_t output[32]; size_t length = 0;
    CHECK(sb_cbor_put_map(output, sizeof(output), &length, 1));
    CHECK(sb_cbor_put_uint(output, sizeof(output), &length, 0));
    CHECK(sb_cbor_put_uint(output, sizeof(output), &length, UINT64_MAX));
    CHECK(sb_cbor_parse_map(output, length, &map));
    CHECK(sb_cbor_get(&map, 0)->u == UINT64_MAX);
    return true;
}

typedef struct {
    uint8_t live[SB_LDC_METADATA_SIZE];
    uint8_t durable[SB_LDC_METADATA_SIZE];
    unsigned writes, flushes;
    unsigned fail_write, fail_flush;
} memory_storage_t;

static bool memory_read(void *context, uint32_t offset, void *data, size_t length)
{
    memory_storage_t *storage = context;
    if ((uint64_t)offset + length > sizeof(storage->live)) return false;
    memcpy(data, storage->live + offset, length);
    return true;
}

typedef struct { memory_storage_t *storage; unsigned calls; } counting_memory_t;

static bool counting_memory_read(void *context,uint32_t offset,void *data,size_t length)
{
    counting_memory_t *counting=context;
    ++counting->calls;
    return memory_read(counting->storage,offset,data,length);
}

static bool memory_write(void *context, uint32_t offset, const void *data, size_t length)
{
    memory_storage_t *storage = context;
    if ((uint64_t)offset + length > sizeof(storage->live)) return false;
    ++storage->writes;
    if (storage->fail_write == storage->writes) {
        size_t partial = length / 2u;
        memcpy(storage->live + offset, data, partial);
        return false;
    }
    memcpy(storage->live + offset, data, length);
    return true;
}

static bool memory_flush(void *context)
{
    memory_storage_t *storage = context;
    ++storage->flushes;
    if (storage->fail_flush == storage->flushes) return false;
    memcpy(storage->durable, storage->live, sizeof(storage->durable));
    return true;
}

static bool initialize_memory(memory_storage_t *storage, sb_ldc_metadata_state_t *state)
{
    memset(storage, 0, sizeof(*storage));
    uint8_t session_id[16] = {1,2,3,4};
    static sb_ldc_metadata_workspace_t workspace;
    sb_ldc_io_t io = {.workspace=&workspace,.context=storage, .read=memory_read, .write=memory_write, .flush=memory_flush};
    return sb_ldc_metadata_initialize(&io, state, session_id, UINT64_C(0x0102030405060708), 1234);
}

static bool test_metadata_cow(void)
{
    memory_storage_t storage; sb_ldc_metadata_state_t state, loaded;
    CHECK(initialize_memory(&storage, &state));
    static sb_ldc_metadata_workspace_t workspace;
    sb_ldc_io_t io = {.workspace=&workspace,.context=&storage, .read=memory_read, .write=memory_write, .flush=memory_flush};
    CHECK(sb_ldc_metadata_load(&io, &loaded) && loaded.generation == 1);
    uint8_t tables[SB_LDC_LOGICAL_PAGE_COUNT][SB_LDC_PAGE_SIZE] = {{0}};
    tables[20][0] = 0x5A;
    sb_ldc_metadata_state_t desired = loaded, published;
    desired.auxiliary_bytes_used = 1;
    CHECK(sb_ldc_metadata_publish(&io, &loaded, &desired, tables, UINT32_C(1) << 20, &published));
    CHECK(published.generation == 2 && published.active_superblock == 1);
    CHECK(sb_ldc_metadata_load(&io, &loaded) && loaded.generation == 2 && loaded.page_map[20] != 20);

    for (unsigned fail_write = 1; fail_write <= 3; ++fail_write) {
        CHECK(initialize_memory(&storage, &state));
        io.context = &storage;
        CHECK(sb_ldc_metadata_load(&io, &loaded));
        desired = loaded; desired.auxiliary_bytes_used = 1;
        storage.writes = storage.flushes = 0; storage.fail_write = fail_write;
        CHECK(!sb_ldc_metadata_publish(&io, &loaded, &desired, tables, UINT32_C(1) << 20, &published));
        memcpy(storage.live, storage.durable, sizeof(storage.live));
        CHECK(sb_ldc_metadata_load(&io, &loaded) && loaded.generation == 1);
    }
    for (unsigned fail_flush = 1; fail_flush <= 3; ++fail_flush) {
        CHECK(initialize_memory(&storage, &state));
        io.context = &storage;
        CHECK(sb_ldc_metadata_load(&io, &loaded));
        desired = loaded; desired.auxiliary_bytes_used = 1;
        storage.writes = storage.flushes = 0; storage.fail_flush = fail_flush;
        CHECK(!sb_ldc_metadata_publish(&io, &loaded, &desired, tables, UINT32_C(1) << 20, &published));
        memcpy(storage.live, storage.durable, sizeof(storage.live));
        CHECK(sb_ldc_metadata_load(&io, &loaded) && loaded.generation == 1);
    }
    /* Production Storage aliases validation scratch with publication tables.
     * Validate that no table is consumed after scratch reuse starts. */
    static union {
        uint8_t tables[SB_LDC_LOGICAL_PAGE_COUNT][SB_LDC_PAGE_SIZE];
        sb_ldc_metadata_workspace_t validation;
    } shared_workspace;
    CHECK(initialize_memory(&storage, &state));
    io.workspace=&shared_workspace.validation;
    CHECK(sb_ldc_metadata_load(&io, &loaded));
    memset(shared_workspace.tables,0,sizeof(shared_workspace.tables));
    shared_workspace.tables[20][0]=0x5A;
    desired=loaded;desired.auxiliary_bytes_used=1;
    CHECK(sb_ldc_metadata_publish(&io,&loaded,&desired,shared_workspace.tables,
                                  UINT32_C(1)<<20,&published));
    CHECK(sb_ldc_metadata_load(&io,&loaded)&&loaded.generation==2);
    CHECK(storage.live[0x400u+loaded.page_map[20]*512u]==0x5A);
    return true;
}

static bool test_metadata_incremental_load(void)
{
    static memory_storage_t storage;
    static sb_ldc_metadata_workspace_t workspace;
    sb_ldc_metadata_state_t initial,loaded={0};
    CHECK(initialize_memory(&storage,&initial));
    counting_memory_t counting={.storage=&storage,.calls=0u};
    sb_ldc_io_t io={.workspace=&workspace,.context=&counting,.read=counting_memory_read,
        .write=NULL,.flush=NULL};
    sb_ldc_metadata_load_ctx_t context;
    sb_ldc_metadata_load_begin(&context);
    bool complete=false,valid=false;unsigned slices=0u;
    while(!complete){
        unsigned before=counting.calls;
        CHECK(sb_ldc_metadata_load_step(&io,&context,4u,&loaded,&complete,&valid));
        CHECK(counting.calls-before<=4u);
        ++slices;
        CHECK(slices<512u);
    }
    CHECK(valid&&loaded.generation==1u&&loaded.field_count==0u&&loaded.definition_count==0u);
    CHECK(slices>100u&&counting.calls>500u);
    return true;
}

static void write_profile_record(uint8_t *record,uint16_t field,uint16_t semantic,
                                 uint8_t mode,uint8_t type,uint16_t unit,int8_t scale,
                                 uint8_t codec,uint16_t flags,uint16_t enum_table,
                                 uint16_t aux_length,uint32_t aux_offset)
{
    memset(record,0,32);sb_write_le16(record,field);sb_write_le16(record+2,1);sb_write_le16(record+4,semantic);
    record[6]=mode;record[7]=type;sb_write_le16(record+8,unit);record[10]=(uint8_t)scale;record[11]=codec;
    sb_write_le16(record+12,flags);sb_write_le16(record+14,enum_table);sb_write_le16(record+22,aux_length);
    sb_write_le32(record+24,aux_offset);sb_write_le32(record+28,sb_crc32c(record,28));
}

static bool build_gnss_profile(const sb_ldc_io_t *io,sb_ldc_metadata_state_t *loaded,
                               sb_ldc_metadata_state_t *published,bool invalid_fix_codec)
{
    if(!sb_ldc_metadata_load(io,loaded))return false;
    uint8_t tables[SB_LDC_LOGICAL_PAGE_COUNT][SB_LDC_PAGE_SIZE]={{0}};
    static const uint16_t units[7]={1,1,2,5,1,6,0};
    static const int8_t scales[7]={-7,-7,-2,-2,-2,0,0};
    static const uint8_t modes[7]={0,0,0,0,0,1,1};
    static const uint8_t types[7]={1,1,1,0,0,0,3};
    for(unsigned i=0;i<7;++i){
        uint8_t *catalog=tables[0]+i*32u;sb_write_le16(catalog,(uint16_t)(i+1u));sb_write_le16(catalog+2,(uint16_t)(i+1u));
        sb_write_le32(catalog+28,sb_crc32c(catalog,28));
        uint16_t flags=i==4u?1u:0u,enum_table=i==6u?1u:0u;
        uint16_t aux_length=i==4u?12u:0u;uint32_t aux_offset=i==4u?0x2C00u:0u;
        uint8_t codec=(i<5u)?1u:2u;if(invalid_fix_codec&&i==6u)codec=3u;
        write_profile_record(tables[4]+i*32u,(uint16_t)(i+1u),(uint16_t)(i+1u),modes[i],types[i],units[i],
                             scales[i],codec,flags,enum_table,aux_length,aux_offset);
    }
    sb_write_le16(tables[20],1);sb_write_le16(tables[20]+2,8);sb_write_le64(tables[20]+4,36000);
    sb_ldc_metadata_state_t desired=*loaded;desired.field_count=7;desired.definition_count=7;desired.auxiliary_bytes_used=12;
    uint32_t changed=(UINT32_C(1)<<0)|(UINT32_C(1)<<4)|(UINT32_C(1)<<20);
    return sb_ldc_metadata_publish(io,loaded,&desired,tables,changed,published);
}

static bool test_real_gnss_metadata_profile(void)
{
    static memory_storage_t storage;static sb_ldc_metadata_workspace_t workspace;
    sb_ldc_metadata_state_t initial,published,loaded;
    memset(&storage,0,sizeof(storage));sb_ldc_io_t io={.workspace=&workspace,.context=&storage,
        .read=memory_read,.write=memory_write,.flush=memory_flush};
    uint8_t sid[16]={1};CHECK(sb_ldc_metadata_initialize(&io,&initial,sid,UINT64_C(0x1234),100));
    CHECK(build_gnss_profile(&io,&loaded,&published,false));
    CHECK(published.field_count==7&&published.definition_count==7&&published.auxiliary_bytes_used==12);
    CHECK(sb_ldc_metadata_load(&io,&loaded)&&loaded.generation==2&&loaded.field_count==7);
    /* CHANGE / ENUM / CHANGE_VARINT is the profile row that was rejected. */
    uint32_t fix_record=0x400u+(uint32_t)loaded.page_map[4]*SB_LDC_PAGE_SIZE+6u*32u;
    CHECK(sb_read_le16(storage.live+fix_record)==7u);
    CHECK(storage.live[fix_record+6u]==1u&&storage.live[fix_record+7u]==3u);
    CHECK(storage.live[fix_record+11u]==2u);

    memset(&storage,0,sizeof(storage));CHECK(sb_ldc_metadata_initialize(&io,&initial,sid,UINT64_C(0x1234),100));
    CHECK(!build_gnss_profile(&io,&loaded,&published,true));
    CHECK(sb_ldc_metadata_load(&io,&loaded)&&loaded.generation==1&&loaded.field_count==0);
    return true;
}

typedef struct { unsigned frames; uint32_t last_request; uint8_t payload[32]; size_t payload_length; } stream_capture_t;
static bool capture_stream_frame(void *context,const sb_sp_frame_t *frame)
{
    stream_capture_t *capture=context;
    if(frame->payload_length>sizeof(capture->payload))return false;
    capture->last_request=frame->request_id;capture->payload_length=frame->payload_length;
    if(frame->payload_length)memcpy(capture->payload,frame->payload,frame->payload_length);
    ++capture->frames;return true;
}

static bool test_tcp_cobs_stream(void)
{
    sb_sp_cobs_stream_t stream;sb_sp_cobs_stream_reset(&stream);
    uint8_t payload[]={0,1,0,2,3,0};uint8_t raw[SB_SP_MAX_FRAME],encoded[SB_SP_MAX_FRAME+16];size_t raw_n=0,enc_n=0;
    sb_sp_frame_t frame={.major=1,.minor=0,.type=SB_SP_REQUEST,.service_id=1,.message_id=2,.request_id=9,.sequence=1,.payload=payload,.payload_length=sizeof(payload)};
    CHECK(sb_sp_frame_encode(&frame,raw,sizeof(raw),&raw_n));
    CHECK(sb_cobs_encode(raw,raw_n,encoded,sizeof(encoded)-1u,&enc_n));encoded[enc_n++]=0;
    uint8_t adapter_wire[SB_SP_COBS_MAX_ENCODED+1u];size_t adapter_n=0;
    CHECK(sb_sp_cobs_encode_delimited(&frame,adapter_wire,sizeof(adapter_wire),&adapter_n));
    CHECK(adapter_n==enc_n&&memcmp(adapter_wire,encoded,enc_n)==0);
    stream_capture_t capture={0};uint32_t errors=0;
    CHECK(sb_sp_cobs_stream_feed(&stream,encoded,3,SB_SP_MAX_RX_PAYLOAD,capture_stream_frame,&capture,&errors));
    CHECK(sb_sp_cobs_stream_feed(&stream,encoded+3,enc_n-3,SB_SP_MAX_RX_PAYLOAD,capture_stream_frame,&capture,&errors));
    CHECK(capture.frames==1&&capture.last_request==9&&capture.payload_length==sizeof(payload));
    CHECK(memcmp(capture.payload,payload,sizeof(payload))==0&&errors==0);
    uint8_t joined[SB_SP_MAX_FRAME+16];memcpy(joined,encoded,enc_n);memcpy(joined+enc_n,encoded,enc_n);
    CHECK(sb_sp_cobs_stream_feed(&stream,joined,enc_n*2u,SB_SP_MAX_RX_PAYLOAD,capture_stream_frame,&capture,&errors));
    CHECK(capture.frames==3&&errors==0);
    sb_sp_cobs_stream_reset(&stream);
    for(size_t i=0;i<enc_n;++i)CHECK(sb_sp_cobs_stream_feed(&stream,encoded+i,1,SB_SP_MAX_RX_PAYLOAD,capture_stream_frame,&capture,&errors));
    CHECK(capture.frames==4&&errors==0);
    uint8_t corrupt_raw[SB_SP_MAX_FRAME],bad_wire[SB_SP_MAX_FRAME+16];size_t bad_wire_n=0;
    memcpy(corrupt_raw,raw,raw_n);corrupt_raw[raw_n-1u]^=0x80u;
    CHECK(sb_cobs_encode(corrupt_raw,raw_n,bad_wire,sizeof(bad_wire)-1u,&bad_wire_n));bad_wire[bad_wire_n++]=0;
    CHECK(sb_sp_cobs_stream_feed(&stream,bad_wire,bad_wire_n,SB_SP_MAX_RX_PAYLOAD,capture_stream_frame,&capture,&errors));
    CHECK(errors==1u&&capture.frames==4u);
    uint8_t malformed[]={1,0};CHECK(sb_sp_cobs_stream_feed(&stream,malformed,sizeof(malformed),SB_SP_MAX_RX_PAYLOAD,capture_stream_frame,&capture,&errors));
    CHECK(errors==2&&capture.frames==4);
    uint8_t oversized[SB_SP_COBS_MAX_ENCODED+2u];memset(oversized,0x55,sizeof(oversized));oversized[sizeof(oversized)-1u]=0;
    CHECK(sb_sp_cobs_stream_feed(&stream,oversized,sizeof(oversized),SB_SP_MAX_RX_PAYLOAD,capture_stream_frame,&capture,&errors));
    CHECK(errors>=2u&&stream.used==0u&&!stream.discard_until_delimiter);
    /* FIN while a COBS frame is incomplete is a per-socket discard, not a cross-connection prefix. */
    sb_sp_cobs_stream_reset(&stream);
    CHECK(sb_sp_cobs_stream_feed(&stream,encoded,enc_n/2u,SB_SP_MAX_RX_PAYLOAD,capture_stream_frame,&capture,&errors));
    CHECK(stream.used!=0u);sb_sp_cobs_stream_reset(&stream);
    CHECK(sb_sp_cobs_stream_feed(&stream,encoded+enc_n/2u,enc_n-enc_n/2u,SB_SP_MAX_RX_PAYLOAD,capture_stream_frame,&capture,&errors));
    CHECK(capture.frames==4u);
    return true;
}

static bool test_cobs_long_frames(void)
{
    static const size_t lengths[]={253u,254u,255u,508u,1024u,SB_SP_MAX_RX_PAYLOAD};
    uint8_t payload[SB_SP_MAX_RX_PAYLOAD];
    uint8_t raw[SB_SP_MAX_FRAME],expected[SB_SP_MAX_FRAME];
    uint8_t wire[SB_SP_COBS_MAX_ENCODED+1u];
    uint8_t reference[SB_SP_COBS_MAX_ENCODED+1u];
    for(size_t case_no=0;case_no<sizeof(lengths)/sizeof(lengths[0]);++case_no){
        for(unsigned pattern=0;pattern<2u;++pattern){
            size_t length=lengths[case_no];
            for(size_t i=0;i<length;++i)payload[i]=(pattern&&i%101u==0u)?0u:0x5au;
            sb_sp_frame_t frame={.major=1,.minor=0,.type=SB_SP_BULK,.service_id=4u,
                .message_id=5u,.request_id=77u,.sequence=9u,.payload_length=(uint32_t)length,.payload=payload};
            size_t expected_n=0u,wire_n=0u,raw_n=0u;
            CHECK(sb_sp_frame_encode(&frame,expected,sizeof(expected),&expected_n));
            CHECK(sb_sp_cobs_encode_delimited(&frame,wire,sizeof(wire),&wire_n));
            size_t reference_n=0u;
            CHECK(sb_cobs_encode(expected,expected_n,reference,sizeof(reference)-1u,&reference_n));
            reference[reference_n++]=0u;
            CHECK(wire_n==reference_n&&memcmp(wire,reference,wire_n)==0);
            CHECK(wire_n>0u&&wire[wire_n-1u]==0u);
            CHECK(sb_cobs_decode(wire,wire_n-1u,raw,sizeof(raw),&raw_n));
            CHECK(raw_n==expected_n&&memcmp(raw,expected,raw_n)==0);
            sb_sp_frame_t decoded;CHECK(sb_sp_frame_decode(raw,raw_n,SB_SP_MAX_RX_PAYLOAD,&decoded));
            CHECK(decoded.payload_length==length&&memcmp(decoded.payload,payload,length)==0);
        }
    }
    return true;
}

static bool test_recorder_rational_grid(void)
{
    static const uint16_t rates[][2]={{1,1},{3,1},{4,1},{10,1},{10,3}};
    for(size_t r=0;r<sizeof(rates)/sizeof(rates[0]);++r){
        uint16_t num=rates[r][0],den=rates[r][1];uint64_t start=UINT64_C(1000000);
        uint64_t period=(uint64_t)den*UINT64_C(1000000)/num;
        for(uint16_t slot=0;slot<10u;++slot){
            uint64_t offset=(uint64_t)slot*den*UINT64_C(1000000)/num;
            uint16_t mapped=UINT16_MAX;CHECK(sb_recorder_grid_slot(num,den,start,start+offset,&mapped));CHECK(mapped==slot);
            /* Small arrival jitter must not move a sample to an adjacent slot. */
            uint64_t jitter=period/10u;CHECK(sb_recorder_grid_slot(num,den,start,start+offset+jitter,&mapped));CHECK(mapped==slot);
        }
        uint16_t full_slots=(uint16_t)(((uint64_t)num*15u+(uint64_t)den-1u)/den);
        uint32_t full_duration=0;CHECK(sb_recorder_grid_duration(num,den,full_slots,start,0,&full_duration));
        CHECK(full_duration<=15000000u&&full_duration+1u>=15000000u);
        CHECK(((uint64_t)full_duration*num+(uint64_t)den*1000000u-1u)/((uint64_t)den*1000000u)==full_slots);
    }
    /* Early STOP / availability cut at 3 Hz: two nominal slots remain valid. */
    uint32_t early=0;CHECK(sb_recorder_grid_duration(3,1,2,1000000,1500000,&early));CHECK(early==500000u);
    uint32_t invalid=0;CHECK(!sb_recorder_grid_duration(3,1,2,1000000,1200000,&invalid));
    sb_ldc_block_header_t old={.block_sequence=4,.block_length=SB_LDC_BLOCK_HEADER_SIZE+SB_LDC_FOOTER_SIZE,
        .start_mono_us=1000000,.sample_rate_num=3,.sample_rate_den=1,.nominal_slots=2,.valid_slots=2,
        .payload_offset=SB_LDC_BLOCK_HEADER_SIZE,.time_accuracy_us=UINT32_MAX,.duration_us=early};
    uint8_t bytes[SB_LDC_BLOCK_HEADER_SIZE];CHECK(sb_ldc_header_encode(&old,bytes));
    sb_ldc_block_header_t parsed;CHECK(sb_ldc_header_decode(bytes,&parsed));
    uint64_t old_end=parsed.start_mono_us+parsed.duration_us;
    sb_ldc_block_header_t next={.block_sequence=old.block_sequence+1u,.block_length=SB_LDC_BLOCK_HEADER_SIZE+SB_LDC_FOOTER_SIZE,
        .start_mono_us=old_end,.sample_rate_num=3,.sample_rate_den=1,.nominal_slots=1,.valid_slots=1,
        .payload_offset=SB_LDC_BLOCK_HEADER_SIZE,.time_accuracy_us=UINT32_MAX,.duration_us=333333u};
    CHECK(sb_ldc_header_encode(&next,bytes));CHECK(sb_ldc_header_decode(bytes,&parsed));
    CHECK(parsed.block_sequence==old.block_sequence+1u&&parsed.start_mono_us>=old_end);
    /* Missing slot 2 is represented as a hole, while the next block starts at
     * the previous exclusive end and cannot overlap even with 10/3 Hz. */
    uint16_t mapped=0;CHECK(sb_recorder_grid_slot(10,3,2000000,2900000,&mapped)&&mapped==3u);
    uint32_t duration=0;CHECK(sb_recorder_grid_duration(10,3,4,2000000,0,&duration)&&duration==1200000u);
    sb_ldc_block_header_t gap={.block_sequence=0,.block_length=SB_LDC_BLOCK_HEADER_SIZE+1u+SB_LDC_FOOTER_SIZE,
        .start_mono_us=2000000,.sample_rate_num=10,.sample_rate_den=3,.nominal_slots=4,.valid_slots=3,
        .presence_bitmap_offset=SB_LDC_BLOCK_HEADER_SIZE,.presence_bitmap_length=1,
        .payload_offset=SB_LDC_BLOCK_HEADER_SIZE,.time_accuracy_us=UINT32_MAX,.duration_us=duration,.flags=1u};
    CHECK(sb_ldc_header_encode(&gap,bytes));uint64_t end=gap.start_mono_us+gap.duration_us;
    sb_ldc_block_header_t following={.block_sequence=1,.block_length=SB_LDC_BLOCK_HEADER_SIZE+SB_LDC_FOOTER_SIZE,
        .start_mono_us=end,.sample_rate_num=10,.sample_rate_den=3,.nominal_slots=1,.valid_slots=1,
        .payload_offset=SB_LDC_BLOCK_HEADER_SIZE,.time_accuracy_us=UINT32_MAX,.duration_us=300000u};
    CHECK(sb_ldc_header_encode(&following,bytes));CHECK(following.start_mono_us>=end);
    return true;
}

int main(void)
{
    const struct { const char *name; bool (*run)(void); } tests[] = {
        {"CRC32C and varints", test_crc_and_varints},
        {"LDC delta codecs", test_delta_codec},
        {"LDC blocks", test_ldc_blocks},
        {"LDC fully specified golden block", test_ldc_fully_specified_golden_block},
        {"LDC presence bitmap", test_presence_bitmap},
        {"cause-aware progress watchdog", test_progress_watchdog_causes},
        {"LDC two-stage block commit fault injection", test_two_stage_block_commit},
        {"COBS and Sailball Protocol frames", test_cobs_and_sp},
        {"TCP COBS stream accumulator", test_tcp_cobs_stream},
        {"long COBS wire and maximum BULK", test_cobs_long_frames},
        {"Recorder rational grid and cross-block intervals", test_recorder_rational_grid},
        {"complete permission matrix", test_full_permission_matrix},
        {"CBOR", test_cbor},
        {"LDC metadata COW and power cuts", test_metadata_cow},
        {"LDC incremental metadata validation slices", test_metadata_incremental_load},
        {"Durable recommended GNSS profile roundtrip", test_real_gnss_metadata_profile}
    };
    for (size_t i = 0; i < sizeof(tests) / sizeof(tests[0]); ++i) {
        if (!tests[i].run()) return 1;
        printf("PASS %s\n", tests[i].name);
    }
    puts("All native host tests passed.");
    return 0;
}
