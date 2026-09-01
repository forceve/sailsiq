#ifndef SAILSIQ_UI_MODEL_H
#define SAILSIQ_UI_MODEL_H

#include <stdbool.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    UI_PAGE_COMPASS,
    UI_PAGE_START,
    UI_PAGE_MARK,
    UI_PAGE_FINISH,
    UI_PAGE_SETTINGS,
    UI_PAGE_LAYOUT,
    UI_PAGE_CALIBRATION,
} ui_page_t;

typedef enum {
    UI_LAYOUT_PAGE_COMPASS,
    UI_LAYOUT_PAGE_START,
    UI_LAYOUT_PAGE_MARK,
    UI_LAYOUT_PAGE_FINISH,
    UI_LAYOUT_PAGE_COUNT,
} ui_layout_page_t;

typedef enum {
    UI_PAGE_MODE_START_COMPASS,
    UI_PAGE_MODE_ALL,
    UI_PAGE_MODE_COUNT,
} ui_page_mode_t;

typedef enum {
    UI_NAV_LAYOUT_CLASSIC,
    UI_NAV_LAYOUT_BIG_HEADING,
    UI_NAV_LAYOUT_TACTICAL_4,
    UI_NAV_LAYOUT_COUNT,
} ui_nav_layout_preset_t;

typedef enum {
    UI_START_LAYOUT_CLASSIC,
    UI_START_LAYOUT_PACE_FOCUS,
    UI_START_LAYOUT_LINE_FOCUS,
    UI_START_LAYOUT_MATCH,
    UI_START_LAYOUT_COUNT,
} ui_start_layout_preset_t;

#define UI_LAYOUT_CONFIG_MAGIC 0x514C4955u
#define UI_LAYOUT_CONFIG_VERSION 2u

typedef struct {
    uint32_t magic;
    uint16_t version;
    uint16_t size;
    uint8_t page_preset[UI_LAYOUT_PAGE_COUNT];
    uint8_t page_mode;
    uint32_t crc32;
} ui_layout_config_t;

typedef enum {
    UI_BTN_PAGE,
    UI_BTN_ACTION,
    UI_BTN_ADJUST_MINUS,
    UI_BTN_ADJUST_PLUS,
} ui_button_t;

typedef enum {
    UI_PRESS_SHORT,
    UI_PRESS_LONG,
    UI_PRESS_REPEAT,
} ui_press_t;

typedef enum {
    LCD_PROFILE_DAY,
    LCD_PROFILE_NIGHT,
    LCD_PROFILE_POWER_SAVE,
} ui_brightness_profile_t;

typedef enum {
    UI_CMD_NONE,
    UI_CMD_START_TIMER,
    UI_CMD_RESET_TIMER,
    UI_CMD_ADJUST_TIMER_SEC,        /* value: signed seconds */
    UI_CMD_ADJUST_START_PRESET_SEC, /* value: signed seconds */
    UI_CMD_TOGGLE_RACE_MODE,
    UI_CMD_SET_BRIGHTNESS_PROFILE,  /* value: ui_brightness_profile_t */
    UI_CMD_TOGGLE_APPROACH_LOCK,
    UI_CMD_CALIBRATION_SET,         /* value: ui_calibration_target_t */
    UI_CMD_MANUAL_PAGE_SELECTED,    /* value: ui_page_t */
} ui_command_t;

typedef void (*ui_command_handler_t)(ui_command_t command, int32_t value);

typedef enum {
    UI_CAL_SET_PIN,
    UI_CAL_SET_BOAT,
    UI_CAL_SET_FINISH_PIN,
    UI_CAL_SET_FINISH_BOAT,
    UI_CAL_SET_WINDWARD_MARK,
    UI_CAL_SET_OFFSET_MARK,
    UI_CAL_SET_LEEWARD_MARK,
    UI_CAL_ORBIT_MARK,
} ui_calibration_target_t;

typedef enum { RACE_FLEET, RACE_MATCH } race_mode_t;

typedef enum {
    SCENE_START_WAIT,
    SCENE_START_ACTIVE,
    SCENE_UPWIND_MARK,
    SCENE_OFFSET_MARK,
    SCENE_DOWNWIND_MARK,
    SCENE_UPWIND_FINISH,
    SCENE_DOWNWIND_FINISH,
} active_scene_t;

typedef enum { FIX_NONE, FIX_2D, FIX_3D } gnss_fix_t;
typedef enum { ROUND_UNKNOWN, ROUND_PORT, ROUND_STARBOARD } rounding_side_t;

typedef struct {
    gnss_fix_t fix;
    uint8_t sat_count;
    bool recording;
    uint8_t battery_percent;
    uint8_t hour;
    uint8_t minute;
    bool logger_error;
} ui_status_t;

typedef struct {
    float heading_deg;
    float cog_deg;
    float sog_kn;
    float drift_deg;
    float vmg_mark_kn;
    float vmg_finish_kn;
    float dtg_m;
    float brg_deg;
    int32_t eta_sec;
    int32_t ttl_sec;
    float line_dist_m;
    float finish_line_dist_m;
    float angle_error_deg;
    uint8_t heading_confidence;
    uint16_t turns_count;
    bool mag_bad;
} ui_nav_t;

typedef struct {
    race_mode_t race_mode;
    active_scene_t active_scene;
    int32_t countdown_sec;
    int32_t preset_start_sec;
    int32_t match_box_sec;
    int32_t box_in_sec;
    int32_t burn_sec;
    int32_t box_burn_sec;
    bool box_in;
    bool ocs_risk;
    bool timer_running;
} ui_start_t;

typedef struct {
    char target_id[8];
    rounding_side_t rounding_side;
    bool target_configured;
    bool approach_lock;
    bool auto_scene_enabled;
    bool manual_override;
} ui_course_t;

typedef struct {
    ui_brightness_profile_t brightness_profile;
    uint8_t lcd_brightness_percent;
    bool night_mode;
} ui_display_t;

typedef struct {
    ui_status_t status;
    ui_nav_t nav;
    ui_start_t start;
    ui_course_t course;
    ui_display_t display;
} ui_model_t;

#ifdef __cplusplus
}
#endif

#endif /* SAILSIQ_UI_MODEL_H */
