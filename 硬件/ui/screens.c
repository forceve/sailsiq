#include <string.h>

#include "screens.h"
#include "images.h"
#include "fonts.h"
#include "actions.h"
#include "vars.h"
#include "styles.h"
#include "ui.h"

#include <string.h>

objects_t objects;
lv_obj_t *tick_value_change_obj;
uint32_t active_theme_index = 0;

void create_screen_compass() {
    lv_obj_t *obj = lv_obj_create(0);
    objects.compass = obj;
    lv_obj_set_pos(obj, 0, 0);
    lv_obj_set_size(obj, 400, 300);
    lv_obj_set_style_text_color(obj, lv_color_hex(0xff000000), LV_PART_MAIN | LV_STATE_DEFAULT);
    {
        lv_obj_t *parent_obj = obj;
        {
            // head
            lv_obj_t *obj = lv_obj_create(parent_obj);
            objects.head = obj;
            lv_obj_set_pos(obj, 10, 10);
            lv_obj_set_size(obj, 380, 20);
            lv_obj_set_style_pad_left(obj, 0, LV_PART_MAIN | LV_STATE_DEFAULT);
            lv_obj_set_style_pad_top(obj, 0, LV_PART_MAIN | LV_STATE_DEFAULT);
            lv_obj_set_style_pad_right(obj, 0, LV_PART_MAIN | LV_STATE_DEFAULT);
            lv_obj_set_style_pad_bottom(obj, 0, LV_PART_MAIN | LV_STATE_DEFAULT);
            lv_obj_set_style_bg_opa(obj, 0, LV_PART_MAIN | LV_STATE_DEFAULT);
            lv_obj_set_style_border_width(obj, 0, LV_PART_MAIN | LV_STATE_DEFAULT);
            lv_obj_set_style_radius(obj, 0, LV_PART_MAIN | LV_STATE_DEFAULT);
            {
                lv_obj_t *parent_obj = obj;
                {
                    // fix
                    lv_obj_t *obj = lv_label_create(parent_obj);
                    objects.fix = obj;
                    lv_obj_set_pos(obj, 10, 1);
                    lv_obj_set_size(obj, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
                    lv_label_set_text(obj, "");
                }
                {
                    // sat
                    lv_obj_t *obj = lv_label_create(parent_obj);
                    objects.sat = obj;
                    lv_obj_set_pos(obj, 70, 0);
                    lv_obj_set_size(obj, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
                    lv_label_set_text(obj, "");
                }
                {
                    // rec
                    lv_obj_t *obj = lv_label_create(parent_obj);
                    objects.rec = obj;
                    lv_obj_set_pos(obj, 140, 0);
                    lv_obj_set_size(obj, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
                    lv_label_set_text(obj, "");
                }
                {
                    // time
                    lv_obj_t *obj = lv_label_create(parent_obj);
                    objects.time = obj;
                    lv_obj_set_pos(obj, 200, 0);
                    lv_obj_set_size(obj, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
                    lv_label_set_text(obj, "");
                }
                {
                    // bat
                    lv_obj_t *obj = lv_label_create(parent_obj);
                    objects.bat = obj;
                    lv_obj_set_pos(obj, 345, 0);
                    lv_obj_set_size(obj, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
                    lv_label_set_text(obj, "");
                }
            }
        }
        {
            // body
            lv_obj_t *obj = lv_obj_create(parent_obj);
            objects.body = obj;
            lv_obj_set_pos(obj, 10, 30);
            lv_obj_set_size(obj, 380, 240);
            lv_obj_set_style_pad_left(obj, 0, LV_PART_MAIN | LV_STATE_DEFAULT);
            lv_obj_set_style_pad_top(obj, 0, LV_PART_MAIN | LV_STATE_DEFAULT);
            lv_obj_set_style_pad_right(obj, 0, LV_PART_MAIN | LV_STATE_DEFAULT);
            lv_obj_set_style_pad_bottom(obj, 0, LV_PART_MAIN | LV_STATE_DEFAULT);
            lv_obj_set_style_bg_opa(obj, 0, LV_PART_MAIN | LV_STATE_DEFAULT);
            lv_obj_set_style_border_width(obj, 0, LV_PART_MAIN | LV_STATE_DEFAULT);
            lv_obj_set_style_radius(obj, 0, LV_PART_MAIN | LV_STATE_DEFAULT);
            {
                lv_obj_t *parent_obj = obj;
                {
                    // linex
                    lv_obj_t *obj = lv_line_create(parent_obj);
                    objects.linex = obj;
                    lv_obj_set_pos(obj, 0, 120);
                    lv_obj_set_size(obj, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
                    static lv_point_precise_t line_points[] = {
                        { 0, 0 },
                        { 380, 0 }
                    };
                    lv_line_set_points(obj, line_points, 2);
                }
                {
                    // lineyu
                    lv_obj_t *obj = lv_line_create(parent_obj);
                    objects.lineyu = obj;
                    lv_obj_set_pos(obj, 0, 0);
                    lv_obj_set_size(obj, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
                    static lv_point_precise_t line_points[] = {
                        { 0, 0 },
                        { 380, 0 }
                    };
                    lv_line_set_points(obj, line_points, 2);
                }
                {
                    // liney
                    lv_obj_t *obj = lv_line_create(parent_obj);
                    objects.liney = obj;
                    lv_obj_set_pos(obj, 190, 120);
                    lv_obj_set_size(obj, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
                    static lv_point_precise_t line_points[] = {
                        { 0, 0 },
                        { 0, 120 }
                    };
                    lv_line_set_points(obj, line_points, 2);
                }
                {
                    // lineyd
                    lv_obj_t *obj = lv_line_create(parent_obj);
                    objects.lineyd = obj;
                    lv_obj_set_pos(obj, 0, 239);
                    lv_obj_set_size(obj, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
                    static lv_point_precise_t line_points[] = {
                        { 0, 0 },
                        { 380, 0 }
                    };
                    lv_line_set_points(obj, line_points, 2);
                }
                {
                    // heading
                    lv_obj_t *obj = lv_label_create(parent_obj);
                    objects.heading = obj;
                    lv_obj_set_pos(obj, 146, 40);
                    lv_obj_set_size(obj, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
                    lv_obj_set_style_text_font(obj, &lv_font_montserrat_48, LV_PART_MAIN | LV_STATE_DEFAULT);
                    lv_label_set_text(obj, "");
                }
                {
                    // degreemark
                    lv_obj_t *obj = lv_label_create(parent_obj);
                    objects.degreemark = obj;
                    lv_obj_set_pos(obj, 246, 32);
                    lv_obj_set_size(obj, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
                    lv_label_set_text(obj, "o");
                }
                {
                    lv_obj_t *obj = lv_label_create(parent_obj);
                    lv_obj_set_pos(obj, 10, 10);
                    lv_obj_set_size(obj, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
                    lv_label_set_text(obj, "HEADING:");
                }
                {
                    // sog
                    lv_obj_t *obj = lv_label_create(parent_obj);
                    objects.sog = obj;
                    lv_obj_set_pos(obj, 52, 160);
                    lv_obj_set_size(obj, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
                    lv_obj_set_style_text_font(obj, &lv_font_montserrat_36, LV_PART_MAIN | LV_STATE_DEFAULT);
                    lv_label_set_text(obj, "");
                }
                {
                    lv_obj_t *obj = lv_label_create(parent_obj);
                    lv_obj_set_pos(obj, 10, 130);
                    lv_obj_set_size(obj, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
                    lv_label_set_text(obj, "SOG:");
                }
                {
                    // degreemark_1
                    lv_obj_t *obj = lv_label_create(parent_obj);
                    objects.degreemark_1 = obj;
                    lv_obj_set_pos(obj, 336, 152);
                    lv_obj_set_size(obj, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
                    lv_label_set_text(obj, "o");
                }
                {
                    // drift
                    lv_obj_t *obj = lv_label_create(parent_obj);
                    objects.drift = obj;
                    lv_obj_set_pos(obj, 246, 160);
                    lv_obj_set_size(obj, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
                    lv_obj_set_style_text_font(obj, &lv_font_montserrat_36, LV_PART_MAIN | LV_STATE_DEFAULT);
                    lv_label_set_text(obj, "");
                }
                {
                    lv_obj_t *obj = lv_label_create(parent_obj);
                    lv_obj_set_pos(obj, 200, 130);
                    lv_obj_set_size(obj, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
                    lv_label_set_text(obj, "DRIFT:");
                }
            }
        }
    }
    
    tick_screen_compass();
}

void tick_screen_compass() {
    {
        const char *new_val = get_var_print_fix();
        const char *cur_val = lv_label_get_text(objects.fix);
        if (strcmp(new_val, cur_val) != 0) {
            tick_value_change_obj = objects.fix;
            lv_label_set_text(objects.fix, new_val);
            tick_value_change_obj = NULL;
        }
    }
    {
        const char *new_val = get_var_print_fix();
        const char *cur_val = lv_label_get_text(objects.sat);
        if (strcmp(new_val, cur_val) != 0) {
            tick_value_change_obj = objects.sat;
            lv_label_set_text(objects.sat, new_val);
            tick_value_change_obj = NULL;
        }
    }
    {
        const char *new_val = get_var_print_rec();
        const char *cur_val = lv_label_get_text(objects.rec);
        if (strcmp(new_val, cur_val) != 0) {
            tick_value_change_obj = objects.rec;
            lv_label_set_text(objects.rec, new_val);
            tick_value_change_obj = NULL;
        }
    }
    {
        const char *new_val = get_var_print_time();
        const char *cur_val = lv_label_get_text(objects.time);
        if (strcmp(new_val, cur_val) != 0) {
            tick_value_change_obj = objects.time;
            lv_label_set_text(objects.time, new_val);
            tick_value_change_obj = NULL;
        }
    }
    {
        const char *new_val = get_var_print_bat();
        const char *cur_val = lv_label_get_text(objects.bat);
        if (strcmp(new_val, cur_val) != 0) {
            tick_value_change_obj = objects.bat;
            lv_label_set_text(objects.bat, new_val);
            tick_value_change_obj = NULL;
        }
    }
    {
        const char *new_val = get_var_print_head();
        const char *cur_val = lv_label_get_text(objects.heading);
        if (strcmp(new_val, cur_val) != 0) {
            tick_value_change_obj = objects.heading;
            lv_label_set_text(objects.heading, new_val);
            tick_value_change_obj = NULL;
        }
    }
    {
        const char *new_val = get_var_print_sog();
        const char *cur_val = lv_label_get_text(objects.sog);
        if (strcmp(new_val, cur_val) != 0) {
            tick_value_change_obj = objects.sog;
            lv_label_set_text(objects.sog, new_val);
            tick_value_change_obj = NULL;
        }
    }
    {
        const char *new_val = get_var_print_drift();
        const char *cur_val = lv_label_get_text(objects.drift);
        if (strcmp(new_val, cur_val) != 0) {
            tick_value_change_obj = objects.drift;
            lv_label_set_text(objects.drift, new_val);
            tick_value_change_obj = NULL;
        }
    }
}



typedef void (*tick_screen_func_t)();
tick_screen_func_t tick_screen_funcs[] = {
    tick_screen_compass,
};
void tick_screen(int screen_index) {
    tick_screen_funcs[screen_index]();
}
void tick_screen_by_id(enum ScreensEnum screenId) {
    tick_screen_funcs[screenId - 1]();
}

void create_screens() {
    lv_disp_t *dispp = lv_disp_get_default();
    lv_theme_t *theme = lv_theme_default_init(dispp, lv_palette_main(LV_PALETTE_BLUE), lv_palette_main(LV_PALETTE_RED), false, LV_FONT_DEFAULT);
    lv_disp_set_theme(dispp, theme);
    
    create_screen_compass();
}
