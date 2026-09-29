#pragma once

#include <stdbool.h>
#include <stdint.h>

typedef enum {
    SB_CONTROL_TX_PRIORITY_RESPONSE = 0,
    SB_CONTROL_TX_PRIORITY_IMPORTANT_EVENT = 1,
    SB_CONTROL_TX_PRIORITY_BULK = 2,
    SB_CONTROL_TX_PRIORITY_EVENT = 3,
    SB_CONTROL_TX_PRIORITY_LIVE = 4
} sb_control_tx_priority_t;

typedef enum {
    SB_CONTROL_TX_QUEUE_NONE = 0,
    SB_CONTROL_TX_QUEUE_TERMINAL,
    SB_CONTROL_TX_QUEUE_IMPORTANT,
    SB_CONTROL_TX_QUEUE_BULK,
    SB_CONTROL_TX_QUEUE_MISC
} sb_control_tx_queue_t;

uint8_t sb_control_tx_priority(uint8_t frame_type, uint16_t service_id);
bool sb_control_tx_misc_replace(uint8_t current_priority, uint8_t incoming_priority);
sb_control_tx_queue_t sb_control_tx_select(bool terminal, bool important,
                                           bool bulk, bool misc);
sb_control_tx_queue_t sb_control_tx_select_fair(bool terminal, bool important,
                                                bool bulk, bool misc,
                                                unsigned terminal_streak,
                                                unsigned terminal_limit,
                                                unsigned important_streak,
                                                unsigned important_limit);
