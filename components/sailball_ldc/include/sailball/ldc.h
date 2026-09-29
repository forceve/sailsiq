#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define SB_LDC_METADATA_SIZE       16384u
#define SB_LDC_DATA_OFFSET         0x4000u
#define SB_LDC_SUPERBLOCK_SIZE     512u
#define SB_LDC_LOGICAL_PAGE_COUNT  24u
#define SB_LDC_PHYSICAL_PAGE_COUNT 30u
#define SB_LDC_PAGE_SIZE           512u
#define SB_LDC_BLOCK_HEADER_SIZE   96u
#define SB_LDC_DESCRIPTOR_SIZE     16u
#define SB_LDC_FOOTER_SIZE         16u
#define SB_LDC_MAX_BLOCK_US        15000000u
#define SB_LDC_MAX_FIELDS          64u
#define SB_LDC_MAX_DEFINITIONS     256u

typedef struct {
    void *context;
    bool (*write)(void *context, uint64_t offset, const void *data, size_t length);
    bool (*flush)(void *context);
} sb_ldc_commit_io_t;

uint32_t sb_crc32c(const void *data, size_t length);
bool sb_ldc_uvar_encode(uint64_t value, uint8_t out[10], size_t *written);
bool sb_ldc_uvar_decode(const uint8_t *data, size_t length, uint64_t *value, size_t *consumed);
bool sb_ldc_svar_encode(int64_t value, uint8_t out[10], size_t *written);
bool sb_ldc_svar_decode(const uint8_t *data, size_t length, int64_t *value, size_t *consumed);

typedef struct {
    uint32_t block_sequence;
    uint32_t block_length;
    uint64_t start_mono_us;
    int64_t start_utc_us;
    uint16_t sample_rate_num;
    uint16_t sample_rate_den;
    uint16_t nominal_slots;
    uint16_t valid_slots;
    uint16_t stream_count;
    uint16_t directory_length;
    uint32_t payload_offset;
    uint32_t payload_length;
    uint32_t presence_bitmap_offset;
    uint16_t presence_bitmap_length;
    uint8_t time_source;
    uint8_t time_flags;
    uint32_t time_accuracy_us;
    uint32_t duration_us;
    uint16_t flags;
} sb_ldc_block_header_t;

typedef struct {
    uint16_t local_field_id;
    uint16_t definition_version;
    uint8_t codec;
    uint8_t flags;
    uint16_t value_count;
    uint32_t payload_offset;
    uint32_t payload_length;
} sb_ldc_descriptor_t;

bool sb_ldc_header_encode(const sb_ldc_block_header_t *header, uint8_t out[SB_LDC_BLOCK_HEADER_SIZE]);
bool sb_ldc_header_decode(const uint8_t in[SB_LDC_BLOCK_HEADER_SIZE], sb_ldc_block_header_t *header);
bool sb_ldc_descriptor_encode(const sb_ldc_descriptor_t *descriptor, uint8_t out[SB_LDC_DESCRIPTOR_SIZE]);
bool sb_ldc_descriptor_decode(const uint8_t in[SB_LDC_DESCRIPTOR_SIZE], sb_ldc_descriptor_t *descriptor);
bool sb_ldc_block_validate(const uint8_t *block, size_t length, uint32_t expected_sequence);
/* Re-number a caller-owned complete block without changing sample contents. */
bool sb_ldc_block_set_sequence(uint8_t *block, size_t length, uint32_t sequence);
bool sb_ldc_block_commit(const sb_ldc_commit_io_t *io, uint64_t offset, const uint8_t *block,
                         size_t length, uint32_t expected_sequence);
bool sb_ldc_presence_validate(const uint8_t *bitmap, size_t bitmap_length, uint16_t slots, uint16_t valid_slots);
bool sb_ldc_delta_encode(const int64_t *signed_values, const uint64_t *unsigned_values, size_t count, bool is_signed, bool circular,
                         uint64_t modulus, uint8_t *out, size_t capacity, size_t *written);
bool sb_ldc_delta_decode(const uint8_t *input, size_t length, size_t count, bool is_signed,
                        bool circular, uint64_t modulus, int64_t *signed_values,
                        uint64_t *unsigned_values);

typedef struct {
    uint64_t generation;
    uint8_t active_superblock;
    uint16_t page_map[SB_LDC_LOGICAL_PAGE_COUNT];
    uint32_t page_crc32c[SB_LDC_LOGICAL_PAGE_COUNT];
    uint16_t field_count;
    uint16_t definition_count;
    uint16_t auxiliary_bytes_used;
    uint8_t ldc_file_session_id[16];
    uint64_t device_id;
    uint64_t created_mono_us;
    int64_t created_utc_us;
    int64_t first_valid_utc_us;
    uint32_t flags;
} sb_ldc_metadata_state_t;

/* Persistent cursor for bounded Storage-owner metadata validation. Workspace
 * buffers remain scratch-only and may be reused between calls to load_step. */
typedef struct {
    sb_ldc_metadata_state_t candidates[2];
    uint8_t raw[2][SB_LDC_SUPERBLOCK_SIZE];
    uint16_t cursor;
    uint8_t candidate, phase;
    bool candidate_valid[2], complete, result_valid;
} sb_ldc_metadata_load_ctx_t;

/* Exclusive caller-owned scratch. May alias publication tables: validation
 * begins only after all table writes and readback comparisons have completed. */
typedef struct {
    uint16_t field_ids[SB_LDC_MAX_FIELDS], field_semantics[SB_LDC_MAX_FIELDS];
    uint16_t def_fields[SB_LDC_MAX_DEFINITIONS], def_versions[SB_LDC_MAX_DEFINITIONS];
    uint8_t bytes[2048];
    uint64_t enum_values[256];
    uint8_t raw[2][SB_LDC_SUPERBLOCK_SIZE], page[SB_LDC_PAGE_SIZE];
    sb_ldc_metadata_state_t candidates[2];
    sb_ldc_metadata_load_ctx_t one_shot_loader;
} sb_ldc_metadata_workspace_t;

typedef struct {
    void *context;
    bool (*read)(void *context, uint32_t offset, void *data, size_t length);
    sb_ldc_metadata_workspace_t *workspace; /* required by load/publish */
    bool (*write)(void *context, uint32_t offset, const void *data, size_t length);
    bool (*flush)(void *context);
} sb_ldc_io_t;


bool sb_ldc_superblock_encode(const sb_ldc_metadata_state_t *state, uint8_t out[SB_LDC_SUPERBLOCK_SIZE]);
bool sb_ldc_superblock_decode(const uint8_t in[SB_LDC_SUPERBLOCK_SIZE], sb_ldc_metadata_state_t *state);
bool sb_ldc_metadata_initialize(const sb_ldc_io_t *io, sb_ldc_metadata_state_t *state,
                                const uint8_t file_session_id[16], uint64_t device_id,
                                uint64_t created_mono_us);
bool sb_ldc_metadata_load(const sb_ldc_io_t *io, sb_ldc_metadata_state_t *state);
void sb_ldc_metadata_load_begin(sb_ldc_metadata_load_ctx_t *context);
bool sb_ldc_metadata_load_step(const sb_ldc_io_t *io, sb_ldc_metadata_load_ctx_t *context,
                               unsigned operation_budget, sb_ldc_metadata_state_t *state,
                               bool *complete, bool *valid);
bool sb_ldc_metadata_publish(const sb_ldc_io_t *io, const sb_ldc_metadata_state_t *current,
                             const sb_ldc_metadata_state_t *desired,
                             const uint8_t logical_tables[SB_LDC_LOGICAL_PAGE_COUNT][SB_LDC_PAGE_SIZE],
                             uint32_t changed_page_mask, sb_ldc_metadata_state_t *published);
