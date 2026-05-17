#if defined(EEZ_FOR_LVGL)
#include <eez/core/vars.h>
#endif

#include "ui.h"
#include "screens.h"
#include "images.h"
#include "actions.h"
#include "vars.h"

#if defined(__GNUC__)
#define UI_WEAK __attribute__((weak))
#else
#define UI_WEAK
#endif







#if defined(EEZ_FOR_LVGL)

void ui_init(void) {
    eez_flow_init(assets, sizeof(assets), (lv_obj_t **)&objects, sizeof(objects), images, sizeof(images), actions);
}

void ui_tick(void) {
    eez_flow_tick();
    tick_screen(g_currentScreen);
}

void ui_set_page(ui_page_t page) { (void)page; }
ui_page_t ui_get_page(void) { return UI_PAGE_COMPASS; }
void ui_update(const ui_model_t *model) { (void)model; }
void ui_handle_button(ui_button_t btn, ui_press_t press) { (void)btn; (void)press; }
void ui_set_command_handler(ui_command_handler_t handler) { (void)handler; }
void ui_request_redraw(void) {}
void ui_set_brightness_profile(ui_brightness_profile_t profile) { (void)profile; }
void ui_get_layout_config(ui_layout_config_t *config) { (void)config; }
bool ui_apply_layout_config(const ui_layout_config_t *config) { (void)config; return false; }
void ui_reset_layout_config(void) {}
uint32_t ui_layout_config_crc32(const ui_layout_config_t *config) { (void)config; return 0; }
bool ui_layout_config_validate(const ui_layout_config_t *config) { (void)config; return false; }
UI_WEAK bool ui_layout_storage_load(ui_layout_config_t *config) { (void)config; return false; }
UI_WEAK bool ui_layout_storage_save(const ui_layout_config_t *config) { (void)config; return false; }

#else

#include <stdbool.h>
#include <stddef.h>
#include <string.h>

#define UI_SYSTEM_TIME_EDIT_OFF 0
#define UI_SYSTEM_TIME_EDIT_MODE 1
#define UI_SYSTEM_TIME_EDIT_YEAR 2
#define UI_SYSTEM_TIME_EDIT_MONTH 3
#define UI_SYSTEM_TIME_EDIT_DAY 4
#define UI_SYSTEM_TIME_EDIT_HOUR 5
#define UI_SYSTEM_TIME_EDIT_MINUTE 6
#define UI_SYSTEM_TIME_EDIT_GPS_SYNC 7

static ui_model_t s_model;
static bool s_has_external_model = false;
static ui_page_t s_previous_main_page = UI_PAGE_COMPASS;
static uint8_t s_settings_selection = 0;
static uint8_t s_layout_selection = 0;
static bool s_layout_editing = false;
static uint8_t s_calibration_selection = 0;
static uint8_t s_system_selection = 0;
static uint8_t s_system_time_edit_field = 0;
static uint32_t s_last_mock_tick = 0;
static ui_command_handler_t s_command_handler = NULL;

UI_WEAK bool ui_layout_storage_load(ui_layout_config_t *config) {
    (void)config;
    return false;
}

UI_WEAK bool ui_layout_storage_save(const ui_layout_config_t *config) {
    (void)config;
    return false;
}

uint32_t ui_layout_config_crc32(const ui_layout_config_t *config) {
    if (config == NULL) {
        return 0;
    }

    const uint8_t *bytes = (const uint8_t *)config;
    uint32_t crc = 0xFFFFFFFFu;
    size_t len = offsetof(ui_layout_config_t, crc32);

    for (size_t i = 0; i < len; i++) {
        crc ^= bytes[i];
        for (uint8_t bit = 0; bit < 8; bit++) {
            crc = (crc >> 1) ^ (0xEDB88320u & (0u - (crc & 1u)));
        }
    }

    return ~crc;
}

bool ui_layout_config_validate(const ui_layout_config_t *config) {
    if (config == NULL) {
        return false;
    }
    if (config->magic != UI_LAYOUT_CONFIG_MAGIC || config->version != UI_LAYOUT_CONFIG_VERSION || config->size != sizeof(ui_layout_config_t)) {
        return false;
    }
    if (config->crc32 != ui_layout_config_crc32(config)) {
        return false;
    }
    return screens_layout_config_in_range(config);
}

void ui_get_layout_config(ui_layout_config_t *config) {
    if (config == NULL) {
        return;
    }
    screens_get_layout_config(config);
    config->magic = UI_LAYOUT_CONFIG_MAGIC;
    config->version = UI_LAYOUT_CONFIG_VERSION;
    config->size = sizeof(ui_layout_config_t);
    config->crc32 = ui_layout_config_crc32(config);
}

bool ui_apply_layout_config(const ui_layout_config_t *config) {
    if (!ui_layout_config_validate(config)) {
        return false;
    }
    return screens_apply_layout_config(config);
}

void ui_reset_layout_config(void) {
    screens_layout_reset_defaults();
}

static bool save_layout_config(void) {
    ui_layout_config_t config;
    ui_get_layout_config(&config);
    if (ui_layout_storage_save(&config)) {
        screens_set_layout_status("Saved");
        return true;
    }
    screens_set_layout_status("Save N/A");
    return false;
}

static void load_layout_config(void) {
    ui_layout_config_t config;
    if (ui_layout_storage_load(&config) && ui_apply_layout_config(&config)) {
        screens_set_layout_status("Loaded");
    } else {
        screens_layout_reset_defaults();
    }
}

static bool ui_is_leap_year(uint16_t year) {
    return (year % 4u == 0u && year % 100u != 0u) || year % 400u == 0u;
}

static uint8_t ui_days_in_month(uint16_t year, uint8_t month) {
    static const uint8_t days[] = { 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31 };
    if (month < 1 || month > 12) {
        return 31;
    }
    if (month == 2 && ui_is_leap_year(year)) {
        return 29;
    }
    return days[month - 1];
}

static void ui_clamp_date(ui_status_t *status) {
    if (status->year < 2020) {
        status->year = 2020;
    } else if (status->year > 2099) {
        status->year = 2099;
    }
    if (status->month < 1) {
        status->month = 1;
    } else if (status->month > 12) {
        status->month = 12;
    }
    uint8_t max_day = ui_days_in_month(status->year, status->month);
    if (status->day < 1) {
        status->day = 1;
    } else if (status->day > max_day) {
        status->day = max_day;
    }
}

static int32_t ui_clock_date_value(const ui_status_t *status) {
    return (int32_t)status->year * 10000 + (int32_t)status->month * 100 + (int32_t)status->day;
}

static void ui_increment_mock_clock(void) {
    s_model.status.minute++;
    if (s_model.status.minute < 60) {
        return;
    }
    s_model.status.minute = 0;
    s_model.status.hour++;
    if (s_model.status.hour < 24) {
        return;
    }
    s_model.status.hour = 0;
    s_model.status.day++;
    if (s_model.status.day <= ui_days_in_month(s_model.status.year, s_model.status.month)) {
        return;
    }
    s_model.status.day = 1;
    s_model.status.month++;
    if (s_model.status.month <= 12) {
        return;
    }
    s_model.status.month = 1;
    s_model.status.year++;
    ui_clamp_date(&s_model.status);
}

static void init_mock_model(void) {
    memset(&s_model, 0, sizeof(s_model));
    s_model.status.fix = FIX_3D;
    s_model.status.sat_count = 12;
    s_model.status.recording = true;
    s_model.status.battery_percent = 82;
    s_model.status.year = 2026;
    s_model.status.month = 5;
    s_model.status.day = 17;
    s_model.status.hour = 14;
    s_model.status.minute = 32;
    s_model.status.clock_mode = UI_CLOCK_GPS;
    s_model.nav.heading_deg = 360.0f;
    s_model.nav.cog_deg = 25.0f;
    s_model.nav.sog_kn = 5.7f;
    s_model.nav.vmg_mark_kn = 2.1f;
    s_model.nav.vmg_finish_kn = 2.11f;
    s_model.nav.dtg_m = 778.0f;
    s_model.nav.brg_deg = 32.0f;
    s_model.nav.eta_sec = 131;
    s_model.nav.ttl_sec = 11;
    s_model.nav.line_dist_m = -18.0f;
    s_model.nav.finish_line_dist_m = -24.0f;
    s_model.nav.angle_error_deg = 8.0f;
    s_model.nav.heading_confidence = 90;
    s_model.start.race_mode = RACE_FLEET;
    s_model.start.active_scene = SCENE_START_WAIT;
    s_model.start.preset_start_sec = 300;
    s_model.start.countdown_sec = 300;
    s_model.start.match_box_sec = 240;
    s_model.start.box_in_sec = 23;
    s_model.start.burn_sec = 12;
    s_model.start.box_burn_sec = 8;
    s_model.course.rounding_side = ROUND_UNKNOWN;
    s_model.course.target_configured = true;
    s_model.course.auto_scene_enabled = true;
    s_model.display.brightness_profile = LCD_PROFILE_DAY;
    s_model.display.lcd_brightness_percent = 100;
}

void loadScreen(enum ScreensEnum screenId) {
    switch (screenId) {
    case SCREEN_ID_COMPASS: ui_set_page(UI_PAGE_COMPASS); break;
    case SCREEN_ID_START: ui_set_page(UI_PAGE_START); break;
    case SCREEN_ID_MARK: ui_set_page(UI_PAGE_MARK); break;
    case SCREEN_ID_FINISH: ui_set_page(UI_PAGE_FINISH); break;
    case SCREEN_ID_SETTINGS: ui_set_page(UI_PAGE_SETTINGS); break;
    case SCREEN_ID_LAYOUT: ui_set_page(UI_PAGE_LAYOUT); break;
    case SCREEN_ID_CALIBRATION: ui_set_page(UI_PAGE_CALIBRATION); break;
    case SCREEN_ID_SYSTEM: ui_set_page(UI_PAGE_SYSTEM); break;
    default: ui_set_page(UI_PAGE_COMPASS); break;
    }
}

void ui_init(void) {
    init_mock_model();
    create_screens();
    load_layout_config();
    screens_update(&s_model);
    ui_set_page(UI_PAGE_COMPASS);
}

void ui_tick(void) {
    uint32_t now = lv_tick_get();
    if (!s_has_external_model && (s_last_mock_tick == 0 || now - s_last_mock_tick >= 1000)) {
        s_last_mock_tick = now;
        ui_increment_mock_clock();
        s_model.nav.heading_deg += 3.0f;
        if (s_model.nav.heading_deg >= 360.0f) {
            s_model.nav.heading_deg -= 360.0f;
        }
        s_model.nav.cog_deg = s_model.nav.heading_deg + 25.0f;
        if (s_model.start.timer_running && s_model.start.countdown_sec > 0) {
            s_model.start.countdown_sec--;
            s_model.start.burn_sec = s_model.start.countdown_sec - s_model.nav.ttl_sec;
            s_model.nav.line_dist_m += 1.0f;
            s_model.start.ocs_risk = s_model.nav.line_dist_m > 5.0f && s_model.start.countdown_sec > 0;
        }
        screens_update(&s_model);
    } else {
        tick_screen((int)screens_get_page());
    }
}

void ui_set_page(ui_page_t page) {
    if (page != UI_PAGE_SETTINGS && page != UI_PAGE_LAYOUT && page != UI_PAGE_CALIBRATION && page != UI_PAGE_SYSTEM) {
        s_previous_main_page = page;
    }
    screens_set_page(page);
}

ui_page_t ui_get_page(void) {
    return screens_get_page();
}

void ui_update(const ui_model_t *model) {
    if (model == NULL) {
        return;
    }
    s_model = *model;
    s_has_external_model = true;
    screens_update(&s_model);
}

void ui_set_command_handler(ui_command_handler_t handler) {
    s_command_handler = handler;
}

static bool emit_command(ui_command_t command, int32_t value) {
    if (s_command_handler == NULL) {
        return false;
    }
    s_command_handler(command, value);
    return true;
}

void ui_request_redraw(void) {
    screens_update(&s_model);
}

void ui_set_brightness_profile(ui_brightness_profile_t profile) {
    s_model.display.brightness_profile = profile;
    s_model.display.night_mode = profile == LCD_PROFILE_NIGHT;
    screens_update(&s_model);
}

static ui_brightness_profile_t next_brightness_profile(void) {
    if (s_model.display.brightness_profile == LCD_PROFILE_DAY) {
        return LCD_PROFILE_NIGHT;
    }
    if (s_model.display.brightness_profile == LCD_PROFILE_NIGHT) {
        return LCD_PROFILE_POWER_SAVE;
    }
    return LCD_PROFILE_DAY;
}

static void request_brightness_cycle(void) {
    ui_brightness_profile_t next = next_brightness_profile();
    if (!emit_command(UI_CMD_SET_BRIGHTNESS_PROFILE, (int32_t)next) && !s_has_external_model) {
        ui_set_brightness_profile(next);
    }
}

static void page_next_main(void) {
    switch (screens_get_page()) {
    case UI_PAGE_COMPASS:
        ui_set_page(UI_PAGE_START);
        break;
    case UI_PAGE_START:
        ui_set_page(screens_get_page_mode() == UI_PAGE_MODE_ALL ? UI_PAGE_MARK : UI_PAGE_COMPASS);
        break;
    case UI_PAGE_MARK: ui_set_page(UI_PAGE_FINISH); break;
    default: ui_set_page(UI_PAGE_COMPASS); break;
    }
    emit_command(UI_CMD_MANUAL_PAGE_SELECTED, (int32_t)screens_get_page());
}

static void handle_page_button(ui_press_t press) {
    ui_page_t page = screens_get_page();
    if (press == UI_PRESS_LONG) {
        if (page == UI_PAGE_LAYOUT) {
            save_layout_config();
            s_layout_editing = false;
            screens_set_layout_editing(false);
            s_layout_selection = screens_layout_get_selection();
            ui_set_page(s_previous_main_page);
        } else if (page == UI_PAGE_SETTINGS || page == UI_PAGE_CALIBRATION || page == UI_PAGE_SYSTEM) {
            s_layout_editing = false;
            screens_set_layout_editing(false);
            s_layout_selection = screens_layout_get_selection();
            s_system_time_edit_field = UI_SYSTEM_TIME_EDIT_OFF;
            screens_set_system_time_edit_field(s_system_time_edit_field);
            ui_set_page(s_previous_main_page);
        } else {
            s_previous_main_page = page;
            ui_set_page(UI_PAGE_SETTINGS);
        }
    } else if (press == UI_PRESS_SHORT) {
        if (page == UI_PAGE_LAYOUT) {
            if (s_layout_editing) {
                s_layout_editing = false;
                screens_set_layout_editing(false);
                s_layout_selection = screens_layout_get_selection();
            } else {
                ui_set_page(UI_PAGE_SETTINGS);
            }
        } else if (page == UI_PAGE_CALIBRATION) {
            ui_set_page(UI_PAGE_SETTINGS);
        } else if (page == UI_PAGE_SYSTEM) {
            if (s_system_time_edit_field != UI_SYSTEM_TIME_EDIT_OFF) {
                s_system_time_edit_field = UI_SYSTEM_TIME_EDIT_OFF;
                screens_set_system_time_edit_field(s_system_time_edit_field);
            } else {
                ui_set_page(UI_PAGE_SETTINGS);
            }
        } else if (page == UI_PAGE_SETTINGS) {
            ui_set_page(s_previous_main_page);
        } else {
            page_next_main();
        }
    }
}

static void handle_action_button(ui_press_t press) {
    ui_page_t page = screens_get_page();
    if (page == UI_PAGE_START) {
        if (press == UI_PRESS_SHORT && !s_model.start.timer_running) {
            if (!emit_command(UI_CMD_START_TIMER, 0) && !s_has_external_model) {
                s_model.start.timer_running = true;
                s_model.start.active_scene = SCENE_START_ACTIVE;
                s_model.start.countdown_sec = s_model.start.preset_start_sec;
                s_model.nav.line_dist_m = 5.0f;
                s_model.nav.ttl_sec = 11;
                s_model.start.burn_sec = s_model.start.countdown_sec - s_model.nav.ttl_sec;
                screens_update(&s_model);
            }
        } else if (press == UI_PRESS_LONG) {
            if (!emit_command(UI_CMD_RESET_TIMER, 0) && !s_has_external_model) {
                s_model.start.timer_running = false;
                s_model.start.active_scene = SCENE_START_WAIT;
                s_model.start.countdown_sec = s_model.start.preset_start_sec;
                s_model.start.ocs_risk = false;
                s_model.nav.line_dist_m = -18.0f;
                screens_update(&s_model);
            }
        }
    } else if (page == UI_PAGE_SETTINGS && press == UI_PRESS_SHORT) {
        if (s_settings_selection == 0) {
            if (!emit_command(UI_CMD_TOGGLE_RACE_MODE, 0) && !s_has_external_model) {
                s_model.start.race_mode = s_model.start.race_mode == RACE_FLEET ? RACE_MATCH : RACE_FLEET;
                screens_update(&s_model);
            }
        } else if (s_settings_selection == 3) {
            s_layout_editing = false;
            screens_set_layout_editing(false);
            s_layout_selection = screens_layout_get_selection();
            ui_set_page(UI_PAGE_LAYOUT);
        } else if (s_settings_selection == 4) {
            ui_set_page(UI_PAGE_CALIBRATION);
        } else if (s_settings_selection == 5) {
            request_brightness_cycle();
        } else if (s_settings_selection == 6) {
            ui_set_page(UI_PAGE_SYSTEM);
        }
    } else if (page == UI_PAGE_LAYOUT) {
        if (press == UI_PRESS_LONG) {
            screens_layout_reset_current();
            s_layout_selection = screens_layout_get_selection();
            return;
        }
        if (s_layout_editing) {
            screens_layout_apply_selected_preset();
            s_layout_selection = screens_layout_get_selection();
            return;
        }
        if (screens_layout_selected_is_page()) {
            screens_set_layout_selection(s_layout_selection);
            s_layout_editing = true;
            screens_set_layout_editing(true);
            s_layout_selection = screens_layout_get_selection();
        } else if (screens_layout_selected_is_mode()) {
            screens_layout_toggle_page_mode();
            if (!screens_main_page_enabled(s_previous_main_page)) {
                s_previous_main_page = UI_PAGE_COMPASS;
            }
            s_layout_selection = screens_layout_get_selection();
        } else if (screens_layout_selected_is_save()) {
            save_layout_config();
        } else if (screens_layout_selected_is_reset_page()) {
            screens_layout_reset_current();
            s_layout_selection = screens_layout_get_selection();
        } else if (screens_layout_selected_is_reset_all()) {
            screens_layout_reset_defaults();
            if (!screens_main_page_enabled(s_previous_main_page)) {
                s_previous_main_page = UI_PAGE_COMPASS;
            }
            s_layout_selection = screens_layout_get_selection();
        }
    } else if (page == UI_PAGE_CALIBRATION && press == UI_PRESS_SHORT) {
        emit_command(UI_CMD_CALIBRATION_SET, (int32_t)s_calibration_selection);
    } else if (page == UI_PAGE_SYSTEM && press == UI_PRESS_SHORT) {
        if (s_system_selection == 0) {
            if (s_system_time_edit_field == UI_SYSTEM_TIME_EDIT_GPS_SYNC && s_model.status.clock_mode == UI_CLOCK_GPS) {
                emit_command(UI_CMD_SYNC_CLOCK_GPS, 0);
                s_system_time_edit_field = UI_SYSTEM_TIME_EDIT_OFF;
            } else if (s_system_time_edit_field == UI_SYSTEM_TIME_EDIT_MODE && s_model.status.clock_mode == UI_CLOCK_GPS) {
                s_system_time_edit_field = UI_SYSTEM_TIME_EDIT_GPS_SYNC;
            } else {
                s_system_time_edit_field = (uint8_t)((s_system_time_edit_field + 1) % (UI_SYSTEM_TIME_EDIT_MINUTE + 1));
            }
            screens_set_system_time_edit_field(s_system_time_edit_field);
        }
    } else if (page == UI_PAGE_MARK && press == UI_PRESS_SHORT) {
        if (!emit_command(UI_CMD_TOGGLE_APPROACH_LOCK, 0) && !s_has_external_model) {
            s_model.course.approach_lock = !s_model.course.approach_lock;
            screens_update(&s_model);
        }
    } else if (press == UI_PRESS_LONG) {
        request_brightness_cycle();
    }
}

static void handle_adjust_button(ui_button_t btn, ui_press_t press) {
    int delta = btn == UI_BTN_ADJUST_PLUS ? 1 : -1;
    if (press == UI_PRESS_LONG || press == UI_PRESS_REPEAT) {
        delta *= 5;
    }
    switch (screens_get_page()) {
    case UI_PAGE_START:
        if (s_model.start.timer_running) {
            if (emit_command(UI_CMD_ADJUST_TIMER_SEC, delta)) {
                return;
            }
            if (s_has_external_model) {
                return;
            }
            s_model.start.countdown_sec += delta;
            if (s_model.start.countdown_sec < 0) {
                s_model.start.countdown_sec = 0;
            }
        } else {
            if (emit_command(UI_CMD_ADJUST_START_PRESET_SEC, delta * 60)) {
                return;
            }
            if (s_has_external_model) {
                return;
            }
            s_model.start.preset_start_sec += delta * 60;
            if (s_model.start.preset_start_sec < 60) {
                s_model.start.preset_start_sec = 60;
            }
        }
        break;
    case UI_PAGE_SETTINGS:
        s_settings_selection = (uint8_t)((s_settings_selection + 7 + delta) % 7);
        screens_set_settings_selection(s_settings_selection);
        break;
    case UI_PAGE_LAYOUT:
        {
            uint8_t count = screens_layout_get_visible_count();
            if (count > 0) {
                int next = (int)s_layout_selection + delta;
                while (next < 0) {
                    next += count;
                }
                while (next >= count) {
                    next -= count;
                }
                s_layout_selection = (uint8_t)next;
            }
            screens_set_layout_selection(s_layout_selection);
            s_layout_selection = screens_layout_get_selection();
        }
        break;
    case UI_PAGE_CALIBRATION:
        s_calibration_selection = (uint8_t)((s_calibration_selection + 8 + delta) % 8);
        screens_set_calibration_selection(s_calibration_selection);
        break;
    case UI_PAGE_SYSTEM:
        if (s_system_selection == 0 && s_system_time_edit_field != UI_SYSTEM_TIME_EDIT_OFF) {
            int minutes = (int)s_model.status.hour * 60 + (int)s_model.status.minute;
            ui_status_t next_status = s_model.status;
            if (s_system_time_edit_field == UI_SYSTEM_TIME_EDIT_MODE || s_system_time_edit_field == UI_SYSTEM_TIME_EDIT_GPS_SYNC) {
                next_status.clock_mode = next_status.clock_mode == UI_CLOCK_GPS ? UI_CLOCK_MANUAL : UI_CLOCK_GPS;
                if (emit_command(UI_CMD_SET_CLOCK_MODE, (int32_t)next_status.clock_mode)) {
                    return;
                }
                if (s_has_external_model) {
                    return;
                }
                s_model.status.clock_mode = next_status.clock_mode;
                if (s_model.status.clock_mode == UI_CLOCK_MANUAL && s_system_time_edit_field == UI_SYSTEM_TIME_EDIT_GPS_SYNC) {
                    s_system_time_edit_field = UI_SYSTEM_TIME_EDIT_MODE;
                    screens_set_system_time_edit_field(s_system_time_edit_field);
                }
                screens_update(&s_model);
                return;
            }
            if (s_system_time_edit_field == UI_SYSTEM_TIME_EDIT_YEAR) {
                next_status.year = (uint16_t)((int)next_status.year + delta);
                ui_clamp_date(&next_status);
                if (emit_command(UI_CMD_SET_CLOCK_DATE, ui_clock_date_value(&next_status))) {
                    return;
                }
                if (s_has_external_model) {
                    return;
                }
                s_model.status.year = next_status.year;
                s_model.status.month = next_status.month;
                s_model.status.day = next_status.day;
                screens_update(&s_model);
                return;
            }
            if (s_system_time_edit_field == UI_SYSTEM_TIME_EDIT_MONTH) {
                int month = (int)next_status.month + delta;
                while (month < 1) {
                    month += 12;
                    next_status.year--;
                }
                while (month > 12) {
                    month -= 12;
                    next_status.year++;
                }
                next_status.month = (uint8_t)month;
                ui_clamp_date(&next_status);
                if (emit_command(UI_CMD_SET_CLOCK_DATE, ui_clock_date_value(&next_status))) {
                    return;
                }
                if (s_has_external_model) {
                    return;
                }
                s_model.status.year = next_status.year;
                s_model.status.month = next_status.month;
                s_model.status.day = next_status.day;
                screens_update(&s_model);
                return;
            }
            if (s_system_time_edit_field == UI_SYSTEM_TIME_EDIT_DAY) {
                int day = (int)next_status.day + delta;
                int max_day = ui_days_in_month(next_status.year, next_status.month);
                while (day < 1) {
                    next_status.month--;
                    if (next_status.month < 1) {
                        next_status.month = 12;
                        next_status.year--;
                    }
                    max_day = ui_days_in_month(next_status.year, next_status.month);
                    day += max_day;
                }
                while (day > max_day) {
                    day -= max_day;
                    next_status.month++;
                    if (next_status.month > 12) {
                        next_status.month = 1;
                        next_status.year++;
                    }
                    max_day = ui_days_in_month(next_status.year, next_status.month);
                }
                next_status.day = (uint8_t)day;
                ui_clamp_date(&next_status);
                if (emit_command(UI_CMD_SET_CLOCK_DATE, ui_clock_date_value(&next_status))) {
                    return;
                }
                if (s_has_external_model) {
                    return;
                }
                s_model.status.year = next_status.year;
                s_model.status.month = next_status.month;
                s_model.status.day = next_status.day;
                screens_update(&s_model);
                return;
            }
            if (s_system_time_edit_field == UI_SYSTEM_TIME_EDIT_HOUR || s_system_time_edit_field == UI_SYSTEM_TIME_EDIT_MINUTE) {
                minutes += s_system_time_edit_field == UI_SYSTEM_TIME_EDIT_HOUR ? delta * 60 : delta;
                while (minutes < 0) {
                    minutes += 24 * 60;
                }
                while (minutes >= 24 * 60) {
                    minutes -= 24 * 60;
                }
                if (emit_command(UI_CMD_SET_CLOCK_MINUTES, minutes)) {
                    return;
                }
                if (s_has_external_model) {
                    return;
                }
                s_model.status.hour = (uint8_t)(minutes / 60);
                s_model.status.minute = (uint8_t)(minutes % 60);
                screens_update(&s_model);
                return;
            }
            return;
        }
        s_system_selection = (uint8_t)((s_system_selection + 6 + delta) % 6);
        screens_set_system_selection(s_system_selection);
        break;
    default:
        return;
    }
    screens_update(&s_model);
}

void ui_handle_button(ui_button_t btn, ui_press_t press) {
    switch (btn) {
    case UI_BTN_PAGE: handle_page_button(press); break;
    case UI_BTN_ACTION: handle_action_button(press); break;
    case UI_BTN_ADJUST_MINUS:
    case UI_BTN_ADJUST_PLUS: handle_adjust_button(btn, press); break;
    default: break;
    }
}

#endif
