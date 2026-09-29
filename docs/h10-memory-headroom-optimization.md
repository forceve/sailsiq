# Sailball H10 Memory Headroom Optimization

Date: 2026-09-28  
Target: ESP32-C3-WROOM-02-N4, 4 MiB flash, no PSRAM, ESP-IDF v6.1

## Result

**HISTORICAL SNAPSHOT.** This document records an earlier H10 memory analysis. Current project status is H10-S FIXED, H10-F PENDING, and Phase B implementation awaiting independent acceptance. See `implementation-status-v1.0.md`.

**H10 PARTIAL. PHASE A PASS FOR FIRST-FLASH ONLY.**

The optimization removed unused Cellular response storage and narrowed Wi-Fi to
the supported STA/IPv4/outbound-TCP workload. It reduced the saved Production
ELF's DRAM use by 5852 B. The standalone BLE threshold is below an optimistic
static address bound. BLE plus Wi-Fi cold and RF/start are still not reachable
under the current admission model. The DENY gates remain active; no low-memory
state is allowed to enter the known unsafe SDK initialization calls.

No firmware was flashed, no monitor was started, and no hardware heap value is
claimed. This does not enter Phase B.

## Fixed assumptions and preserved requirements

- MCU/module: ESP32-C3-WROOM-02-N4; 4 MiB flash; no external PSRAM.
- Framework: ESP-IDF v6.1.
- BLE at boot: peripheral advertiser, one connection, custom Sailball GATT.
- Wi-Fi at boot: logically OFF; cold initialization stays lazy until SCAN/CONNECT.
- Frozen handover keeps BLE initialized while Wi-Fi starts; the BLE stack is not
  destroyed to manufacture headroom.
- Four 8 KiB LDC blocks, 16 KiB metadata snapshot, GNSS Fix Queue baseline 32,
  and all eight fixed application task stacks remain.
- GNSS remains vendor-neutral. No ATGM, u-blox, NMEA, GNSS parser or driver was
  implemented or exposed outside the GNSS component.
- C01 stack safety, C03 RPC completion barrier, H08 binary-clean USB, and safe
  wireless DENY are preserved.

## Changes and measured savings

| Change | Before | After | Measured/model saving | Behavior and tradeoff |
| --- | ---: | ---: | ---: | --- |
| Control TX backing for unimplemented Cellular source | 2 x 2080 B full responses = 4160 B | 0 B | **4160 B static** | Cellular source ID 3 and protocol reservation remain; submissions are rejected before queue/copy. No Cellular transport is implemented. |
| Wi-Fi static RX | 6 x 1664 = 9984 B | 4 x 1664 = 6656 B | **3328 B future internal/DMA** | RX burst capacity decreases; BA window is also 4. |
| Wi-Fi management RX | 4 x 576 = 2304 B | 2 x 576 = 1152 B | **1152 B future internal/DMA** | Smaller scan/association burst cache. |
| Wi-Fi dynamic RX maximum | 8 x 1664 = 13312 B | 4 x 1664 = 6656 B | **6656 B modeled runtime capacity** | Lower receive burst capacity. |
| Wi-Fi dynamic TX maximum | 8 x 1664 = 13312 B | 4 x 1664 = 6656 B | **6656 B modeled runtime capacity** | Lower transmit burst capacity. |
| TCP send and receive windows | 5760 B each | 2880 B each | **5760 B modeled capacity** | Two 1440 B MSS windows per direction; peak throughput is lower than the prior four-MSS window. |
| SoftAP | enabled | disabled | No isolated SRAM delta measured | STA-only; AP mode is not a v1 feature. |
| IPv6 | enabled | disabled | No isolated SRAM delta measured | Sailball uses IPv4 STA and outbound TCP. |

The Wi-Fi future cold model falls from 24508/12288 B internal/DMA to
20028/7808 B. The RF/start model falls from 38144/26624 B to 19072/13312 B.
These are modeled future allocations/capacities, not static `.bss` savings.

Before optimization, Production `.bss + .data` was 226789 B and IDF reported
319399 B DRAM use. Current Production is 220949 B `.bss + .data` and 313547 B
DRAM use. Static `.bss + .data` fell by **5840 B**; total IDF DRAM use fell by
**5852 B**, including 12 B less SRAM text. Of the static data change, **4160 B**
is exactly the removed Cellular TX backing. The remaining **1680 B** was not
isolated to one config or source edit; it must not be attributed wholly to
SoftAP/IPv6.

No BLE, Wi-Fi or Control RX queue was reduced or merged. The queues hold separate
bounded bursts; merging them changes frame lifetime, backpressure, and disconnect
cleanup. Doing that safely needs an explicit bounded ownership-transfer design
and tests for exhaustion, slot return, double release, and session reset. It also
intersects the deferred H05/H06 behavior. The current report does not count such
an unimplemented optimization as saved memory.

## Current Production static RAM

Values come from the final linked PRODUCTION map/ELF and IDF 6.1 size report.

| Measure | Bytes | Meaning |
| --- | ---: | --- |
| `.bss` | 206704 | linked zero-initialized SRAM |
| `.data` | 14245 | linked initialized SRAM |
| `.iram0.text` counted in DRAM usage | 92598 | IDF size accounting |
| Official DRAM use | 313547 / 321296 (97.59%) | link-time IDF accounting; remainder 7749 B is not free heap |
| Raw initial main/DMA address tail | 65008 | `_heap_start` to `APP_USABLE_DRAM_END` optimistic span |
| Later raw main address span | 14576 | subject to IDF ROM memory-layout reservation; not wholly reclaimable |
| Combined raw main address span | 79584 | optimistic ceiling, not observed heap |
| Eligible RTC upper span | 8132 | internal byte-capable estimate, not DMA and not one contiguous main block |
| Combined optimistic internal address ceiling | 87716 | raw main span plus eligible RTC upper span; not `heap_caps_get_free_size()` |
| Sailball-attributed object symbols | 188600 | partial ELF source-file attribution; not a complete SDK/Sailball partition |
| Remaining linked `.bss + .data` unattributed | 32349 | includes SDK/config and unattributed/alignment objects; not all assigned to one SDK owner |

The link-region remainder, raw heap address span, free heap, largest free block,
and RTC memory are distinct. Runtime free/minimum/largest heap values remain
**PENDING HARDWARE VALIDATION**.

## Top 30 Sailball SRAM objects

These are the 30 largest source-attributed mutable SRAM objects in the fresh
PRODUCTION ELF; each is in `.dram0.bss`. Classifications use the requested labels.
`OPTIMIZE` means a future candidate, not approval to change it. The four 8 KiB
LDC blocks, metadata snapshot, Fix Queue and task stacks are KEEP.

| Rank | Owner / symbol | Bytes | Class |
| ---: | --- | ---: | --- |
| 1 | recorder / `s_block_pool` | 32768 | KEEP |
| 2 | storage / `s_transfer_metadata` | 16384 | KEEP |
| 3 | control / `s_tx_q_data` | 12480 | OPTIMIZE |
| 4 | storage / `s_metadata_workspace` | 12288 | OPTIMIZE |
| 5 | wifi / `s_rx_queue_storage` | 8304 | OPTIMIZE |
| 6 | ble / `s_rx_queue_storage` | 8304 | OPTIMIZE |
| 7 | control / `s_rx_q_data` | 8304 | OPTIMIZE |
| 8 | storage / `s_scan_buffer` | 8192 | CONDITIONAL |
| 9 | recorder / `s_samples` | 6400 | CONDITIONAL |
| 10 | wifi / `s_rx_buffer` | 4152 | OPTIMIZE |
| 11 | wifi / `s_tx_queue_storage` | 4152 | OPTIMIZE |
| 12 | ble / `s_tx_queue_storage` | 4152 | OPTIMIZE |
| 13 | recorder / `s_stack` | 4096 | KEEP |
| 14 | storage / `s_stack` | 4096 | KEEP |
| 15 | transport_task / `s_stack` | 4096 | KEEP |
| 16 | control / `s_stack` | 4096 | KEEP |
| 17 | control / `s_encode_scratch` | 2560 | OPTIMIZE |
| 18 | gnss / `s_fix_queue_storage` | 2304 | KEEP |
| 19 | transport_task / `s_out` | 2092 | CONDITIONAL |
| 20 | transport_task / `s_encoded` | 2092 | CONDITIONAL |
| 21 | control / `s_control_response` | 2080 | OPTIMIZE |
| 22 | wifi / `s_tx_buffer` | 2076 | OPTIMIZE |
| 23 | wifi / `s_tx_item` | 2076 | OPTIMIZE |
| 24 | ble / `s_tx_item` | 2076 | OPTIMIZE |
| 25 | ble / `s_tx_frame` | 2076 | CONDITIONAL |
| 26 | ble / `s_rx_frame` | 2076 | CONDITIONAL |
| 27 | transport_task / `s_decoded` | 2076 | CONDITIONAL |
| 28 | transfer / `s_stack` | 2048 | KEEP |
| 29 | transport_task / `s_payload` | 2048 | CONDITIONAL |
| 30 | supervisor / `s_stack` | 2048 | KEEP |

The `.data` aggregate is 14245 B; its individual objects are below this top-30
mutable-object cut or not source-attributed by the current report script. Large
read-only protocol data stays in flash/rodata; no const table was moved into DRAM.

Application stacks were not changed. The fresh ELF/compiler gate reported:

| Application task | Static stack B | Largest known frame B | Result |
| --- | ---: | ---: | --- |
| gnss_task | 2048 | 304 | PASS |
| recorder_task | 4096 | 1440 | PASS |
| storage_task | 4096 | 1344 | PASS |
| supervisor_task | 2048 | 304 | PASS |
| control_task | 4096 | 2528 | PASS |
| transport_task | 4096 | 2240 | PASS |
| transfer_task | 2048 | 304 | PASS |
| ui_task | 1536 | 304 | PASS |
| **Total** | **24064** | — | one-frame gate only |

The gate does not prove the maximum nested call chain across indirect/library/
interrupt boundaries. VALIDATION runtime stack watermarks remain enabled; no
watermark was measured because no board was used.

## Wireless configuration and model

NimBLE remains Peripheral-only, one connection, custom RX WRITE/TX NOTIFY GATT,
one-link advertising and the current full SP frame fragmentation capacity. It
uses msys counts 8/12, ACL-from-controller count 8, normal/discard transport
events 16/4. This optimization did not shrink NimBLE pools further.

Wi-Fi remains STA-only, IPv4 DHCP client and one outbound TCP Controller. Current
static/dynamic RX/TX buffers are 4/4/4; management RX is 2; RX BA window is 4;
TCP send/receive windows are 2880 B each. IPv6 and SoftAP are disabled. Assertions
remain enabled. DHCP's required UDP path remains enabled. VFS/FatFS LFN remains
enabled; the critical reserve model continues to use a 512 B SD logical sector,
six file handles, 512 B LFN scratch, a 4096 B SD/SPI/mount allowance and a 1652 B
residual allowance (12288 B total, including a 4096 B DMA subset). These are
estimates, not runtime measurements.

Current gates, Production:

| Stage | Required free internal / DMA | Required largest internal / DMA | Optimistic internal ceiling | Outcome |
| --- | ---: | ---: | ---: | --- |
| BLE cold boot | 67636 / 26512 B | 17352 / 17352 B | 75492 B after known startup tasks | statically reachable by 7856 B, actual boot ALLOW unproven |
| Wi-Fi cold after BLE | 60988 / 38528 B | 25600 / 25600 B | 51200 B after only minimum known BLE persistence | **DENY; short 9788 B** |
| Wi-Fi RF/start after BLE + known Wi-Fi cold | 39552 / 23552 B | 5120 / 5120 B | 31172 B after known cold Wi-Fi allocations | **DENY; short 8380 B**, with cold opaque allowance omitted |

The RF bound omits the 24576 B opaque Wi-Fi cold allocation allowance from the
post-cold heap deduction, so it is deliberately optimistic. The 24 KiB allowance
is not a proven single allocation or proven persistence set; it is not reduced
here without source evidence. The largest-block policy uses that allowance plus a
1024 B fragmentation margin for cold gates; no public SDK call was found that
requires a single 24 KiB allocation. This is a conservative hypothetical largest
allocation, not a source-identified allocation.

## Verification

- Host tests: 11/11 original groups pass; Transfer/RPC 7/7; BLE failure points
  7/7; Wi-Fi failure points 14/14; startup combinations 8/8; Control scratch
  comparisons 3/3; admission/model 37/37; coexistence/reachability fixtures
  13/13; reserved Cellular TX allocation test passes.
- Architecture checks: 5/5 pass. Stack/compiler/config checks passed on all
  three profiles. C01/C03/H08 regression tests pass.
- Fresh DEV, VALIDATION and PRODUCTION `reconfigure`, ESP32-C3 build, and final
  link all completed. `scripts/build.ps1` then exits nonzero at the correct H10
  coexistence gate for each profile; it is not a passing acceptance pipeline.
- Current BIN sizes: DEV 964528 B; VALIDATION 943696 B; PRODUCTION 943280 B.
  Current ELF hashes and complete per-profile RAM figures are in
  [the Phase A report](phase-a-pre-first-flash-report.md).
- Seven Frozen v1.0 document hashes match the saved pre-change hashes.
- No flash, monitor or physical hardware test was performed.

## Remaining requirement

H10 cannot be marked FIXED until BLE boot, BLE + Wi-Fi cold, and BLE + Wi-Fi
RF/start all have evidence-based reachable budgets while safe DENY remains. The
current independent allocations may be reachable, but Frozen coexistence is not.
The next review should choose an evidence-backed source of at least the missing
headroom and account for all cold Wi-Fi persistent allocations. Candidates for
discussion are a bounded shared frame-slot ownership design with complete
reset/exhaustion tests, or an explicit reassessment of the supported wireless
concurrency budget. Do not cut Frozen LDC memory, destroy BLE during handover,
disable assertions, or claim unmeasured hardware free heap.
