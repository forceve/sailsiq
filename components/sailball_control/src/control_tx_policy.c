#include "sailball/control_tx_policy.h"
#include "sailball/sp.h"

uint8_t sb_control_tx_priority(uint8_t frame_type, uint16_t service_id)
{
    if(frame_type==SB_SP_RESPONSE)return SB_CONTROL_TX_PRIORITY_RESPONSE;
    if(frame_type==SB_SP_BULK)return SB_CONTROL_TX_PRIORITY_BULK;
    if(frame_type==SB_SP_STREAM)return SB_CONTROL_TX_PRIORITY_LIVE;
    if(frame_type==SB_SP_EVENT){
        if(service_id==3u||service_id==4u||service_id==8u)return SB_CONTROL_TX_PRIORITY_IMPORTANT_EVENT;
        return SB_CONTROL_TX_PRIORITY_EVENT;
    }
    return SB_CONTROL_TX_PRIORITY_EVENT;
}

bool sb_control_tx_misc_replace(uint8_t current_priority,uint8_t incoming_priority)
{
    return incoming_priority<=current_priority;
}

sb_control_tx_queue_t sb_control_tx_select(bool terminal,bool important,bool bulk,bool misc)
{
    if(terminal)return SB_CONTROL_TX_QUEUE_TERMINAL;
    if(important)return SB_CONTROL_TX_QUEUE_IMPORTANT;
    if(bulk)return SB_CONTROL_TX_QUEUE_BULK;
    if(misc)return SB_CONTROL_TX_QUEUE_MISC;
    return SB_CONTROL_TX_QUEUE_NONE;
}

sb_control_tx_queue_t sb_control_tx_select_fair(bool terminal,bool important,bool bulk,bool misc,
                                                unsigned terminal_streak,unsigned terminal_limit,
                                                unsigned important_streak,unsigned important_limit)
{
    if(terminal&&bulk&&terminal_limit!=0u&&terminal_streak>=terminal_limit)
        return SB_CONTROL_TX_QUEUE_BULK;
    if(terminal)return SB_CONTROL_TX_QUEUE_TERMINAL;
    if(important&&bulk&&important_limit!=0u&&important_streak>=important_limit)
        return SB_CONTROL_TX_QUEUE_BULK;
    if(important)return SB_CONTROL_TX_QUEUE_IMPORTANT;
    if(bulk)return SB_CONTROL_TX_QUEUE_BULK;
    if(misc)return SB_CONTROL_TX_QUEUE_MISC;
    return SB_CONTROL_TX_QUEUE_NONE;
}
