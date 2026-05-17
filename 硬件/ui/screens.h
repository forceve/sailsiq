#ifndef EEZ_LVGL_UI_SCREENS_H
#define EEZ_LVGL_UI_SCREENS_H

#include <lvgl/lvgl.h>
#include "ui_model.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct _objects_t {
    lv_obj_t *compass;
    lv_obj_t *start;
    lv_obj_t *mark;
    lv_obj_t *finish;
    lv_obj_t *settings;
    lv_obj_t *layout;
    lv_obj_t *calibration;
    lv_obj_t *system;
} objects_t;

extern objects_t objects;

enum ScreensEnum {
    SCREEN_ID_COMPASS = 1,
    SCREEN_ID_START = 2,
    SCREEN_ID_MARK = 3,
    SCREEN_ID_FINISH = 4,
    SCREEN_ID_SETTINGS = 5,
    SCREEN_ID_LAYOUT = 6,
    SCREEN_ID_CALIBRATION = 7,
    SCREEN_ID_SYSTEM = 8,
};

void create_screen_compass();
void create_screen_start();
void create_screen_mark();
void create_screen_finish();
void create_screen_settings();
void create_screen_layout();
void create_screen_calibration();
void create_screen_system();
void tick_screen_compass();
void tick_screen_start();
void tick_screen_mark();
void tick_screen_finish();
void tick_screen_settings();
void tick_screen_layout();
void tick_screen_calibration();
void tick_screen_system();

void tick_screen_by_id(enum ScreensEnum screenId);
void tick_screen(int screen_index);

void create_screens();
void screens_update(const ui_model_t *model);
void screens_set_page(ui_page_t page);
ui_page_t screens_get_page(void);
void screens_set_settings_selection(uint8_t index);
void screens_set_layout_selection(uint8_t index);
void screens_set_layout_editing(bool editing);
uint8_t screens_layout_get_selection(void);
uint8_t screens_layout_get_visible_count(void);
bool screens_layout_selected_is_page(void);
bool screens_layout_selected_is_mode(void);
bool screens_layout_selected_is_save(void);
bool screens_layout_selected_is_reset_page(void);
bool screens_layout_selected_is_reset_all(void);
void screens_layout_toggle_page_mode(void);
void screens_layout_apply_selected_preset(void);
void screens_layout_reset_current(void);
void screens_layout_reset_defaults(void);
void screens_set_layout_status(const char *status);
void screens_get_layout_config(ui_layout_config_t *config);
bool screens_apply_layout_config(const ui_layout_config_t *config);
bool screens_layout_config_in_range(const ui_layout_config_t *config);
ui_page_mode_t screens_get_page_mode(void);
bool screens_main_page_enabled(ui_page_t page);
void screens_set_calibration_selection(uint8_t index);
void screens_set_system_selection(uint8_t index);
void screens_set_system_time_edit_field(uint8_t field);


#ifdef __cplusplus
}
#endif

#endif /*EEZ_LVGL_UI_SCREENS_H*/
