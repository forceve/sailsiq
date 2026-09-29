#pragma once
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include <stdint.h>

/* One synchronous RPC per caller. Index zero belongs to control wakeups.
 * Once enqueued, cancellation is deferred until the owner completes: stack
 * outputs remain alive. There is intentionally no timeout/early-return path. */
#define SB_CONTROL_WAKE_INDEX 0u
#define SB_RPC_COMPLETION_INDEX 1u
#if configTASK_NOTIFICATION_ARRAY_ENTRIES < 2
#error "Sailball requires separate RPC completion and control wake notifications"
#endif
static inline uint32_t sb_rpc_wait_completion(void)
{
    uint32_t result;
    while (xTaskNotifyWaitIndexed(SB_RPC_COMPLETION_INDEX, 0, UINT32_MAX,
                                  &result, portMAX_DELAY) != pdTRUE) { }
    return result;
}
static inline void sb_rpc_complete(TaskHandle_t waiter, uint32_t result)
{
    if (waiter != NULL)
        (void)xTaskNotifyIndexed(waiter, SB_RPC_COMPLETION_INDEX, result, eSetValueWithOverwrite);
}
