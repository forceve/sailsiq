/* Production Recorder + Storage + Transfer under one deterministic fake FS.
 * The existing Storage fake supplies only the physical dependencies. */
#define SB_THREE_OWNER_TEST 1
#define main storage_owner_baseline_main
#include "storage_owner_integration_test.c"
#undef main
#if defined(SB_FOUR_OWNER_TEST) || defined(SB_RECORDER_POOL_CAPACITY_TEST)
#define main epoch_three_owner_baseline_main
#endif

#define s_mux recorder_mux
#define s_stack recorder_stack
#define s_state recorder_state
#define s_task_struct recorder_task_struct
#include "../../components/sailball_recorder/src/recorder.c"
#undef s_task_struct
#undef s_state
#undef s_stack
#undef s_mux

#define s_mux transfer_mux
#define s_stack transfer_stack
#define s_task_struct transfer_task_struct
#define s_readable_size transfer_readable_size
#include "../../components/sailball_transfer/src/transfer.c"
#undef s_readable_size
#undef s_task_struct
#undef s_stack
#undef s_mux

static sb_gnss_fix_t s_fake_fixes[128];
static size_t s_fake_fix_head,s_fake_fix_count;
static uint32_t s_random_counter;
static bool s_inject_critical_before_read;
static bool s_inject_critical_after_read,s_after_read_completion_delivered;
static void recorder_step(void);
static void push_fix(uint64_t time,uint32_t seq,bool altitude);

uint32_t esp_random(void){return UINT32_C(0x12345678)+ ++s_random_counter;}
uint8_t sb_fix_to_ldc(sb_gnss_fix_type_t type){return (uint8_t)type;}
bool sb_gnss_try_receive(sb_gnss_fix_t *fix)
{
    if(!s_fake_fix_count)return false;
    *fix=s_fake_fixes[s_fake_fix_head++ % 128u];--s_fake_fix_count;return true;
}
uint32_t sb_gnss_get_restart_generation(void){return 0u;}
int xTaskNotifyGiveIndexed(TaskHandle_t task,unsigned index)
{
    assert(task&&index==SB_CONTROL_WAKE_INDEX);
    ++task->value[index];task->pending[index]=1;return pdTRUE;
}
uint32_t ulTaskNotifyTakeIndexed(unsigned index,int clear,TickType_t ticks)
{
    (void)clear;(void)ticks;assert(index==SB_CONTROL_WAKE_INDEX);
    uint32_t value=s_current_handle->value[index];
    s_current_handle->value[index]=0;s_current_handle->pending[index]=0;return value;
}
static void pump_owner_wait(void)
{
    TaskHandle_t saved=s_current_handle;
    if(saved==&s_caller_handle) {
        transfer_request_t request;
        assert(xQueueReceive(s_command_queue,&request,0)==pdTRUE);
        s_current_handle=&s_transfer_handle;
        process_request(&request);
    } else {
        assert(saved==&s_transfer_handle);
        if(s_inject_critical_before_read){
            s_inject_critical_before_read=false;
            push_fix(UINT64_C(11000000),6u,true);recorder_step();
            push_fix(UINT64_C(12000000),7u,false);recorder_step();
            assert(uxQueueMessagesWaiting(s_req_q)>0u);
            s_current_handle=&s_waiter;
            owner_process_one();
            s_current_handle=&s_transfer_handle;
        }
        storage_bg_request_t request;
        assert(xQueueReceive(s_bg_high_q,&request,0)==pdTRUE);
        s_current_handle=&s_waiter;
        sb_status_t result;
        unsigned steps=0u;
        do {result=process_background(&request);assert(++steps<1000u);} while(result==SB_ACCEPTED);
        request.result=result;
        background_cleanup(&request);
        background_request_complete(&request);
        if(request.waiter!=NULL)sb_rpc_complete(request.waiter,(uint32_t)request.result);
        if(s_inject_critical_after_read){
            /* Completion was delivered, but Transfer has not resumed from its
             * indexed notification. A critical failure invalidates that result. */
            assert(request.op==STORAGE_BG_READ&&request.result==SB_OK);
            s_inject_critical_after_read=false;s_after_read_completion_delivered=true;
            push_fix(UINT64_C(15000000),10u,true);recorder_step();
            push_fix(UINT64_C(16000000),11u,false);recorder_step();
            assert(uxQueueMessagesWaiting(s_req_q)>0u);
            s_fail_sync_at=s_sync_count+1u;
            s_current_handle=&s_waiter;owner_process_one();
            s_current_handle=&s_transfer_handle;
        }
    }
    s_current_handle=saved;
}
static void recorder_step(void)
{
    TaskHandle_t saved=s_current_handle;s_current_handle=&s_recorder_handle;
    s_running_recorder=true;
    if(setjmp(s_recorder_yield)==0)s_recorder_entry(NULL);
    s_running_recorder=false;s_current_handle=saved;
}
static void storage_step(void)
{
    TaskHandle_t saved=s_current_handle;s_current_handle=&s_waiter;
    owner_process_one();
    s_current_handle=saved;
}
static void push_fix(uint64_t time,uint32_t seq,bool altitude)
{
    assert(s_fake_fix_count<128u);
    sb_gnss_fix_t fix={.mono_us=time,.sample_seq=seq,.position_valid=true,
        .latitude_e7=481173000,.longitude_e7=115166667,.fix_type=SB_GNSS_FIX_3D,
        .altitude_valid=altitude,.altitude_cm=10000};
    s_fake_fixes[(s_fake_fix_head+s_fake_fix_count)%128u]=fix;++s_fake_fix_count;
}
static void assert_pool_free(void)
{
    assert(s_sample_count==0u);
    for(unsigned i=0;i<SB_RECORDER_BLOCK_POOL_COUNT;++i)assert(s_pool_state[i]==POOL_FREE);
}
static void assert_new_session(uint32_t old_session,const uint8_t old_id[16])
{
    uint32_t session=0,sequence=UINT32_MAX;
    sb_recorder_get_snapshot(NULL,NULL,&session,&sequence,NULL,NULL,NULL);
    assert(session==old_session+1u&&sequence==0u);
    assert(s_file_sequence==0u&&s_active_file_sequence==0u);
    assert(memcmp(old_id,s_metadata.ldc_file_session_id,16u)!=0);
}
int main(void)
{
    s_wait_pump=pump_owner_wait;
    assert(sb_storage_start()==ESP_OK);
    s_state=SB_STORAGE_READY;
    assert(sb_recorder_start()==ESP_OK&&sb_transfer_start()==ESP_OK);
    assert(s_recorder_entry&&s_transfer_entry);
    recorder_step();storage_step();recorder_step();
    assert(recorder_state==SB_RECORDER_RECORDING);
    uint32_t old_session=0;sb_recorder_get_snapshot(NULL,NULL,&old_session,NULL,NULL,NULL,NULL);
    uint8_t old_file_id[16];memcpy(old_file_id,s_metadata.ldc_file_session_id,16u);
    char old_name[64];memcpy(old_name,s_file_name,sizeof(old_name));
    sb_transfer_set_session_generation(SB_SOURCE_USB,1u);
    uint64_t token=sb_transfer_session_token(SB_SOURCE_USB,1u);
    uint32_t old_transfer_id=0;uint64_t readable=0;bool active=false;
    assert(sb_transfer_open(old_name,token,&old_transfer_id,&readable,&active)==SB_OK);
    assert(old_transfer_id&&active&&readable==SB_LDC_DATA_OFFSET);
    int old_fd=s_transfer_fd;uint32_t old_epoch=sb_storage_epoch_generation();

    push_fix(UINT64_C(2000000),0u,true);recorder_step();
    push_fix(UINT64_C(3000000),1u,false);recorder_step();
    push_fix(UINT64_C(4000000),2u,true);recorder_step();
    assert(uxQueueMessagesWaiting(s_req_q)==2u&&writing_buffers()==2u);
    assert(s_sample_count==1u); /* third block is still FILLING */
    s_fail_sync_at=s_sync_count+1u;storage_step();
    assert(sb_storage_epoch_generation()!=old_epoch&&s_record_fd<0&&!s_fds[old_fd].open);
    assert(!sb_storage_transfer_is_active());
    recorder_step();assert_pool_free();
    assert(s_recorder_lost>=3u);
    unsigned consumed=s_recorder_consumed;
    push_fix(UINT64_C(5000000),3u,true);recorder_step();
    assert(s_recorder_consumed==consumed+1u&&s_fake_fix_count==0u);
    observe_storage_epoch();assert(!sb_transfer_is_active());
    uint8_t stale_output[8]={0};size_t stale_actual=0u;
    assert(sb_transfer_read(token,old_transfer_id,0u,8u,stale_output,sizeof(stale_output),&stale_actual)==SB_NOT_FOUND);
    s_fail_sync_at=0u;s_fail_mount_count=1u;s_retry_at=0u;
    assert(!mount_sd()&&mount_sd());s_state=SB_STORAGE_READY;
    s_now_us=(uint64_t)s_open_retry_at*1000u+UINT64_C(1000);
    recorder_step();recorder_step();storage_step();recorder_step();
    assert(recorder_state==SB_RECORDER_RECORDING);
    assert_new_session(old_session,old_file_id);
    assert(strcmp(old_name,s_file_name)!=0);
    uint32_t new_transfer_id=0;
    assert(sb_transfer_open(s_file_name,token,&new_transfer_id,&readable,&active)==SB_OK);
    assert(new_transfer_id!=old_transfer_id&&active);

    push_fix(UINT64_C(9000000),4u,true);recorder_step();
    push_fix(UINT64_C(10000000),5u,false);recorder_step();
    assert(uxQueueMessagesWaiting(s_req_q)>0u);
    while(uxQueueMessagesWaiting(s_req_q)!=0u)storage_step();
    recorder_step();
    assert(uxQueueMessagesWaiting(s_req_q)==0u);
    s_fail_sync_at=s_sync_count+1u;
    s_inject_critical_before_read=true;
    uint8_t output[8];memset(output,0xA5,sizeof(output));size_t actual=UINT32_MAX;
    sb_status_t read_status=sb_transfer_read(token,new_transfer_id,0u,8u,output,sizeof(output),&actual);
    assert(read_status==SB_IO_ERROR&&actual==0u&&output[0]==0xA5u);
    assert(sb_storage_epoch_generation()>old_epoch+1u);
    recorder_step();assert_pool_free();
    observe_storage_epoch();assert(!sb_transfer_is_active());
    s_fail_sync_at=0u;s_retry_at=0u;assert(mount_sd());s_state=SB_STORAGE_READY;
    s_now_us=(uint64_t)s_open_retry_at*1000u+UINT64_C(1000);
    recorder_step();recorder_step();storage_step();recorder_step();
    assert(recorder_state==SB_RECORDER_RECORDING);
    uint32_t post_completion_id=0;
    assert(sb_transfer_open(s_file_name,token,&post_completion_id,&readable,&active)==SB_OK);
    assert(post_completion_id!=new_transfer_id);
    uint8_t valid_output[8]={0};size_t valid_actual=0u;
    assert(sb_transfer_read(token,post_completion_id,0u,8u,valid_output,sizeof(valid_output),&valid_actual)==SB_OK);
    assert(valid_actual==8u);
    s_inject_critical_after_read=true;s_after_read_completion_delivered=false;
    uint8_t after_output[8];memset(after_output,0xA5,sizeof(after_output));size_t after_actual=UINT32_MAX;
    assert(sb_transfer_read(token,post_completion_id,0u,8u,after_output,sizeof(after_output),&after_actual)==SB_NOT_FOUND);
    assert(s_after_read_completion_delivered&&after_actual==0u);
    assert(sb_storage_get_state()==SB_STORAGE_ERROR);
    recorder_step();assert_pool_free();
    observe_storage_epoch();assert(!sb_transfer_is_active());
    puts("PASS production Recorder+Storage+Transfer: queued blocks, active/pending READ, epoch abort, remount, new identity and reusable pool");
    return 0;
}
#if defined(SB_FOUR_OWNER_TEST) || defined(SB_RECORDER_POOL_CAPACITY_TEST)
#undef main
#endif
