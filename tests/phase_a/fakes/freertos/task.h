#pragma once
#include "FreeRTOS.h"
enum { eSetValueWithOverwrite };
TaskHandle_t xTaskGetCurrentTaskHandle(void);
TaskHandle_t xTaskCreateStatic(void (*)(void*),const char*,unsigned,void*,unsigned,StackType_t*,StaticTask_t*);
unsigned uxTaskGetStackHighWaterMark(TaskHandle_t);
void vTaskDelay(TickType_t);
TickType_t xTaskGetTickCount(void);
int xTaskNotifyWaitIndexed(unsigned,uint32_t,uint32_t,uint32_t*,TickType_t);
int xTaskNotifyIndexed(TaskHandle_t,unsigned,uint32_t,int);
int xTaskNotifyGiveIndexed(TaskHandle_t,unsigned);
uint32_t ulTaskNotifyTakeIndexed(unsigned,int,TickType_t);
TaskHandle_t xTaskCreateStatic(void (*)(void*),const char*,unsigned,void*,unsigned,StackType_t*,StaticTask_t*);
unsigned uxTaskGetStackHighWaterMark(TaskHandle_t);
void vTaskDelay(TickType_t);
