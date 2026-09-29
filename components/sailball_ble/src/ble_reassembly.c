#include "ble_reassembly.h"
#include "sailball/common.h"
#include <string.h>

static void fail(sb_ble_reassembly_t *s)
{
    s->active=false;s->total=s->used=0;s->resync_any_id=true;
    if(s->errors!=UINT32_MAX)++s->errors;
}
void sb_ble_reassembly_reset(sb_ble_reassembly_t *s){if(s)memset(s,0,sizeof(*s));}
void sb_ble_reassembly_clear_logical(sb_ble_reassembly_t *s)
{
    if(!s)return;
    if(s->active)s->resync_any_id=true;
    s->active=false;s->total=s->used=0;s->last_fragment_us=0;
}
void sb_ble_reassembly_invalidate(sb_ble_reassembly_t *s){if(s)fail(s);}
bool sb_ble_reassembly_expire(sb_ble_reassembly_t *s,uint64_t now)
{
    if(s&&s->active&&now>=s->last_fragment_us&&now-s->last_fragment_us>SB_BLE_REASSEMBLY_TIMEOUT_US){fail(s);return true;}
    return false;
}
sb_ble_rx_result_t sb_ble_reassembly_feed(sb_ble_reassembly_t *s,const uint8_t *value,size_t length,
                                          uint64_t now,sb_ble_frame_fn on_frame,void *context)
{
    if(s==NULL||value==NULL||on_frame==NULL||length<SB_BLE_FRAGMENT_HEADER_SIZE+1u||length>SB_BLE_FRAGMENT_MAX_VALUE){if(s)fail(s);return SB_BLE_RX_ERROR;}
    if(sb_ble_reassembly_expire(s,now)&&sb_read_le16(value+2)!=0u)return SB_BLE_RX_ERROR;
    uint16_t frame_id=sb_read_le16(value),offset=sb_read_le16(value+2),total=sb_read_le16(value+4);
    size_t part=length-SB_BLE_FRAGMENT_HEADER_SIZE;
    if(s->active&&offset==0u&&frame_id!=s->active_id)fail(s);
    if(!s->active){
        if(offset!=0u||(!s->resync_any_id&&frame_id!=s->expected_id)||total<SB_SP_HEADER_SIZE+SB_SP_CRC_SIZE||
           total>SB_SP_MAX_FRAME||part>total){fail(s);return SB_BLE_RX_ERROR;}
        s->active=true;s->active_id=frame_id;s->total=total;s->used=0;
    }
    if(frame_id!=s->active_id||total!=s->total||offset!=s->used||part==0u||
       (uint32_t)offset+(uint32_t)part>total){fail(s);return SB_BLE_RX_ERROR;}
    memcpy(s->frame+offset,value+SB_BLE_FRAGMENT_HEADER_SIZE,part);s->used=(uint16_t)(s->used+part);s->last_fragment_us=now;
    if(s->used!=s->total)return SB_BLE_RX_INCOMPLETE;
    sb_sp_frame_t frame;
    if(!sb_sp_frame_decode(s->frame,s->total,SB_SP_MAX_RX_PAYLOAD,&frame)||!on_frame(context,&frame)){
        fail(s);return SB_BLE_RX_ERROR;
    }
    s->expected_id=(uint16_t)(frame_id+1u);s->resync_any_id=false;s->active=false;s->total=s->used=0;
    return SB_BLE_RX_COMPLETE;
}
