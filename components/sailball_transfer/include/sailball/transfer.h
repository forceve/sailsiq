#pragma once
#include "sailball/common.h"
#include "esp_err.h"
#include <stdbool.h>
#include <stdint.h>
esp_err_t sb_transfer_start(void);
uint64_t sb_transfer_session_token(sb_source_t source, uint32_t generation);
void sb_transfer_set_session_generation(sb_source_t source, uint32_t generation);
sb_status_t sb_transfer_open(const char *file_name, uint64_t session_token, uint32_t *transfer_id, uint64_t *readable_size, bool *active);
sb_status_t sb_transfer_read(uint64_t session_token, uint32_t id, uint64_t offset, uint32_t length, uint8_t *out, size_t capacity, size_t *actual);
sb_status_t sb_transfer_close(uint64_t session_token, uint32_t id, bool read_outstanding);
bool sb_transfer_is_active(void);
bool sb_transfer_shutdown(void);
