/* Three real Recorder blocks, real Storage/Transfer owners, fake scheduler/FS.
 * Compile at the production target rate of 10 normalized fixes per second. */
#define SB_RECORDER_POOL_CAPACITY_TEST 1
#include "epoch_three_owner_test.c"

static uint32_t s_pool_test_next_seq;

static void assert_pool_accounting(unsigned expected_writing)
{
    unsigned count[POOL_WRITING+1u]={0};
    for(unsigned i=0;i<SB_RECORDER_BLOCK_POOL_COUNT;++i){
        pool_state_t state=s_pool_state[i];
        assert(state<=POOL_WRITING);
        ++count[state];
        if(state==POOL_FREE)assert(s_pool_sample_count[i]==0u);
        if(state==POOL_WRITING)assert(s_pool_sample_count[i]>0u);
    }
    assert(count[POOL_FREE]+count[POOL_FILLING]+count[POOL_READY]+count[POOL_WRITING]
           ==SB_RECORDER_BLOCK_POOL_COUNT);
    assert(count[POOL_FILLING]<=1u&&count[POOL_READY]<=1u);
    assert(count[POOL_WRITING]==expected_writing);
    assert(writing_buffers()==expected_writing);
    fake_queue_t *queue=find_queue(s_req_q);
    unsigned queued_ids=0u;
    for(unsigned i=0;i<queue->count;++i){
        sb_storage_request_t request;
        memcpy(&request,queue->data+(size_t)((queue->head+i)%queue->depth)*queue->size,
               sizeof(request));
        if(request.op!=SB_STORAGE_OP_WRITE_BLOCK)continue;
        assert(request.buffer_id<SB_RECORDER_BLOCK_POOL_COUNT);
        assert((queued_ids&(1u<<request.buffer_id))==0u);
        queued_ids|=1u<<request.buffer_id;
        assert(request.data==s_block_pool[request.buffer_id]);
        assert(s_pool_state[request.buffer_id]==POOL_WRITING);
    }
}

static void feed_fixes(unsigned count)
{
    for(unsigned i=0;i<count;++i){
        uint32_t seq=s_pool_test_next_seq++;
        push_fix(UINT64_C(2000000)+(uint64_t)seq*UINT64_C(100000),seq,true);
        recorder_step();
        assert(s_fake_fix_count==0u); /* Recorder keeps draining the GNSS queue. */
    }
}

static void drain_critical(void)
{
    for(unsigned steps=0;uxQueueMessagesWaiting(s_req_q)!=0u;++steps){
        assert(steps<16u);
        storage_step();recorder_step();
        assert_pool_accounting(writing_buffers());
    }
    recorder_step();
    assert(s_critical_outstanding==0u);
}

static void assert_file_sequences(unsigned count)
{
    assert(s_record_fd>=0&&s_fds[s_record_fd].open);
    fake_file_t *file=&s_files[s_fds[s_record_fd].file];
    size_t offset=SB_LDC_DATA_OFFSET;
    for(unsigned sequence=0;sequence<count;++sequence){
        sb_ldc_block_header_t header;
        assert(sb_ldc_header_decode(file->bytes+offset,&header));
        assert(header.block_sequence==sequence&&header.block_length<=SB_LDC_BLOCK_CAPACITY);
        assert(offset+header.block_length<=file->length);
        assert(sb_ldc_block_validate(file->bytes+offset,header.block_length,sequence));
        offset+=header.block_length;
    }
    assert(offset==s_readable_size&&offset==file->length);
}

static void recover_after_abort(uint32_t prior_session)
{
    assert(sb_storage_get_state()==SB_STORAGE_ERROR);
    s_fail_sync_at=0u;s_retry_at=0u;
    assert(mount_sd());s_state=SB_STORAGE_READY;
    s_now_us=(uint64_t)s_open_retry_at*1000u+UINT64_C(1000);
    recorder_step();recorder_step();
    assert(uxQueueMessagesWaiting(s_req_q)==1u);
    storage_step();recorder_step();
    assert(recorder_state==SB_RECORDER_RECORDING);
    uint32_t session=0u;
    sb_recorder_get_snapshot(NULL,NULL,&session,NULL,NULL,NULL,NULL);
    assert(session==prior_session+1u&&s_file_sequence==0u);
    assert_pool_accounting(0u);
}

int main(void)
{
    assert(SB_RECORDER_BLOCK_POOL_COUNT==3u);
    assert(CONFIG_SAILBALL_GNSS_SAMPLE_RATE_NUM==10&&CONFIG_SAILBALL_GNSS_SAMPLE_RATE_DEN==1);
    assert(sizeof(s_block_pool)==3u*8192u);
    s_wait_pump=pump_owner_wait;
    assert(sb_storage_start()==ESP_OK);s_state=SB_STORAGE_READY;
    assert(sb_recorder_start()==ESP_OK&&sb_transfer_start()==ESP_OK);
    recorder_step();storage_step();recorder_step();
    assert(recorder_state==SB_RECORDER_RECORDING);
    assert_pool_accounting(0u);

    /* Three 80-slot blocks at 10 Hz are accepted while Storage is held. The
     * fourth completed block has no buffer: only its new samples are lost. */
    feed_fixes(240u);
    assert(uxQueueMessagesWaiting(s_req_q)==3u);
    assert_pool_accounting(3u);
    assert(s_recorder_consumed==240u&&s_recorder_blocks_completed==3u&&
           s_recorder_buffer_exhaustions==0u&&s_recorder_lost==0u);
    feed_fixes(80u);
    assert_pool_accounting(3u);
    assert(s_recorder_consumed==320u&&s_recorder_lost==80u&&
           s_recorder_buffer_exhaustions==1u&&s_recorder_blocks_completed==3u);
    storage_step();recorder_step();
    assert_pool_accounting(2u);
    feed_fixes(80u);
    assert_pool_accounting(3u); /* FREE block reused without restart. */
    drain_critical();
    assert_pool_accounting(0u);
    assert(s_recorder_committed==320u&&s_recorder_lost==80u&&
           s_recorder_blocks_completed==4u&&s_recorder_buffer_exhaustions==1u);
    assert_file_sequences(4u);

    /* Keep an old-file Transfer reader open through a saturated clean rollover. */
    char old_name[64];memcpy(old_name,s_file_name,sizeof(old_name));
    uint8_t old_id[16];memcpy(old_id,s_metadata.ldc_file_session_id,sizeof(old_id));
    uint32_t old_session=0u;sb_recorder_get_snapshot(NULL,NULL,&old_session,NULL,NULL,NULL,NULL);
    uint32_t old_file_sequence=s_active_file_sequence;
    sb_transfer_set_session_generation(SB_SOURCE_USB,1u);
    uint64_t token=sb_transfer_session_token(SB_SOURCE_USB,1u),readable=0u;
    uint32_t transfer_id=0u;bool active=false;
    assert(sb_transfer_open(old_name,token,&transfer_id,&readable,&active)==SB_OK);
    assert(active&&transfer_id!=0u);
    int old_reader_fd=s_transfer_fd;
    s_total_bytes=UINT64_C(66560);
    s_readable_size=sb_storage_policy_file_target(s_total_bytes)-100u;
    uint64_t lost_before_rollover=s_recorder_lost;
    feed_fixes(240u);assert_pool_accounting(3u);
    unsigned sync_before=s_sync_count;
    storage_step();recorder_step();
    assert(s_rollover_block_count==1u&&s_rollover_pending);
    storage_step();recorder_step();
    storage_step();recorder_step();
    assert(s_rollover_block_count==3u&&writing_buffers()==3u);
    assert(uxQueueMessagesWaiting(s_req_q)==1u); /* CREATE follows three blocks. */
    storage_step();recorder_step();
    assert(s_rollover_block_count==0u&&s_recorder_lost==lost_before_rollover);
    assert_pool_accounting(0u);
    assert(recorder_state==SB_RECORDER_RECORDING&&s_active_file_sequence==old_file_sequence+1u);
    assert(s_session_id==old_session&&memcmp(old_id,s_metadata.ldc_file_session_id,16u)!=0);
    assert(s_sync_count-sync_before>=8u); /* metadata, then three dual-flush blocks */
    assert(s_transfer_open&&s_transfer_fd==old_reader_fd&&s_fds[old_reader_fd].open);
    assert_file_sequences(3u);
    assert(sb_transfer_close(token,transfer_id,false)==SB_OK);

    /* Abort with all three buffers owned by Storage, then remount twice. */
    for(unsigned cycle=0;cycle<2u;++cycle){
        feed_fixes(240u);assert_pool_accounting(3u);
        uint32_t prior_session=s_session_id;
        uint32_t prior_epoch=sb_storage_epoch_generation();
        uint64_t lost_before=s_recorder_lost;
        s_fail_sync_at=s_sync_count+1u;
        storage_step();recorder_step();
        assert(sb_storage_epoch_generation()!=prior_epoch&&s_record_fd<0);
        assert(s_recorder_lost==lost_before+240u);
        assert_pool_accounting(0u);
        assert(s_rollover_block_count==0u&&s_critical_outstanding==0u);
        recover_after_abort(prior_session);
    }

    /* STOP finalizes a partial builder while one completed block is queued. */
    feed_fixes(81u);assert_pool_accounting(1u);
    assert(sb_recorder_request_stop()==SB_ACCEPTED);recorder_step();
    assert_pool_accounting(2u);
    for(unsigned step=0;step<8u&&recorder_state!=SB_RECORDER_STOPPED;++step){
        if(uxQueueMessagesWaiting(s_req_q)!=0u)storage_step();
        recorder_step();
    }
    assert(recorder_state==SB_RECORDER_STOPPED&&s_sample_count==0u);
    assert_pool_accounting(0u);
    puts("PASS production Recorder/Storage/Transfer three-block pool: 10 Hz, explicit exhaustion loss, reuse, saturated rollover, repeated epoch abort/recovery, STOP");
    return 0;
}
