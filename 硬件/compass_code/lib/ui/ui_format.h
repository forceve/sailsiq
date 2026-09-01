#ifndef SAILSIQ_UI_FORMAT_H
#define SAILSIQ_UI_FORMAT_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

void ui_format_heading(char *buf, size_t len, float deg, bool valid);
void ui_format_sog(char *buf, size_t len, float sog_kn, bool valid);
void ui_format_drift(char *buf, size_t len, float drift_deg, bool valid);
void ui_format_vmg(char *buf, size_t len, float vmg_kn, bool valid);
void ui_format_dtg(char *buf, size_t len, float dtg_m, bool valid);
void ui_format_brg(char *buf, size_t len, float brg_deg, bool valid);
void ui_format_eta(char *buf, size_t len, int32_t sec, bool valid);
void ui_format_ttl(char *buf, size_t len, int32_t sec, bool valid);
void ui_format_line(char *buf, size_t len, float line_m, bool valid);
void ui_format_angle(char *buf, size_t len, float angle_deg, bool valid);
void ui_format_clock(char *buf, size_t len, uint8_t hour, uint8_t minute);
void ui_format_countdown(char *buf, size_t len, int32_t sec);
void ui_format_ready(char *buf, size_t len, int32_t preset_sec);

bool ui_value_valid(float val);

float ui_wrap180(float deg);

#ifdef __cplusplus
}
#endif

#endif /* SAILSIQ_UI_FORMAT_H */
