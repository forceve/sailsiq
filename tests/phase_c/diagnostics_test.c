#include <assert.h>
#include <stdio.h>
#include "../../components/sailball_diagnostics/src/diagnostics.c"

static uint64_t s_now=100u;
uint64_t sb_monotonic_us(void){return s_now++;}
sb_wireless_heap_t sb_wireless_measure_heap(void){return (sb_wireless_heap_t){0};}
size_t heap_caps_get_free_size(uint32_t caps){(void)caps;return 0;}
size_t heap_caps_get_minimum_free_size(uint32_t caps){(void)caps;return 0;}
size_t heap_caps_get_largest_free_block(uint32_t caps){(void)caps;return 0;}

int main(void)
{
    sb_diag_add(SB_DIAG_STORAGE,4,UINT64_MAX-1u);
    sb_diag_increment(SB_DIAG_STORAGE,4);sb_diag_increment(SB_DIAG_STORAGE,4);
    sb_diag_max(SB_DIAG_STORAGE,4,UINT64_MAX-1u);
    sb_diag_snapshot_t counters;sb_diag_snapshot(&counters);
    assert(counters.value[SB_DIAG_STORAGE][4]==UINT64_MAX);

    assert(sb_diag_raise(4,2,1,false,0)==1u);
    for(uint32_t i=0;i<SB_ERROR_RING_CAPACITY;++i)assert(sb_diag_raise(4,3,1,false,0)==i+2u);
    sb_error_record_t records[32];uint32_t oldest=0,newest=0;
    assert(sb_diag_get_errors(0,false,32,records,&oldest,&newest)==32u);
    assert(oldest==2u&&newest==33u&&records[0].error_id==2u&&records[31].error_id==33u);
    assert(sb_diag_raise(7,1,1,false,0)==0u); /* Frozen v1 has no BLE error-code allocation. */
    assert(sb_diag_raise(4,3,3,false,0)==0u);
    sb_diag_clear_errors();
    assert(sb_diag_get_errors(0,false,32,NULL,&oldest,&newest)==0u&&oldest==0u&&newest==0u);
    assert(sb_diag_raise(4,2,1,false,0)==34u); /* clear never rewinds public IDs */

    s_count=0;s_head=0;s_next_error_id=UINT32_MAX;s_error_ids_exhausted=false;
    assert(sb_diag_raise(4,2,1,false,0)==UINT32_MAX);
    assert(sb_diag_raise(4,2,1,false,0)==0u); /* no uint32 wrap/reused ID */
    puts("PASS production Diagnostics: saturating counters, bounded chronological ring, legal error IDs, clear semantics and ID exhaustion");
    return 0;
}
