#pragma once
#include "FreeRTOS.h"
QueueHandle_t xQueueCreateStatic(unsigned,unsigned,uint8_t*,StaticQueue_t*);
int xQueueSend(QueueHandle_t,const void*,TickType_t);
int xQueueReceive(QueueHandle_t,void*,TickType_t);
int xQueuePeek(QueueHandle_t,void*,TickType_t);
int xQueueReset(QueueHandle_t);
int xQueueOverwrite(QueueHandle_t,const void*);
unsigned uxQueueMessagesWaiting(QueueHandle_t);
unsigned uxQueueSpacesAvailable(QueueHandle_t);
