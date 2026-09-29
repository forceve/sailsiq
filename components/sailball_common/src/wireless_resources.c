#include "sailball/wireless_admission.h"
#include "esp_heap_caps.h"
#include "esp_idf_version.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "sdkconfig.h"

/* Reviewed against IDF 6.1, ESP32-C3 ABI. Re-budget an SDK/target change;
 * never silently apply these allowances to an unreviewed configuration. */
#if !CONFIG_IDF_TARGET_ESP32C3 || ESP_IDF_VERSION_MAJOR != 6 || ESP_IDF_VERSION_MINOR != 1
#error "Wireless resource policy requires review for this SDK/target"
#endif
#if CONFIG_BT_NIMBLE_MAX_CONNECTIONS != 1 || !CONFIG_BT_NIMBLE_MEM_ALLOC_MODE_INTERNAL
#error "Wireless resource policy requires one internal-memory NimBLE connection"
#endif
#if defined(CONFIG_BT_NIMBLE_EXT_ADV) || defined(CONFIG_BT_NIMBLE_ISO) || defined(CONFIG_BT_NIMBLE_MESH)
#error "Re-budget additional NimBLE radio features before enabling them"
#endif
#if defined(CONFIG_BT_NIMBLE_ROLE_CENTRAL) || defined(CONFIG_BT_NIMBLE_ROLE_OBSERVER) || \
    !CONFIG_BT_NIMBLE_USE_ESP_TIMER || !CONFIG_BT_NIMBLE_STATIC_TO_DYNAMIC
#error "Re-budget changed NimBLE roles or allocation strategy"
#endif
#if CONFIG_BT_NIMBLE_MSYS_1_BLOCK_COUNT != 8 || CONFIG_BT_NIMBLE_MSYS_2_BLOCK_COUNT != 12 || \
    CONFIG_BT_NIMBLE_MSYS_1_BLOCK_SIZE != 256 || CONFIG_BT_NIMBLE_MSYS_2_BLOCK_SIZE != 320 || \
    CONFIG_BT_NIMBLE_TRANSPORT_ACL_FROM_LL_COUNT != 8 || CONFIG_BT_NIMBLE_TRANSPORT_ACL_SIZE != 255 || \
    CONFIG_BT_NIMBLE_TRANSPORT_EVT_COUNT != 16 || CONFIG_BT_NIMBLE_TRANSPORT_EVT_DISCARD_COUNT != 4 || \
    CONFIG_BT_NIMBLE_TRANSPORT_EVT_SIZE != 70 || CONFIG_BT_NIMBLE_HOST_TASK_STACK_SIZE != 4096
#error "Re-budget changed reviewed BLE pool/stack capacities"
#endif
#if CONFIG_ESP_WIFI_TX_BUFFER_TYPE != 1 || CONFIG_ESP_WIFI_STATIC_RX_BUFFER_NUM != 4 || \
    CONFIG_ESP_WIFI_DYNAMIC_RX_BUFFER_NUM != 4 || CONFIG_ESP_WIFI_DYNAMIC_TX_BUFFER_NUM != 4 || \
    CONFIG_ESP_WIFI_RX_MGMT_BUF_NUM_DEF != 2 || CONFIG_ESP_WIFI_RX_BA_WIN != 4 || \
    CONFIG_ESP_WIFI_SOFTAP_SUPPORT || CONFIG_LWIP_IPV6 || \
    CONFIG_LWIP_TCP_SND_BUF_DEFAULT != 2880 || CONFIG_LWIP_TCP_WND_DEFAULT != 2880
#error "Re-budget changed Wi-Fi allocation type or reviewed buffer capacities"
#endif
#if CONFIG_BT_NIMBLE_TRANSPORT_EVT_COUNT > 30 || CONFIG_BT_NIMBLE_TRANSPORT_EVT_DISCARD_COUNT > 8 || \
    CONFIG_BT_NIMBLE_ATT_MAX_PREP_ENTRIES > 64 || CONFIG_BT_NIMBLE_GATT_MAX_PROCS > 4 || \
    CONFIG_BT_NIMBLE_MAX_BONDS > 3 || CONFIG_BT_NIMBLE_WHITELIST_SIZE > 12 || \
    CONFIG_BT_CTRL_BLE_MAX_ACT > 6
#error "Re-budget increased NPL/host/controller capacity"
#endif
_Static_assert(sizeof(StaticTask_t) <= 128, "Re-budget task control block");
_Static_assert(sizeof(StaticQueue_t) <= 128, "Re-budget queue control block");

#include "sailball/wireless_budget_model.h"
static const sb_wireless_budget_t s_ble_budget = SB_BLE_BUDGET_INIT;
static const sb_wireless_budget_t s_wifi_budget = SB_WIFI_COLD_BUDGET_INIT;
static const sb_wireless_budget_t s_wifi_start_budget = SB_WIFI_RF_BUDGET_INIT;

sb_wireless_heap_t sb_wireless_measure_heap(void)
{
    const uint32_t internal = MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT;
    /* RTC fast heap is INTERNAL/8BIT but cannot supply DMA radio/SD memory.
     * C3's internal DMA heap is a conservative subset usable by the radio
     * allocations. Budgets are checked separately, never added across these
     * overlapping capability sets. */
    const uint32_t dma = internal | MALLOC_CAP_DMA;
    return (sb_wireless_heap_t){
        .free_internal = heap_caps_get_free_size(internal),
        .minimum_internal = heap_caps_get_minimum_free_size(internal),
        .largest_internal = heap_caps_get_largest_free_block(internal),
        .free_dma = heap_caps_get_free_size(dma),
        .minimum_dma = heap_caps_get_minimum_free_size(dma),
        .largest_dma = heap_caps_get_largest_free_block(dma),
    };
}

sb_wireless_admission_t sb_wireless_admit(sb_wireless_kind_t kind)
{
    sb_wireless_admission_t report;
    sb_wireless_heap_t heap = sb_wireless_measure_heap();
    const sb_wireless_budget_t *budget = kind == SB_WIRELESS_BLE ? &s_ble_budget :
        kind == SB_WIRELESS_WIFI ? &s_wifi_budget :
        kind == SB_WIRELESS_WIFI_START ? &s_wifi_start_budget : NULL;
    (void)sb_wireless_admission_decide(&heap, budget, &report);
    return report;
}
