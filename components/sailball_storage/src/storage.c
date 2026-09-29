#include "sailball/storage.h"
#include "sailball/board.h"
#include "sailball/diagnostics.h"
#include "sailball/validation.h"
#include "sailball/ldc.h"
#include "storage_policy.h"
#include "sailball/common.h"
#include "sailball/recorder_pool_config.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "sailball/rpc_completion.h"
#include "freertos/semphr.h"
#include "freertos/portmacro.h"
#include "esp_err.h"
#include "esp_task_wdt.h"
#include "esp_vfs_fat.h"
#include "sdmmc_cmd.h"
#include "driver/sdspi_host.h"
#include "driver/spi_common.h"
#include "sdkconfig.h"
#include <errno.h>
#include <dirent.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/statvfs.h>
#include <sys/stat.h>
#include <unistd.h>

#define STORAGE_QUEUE_DEPTH 8
#define STORAGE_BACKGROUND_HIGH_QUEUE_DEPTH 4
#define STORAGE_BACKGROUND_LOW_QUEUE_DEPTH 4
#define STORAGE_ACK_DEPTH 16
#define STORAGE_STACK_WORDS 4096
#define STORAGE_RETRY_MS 5000
#define STORAGE_SCAN_BLOCKS_PER_SLICE 4u
#define STORAGE_SCAN_DIRECTORY_ENTRIES_PER_SLICE 4u
#define STORAGE_METADATA_OPS_PER_SLICE 4u
#define STORAGE_CRITICAL_BURST_MAX 4u

typedef enum { STORAGE_BG_OPEN=1, STORAGE_BG_READ, STORAGE_BG_CLOSE, STORAGE_BG_LIST,
               STORAGE_BG_INFO, STORAGE_BG_DELETE, STORAGE_BG_FORMAT } storage_bg_op_t;
typedef struct {
    storage_bg_op_t op;
    TaskHandle_t waiter;
    char file_name[64];
    uint64_t offset;
    uint32_t length;
    uint8_t *out;
    size_t capacity;
    uint64_t readable_size;
    bool active;
    bool counted;
    uint64_t *readable_size_out;
    bool *active_out;
    uint32_t *actual_out;
    uint32_t list_offset;
    uint8_t list_limit;
    sb_storage_file_info_t *entries_out;
    size_t entries_capacity;
    size_t *entry_count_out;
    uint32_t *next_offset_out;
    bool *complete_out;
    sb_storage_file_info_t *file_info_out;
    sb_status_t result;
    bool initialized;
    bool scan_initialized;
    bool metadata_validated;
    bool list_file_pending;
    bool list_more;
    bool list_file_active;
    int scan_fd;
    DIR *directory;
    uint64_t scan_physical_size;
    uint64_t scan_cursor;
    uint64_t scan_previous_end;
    uint64_t scan_readable_size;
    uint64_t list_matching;
    uint32_t scan_expected_sequence;
    size_t list_count;
    size_t list_scan_slot;
    uint32_t metadata_load_token;
} storage_bg_request_t;

static StaticQueue_t s_req_q_struct, s_ack_q_struct;
static StaticQueue_t s_bg_high_q_struct, s_bg_low_q_struct;
static uint8_t s_req_q_data[STORAGE_QUEUE_DEPTH * sizeof(sb_storage_request_t)];
static uint8_t s_ack_q_data[STORAGE_ACK_DEPTH * sizeof(sb_storage_ack_t)];
static uint8_t s_bg_high_q_data[STORAGE_BACKGROUND_HIGH_QUEUE_DEPTH * sizeof(storage_bg_request_t)];
static uint8_t s_bg_low_q_data[STORAGE_BACKGROUND_LOW_QUEUE_DEPTH * sizeof(storage_bg_request_t)];
static QueueHandle_t s_req_q, s_ack_q, s_bg_high_q, s_bg_low_q;
static StaticTask_t s_task_struct;
static StackType_t s_stack[STORAGE_STACK_WORDS];
static portMUX_TYPE s_mux = portMUX_INITIALIZER_UNLOCKED;
static sb_storage_state_t s_state = SB_STORAGE_UNAVAILABLE;
static uint32_t s_critical_outstanding;
static uint32_t s_background_outstanding;
static TickType_t s_retry_at;
static uint64_t s_total_bytes, s_free_bytes, s_readable_size;
static char s_file_name[64];
static bool s_file_active, s_file_abandoned;
/* A known reserve failure closes the file but leaves Storage mounted. READY
 * blocks already queued for it must receive the same NO_SPACE result. */
static bool s_record_no_space, s_record_rollover_pending;
/* Storage owns these existing Recorder pool buffers until the clean rollover
 * transaction has committed them or a real create/write failure is reported. */
static sb_storage_request_t s_rollover_blocks[SB_RECORDER_BLOCK_POOL_COUNT];
static uint8_t s_rollover_block_count;
static int s_record_fd = -1;
#if CONFIG_SAILBALL_SD_SPI2_HOST
static sdmmc_card_t *s_card;
static bool s_spi_initialized;
#endif
static const char *s_mount_point = "/sdcard";
static sb_ldc_metadata_state_t s_metadata;
static union {
    uint8_t tables[SB_LDC_LOGICAL_PAGE_COUNT][SB_LDC_PAGE_SIZE];
    sb_ldc_metadata_workspace_t validation;
} s_metadata_workspace; /* storage_task only, mutually exclusive lifetimes */
#define s_profile_tables s_metadata_workspace.tables
_Static_assert(sizeof(sb_ldc_metadata_workspace_t)<=sizeof(s_profile_tables),"metadata scratch exceeds existing budget");
static bool s_transfer_open;
static char s_transfer_file_name[64];
static uint64_t s_transfer_readable_size;
static bool s_transfer_active_file;
static bool s_transfer_open_snapshot;
static int s_transfer_fd = -1;
static uint8_t s_transfer_metadata[SB_LDC_METADATA_SIZE];
static uint32_t s_epoch_generation = 1u;
static uint64_t s_bulk_publication_next_id;
static uint64_t s_bulk_publication_active_id;
static bool s_bulk_publication_active;
static uint8_t s_scan_buffer[8192];
static sb_ldc_metadata_load_ctx_t s_metadata_loader;
static uint32_t s_metadata_loader_owner, s_metadata_loader_next_token;
static void update_space_snapshot(void);
static bool retain_rollover_block(const sb_storage_request_t *request);
static void fail_rollover_blocks(sb_status_t status, sb_storage_reason_t reason);
static bool commit_rollover_blocks(void);
static void abort_epoch(void);

static bool write_complete(int fd, const uint8_t *data, size_t length)
{
    size_t done = 0;
    while (done < length) {
        ssize_t n = write(fd, data + done, length - done);
        if (n <= 0) return false;
        done += (size_t)n;
    }
    return true;
}

static bool file_io_write(void *context, uint32_t offset, const void *data, size_t length)
{
    int fd = *(int *)context;
    if (lseek(fd, (off_t)offset, SEEK_SET) < 0) return false;
    return write_complete(fd, data, length);
}

static bool file_io_read(void *context, uint32_t offset, void *data, size_t length)
{
    int fd = *(int *)context;
    if (lseek(fd, (off_t)offset, SEEK_SET) < 0) return false;
    uint8_t *p = data;
    size_t done = 0;
    while (done < length) {
        ssize_t n = read(fd, p + done, length - done);
        if (n <= 0) return false;
        done += (size_t)n;
    }
    return true;
}

static bool file_io_flush(void *context)
{
    int fd = *(int *)context;
    return fsync(fd) == 0;
}

static bool block_commit_write(void *context, uint64_t offset, const void *data, size_t length)
{
    int fd=*(int *)context;
    return offset<=INT64_MAX&&lseek(fd,(off_t)offset,SEEK_SET)>=0&&write_complete(fd,data,length);
}

static bool block_commit_flush(void *context)
{
    return fsync(*(int *)context)==0;
}

static bool read_at(int fd, uint64_t offset, uint8_t *data, size_t length)
{
    if (offset > INT64_MAX || lseek(fd, (off_t)offset, SEEK_SET) < 0) return false;
    size_t done = 0;
    while (done < length) {
        ssize_t n = read(fd, data + done, length - done);
        if (n <= 0) return false;
        done += (size_t)n;
    }
    return true;
}

static bool safe_record_name(const char *name)
{
    if (name == NULL) return false;
    size_t n = strnlen(name, 64);
    if (n != 35 || memcmp(name, "SB_", 3) != 0 || memcmp(name + 11, "_S", 2) != 0 ||
        memcmp(name + 21, "_F", 2) != 0 || memcmp(name + 31, ".ldc", 4) != 0) return false;
    for (size_t i = 3; i < 31; ++i) {
        if (i==11||i==12||i==21||i==22) continue;
        char c=name[i];
        if (!((c>='0'&&c<='9')||(c>='A'&&c<='F'))) return false;
    }
    return true;
}

static void scan_prefix_begin(storage_bg_request_t *request, int fd, uint64_t physical_size)
{
    request->scan_initialized = true;
    request->scan_fd = fd;
    request->scan_physical_size = physical_size;
    request->scan_cursor = SB_LDC_DATA_OFFSET;
    request->scan_previous_end = 0;
    request->scan_expected_sequence = 0;
    request->scan_readable_size = SB_LDC_DATA_OFFSET;
}

/* One bounded activation checks at most four complete LDC blocks. */
static bool scan_prefix_slice(storage_bg_request_t *request, bool *complete)
{
    if (request == NULL || complete == NULL || request->scan_fd < 0 ||
        request->scan_physical_size < SB_LDC_DATA_OFFSET) return false;
    *complete = false;
    for (unsigned checked = 0; checked < STORAGE_SCAN_BLOCKS_PER_SLICE; ++checked) {
        uint64_t cursor = request->scan_cursor;
        if (cursor >= request->scan_physical_size) { *complete = true; break; }
        if (request->scan_physical_size - cursor < SB_LDC_BLOCK_HEADER_SIZE ||
            !read_at(request->scan_fd, cursor, s_scan_buffer, SB_LDC_BLOCK_HEADER_SIZE)) {
            *complete = true; break;
        }
        sb_ldc_block_header_t header;
        if (!sb_ldc_header_decode(s_scan_buffer, &header) ||
            header.block_sequence != request->scan_expected_sequence ||
            header.block_length < SB_LDC_BLOCK_HEADER_SIZE + SB_LDC_FOOTER_SIZE ||
            header.block_length > sizeof(s_scan_buffer) ||
            header.block_length > request->scan_physical_size - cursor ||
            (request->scan_previous_end != 0 && header.start_mono_us < request->scan_previous_end) ||
            header.start_mono_us > UINT64_MAX - header.duration_us) {
            *complete = true; break;
        }
        if (!read_at(request->scan_fd, cursor, s_scan_buffer, header.block_length) ||
            !sb_ldc_block_validate(s_scan_buffer, header.block_length, request->scan_expected_sequence)) {
            *complete = true; break;
        }
        request->scan_previous_end = header.start_mono_us + header.duration_us;
        request->scan_cursor += header.block_length;
        request->scan_readable_size = request->scan_cursor;
        if (request->scan_expected_sequence == UINT32_MAX) { *complete = true; break; }
        ++request->scan_expected_sequence;
    }
    if (request->scan_cursor >= request->scan_physical_size) *complete = true;
    (void)esp_task_wdt_reset();
    return true;
}

static sb_status_t continue_nonactive_metadata_load(storage_bg_request_t *request)
{
    if(request->scan_fd<0)return SB_INVALID_STATE;
    if(request->metadata_validated)return SB_OK;
    if(request->metadata_load_token==0u||request->metadata_load_token!=s_metadata_loader_owner){
        if(++s_metadata_loader_next_token==0u)++s_metadata_loader_next_token;
        s_metadata_loader_owner=s_metadata_loader_next_token;
        request->metadata_load_token=s_metadata_loader_owner;
        sb_ldc_metadata_load_begin(&s_metadata_loader);
    }
    int fd=request->scan_fd;
    sb_ldc_io_t io={.workspace=&s_metadata_workspace.validation,.context=&fd,
        .read=file_io_read,.write=NULL,.flush=NULL};
    sb_ldc_metadata_state_t state;bool complete=false,valid=false;
    if(!sb_ldc_metadata_load_step(&io,&s_metadata_loader,STORAGE_METADATA_OPS_PER_SLICE,
                                  &state,&complete,&valid))return SB_IO_ERROR;
    if(!complete)return SB_ACCEPTED;
    request->metadata_load_token=0u;
    if(s_metadata_loader_owner==s_metadata_loader_next_token)s_metadata_loader_owner=0u;
    if(!valid)return SB_IO_ERROR;
    request->metadata_validated=true;
    scan_prefix_begin(request,request->scan_fd,request->scan_physical_size);
    return SB_OK;
}

static sb_status_t open_nonactive_scan(storage_bg_request_t *request,const char *file_name,
                                       bool snapshot_metadata)
{
    if(request->scan_fd<0){
        char path[96];int n=snprintf(path,sizeof(path),"%s/%s",s_mount_point,file_name);
        if(n<=0||(size_t)n>=sizeof(path))return SB_OUT_OF_RANGE;
        int fd=open(path,O_RDONLY,0);if(fd<0)return errno==ENOENT?SB_NOT_FOUND:SB_IO_ERROR;
        struct stat st;
        if(fstat(fd,&st)!=0||st.st_size<(off_t)SB_LDC_DATA_OFFSET){(void)close(fd);return SB_IO_ERROR;}
        request->scan_fd=fd;request->scan_physical_size=(uint64_t)st.st_size;
        if(snapshot_metadata&&!read_at(fd,0,s_transfer_metadata,sizeof(s_transfer_metadata)))return SB_IO_ERROR;
    }
    return continue_nonactive_metadata_load(request);
}

static void release_nonactive_scan(storage_bg_request_t *request)
{
    if(request->scan_fd>=0){(void)close(request->scan_fd);request->scan_fd=-1;}
    if(request->metadata_load_token!=0u&&request->metadata_load_token==s_metadata_loader_owner)
        s_metadata_loader_owner=0u;
    request->metadata_load_token=0u;
    request->metadata_validated=false;
    request->scan_initialized=false;
    request->scan_physical_size=0u;
    request->scan_cursor=0u;
    request->scan_previous_end=0u;
    request->scan_readable_size=0u;
    request->scan_expected_sequence=0u;
}

static void finish_transfer_open(storage_bg_request_t *request, bool active)
{
    uint64_t readable = active ? s_readable_size : request->scan_readable_size;
    s_transfer_fd = request->scan_fd;
    request->scan_fd = -1;
    memcpy(s_transfer_file_name, request->file_name, strlen(request->file_name) + 1u);
    s_transfer_readable_size = readable;
    s_transfer_active_file = active;
    s_transfer_open = true;
    portENTER_CRITICAL(&s_mux); s_transfer_open_snapshot = true; portEXIT_CRITICAL(&s_mux);
    if (request->readable_size_out) *request->readable_size_out = readable;
    if (request->active_out) *request->active_out = active;
}

static void background_cleanup(storage_bg_request_t *request)
{
    if (request->scan_fd >= 0) { (void)close(request->scan_fd); request->scan_fd = -1; }
    if (request->directory != NULL) { (void)closedir(request->directory); request->directory = NULL; }
    if (request->metadata_load_token != 0u &&
        request->metadata_load_token == s_metadata_loader_owner) {
        s_metadata_loader_owner = 0u;
    }
    request->metadata_load_token = 0u;
}

static void critical_request_complete(void)
{
    portENTER_CRITICAL(&s_mux);
    if(s_critical_outstanding!=0u)--s_critical_outstanding;
    portEXIT_CRITICAL(&s_mux);
}

static void background_request_complete(storage_bg_request_t *request)
{
    if(request==NULL||!request->counted)return;
    portENTER_CRITICAL(&s_mux);
    if(s_background_outstanding!=0u)--s_background_outstanding;
    request->counted=false;
    portEXIT_CRITICAL(&s_mux);
}

static sb_status_t process_background(storage_bg_request_t *request)
{
    if (!request->initialized) { request->scan_fd = -1; request->initialized = true; }
    if (request->op == STORAGE_BG_CLOSE) {
        if (s_transfer_fd >= 0) { (void)close(s_transfer_fd); s_transfer_fd = -1; }
        s_transfer_open = false; s_transfer_file_name[0] = '\0'; s_transfer_readable_size = 0; s_transfer_active_file = false;
        portENTER_CRITICAL(&s_mux); s_transfer_open_snapshot = false; portEXIT_CRITICAL(&s_mux);
        return SB_OK;
    }
    if (request->op == STORAGE_BG_FORMAT) {
#if CONFIG_SAILBALL_SD_SPI2_HOST
        if (s_transfer_open || s_file_active || s_transfer_open_snapshot) {
            portENTER_CRITICAL(&s_mux); s_state = SB_STORAGE_READY; portEXIT_CRITICAL(&s_mux);
            return SB_BUSY;
        }
        if(s_card==NULL){
            portENTER_CRITICAL(&s_mux);s_state=SB_STORAGE_ERROR;portEXIT_CRITICAL(&s_mux);
            sb_diag_increment(SB_DIAG_STORAGE,3);
            return SB_INVALID_STATE;
        }
        esp_err_t err = esp_vfs_fat_sdcard_format(s_mount_point, s_card);
        struct statvfs vfs;
        if (err == ESP_OK && statvfs(s_mount_point, &vfs) == 0) {
            (void)vfs;
            update_space_snapshot();
            portENTER_CRITICAL(&s_mux);
            s_state = SB_STORAGE_READY; s_file_active = false; s_file_abandoned=false; s_readable_size = 0;
            memset(s_file_name, 0, sizeof(s_file_name));
            portEXIT_CRITICAL(&s_mux);
            return SB_OK;
        }
        portENTER_CRITICAL(&s_mux); s_state = SB_STORAGE_ERROR; portEXIT_CRITICAL(&s_mux);
        sb_diag_increment(SB_DIAG_STORAGE, 3);
        return SB_IO_ERROR;
#else
        portENTER_CRITICAL(&s_mux); s_state = SB_STORAGE_ERROR; portEXIT_CRITICAL(&s_mux);
        return SB_UNSUPPORTED;
#endif
    }
    if (sb_storage_get_state() != SB_STORAGE_READY) return SB_IO_ERROR;

    if (request->op == STORAGE_BG_OPEN) {
        if (!request->scan_initialized) {
            if (s_transfer_open) return SB_BUSY;
            if (!safe_record_name(request->file_name)) return SB_INVALID_REQUEST;
            bool active = s_file_active && strcmp(request->file_name, s_file_name) == 0;
            if (active) {
                char path[96]; int n=snprintf(path,sizeof(path),"%s/%s",s_mount_point,request->file_name);
                if (n<=0||(size_t)n>=sizeof(path)) return SB_OUT_OF_RANGE;
                request->scan_fd=open(path,O_RDONLY,0);
                if (request->scan_fd<0) return errno==ENOENT?SB_NOT_FOUND:SB_IO_ERROR;
                if (!read_at(request->scan_fd,0,s_transfer_metadata,sizeof(s_transfer_metadata))) return SB_IO_ERROR;
                request->scan_readable_size=s_readable_size;
                request->list_file_active=true;
                request->scan_initialized=true;
            } else {
                sb_status_t status=open_nonactive_scan(request,request->file_name,true);
                if (status!=SB_OK) return status;
            }
        }
        if (!request->list_file_active) {
            bool complete=false;
            if (!scan_prefix_slice(request,&complete)) return SB_IO_ERROR;
            if (!complete) return SB_ACCEPTED;
        }
        if (request->scan_readable_size<SB_LDC_DATA_OFFSET) return SB_IO_ERROR;
        finish_transfer_open(request,request->list_file_active);
        return SB_OK;
    }

    if (request->op == STORAGE_BG_READ) {
        if (!s_transfer_open) return SB_NOT_FOUND;
        if (request->length == 0 || request->offset >= s_transfer_readable_size || request->length > request->capacity || request->out == NULL) return SB_OUT_OF_RANGE;
        size_t amount = request->length;
        uint64_t remaining = s_transfer_readable_size - request->offset;
        if (remaining < amount) amount = (size_t)remaining;
        size_t copied = 0;
        if (request->offset < SB_LDC_METADATA_SIZE) {
            size_t part = SB_LDC_METADATA_SIZE - (size_t)request->offset;
            if (part > amount) part = amount;
            memcpy(request->out, s_transfer_metadata + request->offset, part);
            copied += part;
        }
        if (copied < amount) {
            uint64_t file_offset = request->offset + copied;
            int fd = s_transfer_fd;
            if (fd < 0) { sb_diag_increment(SB_DIAG_STORAGE, 5); return SB_IO_ERROR; }
            bool ok = read_at(fd, file_offset, request->out + copied, amount - copied);
            if (!ok) { sb_diag_increment(SB_DIAG_STORAGE, 5); (void)sb_diag_raise(4, 3, 1, false, 0); return SB_IO_ERROR; }
        }
        sb_diag_add(SB_DIAG_STORAGE, 4, amount);
        if (request->actual_out) *request->actual_out = (uint32_t)amount;
        return SB_OK;
    }

    if (request->op == STORAGE_BG_LIST) {
        if (request->entries_out == NULL || request->entry_count_out == NULL || request->next_offset_out == NULL ||
            request->complete_out == NULL || request->list_limit == 0 || request->list_limit > SB_STORAGE_LIST_MAX ||
            request->list_limit > request->entries_capacity) return SB_INVALID_REQUEST;
        if (request->directory == NULL && !request->scan_initialized) {
            request->directory=opendir(s_mount_point);
            if(request->directory==NULL)return SB_IO_ERROR;
            request->scan_initialized=true;
        }
        unsigned visited=0;
        while(visited<STORAGE_SCAN_DIRECTORY_ENTRIES_PER_SLICE) {
            if(request->list_file_pending) {
                if(!request->metadata_validated) {
                    sb_status_t status=continue_nonactive_metadata_load(request);
                    if(status==SB_ACCEPTED)return SB_ACCEPTED;
                    if(status!=SB_OK) {
                        /* Keep generated but invalid files visible for explicit deletion. */
                        sb_storage_file_info_t *entry=&request->entries_out[request->list_scan_slot];
                        entry->readable_size=0;
                        entry->active=false;
                        release_nonactive_scan(request);
                        request->list_file_pending=false;
                        ++request->list_count;
                        continue;
                    }
                }
                bool complete=false;
                if(!scan_prefix_slice(request,&complete))return SB_IO_ERROR;
                if(!complete)return SB_ACCEPTED;
                if(request->scan_readable_size>=SB_LDC_DATA_OFFSET) {
                    sb_storage_file_info_t *entry=&request->entries_out[request->list_scan_slot];
                    entry->readable_size=request->scan_readable_size;
                    entry->active=false;
                    ++request->list_count;
                }
                release_nonactive_scan(request);
                request->list_file_pending=false;
                continue;
            }
            struct dirent *item=readdir(request->directory);
            if(item==NULL) {
                *request->entry_count_out=request->list_count;
                *request->next_offset_out=request->list_offset+(uint32_t)request->list_count;
                *request->complete_out=true;
                (void)closedir(request->directory);request->directory=NULL;
                return SB_OK;
            }
            ++visited;
            if(!safe_record_name(item->d_name))continue;
            if(request->list_matching++<request->list_offset)continue;
            if(request->list_count==request->list_limit) {
                request->list_more=true;
                *request->entry_count_out=request->list_count;
                *request->next_offset_out=request->list_offset+(uint32_t)request->list_count;
                *request->complete_out=false;
                (void)closedir(request->directory);request->directory=NULL;
                return SB_OK;
            }
            sb_storage_file_info_t *entry=&request->entries_out[request->list_count];
            size_t name_length=strlen(item->d_name);
            memcpy(entry->file_name,item->d_name,name_length+1u);
            if(s_file_active&&strcmp(item->d_name,s_file_name)==0) {
                entry->readable_size=s_readable_size;entry->active=true;++request->list_count;continue;
            }
            sb_status_t status=open_nonactive_scan(request,item->d_name,false);
            if(status==SB_ACCEPTED) {
                request->list_file_pending=true;
                request->list_scan_slot=request->list_count;
                return SB_ACCEPTED;
            }
            if(status!=SB_OK) {
                /* Keep damaged generated files visible so clients can explicitly delete them. */
                entry->readable_size=0;
                entry->active=false;
                release_nonactive_scan(request);
                ++request->list_count;
                continue;
            }
            request->list_file_pending=true;
            request->list_scan_slot=request->list_count;
        }
        return SB_ACCEPTED;
    }

    if (request->op == STORAGE_BG_INFO || request->op == STORAGE_BG_DELETE) {
        if (!safe_record_name(request->file_name)) return SB_INVALID_REQUEST;
        if (request->op == STORAGE_BG_INFO && request->file_info_out == NULL) return SB_INVALID_REQUEST;
        char path[96];
        int n = snprintf(path, sizeof(path), "%s/%s", s_mount_point, request->file_name);
        if (n <= 0 || (size_t)n >= sizeof(path)) return SB_OUT_OF_RANGE;
        bool active = s_file_active && strcmp(request->file_name, s_file_name) == 0;
        if (request->op == STORAGE_BG_DELETE) {
            if (active) return SB_INVALID_STATE;
            if (s_transfer_open && strcmp(request->file_name, s_transfer_file_name) == 0) return SB_BUSY;
            if (unlink(path) != 0) return errno == ENOENT ? SB_NOT_FOUND : SB_IO_ERROR;
            update_space_snapshot();
            return SB_OK;
        }
        if (!request->scan_initialized) {
            memcpy(request->file_info_out->file_name,request->file_name,strlen(request->file_name)+1u);
            request->file_info_out->active=active;
            if(active) {request->file_info_out->readable_size=s_readable_size;request->scan_initialized=true;}
            else {
                sb_status_t status=open_nonactive_scan(request,request->file_name,false);
                if(status!=SB_OK)return status;
            }
        }
        if (active) return SB_OK;
        bool complete=false;
        if(!scan_prefix_slice(request,&complete))return SB_IO_ERROR;
        if(!complete)return SB_ACCEPTED;
        request->file_info_out->readable_size=request->scan_readable_size;
        return SB_OK;
    }
    return SB_UNSUPPORTED;
}

static bool background_is_high_priority(storage_bg_op_t op)
{
    return op==STORAGE_BG_OPEN||op==STORAGE_BG_READ||op==STORAGE_BG_CLOSE;
}

static QueueHandle_t background_queue(storage_bg_op_t op)
{
    return background_is_high_priority(op)?s_bg_high_q:s_bg_low_q;
}

static sb_status_t run_background(storage_bg_request_t *request)
{
    QueueHandle_t queue=request?background_queue(request->op):NULL;
    if (queue == NULL || request == NULL) return SB_INVALID_STATE;
    if (uxQueueMessagesWaiting(s_req_q) != 0) return SB_BUSY;
    portENTER_CRITICAL(&s_mux);
    if(s_state!=SB_STORAGE_READY||s_background_outstanding==UINT32_MAX){
        sb_status_t denied=s_state==SB_STORAGE_FORMATTING?SB_BUSY:SB_INVALID_STATE;
        portEXIT_CRITICAL(&s_mux);
        return denied;
    }
    ++s_background_outstanding;
    request->counted=true;
    portEXIT_CRITICAL(&s_mux);
    request->waiter = xTaskGetCurrentTaskHandle();
    if (xQueueSend(queue, request, 0) != pdTRUE){background_request_complete(request);return SB_BUSY;}
    sb_diag_max(SB_DIAG_STORAGE,7,uxQueueMessagesWaiting(queue));
    uint32_t result=SB_INTERNAL_ERROR;
    result=sb_rpc_wait_completion();
    request->result=(sb_status_t)result;
    return request->result;
}

static bool mount_sd(void)
{
#if CONFIG_SAILBALL_SD_SPI2_HOST
    sb_board_info_t board;
    sb_board_get_info(&board);
    if (!board.sd_configured) return false;
    sdmmc_host_t host = SDSPI_HOST_DEFAULT();
    host.slot = board.sd_spi_host;
    spi_bus_config_t bus = {
        .mosi_io_num = board.sd_mosi_gpio,
        .miso_io_num = board.sd_miso_gpio,
        .sclk_io_num = board.sd_sclk_gpio,
        .quadwp_io_num = -1,
        .quadhd_io_num = -1,
        .max_transfer_sz = 4096
    };
    esp_err_t err = spi_bus_initialize(host.slot, &bus, SPI_DMA_CH_AUTO);
    if (err != ESP_OK) return false;
    s_spi_initialized = true;
    sdspi_device_config_t slot = SDSPI_DEVICE_CONFIG_DEFAULT();
    slot.host_id = host.slot;
    slot.gpio_cs = board.sd_cs_gpio;
    esp_vfs_fat_sdmmc_mount_config_t config = {
        .format_if_mount_failed = false,
        .max_files = 6,
        .allocation_unit_size = 16 * 1024
    };
    err = esp_vfs_fat_sdspi_mount(s_mount_point, &host, &slot, &config, &s_card);
    if (err != ESP_OK) {
        (void)spi_bus_free(host.slot);
        s_spi_initialized = false;
        return false;
    }
    struct statvfs vfs;
    if (statvfs(s_mount_point, &vfs) == 0) {
        s_total_bytes = (uint64_t)vfs.f_blocks * vfs.f_frsize;
        s_free_bytes = (uint64_t)vfs.f_bavail * vfs.f_frsize;
    }
    return true;
#else
    return false;
#endif
}

static void unmount_sd(void)
{
#if CONFIG_SAILBALL_SD_SPI2_HOST
    if (s_card != NULL) {
        (void)esp_vfs_fat_sdcard_unmount(s_mount_point, s_card);
        s_card = NULL;
    }
    if (s_spi_initialized) {
        sb_board_info_t board;
        sb_board_get_info(&board);
        (void)spi_bus_free(board.sd_spi_host);
        s_spi_initialized = false;
    }
#endif
}

static uint32_t crc_record(uint8_t record[32])
{
    return sb_crc32c(record, 28);
}

static void put_catalog_record(uint8_t *r, uint16_t local_id, uint16_t semantic_id)
{
    memset(r, 0, 32);
    sb_write_le16(r, local_id);
    sb_write_le16(r + 2, semantic_id);
    sb_write_le32(r + 28, crc_record(r));
}

static void put_definition_record(uint8_t *r, uint16_t local_id, uint16_t semantic_id,
                                 uint8_t mode, uint8_t value_type, uint16_t unit_id,
                                 int8_t scale, uint8_t codec, uint16_t flags,
                                 uint16_t enum_table, uint32_t aux_offset, uint16_t aux_length)
{
    memset(r, 0, 32);
    sb_write_le16(r, local_id);
    sb_write_le16(r + 2, 1);
    sb_write_le16(r + 4, semantic_id);
    r[6] = mode; r[7] = value_type;
    sb_write_le16(r + 8, unit_id); r[10] = (uint8_t)scale; r[11] = codec;
    sb_write_le16(r + 12, flags); sb_write_le16(r + 14, enum_table);
    sb_write_le16(r + 22, aux_length); sb_write_le32(r + 24, aux_offset);
    sb_write_le32(r + 28, crc_record(r));
}

static bool publish_gnss_profile(sb_ldc_metadata_state_t *state)
{
    memset(s_profile_tables, 0, sizeof(s_profile_tables));
    for (uint16_t i = 0; i < 7; ++i) put_catalog_record(&s_profile_tables[0][i * 32u], i + 1u, i + 1u);
    uint8_t *defs = &s_profile_tables[4][0];
    put_definition_record(defs + 0 * 32u, 1, 1, 0, 1, 1, -7, 1, 0, 0, 0, 0);
    put_definition_record(defs + 1 * 32u, 2, 2, 0, 1, 1, -7, 1, 0, 0, 0, 0);
    put_definition_record(defs + 2 * 32u, 3, 3, 0, 1, 2, -2, 1, 0, 0, 0, 0);
    put_definition_record(defs + 3 * 32u, 4, 4, 0, 0, 5, -2, 1, 0, 0, 0, 0);
    put_definition_record(defs + 4 * 32u, 5, 5, 0, 0, 1, -2, 1, 1, 0, 0x2C00, 12);
    put_definition_record(defs + 5 * 32u, 6, 6, 1, 0, 6, 0, 2, 0, 0, 0, 0);
    put_definition_record(defs + 6 * 32u, 7, 7, 1, 3, 0, 0, 2, 0, 1, 0, 0);
    uint8_t *aux = &s_profile_tables[20][0];
    sb_write_le16(aux, 1); sb_write_le16(aux + 2, 8); sb_write_le64(aux + 4, 36000);
    sb_ldc_metadata_state_t desired = *state;
    desired.field_count = 7; desired.definition_count = 7; desired.auxiliary_bytes_used = 12;
    if (!sb_ldc_metadata_publish(&(sb_ldc_io_t){ .workspace=&s_metadata_workspace.validation, .context=&s_record_fd, .read=file_io_read, .write=file_io_write, .flush=file_io_flush },
                                 state, &desired, s_profile_tables,
                                 (1u << 0) | (1u << 4) | (1u << 20), state)) return false;
    return true;
}

static void update_space_snapshot(void)
{
    struct statvfs vfs;
    uint64_t total = 0, free_bytes = 0;
    if (statvfs(s_mount_point, &vfs) == 0) {
        total = (uint64_t)vfs.f_blocks * vfs.f_frsize;
        free_bytes = (uint64_t)vfs.f_bavail * vfs.f_frsize;
    }
    portENTER_CRITICAL(&s_mux);
    s_total_bytes = total; s_free_bytes = free_bytes;
    portEXIT_CRITICAL(&s_mux);
}

static bool create_recording(const sb_storage_request_t *request, sb_storage_ack_t *ack)
{
    update_space_snapshot();
    uint64_t total=0, free_bytes=0; sb_storage_get_size_snapshot(&total,&free_bytes); (void)total;
    if (!sb_storage_policy_create_space(free_bytes,(uint64_t)CONFIG_SAILBALL_SD_RESERVE_BYTES,
                                        SB_LDC_DATA_OFFSET)) {
        s_record_no_space = true;
        errno=ENOSPC; ack->status=SB_OUT_OF_RANGE; ack->reason=SB_STORAGE_REASON_NO_SPACE;
        return false;
    }
    if (s_record_fd >= 0) { (void)close(s_record_fd); s_record_fd = -1; }
    portENTER_CRITICAL(&s_mux);s_file_active=false;portEXIT_CRITICAL(&s_mux);
    s_file_abandoned = false;
    sb_board_info_t board; sb_board_get_info(&board);
    uint32_t file_seq = request->file_sequence;
    char path[96];
    for (unsigned attempt = 0; attempt < 64; ++attempt, ++file_seq) {
        int n = snprintf(path, sizeof(path), "%s/SB_%08lX_S%08lX_F%08lX.ldc", s_mount_point,
                         (unsigned long)request->boot_id, (unsigned long)request->recorder_session_id,
                         (unsigned long)file_seq);
        if (n <= 0 || (size_t)n >= sizeof(path)) return false;
        s_record_fd = open(path, O_CREAT | O_EXCL | O_RDWR, 0666);
        if (s_record_fd >= 0) break;
        if (errno != EEXIST) return false;
    }
    if (s_record_fd < 0) return false;
    sb_ldc_io_t io = { .context=&s_record_fd, .read=file_io_read, .write=file_io_write, .flush=file_io_flush };
    if (!sb_ldc_metadata_initialize(&io, &s_metadata, request->ldc_file_session_id,
                                    request->device_id ? request->device_id : board.device_id, sb_monotonic_us()) ||
        !publish_gnss_profile(&s_metadata)) {
        s_file_abandoned = true; (void)close(s_record_fd); s_record_fd = -1;
        return false;
    }
    char file_name[64];
    int n = snprintf(file_name, sizeof(file_name), "SB_%08lX_S%08lX_F%08lX.ldc",
                     (unsigned long)request->boot_id, (unsigned long)request->recorder_session_id,
                     (unsigned long)file_seq);
    if (n <= 0 || (size_t)n >= sizeof(file_name)) { (void)close(s_record_fd); s_record_fd=-1; return false; }
    portENTER_CRITICAL(&s_mux);
    s_file_active = true; s_file_abandoned = false; s_readable_size = SB_LDC_DATA_OFFSET;
    memcpy(s_file_name, file_name, sizeof(s_file_name));
    portEXIT_CRITICAL(&s_mux);
    s_record_no_space = false;
    s_record_rollover_pending = false;
    ack->file_sequence = file_seq; ack->readable_size = s_readable_size;
    memcpy(ack->file_name, file_name, sizeof(ack->file_name));
    update_space_snapshot();
    return true;
}

static bool commit_block(const sb_storage_request_t *request, sb_storage_ack_t *ack)
{
    if (!s_file_active || s_file_abandoned || s_record_fd < 0 || request->data == NULL ||
        request->length < 112 || request->length > 8192 ||
        !sb_ldc_block_validate(request->data, request->length, request->block_sequence)) return false;
    update_space_snapshot();
    uint64_t total, free_bytes; sb_storage_get_size_snapshot(&total, &free_bytes); (void)total;
    if (!sb_storage_policy_commit_space(free_bytes,request->length,
                                        (uint64_t)CONFIG_SAILBALL_SD_RESERVE_BYTES)) {
        s_record_no_space = true;
        (void)close(s_record_fd); s_record_fd=-1;
        portENTER_CRITICAL(&s_mux);s_file_active=false;portEXIT_CRITICAL(&s_mux);
        ack->status=SB_OUT_OF_RANGE; ack->reason=SB_STORAGE_REASON_NO_SPACE;
        return false;
    }
    uint64_t target=sb_storage_policy_file_target(total);
    if(sb_storage_policy_rollover(s_readable_size,target,request->length)){
        bool clean=fsync(s_record_fd)==0;
        if(close(s_record_fd)!=0)clean=false;
        s_record_fd=-1;
        portENTER_CRITICAL(&s_mux);s_file_active=false;portEXIT_CRITICAL(&s_mux);
        if(!clean)return false;
        s_record_rollover_pending=true;
        ack->status=SB_ACCEPTED;ack->reason=SB_STORAGE_REASON_SIZE_LIMIT;
        return false;
    }
    if (!sb_ldc_block_commit(&(sb_ldc_commit_io_t){.context=&s_record_fd,.write=block_commit_write,.flush=block_commit_flush},
                             s_readable_size,request->data,request->length,request->block_sequence)) return false;
    sb_diag_add(SB_DIAG_STORAGE, 2, request->length);
    portENTER_CRITICAL(&s_mux);s_readable_size += request->length;uint64_t committed_size=s_readable_size;portEXIT_CRITICAL(&s_mux);
    sb_diag_increment(SB_DIAG_STORAGE, 1);
    sb_diag_add(SB_DIAG_STORAGE, 2, 4);
    ack->status=SB_OK; ack->committed_block_sequence=request->block_sequence; ack->readable_size=committed_size;
    update_space_snapshot();
    return true;
}

static void send_ack(const sb_storage_ack_t *ack)
{
    /* The ack queue is larger than the Recorder pool; full is an invariant failure. */
    if (xQueueSend(s_ack_q, ack, pdMS_TO_TICKS(100)) != pdTRUE) abort();
}

static void abort_epoch(void)
{
    s_file_abandoned = true;
    s_record_no_space = false;
    s_record_rollover_pending = false;
    portENTER_CRITICAL(&s_mux);s_file_active=false;portEXIT_CRITICAL(&s_mux);
    if (s_record_fd >= 0) { (void)close(s_record_fd); s_record_fd = -1; }
    /* Transfer's fd and frozen metadata belong to the failed storage epoch too. */
    if (s_transfer_fd >= 0) { (void)close(s_transfer_fd); s_transfer_fd = -1; }
    s_transfer_open = false; s_transfer_file_name[0] = '\0';
    s_transfer_readable_size = 0; s_transfer_active_file = false;
    memset(s_transfer_metadata, 0, sizeof(s_transfer_metadata));
    portENTER_CRITICAL(&s_mux);
    s_transfer_open_snapshot = false;
    if (++s_epoch_generation == 0u) ++s_epoch_generation;
    s_bulk_publication_active=false;
    s_bulk_publication_active_id=0u;
    portEXIT_CRITICAL(&s_mux);
    sb_storage_request_t pending;
    while (xQueueReceive(s_req_q, &pending, 0) == pdTRUE) {
        sb_storage_ack_t ack = { .op=pending.op, .buffer_id=pending.buffer_id,
            .status=SB_IO_ERROR, .committed_block_sequence=pending.block_sequence };
        critical_request_complete();
        send_ack(&ack);
    }
    fail_rollover_blocks(SB_IO_ERROR, SB_STORAGE_REASON_NONE);
    portENTER_CRITICAL(&s_mux); s_state=SB_STORAGE_ERROR; portEXIT_CRITICAL(&s_mux);
    sb_diag_increment(SB_DIAG_STORAGE, 3);
    (void)sb_diag_raise(4, 2, 2, false, 0);
}

static bool process_critical_request(const sb_storage_request_t *request)
{
    sb_diag_increment(SB_DIAG_STORAGE,0);
    sb_storage_ack_t ack={.op=request->op,.buffer_id=request->buffer_id,
        .status=SB_IO_ERROR,.committed_block_sequence=request->block_sequence};
    sb_storage_state_t state=sb_storage_get_state();
    bool available=state==SB_STORAGE_READY;
    bool ok=false;
    bool retained=false;
    if (available && request->op==SB_STORAGE_OP_CREATE) {
        ok=create_recording(request,&ack);
        if(ok)ack.committed_block_sequence=s_rollover_block_count;
    }
    else if (available && request->op==SB_STORAGE_OP_WRITE_BLOCK) {
        if (s_record_no_space) { ack.status=SB_OUT_OF_RANGE; ack.reason=SB_STORAGE_REASON_NO_SPACE; }
        else if (s_record_rollover_pending) {
            retained=retain_rollover_block(request);
            ok=retained;
            if(retained){ack.status=SB_ACCEPTED;ack.reason=SB_STORAGE_REASON_SIZE_LIMIT;}
        } else {
            ok=commit_block(request,&ack);
            if(!ok&&ack.status==SB_ACCEPTED&&ack.reason==SB_STORAGE_REASON_SIZE_LIMIT){
                retained=retain_rollover_block(request);
                if(!retained)ack.status=SB_IO_ERROR;
            }
        }
    }
    else if (available && request->op==SB_STORAGE_OP_CLOSE) {
        if (s_record_fd>=0) { ok=fsync(s_record_fd)==0; if (close(s_record_fd)!=0) ok=false; s_record_fd=-1; }
        else ok=true;
        portENTER_CRITICAL(&s_mux);s_file_active=false;ack.readable_size=s_readable_size;portEXIT_CRITICAL(&s_mux);
        ack.status=ok?SB_OK:SB_IO_ERROR;
    }
    if (ok && request->op==SB_STORAGE_OP_CREATE) ack.status=SB_OK;
    if (!ok && ack.reason==SB_STORAGE_REASON_NO_SPACE) {
        ack.status=SB_OUT_OF_RANGE;
    } else if (!ok && ack.status!=SB_OUT_OF_RANGE &&
               !(ack.status==SB_ACCEPTED&&ack.reason==SB_STORAGE_REASON_SIZE_LIMIT) &&
               request->op!=SB_STORAGE_OP_CREATE) {
        abort_epoch(); s_retry_at=xTaskGetTickCount()+pdMS_TO_TICKS(STORAGE_RETRY_MS);
    } else if (!ok && request->op==SB_STORAGE_OP_CREATE) {
        if (errno==ENOSPC) { ack.status=SB_OUT_OF_RANGE;ack.reason=SB_STORAGE_REASON_NO_SPACE; }
        else { portENTER_CRITICAL(&s_mux);s_state=SB_STORAGE_ERROR;portEXIT_CRITICAL(&s_mux);s_retry_at=xTaskGetTickCount()+pdMS_TO_TICKS(STORAGE_RETRY_MS);ack.status=SB_IO_ERROR; }
    }
    send_ack(&ack);
    if(request->op==SB_STORAGE_OP_CREATE){
        if(!ok&&s_rollover_block_count!=0u){
            sb_status_t status=ack.reason==SB_STORAGE_REASON_NO_SPACE?SB_OUT_OF_RANGE:SB_IO_ERROR;
            fail_rollover_blocks(status,ack.reason);
        }else if(ok&&s_rollover_block_count!=0u){
            (void)commit_rollover_blocks();
        }
    }
    return !retained;
}

static void storage_task(void *arg)
{
    (void)arg;
    if (esp_task_wdt_add(NULL) != ESP_OK) abort();
    sb_board_info_t board; sb_board_get_info(&board);
    storage_bg_request_t active_background={0}, deferred_background={0};
    bool background_active=false, background_is_high=false, deferred_active=false;
    uint8_t consecutive_critical=0u;
    for (;;) {
        (void)esp_task_wdt_reset();
        sb_validation_note_stack(SB_VALIDATION_TASK_STORAGE,
                                 (uint32_t)uxTaskGetStackHighWaterMark(NULL));
        uint64_t queued=uxQueueMessagesWaiting(s_req_q);
        sb_diag_max(SB_DIAG_STORAGE,6,queued);
        sb_storage_request_t request;
        bool critical_pending=uxQueueMessagesWaiting(s_req_q)!=0u;
        bool background_pending=background_active||deferred_active||
            uxQueueMessagesWaiting(s_bg_high_q)!=0u||uxQueueMessagesWaiting(s_bg_low_q)!=0u;
        bool service_background=sb_storage_policy_service_background(critical_pending,background_pending,
            consecutive_critical,STORAGE_CRITICAL_BURST_MAX);
        if (!service_background &&
            xQueueReceive(s_req_q,&request,background_active?0:pdMS_TO_TICKS(100))==pdTRUE) {
            if(process_critical_request(&request))critical_request_complete();
            if(consecutive_critical<STORAGE_CRITICAL_BURST_MAX)++consecutive_critical;
            continue;
        }
        if(service_background)consecutive_critical=0u;
        else if(!critical_pending)consecutive_critical=0u;
        if (background_active && !background_is_high && !deferred_active &&
            uxQueueMessagesWaiting(s_bg_high_q)!=0) {
            deferred_background=active_background;
            deferred_active=true;
            background_active=false;
        }
        if (!background_active) {
            if (xQueueReceive(s_bg_high_q,&active_background,0)==pdTRUE) {
                background_active=true; background_is_high=true;
            } else if (deferred_active) {
                active_background=deferred_background;
                memset(&deferred_background,0,sizeof(deferred_background));
                deferred_active=false; background_active=true; background_is_high=false;
            } else if (xQueueReceive(s_bg_low_q,&active_background,0)==pdTRUE) {
                background_active=true; background_is_high=false;
            }
        }
        if (background_active) {
            active_background.result=process_background(&active_background);
            if (active_background.result!=SB_ACCEPTED) {
                background_cleanup(&active_background);
                background_request_complete(&active_background);
                if (active_background.waiter!=NULL)
                    sb_rpc_complete(active_background.waiter,(uint32_t)active_background.result);
                memset(&active_background,0,sizeof(active_background));
                background_active=false;
                background_is_high=false;
            } else {
                /* One real scheduler tick; pdMS_TO_TICKS(1) can round to zero. */
                vTaskDelay(1u);
            }
        }
        if (sb_storage_get_state()==SB_STORAGE_READY || sb_storage_get_state()==SB_STORAGE_FORMATTING || xTaskGetTickCount()<s_retry_at) continue;
        portENTER_CRITICAL(&s_mux); s_state=board.sd_configured?SB_STORAGE_MOUNTING:SB_STORAGE_UNAVAILABLE; portEXIT_CRITICAL(&s_mux);
        if (board.sd_configured && mount_sd()) {
            portENTER_CRITICAL(&s_mux); s_state=SB_STORAGE_READY; portEXIT_CRITICAL(&s_mux);
            s_retry_at=xTaskGetTickCount()+pdMS_TO_TICKS(STORAGE_RETRY_MS);
        } else {
            unmount_sd();
            portENTER_CRITICAL(&s_mux); s_state=board.sd_configured?SB_STORAGE_ERROR:SB_STORAGE_UNAVAILABLE; portEXIT_CRITICAL(&s_mux);
            if (board.sd_configured) (void)sb_diag_raise(4,1,1,false,0);
            s_retry_at=xTaskGetTickCount()+pdMS_TO_TICKS(STORAGE_RETRY_MS);
        }
    }
}

esp_err_t sb_storage_start(void)
{
    if (s_req_q!=NULL) return ESP_OK;
    s_req_q=xQueueCreateStatic(STORAGE_QUEUE_DEPTH,sizeof(sb_storage_request_t),s_req_q_data,&s_req_q_struct);
    s_ack_q=xQueueCreateStatic(STORAGE_ACK_DEPTH,sizeof(sb_storage_ack_t),s_ack_q_data,&s_ack_q_struct);
    s_bg_high_q=xQueueCreateStatic(STORAGE_BACKGROUND_HIGH_QUEUE_DEPTH,sizeof(storage_bg_request_t),s_bg_high_q_data,&s_bg_high_q_struct);
    s_bg_low_q=xQueueCreateStatic(STORAGE_BACKGROUND_LOW_QUEUE_DEPTH,sizeof(storage_bg_request_t),s_bg_low_q_data,&s_bg_low_q_struct);
    if (s_req_q==NULL||s_ack_q==NULL||s_bg_high_q==NULL||s_bg_low_q==NULL) return ESP_ERR_NO_MEM;
    if (xTaskCreateStatic(storage_task,"storage_task",STORAGE_STACK_WORDS,NULL,7,s_stack,&s_task_struct)==NULL) return ESP_ERR_NO_MEM;
    return ESP_OK;
}

sb_storage_state_t sb_storage_get_state(void)
{
    portENTER_CRITICAL(&s_mux); sb_storage_state_t state=s_state; portEXIT_CRITICAL(&s_mux); return state;
}

bool sb_storage_submit(const sb_storage_request_t *request)
{
    if(request==NULL||s_req_q==NULL)return false;
    portENTER_CRITICAL(&s_mux);
    if(s_state==SB_STORAGE_FORMATTING||s_critical_outstanding==UINT32_MAX){
        portEXIT_CRITICAL(&s_mux);
        return false;
    }
    ++s_critical_outstanding;
    portEXIT_CRITICAL(&s_mux);
    if(xQueueSend(s_req_q,request,0)==pdTRUE)return true;
    critical_request_complete();
    return false;
}

bool sb_storage_create_recording(uint32_t boot_id,uint32_t session,uint32_t file_sequence,
                                 uint64_t device_id,const uint8_t file_session_id[16])
{
    if(file_session_id==NULL)return false;
    sb_storage_request_t request={.op=SB_STORAGE_OP_CREATE,.buffer_id=UINT8_MAX,
        .boot_id=boot_id,.recorder_session_id=session,.file_sequence=file_sequence,.device_id=device_id};
    memcpy(request.ldc_file_session_id,file_session_id,16);
    return sb_storage_submit(&request);
}

bool sb_storage_submit_block(uint8_t buffer_id,uint32_t sequence,uint8_t *data,size_t length)
{
    sb_storage_request_t request={.op=SB_STORAGE_OP_WRITE_BLOCK,.buffer_id=buffer_id,
        .block_sequence=sequence,.data=data,.length=length};
    return sb_storage_submit(&request);
}

bool sb_storage_close_recording(void)
{
    sb_storage_request_t request={.op=SB_STORAGE_OP_CLOSE,.buffer_id=UINT8_MAX};
    return sb_storage_submit(&request);
}

bool sb_storage_try_ack(sb_storage_ack_t *ack)
{
    return ack!=NULL&&s_ack_q!=NULL&&xQueueReceive(s_ack_q,ack,0)==pdTRUE;
}

void sb_storage_get_size_snapshot(uint64_t *total_bytes,uint64_t *free_bytes)
{
    portENTER_CRITICAL(&s_mux);if(total_bytes)*total_bytes=s_total_bytes;if(free_bytes)*free_bytes=s_free_bytes;portEXIT_CRITICAL(&s_mux);
}

void sb_storage_get_file_snapshot(char file_name[64],uint64_t *readable_size,bool *active)
{
    portENTER_CRITICAL(&s_mux);if(file_name)memcpy(file_name,s_file_name,64);if(readable_size)*readable_size=s_readable_size;if(active)*active=s_file_active;portEXIT_CRITICAL(&s_mux);
}

static sb_status_t run_named_background(storage_bg_op_t op, const char *file_name, sb_storage_file_info_t *info)
{
    if (file_name == NULL) return SB_INVALID_REQUEST;
    storage_bg_request_t request = { .op=op, .file_info_out=info };
    size_t n = strnlen(file_name, sizeof(request.file_name));
    if (n == 0 || n >= sizeof(request.file_name)) return SB_OUT_OF_RANGE;
    memcpy(request.file_name, file_name, n + 1u);
    return run_background(&request);
}

sb_status_t sb_storage_list_files(uint32_t offset, uint8_t limit, sb_storage_file_info_t *entries,
                                  size_t capacity, size_t *count, uint32_t *next_offset, bool *complete)
{
    if (entries == NULL || count == NULL || next_offset == NULL || complete == NULL || limit == 0 ||
        limit > SB_STORAGE_LIST_MAX || limit > capacity || offset > UINT32_MAX - limit) return SB_INVALID_REQUEST;
    *count = 0; *next_offset = offset; *complete = true;
    storage_bg_request_t request = { .op=STORAGE_BG_LIST, .list_offset=offset, .list_limit=limit,
        .entries_out=entries, .entries_capacity=capacity, .entry_count_out=count,
        .next_offset_out=next_offset, .complete_out=complete };
    return run_background(&request);
}

sb_status_t sb_storage_get_file_info(const char *file_name, sb_storage_file_info_t *info)
{
    if (info == NULL) return SB_INVALID_REQUEST;
    memset(info, 0, sizeof(*info));
    return run_named_background(STORAGE_BG_INFO, file_name, info);
}

sb_status_t sb_storage_delete_file(const char *file_name)
{
    return run_named_background(STORAGE_BG_DELETE, file_name, NULL);
}

sb_status_t sb_storage_request_format(void)
{
    storage_bg_request_t request = { .op=STORAGE_BG_FORMAT };
    if (s_bg_low_q == NULL) return SB_INVALID_STATE;
    portENTER_CRITICAL(&s_mux);
    if (!sb_storage_policy_can_format(s_state==SB_STORAGE_READY,s_file_active,s_transfer_open_snapshot,
                                     s_critical_outstanding,s_background_outstanding) ||
        s_background_outstanding==UINT32_MAX) {
        sb_storage_state_t state=s_state;
        portEXIT_CRITICAL(&s_mux);
        return state==SB_STORAGE_READY?SB_BUSY:SB_INVALID_STATE;
    }
    s_state = SB_STORAGE_FORMATTING;
    ++s_background_outstanding;
    request.counted=true;
    portEXIT_CRITICAL(&s_mux);
    if (xQueueSend(s_bg_low_q, &request, 0) != pdTRUE) {
        background_request_complete(&request);
        portENTER_CRITICAL(&s_mux); if(s_state==SB_STORAGE_FORMATTING)s_state = SB_STORAGE_READY; portEXIT_CRITICAL(&s_mux);
        return SB_BUSY;
    }
    return SB_ACCEPTED;
}

sb_status_t sb_storage_transfer_open(const char *file_name,uint64_t *readable_size,bool *active)
{
    if(file_name==NULL||readable_size==NULL||active==NULL)return SB_INVALID_REQUEST;
    storage_bg_request_t request={.op=STORAGE_BG_OPEN,.readable_size_out=readable_size,.active_out=active};
    size_t n=strnlen(file_name,sizeof(request.file_name));if(n==0||n>=sizeof(request.file_name))return SB_OUT_OF_RANGE;
    memcpy(request.file_name,file_name,n+1u);
    sb_status_t status=run_background(&request);
    return status;
}

sb_status_t sb_storage_transfer_read(uint64_t offset,uint32_t length,uint8_t *out,size_t capacity,uint32_t *actual)
{
    if(actual)*actual=0;
    storage_bg_request_t request={.op=STORAGE_BG_READ,.offset=offset,.length=length,.out=out,.capacity=capacity,.actual_out=actual};
    return run_background(&request);
}

sb_status_t sb_storage_transfer_close(void)
{
    storage_bg_request_t request={.op=STORAGE_BG_CLOSE};
    return run_background(&request);
}

bool sb_storage_transfer_close_async(void)
{
    storage_bg_request_t request = { .op=STORAGE_BG_CLOSE };
    if(s_bg_high_q==NULL)return false;
    portENTER_CRITICAL(&s_mux);
    if(s_state!=SB_STORAGE_READY||s_background_outstanding==UINT32_MAX){portEXIT_CRITICAL(&s_mux);return false;}
    ++s_background_outstanding;request.counted=true;
    portEXIT_CRITICAL(&s_mux);
    if(xQueueSend(s_bg_high_q,&request,0)==pdTRUE)return true;
    background_request_complete(&request);
    return false;
}

static bool retain_rollover_block(const sb_storage_request_t *request)
{
    if (s_rollover_block_count >= SB_RECORDER_BLOCK_POOL_COUNT) return false;
    s_rollover_blocks[s_rollover_block_count++] = *request;
    return true;
}

static void fail_rollover_blocks(sb_status_t status, sb_storage_reason_t reason)
{
    while (s_rollover_block_count != 0u) {
        sb_storage_request_t request = s_rollover_blocks[0];
        --s_rollover_block_count;
        if (s_rollover_block_count != 0u)
            memmove(s_rollover_blocks, s_rollover_blocks + 1,
                    (size_t)s_rollover_block_count * sizeof(s_rollover_blocks[0]));
        sb_storage_ack_t ack = { .op=SB_STORAGE_OP_WRITE_BLOCK, .buffer_id=request.buffer_id,
            .status=status, .reason=reason, .committed_block_sequence=request.block_sequence };
        critical_request_complete();
        send_ack(&ack);
    }
    s_record_rollover_pending = false;
}

static bool commit_rollover_blocks(void)
{
    uint32_t sequence = 0u;
    while (s_rollover_block_count != 0u) {
        sb_storage_request_t request = s_rollover_blocks[0];
        --s_rollover_block_count;
        if (s_rollover_block_count != 0u)
            memmove(s_rollover_blocks, s_rollover_blocks + 1,
                    (size_t)s_rollover_block_count * sizeof(s_rollover_blocks[0]));
        request.block_sequence = sequence++;
        if (!sb_ldc_block_set_sequence(request.data, request.length, request.block_sequence)) {
            sb_storage_ack_t ack = { .op=SB_STORAGE_OP_WRITE_BLOCK, .buffer_id=request.buffer_id,
                .status=SB_IO_ERROR, .committed_block_sequence=request.block_sequence };
            critical_request_complete(); send_ack(&ack); abort_epoch(); return false;
        }
        sb_storage_ack_t ack = { .op=SB_STORAGE_OP_WRITE_BLOCK, .buffer_id=request.buffer_id,
            .status=SB_IO_ERROR, .committed_block_sequence=request.block_sequence };
        bool ok = commit_block(&request, &ack);
        critical_request_complete();
        if (!ok) {
            send_ack(&ack);
            if (ack.reason == SB_STORAGE_REASON_NO_SPACE)
                fail_rollover_blocks(SB_OUT_OF_RANGE, SB_STORAGE_REASON_NO_SPACE);
            else
                abort_epoch();
            return false;
        }
        send_ack(&ack);
    }
    return true;
}

bool sb_storage_transfer_is_active(void)
{
    portENTER_CRITICAL(&s_mux); bool active = s_transfer_open_snapshot; portEXIT_CRITICAL(&s_mux);
    return active;
}

uint32_t sb_storage_epoch_generation(void)
{
    portENTER_CRITICAL(&s_mux); uint32_t generation = s_epoch_generation; portEXIT_CRITICAL(&s_mux);
    return generation;
}

bool sb_storage_claim_bulk_publication(uint32_t epoch,uint64_t *claim_id)
{
    /* The storage epoch transition and transport's ownership handoff share this
     * one short critical section. Winning this claim is the publication
     * linearization point; no physical operation occurs while the lock is held. */
    portENTER_CRITICAL(&s_mux);
    bool current = claim_id != NULL && epoch == s_epoch_generation && !s_bulk_publication_active;
    if(current){
        if(++s_bulk_publication_next_id==0u)++s_bulk_publication_next_id;
        s_bulk_publication_active_id=s_bulk_publication_next_id;
        s_bulk_publication_active=true;
        *claim_id=s_bulk_publication_active_id;
    }
    portEXIT_CRITICAL(&s_mux);
    return current;
}

bool sb_storage_finish_bulk_publication(uint32_t epoch,uint64_t claim_id)
{
    portENTER_CRITICAL(&s_mux);
    bool valid=epoch==s_epoch_generation&&s_bulk_publication_active&&claim_id!=0u&&
               claim_id==s_bulk_publication_active_id;
    if(valid){s_bulk_publication_active=false;s_bulk_publication_active_id=0u;}
    portEXIT_CRITICAL(&s_mux);
    return valid;
}

void sb_storage_release_bulk_publication(uint32_t epoch,uint64_t claim_id)
{
    portENTER_CRITICAL(&s_mux);
    if(epoch==s_epoch_generation&&s_bulk_publication_active&&claim_id!=0u&&
       claim_id==s_bulk_publication_active_id){
        s_bulk_publication_active=false;
        s_bulk_publication_active_id=0u;
    }
    portEXIT_CRITICAL(&s_mux);
}
