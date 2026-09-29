#include <assert.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "esp_random.h"
#include "esp_task_wdt.h"
#include "sailball/board.h"
#include "sailball/diagnostics.h"
#include "sailball/gnss.h"
#include "sailball/ldc.h"
#include "sailball/recorder.h"
#include "sailball/storage.h"
#include "sailball/validation.h"

#include "../../components/sailball_recorder/src/recorder.c"

typedef struct { sb_ldc_block_header_t header; uint8_t buffer_id; } captured_block_t;
static captured_block_t s_captured[64];
static size_t s_captured_count, s_acked_count;
static uint64_t s_diag_loss;
static uint32_t s_created_session,s_created_file,s_random_counter;
static uint8_t s_created_file_id[16],s_prior_file_id[16];
static unsigned s_create_count;
static TickType_t s_tick;

bool sb_storage_submit_block(uint8_t buffer_id, uint32_t sequence, uint8_t *data, size_t length)
{
    assert(s_captured_count < sizeof(s_captured) / sizeof(s_captured[0]));
    assert(s_pool_state[buffer_id] == POOL_READY);
    assert(sb_ldc_block_validate(data, length, sequence));
    captured_block_t *capture = &s_captured[s_captured_count];
    capture->buffer_id = buffer_id;
    assert(sb_ldc_header_decode(data, &capture->header));
    const sb_ldc_block_header_t *header = &capture->header;
    assert(header->block_sequence == s_captured_count);
    assert(header->block_length == length);
    assert(header->duration_us >= 1u && header->duration_us <= 15000000u);
    assert(header->sample_rate_num == reduced_rate_num());
    assert(header->sample_rate_den == reduced_rate_den());
    assert(header->valid_slots == s_sample_count);
    uint64_t scaled = (uint64_t)header->duration_us * header->sample_rate_num;
    uint64_t divisor = UINT64_C(1000000) * header->sample_rate_den;
    assert(header->nominal_slots == (scaled + divisor - 1u) / divisor);
    assert(header->start_mono_us == s_samples[0].fix.mono_us);
    for (size_t i = 0; i < s_sample_count; ++i) {
        uint16_t slot = s_samples[i].slot;
        assert(slot < header->nominal_slots);
        if (header->presence_bitmap_length != 0u) {
            const uint8_t *bitmap = data + header->presence_bitmap_offset;
            assert((bitmap[slot / 8u] & (1u << (slot % 8u))) != 0u);
        }
    }
    if (s_captured_count != 0u) {
        const sb_ldc_block_header_t *previous = &s_captured[s_captured_count - 1u].header;
        assert(previous->start_mono_us <= header->start_mono_us);
        assert(previous->start_mono_us + previous->duration_us <= header->start_mono_us);
    }
    ++s_captured_count;
    return true;
}
static void acknowledge_blocks(void)
{
    while (s_acked_count < s_captured_count) {
        sb_storage_ack_t ack = {.op=SB_STORAGE_OP_WRITE_BLOCK,.buffer_id=s_captured[s_acked_count].buffer_id,
            .status=SB_OK,.committed_block_sequence=(uint32_t)s_acked_count};
        handle_ack(&ack);
        ++s_acked_count;
    }
}
sb_storage_state_t sb_storage_get_state(void) { return SB_STORAGE_READY; }
bool sb_storage_create_recording(uint32_t boot_id, uint32_t recorder_session_id,
                                  uint32_t file_sequence, uint64_t device_id,
                                  const uint8_t ldc_file_session_id[16])
{ (void)boot_id;(void)device_id;s_created_session=recorder_session_id;s_created_file=file_sequence;
  memcpy(s_created_file_id,ldc_file_session_id,16u);++s_create_count;return true; }
bool sb_storage_close_recording(void) { return true; }
bool sb_storage_try_ack(sb_storage_ack_t *ack) { (void)ack; return false; }
bool sb_gnss_try_receive(sb_gnss_fix_t *fix) { (void)fix; return false; }
uint32_t sb_gnss_get_restart_generation(void) { return 0u; }
uint8_t sb_fix_to_ldc(sb_gnss_fix_type_t type) { return (uint8_t)type; }
uint64_t sb_monotonic_us(void) { return UINT64_C(1000000); }
void sb_board_get_info(sb_board_info_t *out) { memset(out,0,sizeof(*out));out->boot_id=1u; }
uint32_t esp_random(void) { return UINT32_C(0x12345678)+ ++s_random_counter; }
esp_err_t esp_task_wdt_add(void *task) { (void)task; return ESP_OK; }
esp_err_t esp_task_wdt_reset(void) { return ESP_OK; }
void sb_diag_increment(sb_diag_group_t group,unsigned counter) { (void)group;(void)counter; }
void sb_diag_add(sb_diag_group_t group,unsigned counter,uint64_t amount)
{ if(group==SB_DIAG_RECORDER&&counter==2u)s_diag_loss+=amount; }
void sb_validation_note_stack(sb_validation_task_t task,uint32_t bytes)
{ (void)task;(void)bytes; }
QueueHandle_t xQueueCreateStatic(unsigned depth,unsigned size,uint8_t *data,StaticQueue_t *state)
{ (void)depth;(void)size;(void)data;return state; }
int xQueueSend(QueueHandle_t queue,const void *item,TickType_t ticks)
{ (void)queue;(void)item;(void)ticks;return pdTRUE; }
int xQueueReceive(QueueHandle_t queue,void *item,TickType_t ticks)
{ (void)queue;(void)item;(void)ticks;return pdFALSE; }
unsigned uxQueueMessagesWaiting(QueueHandle_t queue) { (void)queue; return 0u; }
TaskHandle_t xTaskCreateStatic(void (*entry)(void*),const char *name,unsigned stack,void *arg,
                               unsigned priority,StackType_t *storage,StaticTask_t *state)
{ (void)entry;(void)name;(void)stack;(void)arg;(void)priority;(void)storage;(void)state;return (TaskHandle_t)1; }
unsigned uxTaskGetStackHighWaterMark(TaskHandle_t task) { (void)task; return 1024u; }
void vTaskDelay(TickType_t ticks) { (void)ticks; }
TickType_t xTaskGetTickCount(void) { return s_tick; }

static void reset_recorder(void)
{
    s_state = SB_RECORDER_RECORDING; s_intent = true;
    s_file_open = true; s_new_session_required = false;s_rollover_pending=false;
    s_create_pending = s_close_pending = false;
    s_open_retry_at = 0u;
    s_sample_count = 0u; s_block_open = false; s_field_mask = 0u;
    s_block_sequence = 0u; s_last_block_end_mono_us = 0u;
    s_have_input_sample_seq = false; s_next_time_discontinuity = false;
    memset(s_pool_state, 0, sizeof(s_pool_state));
    memset(s_pool_sample_count, 0, sizeof(s_pool_sample_count));
    memset(s_captured, 0, sizeof(s_captured));
    s_captured_count = s_acked_count = 0u; s_diag_loss = 0u;
    s_tick=0u;s_create_count=0u;s_random_counter=0u;
}
static sb_gnss_fix_t make_fix(uint64_t time_us,uint32_t sequence,bool altitude,bool utc)
{
    sb_gnss_fix_t fix = {0};
    fix.sample_seq=sequence;fix.mono_us=time_us;fix.position_valid=true;
    fix.latitude_e7=481173000;fix.longitude_e7=115166667;
    fix.altitude_valid=altitude;fix.altitude_cm=12345;
    fix.utc_valid=utc;fix.utc_us=(int64_t)(UINT64_C(700000000000000)+time_us);
    fix.fix_type=SB_GNSS_FIX_3D;
    return fix;
}
static void add_fix(sb_gnss_fix_t fix)
{ append_fix(&fix); acknowledge_blocks(); }
static void test_boundaries(void)
{
    reset_recorder();
    uint64_t base=UINT64_C(1000000);
    uint64_t period=UINT64_C(1000000)*rate_den()/rate_num();
    add_fix(make_fix(base,0u,true,false));
    add_fix(make_fix(base+period+2000u,1u,true,false));
    add_fix(make_fix(base+3u*period-1000u,3u,true,false)); /* absent slot 2 */
    uint64_t availability_change=base+4u*period+2000u;
    add_fix(make_fix(availability_change,4u,false,false));
    assert(s_captured_count==1u);
    assert(s_captured[0].header.presence_bitmap_length!=0u);
    assert(s_captured[0].header.start_mono_us+s_captured[0].header.duration_us<=availability_change);
    assert(s_sample_count==1u&&s_samples[0].fix.mono_us==availability_change);
    add_fix(make_fix(base+5u*period,5u,false,false));
    uint64_t utc_change=base+6u*period+1000u;
    add_fix(make_fix(utc_change,6u,false,true));
    assert(s_captured_count==2u&&s_sample_count==1u);
    assert(s_captured[1].header.time_flags==0u);
    add_fix(make_fix(base+7u*period+1000u,7u,false,true));
    handle_command(CMD_STOP);
    assert(finalize_block()); acknowledge_blocks();
    assert(s_captured_count==3u&&s_captured[2].header.time_flags==1u);
    assert(s_diag_loss==1u); /* sample_seq 2 was absent */
}
static void test_max_duration(void)
{
    reset_recorder();
    uint64_t base=UINT64_C(1000000), period=UINT64_C(1000000)*rate_den()/rate_num();
    uint16_t slots=max_slots_per_block();
    for(uint16_t i=0u;i<slots;++i) add_fix(make_fix(base+(uint64_t)i*period,i,true,false));
    assert(s_captured_count==1u);
    assert(s_captured[0].header.nominal_slots==slots);
    assert(s_captured[0].header.duration_us<=SB_LDC_MAX_BLOCK_US);
    if(rate_num()==1u&&rate_den()==1u)
        assert(s_captured[0].header.duration_us==SB_LDC_MAX_BLOCK_US);
}
static void test_recorder_file_identity(void)
{
    reset_recorder();s_session_id=12u;s_file_sequence=s_active_file_sequence=0u;
    s_pool_state[0]=POOL_WRITING;s_pool_sample_count[0]=1u;
    sb_storage_ack_t rollover={.op=SB_STORAGE_OP_WRITE_BLOCK,.buffer_id=0u,
        .status=SB_ACCEPTED,.reason=SB_STORAGE_REASON_SIZE_LIMIT};
    handle_ack(&rollover);
    assert(s_state==SB_RECORDER_STARTING&&!s_new_session_required&&s_file_sequence==1u&&
           s_pool_state[0]==POOL_WRITING&&s_rollover_pending);
    begin_create();assert(s_create_count==1u&&s_created_session==12u&&s_created_file==1u);
    memcpy(s_prior_file_id,s_created_file_id,16u);
    sb_storage_ack_t created={.op=SB_STORAGE_OP_CREATE,.status=SB_OK,.file_sequence=1u,
        .committed_block_sequence=1u};
    handle_ack(&created);assert(s_state==SB_RECORDER_RECORDING);
    assert(s_block_sequence==1u&&!s_rollover_pending);
    sb_storage_ack_t retained_write={.op=SB_STORAGE_OP_WRITE_BLOCK,.buffer_id=0u,.status=SB_OK,
        .committed_block_sequence=0u};
    handle_ack(&retained_write);assert(s_pool_state[0]==POOL_FREE&&s_diag_loss==0u);
    s_pool_state[1]=POOL_WRITING;s_pool_sample_count[1]=1u;
    sb_storage_ack_t io_failure={.op=SB_STORAGE_OP_WRITE_BLOCK,.buffer_id=1u,.status=SB_IO_ERROR};
    handle_ack(&io_failure);
    assert(s_state==SB_RECORDER_ERROR&&s_new_session_required);
    s_tick=SB_RECORDER_OPEN_RETRY_MS;s_state=SB_RECORDER_STARTING;
    begin_create();
    assert(s_create_count==2u&&s_created_session==13u&&s_created_file==0u);
    assert(memcmp(s_created_file_id,s_prior_file_id,16u)!=0);
}
static void test_metadata_rollover_identity(void)
{
    reset_recorder();s_session_id=20u;s_file_sequence=s_active_file_sequence=3u;
    s_pool_state[0]=POOL_WRITING;s_pool_sample_count[0]=1u;
    sb_storage_ack_t full={.op=SB_STORAGE_OP_WRITE_BLOCK,.buffer_id=0u,
        .status=SB_OUT_OF_RANGE,.reason=SB_STORAGE_REASON_METADATA_FULL};
    handle_ack(&full);
    assert(s_state==SB_RECORDER_STARTING&&!s_new_session_required);
    assert(s_file_sequence==4u&&s_pool_state[0]==POOL_FREE);
    begin_create();
    assert(s_create_count==1u&&s_created_session==20u&&s_created_file==4u);
}
int main(void)
{
    test_boundaries(); test_max_duration(); test_recorder_file_identity();
    test_metadata_rollover_identity();
    printf("PASS production Recorder->LDC block sequence %u/%u Hz: availability, UTC, jitter, gap, STOP and duration\n",
           (unsigned)rate_num(),(unsigned)rate_den());
    return 0;
}
