#pragma once

#include <stdbool.h>
#include <stdint.h>
#include "esp_err.h"

typedef struct {
    uint64_t device_id;
    uint32_t boot_id;
    bool gnss_configured;
    bool sd_configured;
    bool boot_button_configured;
    bool led_configured;
    bool usb_native;
    int gnss_uart_port;
    int gnss_rx_gpio;
    int gnss_tx_gpio;
    int sd_spi_host;
    int sd_cs_gpio;
    int sd_mosi_gpio;
    int sd_sclk_gpio;
    int sd_miso_gpio;
    int led_gpio;
    int boot_gpio;
    int usb_dminus_gpio;
    int usb_dplus_gpio;
    const char *hardware_revision;
} sb_board_info_t;

esp_err_t sb_board_init(void);
void sb_board_get_info(sb_board_info_t *out);
