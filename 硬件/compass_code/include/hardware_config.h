#pragma once

#include <Arduino.h>

namespace hardware {

constexpr int8_t PIN_UNASSIGNED = -1;

namespace uart_gnss {
constexpr uint32_t BAUD_RATE = 115200;
constexpr uint32_t BAUD_CANDIDATES[] = {115200, 9600, 38400, 57600, 4800};
constexpr uint8_t NAV_RATE_HZ = 10;
constexpr size_t RX_BUFFER_BYTES = 4096;
constexpr int8_t TX = 17;
constexpr int8_t RX = 18;
}  // namespace uart_gnss

namespace uart_aux {
constexpr int8_t TX = 4;
constexpr int8_t RX = 5;
}  // namespace uart_aux

namespace spi_display {
constexpr uint32_t CLOCK_HZ = 80000000;
constexpr int8_t SCLK = 10;
constexpr int8_t MOSI = 11;
constexpr int8_t CS = 14;
constexpr int8_t DC = 13;
constexpr int8_t RST = 12;
constexpr int8_t TE = 21;
}  // namespace spi_display

namespace spi_sd {
constexpr int8_t SCLK = 40;
constexpr int8_t MOSI = 41;
constexpr int8_t MISO = 39;
constexpr int8_t CS = 42;
}  // namespace spi_sd

namespace i2c {
constexpr uint32_t CLOCK_HZ = 400000;
constexpr int8_t SDA = 6;
constexpr int8_t SCL = 7;

constexpr uint8_t BMI270_ADDR_PRIMARY = 0x68;
constexpr uint8_t BMI270_ADDR_SECONDARY = 0x69;
constexpr uint8_t BMI270_ADDR = BMI270_ADDR_PRIMARY;
constexpr uint8_t MMC5983MA_ADDR = 0x30;
}  // namespace i2c

namespace i2c_battery {
constexpr int8_t SDA = 1;
constexpr int8_t SCL = 2;
constexpr uint8_t BQ25890_ADDR = 0x6A;
}  // namespace i2c_battery

namespace imu {
constexpr uint32_t READ_RATE_HZ = 64;
constexpr uint32_t READ_INTERVAL_US = 1000000UL / READ_RATE_HZ;
}  // namespace imu

namespace switches {
constexpr int8_t SW1 = 47;
constexpr int8_t SW2 = 48;
constexpr int8_t SW3 = 9;
constexpr int8_t SW4 = 8;
constexpr bool ACTIVE_LOW = true;
constexpr uint32_t DEBOUNCE_MS = 25;
}  // namespace switches

}  // namespace hardware
