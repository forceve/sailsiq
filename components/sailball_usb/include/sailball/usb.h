#pragma once
#include "esp_err.h"
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
esp_err_t sb_usb_init(void);
bool sb_usb_is_connected(void);
int sb_usb_read(uint8_t *buffer, size_t capacity, uint32_t timeout_ms);
int sb_usb_write(const uint8_t *buffer, size_t length, uint32_t timeout_ms);
esp_err_t sb_transport_start(void);
