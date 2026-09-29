#pragma once
#include "esp_err.h"
#include <stdbool.h>
#include <stdint.h>

typedef struct {
    bool critical_path_healthy;
    bool gnss_available, storage_ready, usb_connected, ble_connected, wifi_online;
} sb_ui_status_t;
typedef void (*sb_ui_status_provider_t)(sb_ui_status_t *out);

esp_err_t sb_ui_start(void);
uint8_t sb_ui_get_page(void);
bool sb_ui_set_page(uint8_t page);
void sb_ui_set_status_provider(sb_ui_status_provider_t provider);
