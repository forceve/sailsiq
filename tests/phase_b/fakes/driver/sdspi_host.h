#pragma once
typedef struct sdspi_device_config { int host_id, gpio_cs; } sdspi_device_config_t;
#define SDSPI_DEVICE_CONFIG_DEFAULT() ((sdspi_device_config_t){0})
