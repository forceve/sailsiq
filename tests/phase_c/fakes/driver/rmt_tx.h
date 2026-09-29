#pragma once
#include <stddef.h>
#include <stdint.h>
#include "rmt_encoder.h"
typedef void *rmt_channel_handle_t;
typedef struct { uint16_t duration0; uint8_t level0; uint16_t duration1; uint8_t level1; } rmt_symbol_word_t;
typedef struct { int gpio_num,clk_src;uint32_t resolution_hz;size_t mem_block_symbols,trans_queue_depth;struct { unsigned init_level:1; } flags; } rmt_tx_channel_config_t;
typedef struct { int loop_count; } rmt_transmit_config_t;
#define RMT_CLK_SRC_DEFAULT 0
int rmt_new_tx_channel(const rmt_tx_channel_config_t *config,rmt_channel_handle_t *channel);
int rmt_enable(rmt_channel_handle_t channel);
int rmt_transmit(rmt_channel_handle_t channel,rmt_encoder_handle_t encoder,const void *data,size_t size,const rmt_transmit_config_t *config);
int rmt_tx_wait_all_done(rmt_channel_handle_t channel,uint32_t timeout);
