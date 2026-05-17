#ifndef EEZ_LVGL_UI_GUI_H
#define EEZ_LVGL_UI_GUI_H

#include <lvgl/lvgl.h>
#include "ui_model.h"



#if defined(EEZ_FOR_LVGL)
#include <eez/flow/lvgl_api.h>
#endif

#if !defined(EEZ_FOR_LVGL)
#include "screens.h"
#endif

#ifdef __cplusplus
extern "C" {
#endif



void ui_init(void);
void ui_tick(void);
void ui_set_page(ui_page_t page);
ui_page_t ui_get_page(void);
void ui_update(const ui_model_t *model);
void ui_handle_button(ui_button_t btn, ui_press_t press);
void ui_set_command_handler(ui_command_handler_t handler);
void ui_request_redraw(void);
void ui_set_brightness_profile(ui_brightness_profile_t profile);
void ui_get_layout_config(ui_layout_config_t *config);
bool ui_apply_layout_config(const ui_layout_config_t *config);
void ui_reset_layout_config(void);
uint32_t ui_layout_config_crc32(const ui_layout_config_t *config);
bool ui_layout_config_validate(const ui_layout_config_t *config);
bool ui_layout_storage_load(ui_layout_config_t *config);
bool ui_layout_storage_save(const ui_layout_config_t *config);

#if !defined(EEZ_FOR_LVGL)
void loadScreen(enum ScreensEnum screenId);
#endif

#ifdef __cplusplus
}
#endif

#endif // EEZ_LVGL_UI_GUI_H
