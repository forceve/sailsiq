#ifndef EEZ_LVGL_UI_SCREENS_H
#define EEZ_LVGL_UI_SCREENS_H

#include <lvgl/lvgl.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct _objects_t {
    lv_obj_t *compass;
    lv_obj_t *head;
    lv_obj_t *fix;
    lv_obj_t *sat;
    lv_obj_t *rec;
    lv_obj_t *time;
    lv_obj_t *bat;
    lv_obj_t *body;
    lv_obj_t *linex;
    lv_obj_t *lineyu;
    lv_obj_t *liney;
    lv_obj_t *lineyd;
    lv_obj_t *heading;
    lv_obj_t *degreemark;
    lv_obj_t *sog;
    lv_obj_t *degreemark_1;
    lv_obj_t *drift;
} objects_t;

extern objects_t objects;

enum ScreensEnum {
    SCREEN_ID_COMPASS = 1,
};

void create_screen_compass();
void tick_screen_compass();

void tick_screen_by_id(enum ScreensEnum screenId);
void tick_screen(int screen_index);

void create_screens();


#ifdef __cplusplus
}
#endif

#endif /*EEZ_LVGL_UI_SCREENS_H*/