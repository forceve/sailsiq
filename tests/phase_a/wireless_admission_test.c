#include <assert.h>
#include <stdio.h>
#include "wireless_model_config.inc"
#include "sailball/wireless_budget_model.h"
#include "../../components/sailball_common/src/wireless_admission.c"
int main(void)
{
    const sb_wireless_budget_t b={40000,8000,4000,2000,12000,4000,4000,2000,8000,2000,1000,500};
    sb_wireless_heap_t h={60000,0,9000,16000,0,2500};
    sb_wireless_admission_t r;unsigned cases=0;
    assert(sb_wireless_admission_decide(&h,&b,&r));cases++;
    assert(r.required_internal_free==60000&&r.required_dma_free==16000&&r.required_internal_largest==9000&&r.required_dma_largest==2500);
    h.free_internal--;assert(!sb_wireless_admission_decide(&h,&b,&r)&&r.decision==SB_ADMISSION_INTERNAL_FREE);cases++;
    h.free_internal++;h.largest_internal--;assert(!sb_wireless_admission_decide(&h,&b,&r)&&r.decision==SB_ADMISSION_INTERNAL_FRAGMENTED);cases++;
    h.largest_internal++;h.free_dma--;assert(!sb_wireless_admission_decide(&h,&b,&r)&&r.decision==SB_ADMISSION_DMA_FREE);cases++;
    h.free_dma++;h.largest_dma--;assert(!sb_wireless_admission_decide(&h,&b,&r)&&r.decision==SB_ADMISSION_DMA_FRAGMENTED);cases++;
    h=(sb_wireless_heap_t){0};assert(!sb_wireless_admission_decide(&h,&b,&r));cases++;
    h=(sb_wireless_heap_t){100000,0,64000,20000,0,8000};assert(sb_wireless_admission_decide(&h,&b,&r));cases++;
    sb_wireless_budget_t bad=b;bad.future_internal=UINT32_MAX;
    assert(!sb_wireless_admission_decide(&h,&bad,&r)&&r.decision==SB_ADMISSION_INVALID_BUDGET);cases++;
    bad=b;bad.critical_internal=UINT32_MAX;assert(!sb_wireless_admission_decide(&h,&bad,&r));cases++;
    bad=b;bad.largest_internal_alloc=UINT32_MAX;assert(!sb_wireless_admission_decide(&h,&bad,&r));cases++;
    bad=b;bad.fragment_internal=UINT32_MAX;assert(!sb_wireless_admission_decide(&h,&bad,&r));cases++;
    bad=(sb_wireless_budget_t){0};assert(!sb_wireless_admission_decide(&h,&bad,&r));cases++;
    assert(!sb_wireless_admission_decide(NULL,&b,&r));cases++;
    assert(!sb_wireless_admission_decide(&h,NULL,&r));cases++;
    assert(!sb_wireless_admission_decide(&h,&b,NULL));cases++;
    bad=b;bad.future_dma=90000;assert(!sb_wireless_admission_decide(&h,&bad,&r));cases++;
    const sb_wireless_budget_t models[]={SB_BLE_BUDGET_INIT,SB_WIFI_COLD_BUDGET_INIT,SB_WIFI_RF_BUDGET_INIT};
    for(unsigned i=0;i<3;i++){
        h=(sb_wireless_heap_t){SB_TEST_INTERNAL_RAW_CEILING,0,SB_TEST_INITIAL_RAW_LARGEST,SB_TEST_MAIN_RAW_CEILING,0,SB_TEST_INITIAL_RAW_LARGEST};
        assert(sb_wireless_admission_decide(&h,&models[i],&r));cases++;
        h=(sb_wireless_heap_t){r.required_internal_free,0,r.required_internal_largest,r.required_dma_free,0,r.required_dma_largest};
        assert(sb_wireless_admission_decide(&h,&models[i],&r));cases++;
        const sb_wireless_heap_t boundary=h;
        for(unsigned dimension=0;dimension<4;dimension++){
            h=boundary;
            if(dimension==0)h.free_internal--;
            if(dimension==1)h.free_dma--;
            if(dimension==2)h.largest_internal--;
            if(dimension==3)h.largest_dma--;
            assert(!sb_wireless_admission_decide(&h,&models[i],&r));cases++;
        }
        h=(sb_wireless_heap_t){0};assert(!sb_wireless_admission_decide(&h,&models[i],&r));cases++;
    }
    printf("PASS %u admission/model boundary, capability, total, overflow and synthetic reachability cases\n",cases);
    return 0;
}
