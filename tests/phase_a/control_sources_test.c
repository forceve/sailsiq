#include "sailball/control_sources.h"
#include <assert.h>
#include <stdio.h>

int main(void)
{
    assert(SB_SOURCE_USB == 0 && SB_SOURCE_BLE == 1 && SB_SOURCE_WIFI == 2);
    assert(SB_SOURCE_CELLULAR == 3 && SB_SOURCE_COUNT == 4);
    assert(SB_CONTROL_ACTIVE_TX_QUEUES == 3);
    assert(sb_control_source_has_tx_queue(SB_SOURCE_USB));
    assert(sb_control_source_has_tx_queue(SB_SOURCE_BLE));
    assert(sb_control_source_has_tx_queue(SB_SOURCE_WIFI));
    assert(!sb_control_source_has_tx_queue(SB_SOURCE_CELLULAR));
    assert(!sb_control_source_has_tx_queue((sb_source_t)-1));
    puts("PASS Cellular source remains reserved; no active full-frame TX queue is allocated");
    return 0;
}
