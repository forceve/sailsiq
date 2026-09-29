# Sailball v1.0 Hardware Test Handoff

**Sailball v1.0 firmware software acceptance is complete. This document begins hardware validation.**

Hardware validation has not yet passed. H10-F remains **PENDING HARDWARE**. Field readiness and release readiness remain **PENDING**. This handoff authorizes a tester to begin Phase 1G with the locked VALIDATION image; it does not claim that a board has been flashed or tested.

## 1. Purpose

Use this document as the first entry point for receiving, identifying, flashing and testing the Sailball prototype. Fill in the companion [result template](hardware-validation-result-template-v1.0.md) as evidence is collected. The [checklist](hardware-validation-checklist-v1.0.md) is a short execution aid.

## 2. Current software status

- Phase A software safety: PASS.
- Phase B software acceptance: PASS, with the authorized three-buffer Recorder capacity subset revalidated at 10 Hz.
- Phase C software completion: PASS.
- Recorder pool: 3 脳 8 KiB.
- Pre-flash software gate: PASS.
- H10-S: FIXED.
- H10-F: PENDING HARDWARE.
- Hardware validation: NOT YET PERFORMED.
- Field/release readiness: PENDING.

Use ESP-IDF v6.1 and the target ESP32-C3-WROOM-02-N4, 4 MiB flash, no PSRAM. A tester flashing the locked prebuilt image does not need to rebuild.

## 3. Target hardware

GNSS is ATGM336H-6N74. SD/TF is a 3.3 V SPI card. USB is native USB Serial/JTAG. GPS PPS is not present and is not a test item.

Record before connecting power:

- PCB revision: ____________________
- Assembly revision: ____________________
- Board serial / visible distinguishing mark: ____________________
- If no labels exist, write **UNLABELED PROTOTYPE** and describe visible identifying details: ____________________
- ESP32 module confirmed: ESP32-C3-WROOM-02-N4 [ ]
- Tester / date: ____________________

If the physical unit cannot be distinguished from another unit, stop before connecting or flashing and resolve identity.

## 4. Board map

| Function | Physical assignment |
| --- | --- |
| GNSS UART | UART1 |
| ESP RX GPIO0 | ATGM GPS_TX 鈫?ESP RX |
| ESP TX GPIO1 | ESP TX 鈫?ATGM GPS_RX |
| GNSS runtime | 115200 baud, 10 Hz |
| GPS PPS | Not present; N/A |
| SD | SPI2; CS4, MOSI5, SCLK6, MISO7 |
| LED | GPIO8, external pull-up to 3V3 |
| BOOT | GPIO9, external pull-up; button to GND, active low |
| USB | Native USB Serial/JTAG GPIO18/19; binary SP transport only |

Do not change GPIO assignments to simplify testing.

## 5. Firmware artifact to flash

Flash **VALIDATION only** for the first test.

- BIN: `build/validation/sailball.bin`
- BIN size: **1,082,400 B**
- ELF SHA-256: `F37B1EDA59FCF860368675FCE173207D7E74DD7C216D800A4709262B77369ECF`
- BIN SHA-256: `4444561D1BE7CEE99708AEFFF447B739573216725B54C6F56D07DC72AD3701D1`

These hashes identify the current prebuilt VALIDATION files produced by the final fullclean rebuild for this handoff; they supersede earlier VALIDATION hash values. Recompute them immediately before flash. Any later rebuild creates a new artifact identity and requires the handoff hashes to be refreshed and reviewed.

## 6. Artifact hash verification

Immediately before flashing, recompute both hashes from the files on disk and compare every character with Section 5. Also verify the target is ESP32-C3 and the profile is VALIDATION.

**Any mismatch: STOP. DO NOT FLASH.** Record the observed size and hashes in the result template.

## 7. First flash procedure

1. Record board identity and visible condition.
2. Inspect for a visible short, USB damage, incorrect GNSS/card orientation and a BOOT button stuck low. If a meter is available, record 3V3-to-GND and VBUS-to-GND sanity observations without inventing a fixed resistance threshold.
3. Record the power source and, for a bench supply, its input voltage and current limit.
4. Connect USB and record enumerated device identity, VID/PID and assigned port if available.
5. Recompute the locked hashes.
6. Using the installed ESP-IDF v6.1 standard flash flow, flash the VALIDATION profile and run verification.
7. Do not erase the entire flash unless the normal flash flow requires it. Do not change partition table, sdkconfig or source during this process.
8. Record the exact command, port, baud if relevant, result and verification output.

A failed verification is a stop condition. Do not proceed to stress tests.

## 8. First boot checks

Reset normally after flash. Record reset reason and boot_id if exposed. Check for stable boot, no panic/assert, no illegal instruction, no stack canary, no task watchdog and no brownout/reset loop. USB SP must remain binary clean; do not enable console text on GPIO18/19.

## 9. Runtime heap checks

Using ESP-IDF runtime heap APIs, capture free internal heap, minimum-ever internal heap, largest internal free block, DMA-capable free heap and largest DMA block at:

- H0: earliest safe runtime baseline;
- H1: all eight tasks running;
- H2: Storage mounted;
- H3: BLE advertising;
- H4: before Wi-Fi cold init;
- H5: after Wi-Fi cold/RF init, if admitted;
- H6: Wi-Fi online, if reached;
- H7: BLE and Wi-Fi together, if reachable.

Linker SRAM headroom is not a runtime heap measurement. Do not store Wi-Fi credentials in the report.

## 10. Stack HWM checks

For GNSS, Recorder, Storage, Supervisor, Control, Transport, Transfer and UI, record allocated stack, minimum remaining/high-water mark and estimated maximum used. Capture after boot, GNSS, SD write, BLE activity and Wi-Fi init if reachable. Stop load testing if a task has a concerning watermark; report the measurement rather than guessing a safe value.

## 11. GNSS test

Confirm the module communicates on UART1 at its boot/default setting, receives bounded configuration, transitions to 115200 baud and continues valid NMEA. Record time to READY, retries, UART overflow/framing errors and samples. Check RMC, GGA and GSA checksum samples. Validate normalized sequence/time and, when available, UTC, position, altitude, speed, course, satellites and fix type.

Measure `sample_seq` delta over monotonic time; target is approximately 10 normalized samples/s with ordinary epoch/scheduler jitter.

## 12. SD/LDC test

Record card manufacturer/model/capacity/filesystem if available. Verify SPI2 initialization and FatFS mount without auto-format or deletion. Create an LDC file and verify 16 KiB metadata, data starting at 0x4000, durable metadata and readable_size advancement. Commit at least two blocks, observing the two-stage flush and final LDCM marker. Copy the generated file to the host and run the existing read-only LDC validation tooling.

## 13. Three-block Recorder behavior

During normal recording, capture pool occupancy, buffer_exhaustions, samples_dropped, blocks_completed, blocks_committed and fix_queue_drops. A normal low-load session should ideally show zero pool exhaustion and zero pool loss. During deliberate pressure, explicit loss is acceptable only when correctly counted, with no overwrite, deadlock or leak, and recording resumes automatically after Storage returns a buffer.

## 14. USB SP test

Use native USB Serial/JTAG. Verify binary-clean COBS(Frame)+0x00 framing, HELLO/session sequence, CORE/status, GNSS, Recorder, Storage, Diagnostics and UI status. No printf, ESP_LOG, shell prompt or console text may appear on this stream.

## 15. BLE test

Verify advertising, connect, GATT RX WRITE, TX NOTIFY, HELLO, GET_STATUS, fragmentation, logical reset and physical disconnect/reconnect. Keep the frozen UUID and fragment format. Logical SP reset preserves physical BLE frame_id; a physical reconnect starts its physical frame_id lifecycle anew.

## 16. Wi-Fi admission/runtime test

Before Wi-Fi cold init, record internal/DMA heap, minimum heap and largest blocks. Run the production H10-S admission gate. If it returns DENY, record reason and measurements and do not bypass it. If ALLOW, test cold init, STA, association, DHCP, outbound TCP, TRANSPORT_READY, HELLO and status.

## 17. Mandatory SD + NVS concurrency test

`CONFIG_SPI_MASTER_ISR_IN_IRAM=n` means the SPI master ISR is not placed in IRAM. Software review supports the configuration, but hardware behavior is not yet established. While actively recording at 10 Hz, perform both a Wi-Fi profile save/NVS commit and a profile forget/erase. For each run record Storage commit latency, pool occupancy, buffer_exhaustions, samples_dropped, fix_queue_drops, WDT, SD errors, transaction progress, filesystem integrity and automatic recovery. Explicitly counted samples may be lost under full-pool pressure; deadlock, WDT, corruption, silent loss or leaked ownership fails the test.

## 18. H10-F test

If production admission allows the path, measure BLE and Wi-Fi runtime/coexistence: internal free/minimum heap, largest block, DMA free/largest block, GNSS progress, Recorder progress and Storage commits. H10-F remains PENDING HARDWARE until the evidence is sufficient. A DENY result is valid evidence; never lower thresholds or skip admission.

## 19. LED/button test

Check GPIO8 healthy/unhealthy behavior and GPIO9 active-low short press page advance. Long press has no v1 action. Confirm ordinary reset boots normally and a deliberate BOOT hold retains the expected download-strap behavior.

## 20. Power/reset observations

Record power source/voltage, measured current if available, brownout observations, reset reason and any unexplained reboot. Do not invent current or resistance limits. An unexplained reset blocks Phase 1 pass.

## 21. Evidence to collect

Save board identity, artifact hashes, flash/verify result, reset reason/boot_id, heap and stack tables, GNSS startup and short raw NMEA sample, normalized fix sample, SD identity, hardware-generated LDC, USB/BLE/Wi-Fi results, SD+NVS concurrency metrics and diagnostics snapshot. Redact credentials.

## 22. PASS/FAIL rules

Phase 1 may pass only with identified board, exact artifact match, verified flash, stable boot, eight live application tasks, heap/largest-block/stack measurements, GNSS 115200 and approximately 10 Hz, correct NO_FIX-versus-silence behavior, SD mount and at least two durable blocks, host validation of the physical LDC, real GNSS鈫扲ecorder鈫扴torage鈫扴D flow, USB SP/Transfer, BLE basic path or a precise external blocker, measured Wi-Fi admission, SD+NVS concurrency test, basic Supervisor/UI behavior and no unexplained reset.

Stop further stress immediately on panic, assert, WDT, brownout loop, filesystem corruption, Storage deadlock, silent loss or pool ownership corruption. Indoor NO_FIX, Wi-Fi DENY, H10-F pending and absent PPS do not automatically fail Phase 1.

## 23. Known limitations

No physical board result exists yet. SPI ISR behavior during internal flash operations, runtime heap fragmentation/largest-block behavior, BLE/Wi-Fi coexistence, actual SD/GNSS timing and runtime stack watermarks remain unverified until measured.

## 24. Result report

Fill [hardware-validation-result-template-v1.0.md](hardware-validation-result-template-v1.0.md) and submit it with the evidence package. The tester should also keep the current [implementation status](implementation-status-v1.0.md) and [build record](build-and-test-v1.0.md) for artifact confirmation.

## 25. Tester artifact

Locked first-flash artifact: **VALIDATION**, BIN 1,082,400 B, ELF SHA-256 `F37B1EDA59FCF860368675FCE173207D7E74DD7C216D800A4709262B77369ECF`, BIN SHA-256 `4444561D1BE7CEE99708AEFFF447B739573216725B54C6F56D07DC72AD3701D1`. Recompute local hashes before flash. Mismatch means **STOP 鈥?DO NOT FLASH**.


