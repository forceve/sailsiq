#include "ble_reassembly.h"
#include "sailball/common.h"
#include <stdio.h>
#include <string.h>

#define CHECK(x) do{if(!(x)){fprintf(stderr,"FAIL %s:%d: %s\n",__FILE__,__LINE__,#x);return 1;}}while(0)
typedef struct{unsigned count;uint32_t last_request;uint8_t payload[64];size_t length;} capture_t;
static bool capture(void *context,const sb_sp_frame_t *frame)
{capture_t*c=context;if(frame->payload_length>sizeof(c->payload))return false;c->last_request=frame->request_id;c->length=frame->payload_length;if(c->length)memcpy(c->payload,frame->payload,c->length);++c->count;return true;}
static size_t make_frame(uint8_t *out,uint32_t request,const uint8_t *payload,size_t n)
{size_t written=0;sb_sp_frame_t f={.major=1,.minor=0,.type=SB_SP_REQUEST,.service_id=1,.message_id=1,.request_id=request,.sequence=1,.payload=payload,.payload_length=(uint32_t)n};return sb_sp_frame_encode(&f,out,SB_SP_MAX_FRAME,&written)?written:0;}
static sb_ble_rx_result_t fragment(sb_ble_reassembly_t*s,const uint8_t*frame,size_t frame_n,uint16_t id,uint16_t offset,uint16_t part,uint64_t now,capture_t*c)
{uint8_t value[SB_BLE_FRAGMENT_MAX_VALUE];sb_write_le16(value,id);sb_write_le16(value+2,offset);sb_write_le16(value+4,(uint16_t)frame_n);memcpy(value+6,frame+offset,part);return sb_ble_reassembly_feed(s,value,(size_t)part+6u,now,capture,c);}
int main(void)
{
    sb_ble_reassembly_t state;capture_t c={0};uint8_t payload[]={0,1,2,0,3,4,5};uint8_t frame[SB_SP_MAX_FRAME];size_t n=make_frame(frame,17,payload,sizeof(payload));CHECK(n>20u);
    sb_ble_reassembly_reset(&state);
    CHECK(fragment(&state,frame,n,0,0,10,1000,&c)==SB_BLE_RX_INCOMPLETE);
    CHECK(fragment(&state,frame,n,0,10,(uint16_t)(n-10u),2000,&c)==SB_BLE_RX_COMPLETE);
    CHECK(c.count==1&&c.last_request==17&&c.length==sizeof(payload)&&memcmp(c.payload,payload,sizeof(payload))==0);
    CHECK(fragment(&state,frame,n,1,0,(uint16_t)n,3000,&c)==SB_BLE_RX_COMPLETE); /* one fragment */

    /* A logical SP HELLO reset does not restart the physical BLE frame_id. */
    CHECK(state.expected_id==2u);
    sb_ble_reassembly_clear_logical(&state);
    CHECK(state.expected_id==2u&&!state.active);
    CHECK(fragment(&state,frame,n,2,0,(uint16_t)n,3001,&c)==SB_BLE_RX_COMPLETE);
    CHECK(state.expected_id==3u);

    sb_ble_reassembly_reset(&state);
    CHECK(fragment(&state,frame,n,65535,0,(uint16_t)n,1,&c)==SB_BLE_RX_ERROR); /* new link starts at zero */
    sb_ble_reassembly_reset(&state);
    CHECK(fragment(&state,frame,n,0,0,(uint16_t)n,1,&c)==SB_BLE_RX_COMPLETE);
    CHECK(fragment(&state,frame,n,1,0,(uint16_t)n,2,&c)==SB_BLE_RX_COMPLETE);
    state.expected_id=65535u;
    CHECK(fragment(&state,frame,n,65535,0,(uint16_t)n,3,&c)==SB_BLE_RX_COMPLETE);
    CHECK(fragment(&state,frame,n,0,0,(uint16_t)n,4,&c)==SB_BLE_RX_COMPLETE); /* uint16 wrap */

    sb_ble_reassembly_reset(&state);
    CHECK(fragment(&state,frame,n,9,1,5,1,&c)==SB_BLE_RX_ERROR); /* nonzero without assembly */
    CHECK(fragment(&state,frame,n,42,0,(uint16_t)n,2,&c)==SB_BLE_RX_COMPLETE); /* recover with arbitrary new id */
    CHECK(fragment(&state,frame,n,43,0,10,10,&c)==SB_BLE_RX_INCOMPLETE);
    CHECK(sb_ble_reassembly_expire(&state,SB_BLE_REASSEMBLY_TIMEOUT_US+11u));
    CHECK(fragment(&state,frame,n,99,0,(uint16_t)n,SB_BLE_REASSEMBLY_TIMEOUT_US+12u,&c)==SB_BLE_RX_COMPLETE);

    CHECK(fragment(&state,frame,n,100,0,10,20,&c)==SB_BLE_RX_INCOMPLETE);
    CHECK(fragment(&state,frame,n,100,0,10,21,&c)==SB_BLE_RX_ERROR); /* duplicate */
    CHECK(fragment(&state,frame,n,101,0,10,22,&c)==SB_BLE_RX_INCOMPLETE);
    CHECK(fragment(&state,frame,n,101,11,10,23,&c)==SB_BLE_RX_ERROR); /* gap */
    CHECK(fragment(&state,frame,n,102,0,10,24,&c)==SB_BLE_RX_INCOMPLETE);
    uint8_t changed[SB_BLE_FRAGMENT_MAX_VALUE];sb_write_le16(changed,102);sb_write_le16(changed+2,10);sb_write_le16(changed+4,(uint16_t)(n+1u));memcpy(changed+6,frame+10,5);
    CHECK(sb_ble_reassembly_feed(&state,changed,11,25,capture,&c)==SB_BLE_RX_ERROR); /* changed total */
    CHECK(fragment(&state,frame,n,103,0,10,26,&c)==SB_BLE_RX_INCOMPLETE);
    CHECK(fragment(&state,frame,n,103,9,10,27,&c)==SB_BLE_RX_ERROR); /* overlap */
    CHECK(fragment(&state,frame,n,104,0,10,28,&c)==SB_BLE_RX_INCOMPLETE);
    CHECK(fragment(&state,frame,n,104,10,(uint16_t)(n-10u),29,&c)==SB_BLE_RX_COMPLETE);
    CHECK(fragment(&state,frame,n,105,0,10,30,&c)==SB_BLE_RX_INCOMPLETE);
    sb_ble_reassembly_invalidate(&state); /* bounded callback handoff full after a partial frame */
    CHECK(!state.active);
    CHECK(fragment(&state,frame,n,500,0,(uint16_t)n,31,&c)==SB_BLE_RX_COMPLETE); /* next new frame recovers */
    CHECK(fragment(&state,frame,n,501,0,10,32,&c)==SB_BLE_RX_INCOMPLETE); /* disconnect with pending assembly */
    sb_ble_reassembly_reset(&state); /* disconnect/reconnect resets to frame id 0 */
    CHECK(fragment(&state,frame,n,1,0,(uint16_t)n,33,&c)==SB_BLE_RX_ERROR);
    CHECK(fragment(&state,frame,n,0,0,(uint16_t)n,34,&c)==SB_BLE_RX_COMPLETE);
    puts("PASS production BLE reassembly: fragmentation, timeout, malformed recovery, overflow invalidation, disconnect reset");
    return 0;
}
