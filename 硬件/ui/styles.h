#ifndef EEZ_LVGL_UI_STYLES_H
#define EEZ_LVGL_UI_STYLES_H

#include <lvgl/lvgl.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

extern lv_style_t ui_style_screen;
extern lv_style_t ui_style_topbar;
extern lv_style_t ui_style_card;
extern lv_style_t ui_style_panel;
extern lv_style_t ui_style_label;
extern lv_style_t ui_style_body;
extern lv_style_t ui_style_med;
extern lv_style_t ui_style_large;
extern lv_style_t ui_style_xl;
extern lv_style_t ui_style_xxl;
extern lv_style_t ui_style_footer;
extern lv_style_t ui_style_line;
extern lv_style_t ui_style_warn;
extern lv_style_t ui_style_danger;
extern lv_style_t ui_style_inverse;
extern lv_style_t ui_style_selected;

#define UI_COLOR_BG      lv_color_hex(0xF2F2F2)
#define UI_COLOR_PANEL   lv_color_hex(0xFFFFFF)
#define UI_COLOR_TEXT    lv_color_hex(0x111111)
#define UI_COLOR_MUTED   lv_color_hex(0x555555)
#define UI_COLOR_LINE    lv_color_hex(0x111111)
#define UI_COLOR_OK      lv_color_hex(0x111111)
#define UI_COLOR_WARN    lv_color_hex(0x111111)
#define UI_COLOR_DANGER  lv_color_hex(0x111111)
#define UI_COLOR_BLUE    lv_color_hex(0x111111)
#define UI_COLOR_INV_BG  lv_color_hex(0x111111)
#define UI_COLOR_INV_TXT lv_color_hex(0xFFFFFF)

void ui_styles_init(void);
void ui_style_apply_profile(bool night_mode);

#ifdef __cplusplus
}
#endif

#endif /*EEZ_LVGL_UI_STYLES_H*/