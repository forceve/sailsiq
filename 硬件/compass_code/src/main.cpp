#include <Arduino.h>
#include <math.h>
#include <SPI.h>
#include <Wire.h>

#include <7Semi_BMI270.h>
#include <SdFat.h>
#include <SparkFun_MMC5983MA_Arduino_Library.h>
#include <SparkFun_u-blox_GNSS_v3.h>
#include <ST7305_4p2_BW_DisplayDriver.h>
#include <ui.h>
#include <ui_format.h>

#include "debounced_button.h"
#include "display_service.h"
#include "gnss_service.h"
#include "hardware_config.h"
#include "imu_service.h"
#include "logging_service.h"
#include "nav_estimator.h"
#include "sensor_rotation_config.h"

DebouncedButton sw1(hardware::switches::SW1, hardware::switches::ACTIVE_LOW,
                    hardware::switches::DEBOUNCE_MS);
DebouncedButton sw2(hardware::switches::SW2, hardware::switches::ACTIVE_LOW,
                    hardware::switches::DEBOUNCE_MS);
DebouncedButton sw3(hardware::switches::SW3, hardware::switches::ACTIVE_LOW,
                    hardware::switches::DEBOUNCE_MS);
DebouncedButton sw4(hardware::switches::SW4, hardware::switches::ACTIVE_LOW,
                    hardware::switches::DEBOUNCE_MS);
GnssService gnss;
ImuService imu;
LoggingService logger;
DisplayService display;
NavEstimator nav_estimator;
ui_model_t ui_model = {};

namespace {

constexpr uint32_t kLongPressMs = 1000;
constexpr uint32_t kRepeatPressMs = 200;
constexpr uint32_t kUiUpdateIntervalMs = 250;
constexpr uint32_t kSerialStatusIntervalMs = 1000;
constexpr float kMinDriftSogKnots = 1.0f;

struct UiButtonRuntime {
  DebouncedButton *button;
  ui_button_t ui_button;
  uint32_t pressed_at_ms;
  uint32_t last_repeat_ms;
  bool long_sent;

  UiButtonRuntime(DebouncedButton *input, ui_button_t button)
      : button(input),
        ui_button(button),
        pressed_at_ms(0),
        last_repeat_ms(0),
        long_sent(false) {}
};

UiButtonRuntime ui_buttons[] = {
    {&sw1, UI_BTN_PAGE},
    {&sw2, UI_BTN_ACTION},
    {&sw3, UI_BTN_ADJUST_MINUS},
    {&sw4, UI_BTN_ADJUST_PLUS},
};

float normalizeDegrees(float degrees) {
  while (degrees < 0.0f) {
    degrees += 360.0f;
  }
  while (degrees >= 360.0f) {
    degrees -= 360.0f;
  }
  return degrees;
}

gnss_fix_t mapFix(uint8_t fix_type) {
  if (fix_type >= 3) {
    return FIX_3D;
  }
  if (fix_type == 2) {
    return FIX_2D;
  }
  return FIX_NONE;
}

bool gnssNavUsable(const GnssNavSnapshot &nav) {
  return nav.fix_type >= 2 && isfinite(nav.sog_kn) && isfinite(nav.cog_deg);
}

void handleUiCommand(ui_command_t command, int32_t value) {
  switch (command) {
    case UI_CMD_START_TIMER:
      ui_model.start.timer_running = true;
      ui_model.start.active_scene = SCENE_START_ACTIVE;
      ui_model.start.countdown_sec = ui_model.start.preset_start_sec;
      break;
    case UI_CMD_RESET_TIMER:
      ui_model.start.timer_running = false;
      ui_model.start.active_scene = SCENE_START_WAIT;
      ui_model.start.countdown_sec = ui_model.start.preset_start_sec;
      ui_model.start.ocs_risk = false;
      break;
    case UI_CMD_ADJUST_TIMER_SEC:
      ui_model.start.countdown_sec += value;
      if (ui_model.start.countdown_sec < 0) {
        ui_model.start.countdown_sec = 0;
      }
      break;
    case UI_CMD_ADJUST_START_PRESET_SEC:
      ui_model.start.preset_start_sec += value;
      if (ui_model.start.preset_start_sec < 60) {
        ui_model.start.preset_start_sec = 60;
      }
      if (!ui_model.start.timer_running) {
        ui_model.start.countdown_sec = ui_model.start.preset_start_sec;
      }
      break;
    case UI_CMD_TOGGLE_RACE_MODE:
      ui_model.start.race_mode =
          ui_model.start.race_mode == RACE_FLEET ? RACE_MATCH : RACE_FLEET;
      break;
    case UI_CMD_SET_BRIGHTNESS_PROFILE:
      ui_model.display.brightness_profile =
          static_cast<ui_brightness_profile_t>(value);
      ui_model.display.night_mode =
          ui_model.display.brightness_profile == LCD_PROFILE_NIGHT;
      break;
    case UI_CMD_TOGGLE_APPROACH_LOCK:
      ui_model.course.approach_lock = !ui_model.course.approach_lock;
      break;
    default:
      break;
  }
}

void initUiModel() {
  ui_model.status.battery_percent = 100;
  ui_model.nav.heading_deg = NAN;
  ui_model.nav.cog_deg = NAN;
  ui_model.nav.sog_kn = NAN;
  ui_model.nav.drift_deg = NAN;
  ui_model.nav.vmg_mark_kn = NAN;
  ui_model.nav.vmg_finish_kn = NAN;
  ui_model.nav.dtg_m = NAN;
  ui_model.nav.brg_deg = NAN;
  ui_model.nav.eta_sec = -1;
  ui_model.nav.ttl_sec = -1;
  ui_model.nav.line_dist_m = NAN;
  ui_model.nav.finish_line_dist_m = NAN;
  ui_model.nav.angle_error_deg = NAN;
  ui_model.start.race_mode = RACE_FLEET;
  ui_model.start.active_scene = SCENE_START_WAIT;
  ui_model.start.preset_start_sec = 300;
  ui_model.start.countdown_sec = 300;
  ui_model.start.match_box_sec = 240;
  ui_model.course.rounding_side = ROUND_UNKNOWN;
  ui_model.course.auto_scene_enabled = true;
  ui_model.display.brightness_profile = LCD_PROFILE_DAY;
  ui_model.display.lcd_brightness_percent = 100;
}

void updateUiButtons(uint32_t now_ms) {
  for (UiButtonRuntime &button : ui_buttons) {
    if (button.button->pressed()) {
      button.pressed_at_ms = now_ms;
      button.last_repeat_ms = now_ms;
      button.long_sent = false;
    }

    if (button.button->isPressed()) {
      if (!button.long_sent &&
          now_ms - button.pressed_at_ms >= kLongPressMs) {
        ui_handle_button(button.ui_button, UI_PRESS_LONG);
        button.long_sent = true;
        button.last_repeat_ms = now_ms;
      } else if (button.long_sent &&
                 now_ms - button.last_repeat_ms >= kRepeatPressMs) {
        ui_handle_button(button.ui_button, UI_PRESS_REPEAT);
        button.last_repeat_ms = now_ms;
      }
    }

    if (button.button->released() && !button.long_sent) {
      ui_handle_button(button.ui_button, UI_PRESS_SHORT);
    }
  }
}

void updateUiModel(uint32_t now_ms) {
  static uint32_t last_second_ms = 0;
  static uint32_t last_ui_update_ms = 0;
  if (ui_model.start.timer_running &&
      static_cast<uint32_t>(now_ms - last_second_ms) >= 1000) {
    last_second_ms = now_ms;
    if (ui_model.start.countdown_sec > 0) {
      ui_model.start.countdown_sec--;
    }
  }

  const GnssNavSnapshot nav = gnss.latestNav();
  const GpsUtcTime utc = gnss.latestUtc();
  const ImuSample &sample = imu.latestSample();
  const NavEstimate &estimate = nav_estimator.latest();
  const bool gnss_nav_ok = gnssNavUsable(nav);

  ui_model.status.fix = mapFix(nav.fix_type);
  ui_model.status.sat_count = nav.satellites;
  ui_model.status.recording = logger.isReady();
  ui_model.status.logger_error = !logger.storageReady();
  ui_model.status.hour = utc.hour;
  ui_model.status.minute = utc.minute;

  ui_model.nav.heading_deg = estimate.heading_deg;
  ui_model.nav.cog_deg = gnss_nav_ok ? normalizeDegrees(nav.cog_deg) : NAN;
  ui_model.nav.sog_kn = gnss_nav_ok ? nav.sog_kn : NAN;
  ui_model.nav.drift_deg =
      gnss_nav_ok && nav.sog_kn > kMinDriftSogKnots &&
              isfinite(ui_model.nav.heading_deg)
          ? ui_wrap180(ui_model.nav.cog_deg - ui_model.nav.heading_deg)
          : NAN;
  ui_model.nav.heading_confidence = sample.mag_valid ? 90 : 0;
  ui_model.nav.mag_bad = !sample.mag_valid;

  if (last_ui_update_ms != 0 &&
      static_cast<uint32_t>(now_ms - last_ui_update_ms) <
          kUiUpdateIntervalMs) {
    return;
  }

  last_ui_update_ms = now_ms;
  ui_update(&ui_model);
}

void printSerialStatus(uint32_t now_ms) {
  static uint32_t last_status_ms = 0;
  if (last_status_ms != 0 &&
      static_cast<uint32_t>(now_ms - last_status_ms) <
          kSerialStatusIntervalMs) {
    return;
  }
  last_status_ms = now_ms;

  const GnssNavSnapshot nav = gnss.latestNav();
  const GpsUtcTime utc = gnss.latestUtc();
  const ImuSample &sample = imu.latestSample();
  const NavEstimate &estimate = nav_estimator.latest();
  const uint16_t ubx_pending = gnss.loggedBytesAvailable();
  const uint16_t ubx_max_pending = gnss.maxLoggedBytesAvailable();
  const bool gnss_nav_ok = gnssNavUsable(nav);
  const float drift_deg =
      gnss_nav_ok && nav.sog_kn > kMinDriftSogKnots &&
              isfinite(estimate.heading_deg)
          ? ui_wrap180(normalizeDegrees(nav.cog_deg) - estimate.heading_deg)
          : NAN;

  Serial.printf(
      "[%lu ms] GPS ready=%u baud=%lu fix=%u sats=%u gps_nav=%u time=%u "
      "%04u-%02u-%02u %02u:%02u:%02u gps_sog=%.2fkn gps_cog=%.1f "
      "ubx_pending=%u ubx_max=%u | "
      "IMU ready=%u a/g/m=%u/%u/%u ts=%llu gps_ts=%u "
      "acc=%.3f,%.3f,%.3f gyro=%.2f,%.2f,%.2f mag=%.0f,%.0f,%.0f | "
      "AHRS valid=%u hdg_src=IMU hdg=%.1f roll=%.1f pitch=%.1f "
      "drift=%.1f | "
      "SD ready=%u sd_err=%02x/%02x log_ready=%u log_named=%u imu_pending=%u "
      "last_flush_age=%lu\n",
      static_cast<unsigned long>(now_ms), gnss.isReady() ? 1U : 0U,
      static_cast<unsigned long>(gnss.detectedBaudRate()), nav.fix_type,
      nav.satellites, gnss_nav_ok ? 1U : 0U,
      gnss.hasTime() ? 1U : 0U, utc.year, utc.month, utc.day, utc.hour,
      utc.minute, utc.second, nav.sog_kn, nav.cog_deg, ubx_pending,
      ubx_max_pending,
      imu.isReady() ? 1U : 0U,
      sample.accel_valid ? 1U : 0U, sample.gyro_valid ? 1U : 0U,
      sample.mag_valid ? 1U : 0U,
      static_cast<unsigned long long>(sample.timestamp_us),
      sample.gps_time_valid ? 1U : 0U, sample.accel_cal_g[0],
      sample.accel_cal_g[1], sample.accel_cal_g[2],
      sample.gyro_cal_dps[0], sample.gyro_cal_dps[1],
      sample.gyro_cal_dps[2], sample.mag_cal_counts[0],
      sample.mag_cal_counts[1], sample.mag_cal_counts[2],
      estimate.attitude_valid ? 1U : 0U, estimate.heading_deg,
      estimate.roll_deg, estimate.pitch_deg, drift_deg,
      logger.storageReady() ? 1U : 0U, logger.storageErrorCode(),
      logger.storageErrorData(), logger.isReady() ? 1U : 0U,
      logger.hasTimestampedNames() ? 1U : 0U,
      static_cast<unsigned int>(logger.pendingImuBytes()),
      static_cast<unsigned long>(now_ms - logger.lastFlushMs()));
}

}  // namespace

void setup() {
  Serial.begin(115200);

  sw1.begin();
  sw2.begin();
  sw3.begin();
  sw4.begin();

  gnss.begin();
  imu.begin();
  logger.begin();

  initUiModel();
  display.begin();
  ui_set_command_handler(&handleUiCommand);
  ui_update(&ui_model);
}

void loop() {
  const uint32_t now_ms = millis();
  sw1.update(now_ms);
  sw2.update(now_ms);
  sw3.update(now_ms);
  sw4.update(now_ms);
  updateUiButtons(now_ms);

  gnss.update();

  const uint64_t timestamp_us =
      gnss.hasTime() ? gnss.gpsTimeMicros() : static_cast<uint64_t>(micros());
  if (imu.update(timestamp_us, gnss.hasTime())) {
    ButtonStateSnapshot buttons;
    buttons.sw1_pressed = sw1.isPressed();
    buttons.sw2_pressed = sw2.isPressed();
    buttons.sw3_pressed = sw3.isPressed();
    buttons.sw4_pressed = sw4.isPressed();
    logger.appendImuSample(imu.latestSample(), buttons);
    nav_estimator.update(imu.latestSample());
  }

  logger.flushIfDue(now_ms, gnss);
  updateUiModel(now_ms);
  printSerialStatus(now_ms);
  display.update();
}
