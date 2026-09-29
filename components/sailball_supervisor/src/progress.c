#include "sailball/progress.h"

static bool stale(uint64_t now_us, uint64_t timestamp_us, uint64_t timeout_ms)
{
    return timestamp_us == 0 || now_us < timestamp_us ||
           now_us - timestamp_us > timeout_ms * UINT64_C(1000);
}

sb_progress_cause_t sb_progress_evaluate(const sb_progress_input_t *input)
{
    if (input == NULL) return SB_PROGRESS_STORAGE_NOT_READY;
    if (!input->recording_intent) {
        if (input->storage_state == SB_STORAGE_ERROR) return SB_PROGRESS_STORAGE_NOT_READY;
        return input->recorder_state == SB_RECORDER_STOPPED ? SB_PROGRESS_IDLE : SB_PROGRESS_RECORDER_NOT_READY;
    }
    if (input->storage_state != SB_STORAGE_READY) return SB_PROGRESS_STORAGE_NOT_READY;
    if (input->gnss_state == SB_GNSS_ERROR) return SB_PROGRESS_GNSS_ERROR;
    if (stale(input->now_us,input->gnss_last_rx_us,input->sample_timeout_ms)) return SB_PROGRESS_GNSS_NO_RX;
    if (input->recorder_state != SB_RECORDER_RECORDING) return SB_PROGRESS_RECORDER_NOT_READY;
    if (stale(input->now_us,input->recorder_last_sample_us,input->sample_timeout_ms))
        return SB_PROGRESS_RECORDER_NOT_CONSUMING;
    uint64_t commit_timeout_ms = input->commit_grace_ms > input->sample_timeout_ms
        ? input->commit_grace_ms : input->sample_timeout_ms;
    /* READY/mounted and a live Recorder task do not prove the recovered
     * recording path durable. Require a commit from this Recorder session. */
    if(input->recorder_last_commit_us==0||
       input->recorder_last_commit_us<=input->recorder_start_mono_us){
        if(input->now_us>=input->recorder_start_mono_us&&
           input->now_us-input->recorder_start_mono_us>commit_timeout_ms*UINT64_C(1000))
            return SB_PROGRESS_STORAGE_COMMIT_STALLED;
        return SB_PROGRESS_AWAITING_FIRST_COMMIT;
    }
    uint64_t commit_reference = input->recorder_last_commit_us != 0
        ? input->recorder_last_commit_us : input->recorder_start_mono_us;
    if (input->recorder_last_sample_us > commit_reference && commit_reference != 0 &&
        input->now_us >= commit_reference &&
        input->now_us - commit_reference > commit_timeout_ms * UINT64_C(1000))
        return SB_PROGRESS_STORAGE_COMMIT_STALLED;
    return SB_PROGRESS_HEALTHY;
}
