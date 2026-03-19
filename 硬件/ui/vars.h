#ifndef EEZ_LVGL_UI_VARS_H
#define EEZ_LVGL_UI_VARS_H

#include <stdint.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

// enum declarations



// Flow global variables

enum FlowGlobalVariables {
    FLOW_GLOBAL_VARIABLE_PRINT_FIX = 0,
    FLOW_GLOBAL_VARIABLE_PRINT_SAT = 1,
    FLOW_GLOBAL_VARIABLE_PRINT_REC = 2,
    FLOW_GLOBAL_VARIABLE_PRINT_TIME = 3,
    FLOW_GLOBAL_VARIABLE_PRINT_BAT = 4,
    FLOW_GLOBAL_VARIABLE_PRINT_HEAD = 5,
    FLOW_GLOBAL_VARIABLE_PRINT_SOG = 6,
    FLOW_GLOBAL_VARIABLE_PRINT_DRIFT = 7
};

// Native global variables

extern const char *get_var_print_fix();
extern void set_var_print_fix(const char *value);
extern const char *get_var_print_sat();
extern void set_var_print_sat(const char *value);
extern const char *get_var_print_rec();
extern void set_var_print_rec(const char *value);
extern const char *get_var_print_time();
extern void set_var_print_time(const char *value);
extern const char *get_var_print_bat();
extern void set_var_print_bat(const char *value);
extern const char *get_var_print_head();
extern void set_var_print_head(const char *value);
extern const char *get_var_print_sog();
extern void set_var_print_sog(const char *value);
extern const char *get_var_print_drift();
extern void set_var_print_drift(const char *value);


#ifdef __cplusplus
}
#endif

#endif /*EEZ_LVGL_UI_VARS_H*/