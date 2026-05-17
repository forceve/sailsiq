#include <stdio.h>
#include <stdint.h>
#include <string.h>

#include "screens.h"
#include "styles.h"
#include "ui.h"
#include "ui_format.h"

/* Digit sprites for Big Heading (do not add ui_heading_digit_assets.c to the project separately). */
#include "ui_heading_digit_assets.h"
#include "ui_heading_digit_assets.c"

#if LVGL_VERSION_MAJOR >= 9
#define UI_HEADING_IMG_CREATE(parent) lv_image_create(parent)
#define UI_HEADING_IMG_SET_SRC(obj, src) lv_image_set_src(obj, src)
#define UI_HEADING_IMG_SET_SCALE(obj, z) lv_image_set_scale((obj), (uint32_t)(z))
#define UI_HEADING_IMG_SET_PIVOT(obj, x, y) lv_image_set_pivot((obj), (x), (y))
#define UI_HEADING_IMG_ZOOM_1X LV_SCALE_NONE
#else
#define UI_HEADING_IMG_CREATE(parent) lv_img_create(parent)
#define UI_HEADING_IMG_SET_SRC(obj, src) lv_img_set_src(obj, src)
#define UI_HEADING_IMG_SET_SCALE(obj, z) lv_img_set_zoom((obj), (uint16_t)(z))
#define UI_HEADING_IMG_SET_PIVOT(obj, x, y) lv_img_set_pivot((obj), (x), (y))
#define UI_HEADING_IMG_ZOOM_1X 256
#endif

#if LVGL_VERSION_MAJOR >= 9
#define UI_SCREEN_LOAD(scr) lv_screen_load(scr)
#define UI_DISPLAY_T lv_display_t
#define UI_DISPLAY_GET_DEFAULT() lv_display_get_default()
#define UI_DISPLAY_SET_THEME(d, t) lv_display_set_theme(d, t)
#else
#define UI_SCREEN_LOAD(scr) lv_scr_load(scr)
#define UI_DISPLAY_T lv_disp_t
#define UI_DISPLAY_GET_DEFAULT() lv_disp_get_default()
#define UI_DISPLAY_SET_THEME(d, t) lv_disp_set_theme(d, t)
#endif

#define UI_SCREEN_W 400
#define UI_SCREEN_H 300
#define UI_SAFE_X 10
#define UI_TOPBAR_Y 8
#define UI_TOPBAR_H 22
#define UI_CARD_X 10
#define UI_CARD_Y 36
#define UI_CARD_W 380
#define UI_CARD_H 220
#define UI_FOOT_Y 262
#define UI_FOOT_H 28
#define UI_RULE_W 2
#define UI_INNER_X 8
#define UI_INNER_W (UI_CARD_W - UI_INNER_X * 2)
#define UI_MAIN_SPLIT_Y (UI_CARD_H / 2 - UI_RULE_W / 2)
#define UI_COL_SPLIT_X (UI_CARD_W / 2 - UI_RULE_W / 2)
#define UI_RIGHT_CELL_X (UI_COL_SPLIT_X + UI_RULE_W)
#define UI_RIGHT_CELL_W (UI_CARD_W - UI_RIGHT_CELL_X)
#define UI_BOTTOM_Y (UI_MAIN_SPLIT_Y + UI_RULE_W)
#define UI_BOTTOM_H (UI_CARD_H - UI_BOTTOM_Y)

#define UI_NAV_SLOT_COUNT 4
#define UI_START_SLOT_COUNT 3
#define UI_SETTINGS_ITEM_COUNT 7
#define UI_LAYOUT_ROOT_MAX_ITEM_COUNT (UI_LAYOUT_PAGE_COUNT + 4)
#define UI_LAYOUT_ITEM_COUNT UI_LAYOUT_ROOT_MAX_ITEM_COUNT
#define UI_LAYOUT_PREVIEW_X 8
#define UI_LAYOUT_PREVIEW_Y 96
#define UI_LAYOUT_PREVIEW_W 188
#define UI_LAYOUT_PREVIEW_H 112
#define UI_LAYOUT_PREVIEW_RULE_W 2
#define UI_CALIBRATION_ITEM_COUNT 8

objects_t objects;
lv_obj_t *tick_value_change_obj;
uint32_t active_theme_index = 0;

typedef struct {
    lv_obj_t *fix;
    lv_obj_t *sat;
    lv_obj_t *rec;
    lv_obj_t *time;
    lv_obj_t *bat;
} topbar_view_t;

typedef struct {
    lv_obj_t *title;
    lv_obj_t *value;
} metric_view_t;

typedef struct {
    topbar_view_t top;
    lv_obj_t *card;
    lv_obj_t *rule_h;
    lv_obj_t *rule_v;
    metric_view_t slots[UI_NAV_SLOT_COUNT];
    lv_obj_t *big_heading_row;
    lv_obj_t *big_heading_imgs[3];
    lv_obj_t *footer;
} nav_page_view_t;

typedef struct {
    topbar_view_t top;
    lv_obj_t *card;
    lv_obj_t *rule_h;
    lv_obj_t *rule_v;
    metric_view_t slots[UI_START_SLOT_COUNT];
    lv_obj_t *footer;
} start_view_t;

typedef struct {
    topbar_view_t top;
    lv_obj_t *items[UI_SETTINGS_ITEM_COUNT];
    lv_obj_t *mode;
    lv_obj_t *diagram;
    lv_obj_t *footer;
} settings_view_t;

typedef struct {
    topbar_view_t top;
    lv_obj_t *title;
    lv_obj_t *items[UI_LAYOUT_ITEM_COUNT];
    lv_obj_t *cursors[UI_LAYOUT_ITEM_COUNT];
    lv_obj_t *preview_title;
    lv_obj_t *preview_lines[5];
    lv_obj_t *preview_card;
    lv_obj_t *preview_rule_h;
    lv_obj_t *preview_rule_v;
    lv_obj_t *preview_slots[4];
    lv_obj_t *status;
    lv_obj_t *footer;
} layout_view_t;

typedef struct {
    topbar_view_t top;
    lv_obj_t *items[UI_CALIBRATION_ITEM_COUNT];
    lv_obj_t *title;
    lv_obj_t *status;
    lv_obj_t *footer;
} calibration_view_t;

typedef enum {
    UI_VALUE_STYLE_BODY,
    UI_VALUE_STYLE_MED,
    UI_VALUE_STYLE_LARGE,
    UI_VALUE_STYLE_XL,
    UI_VALUE_STYLE_XXL,
} value_style_t;

static nav_page_view_t s_compass;
static start_view_t s_start;
static nav_page_view_t s_mark;
static nav_page_view_t s_finish;
static settings_view_t s_settings;
static layout_view_t s_layout;
static calibration_view_t s_calibration;
static ui_model_t s_model;
static ui_page_t s_page = UI_PAGE_COMPASS;
static uint8_t s_settings_selection = 0;
static uint8_t s_calibration_selection = 0;
static ui_page_mode_t s_page_mode = UI_PAGE_MODE_ALL;
static uint8_t s_layout_selection = 0;
static uint8_t s_layout_target_page = UI_LAYOUT_PAGE_COMPASS;
static bool s_layout_editing = false;
static char s_layout_status[32] = "Select page";
static uint8_t s_layout_presets[UI_LAYOUT_PAGE_COUNT] = {
    UI_NAV_LAYOUT_CLASSIC,
    UI_START_LAYOUT_CLASSIC,
    UI_NAV_LAYOUT_CLASSIC,
    UI_NAV_LAYOUT_CLASSIC,
};

static lv_obj_t *screen_create(void) {
    lv_obj_t *screen = lv_obj_create(NULL);
    lv_obj_set_size(screen, UI_SCREEN_W, UI_SCREEN_H);
    lv_obj_add_style(screen, &ui_style_screen, LV_PART_MAIN | LV_STATE_DEFAULT);
    lv_obj_clear_flag(screen, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_scrollbar_mode(screen, LV_SCROLLBAR_MODE_OFF);
    return screen;
}

static lv_obj_t *panel_create(lv_obj_t *parent, int x, int y, int w, int h) {
    lv_obj_t *obj = lv_obj_create(parent);
    lv_obj_set_pos(obj, x, y);
    lv_obj_set_size(obj, w, h);
    lv_obj_add_style(obj, &ui_style_panel, LV_PART_MAIN | LV_STATE_DEFAULT);
    lv_obj_clear_flag(obj, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_scrollbar_mode(obj, LV_SCROLLBAR_MODE_OFF);
    return obj;
}

static lv_obj_t *card_create(lv_obj_t *parent) {
    lv_obj_t *obj = panel_create(parent, UI_CARD_X, UI_CARD_Y, UI_CARD_W, UI_CARD_H);
    lv_obj_remove_style(obj, &ui_style_panel, LV_PART_MAIN | LV_STATE_DEFAULT);
    lv_obj_add_style(obj, &ui_style_card, LV_PART_MAIN | LV_STATE_DEFAULT);
    return obj;
}

static lv_obj_t *label_create(lv_obj_t *parent, const char *text, int x, int y, int w, int h, lv_style_t *style, lv_text_align_t align) {
    lv_obj_t *label = lv_label_create(parent);
    lv_obj_set_pos(label, x, y);
    lv_obj_set_size(label, w, h);
    lv_label_set_long_mode(label, LV_LABEL_LONG_CLIP);
    lv_obj_set_style_text_align(label, align, LV_PART_MAIN | LV_STATE_DEFAULT);
    if (style != NULL) {
        lv_obj_add_style(label, style, LV_PART_MAIN | LV_STATE_DEFAULT);
    }
    lv_label_set_text(label, text);
    return label;
}

static lv_obj_t *rule_create(lv_obj_t *parent, int x, int y, int w, int h) {
    lv_obj_t *rule = lv_obj_create(parent);
    lv_obj_set_pos(rule, x, y);
    lv_obj_set_size(rule, w, h);
    lv_obj_set_style_bg_color(rule, UI_COLOR_LINE, LV_PART_MAIN | LV_STATE_DEFAULT);
    lv_obj_set_style_bg_opa(rule, LV_OPA_COVER, LV_PART_MAIN | LV_STATE_DEFAULT);
    lv_obj_set_style_border_width(rule, 0, LV_PART_MAIN | LV_STATE_DEFAULT);
    lv_obj_set_style_radius(rule, 0, LV_PART_MAIN | LV_STATE_DEFAULT);
    lv_obj_set_style_pad_all(rule, 0, LV_PART_MAIN | LV_STATE_DEFAULT);
    lv_obj_clear_flag(rule, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_scrollbar_mode(rule, LV_SCROLLBAR_MODE_OFF);
    return rule;
}

static void set_text_if_changed(lv_obj_t *label, const char *value) {
    const char *current = lv_label_get_text(label);
    if (current == NULL || strcmp(current, value) != 0) {
        tick_value_change_obj = label;
        lv_label_set_text(label, value);
        tick_value_change_obj = NULL;
    }
}

static void set_hidden(lv_obj_t *obj, bool hidden) {
    if (hidden) {
        lv_obj_add_flag(obj, LV_OBJ_FLAG_HIDDEN);
    } else {
        lv_obj_clear_flag(obj, LV_OBJ_FLAG_HIDDEN);
    }
}

static void set_inverse(lv_obj_t *obj, bool enabled) {
    if (enabled) {
        lv_obj_add_style(obj, &ui_style_inverse, LV_PART_MAIN | LV_STATE_DEFAULT);
    } else {
        lv_obj_remove_style(obj, &ui_style_inverse, LV_PART_MAIN | LV_STATE_DEFAULT);
    }
}

static void set_value_style(lv_obj_t *obj, value_style_t style) {
    lv_obj_remove_style(obj, &ui_style_body, LV_PART_MAIN | LV_STATE_DEFAULT);
    lv_obj_remove_style(obj, &ui_style_med, LV_PART_MAIN | LV_STATE_DEFAULT);
    lv_obj_remove_style(obj, &ui_style_large, LV_PART_MAIN | LV_STATE_DEFAULT);
    lv_obj_remove_style(obj, &ui_style_xl, LV_PART_MAIN | LV_STATE_DEFAULT);
    lv_obj_remove_style(obj, &ui_style_xxl, LV_PART_MAIN | LV_STATE_DEFAULT);

    switch (style) {
    case UI_VALUE_STYLE_BODY:
        lv_obj_add_style(obj, &ui_style_body, LV_PART_MAIN | LV_STATE_DEFAULT);
        break;
    case UI_VALUE_STYLE_MED:
        lv_obj_add_style(obj, &ui_style_med, LV_PART_MAIN | LV_STATE_DEFAULT);
        break;
    case UI_VALUE_STYLE_LARGE:
        lv_obj_add_style(obj, &ui_style_large, LV_PART_MAIN | LV_STATE_DEFAULT);
        break;
    case UI_VALUE_STYLE_XL:
        lv_obj_add_style(obj, &ui_style_xl, LV_PART_MAIN | LV_STATE_DEFAULT);
        break;
    case UI_VALUE_STYLE_XXL:
    default:
        lv_obj_add_style(obj, &ui_style_xxl, LV_PART_MAIN | LV_STATE_DEFAULT);
        break;
    }
}

static void metric_hide(metric_view_t *metric) {
    set_hidden(metric->title, true);
    set_hidden(metric->value, true);
    set_inverse(metric->value, false);
}

static void metric_place(metric_view_t *metric, const char *title, int x, int y, int w, int h, value_style_t style) {
    int value_y = y + (h >= 160 ? 30 : 20);
    int value_h = h - (value_y - y);
    if (value_h < 24) {
        value_h = 24;
    }

    set_hidden(metric->title, false);
    set_hidden(metric->value, false);
    set_inverse(metric->value, false);
    set_text_if_changed(metric->title, title);
    lv_obj_set_pos(metric->title, x + 8, y + 8);
    lv_obj_set_size(metric->title, w - 16, 20);
    lv_obj_set_style_text_align(metric->title, LV_TEXT_ALIGN_LEFT, LV_PART_MAIN | LV_STATE_DEFAULT);

    lv_obj_set_pos(metric->value, x + 4, value_y);
    lv_obj_set_size(metric->value, w - 8, value_h);
    lv_obj_set_style_text_align(metric->value, LV_TEXT_ALIGN_CENTER, LV_PART_MAIN | LV_STATE_DEFAULT);
    set_value_style(metric->value, style);
}

static void rule_place(lv_obj_t *rule, bool visible, int x, int y, int w, int h) {
    set_hidden(rule, !visible);
    if (visible) {
        lv_obj_set_pos(rule, x, y);
        lv_obj_set_size(rule, w, h);
    }
}

static void create_topbar(lv_obj_t *screen, topbar_view_t *top) {
    lv_obj_t *bar = lv_obj_create(screen);
    lv_obj_set_pos(bar, UI_SAFE_X, UI_TOPBAR_Y);
    lv_obj_set_size(bar, UI_CARD_W, UI_TOPBAR_H);
    lv_obj_add_style(bar, &ui_style_topbar, LV_PART_MAIN | LV_STATE_DEFAULT);
    lv_obj_clear_flag(bar, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_scrollbar_mode(bar, LV_SCROLLBAR_MODE_OFF);

    top->fix = label_create(bar, "", 0, 0, 58, 18, &ui_style_topbar, LV_TEXT_ALIGN_LEFT);
    top->sat = label_create(bar, "", 62, 0, 54, 18, &ui_style_topbar, LV_TEXT_ALIGN_LEFT);
    top->rec = label_create(bar, "", 120, 0, 50, 18, &ui_style_topbar, LV_TEXT_ALIGN_LEFT);
    top->time = label_create(bar, "", 178, 0, 60, 18, &ui_style_topbar, LV_TEXT_ALIGN_LEFT);
    top->bat = label_create(bar, "", 306, 0, 74, 18, &ui_style_topbar, LV_TEXT_ALIGN_RIGHT);
}

static void update_topbar(topbar_view_t *top, const ui_status_t *status) {
    char buf[32];

    snprintf(buf, sizeof(buf), "%s", status->fix == FIX_3D ? "FIX 3D" : status->fix == FIX_2D ? "FIX 2D" : "NOFIX");
    set_text_if_changed(top->fix, buf);
    lv_obj_set_style_text_color(top->fix, status->fix == FIX_NONE ? UI_COLOR_WARN : UI_COLOR_TEXT, LV_PART_MAIN | LV_STATE_DEFAULT);

    snprintf(buf, sizeof(buf), "SAT %u", (unsigned)status->sat_count);
    set_text_if_changed(top->sat, buf);

    set_text_if_changed(top->rec, status->logger_error ? "RECx" : status->recording ? "REC*" : "REC-");
    set_inverse(top->rec, status->logger_error);
    lv_obj_set_style_text_color(top->rec, status->logger_error ? UI_COLOR_INV_TXT : status->recording ? UI_COLOR_OK : UI_COLOR_TEXT, LV_PART_MAIN | LV_STATE_DEFAULT);

    ui_format_clock(buf, sizeof(buf), status->hour, status->minute);
    set_text_if_changed(top->time, buf);

    if (status->battery_percent <= 15) {
        snprintf(buf, sizeof(buf), "BAT LOW");
    } else {
        snprintf(buf, sizeof(buf), "BAT %u%%", (unsigned)status->battery_percent);
    }
    set_text_if_changed(top->bat, buf);
    set_inverse(top->bat, status->battery_percent <= 15);
}

static void create_metric(metric_view_t *metric, lv_obj_t *parent) {
    metric->title = label_create(parent, "", 0, 0, 10, 10, &ui_style_label, LV_TEXT_ALIGN_LEFT);
    metric->value = label_create(parent, "", 0, 0, 10, 10, &ui_style_large, LV_TEXT_ALIGN_CENTER);
    metric_hide(metric);
}

static lv_obj_t *cursor_create(lv_obj_t *parent, int x, int y) {
    lv_obj_t *cursor = lv_obj_create(parent);
    lv_obj_set_pos(cursor, x, y);
    lv_obj_set_size(cursor, 10, 10);
    lv_obj_set_style_bg_color(cursor, UI_COLOR_TEXT, LV_PART_MAIN | LV_STATE_DEFAULT);
    lv_obj_set_style_bg_opa(cursor, LV_OPA_COVER, LV_PART_MAIN | LV_STATE_DEFAULT);
    lv_obj_set_style_border_width(cursor, 0, LV_PART_MAIN | LV_STATE_DEFAULT);
    lv_obj_set_style_radius(cursor, 5, LV_PART_MAIN | LV_STATE_DEFAULT);
    lv_obj_set_style_pad_all(cursor, 0, LV_PART_MAIN | LV_STATE_DEFAULT);
    lv_obj_clear_flag(cursor, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_scrollbar_mode(cursor, LV_SCROLLBAR_MODE_OFF);
    set_hidden(cursor, true);
    return cursor;
}

static void nav_big_heading_digits_layout(nav_page_view_t *view, int w, int h) {
    const int iw0 = (int)ui_heading_digit_imgs[0].header.w;
    const int ih0 = (int)ui_heading_digit_imgs[0].header.h;
    const int gap = 6;
    const int margin_x = 20;
    int avail_w = w - margin_x * 2;
    if (avail_w < 40) {
        avail_w = w;
    }
    int avail_h = h - 2;
    if (avail_h < 24) {
        avail_h = h;
    }

    int64_t denom_w = (int64_t)iw0 * 3 + (int64_t)gap * 2;
    int64_t zw = ((int64_t)avail_w * (int64_t)UI_HEADING_IMG_ZOOM_1X + denom_w / 2) / denom_w;
    int64_t zh = ((int64_t)avail_h * (int64_t)UI_HEADING_IMG_ZOOM_1X + ih0 / 2) / (int64_t)ih0;
    uint32_t zoom = (uint32_t)(zw < zh ? zw : zh);
    if (zoom < 160U) {
        zoom = 160U;
    }
    if (zoom > 896U) {
        zoom = 896U;
    }

    for (uint8_t i = 0; i < 3; i++) {
        UI_HEADING_IMG_SET_SCALE(view->big_heading_imgs[i], zoom);
    }
    lv_obj_update_layout(view->big_heading_row);

    int sw = (iw0 * (int)zoom + UI_HEADING_IMG_ZOOM_1X / 2) / UI_HEADING_IMG_ZOOM_1X;
    int sh = (ih0 * (int)zoom + UI_HEADING_IMG_ZOOM_1X / 2) / UI_HEADING_IMG_ZOOM_1X;
    if (sw < 1) {
        sw = 1;
    }
    if (sh < 1) {
        sh = 1;
    }
    int total = sw * 3 + gap * 2;
    int start_x = (w - total) / 2;
    int start_y = (h - sh) / 2;
    if (start_y < 0) {
        start_y = 0;
    }
    
    /* Since pivot is (0,0), lv_obj_set_pos sets the top-left of the scaled image directly. */
    lv_obj_set_pos(view->big_heading_imgs[0], start_x, start_y);
    lv_obj_set_pos(view->big_heading_imgs[1], start_x + sw + gap, start_y);
    lv_obj_set_pos(view->big_heading_imgs[2], start_x + (sw + gap) * 2, start_y);
}

static void nav_big_heading_digits_create(nav_page_view_t *view) {
    view->big_heading_row = NULL;
    view->big_heading_imgs[0] = NULL;
    view->big_heading_imgs[1] = NULL;
    view->big_heading_imgs[2] = NULL;

    lv_obj_t *row = lv_obj_create(view->card);
    view->big_heading_row = row;
    lv_obj_set_style_bg_opa(row, LV_OPA_TRANSP, LV_PART_MAIN | LV_STATE_DEFAULT);
    lv_obj_set_style_border_width(row, 0, LV_PART_MAIN | LV_STATE_DEFAULT);
    lv_obj_set_style_pad_all(row, 0, LV_PART_MAIN | LV_STATE_DEFAULT);
    lv_obj_set_style_radius(row, 0, LV_PART_MAIN | LV_STATE_DEFAULT);
    lv_obj_clear_flag(row, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_scrollbar_mode(row, LV_SCROLLBAR_MODE_OFF);

    for (uint8_t i = 0; i < 3; i++) {
        lv_obj_t *img = UI_HEADING_IMG_CREATE(row);
        view->big_heading_imgs[i] = img;
        lv_obj_clear_flag(img, LV_OBJ_FLAG_SCROLLABLE);
        lv_obj_set_scrollbar_mode(img, LV_SCROLLBAR_MODE_OFF);
        UI_HEADING_IMG_SET_PIVOT(img, 0, 0);
        UI_HEADING_IMG_SET_SRC(img, &ui_heading_digit_imgs[0]);
        UI_HEADING_IMG_SET_SCALE(img, UI_HEADING_IMG_ZOOM_1X);
    }

    set_hidden(row, true);
}

static void nav_big_heading_hide(nav_page_view_t *view) {
    if (view->big_heading_row != NULL) {
        set_hidden(view->big_heading_row, true);
    }
}

static void nav_big_heading_show(nav_page_view_t *view, metric_view_t *metric, int x, int y, int w, int h) {
    if (view->big_heading_row == NULL) {
        return;
    }

    set_hidden(metric->value, true);
    set_hidden(view->big_heading_row, false);
    
    /* Set the row to cover the entire card area so the digits are perfectly centered in the card. */
    /* The "HEADING" label is at the top left, the digits will just overlap the empty space. */
    lv_obj_set_pos(view->big_heading_row, x, y);
    lv_obj_set_size(view->big_heading_row, w, h);
    lv_obj_update_layout(view->big_heading_row);
    nav_big_heading_digits_layout(view, w, h);
}

static void update_big_heading_digit_images(nav_page_view_t *view, const char *heading) {
    if (view->big_heading_row == NULL) {
        return;
    }

    if (heading == NULL || strcmp(heading, "---") == 0) {
        for (uint8_t i = 0; i < 3; i++) {
            UI_HEADING_IMG_SET_SRC(view->big_heading_imgs[i], &ui_heading_digit_imgs[10]);
        }
        lv_obj_update_layout(view->big_heading_row);
        nav_big_heading_digits_layout(view, (int)lv_obj_get_width(view->big_heading_row), (int)lv_obj_get_height(view->big_heading_row));
        return;
    }

    if (strlen(heading) < 3) {
        return;
    }

    for (uint8_t i = 0; i < 3; i++) {
        char c = heading[i];
        if (c >= '0' && c <= '9') {
            UI_HEADING_IMG_SET_SRC(view->big_heading_imgs[i], &ui_heading_digit_imgs[(uint8_t)(c - '0')]);
        } else {
            UI_HEADING_IMG_SET_SRC(view->big_heading_imgs[i], &ui_heading_digit_imgs[10]);
        }
    }
    lv_obj_update_layout(view->big_heading_row);
    lv_coord_t row_w = lv_obj_get_width(view->big_heading_row);
    lv_coord_t row_h = lv_obj_get_height(view->big_heading_row);
    nav_big_heading_digits_layout(view, (int)row_w, (int)row_h);
}

static void create_nav_page(lv_obj_t *screen, nav_page_view_t *view) {
    create_topbar(screen, &view->top);
    view->card = card_create(screen);
    view->rule_h = rule_create(view->card, 0, 0, 1, 1);
    view->rule_v = rule_create(view->card, 0, 0, 1, 1);
    for (uint8_t i = 0; i < UI_NAV_SLOT_COUNT; i++) {
        create_metric(&view->slots[i], view->card);
    }
    nav_big_heading_digits_create(view);
    view->footer = label_create(screen, "", UI_CARD_X, UI_FOOT_Y, UI_CARD_W, UI_FOOT_H, &ui_style_footer, LV_TEXT_ALIGN_CENTER);
}

static void create_start_page(lv_obj_t *screen, start_view_t *view) {
    create_topbar(screen, &view->top);
    view->card = card_create(screen);
    view->rule_h = rule_create(view->card, 0, 0, 1, 1);
    view->rule_v = rule_create(view->card, 0, 0, 1, 1);
    for (uint8_t i = 0; i < UI_START_SLOT_COUNT; i++) {
        create_metric(&view->slots[i], view->card);
    }
    view->footer = label_create(screen, "", UI_CARD_X, UI_FOOT_Y, UI_CARD_W, UI_FOOT_H, &ui_style_footer, LV_TEXT_ALIGN_CENTER);
}

static uint8_t layout_default_preset(uint8_t page) {
    return page == UI_LAYOUT_PAGE_START ? UI_START_LAYOUT_CLASSIC : UI_NAV_LAYOUT_CLASSIC;
}

static uint8_t layout_preset_count(uint8_t page) {
    return page == UI_LAYOUT_PAGE_START ? UI_START_LAYOUT_COUNT : UI_NAV_LAYOUT_COUNT;
}

static bool layout_page_enabled(uint8_t page) {
    if (s_page_mode == UI_PAGE_MODE_ALL) {
        return page < UI_LAYOUT_PAGE_COUNT;
    }
    return page == UI_LAYOUT_PAGE_COMPASS || page == UI_LAYOUT_PAGE_START;
}

static uint8_t layout_root_page_count(void) {
    return s_page_mode == UI_PAGE_MODE_ALL ? UI_LAYOUT_PAGE_COUNT : 2;
}

static uint8_t layout_root_page_at(uint8_t index) {
    if (s_page_mode == UI_PAGE_MODE_START_COMPASS) {
        return index == 0 ? UI_LAYOUT_PAGE_COMPASS : UI_LAYOUT_PAGE_START;
    }
    return index;
}

static uint8_t layout_root_index_for_page(uint8_t page) {
    if (!layout_page_enabled(page)) {
        return 0;
    }
    if (s_page_mode == UI_PAGE_MODE_START_COMPASS) {
        return page == UI_LAYOUT_PAGE_START ? 1 : 0;
    }
    return page;
}

static uint8_t layout_root_mode_index(void) {
    return layout_root_page_count();
}

static uint8_t layout_root_save_index(void) {
    return (uint8_t)(layout_root_mode_index() + 1);
}

static uint8_t layout_root_reset_page_index(void) {
    return (uint8_t)(layout_root_mode_index() + 2);
}

static uint8_t layout_root_reset_all_index(void) {
    return (uint8_t)(layout_root_mode_index() + 3);
}

static uint8_t layout_root_item_count(void) {
    return (uint8_t)(layout_root_page_count() + 4);
}

static uint8_t layout_visible_count(void) {
    return s_layout_editing ? layout_preset_count(s_layout_target_page) : layout_root_item_count();
}

static uint8_t normalize_layout_preset(uint8_t page, uint8_t preset) {
    uint8_t count = layout_preset_count(page);
    if (preset >= count) {
        return layout_default_preset(page);
    }
    return preset;
}

static const char *layout_page_name(uint8_t page) {
    switch (page) {
    case UI_LAYOUT_PAGE_COMPASS:
        return "Compass";
    case UI_LAYOUT_PAGE_START:
        return "Start";
    case UI_LAYOUT_PAGE_MARK:
        return "Mark";
    case UI_LAYOUT_PAGE_FINISH:
        return "Finish";
    default:
        return "Unknown";
    }
}

static const char *nav_preset_name(uint8_t preset) {
    switch (preset) {
    case UI_NAV_LAYOUT_CLASSIC:
        return "Classic";
    case UI_NAV_LAYOUT_BIG_HEADING:
        return "Big Heading";
    case UI_NAV_LAYOUT_TACTICAL_4:
        return "Tactical 4";
    default:
        return "Classic";
    }
}

static const char *start_preset_name(uint8_t preset) {
    switch (preset) {
    case UI_START_LAYOUT_CLASSIC:
        return "Classic";
    case UI_START_LAYOUT_PACE_FOCUS:
        return "Pace Focus";
    case UI_START_LAYOUT_LINE_FOCUS:
        return "Line Focus";
    case UI_START_LAYOUT_MATCH:
        return "Match";
    default:
        return "Classic";
    }
}

static const char *layout_preset_name(uint8_t page, uint8_t preset) {
    return page == UI_LAYOUT_PAGE_START ? start_preset_name(preset) : nav_preset_name(preset);
}

static const char *layout_root_item_name(uint8_t index) {
    uint8_t page_count = layout_root_page_count();
    if (index < page_count) {
        return layout_page_name(layout_root_page_at(index));
    }
    if (index == layout_root_mode_index()) {
        return s_page_mode == UI_PAGE_MODE_ALL ? "Page Mode: All" : "Page Mode: Start+Compass";
    }
    if (index == layout_root_save_index()) {
        return "Save to SD";
    }
    if (index == layout_root_reset_page_index()) {
        return "Reset Page";
    }
    if (index == layout_root_reset_all_index()) {
        return "Reset All";
    }
    return "";
}

static void apply_nav_layout(nav_page_view_t *view, uint8_t preset) {
    if (view->card == NULL) {
        return;
    }

    for (uint8_t i = 0; i < UI_NAV_SLOT_COUNT; i++) {
        metric_hide(&view->slots[i]);
    }

    nav_big_heading_hide(view);

    switch (preset) {
    case UI_NAV_LAYOUT_BIG_HEADING:
        rule_place(view->rule_h, false, 0, 0, 1, 1);
        rule_place(view->rule_v, false, 0, 0, 1, 1);
        metric_place(&view->slots[0], "HEADING", 0, 0, UI_CARD_W, UI_CARD_H, UI_VALUE_STYLE_XXL);
        nav_big_heading_show(view, &view->slots[0], 0, 0, UI_CARD_W, UI_CARD_H);
        break;
    case UI_NAV_LAYOUT_TACTICAL_4:
        rule_place(view->rule_h, true, UI_INNER_X, UI_MAIN_SPLIT_Y, UI_INNER_W, UI_RULE_W);
        rule_place(view->rule_v, true, UI_COL_SPLIT_X, 0, UI_RULE_W, UI_CARD_H);
        metric_place(&view->slots[0], "HEADING", 0, 0, UI_COL_SPLIT_X, UI_MAIN_SPLIT_Y, UI_VALUE_STYLE_MED);
        metric_place(&view->slots[1], "DRIFT", UI_RIGHT_CELL_X, 0, UI_RIGHT_CELL_W, UI_MAIN_SPLIT_Y, UI_VALUE_STYLE_MED);
        metric_place(&view->slots[2], "SOG", 0, UI_BOTTOM_Y, UI_COL_SPLIT_X, UI_BOTTOM_H, UI_VALUE_STYLE_MED);
        metric_place(&view->slots[3], "VMG", UI_RIGHT_CELL_X, UI_BOTTOM_Y, UI_RIGHT_CELL_W, UI_BOTTOM_H, UI_VALUE_STYLE_MED);
        break;
    case UI_NAV_LAYOUT_CLASSIC:
    default:
        rule_place(view->rule_h, true, UI_INNER_X, UI_MAIN_SPLIT_Y, UI_INNER_W, UI_RULE_W);
        rule_place(view->rule_v, true, UI_COL_SPLIT_X, UI_MAIN_SPLIT_Y, UI_RULE_W, UI_BOTTOM_H);
        metric_place(&view->slots[0], "HEADING", 0, 0, UI_CARD_W, UI_MAIN_SPLIT_Y, UI_VALUE_STYLE_XL);
        metric_place(&view->slots[1], "SOG", 0, UI_BOTTOM_Y, UI_COL_SPLIT_X, UI_BOTTOM_H, UI_VALUE_STYLE_LARGE);
        metric_place(&view->slots[2], "DRIFT", UI_RIGHT_CELL_X, UI_BOTTOM_Y, UI_RIGHT_CELL_W, UI_BOTTOM_H, UI_VALUE_STYLE_LARGE);
        break;
    }
}

static void apply_start_layout(uint8_t preset) {
    if (s_start.card == NULL) {
        return;
    }

    for (uint8_t i = 0; i < UI_START_SLOT_COUNT; i++) {
        metric_hide(&s_start.slots[i]);
    }

    switch (preset) {
    case UI_START_LAYOUT_MATCH:
        rule_place(s_start.rule_h, false, 0, 0, 1, 1);
        rule_place(s_start.rule_v, false, 0, 0, 1, 1);
        break;
    case UI_START_LAYOUT_PACE_FOCUS:
    case UI_START_LAYOUT_LINE_FOCUS:
        rule_place(s_start.rule_h, true, UI_INNER_X, UI_MAIN_SPLIT_Y, UI_INNER_W, UI_RULE_W);
        rule_place(s_start.rule_v, true, UI_COL_SPLIT_X, 0, UI_RULE_W, UI_MAIN_SPLIT_Y);
        metric_place(&s_start.slots[0], preset == UI_START_LAYOUT_PACE_FOCUS ? "BURN" : "LINE", 0, 0, UI_COL_SPLIT_X, UI_MAIN_SPLIT_Y, UI_VALUE_STYLE_MED);
        metric_place(&s_start.slots[1], "TTL", UI_RIGHT_CELL_X, 0, UI_RIGHT_CELL_W, UI_MAIN_SPLIT_Y, UI_VALUE_STYLE_MED);
        metric_place(&s_start.slots[2], "TIMER", 0, UI_BOTTOM_Y, UI_CARD_W, UI_BOTTOM_H, UI_VALUE_STYLE_XL);
        break;
    case UI_START_LAYOUT_CLASSIC:
    default:
        rule_place(s_start.rule_h, true, UI_INNER_X, UI_MAIN_SPLIT_Y, UI_INNER_W, UI_RULE_W);
        rule_place(s_start.rule_v, false, 0, 0, 1, 1);
        metric_place(&s_start.slots[0], "HEADING", 0, 0, UI_CARD_W, UI_MAIN_SPLIT_Y, UI_VALUE_STYLE_XL);
        metric_place(&s_start.slots[2], "TIMER", 0, UI_BOTTOM_Y, UI_CARD_W, UI_BOTTOM_H, UI_VALUE_STYLE_XL);
        break;
    }
}

static void apply_layout_for_page(uint8_t page) {
    uint8_t preset = normalize_layout_preset(page, s_layout_presets[page]);
    s_layout_presets[page] = preset;

    switch (page) {
    case UI_LAYOUT_PAGE_COMPASS:
        apply_nav_layout(&s_compass, preset);
        break;
    case UI_LAYOUT_PAGE_START:
        apply_start_layout(preset);
        break;
    case UI_LAYOUT_PAGE_MARK:
        apply_nav_layout(&s_mark, preset);
        break;
    case UI_LAYOUT_PAGE_FINISH:
        apply_nav_layout(&s_finish, preset);
        break;
    default:
        break;
    }
}

static void apply_all_layouts(void) {
    for (uint8_t i = 0; i < UI_LAYOUT_PAGE_COUNT; i++) {
        apply_layout_for_page(i);
    }
}

static void create_course_preview(lv_obj_t *panel) {
    label_create(panel, "Course", 8, 8, 120, 18, &ui_style_label, LV_TEXT_ALIGN_LEFT);
    rule_create(panel, 102, 46, 2, 96);
    rule_create(panel, 54, 116, 96, 2);
    label_create(panel, "WM", 84, 30, 42, 20, &ui_style_label, LV_TEXT_ALIGN_CENTER);
    label_create(panel, "START-FINISH", 34, 122, 136, 20, &ui_style_label, LV_TEXT_ALIGN_CENTER);
    label_create(panel, "Gate", 82, 178, 48, 20, &ui_style_label, LV_TEXT_ALIGN_CENTER);
}

void create_screen_compass() {
    lv_obj_t *screen = screen_create();
    objects.compass = screen;
    create_nav_page(screen, &s_compass);
}

void create_screen_start() {
    lv_obj_t *screen = screen_create();
    objects.start = screen;
    create_start_page(screen, &s_start);
}

void create_screen_mark() {
    lv_obj_t *screen = screen_create();
    objects.mark = screen;
    create_nav_page(screen, &s_mark);
}

void create_screen_finish() {
    lv_obj_t *screen = screen_create();
    objects.finish = screen;
    create_nav_page(screen, &s_finish);
}

void create_screen_settings() {
    lv_obj_t *screen = screen_create();
    objects.settings = screen;
    create_topbar(screen, &s_settings.top);
    lv_obj_t *left = panel_create(screen, 10, 36, 165, 220);
    lv_obj_t *right = panel_create(screen, 185, 36, 205, 220);
    const char *items[] = {
        "Race Mode: Fleet",
        "Start Config",
        "Course Template",
        "Page Layout",
        "Calibration",
        "Display",
        "System",
    };

    label_create(left, "Settings", 8, 8, 140, 22, &ui_style_label, LV_TEXT_ALIGN_LEFT);
    for (uint8_t i = 0; i < UI_SETTINGS_ITEM_COUNT; i++) {
        s_settings.items[i] = label_create(left, items[i], 8, 34 + 23 * i, 150, 21, &ui_style_label, LV_TEXT_ALIGN_LEFT);
    }
    s_settings.mode = label_create(left, "PG Back AC Enter +/-", 8, 194, 150, 18, &ui_style_topbar, LV_TEXT_ALIGN_LEFT);
    s_settings.diagram = right;
    create_course_preview(right);
    s_settings.footer = label_create(screen, "PG Back   AC Enter   +/- Move", UI_CARD_X, UI_FOOT_Y, UI_CARD_W, UI_FOOT_H, &ui_style_footer, LV_TEXT_ALIGN_CENTER);
}

void create_screen_layout() {
    lv_obj_t *screen = screen_create();
    objects.layout = screen;
    create_topbar(screen, &s_layout.top);
    lv_obj_t *left = panel_create(screen, 10, 36, 165, 220);
    lv_obj_t *right = panel_create(screen, 185, 36, 205, 220);

    s_layout.title = label_create(left, "Layout", 8, 8, 140, 22, &ui_style_label, LV_TEXT_ALIGN_LEFT);
    for (uint8_t i = 0; i < UI_LAYOUT_ITEM_COUNT; i++) {
        int y = 34 + 23 * i;
        s_layout.cursors[i] = cursor_create(left, 8, y + 6);
        s_layout.items[i] = label_create(left, "", 24, y, 132, 21, &ui_style_label, LV_TEXT_ALIGN_LEFT);
    }
    s_layout.preview_title = label_create(right, "Preview", 8, 8, 188, 22, &ui_style_label, LV_TEXT_ALIGN_LEFT);
    for (uint8_t i = 0; i < 5; i++) {
        s_layout.preview_lines[i] = label_create(right, "", 8, 38 + 24 * i, 188, 20, &ui_style_topbar, LV_TEXT_ALIGN_LEFT);
    }
    s_layout.preview_card = panel_create(right, UI_LAYOUT_PREVIEW_X, UI_LAYOUT_PREVIEW_Y, UI_LAYOUT_PREVIEW_W, UI_LAYOUT_PREVIEW_H);
    s_layout.preview_rule_h = rule_create(s_layout.preview_card, 0, 0, 1, 1);
    s_layout.preview_rule_v = rule_create(s_layout.preview_card, 0, 0, 1, 1);
    for (uint8_t i = 0; i < 4; i++) {
        s_layout.preview_slots[i] = label_create(s_layout.preview_card, "", 0, 0, 10, 10, &ui_style_topbar, LV_TEXT_ALIGN_CENTER);
    }
    set_hidden(s_layout.preview_card, true);
    s_layout.status = label_create(right, "", 8, 176, 188, 28, &ui_style_topbar, LV_TEXT_ALIGN_CENTER);
    s_layout.footer = label_create(screen, "AC Enter   PG Back   +/- Move", UI_CARD_X, UI_FOOT_Y, UI_CARD_W, UI_FOOT_H, &ui_style_footer, LV_TEXT_ALIGN_CENTER);
}

void create_screen_calibration() {
    lv_obj_t *screen = screen_create();
    objects.calibration = screen;
    create_topbar(screen, &s_calibration.top);
    lv_obj_t *left = panel_create(screen, 10, 36, 165, 220);
    lv_obj_t *right = panel_create(screen, 185, 36, 205, 220);
    const char *items[] = {
        "Set Pin",
        "Set Boat",
        "Set Finish Pin",
        "Set Finish Boat",
        "Set Windward Mark",
        "Set Offset Mark",
        "Set Leeward Mark",
        "Orbit Mark",
    };

    s_calibration.title = label_create(left, "Calibration", 8, 8, 140, 22, &ui_style_label, LV_TEXT_ALIGN_LEFT);
    for (uint8_t i = 0; i < UI_CALIBRATION_ITEM_COUNT; i++) {
        s_calibration.items[i] = label_create(left, items[i], 8, 34 + 22 * i, 150, 20, &ui_style_label, LV_TEXT_ALIGN_LEFT);
    }
    label_create(right, "Sampling", 8, 8, 120, 22, &ui_style_label, LV_TEXT_ALIGN_LEFT);
    label_create(right, "AC captures GNSS point", 8, 36, 188, 18, &ui_style_topbar, LV_TEXT_ALIGN_LEFT);
    rule_create(right, 102, 72, 2, 82);
    rule_create(right, 54, 116, 96, 2);
    label_create(right, "Pin", 34, 102, 48, 20, &ui_style_label, LV_TEXT_ALIGN_CENTER);
    label_create(right, "Boat", 126, 102, 54, 20, &ui_style_label, LV_TEXT_ALIGN_CENTER);
    s_calibration.status = label_create(right, "WAIT FIX / AC SET", 8, 176, 188, 32, &ui_style_body, LV_TEXT_ALIGN_CENTER);
    s_calibration.footer = label_create(screen, "PG Back   AC Set   +/- Move", UI_CARD_X, UI_FOOT_Y, UI_CARD_W, UI_FOOT_H, &ui_style_footer, LV_TEXT_ALIGN_CENTER);
}

static void format_line_with_unit(char *buf, size_t len, float line_m, bool valid) {
    char value[24];
    ui_format_line(value, sizeof(value), line_m, valid);
    if (!valid || !ui_value_valid(line_m)) {
        snprintf(buf, len, "%s", value);
    } else {
        snprintf(buf, len, "%sm", value);
    }
}

static void format_burn(char *buf, size_t len, int32_t sec) {
    if (sec >= 0) {
        snprintf(buf, len, "+%lds", (long)sec);
    } else {
        snprintf(buf, len, "-%lds", (long)-sec);
    }
}

static void build_nav_values(ui_layout_page_t page, char *heading, size_t heading_len, char *sog, size_t sog_len, char *drift, size_t drift_len, char *vmg, size_t vmg_len) {
    bool fix_ok = s_model.status.fix != FIX_NONE;
    float drift_deg = ui_wrap180(s_model.nav.cog_deg - s_model.nav.heading_deg);
    bool heading_valid = page == UI_LAYOUT_PAGE_COMPASS ? s_model.nav.heading_confidence > 0 : true;
    float vmg_value = page == UI_LAYOUT_PAGE_FINISH ? s_model.nav.vmg_finish_kn : s_model.nav.vmg_mark_kn;

    ui_format_heading(heading, heading_len, s_model.nav.heading_deg, heading_valid);
    ui_format_sog(sog, sog_len, s_model.nav.sog_kn, fix_ok);
    ui_format_drift(drift, drift_len, drift_deg, fix_ok && s_model.nav.sog_kn > 1.0f);
    ui_format_vmg(vmg, vmg_len, vmg_value, fix_ok);
}

static void update_nav_slot_values(nav_page_view_t *view, uint8_t preset, const char *heading, const char *sog, const char *drift, const char *vmg) {
    switch (preset) {
    case UI_NAV_LAYOUT_BIG_HEADING:
        set_text_if_changed(view->slots[0].value, heading);
        update_big_heading_digit_images(view, heading);
        break;
    case UI_NAV_LAYOUT_TACTICAL_4:
        set_text_if_changed(view->slots[0].value, heading);
        set_text_if_changed(view->slots[1].value, drift);
        set_text_if_changed(view->slots[2].value, sog);
        set_text_if_changed(view->slots[3].value, vmg);
        break;
    case UI_NAV_LAYOUT_CLASSIC:
    default:
        set_text_if_changed(view->slots[0].value, heading);
        set_text_if_changed(view->slots[1].value, sog);
        set_text_if_changed(view->slots[2].value, drift);
        break;
    }
}

static void update_compass_footer(uint8_t preset, const char *sog, const char *drift, const char *vmg) {
    char footer[96];
    bool fix_ok = s_model.status.fix != FIX_NONE;

    if (s_model.nav.mag_bad) {
        set_text_if_changed(s_compass.footer, "MAG BAD");
        set_inverse(s_compass.footer, true);
        return;
    }
    if (s_model.nav.heading_confidence < 60) {
        set_text_if_changed(s_compass.footer, "MAG LOW");
        set_inverse(s_compass.footer, false);
        return;
    }
    if (!fix_ok) {
        set_text_if_changed(s_compass.footer, "NOFIX");
        set_inverse(s_compass.footer, false);
        return;
    }
    if (preset == UI_NAV_LAYOUT_BIG_HEADING) {
        snprintf(footer, sizeof(footer), "SOG %s   DRIFT %s   VMG %s", sog, drift, vmg);
        set_text_if_changed(s_compass.footer, footer);
        set_inverse(s_compass.footer, false);
        return;
    }

    set_text_if_changed(s_compass.footer, "");
    set_inverse(s_compass.footer, false);
}

static void update_mark_footer(void) {
    char dtg[32];
    char brg[32];
    char eta[32];
    char footer[96];
    bool fix_ok = s_model.status.fix != FIX_NONE && s_model.course.target_configured;

    ui_format_dtg(dtg, sizeof(dtg), s_model.nav.dtg_m, fix_ok);
    ui_format_brg(brg, sizeof(brg), s_model.nav.brg_deg, fix_ok);
    ui_format_eta(eta, sizeof(eta), s_model.nav.eta_sec, fix_ok);
    if (s_model.course.approach_lock) {
        snprintf(footer, sizeof(footer), "APPROACH LOCK");
    } else if (s_model.course.rounding_side == ROUND_PORT) {
        snprintf(footer, sizeof(footer), "KEEP MARK TO PORT");
    } else if (s_model.course.rounding_side == ROUND_STARBOARD) {
        snprintf(footer, sizeof(footer), "KEEP MARK TO STBD");
    } else {
        snprintf(footer, sizeof(footer), "DTG %s   BRG %s deg   ETA %s", dtg, brg, eta);
    }
    set_text_if_changed(s_mark.footer, footer);
    set_inverse(s_mark.footer, false);
}

static void update_finish_footer(void) {
    char dtg[32];
    char ttl[32];
    char angle[32];
    char footer[96];
    bool fix_ok = s_model.status.fix != FIX_NONE;

    ui_format_dtg(dtg, sizeof(dtg), s_model.nav.dtg_m, fix_ok);
    ui_format_ttl(ttl, sizeof(ttl), s_model.nav.ttl_sec, fix_ok);
    ui_format_angle(angle, sizeof(angle), s_model.nav.angle_error_deg, fix_ok);
    snprintf(footer, sizeof(footer), "DTG %s   TTL %s   ANG %s deg", dtg, ttl, angle);
    set_text_if_changed(s_finish.footer, footer);
    set_inverse(s_finish.footer, s_model.nav.finish_line_dist_m > 0.0f);
}

static void update_nav_page(nav_page_view_t *view, ui_layout_page_t page) {
    char heading[32];
    char sog[32];
    char drift[32];
    char vmg[32];
    uint8_t preset = s_layout_presets[page];

    update_topbar(&view->top, &s_model.status);
    build_nav_values(page, heading, sizeof(heading), sog, sizeof(sog), drift, sizeof(drift), vmg, sizeof(vmg));
    update_nav_slot_values(view, preset, heading, sog, drift, vmg);

    if (page == UI_LAYOUT_PAGE_COMPASS) {
        update_compass_footer(preset, sog, drift, vmg);
    } else if (page == UI_LAYOUT_PAGE_MARK) {
        update_mark_footer();
    } else if (page == UI_LAYOUT_PAGE_FINISH) {
        update_finish_footer();
    }
}

static void update_start_footer(uint8_t preset, const char *heading, const char *sog, const char *line, const char *ttl, const char *burn) {
    char footer[96];
    if (preset == UI_START_LAYOUT_MATCH) {
        set_text_if_changed(s_start.footer, "MATCH LAYOUT RESERVED");
        set_inverse(s_start.footer, false);
        return;
    }
    if (s_model.start.ocs_risk) {
        set_text_if_changed(s_start.footer, "!! OCS RISK !!");
        set_inverse(s_start.footer, true);
        return;
    }

    switch (preset) {
    case UI_START_LAYOUT_PACE_FOCUS:
        snprintf(footer, sizeof(footer), "HDG %s   SOG %s   LINE %s", heading, sog, line);
        break;
    case UI_START_LAYOUT_LINE_FOCUS:
        snprintf(footer, sizeof(footer), "HDG %s   SOG %s   BURN %s", heading, sog, burn);
        break;
    case UI_START_LAYOUT_CLASSIC:
    default:
        snprintf(footer, sizeof(footer), "SOG %s   LINE %s   BURN %s   TTL %s", sog, line, burn, ttl);
        break;
    }
    set_text_if_changed(s_start.footer, footer);
    set_inverse(s_start.footer, false);
}

static void update_start(void) {
    char heading[32];
    char timer[32];
    char sog[32];
    char line[32];
    char ttl[32];
    char burn[32];
    bool fix_ok = s_model.status.fix != FIX_NONE;
    bool active = s_model.start.timer_running || s_model.start.active_scene != SCENE_START_WAIT;
    uint8_t preset = s_layout_presets[UI_LAYOUT_PAGE_START];

    update_topbar(&s_start.top, &s_model.status);
    ui_format_heading(heading, sizeof(heading), s_model.nav.heading_deg, s_model.nav.heading_confidence > 0);
    ui_format_sog(sog, sizeof(sog), s_model.nav.sog_kn, fix_ok);
    format_line_with_unit(line, sizeof(line), s_model.nav.line_dist_m, fix_ok);
    ui_format_ttl(ttl, sizeof(ttl), s_model.nav.ttl_sec, fix_ok && s_model.nav.sog_kn > 1.0f);
    format_burn(burn, sizeof(burn), s_model.start.burn_sec);
    if (active) {
        ui_format_countdown(timer, sizeof(timer), s_model.start.countdown_sec);
    } else {
        ui_format_ready(timer, sizeof(timer), s_model.start.preset_start_sec);
    }

    if (preset == UI_START_LAYOUT_MATCH) {
        update_start_footer(preset, heading, sog, line, ttl, burn);
        return;
    }

    if (preset == UI_START_LAYOUT_CLASSIC) {
        set_text_if_changed(s_start.slots[0].title, "HEADING");
        set_text_if_changed(s_start.slots[0].value, heading);
        set_text_if_changed(s_start.slots[2].title, active ? "TIMER" : "READY");
        set_text_if_changed(s_start.slots[2].value, timer);
    } else {
        if (preset == UI_START_LAYOUT_PACE_FOCUS) {
            if (s_model.start.ocs_risk) {
                set_text_if_changed(s_start.slots[0].title, "WARNING");
                set_text_if_changed(s_start.slots[0].value, "OCS");
                set_inverse(s_start.slots[0].value, true);
            } else {
                set_text_if_changed(s_start.slots[0].title, s_model.start.burn_sec >= 0 ? "BURN" : "LATE");
                set_text_if_changed(s_start.slots[0].value, burn);
                set_inverse(s_start.slots[0].value, s_model.start.burn_sec < 0);
            }
        } else {
            set_text_if_changed(s_start.slots[0].title, "LINE");
            set_text_if_changed(s_start.slots[0].value, line);
            set_inverse(s_start.slots[0].value, fix_ok && ui_value_valid(s_model.nav.line_dist_m) && s_model.nav.line_dist_m > 0.0f);
        }

        set_text_if_changed(s_start.slots[1].title, "TTL");
        set_text_if_changed(s_start.slots[1].value, ttl);
        set_inverse(s_start.slots[1].value, false);
        set_text_if_changed(s_start.slots[2].title, active ? "TIMER" : "READY");
        set_text_if_changed(s_start.slots[2].value, timer);
    }

    update_start_footer(preset, heading, sog, line, ttl, burn);
}

static void update_compass(void) {
    update_nav_page(&s_compass, UI_LAYOUT_PAGE_COMPASS);
}

static void update_mark(void) {
    update_nav_page(&s_mark, UI_LAYOUT_PAGE_MARK);
}

static void update_finish(void) {
    update_nav_page(&s_finish, UI_LAYOUT_PAGE_FINISH);
}

static void update_menu_item(lv_obj_t *obj, const char *text, bool selected) {
    char buf[64];
    snprintf(buf, sizeof(buf), "%c %s", selected ? '>' : ' ', text);
    set_text_if_changed(obj, buf);
    if (selected) {
        lv_obj_add_style(obj, &ui_style_selected, LV_PART_MAIN | LV_STATE_DEFAULT);
    } else {
        lv_obj_remove_style(obj, &ui_style_selected, LV_PART_MAIN | LV_STATE_DEFAULT);
    }
}

static void update_layout_row(uint8_t row, const char *text, bool visible, bool selected, bool current) {
    if (row >= UI_LAYOUT_ITEM_COUNT) {
        return;
    }
    set_hidden(s_layout.items[row], !visible);
    set_hidden(s_layout.cursors[row], !visible || !selected);
    if (!visible) {
        return;
    }

    set_text_if_changed(s_layout.items[row], text);
    if (current) {
        lv_obj_add_style(s_layout.items[row], &ui_style_selected, LV_PART_MAIN | LV_STATE_DEFAULT);
    } else {
        lv_obj_remove_style(s_layout.items[row], &ui_style_selected, LV_PART_MAIN | LV_STATE_DEFAULT);
    }
}

static void update_settings(void) {
    const char *items[] = {
        s_model.start.race_mode == RACE_MATCH ? "Race Mode: Match" : "Race Mode: Fleet",
        "Start Config",
        "Course Template",
        "Page Layout",
        "Calibration",
        s_model.display.night_mode ? "Display: Night" : "Display: Day",
        "System",
    };
    update_topbar(&s_settings.top, &s_model.status);
    for (uint8_t i = 0; i < UI_SETTINGS_ITEM_COUNT; i++) {
        update_menu_item(s_settings.items[i], items[i], i == s_settings_selection);
    }
}

static void update_layout_preview_lines(const char *lines[5], uint8_t visible_count) {
    for (uint8_t i = 0; i < 5; i++) {
        bool visible = i < visible_count;
        set_hidden(s_layout.preview_lines[i], !visible);
        if (visible) {
            set_text_if_changed(s_layout.preview_lines[i], lines[i]);
        }
    }
}

static void layout_preview_slot(uint8_t index, const char *text, int x, int y, int w, int h) {
    if (index >= 4) {
        return;
    }
    set_hidden(s_layout.preview_slots[index], false);
    set_text_if_changed(s_layout.preview_slots[index], text);
    lv_obj_set_pos(s_layout.preview_slots[index], x, y);
    lv_obj_set_size(s_layout.preview_slots[index], w, h);
    lv_obj_set_style_text_align(s_layout.preview_slots[index], LV_TEXT_ALIGN_CENTER, LV_PART_MAIN | LV_STATE_DEFAULT);
}

static void layout_preview_clear_card(void) {
    rule_place(s_layout.preview_rule_h, false, 0, 0, 1, 1);
    rule_place(s_layout.preview_rule_v, false, 0, 0, 1, 1);
    for (uint8_t i = 0; i < 4; i++) {
        set_hidden(s_layout.preview_slots[i], true);
    }
}

static void update_layout_preview_card(uint8_t page, uint8_t preset) {
    const int w = UI_LAYOUT_PREVIEW_W;
    const int h = UI_LAYOUT_PREVIEW_H;
    const int rule = UI_LAYOUT_PREVIEW_RULE_W;
    const int split_y = h / 2 - rule / 2;
    const int bottom_y = split_y + rule;
    const int bottom_h = h - bottom_y;
    const int split_x = w / 2 - rule / 2;
    const int right_x = split_x + rule;
    const int right_w = w - right_x;

    set_hidden(s_layout.preview_card, false);
    layout_preview_clear_card();

    if (page == UI_LAYOUT_PAGE_START) {
        switch (preset) {
        case UI_START_LAYOUT_PACE_FOCUS:
            rule_place(s_layout.preview_rule_h, true, 6, split_y, w - 12, rule);
            rule_place(s_layout.preview_rule_v, true, split_x, 0, rule, split_y);
            layout_preview_slot(0, "BURN", 0, 18, split_x, 24);
            layout_preview_slot(1, "TTL", right_x, 18, right_w, 24);
            layout_preview_slot(2, "TIMER", 0, bottom_y + 20, w, 28);
            break;
        case UI_START_LAYOUT_LINE_FOCUS:
            rule_place(s_layout.preview_rule_h, true, 6, split_y, w - 12, rule);
            rule_place(s_layout.preview_rule_v, true, split_x, 0, rule, split_y);
            layout_preview_slot(0, "LINE", 0, 18, split_x, 24);
            layout_preview_slot(1, "TTL", right_x, 18, right_w, 24);
            layout_preview_slot(2, "TIMER", 0, bottom_y + 20, w, 28);
            break;
        case UI_START_LAYOUT_MATCH:
            break;
        case UI_START_LAYOUT_CLASSIC:
        default:
            rule_place(s_layout.preview_rule_h, true, 6, split_y, w - 12, rule);
            layout_preview_slot(0, "HEADING", 0, 18, w, 24);
            layout_preview_slot(1, "TIMER", 0, bottom_y + 20, w, 28);
            break;
        }
    } else {
        switch (preset) {
        case UI_NAV_LAYOUT_BIG_HEADING:
            layout_preview_slot(0, "HEADING", 0, 42, w, 28);
            break;
        case UI_NAV_LAYOUT_TACTICAL_4:
            rule_place(s_layout.preview_rule_h, true, 6, split_y, w - 12, rule);
            rule_place(s_layout.preview_rule_v, true, split_x, 0, rule, h);
            layout_preview_slot(0, "HEADING", 0, 18, split_x, 24);
            layout_preview_slot(1, "DRIFT", right_x, 18, right_w, 24);
            layout_preview_slot(2, "SOG", 0, bottom_y + 20, split_x, 24);
            layout_preview_slot(3, "VMG", right_x, bottom_y + 20, right_w, 24);
            break;
        case UI_NAV_LAYOUT_CLASSIC:
        default:
            rule_place(s_layout.preview_rule_h, true, 6, split_y, w - 12, rule);
            rule_place(s_layout.preview_rule_v, true, split_x, bottom_y, rule, bottom_h);
            layout_preview_slot(0, "HEADING", 0, 18, w, 24);
            layout_preview_slot(1, "SOG", 0, bottom_y + 20, split_x, 24);
            layout_preview_slot(2, "DRIFT", right_x, bottom_y + 20, right_w, 24);
            break;
        }
    }
}

static void update_layout_preview(uint8_t page, uint8_t preset) {
    const char *lines[5] = {"Footer:", "", "", "", ""};
    set_hidden(s_layout.status, true);
    if (page == UI_LAYOUT_PAGE_START) {
        switch (preset) {
        case UI_START_LAYOUT_PACE_FOCUS:
            lines[1] = "HDG / SOG / Line";
            break;
        case UI_START_LAYOUT_LINE_FOCUS:
            lines[1] = "HDG / SOG / Burn";
            break;
        case UI_START_LAYOUT_MATCH:
            lines[1] = "Reserved";
            break;
        case UI_START_LAYOUT_CLASSIC:
        default:
            lines[1] = "SOG / Line / Burn / TTL";
            break;
        }
    } else {
        switch (preset) {
        case UI_NAV_LAYOUT_BIG_HEADING:
            if (page == UI_LAYOUT_PAGE_COMPASS) {
                lines[1] = "SOG / Drift / VMG";
            } else if (page == UI_LAYOUT_PAGE_MARK) {
                lines[1] = "DTG / BRG / ETA";
            } else {
                lines[1] = "DTG / TTL / ANG";
            }
            break;
        case UI_NAV_LAYOUT_TACTICAL_4:
            if (page == UI_LAYOUT_PAGE_COMPASS) {
                lines[1] = "Status alerts";
            } else if (page == UI_LAYOUT_PAGE_MARK) {
                lines[1] = "DTG / BRG / ETA";
            } else {
                lines[1] = "DTG / TTL / ANG";
            }
            break;
        case UI_NAV_LAYOUT_CLASSIC:
        default:
            if (page == UI_LAYOUT_PAGE_COMPASS) {
                lines[1] = "Status alerts";
            } else if (page == UI_LAYOUT_PAGE_MARK) {
                lines[1] = "DTG / BRG / ETA";
            } else {
                lines[1] = "DTG / TTL / ANG";
            }
            break;
        }
    }

    update_layout_preview_lines(lines, 2);
    update_layout_preview_card(page, preset);
}

static void update_layout_action_preview(uint8_t action) {
    char target[64];
    const char *lines[5] = {"", "", "", "", ""};
    set_hidden(s_layout.preview_card, true);
    set_hidden(s_layout.status, false);
    if (action == layout_root_mode_index()) {
        lines[0] = s_page_mode == UI_PAGE_MODE_ALL ? "Current: All pages" : "Current: Start+Compass";
        lines[1] = s_page_mode == UI_PAGE_MODE_ALL ? "AC switches to 2 pages" : "AC switches to 4 pages";
        lines[2] = "Affects PG page cycle";
    } else if (action == layout_root_save_index()) {
        lines[0] = "Write config to SD";
        lines[1] = "Keeps presets after reboot";
        lines[2] = "Uses platform save hook";
    } else if (action == layout_root_reset_page_index()) {
        snprintf(target, sizeof(target), "Target: %s", layout_page_name(s_layout_target_page));
        lines[0] = target;
        lines[1] = "Restore firmware default";
        lines[2] = "Does not save automatically";
    } else if (action == layout_root_reset_all_index()) {
        lines[0] = "Reset every page preset";
        lines[1] = "Compass/Start/Mark/Finish";
        lines[2] = "Does not save automatically";
    }
    update_layout_preview_lines(lines, 5);
}

static void update_layout(void) {
    char title[64];

    update_topbar(&s_layout.top, &s_model.status);

    if (s_layout_editing) {
        uint8_t count = layout_preset_count(s_layout_target_page);
        uint8_t current = normalize_layout_preset(s_layout_target_page, s_layout_presets[s_layout_target_page]);
        uint8_t preview = normalize_layout_preset(s_layout_target_page, s_layout_selection);

        set_text_if_changed(s_layout.title, layout_page_name(s_layout_target_page));
        for (uint8_t i = 0; i < UI_LAYOUT_ITEM_COUNT; i++) {
            bool visible = i < count;
            update_layout_row(i, visible ? layout_preset_name(s_layout_target_page, i) : "", visible, i == s_layout_selection, i == current);
        }

        snprintf(title, sizeof(title), "%s / %s", layout_page_name(s_layout_target_page), layout_preset_name(s_layout_target_page, preview));
        set_text_if_changed(s_layout.preview_title, title);
        update_layout_preview(s_layout_target_page, preview);
        set_text_if_changed(s_layout.footer, "AC Apply   PG Pages   +/- Move");
    } else {
        uint8_t page_count = layout_root_page_count();
        set_text_if_changed(s_layout.title, "Layout");
        for (uint8_t i = 0; i < UI_LAYOUT_ITEM_COUNT; i++) {
            bool visible = i < layout_root_item_count();
            update_layout_row(i, visible ? layout_root_item_name(i) : "", visible, i == s_layout_selection, false);
        }

        if (s_layout_selection < page_count) {
            uint8_t page = layout_root_page_at(s_layout_selection);
            uint8_t preset = normalize_layout_preset(page, s_layout_presets[page]);
            snprintf(title, sizeof(title), "%s / %s", layout_page_name(page), layout_preset_name(page, preset));
            set_text_if_changed(s_layout.preview_title, title);
            update_layout_preview(page, preset);
        } else {
            set_text_if_changed(s_layout.preview_title, layout_root_item_name(s_layout_selection));
            update_layout_action_preview(s_layout_selection);
        }
        set_text_if_changed(s_layout.footer, "AC Enter   PG Back   +/- Move");
    }

    set_text_if_changed(s_layout.status, s_layout_status);
}

static void update_calibration(void) {
    const char *items[] = {
        "Set Pin",
        "Set Boat",
        "Set Finish Pin",
        "Set Finish Boat",
        "Set Windward Mark",
        "Set Offset Mark",
        "Set Leeward Mark",
        "Orbit Mark",
    };
    update_topbar(&s_calibration.top, &s_model.status);
    for (uint8_t i = 0; i < UI_CALIBRATION_ITEM_COUNT; i++) {
        update_menu_item(s_calibration.items[i], items[i], i == s_calibration_selection);
    }
    set_text_if_changed(s_calibration.status, s_model.status.fix == FIX_NONE ? "NOFIX - WAIT" : "FIX READY / AC SET");
}

void tick_screen_compass() { update_compass(); }
void tick_screen_start() { update_start(); }
void tick_screen_mark() { update_mark(); }
void tick_screen_finish() { update_finish(); }
void tick_screen_settings() { update_settings(); }
void tick_screen_layout() { update_layout(); }
void tick_screen_calibration() { update_calibration(); }

typedef void (*tick_screen_func_t)();
static tick_screen_func_t tick_screen_funcs[] = {
    tick_screen_compass,
    tick_screen_start,
    tick_screen_mark,
    tick_screen_finish,
    tick_screen_settings,
    tick_screen_layout,
    tick_screen_calibration,
};

void tick_screen(int screen_index) {
    if (screen_index >= 0 && screen_index < (int)(sizeof(tick_screen_funcs) / sizeof(tick_screen_funcs[0]))) {
        tick_screen_funcs[screen_index]();
    }
}

void tick_screen_by_id(enum ScreensEnum screenId) {
    tick_screen((int)screenId - 1);
}

void screens_set_page(ui_page_t page) {
    if (!screens_main_page_enabled(page)) {
        page = UI_PAGE_COMPASS;
    }
    s_page = page;
    switch (page) {
    case UI_PAGE_COMPASS:
        UI_SCREEN_LOAD(objects.compass);
        break;
    case UI_PAGE_START:
        UI_SCREEN_LOAD(objects.start);
        break;
    case UI_PAGE_MARK:
        UI_SCREEN_LOAD(objects.mark);
        break;
    case UI_PAGE_FINISH:
        UI_SCREEN_LOAD(objects.finish);
        break;
    case UI_PAGE_SETTINGS:
        UI_SCREEN_LOAD(objects.settings);
        break;
    case UI_PAGE_LAYOUT:
        UI_SCREEN_LOAD(objects.layout);
        break;
    case UI_PAGE_CALIBRATION:
        UI_SCREEN_LOAD(objects.calibration);
        break;
    default:
        UI_SCREEN_LOAD(objects.compass);
        s_page = UI_PAGE_COMPASS;
        break;
    }
    tick_screen((int)s_page);
}

ui_page_t screens_get_page(void) {
    return s_page;
}

void screens_set_settings_selection(uint8_t index) {
    s_settings_selection = index % UI_SETTINGS_ITEM_COUNT;
    update_settings();
}

void screens_set_layout_selection(uint8_t index) {
    uint8_t count = layout_visible_count();
    s_layout_selection = count == 0 ? 0 : (uint8_t)(index % count);
    if (!s_layout_editing && s_layout_selection < layout_root_page_count()) {
        s_layout_target_page = layout_root_page_at(s_layout_selection);
    }
    update_layout();
}

void screens_set_layout_editing(bool editing) {
    s_layout_editing = editing;
    if (s_layout_target_page >= UI_LAYOUT_PAGE_COUNT || !layout_page_enabled(s_layout_target_page)) {
        s_layout_target_page = UI_LAYOUT_PAGE_COMPASS;
    }
    if (s_layout_editing) {
        s_layout_selection = normalize_layout_preset(s_layout_target_page, s_layout_presets[s_layout_target_page]);
    } else {
        s_layout_selection = layout_root_index_for_page(s_layout_target_page);
    }
    update_layout();
}

uint8_t screens_layout_get_selection(void) {
    return s_layout_selection;
}

uint8_t screens_layout_get_visible_count(void) {
    return layout_visible_count();
}

bool screens_layout_selected_is_page(void) {
    return !s_layout_editing && s_layout_selection < layout_root_page_count();
}

bool screens_layout_selected_is_mode(void) {
    return !s_layout_editing && s_layout_selection == layout_root_mode_index();
}

bool screens_layout_selected_is_save(void) {
    return !s_layout_editing && s_layout_selection == layout_root_save_index();
}

bool screens_layout_selected_is_reset_page(void) {
    return !s_layout_editing && s_layout_selection == layout_root_reset_page_index();
}

bool screens_layout_selected_is_reset_all(void) {
    return !s_layout_editing && s_layout_selection == layout_root_reset_all_index();
}

void screens_layout_toggle_page_mode(void) {
    s_page_mode = s_page_mode == UI_PAGE_MODE_ALL ? UI_PAGE_MODE_START_COMPASS : UI_PAGE_MODE_ALL;
    if (!layout_page_enabled(s_layout_target_page)) {
        s_layout_target_page = UI_LAYOUT_PAGE_COMPASS;
    }
    if (!s_layout_editing) {
        s_layout_selection = layout_root_mode_index();
    }
    snprintf(s_layout_status, sizeof(s_layout_status), "%s", s_page_mode == UI_PAGE_MODE_ALL ? "All pages" : "Start+Compass");
    update_layout();
}

void screens_layout_apply_selected_preset(void) {
    if (!s_layout_editing) {
        return;
    }
    uint8_t preset = normalize_layout_preset(s_layout_target_page, s_layout_selection);
    s_layout_presets[s_layout_target_page] = preset;
    s_layout_selection = preset;
    apply_layout_for_page(s_layout_target_page);
    snprintf(s_layout_status, sizeof(s_layout_status), "Applied");
    screens_update(&s_model);
}

void screens_layout_reset_current(void) {
    uint8_t preset = layout_default_preset(s_layout_target_page);
    s_layout_presets[s_layout_target_page] = preset;
    if (s_layout_editing) {
        s_layout_selection = preset;
    }
    apply_layout_for_page(s_layout_target_page);
    snprintf(s_layout_status, sizeof(s_layout_status), "Page reset");
    screens_update(&s_model);
}

void screens_layout_reset_defaults(void) {
    s_page_mode = UI_PAGE_MODE_ALL;
    s_layout_target_page = UI_LAYOUT_PAGE_COMPASS;
    for (uint8_t i = 0; i < UI_LAYOUT_PAGE_COUNT; i++) {
        s_layout_presets[i] = layout_default_preset(i);
    }
    if (s_layout_editing) {
        s_layout_selection = normalize_layout_preset(s_layout_target_page, s_layout_presets[s_layout_target_page]);
    } else {
        s_layout_selection = layout_root_reset_all_index();
    }
    apply_all_layouts();
    snprintf(s_layout_status, sizeof(s_layout_status), "Defaults");
    screens_update(&s_model);
}

void screens_set_layout_status(const char *status) {
    snprintf(s_layout_status, sizeof(s_layout_status), "%s", status == NULL ? "" : status);
    update_layout();
}

void screens_get_layout_config(ui_layout_config_t *config) {
    if (config == NULL) {
        return;
    }
    memset(config, 0, sizeof(*config));
    config->page_mode = (uint8_t)s_page_mode;
    for (uint8_t i = 0; i < UI_LAYOUT_PAGE_COUNT; i++) {
        config->page_preset[i] = s_layout_presets[i];
    }
}

bool screens_layout_config_in_range(const ui_layout_config_t *config) {
    if (config == NULL) {
        return false;
    }
    if (config->page_mode >= UI_PAGE_MODE_COUNT) {
        return false;
    }
    for (uint8_t i = 0; i < UI_LAYOUT_PAGE_COUNT; i++) {
        if (config->page_preset[i] >= layout_preset_count(i)) {
            return false;
        }
    }
    return true;
}

bool screens_apply_layout_config(const ui_layout_config_t *config) {
    if (!screens_layout_config_in_range(config)) {
        return false;
    }
    s_page_mode = (ui_page_mode_t)config->page_mode;
    for (uint8_t i = 0; i < UI_LAYOUT_PAGE_COUNT; i++) {
        s_layout_presets[i] = config->page_preset[i];
    }
    if (!layout_page_enabled(s_layout_target_page)) {
        s_layout_target_page = UI_LAYOUT_PAGE_COMPASS;
    }
    if (s_layout_editing) {
        s_layout_selection = normalize_layout_preset(s_layout_target_page, s_layout_presets[s_layout_target_page]);
    } else if (s_layout_selection >= layout_root_item_count()) {
        s_layout_selection = 0;
    }
    apply_all_layouts();
    snprintf(s_layout_status, sizeof(s_layout_status), "Loaded");
    screens_update(&s_model);
    return true;
}

ui_page_mode_t screens_get_page_mode(void) {
    return s_page_mode;
}

bool screens_main_page_enabled(ui_page_t page) {
    if (page == UI_PAGE_MARK || page == UI_PAGE_FINISH) {
        return s_page_mode == UI_PAGE_MODE_ALL;
    }
    return true;
}

void screens_set_calibration_selection(uint8_t index) {
    s_calibration_selection = index % UI_CALIBRATION_ITEM_COUNT;
    update_calibration();
}

void screens_update(const ui_model_t *model) {
    if (model != NULL) {
        s_model = *model;
        ui_style_apply_profile(s_model.display.night_mode);
    }
    update_compass();
    update_start();
    update_mark();
    update_finish();
    update_settings();
    update_layout();
    update_calibration();
}

void create_screens() {
    UI_DISPLAY_T *dispp = UI_DISPLAY_GET_DEFAULT();
    lv_theme_t *theme = lv_theme_default_init(dispp, UI_COLOR_TEXT, UI_COLOR_LINE, false, LV_FONT_DEFAULT);
    UI_DISPLAY_SET_THEME(dispp, theme);
    ui_styles_init();

    create_screen_compass();
    create_screen_start();
    create_screen_mark();
    create_screen_finish();
    create_screen_settings();
    create_screen_layout();
    create_screen_calibration();
    apply_all_layouts();
}
