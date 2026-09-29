# Sailball v1.0 Hardware Validation Checklist — Phase 1G

Software acceptance is complete. Hardware validation has not yet passed. H10-F, field readiness and release readiness remain pending. No physical test is represented by this checklist until a tester fills it in.

Use the detailed [hardware tester handoff](hardware-test-handoff-v1.0.md) as the procedure and [result template](hardware-validation-result-template-v1.0.md) as the evidence record.

## Before power

- [ ] Identify the actual board: PCB revision, assembly revision, serial/distinguishing marks. If unlabeled, record **UNLABELED PROTOTYPE** plus visible identifying details.
- [ ] Confirm ESP32-C3-WROOM-02-N4; record power source and input voltage.
- [ ] Inspect for visible shorts/damage, GNSS and SD orientation, and BOOT button not held low.
- [ ] Confirm fixed board map: ATGM336H-6N74 UART1 (RX GPIO0 from GPS_TX, TX GPIO1 to GPS_RX); SD SPI2 GPIO4/5/6/7; LED8; active-low BOOT9; native USB GPIO18/19.
- [ ] GPS PPS is absent: no pin, ISR or test.
- [ ] Connect USB only after board identity and visual inspection.

## Lock and flash VALIDATION

- [ ] Profile is VALIDATION, target esp32c3, flash size/partition correct.
- [ ] Recompute local BIN size (**1,082,400 B**), ELF SHA-256 (`F37B1EDA59FCF860368675FCE173207D7E74DD7C216D800A4709262B77369ECF`) and BIN SHA-256 (`4444561D1BE7CEE99708AEFFF447B739573216725B54C6F56D07DC72AD3701D1`).
- [ ] Any mismatch: **STOP; DO NOT FLASH**.
- [ ] Record enumeration identity/VID/PID/port; use ESP-IDF v6.1 standard flash and verify flow.
- [ ] Record command, port, flash and verification results. Do not rebuild or change config during flashing.

## First boot and runtime baseline

- [ ] Stable normal boot; record reset reason and boot_id.
- [ ] No panic, assert, WDT, stack canary, illegal instruction, brownout loop or unexplained reset.
- [ ] Confirm these eight app tasks alive: GNSS, Recorder, Storage, Supervisor, Control, Transport, Transfer, UI.
- [ ] At boot/tasks/Storage/BLE/Wi-Fi stages, measure runtime internal free/minimum heap, largest internal block, DMA free/largest block.
- [ ] Record allocated stack and runtime HWM for all eight tasks.

## GNSS

- [ ] ATGM boot communication; valid checked RMC/GGA/GSA sentences.
- [ ] Bounded configuration reaches UART 115200 and READY; record retries and time to READY.
- [ ] Measure normalized sample_seq/mono_us cadence near 10 Hz.
- [ ] NO_FIX with valid NMEA remains progress and does not trigger unnecessary restart.
- [ ] Separately test silence detection and bounded recovery.
- [ ] Record a short raw NMEA and normalized fix sample; redact sensitive data.

## SD, LDC and Recorder

- [ ] Record SD card identity/filesystem; SPI2 mount succeeds without auto-format.
- [ ] Create LDC; verify 16 KiB metadata and data offset 0x4000.
- [ ] Make at least two durable block commits; verify two-stage flush/LDCM and readable_size.
- [ ] Copy the real LDC to host and run existing read-only validation.
- [ ] Validate real GNSS → Recorder → Storage → SDSPI → SD path over multiple blocks.
- [ ] Recorder pool is 3×8 KiB: capture occupancy, buffer_exhaustions, samples_dropped, blocks_completed/committed, fix_queue_drops and commit latency.
- [ ] During pressure, only new samples may be explicitly counted lost; no overwrite/deadlock/leak; recovery resumes after a buffer returns.

## USB, BLE, Wi-Fi and UI

- [ ] USB is binary-clean COBS(Frame)+0x00; HELLO, status, Diagnostics and LIST/OPEN/READ work.
- [ ] Successful Transfer READ produces exactly one BULK and no OK RESPONSE.
- [ ] BLE advertising/connect/RX WRITE/TX NOTIFY/HELLO/fragmentation/logical reset/reconnect work.
- [ ] Record internal/DMA heap and largest blocks before Wi-Fi admission.
- [ ] Run production H10-S admission. Record DENY without bypass; if ALLOW, test cold init, STA, DHCP, TCP and HELLO.
- [ ] Observe GPIO8 LED, GPIO9 short press page advance, long press no v1 action, and normal BOOT behavior.

## Mandatory SD + NVS concurrency

- [ ] `CONFIG_SPI_MASTER_ISR_IN_IRAM=n` remains a hardware risk. During active 10 Hz recording, perform Wi-Fi profile save/NVS commit.
- [ ] During active 10 Hz recording, perform Wi-Fi profile forget/erase.
- [ ] For both, record SD transaction progress, commit latency, pool occupancy, buffer_exhaustions, samples_dropped, fix_queue_drops, WDT, SD/filesystem integrity and automatic recovery.
- [ ] Explicitly counted loss under full three-block pressure is explainable. Deadlock, WDT, corruption, silent loss or ownership leak fails.

## Stop and submit

- [ ] Stop stress after unexplained reset, panic/assert, stack canary, WDT, brownout loop, filesystem corruption, Storage deadlock, silent loss or pool corruption.
- [ ] Fill [result template](hardware-validation-result-template-v1.0.md).
- [ ] Submit board identity, locked artifact hashes, flash/reset, heap/stack, GNSS, SD/LDC, USB/BLE/Wi-Fi, SD+NVS and diagnostics evidence. Never include Wi-Fi credential plaintext.
- [ ] Keep H10-F pending unless measured hardware evidence supports closure. Do not claim field or release readiness.
