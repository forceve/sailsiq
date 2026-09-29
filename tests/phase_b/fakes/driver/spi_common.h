#pragma once
#include "esp_err.h"
typedef struct { int mosi_io_num, miso_io_num, sclk_io_num, quadwp_io_num, quadhd_io_num, max_transfer_sz; } spi_bus_config_t;
#define SPI_DMA_CH_AUTO 0
esp_err_t spi_bus_initialize(int host, const spi_bus_config_t *bus, int dma);
esp_err_t spi_bus_free(int host);
