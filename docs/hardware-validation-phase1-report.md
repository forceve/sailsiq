# Sailball v1.0 Hardware Validation Phase 1 — Pre-Flash Status

Updated: 2026-09-29

## Current Phase 1F pre-flash software gate

**PRE-FLASH SOFTWARE GATE: PASS. HARDWARE VALIDATION: PENDING.** The authorized three-buffer Recorder architecture was tested at 10 Hz through saturation, clean rollover, repeated epoch abort and STOP. Full host regression passes 32/32; fresh DEV, VALIDATION and PRODUCTION images link, fit the partition, and pass config, stack/frame and H10-S gates. The final artifacts and SRAM headroom are recorded in `build-and-test-v1.0.md`. No flash, monitor, serial probe or physical board access was performed.

`CONFIG_SPI_MASTER_ISR_IN_IRAM=n` remains a hardware validation risk: test active SD recording while Wi-Fi profile NVS save/forget disables cache. The smaller pool removes one block of backlog elasticity, so record commit latency, pool occupancy and explicit Recorder loss during that test. H10-F remains pending hardware.

The following original first-attempt status and Phase 1A–1E measurements are **HISTORICAL SNAPSHOTS**, superseded by this current Phase 1F software result. Their old failure and four-buffer statements describe the earlier artifacts.

## 1. Verdict

**PRE-FLASH GATE: BLOCKED. DO NOT FLASH.** The board map and generated profiles are configured, and the host regression passes. All three current profile builds compile but fail at final link because the ESP32-C3 shared DRAM/IRAM region overflows. No current-source ELF or BIN identity was produced. No hardware was accessed.

## 2. Board map

| Function | Board configuration |
| --- | --- |
| MCU | ESP32-C3-WROOM-02-N4; 4 MiB flash; no PSRAM |
| GNSS | ATGM336H-6N74 on UART1; ATGM TX → ESP RX GPIO0; ESP TX GPIO1 → ATGM RX |
| GNSS runtime target | 115200 baud, 10 Hz; boot/default rate is selected by the ATGM backend |
| PPS | Not present; no pin, state, ISR or acceptance requirement |
| SD/TF | SPI2; CS4, MOSI5, SCLK6, MISO7 |
| LED | GPIO8, external pull-up; boot-strap behavior is preserved |
| BOOT | GPIO9, external pull-up, active-low button to GND |
| USB | Native USB Serial/JTAG GPIO18/19, reserved for binary SP transport |
| Optional control nets | GNSS enable/reset, SD detect and SD power: none configured |

The physical board/assembly revision identifier has not been supplied. The mapping is user-confirmed and has not been electrically probed.

## 3. Software changes and evidence

Board data now exposes physical UART, SPI, LED, BOOT and USB mapping; board code uses named IDF UART/SPI host constants. Storage and UI consume the board snapshot rather than `-1` pin placeholders. Profile defaults use the confirmed GPIO map and GNSS runtime target.

The vendor-neutral GNSS configuration carries runtime baud and update rate. The ATGM336H-6N74 backend owns its boot baud, configuration commands, bounded retries, baud transition, parser reset where required, and post-transition NMEA/cadence verification. It requests RMC/GGA/GSA and does not persist settings to module flash on every boot. GNSS configuration failure is bounded and local; it does not reset the MCU. The host fake-UART tests drive the production GNSS owner/backend path.

The manufacturer manual identifies the 6N-74 default UART baud as 115200 and lists 10 Hz maximum update rate. PCAS command behavior is based on the CASIC protocol specification. References are listed in `atgm336h-backend-v1.md`. These sources do not replace hardware verification of this board/module assembly.

## 4. Software gates

| Gate | Result |
| --- | --- |
| `scripts/test.ps1` | PASS, 31/31 host executables |
| Architecture gate | PASS; eight app-task architecture and GNSS/no-PPS boundary checks |
| Metadata reachability gate | PASS |
| Generated config: DEV | PASS |
| Generated config: VALIDATION | PASS |
| Generated config: PRODUCTION | PASS |
| Linked stack/frame gate | NOT RUN TO COMPLETION; current ELF is absent |
| Target H10-S artifact gates | NOT RUN; current profile ELFs are absent |
| Frozen v1.0 documents | 7/7 hashes match the Phase C recorded values |

The host suite and static checks do not establish runtime heap, stack watermarks, electrical pin behavior, actual ATGM response or SD durability.

## 5. Fresh-build result

All three profiles were freshly reconfigured and compiled. Final linking failed in `.dram0.bss` / `dram0_0_seg`:

| Profile | Link result | Reported overflow |
| --- | --- | ---: |
| DEV | FAIL | 11,568 B |
| VALIDATION | FAIL | 11,520 B |
| PRODUCTION | FAIL | 11,024 B |

The failed current PRODUCTION map reports `.iram0.text` size `0x19528`, `.dram0.data` size `0x3a2d`, and `.dram0.bss` size `0x341f0`; because the image does not link, these are map estimates, not accepted final ELF memory identities. The linker failure is a static region-capacity issue, not factory-partition BIN headroom.

The failed maps report the following profile sections (all diagnostics only):

| Profile | `.iram0.text` | `.dram0.data` | `.dram0.bss` | `.flash.rodata` | `.flash.text` |
| --- | ---: | ---: | ---: | ---: | ---: |
| DEV | `0x196cc` | `0x3a41` | `0x341f0` | `0x264f8` | `0xca21e` |
| VALIDATION | `0x19528` | `0x3a2d` | `0x343e0` | `0x22278` | `0xc8e8c` |
| PRODUCTION | `0x19528` | `0x3a2d` | `0x341f0` | `0x22278` | `0xc8cee` |

Old `build/{profile}/sailball.bin` files remain on disk (DEV 987,408 B; VALIDATION 966,512 B; PRODUCTION 966,096 B), but they belong to the previous Phase C build and are stale for the current board/backend sources. Their historical ELF hashes are retained in `build-and-test-v1.0.md`; they must not be used for flashing. There is no valid current ELF SHA-256, BIN hash, or partition-headroom result.

## 6. Hardware boundary

No flash, monitor, serial probe, or physical-board action was performed. No boot, heap, task high-water, ATGM baud transition, NMEA cadence, SD mount, LDC commit, USB/BLE/Wi-Fi physical path, Supervisor runtime health, LED/button, or reset behavior has been observed.

## 7. Required next step

Resolve the profile link overflow without weakening Frozen semantics, wireless DENY safety, the 4 × 8 KiB LDC pool, metadata snapshot, Fix Queue depth, or eight-task architecture. Then rerun the full regression and all post-link gates, freshly build/link all three profiles, and reconcile source/config/artifact hashes. Only after a valid current VALIDATION artifact exists may the pre-flash record and first-flash gate be completed.

H10-S remains FIXED on software evidence. H10-F remains PENDING HARDWARE. Phase A/B/C software status is unchanged; Hardware Validation Phase 1 remains IN PROGRESS and BLOCKED before flash.

## 8. Phase 1A linker diagnosis

The precise overflowing linker region is `dram0_0_seg`, origin `0x3fc80000`, length `0x4e710` (321,296 B). ESP-IDF v6.1's ESP32-C3 `memory.ld` defines `iram0_0_seg` at `0x40380000` with the same length and sets `_iram_dram_shared = 1`; these are two access aliases of the same physical SRAM. The failure is therefore the shared IRAM/DRAM boundary, reported while placing `.dram0.bss`, not an independent DRAM-only pool shortage or flash partition overflow.

The historical successful Phase C map was overwritten by fresh reconfiguration. The section sizes recorded from that map and the current failing map are:

| Section | Phase C successful map | Current failed map | Delta |
| --- | ---: | ---: | ---: |
| `.iram0.text` | `0x16b2a` (92,970 B) | `0x19528` (103,720 B) | +10,750 B |
| `.dram0.data` | 14,425 B | 14,893 B | +468 B |
| `.dram0.bss` | 212,984 B | 213,488 B | +504 B |
| `.flash.rodata` | historical map unavailable | `0x22278` | unavailable |
| `.flash.text` | historical map unavailable | `0xc8cee` | unavailable |

The current failed map's `.iram0.text + .dram0.data + .dram0.bss` sum is 332,101 B. Linker placement, other shared sections and alignment bring used space to 332,320 B, 11,024 B over the 321,296 B region in PRODUCTION. Current failed-map figures are diagnostics only, not accepted final memory or artifact measurements.

The largest current `.iram0.text` input objects include BT controller `lld_con.o` 6,558 B, `lld_adv.o` 5,418 B, SPI master `spi_master.c.obj` 3,832 B, BT controller `lld_scan.o` 3,788 B, Wi-Fi `pp.o` 3,172 B, Wi-Fi `ieee80211_output.o` 1,914 B, Wi-Fi `lmac.o` 1,818 B, PHY `phy_reg.o` 1,670 B, BT `sch_prog.o` 1,588 B, and `spi_bus_lock.c.obj` 1,230 B. SPI common adds 768 B. These current input sizes identify contributors; without the old map object breakdown they do not prove each object's exact historical delta.

Configuration-induced path activation is confirmed: board configuration now enables the actual SD SPI2 path, and the production map has Storage referencing `esp_vfs_fat_sdspi_mount`, which pulls the SPI master, SPI bus lock and GPSPI/HAL path. The current map attributes 3,832 B to the SPI master object, 1,230 B to SPI bus-lock code and 768 B to SPI-common IRAM input, before additional HAL/GDMA support. The configured IRAM options include `SPI_MASTER_ISR_IN_IRAM=y`, `ESP_SPI_BUS_LOCK_ISR_FUNCS_IN_IRAM=y`, Wi-Fi IRAM/RX optimization enabled, UART ISR in IRAM disabled, FreeRTOS-in-IRAM disabled, and RMT TX/RX handler plus encoder IRAM options enabled. The user-space board/GNSS sources add no `IRAM_ATTR`, `DRAM_ATTR`, `RTC_IRAM_ATTR` or `ESP_INTR_FLAG_IRAM` annotations.

The board GPIO change also activates the UI RMT LED path in production. RMT copy-encoder IRAM input is about 138 B in the current map. GNSS code and ATGM command strings are in flash/rodata; mutable command formatting uses bounded local arrays. ATGM state adds a 240 B parser and 16 B IO context in BSS. The UART driver's RX ring is 2,048 B allocated at runtime, while the task reads into a 256 B local buffer; these are bounded and do not duplicate a full-frame backing. Host fixtures and test executables are not linked into the target image.

Top current BSS inputs include the 32,768 B Recorder LDC pool, Recorder sample ring 6,400 B, four 4,096 B task stacks (Transport, Storage, Recorder, Control), three 2,048 B stacks (GNSS, Transfer, Supervisor), UI stack 1,536 B, four USB transport arrays around 2,048–2,096 B each, diagnostics error ring 1,792 B, GNSS fix queue 2,304 B and GNSS input queue 576 B. These remain unchanged. The current `.dram0.data` has 14,893 B total; its largest named map inputs include Wi-Fi `pp.o` 1,153 B, flash API 238 B, BT `rwble.o` 147 B, Wi-Fi `esf_buf.o` 144 B and `wdev.o` 136 B.

No source/config reduction was applied during Phase 1A diagnosis: the ATGM constants already reside in flash strings, target map contains no host test implementation, and new GNSS/board code has no unjustified IRAM attributes. Three next candidates require separate validation before any change: (1) quantify whether SPI master ISR code can safely execute from flash during cache-disabled operations; this has the highest likely yield but could stall SD transfers during flash writes, so it must not be toggled blindly; (2) confirm the physical LED device/protocol, then consider a GPIO implementation only if it is truly a simple single-color LED; this could affect Frozen UI colors and saves far less than the current deficit; (3) quantify a bounded Transport scratch/ownership redesign against the existing accepted queues, without changing queue credits or implementing the deferred 10-slot pool in this step. No headroom threshold is invented; every profile must link and its actual remaining margin must be reported.

## 9. Phase 1B SPI master ISR placement experiment

The exact ESP-IDF v6.1 option is `CONFIG_SPI_MASTER_ISR_IN_IRAM` (`components/esp_driver_spi/Kconfig`, default `y`, depends on `!HEAP_PLACE_FUNCTION_INTO_FLASH`). Its help says it places the SPI master ISR in IRAM to avoid cache misses and permits `ESP_INTR_FLAG_IRAM` when the driver must remain enabled during flash writes. With the option disabled, the master ISR and functions marked `SPI_MASTER_ISR_ATTR` are placed in flash. The related `SPI_MASTER_IN_IRAM` option is separate, defaults off, and is not enabled. The experiment changed only the master ISR placement option; the SPI slave ISR, Wi-Fi/BLE, queues, stacks, RMT, SPI host/pins and SD settings were left as generated.

Each profile was fully cleaned, reconfigured, compiled and linked with `CONFIG_SPI_MASTER_ISR_IN_IRAM=n`. The map confirms the same shared C3 `dram0_0_seg` limit of `0x4e710` bytes. All three builds still fail at link:

| Profile | `.iram0.text` | `.dram0.data` | `.dram0.bss` | Linker overflow | Improvement from supplied baseline |
| --- | ---: | ---: | ---: | ---: | ---: |
| DEV | 97,706 B | 14,809 B | 213,488 B | 4,800 B | 6,768 B |
| VALIDATION | 96,264 B | 14,789 B | 213,984 B | 5,280 B | 6,240 B |
| PRODUCTION | 96,264 B | 14,789 B | 213,488 B | 4,784 B | 6,240 B |

For PRODUCTION, `.iram0.text` changed from 103,720 B to 96,264 B (−7,456 B), `.dram0.data` from 14,893 B to 14,789 B (−104 B), and `.dram0.bss` remained 213,488 B. The useful linker headroom gain is 6,240 B; the remaining deficit is 4,784 B. No current profile ELF or BIN was produced, so no final artifact identity, positive headroom, stack gate or target-ELF H10-S gate exists. The fullclean removed the previously stale profile BINs.

Object map comparison for PRODUCTION attributes 3,832 B removed from IRAM to `esp_driver_spi/libesp_driver_spi.a(spi_master.c.obj)` and 394 B removed from `esp_hw_support/libesp_hw_support.a(spi_bus_lock.c.obj)` (1,230 B → 836 B). Smaller mapped differences total 32 B. The overall `.iram0.text` extent shrank 7,456 B; linker shared-region placement and alignment mean this extent delta is not equal to the usable DRAM headroom delta. HAL/GDMA helper placement remains, as `SPI_SLAVE_ISR_IN_IRAM=y` and its generated GDMA/peripheral dependencies remain enabled. No DRAM pool, USB buffer, task stack, wireless IRAM setting or source behavior was changed.

The storage path is `Storage owner → spi_bus_initialize(SPI2) → esp_vfs_fat_sdspi_mount → SDSPI host → SPI master`; GPIO4/5/6/7 remain CS/MOSI/SCLK/MISO. `spi_bus_config_t.intr_flags` is omitted from a zero-initialized struct, so the effective flags are zero. IDF's `spi_master.c` passes those flags (plus `ESP_INTR_FLAG_INTRDISABLED` during setup) to `esp_intr_alloc`; no Sailball or SDSPI path requests `ESP_INTR_FLAG_IRAM`. SDSPI's device config leaves SPI pre/post callbacks null. This option change does not change transaction queues, DMA descriptor ownership, transfer buffers, or the fixed C3 no-PSRAM configuration.

The local IDF `esp_intr_alloc.h` defines `ESP_INTR_FLAG_IRAM` as allowing an ISR to run with cache disabled. The flash guard calls `esp_intr_noniram_disable()` before cache-off operations and later restores the saved non-IRAM interrupt mask; that code masks the CPU interrupt, not the SPI transaction or DMA. The SPI peripheral continues the transaction and retains its interrupt status; because the master ISR is not IRAM, completion handling is deferred until cache restoration and interrupt re-enable. `spi_device_transmit()` waits for `spi_device_get_trans_result()` with `portMAX_DELAY`, so it has no local finite result-wait bound; progress depends on the flash operation ending and the pending SPI interrupt being serviced. This is a bounded pause for an ordinary completed flash command under the IDF flash driver's command timeout, not a statically verified bound for the actual board flash/card combination. `SPI_FLASH_ERASE_YIELD_DURING_ERASE=y`, `SPI_FLASH_ERASE_YIELD_DURATION_MS=20`, and `SPI_FLASH_ERASE_YIELD_TICKS=1` yield between erase commands; IDF's Kconfig expressly requires checking the flash datasheet to avoid watchdog timeouts. They do not cap one erase command's cache-off interval.

Current internal-flash write paths found in Sailball are: (1) `nvs_flash_init()` in `sb_system_start()` before Storage starts; recovery may write/erase NVS at boot but cannot overlap an SD transaction at that point; (2) Wi-Fi saved-profile `nvs_set_blob()+nvs_commit()` and `nvs_erase_key()+nvs_commit()` in Control's synchronous SET_CONFIG/FORGET handling, only while Wi-Fi is off. These are user initiated and uncommon, and can overlap recording/SD work. Wi-Fi driver storage is explicitly `WIFI_STORAGE_RAM`, so normal Wi-Fi config changes do not add driver persistence writes. No production OTA, direct partition write/erase, or flash coredump path was found; coredump-to-flash is disabled. The configured Task WDT timeout is 10 s and the Storage commit grace is 30 s; these values do not by themselves prove SD card command behavior during a flash operation.

**Decision: B — USEFUL BUT HARDWARE VALIDATION REQUIRED.** The experiment recovers 6,240 B of shared linker headroom in the limiting profiles, and the v6.1 driver/interrupt contract supports a non-IRAM master ISR when the bus does not request `ESP_INTR_FLAG_IRAM`. Keep this single option disabled in the common defaults and all three profile sdkconfigs as a candidate setting. Before pre-flash acceptance, Phase 1 hardware validation must overlap NVS profile write/erase with active SD recording and verify transaction completion, SD/FatFS timeouts, commit latency, Storage recovery counters, and watchdog behavior. The option does not close linking: PRODUCTION still overflows by 4,784 B, so PRE-FLASH SOFTWARE GATE remains BLOCKED. No second memory optimization was started and no hardware access was performed.

## Hardware Validation Phase 1C — unused SPI slave ISR placement

Production source and link-map review found no Sailball SPI-slave API calls, slave driver objects, or slave symbols. `sailball_storage` uses the SPI2 master path: `spi_bus_initialize()` followed by SDSPI/FatFS mount. SPI slave is unused in Sailball v1.0. The IDF component graph compiles the generic SPI driver archive, but the failed-link map contains no selected `spi_slave.c.obj`, `spi_slave_hd.c.obj`, or SPI-slave symbols; linker-script wildcard patterns are not linked-code evidence.

Only `CONFIG_SPI_SLAVE_ISR_IN_IRAM=n` was added to common `sdkconfig.defaults`; Kconfig-derived values were not hand-edited. A fullclean, reconfigure, compile, and link was performed for PRODUCTION. The saved pre-experiment Phase 1B map reports `.iram0.text=0x17c08` (97,288 B), `.dram0.data=14,789 B`, `.dram0.bss=213,488 B`, and overflow 4,784 B. This differs from the supplied Phase 1B `.iram0.text` value of 96,264 B, while the other reported figures agree; use the saved map for this experiment's section delta and retain the discrepancy as an artifact-recording issue.

The fresh Phase 1C PRODUCTION failed map reports `.iram0.text=0x17904` (96,516 B), `.dram0.data=0x39c5` (14,789 B), `.dram0.bss=0x341f0` (213,488 B), and `dram0_0_seg` overflow 3,760 B. Against the saved Phase 1B map, IRAM fell 772 B, DATA/BSS were unchanged, and the aligned `.dram0.dummy` shared-region reservation fell from `0x17e00` to `0x17a00`, recovering 1,024 B of linker capacity. Map object accounting attributes 768 B of IRAM removal to `esp_driver_spi/libesp_driver_spi.a(spi_common.c.obj)`; two unrelated map shifts contribute 2 B each. `.flash.text` increased by 762 B as shared SPI helpers returned to flash. No SPI master/SDSPI runtime configuration changed.

IDF v6.1 `components/esp_driver_spi/Kconfig` defines `SPI_SLAVE_ISR_IN_IRAM` with default `y`; it selects `ESP_PERIPH_CTRL_FUNC_IN_IRAM`, `GDMA_CTRL_FUNC_IN_IRAM`, and `GDMA_ISR_HANDLER_IN_IRAM` (the latter two only on GDMA SoCs). These options remained enabled after reconfiguration and were not manually disabled. The setting also controls the shared `SPI_COMMON_ISR_ATTR` conditional in `spi_common.c`, which covers `spicommon_dma_desc_setup_link`, `spicommon_dma_setup_priv_buffer`, `spicommon_dma_rx_mb`, and bus/DMA-workaround helpers. With master and slave ISR placement both disabled, those selected shared helpers return to flash. SPI master remains selected for SD.

PRODUCTION did not link, so the Phase 1C stop condition applies. DEV and VALIDATION were not reconfigured or rebuilt; their last measured Phase 1B overflows (4,800 B DEV; 5,280 B VALIDATION) are historical and are not Phase 1C measurements. No current PRODUCTION ELF/BIN exists; stack/frame and target-ELF H10-S post-link gates were therefore not run. All 31 existing host executables passed; architecture, metadata, and all three generated board/profile configuration checks passed. Seven Frozen files were not modified; no hardware access occurred. PRE-FLASH SOFTWARE GATE remains BLOCKED by the 3,760 B PRODUCTION link deficit. Stop SPI-placement optimization here; the next isolated candidate is the bounded USB transport scratch ownership review.

Implementation detail for the configuration review: IDF's `SPI_COMMON_MALLOC_CAPS` also switches from `MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT` to `MALLOC_CAP_DEFAULT` when both master and slave ISR placement are disabled. The fixed ESP32-C3-WROOM-02-N4 profile has `CONFIG_SPIRAM` disabled, so the default allocator has no PSRAM pool to select; SPI DMA transaction buffers still use the driver's separate `MALLOC_CAP_DMA | MALLOC_CAP_INTERNAL` allocation path. This is the IDF-defined companion behavior of the placement option, not an application change. The failed link prevents post-link/runtime confirmation.
## Hardware Validation Phase 1D — Residual GDMA / peripheral IRAM dependency closure

### Kconfig and runtime use

The fresh Phase 1C PRODUCTION map (`.iram0.text=96,516 B`, `.dram0.data=14,789 B`, `.dram0.bss=213,488 B`, overflow 3,760 B) is the authoritative baseline. IDF v6.1 defines `GDMA_CTRL_FUNC_IN_IRAM` in `components/esp_driver_dma/Kconfig` with `default n` and selection of `GDMA_OBJ_DRAM_SAFE`. SPI master/slave ISR Kconfig selects it on GDMA SoCs; both SPI ISR options are now `n`. The generated PRODUCTION `y` was stale and not present in profile defaults. Removing that saved value and fully reconfiguring made Kconfig resolve it to `n`.

`GDMA_ISR_HANDLER_IN_IRAM` has `default y` and selects `GDMA_OBJ_DRAM_SAFE`; it remains enabled without a forced override. `ESP_PERIPH_CTRL_FUNC_IN_IRAM` also has `default y`; the enabled `ESP_HW_SUPPORT_FUNC_IN_IRAM` selects it. Its active peripheral-control users include the SPI master and board LED peripheral setup. SPI Slave API calls and linked SPI Slave objects are absent. Storage initializes SPI2 using `spi_bus_initialize(..., SPI_DMA_CH_AUTO)` and SDSPI/FatFS, so the SD path is an actual SPI-master GDMA consumer. The UI configures RMT without setting `flags.with_dma`, so no active UI RMT-DMA path was established. UART ISR IRAM and UHCI cache-safe/IRAM options are disabled; I2S ISR IRAM safety, ADC continuous ISR IRAM safety, camera/parallel-I/O and other unsupported ESP32-C3 selectors are not enabled. Wi-Fi/Bluetooth placement settings were not changed.

The IDF Kconfig help describes GDMA control placement as needed for IRAM callers, while GDMA ISR placement is retained by the IDF default for reduced cache-miss latency. This experiment only establishes link-map movement; it does not prove runtime behavior through flash-cache-disabled windows. The Phase 1B hardware requirement remains: overlap active SD recording with NVS profile save and erase/forget, then observe SD/FatFS completion, commit latency, recovery and watchdog behavior before pre-flash acceptance.

### Isolated measurement

Only the stale generated `CONFIG_GDMA_CTRL_FUNC_IN_IRAM=y` was removed. No `n` override was added and no USB, queue, stack, Recorder, SPI-master ISR, Wi-Fi or BLE setting was touched.

| PRODUCTION metric | Phase 1C fresh map | Phase 1D fresh map | Delta |
| --- | ---: | ---: | ---: |
| `.iram0.text` | 96,516 B | 96,150 B | -366 B |
| `.dram0.data` | 14,789 B | 14,789 B | 0 B |
| `.dram0.bss` | 213,488 B | 213,488 B | 0 B |
| linker overflow | 3,760 B | 3,248 B | -512 B |

The current map's `.dram0.dummy` is `0x17800`; the baseline was `0x17a00`, recovering 512 B of shared linker capacity through alignment. Named map payload left IRAM in `gdma.c.obj` (132 B) and `gdma_hal_ahb_v1.c.obj` (226 B); their `.flash.text` payload deltas were +148 B and +226 B. Aggregate `.flash.text` increased 342 B. `periph_ctrl.c.obj` placement, DATA, and BSS did not change. The exact fresh linker diagnostic remains `region 'dram0_0_seg' overflowed by 3248 bytes`.

The 31 existing host executables passed. Architecture, metadata reachability, and generated profile/board configuration gates passed. DEV/VALIDATION were not rebuilt because the required PRODUCTION-first stop condition applies while the link still fails. Target post-link stack, H10-S ELF, partition-fit and artifact identity gates could not run because no valid current ELF/BIN exists. Seven Frozen hashes match their prior values. PRE-FLASH SOFTWARE GATE remains BLOCKED; result is **USEFUL BUT STILL SHORT**, and the next phase is the separately scoped USB scratch-ownership review. No flash, monitor, serial probe or physical-board access occurred.

## Hardware Validation Phase 1E — USB scratch ownership review

The authoritative Phase 1D PRODUCTION map had `.iram0.text=96,150 B`, `.dram0.data=14,789 B`, `.dram0.bss=213,488 B`, and a `dram0_0_seg` overflow of 3,248 B. Map symbols in `transport_task.c.obj` gave exact scratch sizes: `s_out` 2,092 B (`0x82c`), `s_payload` 2,048 B (`0x800`), `s_decoded_scratch` 2,096 B (`0x830`, union of the decoded frame and Control candidate), and `s_encoded` 2,092 B (`0x82c`). The map located each in BSS. These are mutable Transport-task-owned buffers; no ISR or driver callback accesses them.

| Buffer | Producer / first write | Consumer / last read | Lifetime and reuse condition |
| --- | --- | --- | --- |
| `s_encoded` | USB bytes are accumulated by `transport_task` across polls until delimiter | COBS decoder reads the complete encoded frame | Must survive poll/task yields while a partial frame is pending; cannot share with pending TX output. |
| `s_decoded_scratch.decoded` | USB COBS decode, or BLE/Wi-Fi receive API copies into it | SP decode and synchronous `sb_control_submit_for_generation` | Control copies payload into its bounded request queue before submit returns; decoded bytes can then be reused. It shares storage with the candidate member only because each receive is submitted before that member is used. |
| `s_decoded_scratch.candidate` | Control peek copies a candidate and payload into this union member | USB COBS encode, or BLE/Wi-Fi queue submission | USB encoding reads it synchronously into distinct `s_out`; BLE/Wi-Fi `*_queue_tx` copy frame payload into adapter queues before return. It is not retained after commit/queue handoff. |
| `s_out` | Production COBS encoder writes a complete TX frame | USB send path reads bounded portions across polls | Must remain intact while a partial TX frame is pending. IDF USB Serial/JTAG `usb_serial_jtag_write_bytes` copies each submitted chunk into its TX ring buffer (`xRingbufferSend`) before return, but this does not release the remainder still owned by Transport. |

USB RX and TX are serviced on the same task, but their object lifetimes can overlap across poll boundaries: `s_encoded` may hold a partial incoming frame while `s_out` retains a partial outgoing frame. Also, while `s_out` holds a partial TX frame, the next poll can decode and submit another RX frame using `s_decoded_scratch`. Therefore no RX/TX union was safe. The COBS encoder's documented input/output contract requires non-overlap; `candidate.payload` remains the distinct immutable input while `s_out` is generated. No in-place COBS path was introduced.

The smallest safe change removed the redundant 2,048 B `s_payload`. BLE/Wi-Fi receive now copies directly into the decoded member; each frame is submitted to Control synchronously, which copies the request before the scratch can be reused. USB TX now passes `candidate.payload` directly to the synchronous COBS encoder. BLE/Wi-Fi TX pass it to adapter queue functions that synchronously copy the payload. `s_out` remains separate from COBS input. A Control host regression now mutates the source payload after submit and asserts the queued request retains its original byte.

Fresh PRODUCTION reconfigure/build compiled the updated Transport and failed link with `dram0_0_seg overflowed by 1,200 bytes`. The map reports `.iram0.text=96,150 B`, `.dram0.data=14,789 B`, `.dram0.bss=211,440 B`; `s_payload` is absent and the other three scratch symbols retain their prior sizes. Thus named BSS fell exactly 2,048 B and the link deficit improved by 2,048 B, from 3,248 B to 1,200 B. DEV and VALIDATION were not built because PRODUCTION remains unlinked. No further overlay or frame-capacity reduction was justified by the lifetime analysis.

The focused production Control session test passed, including the source-buffer reuse assertion. The congestion/Storage integration executable was freshly compiled with the current production `transport_task.c` and passed. Architecture and metadata gates passed. The full `scripts/test.ps1` suite and post-link ELF gates were not run because there is no current valid PRODUCTION ELF; no current profile ELF/BIN identity can be reported. Frozen files, board/backend settings, SPI placement, task stacks, queue depths, Recorder pool, BLE/Wi-Fi buffers, and wire formats were unchanged. PRE-FLASH SOFTWARE GATE remains BLOCKED by the 1,200 B PRODUCTION linker overflow. No hardware access occurred.
