#pragma once

#include "sailball/common.h"

/* Cellular stays reserved in the protocol/source map, but v1 has no Cellular
 * transport. Keep its identifier/counter slot without a full-frame TX queue. */
enum { SB_CONTROL_ACTIVE_TX_QUEUES = SB_SOURCE_CELLULAR };

_Static_assert(SB_SOURCE_USB == 0 && SB_SOURCE_BLE == 1 && SB_SOURCE_WIFI == 2 &&
               SB_SOURCE_CELLULAR == 3 && SB_SOURCE_COUNT == 4,
               "Update Control queue map with source IDs");

static inline bool sb_control_source_has_tx_queue(sb_source_t source)
{
    return (unsigned)source < SB_CONTROL_ACTIVE_TX_QUEUES;
}
