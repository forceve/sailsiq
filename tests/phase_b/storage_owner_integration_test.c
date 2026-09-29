#include <assert.h>
#include <errno.h>
#include <fcntl.h>
#include <setjmp.h>
#include <stdarg.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "esp_task_wdt.h"
#include "sailball/board.h"
#include "sailball/diagnostics.h"
#include "sailball/ldc.h"
#include "sailball/storage.h"
#include "sailball/validation.h"
#include "fakes/unistd.h"
#include "fakes/sys/stat.h"

/* Include the entire production Storage owner; the fake layer below only supplies
 * FreeRTOS, SD mount, and POSIX filesystem operations. */
#include "../../components/sailball_storage/src/storage.c"

typedef struct { char name[96]; uint8_t bytes[131072]; size_t length; bool exists; } fake_file_t;
typedef struct { int file; size_t position; bool open; } fake_fd_t;
static fake_file_t s_files[12];
static fake_fd_t s_fds[20];
static unsigned s_file_count,s_open_count,s_close_count,s_write_count,s_sync_count;
static unsigned s_fail_write_at,s_fail_sync_at,s_fail_mount_count,s_fail_open_count,s_mount_count;
static uint64_t s_total_bytes=UINT64_C(524288),s_free_bytes=UINT64_C(524288);
static struct sdmmc_card s_fake_card;
static uint64_t s_now_us=UINT64_C(1000000);
struct fake_dir { unsigned index; struct dirent entry; };
static struct fake_dir s_dir;
typedef struct { StaticQueue_t *identity; uint8_t *data; unsigned depth,size,head,count; } fake_queue_t;
#ifdef SB_FOUR_OWNER_TEST
static fake_queue_t s_queues[24];
#else
static fake_queue_t s_queues[12];
#endif
static size_t s_queue_count;
static void (*s_task_entry)(void *);
static jmp_buf s_owner_stop;
static bool s_stop_when_idle;
static unsigned s_owner_steps,s_bg_yields,s_critical_serviced,s_completed_background;
static unsigned s_critical_at_background_completion;
static bool s_inject_critical_during_background;
static uint8_t s_injected_block[112];
static uint32_t s_injected_sequence=5u;
static uint64_t s_injected_start=UINT64_C(11000000);
static struct fake_task s_waiter;
#ifdef SB_THREE_OWNER_TEST
static struct fake_task s_recorder_handle,s_transfer_handle,s_caller_handle;
static TaskHandle_t s_current_handle=&s_caller_handle;
static void (*s_recorder_entry)(void *),(*s_transfer_entry)(void *);
static void (*s_wait_pump)(void);
static jmp_buf s_recorder_yield;
static bool s_running_recorder;
static uint64_t s_recorder_lost,s_recorder_committed;
static uint64_t s_recorder_blocks_completed,s_recorder_buffer_exhaustions;
static unsigned s_recorder_consumed;
#ifdef SB_FOUR_OWNER_TEST
static void (*s_control_entry)(void *),(*s_transport_entry)(void *);
static jmp_buf s_foreground_yield;
static bool s_running_foreground;
#endif
#endif
static void make_block(uint8_t block[112],uint32_t sequence,uint64_t start);

int fake_open(const char *path,int flags,...)
{
    if ((flags&O_CREAT)&&s_fail_open_count) {
        --s_fail_open_count;errno=EIO;return -1;
    }
    int file=-1;
    for(unsigned i=0;i<s_file_count;++i)if(s_files[i].exists&&strcmp(s_files[i].name,path)==0){file=(int)i;break;}
    if(file>=0&&(flags&O_CREAT)&&(flags&O_EXCL)){errno=EEXIST;return -1;}
    if(file<0){if(!(flags&O_CREAT)){errno=ENOENT;return -1;}assert(s_file_count<12u);file=(int)s_file_count++;
        memset(&s_files[file],0,sizeof(s_files[file]));strcpy(s_files[file].name,path);s_files[file].exists=true;}
    for(unsigned fd=3;fd<20u;++fd)if(!s_fds[fd].open){s_fds[fd]=(fake_fd_t){file,0u,true};++s_open_count;return (int)fd;}
    errno=EMFILE;return -1;
}
ssize_t fake_write(int fd,const void *data,size_t size)
{
    assert(fd>=3&&fd<20&&s_fds[fd].open);if(++s_write_count==s_fail_write_at){errno=EIO;return -1;}
    fake_fd_t *handle=&s_fds[fd];fake_file_t *file=&s_files[handle->file];
    if(handle->position+size>sizeof(file->bytes)){errno=ENOSPC;return -1;}
    memcpy(file->bytes+handle->position,data,size);handle->position+=size;
    if(handle->position>file->length)file->length=handle->position;return (ssize_t)size;
}
ssize_t fake_read(int fd,void *data,size_t size)
{
    assert(fd>=3&&fd<20&&s_fds[fd].open);fake_fd_t *handle=&s_fds[fd];fake_file_t *file=&s_files[handle->file];
    if(handle->position>=file->length)return 0;
    if(size>file->length-handle->position)size=file->length-handle->position;
    memcpy(data,file->bytes+handle->position,size);handle->position+=size;return (ssize_t)size;
}
off_t fake_lseek(int fd,off_t offset,int whence)
{
    assert(fd>=3&&fd<20&&s_fds[fd].open);fake_fd_t *handle=&s_fds[fd];
    off_t origin=whence==SEEK_SET?0:whence==SEEK_CUR?(off_t)handle->position:(off_t)s_files[handle->file].length;
    if(origin+offset<0||origin+offset>=131072){errno=EINVAL;return -1;}
    handle->position=(size_t)(origin+offset);return origin+offset;
}
int fake_fsync(int fd){assert(fd>=3&&fd<20&&s_fds[fd].open);if(++s_sync_count==s_fail_sync_at){errno=EIO;return -1;}return 0;}
int fake_close(int fd){assert(fd>=3&&fd<20&&s_fds[fd].open);s_fds[fd].open=false;++s_close_count;return 0;}
int fake_unlink(const char *path)
{for(unsigned i=0;i<s_file_count;++i)if(s_files[i].exists&&strcmp(s_files[i].name,path)==0){s_files[i].exists=false;return 0;}errno=ENOENT;return -1;}
int fake_fstat(int fd,struct stat *out)
{assert(fd>=3&&fd<20&&s_fds[fd].open);out->st_size=(long long)s_files[s_fds[fd].file].length;return 0;}
int statvfs(const char *path,struct statvfs *out)
{(void)path;out->f_frsize=512u;out->f_blocks=s_total_bytes/512u;out->f_bavail=s_free_bytes/512u;return 0;}
DIR *opendir(const char *path){(void)path;memset(&s_dir,0,sizeof(s_dir));return (DIR *)&s_dir;}
struct dirent *readdir(DIR *dir)
{struct fake_dir *d=(struct fake_dir *)dir;while(d->index<s_file_count){fake_file_t *f=&s_files[d->index++];if(!f->exists)continue;
    const char *name=strrchr(f->name,'/');strcpy(d->entry.d_name,name?name+1:f->name);return &d->entry;}return NULL;}
int closedir(DIR *dir){(void)dir;return 0;}
esp_err_t spi_bus_initialize(int host,const spi_bus_config_t *config,int dma)
{(void)host;(void)config;(void)dma;return ESP_OK;}
esp_err_t spi_bus_free(int host){(void)host;return ESP_OK;}
esp_err_t esp_vfs_fat_sdspi_mount(const char *path,const sdmmc_host_t *host,const sdspi_device_config_t *slot,
                                  const esp_vfs_fat_sdmmc_mount_config_t *config,sdmmc_card_t **card)
{(void)path;(void)host;(void)slot;(void)config;++s_mount_count;if(s_fail_mount_count){--s_fail_mount_count;return ESP_FAIL;}
    *card=&s_fake_card;return ESP_OK;}
esp_err_t esp_vfs_fat_sdcard_unmount(const char *path,sdmmc_card_t *card)
{(void)path;(void)card;return ESP_OK;}
esp_err_t esp_vfs_fat_sdcard_format(const char *path,sdmmc_card_t *card)
{(void)path;(void)card;return ESP_OK;}

static fake_queue_t *find_queue(QueueHandle_t id)
{for(size_t i=0;i<s_queue_count;++i)if(s_queues[i].identity==id)return &s_queues[i];assert(0);return NULL;}
QueueHandle_t xQueueCreateStatic(unsigned depth,unsigned size,uint8_t *data,StaticQueue_t *identity)
{assert(s_queue_count<sizeof(s_queues)/sizeof(s_queues[0]));s_queues[s_queue_count++]=(fake_queue_t){identity,data,depth,size,0u,0u};return identity;}
int xQueueSend(QueueHandle_t id,const void *item,TickType_t ticks)
{(void)ticks;fake_queue_t *q=find_queue(id);if(q->count==q->depth)return pdFALSE;
    memcpy(q->data+(size_t)((q->head+q->count)%q->depth)*q->size,item,q->size);++q->count;return pdTRUE;}
int xQueueReceive(QueueHandle_t id,void *out,TickType_t ticks)
{fake_queue_t *q=find_queue(id);
    if(s_stop_when_idle&&id==s_req_q&&s_completed_background&&s_critical_outstanding==0u&&
       s_background_outstanding==0u)longjmp(s_owner_stop,1);
    if(!q->count){
#ifdef SB_FOUR_OWNER_TEST
        if(s_running_foreground&&ticks!=0u)longjmp(s_foreground_yield,1);
#else
        (void)ticks;
#endif
        return pdFALSE;
    }
    memcpy(out,q->data+(size_t)q->head*q->size,q->size);
    q->head=(q->head+1u)%q->depth;--q->count;return pdTRUE;}
unsigned uxQueueMessagesWaiting(QueueHandle_t id){return find_queue(id)->count;}
unsigned uxQueueSpacesAvailable(QueueHandle_t id){fake_queue_t *q=find_queue(id);return q->depth-q->count;}
#ifdef SB_FOUR_OWNER_TEST
int xQueuePeek(QueueHandle_t id,void *out,TickType_t ticks)
{(void)ticks;fake_queue_t *q=find_queue(id);if(!q->count)return pdFALSE;
    memcpy(out,q->data+(size_t)q->head*q->size,q->size);return pdTRUE;}
int xQueueReset(QueueHandle_t id)
{fake_queue_t *q=find_queue(id);q->head=q->count=0u;return pdTRUE;}
int xQueueOverwrite(QueueHandle_t id,const void *item)
{fake_queue_t *q=find_queue(id);assert(q->depth==1u);memcpy(q->data,item,q->size);q->head=0u;q->count=1u;return pdTRUE;}
#endif
TaskHandle_t xTaskCreateStatic(void (*entry)(void *),const char *name,unsigned words,void *arg,
                               unsigned priority,StackType_t *stack,StaticTask_t *state)
{
    (void)words;(void)arg;(void)priority;(void)stack;(void)state;
#ifdef SB_THREE_OWNER_TEST
    if(strcmp(name,"recorder_task")==0){s_recorder_entry=entry;return &s_recorder_handle;}
    if(strcmp(name,"transfer_task")==0){s_transfer_entry=entry;return &s_transfer_handle;}
#ifdef SB_FOUR_OWNER_TEST
    if(strcmp(name,"control_task")==0){s_control_entry=entry;return &s_caller_handle;}
    if(strcmp(name,"transport_task")==0){s_transport_entry=entry;return &s_caller_handle;}
#endif
#endif
    assert(strcmp(name,"storage_task")==0);s_task_entry=entry;return &s_waiter;
}
TaskHandle_t xTaskGetCurrentTaskHandle(void){
#ifdef SB_THREE_OWNER_TEST
    return s_current_handle;
#else
    return &s_waiter;
#endif
}
unsigned uxTaskGetStackHighWaterMark(TaskHandle_t task){(void)task;return 1024u;}
TickType_t xTaskGetTickCount(void){return (TickType_t)(s_now_us/1000u);}
void vTaskDelay(TickType_t ticks)
{
    s_now_us+=(uint64_t)ticks*1000u;++s_bg_yields;
#ifdef SB_THREE_OWNER_TEST
    if(s_running_recorder)longjmp(s_recorder_yield,1);
#ifdef SB_FOUR_OWNER_TEST
    if(s_running_foreground)longjmp(s_foreground_yield,1);
#endif
#endif
    if(s_inject_critical_during_background){
        s_inject_critical_during_background=false;
        make_block(s_injected_block,s_injected_sequence,s_injected_start);
        assert(sb_storage_submit_block((uint8_t)(SB_RECORDER_BLOCK_POOL_COUNT-1u),
                                       s_injected_sequence,s_injected_block,112u));
    }
}
int xTaskNotifyIndexed(TaskHandle_t task,unsigned index,uint32_t value,int mode)
{(void)mode;assert(index==1u&&task!=NULL);task->value[index]=value;task->pending[index]=1;
    s_critical_at_background_completion=s_critical_serviced;++s_completed_background;return pdTRUE;}
int xTaskNotifyWaitIndexed(unsigned index,uint32_t a,uint32_t b,uint32_t *value,TickType_t ticks)
{
    (void)a;(void)b;(void)ticks;
#ifdef SB_THREE_OWNER_TEST
    TaskHandle_t waiter=s_current_handle;
    for(unsigned attempt=0;!waiter->pending[index]&&attempt<100u;++attempt) {
        if(s_wait_pump==NULL)return pdFALSE;
        s_wait_pump();
    }
    if(!waiter->pending[index])return pdFALSE;
    *value=waiter->value[index];waiter->pending[index]=0;return pdTRUE;
#else
    if(!s_waiter.pending[index])return pdFALSE;
    *value=s_waiter.value[index];s_waiter.pending[index]=0;return pdTRUE;
#endif
}
esp_err_t esp_task_wdt_add(void *task){(void)task;return ESP_OK;}
esp_err_t esp_task_wdt_reset(void){return ESP_OK;}
void sb_board_get_info(sb_board_info_t *info){memset(info,0,sizeof(*info));info->sd_configured=true;info->device_id=7u;info->boot_id=7u;
#ifdef SB_FOUR_OWNER_TEST
    info->hardware_revision="fake";
#endif
}
uint64_t sb_monotonic_us(void){return s_now_us;}
void sb_diag_increment(sb_diag_group_t group,unsigned counter)
{
    if(group==SB_DIAG_STORAGE&&counter==0u)++s_critical_serviced;
#ifdef SB_THREE_OWNER_TEST
    if(group==SB_DIAG_RECORDER&&counter==0u)++s_recorder_consumed;
    if(group==SB_DIAG_RECORDER&&counter==3u)++s_recorder_blocks_completed;
    if(group==SB_DIAG_RECORDER&&counter==4u)++s_recorder_buffer_exhaustions;
#endif
}
void sb_diag_add(sb_diag_group_t group,unsigned counter,uint64_t amount)
{
#ifdef SB_THREE_OWNER_TEST
    if(group==SB_DIAG_RECORDER&&counter==2u)s_recorder_lost+=amount;
    if(group==SB_DIAG_RECORDER&&counter==1u)s_recorder_committed+=amount;
#else
    (void)group;(void)counter;(void)amount;
#endif
}
void sb_diag_max(sb_diag_group_t group,unsigned counter,uint64_t value)
{(void)group;(void)counter;(void)value;}
uint32_t sb_diag_raise(uint16_t service,uint16_t code,uint8_t severity,bool utc,int64_t when)
{(void)service;(void)code;(void)severity;(void)utc;(void)when;return 1u;}
void sb_validation_note_stack(sb_validation_task_t task,uint32_t mark){(void)task;(void)mark;}

static void owner_process_one(void)
{sb_storage_request_t request;assert(xQueueReceive(s_req_q,&request,0)==pdTRUE);
    if(process_critical_request(&request))critical_request_complete();}
static sb_storage_ack_t next_ack(void)
{sb_storage_ack_t ack;assert(sb_storage_try_ack(&ack));return ack;}
static void make_block(uint8_t block[112],uint32_t sequence,uint64_t start)
{
    sb_ldc_block_header_t header={.block_sequence=sequence,.block_length=112,.start_mono_us=start,
        .sample_rate_num=1,.sample_rate_den=1,.nominal_slots=1,.valid_slots=1,
        .payload_offset=SB_LDC_BLOCK_HEADER_SIZE,.time_accuracy_us=UINT32_MAX,.duration_us=1000000};
    memset(block,0,112);assert(sb_ldc_header_encode(&header,block));
    uint8_t *footer=block+96;sb_write_le32(footer,sb_crc32c(block,96));sb_write_le32(footer+4,112);
    sb_write_le32(footer+8,sequence);memcpy(footer+12,"LDCM",4);
    assert(sb_ldc_block_validate(block,112,sequence));
}
static sb_storage_ack_t create_file(uint32_t session,uint32_t sequence)
{
    uint8_t id[16]={1u};sb_write_le32(id+4u,session);sb_write_le32(id+8u,sequence);
    assert(sb_storage_create_recording(7u,session,sequence,9u,id));owner_process_one();
    sb_storage_ack_t ack=next_ack();assert(ack.op==SB_STORAGE_OP_CREATE);
    if(ack.status==SB_OK){
        assert(s_metadata.field_count==7u&&s_metadata.definition_count==7u);
        assert(s_metadata.auxiliary_bytes_used==12u);
    }
    return ack;
}
static sb_storage_ack_t commit(uint8_t buffer,uint32_t sequence,uint64_t start)
{static uint8_t blocks[SB_RECORDER_BLOCK_POOL_COUNT][112];assert(buffer<SB_RECORDER_BLOCK_POOL_COUNT);make_block(blocks[buffer],sequence,start);
    assert(sb_storage_submit_block(buffer,sequence,blocks[buffer],112u));owner_process_one();return next_ack();}
static void test_abort_and_recovery(void)
{
    assert(create_file(1u,0u).status==SB_OK);char first_name[64];strcpy(first_name,s_file_name);
    storage_bg_request_t open_request={.op=STORAGE_BG_OPEN};strcpy(open_request.file_name,first_name);
    assert(process_background(&open_request)==SB_OK);assert(s_transfer_open&&s_transfer_fd>=0);
    uint32_t before=sb_storage_epoch_generation();int old_transfer_fd=s_transfer_fd;
    uint8_t late_output[8]={0xA5u};uint32_t late_actual=UINT32_MAX;
    storage_bg_request_t pending_read={.op=STORAGE_BG_READ,.offset=0u,.length=8u,
        .out=late_output,.capacity=sizeof(late_output),.actual_out=&late_actual,.waiter=&s_waiter,.counted=true};
    ++s_background_outstanding;
    assert(xQueueSend(s_bg_high_q,&pending_read,0)==pdTRUE);
    s_fail_sync_at=s_sync_count+1u;
    static uint8_t block[112];make_block(block,0u,UINT64_C(2000000));
    assert(sb_storage_submit_block(0u,0u,block,112u));owner_process_one();
    sb_storage_ack_t ack=next_ack();assert(ack.status==SB_IO_ERROR&&sb_storage_get_state()==SB_STORAGE_ERROR);
    assert(sb_storage_epoch_generation()!=before&&!sb_storage_transfer_is_active());
    assert(!s_fds[old_transfer_fd].open&&s_record_fd<0&&s_transfer_fd<0);
    storage_bg_request_t read_request={.op=STORAGE_BG_READ,.out=block,.capacity=112u,.length=1u};
    assert(process_background(&read_request)==SB_IO_ERROR); /* epoch is unavailable */
    s_stop_when_idle=true;
    if(setjmp(s_owner_stop)==0)s_task_entry(NULL);
    s_stop_when_idle=false;
    uint32_t completion=UINT32_MAX;
    assert(xTaskNotifyWaitIndexed(SB_RPC_COMPLETION_INDEX,0u,UINT32_MAX,&completion,0u)==pdTRUE);
    assert(completion==SB_IO_ERROR&&late_actual==UINT32_MAX&&late_output[0]==0xA5u);
    s_fail_sync_at=0u;s_fail_mount_count=1u;s_retry_at=0u;
    assert(!mount_sd());assert(mount_sd());
    s_state=SB_STORAGE_READY;
    assert(create_file(2u,0u).status==SB_OK);assert(strcmp(first_name,s_file_name)!=0);
    assert(commit(0u,0u,UINT64_C(3000000)).status==SB_OK);
    storage_bg_request_t new_open={.op=STORAGE_BG_OPEN};strcpy(new_open.file_name,s_file_name);
    assert(process_background(&new_open)==SB_OK&&s_transfer_open);
    printf("PASS production Storage epoch abort: transfer invalidation, closed handles, failed mount then new epoch/session\n");
}
static void test_rollover_and_space(void)
{
    storage_bg_request_t close_transfer={.op=STORAGE_BG_CLOSE};assert(process_background(&close_transfer)==SB_OK);
    uint8_t prior_file_id[16];memcpy(prior_file_id,s_metadata.ldc_file_session_id,16u);
    unsigned previous_files=s_file_count;
    storage_bg_request_t rollover_transfer={.op=STORAGE_BG_OPEN};
    strcpy(rollover_transfer.file_name,s_file_name);
    assert(process_background(&rollover_transfer)==SB_OK&&s_transfer_open);
    int rollover_transfer_fd=s_transfer_fd;
    uint32_t rollover_epoch=sb_storage_epoch_generation();
    s_total_bytes=UINT64_C(66560);s_readable_size=sb_storage_policy_file_target(s_total_bytes)-100u;
    static uint8_t queued_rollover[3][112];
    for(unsigned i=0;i<3u;++i)make_block(queued_rollover[i],1u+i,UINT64_C(4000000)+i*UINT64_C(100000));
    assert(sb_storage_submit_block(0u,1u,queued_rollover[0],112u));owner_process_one();
    sb_storage_ack_t ack=next_ack();assert(ack.status==SB_ACCEPTED&&ack.reason==SB_STORAGE_REASON_SIZE_LIMIT);
    for(unsigned i=1u;i<3u;++i){
        assert(sb_storage_submit_block((uint8_t)i,1u+i,queued_rollover[i],112u));owner_process_one();
        ack=next_ack();assert(ack.status==SB_ACCEPTED&&ack.reason==SB_STORAGE_REASON_SIZE_LIMIT);
    }
    uint8_t new_id[16]={9u};
    assert(sb_storage_create_recording(7u,2u,1u,9u,new_id));owner_process_one();
    ack=next_ack();assert(ack.op==SB_STORAGE_OP_CREATE&&ack.status==SB_OK&&ack.file_sequence==1u&&
                          ack.committed_block_sequence==3u);
    for(uint32_t sequence=0;sequence<3u;++sequence){
        ack=next_ack();assert(ack.op==SB_STORAGE_OP_WRITE_BLOCK&&ack.status==SB_OK&&
                              ack.committed_block_sequence==sequence);
        assert(sb_ldc_block_validate(queued_rollover[sequence],112u,sequence));
    }
    assert(sb_storage_get_state()==SB_STORAGE_READY&&sb_storage_epoch_generation()==rollover_epoch);
    assert(s_transfer_open&&s_transfer_fd==rollover_transfer_fd&&s_fds[rollover_transfer_fd].open);
    assert(s_file_count==previous_files+1u&&memcmp(prior_file_id,s_metadata.ldc_file_session_id,16u)!=0);
    assert(s_readable_size==SB_LDC_DATA_OFFSET+336u);
    assert(sb_read_le32(s_files[s_fds[s_record_fd].file].bytes+SB_LDC_DATA_OFFSET+8u)==0u);
    assert(sb_read_le32(s_files[s_fds[s_record_fd].file].bytes+SB_LDC_DATA_OFFSET+112u+8u)==1u);
    assert(sb_read_le32(s_files[s_fds[s_record_fd].file].bytes+SB_LDC_DATA_OFFSET+224u+8u)==2u);
    assert(process_background(&close_transfer)==SB_OK);
    memcpy(prior_file_id,s_metadata.ldc_file_session_id,16u);
    s_free_bytes=CONFIG_SAILBALL_SD_RESERVE_BYTES+111u;
    ack=commit(0u,0u,UINT64_C(5000000));
    assert(ack.status==SB_OUT_OF_RANGE&&ack.reason==SB_STORAGE_REASON_NO_SPACE);
    static uint8_t ready_a[112],ready_b[112];
    make_block(ready_a,1u,UINT64_C(6000000));
    make_block(ready_b,2u,UINT64_C(7000000));
    assert(sb_storage_submit_block(1u,1u,ready_a,sizeof(ready_a)));
    assert(sb_storage_submit_block(2u,2u,ready_b,sizeof(ready_b)));
    owner_process_one();owner_process_one();
    for(unsigned i=0;i<2u;++i){ack=next_ack();assert(ack.status==SB_OUT_OF_RANGE&&
        ack.reason==SB_STORAGE_REASON_NO_SPACE);}
    assert(sb_storage_get_state()==SB_STORAGE_READY);
    unsigned file_count=s_file_count;
    ack=create_file(2u,2u);assert(ack.reason==SB_STORAGE_REASON_NO_SPACE&&s_file_count==file_count);
    assert(memcmp(prior_file_id,s_metadata.ldc_file_session_id,16u)==0);
    s_free_bytes=UINT64_C(524288);s_total_bytes=UINT64_C(524288);
    ack=create_file(2u,2u);assert(ack.status==SB_OK&&ack.file_sequence==2u);
    assert(memcmp(prior_file_id,s_metadata.ldc_file_session_id,16u)!=0);
    assert(commit(0u,0u,UINT64_C(6000000)).status==SB_OK);
    puts("PASS production Storage rollover/no-space: size boundary, no metadata-only spin, space restoration");
}
static void test_owner_scheduler(void)
{
    s_completed_background=0u;s_critical_at_background_completion=0u;
    storage_bg_request_t request={.op=STORAGE_BG_LIST,.list_limit=8u,.entries_capacity=8u,
        .entries_out=(sb_storage_file_info_t[8]){{0}},.entry_count_out=(size_t[1]){0},
        .next_offset_out=(uint32_t[1]){0},.complete_out=(bool[1]){false},.waiter=&s_waiter,.counted=true};
    ++s_background_outstanding;assert(xQueueSend(s_bg_low_q,&request,0)==pdTRUE);
    unsigned critical_before=s_critical_serviced;
    for(unsigned i=0;i<SB_RECORDER_BLOCK_POOL_COUNT-1u;++i){static uint8_t blocks[SB_RECORDER_BLOCK_POOL_COUNT][112];make_block(blocks[i],i+1u,UINT64_C(7000000)+i*UINT64_C(1000000));
        assert(sb_storage_submit_block((uint8_t)i,i+1u,blocks[i],112u));}
    s_inject_critical_during_background=true;
    s_stop_when_idle=true;
    if(setjmp(s_owner_stop)==0)s_task_entry(NULL);
    s_stop_when_idle=false;
    assert(s_completed_background>=1u&&s_critical_serviced>=critical_before+SB_RECORDER_BLOCK_POOL_COUNT);
    assert(s_critical_at_background_completion>=critical_before+SB_RECORDER_BLOCK_POOL_COUNT);
    assert(s_background_outstanding==0u&&s_critical_outstanding==0u);
    assert(s_bg_yields>0u); /* production task yielded a real tick for a resumable scan */
    for(unsigned i=0;i<SB_RECORDER_BLOCK_POOL_COUNT;++i){sb_storage_ack_t ack=next_ack();assert(ack.op==SB_STORAGE_OP_WRITE_BLOCK&&ack.status==SB_OK);}
    puts("PASS production Storage owner scheduler: bounded LIST slices, critical service, eventual completion");
}
static void test_new_file_creation_failure(void)
{
    unsigned before=s_file_count;
    s_fail_open_count=1u;
    sb_storage_ack_t ack=create_file(3u,0u);
    assert(ack.status==SB_IO_ERROR&&s_file_count==before);
    assert(sb_storage_get_state()==SB_STORAGE_ERROR);
    assert(!s_file_active&&s_record_fd<0);
    s_retry_at=0u;assert(mount_sd());s_state=SB_STORAGE_READY;
    assert(create_file(4u,0u).status==SB_OK);
    assert(commit(0u,0u,UINT64_C(7000000)).status==SB_OK);
    s_total_bytes=UINT64_C(66560);s_readable_size=sb_storage_policy_file_target(s_total_bytes)-100u;
    static uint8_t boundary[112];make_block(boundary,1u,UINT64_C(8000000));
    assert(sb_storage_submit_block(0u,1u,boundary,sizeof(boundary)));owner_process_one();
    sb_storage_ack_t rollover=next_ack();assert(rollover.status==SB_ACCEPTED&&
        rollover.reason==SB_STORAGE_REASON_SIZE_LIMIT);
    s_fail_open_count=1u;
    uint8_t next_id[16]={2u};assert(sb_storage_create_recording(7u,4u,1u,9u,next_id));owner_process_one();
    sb_storage_ack_t create_ack=next_ack();assert(create_ack.op==SB_STORAGE_OP_CREATE&&create_ack.status==SB_IO_ERROR);
    sb_storage_ack_t retained_ack=next_ack();assert(retained_ack.op==SB_STORAGE_OP_WRITE_BLOCK&&
        retained_ack.buffer_id==0u&&retained_ack.status==SB_IO_ERROR);
    assert(s_rollover_block_count==0u&&sb_storage_get_state()==SB_STORAGE_ERROR);
    s_retry_at=0u;assert(mount_sd());s_state=SB_STORAGE_READY;
    assert(create_file(5u,0u).status==SB_OK);
    assert(commit(0u,0u,UINT64_C(9000000)).status==SB_OK);
    puts("PASS production Storage new-file open failure: local ERROR, remount and new session");
}
static void test_transfer_read_interleaving(void)
{
    storage_bg_request_t open_request={.op=STORAGE_BG_OPEN};
    strcpy(open_request.file_name,s_file_name);
    assert(process_background(&open_request)==SB_OK&&s_transfer_open);
    uint8_t output[112]={0};uint32_t actual=0u;
    storage_bg_request_t read_request={.op=STORAGE_BG_READ,.offset=SB_LDC_DATA_OFFSET,
        .length=sizeof(output),.out=output,.capacity=sizeof(output),.actual_out=&actual,
        .waiter=&s_waiter,.counted=true};
    ++s_background_outstanding;assert(xQueueSend(s_bg_high_q,&read_request,0)==pdTRUE);
    unsigned before=s_critical_serviced;
    static uint8_t blocks[5][112];
    for(unsigned i=0;i<5u;++i){make_block(blocks[i],i+6u,UINT64_C(12000000)+i*UINT64_C(1000000));
        assert(sb_storage_submit_block((uint8_t)(i%4u),i+6u,blocks[i],112u));}
    s_completed_background=0u;s_critical_at_background_completion=0u;
    s_stop_when_idle=true;if(setjmp(s_owner_stop)==0)s_task_entry(NULL);s_stop_when_idle=false;
    assert(actual==sizeof(output)&&s_completed_background==1u);
    assert(s_critical_at_background_completion==before+4u);
    assert(s_critical_serviced==before+5u);
    for(unsigned i=0;i<5u;++i)assert(next_ack().status==SB_OK);
    storage_bg_request_t close_request={.op=STORAGE_BG_CLOSE};assert(process_background(&close_request)==SB_OK);
    puts("PASS production Storage owner scheduler: bounded Transfer READ after three critical writes, then critical resumes");
}
static void test_abort_interrupts_background(void)
{
    sb_storage_file_info_t entries[8]={0};size_t count=0;uint32_t next=0;bool complete=false;
    storage_bg_request_t list={.op=STORAGE_BG_LIST,.list_limit=8u,.entries_capacity=8u,
        .entries_out=entries,.entry_count_out=&count,.next_offset_out=&next,.complete_out=&complete,
        .waiter=&s_waiter,.counted=true};
    ++s_background_outstanding;assert(xQueueSend(s_bg_low_q,&list,0)==pdTRUE);
    s_completed_background=0u;s_inject_critical_during_background=true;
    s_injected_sequence=11u;s_injected_start=UINT64_C(18000000);
    s_fail_sync_at=s_sync_count+1u;
    uint32_t epoch=sb_storage_epoch_generation();
    s_stop_when_idle=true;if(setjmp(s_owner_stop)==0)s_task_entry(NULL);s_stop_when_idle=false;
    assert(s_completed_background==1u&&sb_storage_epoch_generation()!=epoch);
    assert(sb_storage_get_state()==SB_STORAGE_ERROR);
    assert(s_background_outstanding==0u&&s_critical_outstanding==0u);
    assert(next_ack().status==SB_IO_ERROR);
    uint32_t result=UINT32_MAX;
    assert(xTaskNotifyWaitIndexed(SB_RPC_COMPLETION_INDEX,0u,UINT32_MAX,&result,0u)==pdTRUE);
    assert(result==SB_IO_ERROR);
    puts("PASS production Storage owner scheduler: critical epoch abort interrupts active metadata LIST and completes waiter");
}
int main(void)
{
    assert(sb_storage_start()==ESP_OK&&s_task_entry);
    s_state=SB_STORAGE_READY;
    test_abort_and_recovery();test_rollover_and_space();test_new_file_creation_failure();
    test_owner_scheduler();test_transfer_read_interleaving();
    test_abort_interrupts_background();
    return 0;
}
