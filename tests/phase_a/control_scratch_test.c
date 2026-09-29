#include <assert.h>
#include <stdio.h>
#include <string.h>
#include "sailball/sp.h"
#include "sailball/storage.h"
#include "sailball/diagnostics.h"
static uint32_t s_client_rx_limit[SB_SOURCE_COUNT]={2048,2048,2048,2048};
static union {
    sb_cbor_map_t map;
    sb_storage_file_info_t entries[SB_STORAGE_LIST_MAX];
    sb_diag_snapshot_t counters;
    sb_error_record_t errors[32];
} s_encode_scratch;
sb_status_t sb_storage_list_files(uint32_t offset,uint8_t limit,sb_storage_file_info_t *entries,
    size_t capacity,size_t *count,uint32_t *next_offset,bool *complete)
{
    assert(offset==17&&limit==32&&capacity==32);
    memset(entries,0,capacity*sizeof(*entries));
    for(unsigned i=0;i<32;++i){snprintf(entries[i].file_name,64,"SB_TEST_%u.ldc",i);entries[i].readable_size=123456+i;}
    *count=32;*next_offset=49;*complete=true;return SB_OK;
}
void sb_diag_snapshot(sb_diag_snapshot_t *out)
{for(unsigned g=0;g<SB_DIAG_GROUP_COUNT;++g)for(unsigned c=0;c<SB_DIAG_COUNTERS_PER_GROUP;++c)out->value[g][c]=g*100+c;}
size_t sb_diag_get_errors(uint32_t after_id,bool has_after,size_t limit,sb_error_record_t *out,uint32_t *oldest,uint32_t *newest)
{
    assert(after_id==4&&has_after&&limit==32);memset(out,0,32*sizeof(*out));
    for(unsigned i=0;i<32;++i){out[i].error_id=i+5;out[i].first_mono_us=out[i].last_mono_us=123456+i;out[i].service_id=4;out[i].error_code=2;out[i].occurrence_count=1;}
    *oldest=5;*newest=36;return 32;
}
#include "control_init.inc"
int main(void)
{
    for(unsigned adapter=0;adapter<3;++adapter){
        uint8_t original[2048]={0},separate[2048]={0},inplace[2048]={0};size_t in=0;
        if(adapter==1){assert(sb_cbor_put_map(original,sizeof(original),&in,1));assert(sb_cbor_put_uint(original,sizeof(original),&in,0));assert(sb_cbor_put_uint(original,sizeof(original),&in,63));}
        else{assert(sb_cbor_put_map(original,sizeof(original),&in,2));assert(sb_cbor_put_uint(original,sizeof(original),&in,0));assert(sb_cbor_put_uint(original,sizeof(original),&in,adapter==0?17:4));
            assert(sb_cbor_put_uint(original,sizeof(original),&in,1));assert(sb_cbor_put_uint(original,sizeof(original),&in,32));}
        size_t lengths[2]={0};sb_status_t status;
        for(unsigned alias=0;alias<2;++alias){
            memcpy(inplace,original,in);assert(sb_cbor_parse_map(inplace,in,&s_encode_scratch.map));uint8_t *out=alias?inplace:separate;
            bool ok=adapter==0?encode_storage_list(&s_encode_scratch.map,SB_SOURCE_USB,out,2048,&lengths[alias],&status):
                adapter==1?encode_counters(&s_encode_scratch.map,out,2048,&lengths[alias],&status):encode_errors(&s_encode_scratch.map,out,2048,&lengths[alias],&status);
            assert(ok&&status==SB_OK);
        }
        assert(lengths[0]==lengths[1]&&memcmp(separate,inplace,lengths[0])==0);
        sb_cbor_map_t result;assert(sb_cbor_parse_map(inplace,lengths[1],&result));
    }
    puts("PASS production Control scratch: LIST/counters/errors, separate vs in-place CBOR bytes identical");return 0;
}
