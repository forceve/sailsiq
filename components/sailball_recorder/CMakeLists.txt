idf_component_register(SRCS "src/recorder.c" "src/time_grid.c" INCLUDE_DIRS "include" REQUIRES sailball_common sailball_gnss sailball_storage sailball_ldc sailball_diagnostics freertos esp_system)
