#pragma once
#include <stdint.h>
#include <stddef.h>
#define configTASK_NOTIFICATION_ARRAY_ENTRIES 2
#define pdTRUE 1
#define pdFALSE 0
#define pdPASS 1
#define portMAX_DELAY UINT32_MAX
#define pdMS_TO_TICKS(x) (x)
#ifndef portTICK_PERIOD_MS
#define portTICK_PERIOD_MS 10u
#endif
typedef unsigned TickType_t;
typedef unsigned char StackType_t;
typedef struct { int unused; } StaticTask_t;
typedef struct { int unused; } StaticQueue_t;
typedef struct fake_task { uint32_t value[2]; int pending[2]; } *TaskHandle_t;
typedef void *QueueHandle_t;
