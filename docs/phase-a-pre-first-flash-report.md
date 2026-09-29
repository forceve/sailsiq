## Current status amendment — 2026-09-28

PHASE A SOFTWARE SAFETY GATE = PASS.
C01/C03/H08/H10-S = FIXED.
H10-F = PENDING.
FULL PHASE A RUNTIME ACCEPTANCE = PENDING HARDWARE VALIDATION.

This status reflects the Phase A prerequisite amendment. H10-F wireless coexistence and runtime heap/largest-block behavior have not been verified. Phase B software work is allowed with H10-F pending. The historical report below retains its original point-in-time memory assessment; it is not a claim of H10-F closure. No hardware was flashed or tested.

# Sailball v1.0 Phase A Pre-First-Flash Report

Updated: 2026-09-28. ESP32-C3-WROOM-02-N4; ESP-IDF v6.1; Windows.

## 1. Result and scope

**PHASE A PASS FOR FIRST-FLASH ONLY. H10 PARTIAL.** C01/C03/H08 remain FIXED.
The corrected model separates internal/DMA totals and largest single allocations,
fixes NPL backing duplication and SD cache assumptions, and makes independent
thresholds fit optimistic ELF ceilings. It does **not** establish normal
BLE/Wi-Fi coexistence: the Wi-Fi cold threshold exceeds the optimistic heap
remaining after definitely persistent BLE allocations. The new gate correctly
FAILS. No full Phase A PASS and no Phase B work.

FIRST FLASH TESTED / LAB READY / FIELD READY / RELEASE READY: **NO**.
Software smoke scope remains critical-task startup/USB/low-memory local denial;
private ALLOW-path allocation estimates and actual wireless availability are not
hardware-verified. Do the final focused acceptance review before a controlled smoke.

No Frozen specification, installed SDK, global PATH/profile/Git configuration,
partition or SP/LDC/permission/UUID ABI was changed. No flash/monitor/board test.

| Finding | Status | Evidence |
| --- | --- | --- |
| C01 | FIXED | Eight-task compiled gate retained; 2528 B Control frame vs 4096 B stack; 160 B metadata validator. |
| C03 | FIXED | RPC index 1/control index 0; seven production Transfer fake schedules pass. |
| H08 | FIXED | Console NONE/secondary NONE/panic silent/bootloader NONE; profile gate retained. |
| H10 | PARTIAL | Real helper + production budget ALLOW/DENY stub tests pass; cold Wi-Fi coexistence gate fails. |

## 2. C01: Control repair

### Before

The staged baseline `control_task()` retained a request object (~2,076 B), response object (~2,080 B), `response_payload[2048]` and `result[2048]`, plus branch-local bulk/response objects. Compiler allocation of these lifetimes produced an 8,384 B frame against a 4,096 B task stack. `send_live_samples()` also had a 4,288 B frame. Dispatch/encoding helpers added parsed CBOR maps, file list entries, error records, diagnostics snapshots and scan entries on top of the task frame.

### After

- `components/sailball_control/src/control.c:30`: a 2,080 B static `s_control_response`, owned only by Control.
- The adjacent `s_encode_scratch` union is 2,560 B, covering mutually exclusive map/file/error/counter/AP workspaces.
- The task retains one request object on its own stack. Its payload is reused for response data after the request inputs have been consumed. The static response holds the final status envelope.
- Borrowed CBOR string/byte pointers are consumed before overwrite. Scalar input values are copied before the parsed-map union is reused, including LIST offset/limit.
- Response/event/live/BULK objects are copied by value into existing TX queues; queue receivers rebind their payload pointer. Public transport-facing APIs do not use Control's scratch.
- No hot-path malloc, shared unprotected temporary or queue depth change was introduced.

`control_task()` now compiles to **2,528 B** and `send_live_samples()` to **144 B**. Control's stack remains **4,096 B**. This increases static workspace usage rather than allocating a 16 KiB task stack. Three production encoding adapter tests compare separate output and request-payload reuse byte for byte.

## 3. C01: Storage/LDC repair

The baseline validator combined catalog/definition arrays, auxiliary/name buffers, enum-value scratch and metadata pages on the stack. Its compiled frame was **5,520 B**; metadata load was **2,048 B**. This exceeded Storage's 4,096 B allocation before nested file I/O.

`sb_ldc_metadata_workspace_t` now explicitly owns catalog/definition IDs, 2,048 B byte scratch, 256 enum values, superblock buffers/candidates and a page. Load/publish require the caller to supply it through `sb_ldc_io_t.workspace`. The Storage owner shares its existing **12,288 B** profile-table workspace with validation using a union and a size assertion.

Publication writes and compares the profile tables before validation starts reusing that union. No later publication step references overwritten tables. Loading uses the validation member before a profile rebuild uses the tables member. Existing COW fault tests now also exercise this alias lifetime.

Final frames: `validate_metadata_records()` **160 B**, `sb_ldc_metadata_load()` **96 B**, `sb_ldc_metadata_publish()` **1,344 B**, `sb_ldc_metadata_initialize()` **1,072 B**. Storage's task entry remains **1,120 B** and its allocation remains **4,096 B**.

LDC header, descriptors, footer, metadata layout, COW ordering and two commit barriers were not changed. The existing GNSS profile/ENUM validator finding H01 remains open; this repair does not claim that profile is valid.

## 4. Stack analysis and automated gate

ESP-IDF v6.1's ESP32-C3 task stack sizes and `uxTaskGetStackHighWaterMark()` values are **bytes**. The existing `*_STACK_WORDS` macro names are historical; the linked `StackType_t` arrays have the sizes below. Internal validation field names were corrected to `stack_low_water_bytes`.

| Application task | Allocation before -> after (B) | Final entry frame (B) | Largest known reachable individual frame (B) | Gate |
| --- | ---: | ---: | --- | --- |
| gnss_task | 2,048 -> 2,048 | 144 | 304, `__assert_func` | PASS |
| recorder_task | 4,096 -> 4,096 | 352 | 1,440, `build_block.constprop.0` | PASS |
| storage_task | 4,096 -> 4,096 | 1,120 | 1,344, `sb_ldc_metadata_publish` | PASS |
| supervisor_task | 2,048 -> 2,048 | 272 | 304, `__assert_func` | PASS |
| control_task | 4,096 -> 4,096 | 2,528 | 2,528, `control_task` | PASS |
| transport_task | 4,096 -> 4,096 | 400 | 2,240, `complete_scan` | PASS |
| transfer_task | 2,048 -> 2,048 | 208 | 304, `__assert_func` | PASS |
| ui_task | 1,536 -> 1,536 | 80 | 304, `__assert_func` | PASS |

Total statically allocated application stacks: **24,064 B**, unchanged. Before-frame values supplied by the audit are 8,384 B for Control, 4,288 B for live encoding, 5,520 B for metadata validation and 2,048 B for metadata load. No baseline recompilation or hardware measurement is represented as a new before measurement.

`-fstack-usage` is enabled by project CMake. `scripts/check_stack_usage.py` reads `.su` and the fresh linked RISC-V ELF, follows direct/tail calls and fixed project callback destinations, and normalizes GCC clone names (`constprop`, `isra`, `part`). It rejects known individual frames greater than the containing task allocation and known unbounded dynamic frames. A negative fixture proves an 8,384 B reachable frame is rejected against 4,096 B.

Manual examples, using final compiled frames:

- Control parsing: 2,528 B entry + 64 B parse + a conservative seven 64 B CBOR skip frames = **3,040 B** before external/runtime overhead; approximately 1,056 B nominal margin.
- Control LIST RPC: 2,528 + 288 B Storage API + 32 B RPC submission + 48 B notification wait = approximately **2,896 B**, before additional kernel boundaries.
- Storage publication/validation path: 1,120 + 1,344 + 160 + 32 + 48 + 32 = approximately **2,736 B**, before external VFS/FatFS calls; approximately 1,360 B nominal margin.
- Storage prefix validation path: 1,120 + 448 + 96 + 160 + 32 + 48 + 32 = approximately **1,936 B**, before external VFS/FatFS calls.

These are known path sums, **not complete worst-case bounds**. Indirect VFS/NVS calls, C++ symbol correlation, precompiled wireless libraries, recursion and interrupt/context overhead remain NOT VERIFIED by the gate. The JSON reports expose missing frames and indirect boundaries. Runtime watermarks for all eight tasks remain necessary. They are prepared for VALIDATION, but no runtime watermark was observed.

## 5. C03: RPC completion and lifetime

`components/sailball_common/include/sailball/rpc_completion.h` establishes two meanings:

- Index 0: Transfer control wake/reset/shutdown.
- Index 1: synchronous RPC completion carrying the owner's result.

The config requires at least two task notification entries. Storage RPC and Control-to-Transfer synchronous RPC use `sb_rpc_wait_completion()` / `sb_rpc_complete()`. Reset/shutdown use `xTaskNotifyGiveIndexed(..., 0)` and cannot wake the index-1 barrier. Transfer drains index 0 while processing reset flags.

Requests remain copied into bounded queues. Once accepted, cancellation is **deferred until the actual owner completes**: the waiting function does not return on a reset, shutdown or unsuccessful wait result. The caller's stack output buffers therefore remain alive while Storage owns the request. There is one synchronous outstanding request per caller, one completion, no timeout return and no separately freed completion object.

The deterministic test includes the entire production Transfer translation unit. Fake Storage uses the production completion helper and writes outputs immediately before completion. It exercises:

1. Reset before RPC.
2. Reset while pending.
3. Reset immediately before completion.
4. Completion followed by reset.
5. Back-to-back RPC.
6. Shutdown while pending.
7. Late completion after shutdown intent.

Assertions check output values, continued output lifetime, exactly one completion per request, no index-1 leakage, and retry of a false wait result. There is no early cancellation followed by a write into returned stack storage. These are deterministic fake owner tests, not real FreeRTOS/FatFS scheduling tests. Storage epoch-abort cleanup of Transfer (H03) and background scheduling (H12) remain unchanged.

## 6. H08: USB isolation

Common defaults and all generated DEV/VALIDATION/PRODUCTION configs now select:

```text
CONFIG_ESP_CONSOLE_NONE=y
CONFIG_ESP_CONSOLE_SECONDARY_NONE=y
CONFIG_ESP_SYSTEM_PANIC_SILENT_REBOOT=y
CONFIG_BOOTLOADER_LOG_LEVEL_NONE=y
```

`CONFIG_ESP_CONSOLE_USB_SERIAL_JTAG` and `CONFIG_ESP_CONSOLE_SECONDARY_USB_SERIAL_JTAG` are disabled. `usb.c` fails compilation if either is enabled. The post-build config gate checks these choices, panic/boot logging, notification isolation, NimBLE capacity and VALIDATION metrics. The native Serial/JTAG driver remains available for SP.

DEV retains compiled INFO log sites but has no textual console output; there is no assumed spare debug UART. IDF `cpu_start.c` with CONSOLE_NONE disables ROM putc channels before Sailball starts SP. No normal runtime ESP_LOG/printf console fan-out shares the SP channel. The expected runtime stream remains `COBS(SP) + 0x00`; no SP ABI change was made.

ROM/reset output before application console initialization may still appear. No eFuse was changed. Host discovery must discard early boot bytes and reset its COBS/session decoder before HELLO. This is a timing limitation, not evidence of runtime console isolation being physically tested.

## 7. H10 memory-headroom optimization

Detailed per-allocation API/capability/phase/lifetime/count/uncertainty inventory:
[H10 resource budget](h10-wireless-resource-budget.md).

- BLE before nimble_port_init; DENY makes zero NimBLE calls.
- Wi-Fi logical OFF boot/lazy cold init; DENY makes zero netif/driver calls.
- RF start has a separate full configured dynamic-buffer budget.
- SDK returned failures remain local ERROR and no retry storm.
- Eight critical owners/tasks start first; pool/snapshot/static task stacks retained.
- No framework assert masking or SDK edits.
- Internal and DMA budgets overlap as subsets, not additive heaps.
- Private estimates remain explicit. They are not certified allocation upper bounds.

| Boundary | Required free I / D B | Required largest I / D B |
| --- | ---: | ---: |
| BLE cold | 67636 / 26512 | 17352 / 17352 |
| Wi-Fi cold | 60988 / 38528 | 25600 / 25600 |
| Wi-Fi RF/start | 39552 / 23552 | 5120 / 5120 |

Cold BLE future known/capacity 34924 B + private remainder 16328 + critical
12288 + margin 4096. Controller visible tables/OSI/task 8248 B are within the
retained 24576 B controller total. NPL capacity 7884 B includes embedded backing
once and actual 32 B esp_timer handles. msys 5976 B; HCI 4256 B; host envelope
4352 B; host task 4208 B. All are future, not already running app task stacks.

SD critical estimate is VFS/six handles/caches 6028 + LFN 512 + SD/SPI allowance
4096 + critical residual 1652 = 12288, DMA subset 4096. FF_MAX_SS still 4096
but SD caches allocate actual SS(fs)=512. None of the 48 KiB static LDC pool and
metadata snapshot or 24064 B static app stacks is recharged to heap reserve.

Configuration changes retained from the admission work: msys counts 12/24 -> 8/12,
HCI ACL/events/discard 24/30/8 -> 8/16/4. This optimization further changes Wi-Fi
static RX 6 -> 4, dynamic RX/TX 8/8 -> 4/4, management RX 4 -> 2 and RX BA window
6 -> 4; it disables SoftAP and IPv6 and changes TCP send/receive windows 5760 ->
2880 B each. One BLE connection, Peripheral/GATT roles, UUIDs, MTU, SP frame and
fragment capacities remain. Wi-Fi burst headroom and TCP peak throughput fall.
These settings were statically checked, not validated against a radio or Controller.

The former inverted gate (require thresholds ABOVE ceiling) is removed.
The new gate cross-checks actual SDK C3 ABI and linked model, rejects unattainable
thresholds, and deducts only certain persistent BLE objects for a permissive
Wi-Fi coexistence upper bound. It deliberately omits all private controller,
host/kernel overhead, ROM reservations and system baseline in that deduction;
even this optimistic bound fails. Individual synthetic raw-ceiling ALLOW tests
are not evidence of an actual normal startup state.

Compiled SDK probes confirm 512 B extra libc stack overhead for both TCP/IP and
default event tasks: 3584/2816 B actual stacks. After the reduced Wi-Fi profile,
the cold future internal model is 20028 B and its known DMA subset is 7808 B.
Before BLE admission, known main/esp_timer/idle/kernel-timer stacks+TCBs consume
12224 B. The production model's optimistic internal ceiling before BLE is 75492 B;
it exceeds the BLE threshold by 7856 B before other startup allocations/reservations.
After subtracting only the minimum known persistent BLE model (24292 B), at most
51200 B remains, below Wi-Fi cold's 60988 B requirement by 9788 B. After also
subtracting only known Wi-Fi cold allocations (20028 B), at most 31172 B remains,
below RF/start's 39552 B requirement by 8380 B. Cold private Wi-Fi allocations may
persist and are not deducted in this deliberately optimistic RF bound. BLE+Wi-Fi
coexistence therefore remains unreachable under the current admission model.

## 8. Latest measurements

All three isolated profiles were reconfigured and rebuilt for ESP32-C3 with the
new buffer configuration. After the last firmware model correction, all three
again compiled `wireless_resources.c` and relinked `sailball.elf` and `sailball.bin`.
The final build logs show the new compilation and link steps. No old ELF is
reported as the current result. Bootloader and partition artifacts were retained
and checked by IDF; neither layout nor flash settings changed.

### Final artifacts

| Profile | BIN bytes | ELF SHA-256 | .bss B | .data B | SRAM .text B | Official DRAM used / 321296 B | Raw initial main tail B | Raw total main tail B | Optimistic internal address ceiling B |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| DEV | 964528 | `9d46e8ed416a03d338815e0b84f21c55fc81d80fdc366758f9105be10f82e318` | 206704 | 14245 | 92794 | 313743 | 64496 | 79072 | 87204 |
| VALIDATION | 943696 | `a040716cc09984e98faef283d793815c03f52d4dee9e2a763f1e9d5c554f84e9` | 207200 | 14245 | 92598 | 314043 | 64512 | 79088 | 87220 |
| PRODUCTION | 943280 | `713ff9d8b290b91c2afbdb6a6d883eb00775af84b9990a1cf2597d460efea593` | 206704 | 14245 | 92598 | 313547 | 65008 | 79584 | 87716 |

The official PRODUCTION image-content size is 942915 B; its padded BIN is
943280 B. Link-region remaining is 7749 B, **not runtime free heap**. Raw main
tail starts at `_heap_start=0x3fccc920`; the initial span ends at 0x3fcdc710
(65008 B), with a further 14576 B raw address span below 0x3fce0000. That later
span is subject to IDF ROM-layout reservations and is not wholly reclaimable.
Eligible RTC contributes at most 8132 B to internal byte-capable memory, never
to DMA. PRODUCTION's optimistic combined internal address ceiling is 87716 B;
the raw DMA-capable main ceiling is 79584 B. Neither is `heap_caps_get_free_size`.

All profiles use identical current linked admission thresholds:

| Boundary | Required free internal / DMA B | Required largest internal / DMA B |
| --- | ---: | ---: |
| BLE cold | 67636 / 26512 | 17352 / 17352 |
| Wi-Fi cold | 60988 / 38528 | 25600 / 25600 |
| Wi-Fi RF/start | 39552 / 23552 | 5120 / 5120 |

Production optimistic pre-BLE internal ceiling after known startup tasks is
75492 B. After subtracting the minimum known persistent BLE allocations it is
51200 B, below Wi-Fi cold's 60988 B threshold. After subtracting known Wi-Fi
cold allocations it is 31172 B, below Wi-Fi RF/start's 39552 B threshold; this
does not deduct opaque cold Wi-Fi objects that may persist. Actual normal-boot
BLE free/largest and all post-init heap values are
**PENDING HARDWARE VALIDATION**. Standalone raw-ceiling synthetic ALLOW tests
are necessary arithmetic checks, not proof of a real supported state.

### Exact check results

| Check | Result |
| --- | --- |
| Original native host groups | 11/11 PASS, retained |
| Architecture checks | 5/5 PASS |
| Production Transfer/RPC fake schedules | 7/7 PASS |
| Production BLE returned-init failure points | 7/7 PASS |
| Production Wi-Fi returned-init failure points | 14/14 PASS |
| Startup BLE/Wi-Fi/UI combinations | 8/8 PASS |
| Control scratch alias comparisons | 3/3 PASS |
| Production admission helper/current model cases | 37/37 PASS |
| Reachability gate positive/negative fixtures | 13/13 PASS |
| BLE synthetic ALLOW / DENY SDK entry assertions | PASS; one / zero NimBLE calls |
| Wi-Fi synthetic cold/RF ALLOW / DENY entry assertions | PASS; one / zero unsafe entries; boot remains lazy |
| SDK returned errors / RF OOM / retry latches | PASS; local ERROR, no retry storm |
| DEV / VALIDATION / PRODUCTION compile and final link | PASS / PASS / PASS |
| Generated console/RPC/profile config gates | PASS / PASS / PASS |
| Eight-task compiler/ELF frame gates | PASS / PASS / PASS |
| H10 capability/coexistence acceptance gate | **FAIL / FAIL / FAIL** |
| Overall scripts/build.ps1 acceptance pipeline | **FAIL**, at the expected H10 coexistence gate, despite successful compile/link |
| Frozen document hash comparison | 7/7 unchanged |

Commands: `scripts/test.ps1`, `scripts/check_architecture.py`, all three
`scripts/build.ps1 -Profile ...` runs, config/frame/wireless checks,
`scripts/memory_budget.py` and `python -m esp_idf_size build/<profile>/sailball.map`.
Detailed evidence is in ignored `build/h10-headroom-*.log`, `build/h10-headroom-final-tests.log`,
`build/h10-headroom-build-results.json`, and profile
`stack-usage-report.json`, `memory-budget.json`, `h10-budget-report.json`,
`h10-sizing/sdk-sizes.json`. `build/h10-frozen-before.json` and
`h10-frozen-after.json` record unchanged SHA-256 for all seven authoritative docs.

The new tests exercise actual admission code and extracted current production
init functions with fake dependencies. They do not invoke actual NimBLE/lwIP,
prove radio interoperability, or measure hardware heap. The SDK probes measure
types/configuration only. Framework/private OOM paths remain guarded on DENY,
not proven impossible on every ALLOW snapshot.

### Top 30 Sailball SRAM objects (PRODUCTION)

All entries below are .bss. Static task stacks are retained in this H10 scope;
their measured safety margins are discussed above. Candidate labels are future
review directions, not authorization to reduce critical buffers.

| Owner / symbol | B | Classification |
| --- | ---: | --- |
| recorder / s_block_pool | 32768 | KEEP |
| storage / s_transfer_metadata | 16384 | KEEP |
| control / s_tx_q_data | 12480 | OPTIMIZE |
| storage / s_metadata_workspace | 12288 | OPTIMIZE |
| wifi / s_rx_queue_storage | 8304 | OPTIMIZE |
| ble / s_rx_queue_storage | 8304 | OPTIMIZE |
| control / s_rx_q_data | 8304 | OPTIMIZE |
| storage / s_scan_buffer | 8192 | CONDITIONAL |
| recorder / s_samples | 6400 | CONDITIONAL |
| wifi / s_rx_buffer | 4152 | OPTIMIZE |
| wifi / s_tx_queue_storage | 4152 | OPTIMIZE |
| ble / s_tx_queue_storage | 4152 | OPTIMIZE |
| recorder / s_stack | 4096 | KEEP |
| storage / s_stack | 4096 | KEEP |
| transport_task / s_stack | 4096 | KEEP |
| control / s_stack | 4096 | KEEP |
| control / s_encode_scratch | 2560 | OPTIMIZE |
| gnss / s_fix_queue_storage | 2304 | KEEP |
| transport_task / s_out | 2092 | CONDITIONAL |
| transport_task / s_encoded | 2092 | CONDITIONAL |
| control / s_control_response | 2080 | OPTIMIZE |
| wifi / s_tx_buffer | 2076 | OPTIMIZE |
| wifi / s_tx_item | 2076 | OPTIMIZE |
| ble / s_tx_item | 2076 | OPTIMIZE |
| ble / s_tx_frame | 2076 | CONDITIONAL |
| ble / s_rx_frame | 2076 | CONDITIONAL |
| transport_task / s_decoded | 2076 | CONDITIONAL |
| transfer / s_stack | 2048 | KEEP |
| transport_task / s_payload | 2048 | CONDITIONAL |
| supervisor / s_stack | 2048 | KEEP |

Four 8 KiB blocks, the 16 KiB active metadata snapshot, all eight application
stacks and transport static buffers were not cut or redesigned. The admission
model did not add a large mutable/static scratch. Configuration reductions
lower future dynamic capacity; they do not create a measured runtime heap.

### Files touched in the latest H10 memory pass

- `components/sailball_control/src/control.c` and new `control_sources.h` remove
  the unimplemented Cellular full-frame TX queue while preserving source ID 3.
- `sdkconfig.defaults` and the three saved profile configurations set the reviewed
  STA-only, IPv4-only Wi-Fi buffer/TCP sizing. `wireless_resources.c` enforces it.
- `check_wireless_budget.py`, `memory_budget.py`, `test.ps1`, and Phase A budget
  and Cellular queue tests check reachability/config drift and report Top 30 RAM.
- Updated H10 resource budget, memory optimization, Phase A, implementation-status
  and build/test documents.

The current H10 memory pass additionally removes the unused Cellular full-frame
Control TX queue (4160 B measured), disables Wi-Fi SoftAP and IPv6, reduces Wi-Fi
buffer/TCP capacities, and adds a test for reserved Cellular source behavior.
Current Production `.bss + .data` is 220949 B, 5840 B below the saved prior
Production artifact (226789 B). IDF DRAM accounting fell by 5852 B including
12 B less SRAM text. Of the `.bss + .data` reduction, 4160 B is directly
attributable to the removed Cellular queue; the remaining 1680 B is not isolated
to one change.
No BLE/Wi-Fi RX ownership queue was merged or reduced because that would alter
burst absorption and disconnect/session cleanup while H05/H06 remain out of scope.

The repository has no HEAD commit and includes earlier staged/untracked Phase A
work. Those pre-existing differences are not attributed to this H10 pass.

## 9. Remaining scope and recommendation

H10 remains PARTIAL. After reasonable target-specific reductions, the optimistic
Production heap bound is short by 9788 B for Wi-Fi cold after the minimum known
persistent BLE state, and by 8380 B for RF/start after known Wi-Fi cold allocations.
The RF calculation does not subtract the opaque cold Wi-Fi allowance and is thus
optimistic. Do not lower the allowance without evidence or bypass admission.
The next design decision is a reviewed transport-buffer ownership/burst-capacity
tradeoff or another evidence-backed source of RAM; do not cut Frozen LDC memory.
Phase A remains PASS FOR FIRST-FLASH ONLY. No Phase B.

Remaining original findings untouched: C02, C04, H01, H02, H03, H04, H05, H06,
H07, H09, H11, H12, M01-M06. Existing 2 MiB profile is still M01; physical N4
has 4 MiB. GPIO/GNSS backend/SD/BOOT/LED/PPS remain pending hardware configuration.



