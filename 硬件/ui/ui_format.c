#include "ui_format.h"

#include <math.h>
#include <stdio.h>

bool ui_value_valid(float value) {
    return isfinite(value);
}

static int ui_round_to_int(float value) {
    return (int)(value >= 0.0f ? value + 0.5f : value - 0.5f);
}

float ui_wrap180(float deg) {
    while (deg > 180.0f) {
        deg -= 360.0f;
    }
    while (deg <= -180.0f) {
        deg += 360.0f;
    }
    return deg;
}

void ui_format_heading(char *buf, size_t len, float deg, bool valid) {
    if (!valid || !ui_value_valid(deg)) {
        snprintf(buf, len, "---");
        return;
    }

    int heading = ui_round_to_int(deg);
    heading %= 360;
    if (heading < 0) {
        heading += 360;
    }
    snprintf(buf, len, "%03d", heading);
}

void ui_format_sog(char *buf, size_t len, float sog_kn, bool valid) {
    if (!valid || !ui_value_valid(sog_kn)) {
        snprintf(buf, len, "--");
        return;
    }
    snprintf(buf, len, "%.1f", sog_kn);
}

void ui_format_drift(char *buf, size_t len, float drift_deg, bool valid) {
    if (!valid || !ui_value_valid(drift_deg)) {
        snprintf(buf, len, "--");
        return;
    }
    snprintf(buf, len, "%+d", ui_round_to_int(ui_wrap180(drift_deg)));
}

void ui_format_vmg(char *buf, size_t len, float vmg_kn, bool valid) {
    if (!valid || !ui_value_valid(vmg_kn)) {
        snprintf(buf, len, "--");
        return;
    }
    snprintf(buf, len, "%.1f", vmg_kn);
}

void ui_format_dtg(char *buf, size_t len, float dtg_m, bool valid) {
    if (!valid || !ui_value_valid(dtg_m)) {
        snprintf(buf, len, "--");
        return;
    }

    if (dtg_m < 185.2f) {
        snprintf(buf, len, "%d m", ui_round_to_int(dtg_m));
    } else {
        snprintf(buf, len, "%.2f nm", dtg_m / 1852.0f);
    }
}

void ui_format_brg(char *buf, size_t len, float brg_deg, bool valid) {
    if (!valid || !ui_value_valid(brg_deg)) {
        snprintf(buf, len, "--");
        return;
    }

    int brg = ui_round_to_int(brg_deg);
    brg %= 360;
    if (brg < 0) {
        brg += 360;
    }
    snprintf(buf, len, "%d", brg);
}

void ui_format_eta(char *buf, size_t len, int32_t sec, bool valid) {
    if (!valid || sec < 0) {
        snprintf(buf, len, "--:--");
        return;
    }

    snprintf(buf, len, "%ld:%02ld", (long)(sec / 60), (long)(sec % 60));
}

void ui_format_ttl(char *buf, size_t len, int32_t sec, bool valid) {
    if (!valid || sec < 0) {
        snprintf(buf, len, "--");
        return;
    }

    if (sec < 60) {
        snprintf(buf, len, "%lds", (long)sec);
    } else {
        snprintf(buf, len, "%ld:%02ld", (long)(sec / 60), (long)(sec % 60));
    }
}

void ui_format_line(char *buf, size_t len, float line_m, bool valid) {
    if (!valid || !ui_value_valid(line_m)) {
        snprintf(buf, len, "--");
        return;
    }
    snprintf(buf, len, "%d", ui_round_to_int(line_m));
}

void ui_format_angle(char *buf, size_t len, float angle_deg, bool valid) {
    if (!valid || !ui_value_valid(angle_deg)) {
        snprintf(buf, len, "--");
        return;
    }
    snprintf(buf, len, "%+d", ui_round_to_int(angle_deg));
}

void ui_format_clock(char *buf, size_t len, uint8_t hour, uint8_t minute) {
    snprintf(buf, len, "%02u:%02u", (unsigned)(hour % 24), (unsigned)(minute % 60));
}

void ui_format_countdown(char *buf, size_t len, int32_t sec) {
    if (sec < 0) {
        sec = 0;
    }
    snprintf(buf, len, "%02ld:%02ld", (long)(sec / 60), (long)(sec % 60));
}

void ui_format_ready(char *buf, size_t len, int32_t preset_sec) {
    if (preset_sec < 0) {
        preset_sec = 0;
    }
    snprintf(buf, len, "%ld:%02ld", (long)(preset_sec / 60), (long)(preset_sec % 60));
}
