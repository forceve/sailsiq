#include "storage_policy.h"
#include "sailball/ldc.h"
#include <stdint.h>
#include <stdio.h>

#define CHECK(x) do{if(!(x)){fprintf(stderr,"FAIL %s:%d: %s\n",__FILE__,__LINE__,#x);return 1;}}while(0)

int main(void)
{
    const uint64_t target=sb_storage_policy_file_target(UINT64_C(16)*1024u*1024u);
    CHECK(target==UINT64_C(4)*1024u*1024u);
    CHECK(sb_storage_policy_file_target(1u)==(uint64_t)SB_LDC_DATA_OFFSET+8192u);
    CHECK(sb_storage_policy_file_target(UINT64_C(1)<<40u)==UINT64_C(0xFFFFFFFF));
    CHECK(sb_storage_policy_create_space(81920u,65536u,16384u));
    CHECK(!sb_storage_policy_create_space(81919u,65536u,16384u));
    CHECK(!sb_storage_policy_create_space(UINT64_MAX,UINT64_MAX,1u));
    CHECK(sb_storage_policy_commit_space(66536u,1000u,65536u));
    CHECK(!sb_storage_policy_commit_space(66535u,1000u,65536u));
    CHECK(!sb_storage_policy_commit_space(UINT64_MAX,UINT64_MAX,1u));
    CHECK(!sb_storage_policy_rollover(target-100u,target,100u));
    CHECK(sb_storage_policy_rollover(target-99u,target,100u));
    CHECK(sb_storage_policy_rollover(target+1u,target,1u));
    CHECK(sb_storage_policy_can_format(true,false,false,0u,0u));
    CHECK(!sb_storage_policy_can_format(false,false,false,0u,0u));
    CHECK(!sb_storage_policy_can_format(true,true,false,0u,0u));
    CHECK(!sb_storage_policy_can_format(true,false,true,0u,0u));
    CHECK(!sb_storage_policy_can_format(true,false,false,1u,0u));
    CHECK(!sb_storage_policy_can_format(true,false,false,0u,1u));
    CHECK(!sb_storage_policy_service_background(true,true,3u,4u));
    CHECK(sb_storage_policy_service_background(true,true,4u,4u));
    CHECK(sb_storage_policy_service_background(false,true,0u,4u));
    CHECK(!sb_storage_policy_service_background(true,false,255u,4u));
    unsigned critical=0u,background=0u;uint8_t burst=0u;
    for(unsigned i=0;i<40u;++i){
        if(sb_storage_policy_service_background(true,true,burst,4u)){
            ++background;burst=0u;
        }else{
            ++critical;if(burst<4u)++burst;
        }
    }
    CHECK(critical==32u&&background==8u);
    puts("PASS production Storage space/rollover policy and bounded critical/background service under sustained critical load");
    return 0;
}
