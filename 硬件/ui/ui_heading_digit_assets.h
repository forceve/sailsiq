#ifndef UI_HEADING_DIGIT_ASSETS_H
#define UI_HEADING_DIGIT_ASSETS_H

#include <lvgl/lvgl.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Indices 0-9 = '0'..'9', [10] = dash (invalid / placeholder). LVGL 9: lv_image_dsc_t. */
extern const lv_image_dsc_t ui_heading_digit_imgs[11];

#ifdef __cplusplus
}
#endif

#endif
