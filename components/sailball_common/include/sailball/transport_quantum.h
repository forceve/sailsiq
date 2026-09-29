#pragma once

#include <stddef.h>

static inline size_t sb_transport_tx_quantum(size_t remaining,size_t maximum)
{
    return remaining<maximum?remaining:maximum;
}

static inline size_t sb_transport_tx_advance(size_t offset,size_t total,size_t written)
{
    if(offset>=total)return total;
    size_t remaining=total-offset;
    if(written>remaining)written=remaining;
    return offset+written;
}
