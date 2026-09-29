#include "sailball/control_tx_policy.h"
#include "sailball/sp.h"
#include <stdio.h>

#define CHECK(x) do{if(!(x)){fprintf(stderr,"FAIL %s:%d: %s\n",__FILE__,__LINE__,#x);return 1;}}while(0)

int main(void)
{
    CHECK(sb_control_tx_priority(SB_SP_RESPONSE,1u)==SB_CONTROL_TX_PRIORITY_RESPONSE);
    CHECK(sb_control_tx_priority(SB_SP_BULK,1u)==SB_CONTROL_TX_PRIORITY_BULK);
    CHECK(sb_control_tx_priority(SB_SP_STREAM,0u)==SB_CONTROL_TX_PRIORITY_LIVE);
    CHECK(sb_control_tx_priority(SB_SP_EVENT,3u)==SB_CONTROL_TX_PRIORITY_IMPORTANT_EVENT);
    CHECK(sb_control_tx_priority(SB_SP_EVENT,4u)==SB_CONTROL_TX_PRIORITY_IMPORTANT_EVENT);
    CHECK(sb_control_tx_priority(SB_SP_EVENT,8u)==SB_CONTROL_TX_PRIORITY_IMPORTANT_EVENT);
    CHECK(sb_control_tx_priority(SB_SP_EVENT,7u)==SB_CONTROL_TX_PRIORITY_EVENT);

    CHECK(sb_control_tx_select(true,true,true,true)==SB_CONTROL_TX_QUEUE_TERMINAL);
    CHECK(sb_control_tx_select(false,true,true,true)==SB_CONTROL_TX_QUEUE_IMPORTANT);
    CHECK(sb_control_tx_select(false,false,true,true)==SB_CONTROL_TX_QUEUE_BULK);
    CHECK(sb_control_tx_select(false,false,false,true)==SB_CONTROL_TX_QUEUE_MISC);
    CHECK(sb_control_tx_select(false,false,false,false)==SB_CONTROL_TX_QUEUE_NONE);
    CHECK(sb_control_tx_select_fair(false,true,true,true,0,4,0,4)==SB_CONTROL_TX_QUEUE_IMPORTANT);
    CHECK(sb_control_tx_select_fair(false,true,true,true,0,4,3,4)==SB_CONTROL_TX_QUEUE_IMPORTANT);
    CHECK(sb_control_tx_select_fair(false,true,true,true,0,4,4,4)==SB_CONTROL_TX_QUEUE_BULK);
    CHECK(sb_control_tx_select_fair(true,true,true,true,0,4,4,4)==SB_CONTROL_TX_QUEUE_TERMINAL);
    CHECK(sb_control_tx_select_fair(true,true,true,true,4,4,4,4)==SB_CONTROL_TX_QUEUE_BULK);
    CHECK(sb_control_tx_select_fair(false,false,true,true,0,4,0,4)==SB_CONTROL_TX_QUEUE_BULK);

    CHECK(sb_control_tx_misc_replace(SB_CONTROL_TX_PRIORITY_LIVE,SB_CONTROL_TX_PRIORITY_EVENT));
    CHECK(sb_control_tx_misc_replace(SB_CONTROL_TX_PRIORITY_EVENT,SB_CONTROL_TX_PRIORITY_EVENT));
    CHECK(!sb_control_tx_misc_replace(SB_CONTROL_TX_PRIORITY_IMPORTANT_EVENT,SB_CONTROL_TX_PRIORITY_LIVE));
    puts("PASS production Control TX priority selection and bounded misc replacement policy");
    return 0;
}
