#include "storage_policy.h"
#include "sailball/ldc.h"

#define FILE_TARGET_DIVISOR 4u
#define FAT32_FILE_LIMIT UINT64_C(0xFFFFFFFF)
#define MAX_LDC_BLOCK_BYTES 8192u

uint64_t sb_storage_policy_file_target(uint64_t total_bytes)
{
    uint64_t target = total_bytes / FILE_TARGET_DIVISOR;
    const uint64_t minimum = (uint64_t)SB_LDC_DATA_OFFSET + MAX_LDC_BLOCK_BYTES;
    if (target < minimum) target = minimum;
    if (target > FAT32_FILE_LIMIT) target = FAT32_FILE_LIMIT;
    return target;
}

bool sb_storage_policy_create_space(uint64_t free_bytes, uint64_t reserve_bytes, uint64_t metadata_bytes)
{
    if (reserve_bytes > UINT64_MAX - metadata_bytes) return false;
    return free_bytes >= reserve_bytes + metadata_bytes;
}

bool sb_storage_policy_commit_space(uint64_t free_bytes, uint64_t block_bytes, uint64_t reserve_bytes)
{
    if (block_bytes > UINT64_MAX - reserve_bytes) return false;
    return free_bytes >= block_bytes + reserve_bytes;
}

bool sb_storage_policy_rollover(uint64_t readable_size, uint64_t target_size, uint64_t next_block_bytes)
{
    return readable_size > target_size || next_block_bytes > target_size - readable_size;
}

bool sb_storage_policy_can_format(bool storage_ready, bool file_active, bool transfer_open,
                                  uint32_t critical_outstanding, uint32_t background_outstanding)
{
    return storage_ready && !file_active && !transfer_open &&
           critical_outstanding == 0u && background_outstanding == 0u;
}

bool sb_storage_policy_service_background(bool critical_pending,bool background_pending,
                                          uint8_t consecutive_critical,uint8_t critical_burst_limit)
{
    return background_pending&&(!critical_pending||critical_burst_limit==0u||
                                consecutive_critical>=critical_burst_limit);
}
