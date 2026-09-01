#pragma once

#include <Arduino.h>
#include <SPI.h>
#include <ST7305_4p2_BW_DisplayDriver.h>
#include <lvgl.h>

#include "hardware_config.h"

class DisplayService {
 public:
  bool begin();
  void update();
  void requestRedraw();

 private:
#if LVGL_VERSION_MAJOR >= 9
  static void flush(lv_display_t *display, const lv_area_t *area,
                    uint8_t *px_map);
  void flushArea(lv_display_t *display, const lv_area_t *area,
                 uint8_t *px_map);
#else
  static void flush(lv_disp_drv_t *disp_drv, const lv_area_t *area,
                    lv_color_t *color_p);
  void flushArea(lv_disp_drv_t *disp_drv, const lv_area_t *area,
                 lv_color_t *color_p);
#endif

  static DisplayService *instance_;

  ST7305_4p2_BW_DisplayDriver panel_{
      hardware::spi_display::DC, hardware::spi_display::RST,
      hardware::spi_display::CS, hardware::spi_display::SCLK,
      hardware::spi_display::MOSI, SPI};
#if LVGL_VERSION_MAJOR >= 9
  lv_display_t *display_ = nullptr;
#else
  lv_disp_drv_t disp_drv_ = {};
  lv_disp_draw_buf_t draw_buf_ = {};
#endif
  uint32_t last_tick_ms_ = 0;
  uint32_t last_ui_tick_ms_ = 0;
};
