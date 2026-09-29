idf_component_register(SRCS "src/common.c" "src/wireless_admission.c" "src/wireless_resources.c"
    INCLUDE_DIRS "include" REQUIRES esp_timer esp_system heap freertos)
