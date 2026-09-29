# Sailball Firmware v1.0 — Implementation Status

Updated: 2026-09-29. Target: ESP32-C3-WROOM-02-N4, 4 MiB flash, no PSRAM, ESP-IDF v6.1.

Phase A software safety, Phase B software acceptance, and Phase C software completion remain PASS. The authorized Recorder capacity revision changes the static pool from four to three 8 KiB buffers. The affected Phase B Recorder/Storage subset has been revalidated at 10 Hz; earlier four-buffer acceptance is historical. Hardware Validation Phase 1 remains IN PROGRESS. **PRE-FLASH SOFTWARE GATE: PASS; hardware validation: PENDING.** Fresh DEV, VALIDATION, and PRODUCTION builds link with the confirmed board map and ATGM336H-6N74 backend. `scripts/test.ps1` passes 32/32 host executables. No hardware was accessed.

H10-S remains FIXED. H10-F remains PENDING HARDWARE: wireless coexistence, runtime heap fragmentation/largest block, and hardware stack watermarks are not proven. No hardware was accessed.

## Current fresh artifact identities (2026-09-29)

These are the artifacts produced by the final fullclean three-profile rebuild for this handoff. BIN sizes and linker memory metrics match the accepted baseline; hashes changed on fresh rebuild and supersede previously recorded artifact hashes.

| Profile | BIN bytes | ELF SHA-256 | BIN SHA-256 |
| --- | ---: | --- | --- |
| DEV | 1,104,864 | `2A38704D45AA97306D487CC8AB99C2D2EE4EAC38432A2F4901233BE98CC62EEE` | `FD448EEC3688CBC32CEF59E2B7E5C8C5195B024E20AE75A80642EA7628C948C8` |
| VALIDATION | 1,082,400 | `F37B1EDA59FCF860368675FCE173207D7E74DD7C216D800A4709262B77369ECF` | `4444561D1BE7CEE99708AEFFF447B739573216725B54C6F56D07DC72AD3701D1` |
| PRODUCTION | 1,081,984 | `6EAA31F47793DCD6438BC4ED49D6027B7977AEBBDA35B17B11A956C32EDF6E9F` | `24263920BA91BCD2A56080EC1EEB6B833A23395926A3B04625254684CFD0799C` |

## Current readiness

- BUILD READY: YES for the three current software profiles; hardware behavior is not validated.
- PHASE A SOFTWARE SAFETY GATE: PASS. C01, C03, H08 and H10-S remain closed.
- PHASE B SOFTWARE ACCEPTANCE: PASS, carried forward after targeted 10 Hz Recorder/Storage revalidation for the authorized 3 × 8 KiB pool revision.
- PHASE C SOFTWARE COMPLETION: PASS. H07, H09, M02, M03, M04, M05 and M06 are closed on software evidence.
- H10-S: FIXED. Low-resource denial happens before known unsafe SDK entry points; returned BLE/Wi-Fi errors remain local and nonfatal.
- H10-F: PENDING HARDWARE. BLE/Wi-Fi private persistence, runtime fragmentation, largest-block behavior and coexistence have not been hardware measured. Do not claim coexistence verified.
- FULL PHASE A RUNTIME ACCEPTANCE: PENDING HARDWARE VALIDATION.
- HARDWARE VALIDATION PHASE 1: IN PROGRESS, pre-flash software gate PASS. No flash, monitor, serial-device probing or physical-board test was performed.
- HARDWARE TESTED: NO. LAB READY, FIELD READY and RELEASE READY: NO.

The Phase A amendment separates software safety from normal wireless reachability. H10-F remains pending hardware evidence.

## Phase A traceability

| Finding | Current status | Evidence |
| --- | --- | --- |
| C01 | FIXED | Stack/frame gate covers all eight application tasks; current known frames are below their allocated stacks. |
| C03 | FIXED | RPC completion uses notification index 1 and control wake index 0; Transfer waits for actual completion before borrowed output lifetimes end. |
| H08 | FIXED | All profiles disable app/secondary console output, bootloader text and printed panic output on the shared USB Serial/JTAG SP stream. |
| H10-S | FIXED | Admission denial prevents unsafe SDK entry; wireless failures do not stop critical tasks. |
| H10-F | PENDING | BLE-alone model is reachable; BLE plus Wi-Fi coexistence and runtime heap margins are not established. |

## Phase B finding status

| Finding | Status | Current evidence / remaining acceptance |
| --- | --- | --- |
| C02 | FIXED | Fake socket drives production Wi-Fi COBS RX/TX adapter, including fragmented/multiple frames, malformed input, FIN with data and partial/nonblocking output. |
| C04 | FIXED | Production Recorder→LDC generated blocks at 1/3/4/10 Hz pass cross-block interval, slot, presence, transition and duration assertions. |
| H01 | FIXED | Recommended GNSS profile is durably published, reloaded and validated by host test. |
| H02 | FIXED | Fake UART drives the production GNSS/ATGM owner, normalized Fix Queue and Recorder through the parser edge matrix, including no-fix, silence, malformed data recovery, queue drop and sequence gap. Hardware ATGM validation remains pending. |
| H03 | FIXED | Production Recorder, Storage and Transfer pass active/pending READ and sync-failure epoch abort tests. The authorized three-buffer revision adds saturated abort and repeated recovery accounting. |
| H04 | FIXED | Static reachability gate proves the current per-file maximum is 7/64 catalog entries and 7/256 definitions; availability transitions do not publish metadata. Production size rollover, known no-space and uncertain-I/O identity paths pass. Metadata-capacity rollover is not applicable to the current v1 production profile. |
| H05 | FIXED | One harness drives production Control+Transport+Recorder+Storage and current production BLE queue/notify plus Wi-Fi queue/COBS/send function bodies; fake physical notify/socket stalls, zero progress and partial recovery coexist with multiple durable LDC commits. Control session regression confirms stale deferred cleanup cannot remove a newer session's terminal response. |
| H06 | FIXED | Production Control tests cover session reset, active Transfer/live/subscriptions/pending requests, stale completion, queued old work, sequence-zero restart, and fresh same-link HELLO before old generation cleanup. The HELLO RESPONSE remains owned and is handed off exactly once. |
| H11 | FIXED | Production NimBLE callback→bounded handoff→Transport owner is tested for overflow, timeout, malformed fragment recovery, replacement, seeded frame-ID wrap, disconnect/reconnect and slow USB/TCP send. |
| H12 | FIXED | Fake filesystem drives production Storage task through sliced LIST, critical preemption, bounded Transfer READ service and abort interruption. |
| M01 | FIXED | Defaults and saved DEV/VALIDATION/PRODUCTION configs declare 4 MiB flash; current application image fits the configured partition. |

## Phase C finding status

| Finding | Status | Evidence |
| --- | --- | --- |
| H07 | FIXED | Frozen event schemas and trigger/coalescing behavior are checked through production Control event generation, SP decoding and CBOR payload assertions. |
| H09 | FIXED | Production Supervisor/progress evaluation distinguishes task/activity, valid NO_FIX progress, storage availability, current-epoch durable commit and recovery. Health is not restored by mount alone. |
| M02 | FIXED | Production CBOR validation rejects malformed UTF-8, nested invalid/duplicate map keys, unsupported forms, truncation and depth overflow. |
| M03 | FIXED | Subsystem counters are mutated by their owners; saturating counters and bounded chronological error-ring semantics have production tests. |
| M04 | FIXED | UI applies page requests in the UI owner and consumes cached system snapshots; logical session ownership remains with Control. |
| M05 | FIXED | Production Control tests cover Frozen validation precedence, offline/HELLO behavior, permission and resource ordering, and Transfer READ framing semantics. |
| M06 | FIXED | The production-path integration matrix and fake boundaries are recorded in `phase-c-software-completion-report.md`; no test-only duplicate state machines were used for the covered owner transitions. |

The detailed Phase C scope, integration boundaries and limits are recorded in `phase-c-software-completion-report.md`.

## HISTORICAL SNAPSHOT — earlier board configuration attempt

For the SPI ISR placement experiment, the 31 existing host executables were run directly and passed 31/31. `scripts/test.ps1` itself stopped during preparation because the fresh production link failed and `build/production/sailball.elf` was therefore absent. Architecture, metadata reachability, and generated-config checks pass; the latter confirms all three profiles use UART1/GPIO0/1, SPI2/GPIO4–7, LED GPIO8, BOOT GPIO9, 115200 baud, 10 Hz, binary-clean USB and the fixed C3 flash target. The linked stack/frame and H10-S artifact gates were not reached because no final ELF was produced.

| Profile | Compile | Link | Latest linker overflow |
| --- | --- | --- | ---: |
| DEV | PASS | FAIL | 4,800 B |
| VALIDATION | PASS | FAIL | 5,280 B |
| PRODUCTION | PASS | FAIL | 4,784 B |

The sole experiment setting is `CONFIG_SPI_MASTER_ISR_IN_IRAM=n`; it recovered 6,240 B of linker headroom in VALIDATION and PRODUCTION and 6,768 B in DEV. These are still linker failures in the C3 shared DRAM/IRAM region, not partition-size failures. No final BIN size, ELF SHA-256, partition headroom, or valid current `.bss`/`.data` result exists. Fresh fullclean removed the old profile BINs; there is no current BIN to flash. Existing old profile artifact identities below are retained only as historical data in `build-and-test-v1.0.md`.

The non-IRAM SPI master ISR remains a candidate pending physical validation: internal NVS writes can overlap recording when a user saves or forgets Wi-Fi configuration. The IDF flash guard masks non-IRAM CPU interrupts while cache is disabled and restores them afterward, but actual SD transaction latency/recovery during that overlap is not hardware-verified. Do not treat this placement experiment as the pre-flash gate; it remains BLOCKED by the 4,784 B PRODUCTION link deficit and missing post-link gates.

The profile configs and board map do not change Frozen protocol/LDC semantics. Seven Frozen files remain unchanged. No flash, monitor, serial probe or physical-board test was performed. The board revision/assembly identifier was not provided. The confirmed map has no PPS or optional GNSS/SD control nets. ATGM336H-6N74 is the only implemented GNSS backend; u-blox/UBX is not implemented.

## HISTORICAL SNAPSHOT — Hardware Validation Phase 1C result

`CONFIG_SPI_SLAVE_ISR_IN_IRAM=n` is set in common defaults after confirming SPI Slave is unused in Sailball v1.0. Fresh PRODUCTION reconfigure/compile passed, link failed with 3,760 B overflow. Against the saved pre-experiment map, `.iram0.text` fell 772 B and the shared aligned reservation fell 1,024 B; `.dram0.data` and `.dram0.bss` did not change. Phase 1C stopped after the required PRODUCTION-first attempt; DEV/VALIDATION retain only their earlier Phase 1B measurements. The 31 existing host executables, architecture/metadata gates and three profile board/config gates pass. Current valid PRODUCTION ELF/BIN and post-link gates are absent. PRE-FLASH SOFTWARE GATE remains BLOCKED. No hardware access occurred.
## HISTORICAL SNAPSHOT — Hardware Validation Phase 1D residual IRAM dependency closure

The Phase 1C fresh PRODUCTION map is the baseline for this experiment (`.iram0.text` 96,516 B, `.dram0.data` 14,789 B, `.dram0.bss` 213,488 B, `dram0_0_seg` overflow 3,760 B). SPI Slave remains unused. The generated PRODUCTION setting `CONFIG_GDMA_CTRL_FUNC_IN_IRAM=y` was stale from the earlier SPI ISR selections: no current enabled selector required it, and the ESP-IDF v6.1 default is `n`. It was removed without adding a forced `n`; a fresh reconfigure resolved it to not set.

Fresh PRODUCTION compile passed but link still fails with 3,248 B overflow. Its map reports `.iram0.text` 96,150 B, `.dram0.data` 14,789 B, `.dram0.bss` 213,488 B. Relative to Phase 1C, named IRAM payload moved from `gdma.c.obj` (132 B) and `gdma_hal_ahb_v1.c.obj` (226 B); the aligned `.dram0.dummy` reservation fell 512 B. No DATA/BSS change occurred. `CONFIG_GDMA_ISR_HANDLER_IN_IRAM=y` and `CONFIG_ESP_PERIPH_CTRL_FUNC_IN_IRAM=y` remain enabled because they default to `y` in IDF v6.1; peripheral-control is also selected by enabled `ESP_HW_SUPPORT_FUNC_IN_IRAM`. No forced override was applied.

This experiment did not build DEV or VALIDATION after PRODUCTION remained unlinked. The 31 existing host executables, architecture gate, metadata gate and all three generated profile/board configuration checks passed. There is no valid current PRODUCTION ELF/BIN, so post-link stack, H10-S target-ELF, partition and artifact gates were not run. PRE-FLASH SOFTWARE GATE remains BLOCKED by the 3,248 B link deficit. SPI master/SDSPI configuration, board map, GNSS backend, USB, task stacks and Recorder pool were not changed; Frozen documents are unchanged and no hardware access occurred. The remaining safe residual IRAM configuration cleanup is exhausted; the next scoped candidate is Phase 1E USB transport scratch ownership review.

## HISTORICAL SNAPSHOT — Hardware Validation Phase 1E result

## Current Hardware Validation Phase 1F result

The Recorder pool is now exactly three 8 KiB buffers (24,576 B). A full pool consumes GNSS fixes without waiting for Storage and reports new recording loss through Recorder-owned counters. The production owner test covers 10 Hz input, saturation, automatic buffer reuse, clean SIZE_LIMIT rollover with an old Transfer reader, repeated saturated epoch abort/recovery, and STOP. Frozen architecture, acceptance policy, and changelog were revised by explicit authorization; SP and LDC formats remain byte-compatible.

PRODUCTION `.iram0.text=96,150 B`, `.dram0.data=14,789 B`, `.dram0.bss=203,176 B`, shared SRAM linker headroom 7,056 B. VALIDATION and DEV headroom are 6,560 B and 6,528 B. All three current profiles link; their config, stack/frame, H10-S, architecture, metadata, and partition-fit gates pass. The full suite passes 32/32 host executables. SPI master ISR remains outside IRAM and requires hardware testing during active SD recording plus Wi-Fi NVS save/forget. H10-F remains pending hardware. No flash or board access occurred.

Removed the duplicate 2,048 B USB `s_payload` staging array after verifying Control copies RX payloads synchronously and BLE/Wi-Fi TX queue APIs copy their payloads before returning. No RX/TX scratch overlay or COBS aliasing was introduced. The targeted Control source-reuse test, freshly compiled production Transport congestion/Storage integration test, architecture gate, and metadata reachability gate passed. Fresh PRODUCTION reconfigure/compile passed, but link remains short by 1,200 B; map BSS fell 2,048 B to 211,440 B while DATA (14,789 B) and IRAM (96,150 B) stayed unchanged. DEV/VALIDATION, full `scripts/test.ps1`, and post-link gates were not run because the required PRODUCTION-first gate still fails. No current valid target ELF/BIN exists. PRE-FLASH SOFTWARE GATE remains BLOCKED. No hardware access occurred.
