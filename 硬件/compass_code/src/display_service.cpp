#include "display_service.h"

#include <ui.h>

namespace {

constexpr int32_t kUiWidth = 400;
constexpr int32_t kUiHeight = 300;
constexpr int32_t kDrawRows = 20;
constexpr uint32_t kUiTickIntervalMs = 1000;

#if LVGL_VERSION_MAJOR >= 9
LV_ATTRIBUTE_MEM_ALIGN uint8_t
    g_draw_buffer[kUiWidth * kDrawRows * sizeof(lv_color_t)];
#else
LV_ATTRIBUTE_MEM_ALIGN lv_color_t g_draw_buffer[kUiWidth * kDrawRows];
#endif

bool colorIsBlack(lv_color_t color) {
  return lv_color_brightness(color) < 128;
}

}  // namespace

DisplayService *DisplayService::instance_ = nullptr;

bool DisplayService::begin() {
  instance_ = this;

  pinMode(hardware::spi_display::CS, OUTPUT);
  digitalWrite(hardware::spi_display::CS, HIGH);
  SPI.begin(hardware::spi_display::SCLK, hardware::PIN_UNASSIGNED,
            hardware::spi_display::MOSI, hardware::spi_display::CS);

  panel_.initialize();
  SPI.setFrequency(hardware::spi_display::CLOCK_HZ);
  panel_.High_Power_Mode();
  panel_.display_on(true);
  panel_.display_Inversion(false);
  panel_.clearDisplay();
  panel_.display();

  lv_init();
#if LVGL_VERSION_MAJOR >= 9
  display_ = lv_display_create(kUiWidth, kUiHeight);
  if (display_ == nullptr) {
    return false;
  }
  lv_display_set_color_format(display_, LV_COLOR_FORMAT_RGB888);
  lv_display_set_buffers(display_, g_draw_buffer, nullptr,
                         sizeof(g_draw_buffer),
                         LV_DISPLAY_RENDER_MODE_PARTIAL);
  lv_display_set_flush_cb(display_, &DisplayService::flush);
#else
  lv_disp_draw_buf_init(&draw_buf_, g_draw_buffer, nullptr,
                        kUiWidth * kDrawRows);

  lv_disp_drv_init(&disp_drv_);
  disp_drv_.hor_res = kUiWidth;
  disp_drv_.ver_res = kUiHeight;
  disp_drv_.flush_cb = &DisplayService::flush;
  disp_drv_.draw_buf = &draw_buf_;
  lv_disp_drv_register(&disp_drv_);
#endif

  ui_init();
  last_tick_ms_ = millis();
  return true;
}

void DisplayService::update() {
  const uint32_t now_ms = millis();
  const uint32_t elapsed_ms = now_ms - last_tick_ms_;
  if (elapsed_ms > 0) {
    lv_tick_inc(elapsed_ms);
    last_tick_ms_ = now_ms;
  }

  lv_timer_handler();
  if (last_ui_tick_ms_ == 0 ||
      static_cast<uint32_t>(now_ms - last_ui_tick_ms_) >=
          kUiTickIntervalMs) {
    last_ui_tick_ms_ = now_ms;
    ui_tick();
  }
}

void DisplayService::requestRedraw() {
  lv_obj_invalidate(lv_scr_act());
}

#if LVGL_VERSION_MAJOR >= 9
void DisplayService::flush(lv_display_t *display, const lv_area_t *area,
                           uint8_t *px_map) {
  if (instance_ != nullptr) {
    instance_->flushArea(display, area, px_map);
  }
  lv_display_flush_ready(display);
}

void DisplayService::flushArea(lv_display_t *display, const lv_area_t *area,
                               uint8_t *px_map) {
  lv_color_t *color_p = reinterpret_cast<lv_color_t *>(px_map);
  const int32_t width = area->x2 - area->x1 + 1;

  for (int32_t y = area->y1; y <= area->y2; ++y) {
    const int32_t row = y - area->y1;
    for (int32_t x = area->x1; x <= area->x2; ++x) {
      const int32_t col = x - area->x1;
      const bool black = colorIsBlack(color_p[row * width + col]);

      const uint16_t panel_x = static_cast<uint16_t>(kUiHeight - 1 - y);
      const uint16_t panel_y = static_cast<uint16_t>(x);
      panel_.writePoint(panel_x, panel_y, black);
    }
  }

  if (lv_display_flush_is_last(display)) {
    panel_.display();
  }
}
#else
void DisplayService::flush(lv_disp_drv_t *disp_drv, const lv_area_t *area,
                           lv_color_t *color_p) {
  if (instance_ != nullptr) {
    instance_->flushArea(disp_drv, area, color_p);
  }
  lv_disp_flush_ready(disp_drv);
}

void DisplayService::flushArea(lv_disp_drv_t *disp_drv, const lv_area_t *area,
                               lv_color_t *color_p) {
  const int32_t width = area->x2 - area->x1 + 1;

  for (int32_t y = area->y1; y <= area->y2; ++y) {
    const int32_t row = y - area->y1;
    for (int32_t x = area->x1; x <= area->x2; ++x) {
      const int32_t col = x - area->x1;
      const bool black = colorIsBlack(color_p[row * width + col]);

      const uint16_t panel_x = static_cast<uint16_t>(kUiHeight - 1 - y);
      const uint16_t panel_y = static_cast<uint16_t>(x);
      panel_.writePoint(panel_x, panel_y, black);
    }
  }

  if (lv_disp_flush_is_last(disp_drv)) {
    panel_.display();
  }
}
#endif
