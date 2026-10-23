#include <Arduino.h>
#include <Preferences.h>
#include <math.h>
#include <stdio.h>
#include <SPI.h>

#include <SdFat.h>
#include <ST7305_4p2_BW_DisplayDriver.h>
#include <ui.h>
#include <ui_format.h>

#include "debounced_button.h"
#include "display_service.h"
#include "gnss_service.h"
#include "hardware_config.h"
#include "logging_service.h"
#include "start_line.h"

DebouncedButton sw1(hardware::switches::SW1, hardware::switches::ACTIVE_LOW,
                    hardware::switches::DEBOUNCE_MS);
DebouncedButton sw2(hardware::switches::SW2, hardware::switches::ACTIVE_LOW,
                    hardware::switches::DEBOUNCE_MS);
DebouncedButton sw3(hardware::switches::SW3, hardware::switches::ACTIVE_LOW,
                    hardware::switches::DEBOUNCE_MS);
DebouncedButton sw4(hardware::switches::SW4, hardware::switches::ACTIVE_LOW,
                    hardware::switches::DEBOUNCE_MS);
GnssService gnss;
LoggingService logger;
DisplayService display;
sailsiq::StartLineService start_line;
ui_model_t ui_model = {};

namespace {

constexpr uint32_t kLongPressMs = 1000;
constexpr uint32_t kRepeatPressMs = 200;
constexpr uint32_t kUiUpdateIntervalMs = 250;
constexpr uint32_t kSerialStatusIntervalMs = 1000;
constexpr char kPrefsNamespace[] = "sailsiq";
constexpr char kScreenFlipKey[] = "flip";
constexpr char kLayoutKey[] = "layout";
constexpr char kStartLineKey[] = "sline";

float last_heading_deg = NAN;

void copyCalStatus() {
  snprintf(ui_model.status.cal_status, sizeof(ui_model.status.cal_status),
           "%s", start_line.status());
}

void saveStartLine() {
  uint8_t blob[sailsiq::StartLineService::kBlobBytes];
  size_t written = 0;
  if (!start_line.exportBlob(blob, sizeof(blob), &written)) {
    return;
  }
  Preferences prefs;
  if (!prefs.begin(kPrefsNamespace, false)) {
    return;
  }
  prefs.putBytes(kStartLineKey, blob, written);
  prefs.end();
}

void loadStartLine() {
  Preferences prefs;
  if (!prefs.begin(kPrefsNamespace, true)) {
    copyCalStatus();
    return;
  }
  uint8_t blob[sailsiq::StartLineService::kBlobBytes];
  const bool ok =
      prefs.getBytesLength(kStartLineKey) == sizeof(blob) &&
      prefs.getBytes(kStartLineKey, blob, sizeof(blob)) == sizeof(blob);
  prefs.end();
  if (ok) {
    start_line.importBlob(blob, sizeof(blob));
  }
  ui_model.course.bow_offset_m = start_line.bowOffsetM();
  copyCalStatus();
}

sailsiq::StartLinePosition positionFrom(const GnssNavSnapshot &nav) {
  sailsiq::StartLinePosition position;
  position.fix_type = nav.fix_type;
  position.latitude_deg = nav.latitude_deg;
  position.longitude_deg = nav.longitude_deg;
  return position;
}

bool startLineEndFrom(int32_t value, sailsiq::StartLineEnd *end) {
  if (value == UI_CAL_SET_PIN) {
    *end = sailsiq::StartLineEnd::Pin;
    return true;
  }
  if (value == UI_CAL_SET_BOAT) {
    *end = sailsiq::StartLineEnd::Boat;
    return true;
  }
  return false;
}

bool loadScreenUpsideDown() {
  Preferences prefs;
  if (!prefs.begin(kPrefsNamespace, true)) {
    return false;
  }
  const bool upside_down = prefs.getBool(kScreenFlipKey, false);
  prefs.end();
  return upside_down;
}

void saveScreenUpsideDown(bool upside_down) {
  Preferences prefs;
  if (!prefs.begin(kPrefsNamespace, false)) {
    return;
  }
  prefs.putBool(kScreenFlipKey, upside_down);
  prefs.end();
}

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
    case UI_CMD_TOGGLE_SCREEN_FLIP:
      ui_model.display.upside_down = !ui_model.display.upside_down;
      display.setUpsideDown(ui_model.display.upside_down);
      display.requestRedraw();
      saveScreenUpsideDown(ui_model.display.upside_down);
      break;
    case UI_CMD_TOGGLE_APPROACH_LOCK:
      ui_model.course.approach_lock = !ui_model.course.approach_lock;
      break;
    case UI_CMD_CALIBRATION_SET: {
      sailsiq::StartLineEnd end;
      if (!startLineEndFrom(value, &end)) {
        snprintf(ui_model.status.cal_status, sizeof(ui_model.status.cal_status),
                 "NOT YET");
        break;
      }
      start_line.capture(end, positionFrom(gnss.latestNav()), last_heading_deg);
      ui_model.course.bow_offset_m = start_line.bowOffsetM();
      copyCalStatus();
      saveStartLine();
      break;
    }
    case UI_CMD_CALIBRATION_CLEAR: {
      sailsiq::StartLineEnd end;
      if (!startLineEndFrom(value, &end)) {
        snprintf(ui_model.status.cal_status, sizeof(ui_model.status.cal_status),
                 "NOT YET");
        break;
      }
      start_line.clearEnd(end);
      copyCalStatus();
      saveStartLine();
      break;
    }
    case UI_CMD_ADJUST_BOW_OFFSET_DM:
      start_line.setBowOffsetM(start_line.bowOffsetM() + 0.1f * static_cast<float>(value));
      ui_model.course.bow_offset_m = start_line.bowOffsetM();
      copyCalStatus();
      saveStartLine();
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
  ui_model.course.bow_offset_m = 0.0f;
  ui_model.display.brightness_profile = LCD_PROFILE_DAY;
  ui_model.display.lcd_brightness_percent = 100;
  copyCalStatus();
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
  const bool gnss_nav_ok = gnssNavUsable(nav);
  const float gps_course_deg =
      gnss_nav_ok ? normalizeDegrees(nav.cog_deg) : NAN;

  ui_model.status.fix = mapFix(nav.fix_type);
  ui_model.status.sat_count = nav.satellites;
  ui_model.status.recording = logger.isReady();
  ui_model.status.logger_error = !logger.storageReady();
  ui_model.status.hour = utc.hour;
  ui_model.status.minute = utc.minute;

  if (gnss_nav_ok && nav.sog_kn > 1.0f) {
    last_heading_deg = gps_course_deg;
  }
  const float heading_deg =
      isfinite(last_heading_deg) ? last_heading_deg : gps_course_deg;

  ui_model.nav.heading_deg = heading_deg;
  ui_model.nav.cog_deg = gps_course_deg;
  ui_model.nav.sog_kn = gnss_nav_ok ? nav.sog_kn : NAN;
  ui_model.nav.drift_deg = NAN;
  ui_model.nav.heading_confidence = isfinite(heading_deg) ? 70 : 0;
  ui_model.nav.mag_bad = true;

  int32_t box_countdown_sec = -1;
  if (ui_model.start.race_mode == RACE_MATCH && ui_model.start.timer_running &&
      ui_model.start.countdown_sec > ui_model.start.match_box_sec) {
    box_countdown_sec =
        ui_model.start.countdown_sec - ui_model.start.match_box_sec;
  }
  const sailsiq::StartLineFix line = start_line.evaluate(
      positionFrom(nav), heading_deg, ui_model.nav.sog_kn,
      ui_model.start.timer_running ? ui_model.start.countdown_sec : -1,
      box_countdown_sec);
  if (line.line_valid) {
    ui_model.nav.line_dist_m = line.line_dist_m;
    ui_model.start.ocs_risk = line.ocs_risk && ui_model.start.timer_running &&
                              ui_model.start.countdown_sec > 0;
  } else {
    ui_model.nav.line_dist_m = NAN;
    ui_model.start.ocs_risk = false;
  }
  if (line.ttl_valid) {
    ui_model.nav.ttl_sec = line.ttl_sec;
    ui_model.start.burn_sec = line.burn_valid ? line.burn_sec : 0;
    ui_model.start.box_burn_sec =
        line.box_burn_valid ? line.box_burn_sec : 0;
  } else {
    ui_model.nav.ttl_sec = -1;
    ui_model.start.burn_sec = 0;
    ui_model.start.box_burn_sec = 0;
  }
  ui_model.course.bow_offset_m = start_line.bowOffsetM();
  if (ui_get_page() != UI_PAGE_CALIBRATION ||
      ui_model.status.cal_status[0] == '\0') {
    copyCalStatus();
  }

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
  if (!Serial.isPlugged()) {
    return;
  }
  if (last_status_ms != 0 &&
      static_cast<uint32_t>(now_ms - last_status_ms) <
          kSerialStatusIntervalMs) {
    return;
  }
  last_status_ms = now_ms;

  const GnssNavSnapshot nav = gnss.latestNav();
  const GpsUtcTime utc = gnss.latestUtc();
  const uint16_t nmea_pending = gnss.loggedBytesAvailable();
  const uint16_t nmea_max_pending = gnss.maxLoggedBytesAvailable();
  const bool gnss_nav_ok = gnssNavUsable(nav);

  Serial.printf(
      "[%lu ms] GPS ready=%u baud=%lu fix=%u sats=%u gps_nav=%u time=%u "
      "%04u-%02u-%02u %02u:%02u:%02u gps_sog=%.2fkn gps_cog=%.1f "
      "nmea_pending=%u nmea_max=%u | IMU removed hdg_src=GPS | "
      "SD ready=%u sd_err=%02x/%02x log_ready=%u log_named=%u "
      "last_flush_age=%lu\n",
      static_cast<unsigned long>(now_ms), gnss.isReady() ? 1U : 0U,
      static_cast<unsigned long>(gnss.detectedBaudRate()), nav.fix_type,
      nav.satellites, gnss_nav_ok ? 1U : 0U,
      gnss.hasTime() ? 1U : 0U, utc.year, utc.month, utc.day, utc.hour,
      utc.minute, utc.second, nav.sog_kn, nav.cog_deg, nmea_pending,
      nmea_max_pending, logger.storageReady() ? 1U : 0U,
      logger.storageErrorCode(), logger.storageErrorData(),
      logger.isReady() ? 1U : 0U, logger.hasTimestampedNames() ? 1U : 0U,
      static_cast<unsigned long>(now_ms - logger.lastFlushMs()));
}

}  // namespace

extern "C" bool ui_layout_storage_load(ui_layout_config_t *config) {
  if (config == nullptr) {
    return false;
  }

  Preferences prefs;
  if (!prefs.begin(kPrefsNamespace, true)) {
    return false;
  }
  const bool ok =
      prefs.getBytesLength(kLayoutKey) == sizeof(ui_layout_config_t) &&
      prefs.getBytes(kLayoutKey, config, sizeof(ui_layout_config_t)) ==
          sizeof(ui_layout_config_t);
  prefs.end();
  return ok;
}

extern "C" bool ui_layout_storage_save(const ui_layout_config_t *config) {
  if (config == nullptr) {
    return false;
  }

  Preferences prefs;
  if (!prefs.begin(kPrefsNamespace, false)) {
    return false;
  }
  const size_t written =
      prefs.putBytes(kLayoutKey, config, sizeof(ui_layout_config_t));
  prefs.end();
  return written == sizeof(ui_layout_config_t);
}

void setup() {
  sw1.begin();
  sw2.begin();
  sw3.begin();
  sw4.begin();

  initUiModel();
  loadStartLine();
  ui_model.display.upside_down = loadScreenUpsideDown();
  display.setUpsideDown(ui_model.display.upside_down);
  display.begin();
  ui_set_command_handler(&handleUiCommand);
  ui_update(&ui_model);
  display.update();

  Serial.begin(115200);
  gnss.begin();
  logger.begin();
}

void loop() {
  const uint32_t now_ms = millis();
  static uint8_t panel_recoveries = 0;
  if (panel_recoveries < 2 &&
      now_ms >= (panel_recoveries == 0 ? 1000u : 3000u)) {
    panel_recoveries++;
    display.recoverPanel();
  }
  sw1.update(now_ms);
  sw2.update(now_ms);
  sw3.update(now_ms);
  sw4.update(now_ms);
  updateUiButtons(now_ms);

  gnss.update();
  logger.flushIfDue(now_ms, gnss);
  updateUiModel(now_ms);
  printSerialStatus(now_ms);
  display.update();
}
