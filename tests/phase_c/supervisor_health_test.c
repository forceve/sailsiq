#include <assert.h>
#include <stdio.h>
#include "../../components/sailball_supervisor/src/supervisor.c"

static int64_t s_now;
static sb_gnss_state_t s_gnss_state=SB_GNSS_RUNNING;
static uint64_t s_gnss_rx,s_gnss_fix,s_recorder_start,s_recorder_sample,s_recorder_commit;
static sb_recorder_state_t s_recorder_state=SB_RECORDER_RECORDING;
static bool s_recording_intent=true;
static sb_storage_state_t s_storage_state=SB_STORAGE_READY;
static unsigned s_gnss_restart_count;
int64_t esp_timer_get_time(void){return s_now;}
void sb_gnss_get_snapshot(sb_gnss_fix_t *fix,sb_gnss_state_t *state,uint64_t *rx,uint64_t *last_fix)
{if(fix)*fix=(sb_gnss_fix_t){0};if(state)*state=s_gnss_state;if(rx)*rx=s_gnss_rx;if(last_fix)*last_fix=s_gnss_fix;}
void sb_gnss_request_restart(void){++s_gnss_restart_count;}
void sb_recorder_get_snapshot(sb_recorder_state_t *state,bool *intent,uint32_t *session,uint32_t *block,uint64_t *start,uint64_t *sample,uint64_t *commit)
{if(state)*state=s_recorder_state;if(intent)*intent=s_recording_intent;if(session)*session=1;if(block)*block=0;if(start)*start=s_recorder_start;if(sample)*sample=s_recorder_sample;if(commit)*commit=s_recorder_commit;}
sb_storage_state_t sb_storage_get_state(void){return s_storage_state;}
void sb_board_get_info(sb_board_info_t *out){*out=(sb_board_info_t){0};}
void sb_validation_note_stack(sb_validation_task_t task,uint32_t bytes){(void)task;(void)bytes;}
void sb_validation_update_heap(uint32_t free_bytes,uint32_t minimum,uint32_t largest){(void)free_bytes;(void)minimum;(void)largest;}
TaskHandle_t xTaskCreateStatic(void (*entry)(void *),const char *name,unsigned stack,void *arg,unsigned priority,StackType_t *storage,StaticTask_t *state){(void)entry;(void)name;(void)stack;(void)arg;(void)priority;(void)storage;(void)state;return (TaskHandle_t)1;}
unsigned uxTaskGetStackHighWaterMark(TaskHandle_t task){(void)task;return 0;}
void vTaskDelay(TickType_t ticks){(void)ticks;}
int esp_task_wdt_add(void *task){(void)task;return ESP_OK;}
int esp_task_wdt_reset(void){return ESP_OK;}
size_t heap_caps_get_free_size(uint32_t caps){(void)caps;return 0;}
size_t heap_caps_get_minimum_free_size(uint32_t caps){(void)caps;return 0;}
size_t heap_caps_get_largest_free_block(uint32_t caps){(void)caps;return 0;}
void esp_restart(void){assert(false);}
bool sb_transfer_shutdown(void){return true;}
bool sb_transfer_is_active(void){return false;}
bool sb_storage_transfer_is_active(void){return false;}
void sb_storage_get_file_snapshot(char *name,uint64_t *size,bool *active){(void)name;(void)size;if(active)*active=false;}
sb_status_t sb_recorder_request_stop(void){return SB_OK;}
sb_storage_state_t dummy_storage_state(void){return s_storage_state;}

int main(void)
{
    sb_board_info_t board={0};uint64_t last_restart=0;sb_supervisor_snapshot_t snapshot;
    s_now=UINT64_C(2000000);s_gnss_rx=UINT64_C(1900000);s_gnss_fix=0;
    s_recorder_start=UINT64_C(1000000);s_recorder_sample=UINT64_C(1900000);s_recorder_commit=0;
    evaluate_progress(&board,&last_restart);sb_supervisor_get_snapshot(&snapshot);
    assert(snapshot.cause==SB_PROGRESS_AWAITING_FIRST_COMMIT&&!snapshot.critical_path_healthy&&s_gnss_restart_count==0u);

    s_recorder_commit=UINT64_C(1500000);evaluate_progress(&board,&last_restart);
    assert(sb_supervisor_critical_healthy()); /* durable commit, not merely READY/mount */
    s_gnss_rx=0;evaluate_progress(&board,&last_restart);sb_supervisor_get_snapshot(&snapshot);
    assert(snapshot.cause==SB_PROGRESS_GNSS_NO_RX&&!snapshot.critical_path_healthy&&s_gnss_restart_count==0u);

    board.gnss_configured=true;evaluate_progress(&board,&last_restart);
    assert(s_gnss_restart_count==1u); /* only genuine silence requests local GNSS recovery */
    s_gnss_state=SB_GNSS_RUNNING;s_gnss_rx=UINT64_C(1999000);s_recorder_sample=UINT64_C(1999000);
    s_storage_state=SB_STORAGE_ERROR;evaluate_progress(&board,&last_restart);
    assert(!sb_supervisor_critical_healthy()); /* known no-space/storage error is not healthy */
    s_storage_state=SB_STORAGE_READY;s_recorder_start=UINT64_C(2500000);s_recorder_commit=UINT64_C(1500000);
    s_now=UINT64_C(2600000);s_gnss_rx=s_recorder_sample=s_now;
    evaluate_progress(&board,&last_restart);sb_supervisor_get_snapshot(&snapshot);
    assert(snapshot.cause==SB_PROGRESS_AWAITING_FIRST_COMMIT&&!snapshot.critical_path_healthy);
    s_recorder_commit=UINT64_C(2550000);evaluate_progress(&board,&last_restart);
    assert(sb_supervisor_critical_healthy()); /* new-epoch durable progress restores health */
    puts("PASS production Supervisor health: first-commit gate, NO_FIX activity vs silence, local restart policy and epoch recovery");
    return 0;
}
