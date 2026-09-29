#pragma once
#include "esp_err.h"
esp_err_t esp_task_wdt_add(void *task_handle);
esp_err_t esp_task_wdt_reset(void);
