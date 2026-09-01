#pragma once

#include <Arduino.h>

namespace logging {

constexpr uint32_t SD_SPI_HZ = 1000000UL;
constexpr uint32_t FLUSH_INTERVAL_MS = 1000;
constexpr uint16_t GNSS_FILE_BUFFER_SIZE = 65530;
constexpr size_t GNSS_WRITE_CHUNK_BYTES = 512;
constexpr size_t IMU_BUFFER_BYTES = 16384;

}  // namespace logging
