#pragma once
/* Internal C3/IDF 6.1 allocation model. See h10-wireless-resource-budget.md.
 * Includes future capacity envelopes; excludes already linked pools/stacks,
 * IDF tasks already running and existing global netif/event infrastructure.
 * This is NOT a measured bound on private SDK allocations. */
#include "sailball/wireless_admission.h"
#define SB_MAX(a,b) ((a) > (b) ? (a) : (b))
#define SB_ALIGN4(n) (((n) + 3u) & ~3u)
#define SB_NPL_EVENTS (36u + CONFIG_BT_NIMBLE_TRANSPORT_EVT_COUNT + CONFIG_BT_NIMBLE_TRANSPORT_EVT_DISCARD_COUNT)
/* Context = 156 + embedded events. No second event backing allocation.
 * All ten kernel queues, twenty sem/mutexes and forty esp_timer handles:
 * capacity envelope, even though current init uses fewer. ABI probes gate it. */
#define SB_NPL_BYTES (4972u + 52u * SB_NPL_EVENTS)
#define SB_MSYS_BYTES (88u + CONFIG_BT_NIMBLE_MSYS_1_BLOCK_COUNT * SB_ALIGN4(CONFIG_BT_NIMBLE_MSYS_1_BLOCK_SIZE) + CONFIG_BT_NIMBLE_MSYS_2_BLOCK_COUNT * SB_ALIGN4(CONFIG_BT_NIMBLE_MSYS_2_BLOCK_SIZE))
#define SB_HCI_BYTES (156u + 260u + (CONFIG_BT_NIMBLE_TRANSPORT_EVT_COUNT + CONFIG_BT_NIMBLE_TRANSPORT_EVT_DISCARD_COUNT) * SB_ALIGN4(CONFIG_BT_NIMBLE_TRANSPORT_EVT_SIZE) + CONFIG_BT_NIMBLE_TRANSPORT_ACL_FROM_LL_COUNT * SB_ALIGN4(CONFIG_BT_NIMBLE_TRANSPORT_ACL_SIZE + 45u))
/* Controller table allocations observed in current ELF: 280/976/2532,
 * OSI 252. Controller stack 4096 + TCB 112. Remaining private allowance
 * retains the previous 24 KiB total controller estimate, rather than
 * reducing it to manufacture reachability. */
#define SB_CONTROLLER_TABLES 4040u
#define SB_CONTROLLER_TASK 4208u
#define SB_CONTROLLER_OPAQUE (24576u - SB_CONTROLLER_TABLES - SB_CONTROLLER_TASK)
/* SD 512 B sectors: VFS+six FIL/flags+seven caches 6028; LFN 512;
 * SD/SPI objects/descriptors/workspace allowance 4096; residual 1652.
 * Static LDC pool/snapshot/app stacks are excluded. This is a policy
 * estimate, not a proof of arbitrary card/driver allocation maxima. */
#define SB_CRITICAL_INTERNAL 12288u
#define SB_CRITICAL_DMA 4096u
#define SB_MARGIN_INTERNAL 4096u /* allocator headers + concurrent internal work */
#define SB_MARGIN_DMA 2048u     /* subset, not additional internal bytes */
#define SB_FRAGMENT 1024u      /* allowance above largest payload, not total peak */
/* esp_task.h adds libc stack overhead to these SDK tasks. Keep the host
 * model usable without SDK headers and verify it with compiled SDK probes. */
#ifdef CONFIG_LIBC_NEWLIB_NANO_FORMAT
#define SB_IDF_EXTRA_STACK 0u
#else
#define SB_IDF_EXTRA_STACK 512u
#endif
#ifdef CONFIG_LWIP_TCPIP_CORE_LOCKING
#define SB_EVENT_LOCK_STACK 2048u
#else
#define SB_EVENT_LOCK_STACK 0u
#endif
#define SB_TCPIP_STACK (CONFIG_LWIP_TCPIP_TASK_STACK_SIZE + SB_IDF_EXTRA_STACK)
#define SB_EVENT_STACK (CONFIG_ESP_SYSTEM_EVENT_TASK_STACK_SIZE + SB_IDF_EXTRA_STACK + SB_EVENT_LOCK_STACK)
/* Probed host contexts/pools 3200 + <=40 attributes 800 + three services
 * 24 + two CCCDs 8 + registration/name temporary envelope 128 = 4160.
 * Round this host envelope to 256-byte units; do not round down to 4 KiB. */
#define SB_HOST_BYTES 4352u
#define SB_BLE_BUDGET_INIT { \
    .future_internal = SB_NPL_BYTES + SB_MSYS_BYTES + SB_HCI_BYTES + SB_HOST_BYTES + CONFIG_BT_NIMBLE_HOST_TASK_STACK_SIZE + 112u + SB_CONTROLLER_TABLES + SB_CONTROLLER_TASK, \
    .future_dma = SB_CONTROLLER_TABLES, \
    .opaque_internal = SB_CONTROLLER_OPAQUE, .opaque_dma = SB_CONTROLLER_OPAQUE, \
    .critical_internal = SB_CRITICAL_INTERNAL, .critical_dma = SB_CRITICAL_DMA, \
    .margin_internal = SB_MARGIN_INTERNAL, .margin_dma = SB_MARGIN_DMA, \
    .largest_internal_alloc = SB_MAX(SB_CONTROLLER_OPAQUE, CONFIG_BT_NIMBLE_MSYS_2_BLOCK_COUNT * SB_ALIGN4(CONFIG_BT_NIMBLE_MSYS_2_BLOCK_SIZE)), \
    .largest_dma_alloc = SB_CONTROLLER_OPAQUE, \
    .fragment_internal = SB_FRAGMENT, .fragment_dma = SB_FRAGMENT }
/* Cold init includes netif/event infrastructure. TCP send/window capacities
 * are on-demand and charged at RF/start, not again at cold init. Driver
 * static RX is future heap, despite 'static' in its name. */
#define SB_WIFI_COLD_BUDGET_INIT { \
    .future_internal = 4096u + SB_TCPIP_STACK + 112u + CONFIG_LWIP_TCPIP_RECVMBOX_SIZE * 4u + 92u + SB_EVENT_STACK + 112u + CONFIG_ESP_SYSTEM_EVENT_QUEUE_SIZE * 32u + 256u + CONFIG_ESP_WIFI_STATIC_RX_BUFFER_NUM * 1664u + CONFIG_ESP_WIFI_RX_MGMT_BUF_NUM_DEF * 576u, \
    .future_dma = CONFIG_ESP_WIFI_STATIC_RX_BUFFER_NUM * 1664u + CONFIG_ESP_WIFI_RX_MGMT_BUF_NUM_DEF * 576u, \
    .opaque_internal = 24576u, .opaque_dma = 24576u, \
    .critical_internal = SB_CRITICAL_INTERNAL, .critical_dma = SB_CRITICAL_DMA, \
    .margin_internal = SB_MARGIN_INTERNAL, .margin_dma = SB_MARGIN_DMA, \
    .largest_internal_alloc = 24576u, .largest_dma_alloc = 24576u, \
    .fragment_internal = SB_FRAGMENT, .fragment_dma = SB_FRAGMENT }
/* Cold driver resources remain resident on stop. Charge the configured full
 * dynamic RX+TX capacity at RF/start, not an arbitrary four-frame working set.
 * TCP pbuf capacity can coexist with driver frame storage. */
#define SB_WIFI_DYNAMIC_BYTES ((CONFIG_ESP_WIFI_DYNAMIC_RX_BUFFER_NUM + CONFIG_ESP_WIFI_DYNAMIC_TX_BUFFER_NUM) * 1664u)
#define SB_WIFI_RF_BUDGET_INIT { \
    .future_internal = CONFIG_LWIP_TCP_SND_BUF_DEFAULT + CONFIG_LWIP_TCP_WND_DEFAULT + SB_WIFI_DYNAMIC_BYTES, \
    .future_dma = SB_WIFI_DYNAMIC_BYTES, \
    .opaque_internal = 4096u, .opaque_dma = 4096u, \
    .critical_internal = SB_CRITICAL_INTERNAL, .critical_dma = SB_CRITICAL_DMA, \
    .margin_internal = SB_MARGIN_INTERNAL, .margin_dma = SB_MARGIN_DMA, \
    .largest_internal_alloc = SB_MAX(4096u, SB_MAX(CONFIG_LWIP_TCP_SND_BUF_DEFAULT, CONFIG_LWIP_TCP_WND_DEFAULT)), \
    .largest_dma_alloc = 4096u, .fragment_internal = SB_FRAGMENT, .fragment_dma = SB_FRAGMENT }
