#pragma once
#include "sailball/common.h"
#include "esp_err.h"
#include <stddef.h>
#include <stdint.h>
#include <stdbool.h>

typedef enum { SB_STORAGE_OP_CREATE = 0, SB_STORAGE_OP_WRITE_BLOCK, SB_STORAGE_OP_CLOSE } sb_storage_op_t;
typedef struct {
    sb_storage_op_t op;
    uint8_t buffer_id;
    uint32_t block_sequence;
    uint8_t *data; /* ownership transfers to Storage until its terminal ack */
    size_t length;
    uint32_t boot_id, recorder_session_id, file_sequence;
    uint64_t device_id;
    uint8_t ldc_file_session_id[16];
} sb_storage_request_t;
typedef enum {
    SB_STORAGE_REASON_NONE = 0,
    SB_STORAGE_REASON_NO_SPACE,
    SB_STORAGE_REASON_SIZE_LIMIT,
    SB_STORAGE_REASON_METADATA_FULL
} sb_storage_reason_t;
typedef struct {
    sb_storage_op_t op;
    uint8_t buffer_id;
    sb_status_t status;
    sb_storage_reason_t reason;
    uint32_t committed_block_sequence, file_sequence;
    uint64_t readable_size;
    char file_name[64];
} sb_storage_ack_t;

#define SB_STORAGE_LIST_MAX 32u
typedef struct {
    char file_name[64];
    uint64_t readable_size;
    bool active;
} sb_storage_file_info_t;

esp_err_t sb_storage_start(void);
sb_storage_state_t sb_storage_get_state(void);
bool sb_storage_submit(const sb_storage_request_t *request);
bool sb_storage_try_ack(sb_storage_ack_t *ack);
bool sb_storage_create_recording(uint32_t boot_id, uint32_t recorder_session_id, uint32_t file_sequence,
                                 uint64_t device_id, const uint8_t ldc_file_session_id[16]);
bool sb_storage_submit_block(uint8_t buffer_id, uint32_t block_sequence, uint8_t *data, size_t length);
bool sb_storage_close_recording(void);
void sb_storage_get_size_snapshot(uint64_t *total_bytes, uint64_t *free_bytes);
void sb_storage_get_file_snapshot(char file_name[64], uint64_t *readable_size, bool *active);
sb_status_t sb_storage_list_files(uint32_t offset, uint8_t limit, sb_storage_file_info_t *entries,
                                  size_t capacity, size_t *count, uint32_t *next_offset, bool *complete);
sb_status_t sb_storage_get_file_info(const char *file_name, sb_storage_file_info_t *info);
sb_status_t sb_storage_delete_file(const char *file_name);
sb_status_t sb_storage_request_format(void);
sb_status_t sb_storage_transfer_open(const char *file_name, uint64_t *readable_size, bool *active);
sb_status_t sb_storage_transfer_read(uint64_t offset, uint32_t length, uint8_t *out, size_t capacity, uint32_t *actual);
sb_status_t sb_storage_transfer_close(void);
bool sb_storage_transfer_close_async(void);
bool sb_storage_transfer_is_active(void);
/* Monotonic-within-boot generation; changes whenever the current storage epoch is invalidated. */
uint32_t sb_storage_epoch_generation(void);
/* Short atomic linearization point before a canonical BULK enters physical TX.
 * This claim is serialized with epoch invalidation and never spans physical I/O. */
bool sb_storage_claim_bulk_publication(uint32_t epoch, uint64_t *claim_id);
bool sb_storage_finish_bulk_publication(uint32_t epoch, uint64_t claim_id);
void sb_storage_release_bulk_publication(uint32_t epoch, uint64_t claim_id);
