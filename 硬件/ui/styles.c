#include "styles.h"
#include "images.h"
#include "fonts.h"

#include "ui.h"
#include "screens.h"

#include "lv_font_montserrat_160.c"

lv_style_t ui_style_screen;
lv_style_t ui_style_topbar;
lv_style_t ui_style_card;
lv_style_t ui_style_panel;
lv_style_t ui_style_label;
lv_style_t ui_style_body;
lv_style_t ui_style_med;
lv_style_t ui_style_large;
lv_style_t ui_style_xl;
lv_style_t ui_style_xxl;
lv_style_t ui_style_footer;
lv_style_t ui_style_line;
lv_style_t ui_style_warn;
lv_style_t ui_style_danger;
lv_style_t ui_style_inverse;
lv_style_t ui_style_selected;

static bool s_styles_ready = false;

static void style_reset(lv_style_t *style) {
    if (s_styles_ready) {
        lv_style_reset(style);
    } else {
        lv_style_init(style);
    }
}

void ui_styles_init(void) {
    style_reset(&ui_style_screen);
    lv_style_set_bg_color(&ui_style_screen, UI_COLOR_BG);
    lv_style_set_bg_opa(&ui_style_screen, LV_OPA_COVER);
    lv_style_set_text_color(&ui_style_screen, UI_COLOR_TEXT);
    lv_style_set_text_font(&ui_style_screen, LV_FONT_DEFAULT);
    lv_style_set_pad_all(&ui_style_screen, 0);

    style_reset(&ui_style_topbar);
    lv_style_set_bg_opa(&ui_style_topbar, LV_OPA_TRANSP);
    lv_style_set_border_width(&ui_style_topbar, 0);
    lv_style_set_radius(&ui_style_topbar, 0);
    lv_style_set_pad_all(&ui_style_topbar, 0);
    lv_style_set_text_color(&ui_style_topbar, UI_COLOR_TEXT);
    lv_style_set_text_font(&ui_style_topbar, LV_FONT_DEFAULT);

    style_reset(&ui_style_card);
    lv_style_set_bg_color(&ui_style_card, UI_COLOR_PANEL);
    lv_style_set_bg_opa(&ui_style_card, LV_OPA_COVER);
    lv_style_set_border_color(&ui_style_card, UI_COLOR_LINE);
    lv_style_set_border_width(&ui_style_card, 2);
    lv_style_set_radius(&ui_style_card, 8);
    lv_style_set_pad_all(&ui_style_card, 0);
    lv_style_set_text_color(&ui_style_card, UI_COLOR_TEXT);

    style_reset(&ui_style_panel);
    lv_style_set_bg_color(&ui_style_panel, UI_COLOR_PANEL);
    lv_style_set_bg_opa(&ui_style_panel, LV_OPA_COVER);
    lv_style_set_border_color(&ui_style_panel, UI_COLOR_LINE);
    lv_style_set_border_width(&ui_style_panel, 2);
    lv_style_set_radius(&ui_style_panel, 8);
    lv_style_set_pad_all(&ui_style_panel, 0);

    style_reset(&ui_style_label);
    lv_style_set_text_color(&ui_style_label, UI_COLOR_TEXT);
    lv_style_set_text_font(&ui_style_label, LV_FONT_DEFAULT);

    style_reset(&ui_style_body);
    lv_style_set_text_color(&ui_style_body, UI_COLOR_TEXT);
    lv_style_set_text_font(&ui_style_body, &lv_font_montserrat_36);
    lv_style_set_text_line_space(&ui_style_body, -8);

    style_reset(&ui_style_med);
    lv_style_set_text_color(&ui_style_med, UI_COLOR_TEXT);
    lv_style_set_text_font(&ui_style_med, &lv_font_montserrat_48);

    style_reset(&ui_style_large);
    lv_style_set_text_color(&ui_style_large, UI_COLOR_TEXT);
    lv_style_set_text_font(&ui_style_large, &lv_font_montserrat_90);

    style_reset(&ui_style_xl);
    lv_style_set_text_color(&ui_style_xl, UI_COLOR_TEXT);
    lv_style_set_text_font(&ui_style_xl, &lv_font_montserrat_90);

    style_reset(&ui_style_xxl);
    lv_style_set_text_color(&ui_style_xxl, UI_COLOR_TEXT);
    lv_style_set_text_font(&ui_style_xxl, &lv_font_montserrat_160);

    style_reset(&ui_style_footer);
    lv_style_set_bg_opa(&ui_style_footer, LV_OPA_TRANSP);
    lv_style_set_border_width(&ui_style_footer, 0);
    lv_style_set_text_color(&ui_style_footer, UI_COLOR_TEXT);
    lv_style_set_text_font(&ui_style_footer, LV_FONT_DEFAULT);
    lv_style_set_pad_all(&ui_style_footer, 0);

    style_reset(&ui_style_line);
    lv_style_set_line_color(&ui_style_line, UI_COLOR_LINE);
    lv_style_set_line_width(&ui_style_line, 3);
    lv_style_set_line_rounded(&ui_style_line, false);

    style_reset(&ui_style_warn);
    lv_style_set_text_color(&ui_style_warn, UI_COLOR_WARN);
    lv_style_set_border_color(&ui_style_warn, UI_COLOR_WARN);
    lv_style_set_border_width(&ui_style_warn, 2);

    style_reset(&ui_style_danger);
    lv_style_set_text_color(&ui_style_danger, UI_COLOR_DANGER);
    lv_style_set_border_color(&ui_style_danger, UI_COLOR_DANGER);
    lv_style_set_border_width(&ui_style_danger, 3);

    style_reset(&ui_style_inverse);
    lv_style_set_bg_color(&ui_style_inverse, UI_COLOR_INV_BG);
    lv_style_set_bg_opa(&ui_style_inverse, LV_OPA_COVER);
    lv_style_set_text_color(&ui_style_inverse, UI_COLOR_INV_TXT);
    lv_style_set_border_color(&ui_style_inverse, UI_COLOR_LINE);
    lv_style_set_border_width(&ui_style_inverse, 2);
    lv_style_set_radius(&ui_style_inverse, 6);
    lv_style_set_pad_all(&ui_style_inverse, 0);

    style_reset(&ui_style_selected);
    lv_style_set_bg_color(&ui_style_selected, UI_COLOR_INV_BG);
    lv_style_set_bg_opa(&ui_style_selected, LV_OPA_COVER);
    lv_style_set_text_color(&ui_style_selected, UI_COLOR_INV_TXT);
    lv_style_set_radius(&ui_style_selected, 4);
    lv_style_set_pad_left(&ui_style_selected, 4);

    s_styles_ready = true;
}

void ui_style_apply_profile(bool night_mode) {
    (void)night_mode;
    if (!s_styles_ready) {
        ui_styles_init();
    }

    lv_style_set_bg_color(&ui_style_screen, UI_COLOR_BG);
    lv_style_set_text_color(&ui_style_screen, UI_COLOR_TEXT);
    lv_style_set_bg_color(&ui_style_card, UI_COLOR_PANEL);
    lv_style_set_text_color(&ui_style_card, UI_COLOR_TEXT);
    lv_style_set_bg_color(&ui_style_panel, UI_COLOR_PANEL);
}
