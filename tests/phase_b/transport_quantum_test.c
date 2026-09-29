#include "sailball/transport_quantum.h"
#include "ble_reassembly.h"
#include "sailball/common.h"
#include <stdio.h>
#include <string.h>

#define CHECK(x) do{if(!(x)){fprintf(stderr,"FAIL %s:%d: %s\n",__FILE__,__LINE__,#x);return 1;}}while(0)

static int simulate_slow_link(size_t quantum,size_t accepted_per_poll)
{
    size_t offset=0u;
    unsigned turns=0u,ble_fragments=0u;
    while(offset<2048u&&turns<100u){
        size_t offered=sb_transport_tx_quantum(2048u-offset,quantum);
        CHECK(offered<=quantum);
        size_t accepted=accepted_per_poll<offered?accepted_per_poll:offered;
        offset=sb_transport_tx_advance(offset,2048u,accepted);
        /* The production transport loop returns to BLE service once per turn. */
        ++ble_fragments;
        ++turns;
    }
    CHECK(offset==2048u);
    CHECK(ble_fragments==turns);
    CHECK(turns>1u);
    return 0;
}

typedef struct{unsigned frames;uint32_t request_id;uint8_t payload[600];size_t length;} ble_capture_t;
static bool capture_frame(void *context,const sb_sp_frame_t *frame)
{
    ble_capture_t *capture=context;
    if(frame->payload_length>sizeof(capture->payload))return false;
    capture->request_id=frame->request_id;capture->length=frame->payload_length;
    if(capture->length)memcpy(capture->payload,frame->payload,capture->length);
    ++capture->frames;return true;
}

static int simulate_slow_link_with_ble(size_t accepted_per_poll)
{
    uint8_t payload[600],raw[SB_SP_MAX_FRAME];
    for(size_t i=0;i<sizeof(payload);++i)payload[i]=(uint8_t)(i*37u);
    sb_sp_frame_t frame={.major=1,.minor=0,.type=SB_SP_REQUEST,.service_id=1,.message_id=1,
        .request_id=73u,.sequence=1u,.payload=payload,.payload_length=sizeof(payload)};
    size_t frame_length=0u;
    CHECK(sb_sp_frame_encode(&frame,raw,sizeof(raw),&frame_length));
    CHECK(frame_length>508u);
    sb_ble_reassembly_t reassembly;sb_ble_reassembly_reset(&reassembly);
    ble_capture_t capture={0};size_t tx_offset=0u,rx_offset=0u;
    unsigned turns=0u;uint64_t now=1000u;
    while(tx_offset<2048u&&turns<100u){
        size_t offered=sb_transport_tx_quantum(2048u-tx_offset,512u);
        size_t accepted=accepted_per_poll<offered?accepted_per_poll:offered;
        tx_offset=sb_transport_tx_advance(tx_offset,2048u,accepted);

        /* This mirrors the statically checked production loop contract:
         * one BLE owner-service opportunity follows each bounded link turn. */
        if(rx_offset<frame_length){
            uint8_t value[SB_BLE_FRAGMENT_MAX_VALUE];
            size_t part=frame_length-rx_offset;
            if(part>SB_BLE_FRAGMENT_MAX_VALUE-SB_BLE_FRAGMENT_HEADER_SIZE)
                part=SB_BLE_FRAGMENT_MAX_VALUE-SB_BLE_FRAGMENT_HEADER_SIZE;
            sb_write_le16(value,0u);sb_write_le16(value+2,(uint16_t)rx_offset);
            sb_write_le16(value+4,(uint16_t)frame_length);
            memcpy(value+SB_BLE_FRAGMENT_HEADER_SIZE,raw+rx_offset,part);
            CHECK(sb_ble_reassembly_feed(&reassembly,value,part+SB_BLE_FRAGMENT_HEADER_SIZE,
                now++,capture_frame,&capture)==(rx_offset+part==frame_length?SB_BLE_RX_COMPLETE:SB_BLE_RX_INCOMPLETE));
            rx_offset+=part;
        }
        ++turns;
    }
    CHECK(tx_offset==2048u&&rx_offset==frame_length);
    CHECK(capture.frames==1u&&capture.request_id==73u&&capture.length==sizeof(payload));
    CHECK(memcmp(capture.payload,payload,sizeof(payload))==0);
    CHECK(turns>1u);
    return 0;
}

int main(void)
{
    CHECK(sb_transport_tx_quantum(0u,512u)==0u);
    CHECK(sb_transport_tx_quantum(513u,512u)==512u);
    CHECK(sb_transport_tx_advance(100u,1000u,0u)==100u);
    CHECK(sb_transport_tx_advance(900u,1000u,512u)==1000u);
    CHECK(simulate_slow_link(512u,37u)==0); /* USB partial write */
    CHECK(simulate_slow_link(512u,113u)==0); /* TCP partial send */
    CHECK(simulate_slow_link_with_ble(37u)==0); /* slow USB while BLE fragments arrive */
    CHECK(simulate_slow_link_with_ble(113u)==0); /* slow TCP while BLE fragments arrive */
    puts("PASS bounded USB/TCP partial TX with production BLE reassembly serviced between slow-send turns");
    return 0;
}
