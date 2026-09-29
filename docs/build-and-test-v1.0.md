# Windows Build and Test

## Current Phase 1F three-buffer build — 2026-09-29

The authorized Recorder pool capacity is three 8 KiB buffers. `scripts/test.ps1` passes 32/32 host executables, including the production Recorder/Storage/Transfer 10 Hz saturation, rollover and repeated epoch-abort test. Architecture and metadata gates pass. Each profile was fullcleaned, reconfigured, compiled and linked; generated profile, single-frame stack and H10-S target gates pass. The application partition is 1,572,864 B.

| Profile | BIN bytes | ELF SHA-256 | `.iram0.text` | `.dram0.data` | `.dram0.bss` | Shared SRAM headroom | Partition headroom |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| DEV | 1,104,864 | `2A38704D45AA97306D487CC8AB99C2D2EE4EAC38432A2F4901233BE98CC62EEE` | 96,570 | 14,809 | 203,176 | 6,528 | 468,000 |
| VALIDATION | 1,082,400 | `F37B1EDA59FCF860368675FCE173207D7E74DD7C216D800A4709262B77369ECF` | 96,150 | 14,789 | 203,672 | 6,560 | 490,464 |
| PRODUCTION | 1,081,984 | `6EAA31F47793DCD6438BC4ED49D6027B7977AEBBDA35B17B11A956C32EDF6E9F` | 96,150 | 14,789 | 203,176 | 7,056 | 490,880 |

Matching BIN SHA-256: DEV `FD448EEC3688CBC32CEF59E2B7E5C8C5195B024E20AE75A80642EA7628C948C8`; VALIDATION `4444561D1BE7CEE99708AEFFF447B739573216725B54C6F56D07DC72AD3701D1`; PRODUCTION `24263920BA91BCD2A56080EC1EEB6B833A23395926A3B04625254684CFD0799C`. Fresh rebuild identity after handoff cleanup (2026-09-29): DEV BIN SHA-256 `FD448EEC3688CBC32CEF59E2B7E5C8C5195B024E20AE75A80642EA7628C948C8`; VALIDATION `4444561D1BE7CEE99708AEFFF447B739573216725B54C6F56D07DC72AD3701D1`; PRODUCTION `24263920BA91BCD2A56080EC1EEB6B833A23395926A3B04625254684CFD0799C`. The corresponding ELF and BIN hashes below identify these exact freshly rebuilt files. The host artifact manifest has 32 executable hashes and 60 test-source plus 63 production-source hashes, all matching the current files.

The PRODUCTION BSS reduction from the Phase 1E failing map is 8,264 B: 8,192 B from `s_block_pool`, 56 B from the three-entry rollover descriptor array, and 16 B from smaller pool bookkeeping/alignment. Shared SRAM headroom is linker region space, not runtime free heap. The non-IRAM SPI master ISR requires hardware testing during active SD recording with Wi-Fi NVS save/forget. No hardware was accessed. **PRE-FLASH SOFTWARE GATE: PASS.**

## HISTORICAL SNAPSHOT — earlier board-map / ATGM backend verification and link failures

## Current board-map / ATGM backend verification — 2026-09-29

`scripts/test.ps1` passed with 31/31 host executables. Architecture, metadata reachability, and generated board/profile configuration checks passed. The generated configs contain the confirmed C3 board map and GNSS target (UART1, RX0/TX1, SD SPI2 GPIO4–7, LED8, BOOT9, 115200 baud, 10 Hz, PPS absent).

Fresh builds reconfigured and compiled all profiles, but none linked:

| Profile | Compile | Link | Linker overflow in shared DRAM/IRAM region |
| --- | --- | --- | ---: |
| DEV | PASS | FAIL | 11,568 B |
| VALIDATION | PASS | FAIL | 11,520 B |
| PRODUCTION | PASS | FAIL | 11,024 B |

The current source therefore has no valid final ELF/BIN identity. Existing `build/{profile}/sailball.bin` files and the artifact table in the historical section below come from the preceding Phase C build and are stale for the current board/backend source. Do not flash them. Linked stack/frame and target H10-S gates did not run because the link failed. No hardware was accessed.

## HISTORICAL SNAPSHOT — Phase C completion build, superseded for current sources

Phase A software safety, Phase B software acceptance, and Phase C software completion are PASS. H10-F and hardware validation remain pending. No hardware access occurred.

The Phase C completion run used `scripts/test.ps1`: 30 native host executables passed. The run includes the Phase A/B suite, ownership/architecture and metadata gates, wireless admission budget cases, and four Phase C production-path test executables. The final three firmware profiles were each reconfigured, compiled, linked, and passed the config, stack/frame, and H10-S gates.

| Profile | BIN bytes | ELF SHA-256 | `.dram0.bss` | `.dram0.data` | Factory partition headroom |
| --- | ---: | --- | ---: | ---: | ---: |
| DEV | 987408 | `ECA72E32430CC59ACA907319BE80E31A9C7D851E0247E9E36F9DFEFCA99B740B` | 212984 | 14425 | 585456 B |
| VALIDATION | 966512 | `5BE9093B0C0A87A166470A3AC97DCC947AE4F323A515E0834FFD0A249824DF30` | 213480 | 14425 | 606352 B |
| PRODUCTION | 966096 | `374545B9B44727965BAC1B0324A04BA66477B2E25672504B0E88AB65710243B6` | 212984 | 14425 | 606768 B |

The factory application partition is `0x180000` bytes. Partition headroom is partition size minus BIN size; it says nothing about runtime heap. PRODUCTION `.bss + .data` is 227409 B. Compared with the prior 212968 B `.bss` baseline, it increased 16 B; the GNSS-owner pending live-drop mailbox is 8 B and the map shows adjacent alignment/layout effects. `.data` stayed at 14425 B. No new full-frame scratch or unbounded allocation was added.

The ELF hashes above were recalculated from `build/{dev,validation,production}/sailball.elf`; the BIN lengths were read from the matching profile BINs. Current source changes preceded the final profile links. No repository source changed after those builds; only this and the status/report documents were updated afterward.

## Test evidence

The four Phase C executables call production code:

- `diagnostics_test`: production diagnostics implementation; saturating counters, bounded chronological error ring, legal code/severity, clear semantics, and exhausted error IDs.
- `supervisor_health_test`: production Supervisor progress evaluator; first durable-commit gate, valid NO_FIX activity versus silence, local recovery policy, storage failure, and new-epoch commit recovery.
- `ui_ownership_test`: production UI page request and owner-apply path; bounded latest-wins request and page range.
- `system_ui_snapshot_test`: production System-to-UI snapshot composition, with fake subsystem snapshot providers.

Phase C also extended the production Control test for event schemas/triggers and protocol precedence, the production GNSS fake-UART owner test for diagnostics ownership, and architecture checks for cross-owner metric mutation. Existing Phase A/B tests remained enabled. `build/test-artifact-manifest.json` records 30 passing host executables and their hashes. `scripts/test.ps1` regenerates host artifacts and the manifest; do not treat the manifest as a read-only command.

The M06 integration matrix and exact fake boundaries are in `phase-c-software-completion-report.md`. Tests use production owner logic and replace external dependencies such as UART, filesystem, queues, clocks, socket calls, or subsystem snapshot providers. They do not establish physical SD durability, actual GNSS behavior, runtime scheduling/watermarks, or wireless coexistence.

## Reproducible commands

From PowerShell at the repository root:

```powershell
. .\tools\enter-esp-idf.ps1
.\scripts\test.ps1
.\scripts\build.ps1 -Profile dev
.\scripts\build.ps1 -Profile validation
.\scripts\build.ps1 -Profile production
.\scripts\validate.ps1 -Profile production
```

Each build uses its profile sdkconfig and build directory. The builds recorded above reconfigured each profile before compiling and linking.

## Stack and hardware limits

The eight application task stacks and largest compiler-reported single function frames passed the frame gate. Configured stacks are GNSS 2048 B, Recorder/Storage/Control/Transport 4096 B each, Supervisor/Transfer 2048 B each, and UI 1536 B. Complete nested runtime paths through indirect calls, precompiled SDK code and interrupts are not proven. Runtime high-water marks remain PENDING HARDWARE.

H10-S passed: wireless low-resource DENY occurs before known unsafe SDK calls and failures remain local. H10-F remains PENDING HARDWARE; wireless coexistence, runtime free heap, largest free block and fragmentation are not established. No flash, monitor, serial probe or physical-board test was performed.

The seven Frozen v1.0 documents were unchanged. GNSS remains replaceable behind its backend boundary; ATGM336H-6N74 is the only implemented backend, and u-blox is not implemented.

## Hardware Validation Phase 1B — SPI ISR placement experiment

This experiment changed only `CONFIG_SPI_MASTER_ISR_IN_IRAM` to `n` in the generated DEV, VALIDATION, and PRODUCTION sdkconfigs; the same setting is now recorded in common `sdkconfig.defaults`. All three profiles were fully cleaned, reconfigured, compiled, and linked. Compilation passed; linking still fails in the shared C3 DRAM/IRAM region:

| Profile | `.iram0.text` | `.dram0.data` | `.dram0.bss` | Link overflow |
| --- | ---: | ---: | ---: | ---: |
| DEV | 97,706 B | 14,809 B | 213,488 B | 4,800 B |
| VALIDATION | 96,264 B | 14,789 B | 213,984 B | 5,280 B |
| PRODUCTION | 96,264 B | 14,789 B | 213,488 B | 4,784 B |

Compared with the supplied PRODUCTION failure baseline, `.iram0.text` fell 7,456 B, `.dram0.data` fell 104 B, `.dram0.bss` was unchanged, and linker headroom improved 6,240 B. The direct map object reductions were 3,832 B in `spi_master.c.obj` and 394 B in `spi_bus_lock.c.obj`. No current ELF/BIN was generated; historical artifact rows elsewhere in this document are not valid for the current source/config.

The setting is classified **USEFUL BUT HARDWARE VALIDATION REQUIRED**. IDF v6.1 masks non-IRAM interrupts during cache-off flash operations and restores them afterward; this defers SD SPI ISR completion while a user-triggered Wi-Fi NVS save/forget can overlap recording. The exact card transaction latency and recovery remain unverified on hardware. The host executables already present at experiment time passed 31/31 when run directly. `scripts/test.ps1` was also invoked, passed its static architecture and metadata gates, then stopped because its fresh-test preparation requires the absent current production ELF. The pre-flash software gate remains BLOCKED by the remaining PRODUCTION link overflow and unrun post-link gates. No hardware access was performed.

## Hardware Validation Phase 1C — SPI Slave IRAM experiment

Only the common default `CONFIG_SPI_SLAVE_ISR_IN_IRAM=n` was changed. Fresh PRODUCTION link still fails, with 3,760 B overflow. The saved baseline map has `.iram0.text=97,288 B` (different from the supplied 96,264 B baseline; the map is used for direct comparison); the fresh map has `.iram0.text=96,516 B`, `.dram0.data=14,789 B`, `.dram0.bss=213,488 B`. Shared aligned reservation fell 1,024 B; `spi_common.c.obj` contributed 768 B less IRAM. DEV/VALIDATION were not rerun because PRODUCTION remained over limit. No current ELF/BIN; post-link gates not run. Existing host executables 31/31 PASS; architecture, metadata and profile configuration gates PASS. Pre-flash gate remains BLOCKED; no hardware access.
## Hardware Validation Phase 1D — residual IRAM dependency experiment

Using the saved fresh Phase 1C PRODUCTION map as baseline, the sole configuration edit removed the stale generated `CONFIG_GDMA_CTRL_FUNC_IN_IRAM=y` entry. ESP-IDF v6.1 reconfiguration resolved this default-`n` option to not set; no forced disable was added. `CONFIG_ESP_PERIPH_CTRL_FUNC_IN_IRAM=y` remains due the enabled `ESP_HW_SUPPORT_FUNC_IN_IRAM` selector (and its own `default y`), while `CONFIG_GDMA_ISR_HANDLER_IN_IRAM=y` remains at its IDF `default y`.

| PRODUCTION metric | Phase 1C fresh map | Phase 1D fresh map | Delta |
| --- | ---: | ---: | ---: |
| `.iram0.text` | 96,516 B | 96,150 B | -366 B |
| `.dram0.data` | 14,789 B | 14,789 B | 0 B |
| `.dram0.bss` | 213,488 B | 213,488 B | 0 B |
| `dram0_0_seg` overflow | 3,760 B | 3,248 B | -512 B |

Map symbol accounting shows 132 B less IRAM payload in `esp_driver_dma/libesp_driver_dma.a(gdma.c.obj)` and 226 B less in `esp_hal_dma/libesp_hal_dma.a(gdma_hal_ahb_v1.c.obj)`. The corresponding flash contributions changed by +148 B and +226 B; these are object payload deltas, not a claim that the whole section moved byte-for-byte. Aggregate `.flash.text` rose 342 B. The linker-aligned `.dram0.dummy` reservation dropped from `0x17a00` to `0x17800` (512 B); named DATA/BSS remained unchanged. The `periph_ctrl` IRAM contribution did not change.

Only PRODUCTION was fullcleaned/reconfigured/built, as required while it remained the first failing profile. Compile passed; link failed by 3,248 B. DEV and VALIDATION were not run. All 31 existing host executables passed; architecture and metadata gates passed; generated board/profile configuration checks passed for DEV, VALIDATION and PRODUCTION. Current target post-link gates are unavailable because no valid PRODUCTION ELF/BIN exists. PRE-FLASH SOFTWARE GATE remains BLOCKED. No hardware access occurred.

## Hardware Validation Phase 1E — USB scratch ownership result

The Phase 1D map sizes were `s_out=2,092 B`, `s_payload=2,048 B`, `s_decoded_scratch=2,096 B`, and `s_encoded=2,092 B`. A source-lifetime review justified removing only `s_payload`: RX data is copied into Control's request queue during submit, and BLE/Wi-Fi TX queue APIs copy candidate payloads before return. COBS continues to use distinct candidate input and `s_out` output. Partial USB RX accumulation and partial USB TX output can coexist across task polls, so their buffers were not overlaid.

After fresh PRODUCTION reconfigure/build, compile passed and link failed with 1,200 B `dram0_0_seg` overflow. The fresh map reports `.iram0.text=96,150 B`, `.dram0.data=14,789 B`, `.dram0.bss=211,440 B`; BSS and link deficit each improved by 2,048 B from Phase 1D. Focused Control payload-copy and current-production-Transport congestion/Storage tests passed, as did architecture and metadata gates. DEV/VALIDATION and full `scripts/test.ps1` were not run because PRODUCTION still fails and no valid current ELF exists. No target post-link gates, current artifact identities, or hardware tests are available. PRE-FLASH SOFTWARE GATE remains BLOCKED; next work requires a separate memory-design decision because no safe scratch overlay was found for the remaining 1,200 B.
