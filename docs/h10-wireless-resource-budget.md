# H10 Reachable Wireless Admission Budget — 2026-09-28

Target: **ESP32-C3-WROOM-02-N4**, no external PSRAM, installed **ESP-IDF v6.1**.
This is a source/configuration/ELF inventory, **not hardware measurement**.

## Result

**HISTORICAL SNAPSHOT.** This document records an earlier H10 budget. Current project status is H10-S FIXED, H10-F PENDING, and Phase B implementation awaiting independent acceptance. See `implementation-status-v1.0.md`.

**H10 PARTIAL. PHASE A PASS FOR FIRST-FLASH ONLY.**
The previous 136244/130880 B always-DENY policy and inverted gate are replaced.
This optimization reduces the Production static `.bss + .data` by 5840 B and
IDF DRAM accounting by 5852 B versus the
previous saved artifact and makes BLE's isolated admission threshold statically
reachable in an optimistic address model. It does **not** make the Frozen BLE plus
Wi-Fi handover reachable: after subtracting the minimum known persistent BLE
allocations, Wi-Fi cold admission is short by 9788 B. RF/start after subtracting
known Wi-Fi cold allocations is short by 8380 B, even before subtracting the opaque
cold Wi-Fi allowance. The gate returns FAIL and has not been weakened. Private SDK
estimates and runtime heap remain unverified; no Phase A full PASS or Phase B.

Critical owners still start first. BLE checks admission before nimble_port_init.
Wi-Fi boots logically OFF and cold-initializes only for first SCAN/CONNECT.
RF start/restart has its own admission, with already resident cold resources
excluded. DENY/returned errors remain local ERROR/unavailable, diagnostic and
latched until reboot. No unsafe SDK call occurs on DENY. No SDK edit, global
assert disabling, new application task, protocol field or disk change.

## Capability accounting and equations

`I = MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT`
`D = I | MALLOC_CAP_DMA`

D is a **subset** of I. DMA bytes are included in the internal total; they are
never added to that total a second time. No external heap exists in this build.
Default malloc/realloc are byte-capable internal memory on this target; RTC can
serve eligible non-DMA allocations but cannot supply D. Minimum-free is history,
not available capacity. Admission uses current free and largest values.

```text
required_internal_free = future_internal + opaque_internal
                       + critical_internal + margin_internal
required_dma_free      = future_dma + opaque_dma + critical_dma + margin_dma
required_internal_largest = largest_internal_alloc + fragment_internal
required_dma_largest      = largest_dma_alloc + fragment_dma
```

All arithmetic is widened to uint64_t; overflow, invalid maxima and invalid
subset budgets deny. `wireless_budget_model.h` is shared by firmware and host
model tests. SDK ABI probes and the current linked const budgets are cross-checked.

| Phase | Known/capacity future I | Future D subset | Opaque I/D | Critical I/D | Total margin I/D | Required free I/D | Largest I/D |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| BLE cold | 34924 | 4040 | 16328 / 16328 | 12288 / 4096 | 4096 / 2048 | **67636 / 26512** | **17352 / 17352** |
| Wi-Fi cold | 20028 | 7808 | 24576 / 24576 | 12288 / 4096 | 4096 / 2048 | **60988 / 38528** | **25600 / 25600** |
| Wi-Fi RF/start | 19072 | 13312 | 4096 / 4096 | 12288 / 4096 | 4096 / 2048 | **39552 / 23552** | **5120 / 5120** |

Opaque allocations cannot be completely inventoried from public source. The
old 24 KiB controller estimate is retained, not silently reduced: visible
controller objects 8248 B plus opaque remainder 16328 B. Private Wi-Fi allowance
remains 24 KiB. These are **estimated allowances, not proven maximum allocations**.
No assertion can be made that arbitrary concurrent heap changes after a snapshot
cannot cause an SDK assertion. This is one reason H10 remains PARTIAL.

## Allocation inventory conventions

SDK root for source paths: `C:/Espressif/v6.1/esp-idf/components/`.
I/D denote capabilities above; DEFAULT means libc allocator (internal 8-bit here).
P = POST_INIT_PERSISTENT; T = COLD_INIT_TEMPORARY; R = RUNTIME_ON_DEMAND;
C = CONNECTION_ONLY; A = ALREADY_ALLOCATED_BEFORE_ADMISSION.
Counts are per single BLE connection / one STA unless stated. P objects coexist.
A objects are excluded from future_required. Capacity envelopes include R/C
objects which may coexist with P; they do not assert all are eagerly allocated.

### BLE

| Name / source function | Allocation API | Size x count / total B | Caps | Phase / lifetime / coexist | Certainty |
| --- | --- | ---: | --- | --- | --- |
| C3 controller linked .data/.bss; bt.c | linker, no future heap | measured in ELF, excluded | static SRAM | A; whole boot | exact ELF |
| Sailball tasks, LDC pool/snapshot, BLE queues/reassembly | static | unchanged, excluded | static SRAM | A; whole boot | exact ELF |
| IDF main/idle/timer/esp_timer tasks | SDK startup task creation | already in measured free | I | A; already running | source-derived exclusion |
| NPL function table; npl_freertos_funcs_init | calloc/default | 176 x 1 | DEFAULT | P; until deinit | exact C3 probe |
| NPL context; ble_npl_ensure_ctx | nimble calloc | 828 x 1, includes 672 embedded event bytes | I | P; until deinit | exact probe |
| NPL event backing | embedded in context | **0 additional** | I | P; same parent lifetime | exact layout |
| NPL EVQ/callout/sem/mutex pools; pool_init | nimble calloc | 40 + 480 + 80 = 600 | I | P; until deinit | exact probe |
| NPL kernel queues; eventq_init | xQueueCreate | (92 + 56 x 4) x up to 10 = 3160 | I | R; capacity envelope; may coexist | derived ABI/config |
| NPL kernel semaphore/mutexes | FreeRTOS create | 92 x up to 20 = 1840 | I | R; capacity envelope | derived ABI/config |
| NPL callout timers; callout_init | esp_timer_create/heap_caps_calloc | 32 x up to 40 = 1280 | I | R; capacity envelope | exact sizeof, derived count |
| NPL total | rows above, no duplicate backing | **7884** | I | P+R peak envelope | derived |
| msys1/msys2/context; os_msys_init | nimble calloc | 8 x 256 + 12 x 320 + 88 = **5976** | I | P; pools support R/C traffic | exact C3 probe |
| HCI events; transport/ble_buf_alloc | nimble calloc | (16 + 4) x 72 = 1440 | I | P; normal/discard pools | exact probe |
| HCI ACL | nimble calloc | 8 x 300 = 2400 | I | P; single connection traffic | exact probe |
| HCI command/context | nimble calloc | 260 + 156 = 416 | I | P | exact probe |
| HCI total | preceding rows | **4256** | I | P | exact probe |
| Host/state/HCI/GAP/L2CAP/connection/GATTC/ATT/SM/etc | nimble calloc | probed objects/pools/dispatch **3200** | I | P; includes one connection and 64 prepared entries | exact sizes, derived configuration |
| ATT entries/services/CCCDs and registration/name temporary | calloc/realloc | <=40 x 20 + 3 x 8 + 2 x 4 + 128 = 960 | I/DEFAULT | P+T; old/new realloc can coexist | bounded app services, estimated transient |
| Host envelope | preceding two rows rounded to 256 | **4352** | I | P+T+C | derived + 192 rounding allowance |
| NimBLE host task | xTaskCreatePinnedToCore | 4096 + TCB 112 = **4208** | I | P; created **after** admission | exact stack/config/ABI |
| Controller OSI; bt.c esp_bt_controller_init | malloc_internal_wrapper/heap_caps_malloc | 252 x 1 | D | P | exact probe |
| Private controller function tables; btdm_controller_init | OSI malloc_internal | **280 + 976 + 2532 = 3788** | D | P | exact current ELF disassembly immediates |
| Controller task | OSI task_create/FreeRTOS | 4096 + 112 = 4208 | I | P | derived config/source |
| Remaining controller, ROM/PHY/coexist private objects | mixed internal/DMA wrappers | **16328 allowance**; counts unknown | conservatively I and D | P/T/C uncertainty; not a second host pool | **opaque estimate**, not upper-bound proof |
| Advertising/GATT RX/TX / one connection | consumes host/HCI/msys pools above | not an extra whole SP-frame heap buffer | I | R/C; existing static assembly | source-derived |

Host probe breakdown is preserved in each `h10-sizing/sdk-sizes.json`; `measure_wireless_sdk.py`
compiles actual SDK translation units with current profile flags under build/,
without modifying or linking the probes into SDK/firmware.
NimBLE internal-memory allocator is `bt/host/nimble/port/src/esp_nimble_mem.c`.
The non-debug realloc macro maps to libc realloc; without PSRAM it remains
internal byte-capable. NPL kernel objects/task stacks use I, not an obligatory D.
Controller `bt.c` internal wrappers use INTERNAL|DMA. Only those visible objects
and conservatively classified private allocations enter the DMA model.

### Wi-Fi / global network infrastructure

| Name / source function | Allocation API | Size x count / model B | Caps | Phase / lifetime / coexist | Certainty |
| --- | --- | ---: | --- | --- | --- |
| Sailball Wi-Fi command/event/frame queues | static | excluded | static | A; whole boot | exact source/ELF |
| NVS and already running system tasks | startup allocation | excluded from future; current heap reflects them | I/DEFAULT | A | source-derived |
| STA esp_netif/lwIP/attachment contexts and handlers | calloc/esp_event allocation | 4096 envelope, one STA | DEFAULT/I | P; retained after disconnect | estimated public object group |
| TCP/IP task; sys_thread_new | xTaskCreatePinnedToCore | (3072 + 512) + 112 = 3696 | I | P; first cold init only | derived; actual TCPIP_THREAD_STACKSIZE probe |
| tcpip mailbox; sys_mbox_new | xQueueCreate | 32 x 4 + 92 = 220 | I | P | derived config/ABI |
| Default event task | FreeRTOS create | (2304 + 512) + 112 = 2928 | I | P; first cold init only | derived; actual ESP_TASKD_EVENT_STACK probe |
| Event queue/context/handlers | xQueueCreate + calloc | 32 x 32 + 256 = 1280 envelope | I | P; post payloads are R | estimated slot/context envelope |
| Wi-Fi static RX buffers | driver internal allocator | 4 x 1664 = **6656** envelope | D subset | P; allocated during driver init, not linked BSS | derived config + rounded packet allowance |
| Management RX | driver internal allocator | 2 x 576 = **1152** envelope | D subset | P/R driver-specific | derived count, estimated packet allowance |
| Wi-Fi private task/TCB, driver queues, frame descriptors, private init/start objects | private libc/internal wrappers | **24576 allowance**, count unknown | conservatively I/D | P/T; exclude known rows to avoid intentional duplicate count | **opaque estimate**, not bound proof |
| RF restart/start private objects | private allocator | **4096 allowance** | conservatively I/D | R; recreated after stop; separate phase | estimated |
| Dynamic RX maximum | private per-packet allocation | <=4 x 1664 = **6656** envelope | conservatively D | R; can coexist with TX/TCP | configured capacity, rounded sizes |
| Dynamic TX maximum | private per-packet allocation | <=4 x 1664 = **6656** envelope | conservatively D | R; can coexist with RX/TCP | configured capacity, rounded sizes |
| TCP receive/send capacity | lwIP pbuf/segment allocation | 2880 + 2880 = **5760** modeled capacity | DEFAULT/I | R/C; separate TCP storage may coexist with driver frames | two 1440 B MSS windows, not two eager mallocs |
| Global PHY/coexist already initialized by BLE | reference/shared SDK infrastructure | no explicit second allocation charged | I/D | A at Wi-Fi admission if already resident | source-derived; private split uncertain |

`esp_wifi/esp32c3/esp_adapter.c` has libc wifi_malloc/calloc and internal
calloc/realloc wrappers using INTERNAL|8BIT|DMA. DEFAULT does not force every
Wi-Fi object onto D; public netif/event/task rows stay I. Unknown private driver
allocations conservatively use D. Cold initialization does not charge TCP windows
or dynamic packet ceilings: RF/start charges them once as a future capacity model.
Ready netif/event/driver objects remain resident and are not charged again at RF.
Only Wi-Fi owns cold netif initialization in Sailball; first-init failure is latched.

## Largest single allocations

Visible controller single allocations: 252, 280, 976, **2532** B; controller
stack is **4096** B. msys largest backing is **3840** B, host stack **4096** B.
No known BLE allocation needs 87 KiB. BLE uses max(visible allocations, private
remainder allowance 16328) + **1024** = **17352**. The private allowance could
in principle be one allocation; its use here is a conservative **unverified
single-allocation estimate**, not conversion of the complete BLE peak into one block.

Wi-Fi cold largest known public stack is 3584/2816; rounded RX payload is 1664.
Private single allocations are opaque, so the retained 24576 allowance + 1024
sets **25600**. No known allocation needs the old 81728 B contiguous block.
RF largest modeled single internal allocation is the 4096 B opaque private-driver
allowance (larger than one 2880 B TCP window); +1024 gives **5120**. DMA uses the
4096 B private allowance +1024, also **5120**.
This is an upper-envelope interpretation, not a claim tcpip allocates a whole window.
The 1024 B fragmentation/header margin is a policy estimate. Free/largest snapshots
do not guarantee how many later allocations fit; gate PASS would be necessary only.

## Critical reserve and margins

Critical application stacks (24064 B), four 8192 B LDC blocks and 16384 B snapshot
are static and **excluded**. Current SD/GNSS GPIOs are unconfigured; this does not
invent a mounted-SD runtime measurement. Reserve allows future configured SD:

- VFS context 2156 + six FIL x44 + six flags x4 = 2444 B.
- SD logical sector 512: six file caches plus one window = 3584 B.
- FATFS LFN heap scratch `(255+1)*2` = 512 B (no exFAT).
- SD/SPI/mount/card/kernel objects and DMA workspace allowance = 4096 B, estimated.
- Residual critical/kernel margin = 1652 B.
- Total = **12288 B**, including **4096 B DMA subset**.

`fatfs/src/ff.c` f_mount/f_open allocates `SS(fs)`, not `FF_MAX_SS`.
`FF_MAX_SS=4096` still exists due wear-leveling configuration; Sailball SD uses
512 B sectors. FATFS generator sector-choice Kconfig does not change FF_MAX_SS,
so it was not edited to claim savings. Mount capacity remains six handles; the
reserve does not assume six file caches have already been allocated.
Formatting/other background operations and unusual driver/card paths are not
certified by this estimated normal-critical reserve; failures must remain noncritical.

Internal allocator/concurrency margin 4096 and DMA subset 2048 cover headers,
alignment and competing bounded work. Fragmentation margin 1024 is separate.
These are explicit **estimated policy allowances**, not measurements or strict
allocator guarantees. No monolithic 32768 'because conservative' framework margin.

## Double-counting corrections

1. Embedded NPL event backing is part of context: zero extra allocation.
2. NPL timers use actual esp_timer sizeof 32, not 128 B assumed per timer.
3. Visible controller tables/task are inside retained 24 KiB controller total;
   opaque remainder subtracts them before adding to known future bytes.
4. Already linked controller sections, app buffers/stacks/queues and running IDF
   tasks are not future allocation. Host/controller tasks created after admission are.
5. Cold-only global infrastructure is excluded from RF/start budget.
6. TCP/dynamic packet capacities moved to RF phase, not charged in both phases.
7. Internal and DMA overlapping totals are never summed.

## Configuration reductions and tradeoffs

| Config | Previous | Current | Reason / tradeoff |
| --- | ---: | ---: | --- |
| BLE max connections | 1 | 1 | unchanged Frozen single Controller |
| msys1 / msys2 counts | 12 / 24 | 8 / 12 | retain multiple concurrent ATT fragment chains, static SP reassembly; lower burst capacity |
| HCI ACL / normal events / discard events | 24 / 30 / 8 | 8 / 16 / 4 | one link, observer/central already disabled; lower burst queue capacity |
| Wi-Fi static RX | 10 | 4 | `CONFIG_ESP_WIFI_RX_BA_WIN=4`; less RX burst capacity |
| Wi-Fi dynamic RX / TX max | 32 / 32 | 4 / 4 | bounded four-packet capacity; lower burst buffering |
| Wi-Fi management RX | 5 | 2 | single STA; smaller scan/association burst cache |
| SoftAP | enabled | disabled | Sailball is STA-only; no AP mode support |
| IPv6 | enabled | disabled | Sailball uses IPv4 STA/outbound TCP only |
| TCP send / receive window | 5760 / 5760 B | 2880 / 2880 B | two MSS each; lower peak TCP throughput |

No role, GATT UUID, ATT preferred MTU (256), SP max payload/fragmentation ABI,
assert, controller activity capacity or required BLE service is removed.
At maximum app ATT value, two msys2 blocks per 517-byte chain fit within twelve;
simultaneous full RX/TX require up to six ACL buffers with two spare out of eight.
This is a capacity argument, **not BLE throughput/interoperability validation**.

## Fatal-entry self-review and validation metrics

| Actual call path | On DENY | On ALLOW |
| --- | --- | --- |
| sb_ble_init -> nimble_port_init -> controller/NPL/msys/host/GAP/GATT | returns local ERROR before NimBLE entry; tested zero calls | estimates checked against config/probes; private allocation maxima unproven |
| wifi_ensure_driver -> esp_netif_init -> tcpip_init -> mailbox/task | returns ERROR before netif entry; tested zero calls | global first init only; mailbox/task allocation fatal/hang remains SDK behavior |
| wifi_ensure_driver -> esp_wifi_init | no driver entry on DENY | returned failure cleaned up/local ERROR |
| start_wifi -> esp_wifi_start | RF gate prevents entry on DENY | returned error local ERROR; no retry storm |

VALIDATION retains before/after free/minimum/largest I/D, four required thresholds
and decision; core/tasks/BLE/Wi-Fi logical startup checkpoints remain. These are
internal diagnostics, not public SP. All actual post-BLE/post-Wi-Fi heap readings
are **PENDING HARDWARE VALIDATION**. ROM output before runtime remains separate
from binary-clean SP; no physical validation or SDK modifications.

## ELF reachability and test evidence

Latest per-profile metrics and exact hashes are recorded in the Phase A report.
`h10-budget-report.json` contains linked budgets, C3 ABI probes, optimistic
capability ceilings, a minimum persistent BLE deduction and gate failures.
Raw main tail includes the startup-reserved range; **it is not wholly reclaimable**:
IDF `heap/port/memory_layout_utils.c:s_prepare_reserved_regions` reserves the
ROM layout `dram0_rtos_reserved_start..SOC_DIRAM_DRAM_HIGH` at runtime. ROM table
and allocator/task allocations reduce it. RTC is internal/8-bit but not DMA,
not added to the DMA requirement or treated as a contiguous main block.

The gate fails if an independent threshold exceeds its optimistic capability
ceiling, model/config/ABI evidence drifts, or Wi-Fi cold/RF is impossible after the
minimum known persistent BLE and cold-Wi-Fi objects. Its RF deduction excludes
opaque Wi-Fi cold allocations that may persist, so this coexistence check is
deliberately optimistic. Standalone static reachability is necessary, not proof of
a normal startup state. Production remains H10 PARTIAL.

### Production bounds and actual startup exclusions

Fresh PRODUCTION ELF raw initial main/DMA tail: **65008 B**; raw later main
address span: **14576 B**; eligible RTC upper span **8132 B**; optimistic internal
total **87716 B**; initial main largest **65008 B** before runtime reservations.
The DMA-capable combined raw main address ceiling is **79584 B**. These are address
bounds, not heap_caps readings. There is no gap between the
mapped IRAM end and `_data_start` in this ELF that supplies another main heap.

Source/probe-confirmed tasks already present at BLE admission:
main 4096+112, esp_timer 4096+112, idle 1536+112, kernel timer 2048+112,
total **12224 B**. IDF `freertos/port_common.c` allocates idle/kernel-timer
stacks/TCBs from heap even with static-allocation support. These are excluded
from future budgets; subtracting them from the optimistic internal address ceiling
gives at most **75492 B** before other startup allocations/reservations. BLE needs
67636 B, leaving 7856 B in this deliberately permissive bound. Normal boot
ALLOW is **NOT PROVEN**; ROM reservations, NVS, USB, allocator overhead and
concurrent task work still reduce the bound. USB default ring payloads are
256 RX/256 TX, with additional dynamic ring/context/synchronization overhead;
Transport timing does not guarantee these exist before BLE admission.

`esp_task.h` adds 512 B libc stack overhead with the current non-nano libc.
`lwipopts.h:TCPIP_THREAD_STACKSIZE` uses ESP_TASK_TCPIP_STACK (3584 B),
and `default_event_loop.c` uses ESP_TASKD_EVENT_STACK (2816 B). Both are future
at cold admission. The model and probes include this extra 1024 B, rather than
using the bare Kconfig 3072/2304 values. Core locking is disabled; its extra
2048 B event stack would also be included if enabled.

Minimum definitely resident BLE bytes: **24292 B**. After known startup tasks
and that minimum BLE set, Production's optimistic internal ceiling is **51200 B**,
below Wi-Fi cold's **60988 B** requirement by **9788 B**. Subtracting known Wi-Fi
cold allocations (**20028 B**) leaves **31172 B**, below RF/start's **39552 B**
requirement by **8380 B**. The RF comparison does not deduct the opaque cold Wi-Fi
allowance (24576 B), although part may persist, and is therefore optimistic.
Public network infrastructure alone is modeled at 7780 B. These inequalities
disprove supported BLE+Wi-Fi admission coexistence under the current budget; they
do not prove BLE itself initializes in a real boot.

Tests: existing eleven groups and all Phase A fake schedules retained; real
production admission helper + current config budget macros now drive BLE/Wi-Fi
init stubs for ALLOW and DENY. Boundary/overflow/model tests and 13 positive and
negative reachability-gate cases are included. These do not run actual NimBLE/lwIP
or hardware.

### Latest static-image comparison

The previous saved Production ELF had `.bss=212536 B`, `.data=14253 B` and
official DRAM use 319399 B. Current Production has `.bss=206704 B`,
`.data=14245 B` and DRAM use 313547 B: `.bss + .data` is **5840 B** lower and
total IDF DRAM accounting is **5852 B** lower (including 12 B less SRAM text).
Removing the unimplemented Cellular full-frame TX queue saves exactly **4160 B**
(two 2080 B response slots). The remaining 1680 B static-data change is not
isolated to a single configuration or source edit. This is static-image savings,
not measured free heap.

Current Production `_heap_start` is `0x3fccc920`; the initial raw main span ends
at `0x3fcdc710`. Link-region remainder is 7749 B and is distinct from the raw
address tail. ESP-IDF ROM-layout reservations and runtime allocations reduce the
raw address ceiling.
