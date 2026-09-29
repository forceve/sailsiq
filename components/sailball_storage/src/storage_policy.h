#pragma once

#include <stdbool.h>
#include <stdint.h>

uint64_t sb_storage_policy_file_target(uint64_t total_bytes);
bool sb_storage_policy_create_space(uint64_t free_bytes, uint64_t reserve_bytes, uint64_t metadata_bytes);
bool sb_storage_policy_commit_space(uint64_t free_bytes, uint64_t block_bytes, uint64_t reserve_bytes);
bool sb_storage_policy_rollover(uint64_t readable_size, uint64_t target_size, uint64_t next_block_bytes);
bool sb_storage_policy_can_format(bool storage_ready, bool file_active, bool transfer_open,
                                  uint32_t critical_outstanding, uint32_t background_outstanding);
bool sb_storage_policy_service_background(bool critical_pending, bool background_pending,
                                         uint8_t consecutive_critical, uint8_t critical_burst_limit);
