# Sailball v1.0 Hardware Validation Result 鈥?Phase 1G

> Fill this form during testing. Do not include Wi-Fi credentials or other secrets. Attach raw evidence files using stable filenames.

## 1. Test identification

- Tester:
- Test date/time and timezone:
- Lab/location:
- Result: NOT STARTED / PASS / FAIL / BLOCKED

## 2. Board identity

- PCB revision:
- Assembly revision:
- Board serial/distinguishing mark:
- If unlabeled, visible distinguishing details:
- ESP32 module confirmed: ESP32-C3-WROOM-02-N4 [ ]
- Visible condition / short inspection:
- 3V3鈫擥ND observation (if measured):
- VBUS鈫擥ND observation (if measured):
- Power source:
- Input voltage:
- Bench current limit / observed current if available:

## 3. Artifact and flash record

- Profile: VALIDATION
- BIN path:
- BIN size expected 1,082,400 B / actual:
- Expected ELF SHA-256: `F37B1EDA59FCF860368675FCE173207D7E74DD7C216D800A4709262B77369ECF`
- Actual ELF SHA-256:
- Expected BIN SHA-256: `4444561D1BE7CEE99708AEFFF447B739573216725B54C6F56D07DC72AD3701D1`
- Actual BIN SHA-256:
- ESP-IDF/tool version:
- Target / flash size / partition checked:
- USB enumerated identity, VID/PID, port:
- Flash command:
- Flash result:
- Verification result:
- Reset reason:
- boot_id:
- First boot stable, no unexplained reset [ ]:

## 4. Eight application tasks and runtime stack

| Task | Allocated bytes | Minimum remaining / HWM | Estimated max used | Stage / notes |
| --- | ---: | ---: | ---: | --- |
| gnss_task | | | | |
| recorder_task | | | | |
| storage_task | | | | |
| supervisor_task | | | | |
| control_task | | | | |
| transport_task | | | | |
| transfer_task | | | | |
| ui_task | | | | |

All eight created and alive [ ].

## 5. Runtime heap

Record bytes from runtime heap APIs. Linker headroom is not heap.

| Stage | Internal free | Internal minimum-ever | Largest internal block | DMA free | Largest DMA block | Notes |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| H0 earliest safe baseline | | | | | | |
| H1 eight tasks running | | | | | | |
| H2 Storage mounted | | | | | | |
| H3 BLE advertising | | | | | | |
| H4 before Wi-Fi cold init | | | | | | |
| H5 after Wi-Fi cold/RF init | | | | | | |
| H6 Wi-Fi online, if admitted | | | | | | |
| H7 BLE+Wi-Fi, if reachable | | | | | | |

## 6. GNSS / ATGM336H-6N74

- UART1, ESP RX GPIO0 鈫?GPS_TX, ESP TX GPIO1 鈫?GPS_RX confirmed:
- Boot/default communication:
- Valid NMEA/checksum sample file:
- Sentences observed (RMC/GGA/GSA):
- Configuration attempt count / retries:
- Runtime baud transition to 115200:
- Time to READY:
- UART overflow/framing/parser errors:
- NO_FIX: valid messages continue, position_valid=false, no unnecessary restart:
- Silence test / stall and bounded recovery:
- Raw NMEA evidence path:
- Normalized fix evidence path:
- GNSS PPS: NOT PRESENT / N/A.

| Start sample_seq | End sample_seq | Monotonic interval (s) | Measured samples/s | Position/fix notes |
| ---: | ---: | ---: | ---: | --- |
| | | | | |

## 7. SD / LDC

- Card manufacturer/model:
- Capacity:
- Filesystem:
- SPI2 GPIO CS4/MOSI5/SCLK6/MISO7 confirmed:
- Mount result:
- LDC filename:
- Metadata valid / 16 KiB / data offset 0x4000:
- Durable block commits (minimum 2):
- Flush count / ordering:
- LDCM marker / readable_size progress:
- Host reader/validator result:
- Hardware-generated LDC evidence path:

| Commit # | Block sequence | Commit latency | Flush count / details | readable_size | Result |
| ---: | ---: | ---: | --- | ---: | --- |
| | | | | | |

## 8. Three-block Recorder behavior

| Time/stage | Pool occupancy (FREE/FILLING/READY/WRITING) | buffer_exhaustions | samples_dropped | blocks_completed | blocks_committed | fix_queue_drops | Commit latency |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Normal recording | | | | | | | |
| Wi-Fi NVS save during recording | | | | | | | |
| Wi-Fi NVS forget during recording | | | | | | | |
| Other pressure | | | | | | | |

- Existing READY/WRITING buffers preserved:
- Explicit new sample loss correctly counted if pool full:
- No overwrite/deadlock/leak:
- Automatic recovery when buffer returned:

## 9. USB SP / Transfer

- Native USB GPIO18/19 enumerated:
- Binary-clean COBS(Frame)+0x00:
- HELLO/session sequence:
- CORE/status:
- GNSS/Recorder/Storage/Diagnostics/UI status:
- LIST:
- OPEN:
- READ success exactly one BULK and no OK RESPONSE:
- READ failure exactly one RESPONSE:
- Console text absent:
- Evidence / notes:

## 10. BLE

- Advertising:
- Connect:
- GATT RX WRITE:
- TX NOTIFY:
- HELLO / GET_STATUS:
- Fragmentation:
- Logical reset preserves physical frame_id:
- Disconnect/reconnect resets physical frame lifecycle:
- Evidence / notes:

## 11. Wi-Fi / H10-F

- Heap/largest-block snapshot before admission:
- Production H10-S decision and reason:
- If DENY, no bypass performed [ ]:
- If ALLOW: cold init, STA, association, DHCP, TCP, TRANSPORT_READY, HELLO:
- Wi-Fi runtime internal/DMA heap and largest block:
- BLE+Wi-Fi coexistence reached:
- GNSS/Recorder/Storage progress during radio activity:
- H10-F disposition: PENDING HARDWARE / FIXED with attached evidence:
- Credentials redacted [ ]:

## 12. SPI / NVS + active SD recording

SPI master ISR setting is `CONFIG_SPI_MASTER_ISR_IN_IRAM=n`; the Recorder pool has three blocks. Perform both operations during active 10 Hz recording.

| Operation | Start/end time | Storage commit latency | Peak pool occupancy | buffer_exhaustions | samples_dropped | fix_queue_drops | WDT/SD errors | Filesystem/automatic recovery |
| --- | --- | --- | --- | ---: | ---: | ---: | --- | --- |
| Wi-Fi profile save / NVS commit | | | | | | | | |
| Wi-Fi profile forget / erase | | | | | | | | |

- No deadlock, corruption, silent loss or leaked ownership:
- Any bounded pause / explicit loss explained:

## 13. Supervisor / UI / power

- Storage health restored only after durable progress:
- NO_FIX distinguished from GNSS silence:
- LED GPIO8 healthy/unhealthy:
- GPIO9 short press page advance:
- GPIO9 long press has no v1 action:
- Boot/download strap behavior:
- Brownout / rail / reset observations:

## 14. Errors, stop conditions and bugs

- Panic/assert/illegal instruction:
- Task WDT / stack canary:
- Brownout/reset:
- Filesystem or LDC validation issue:
- Silent loss / deadlock / pool corruption:
- Bugs found and reproduction:
- Testing stopped at:
- External blockers:

## 15. Evidence package

List attached files and redact all credentials.

| Evidence file | Description | Hash, if recorded |
| --- | --- | --- |
| | | |

## 16. Final verdict

- Phase 1G: PASS / FAIL / BLOCKED
- Unexplained reset absent:
- Required durable LDC and host validation complete:
- H10-F: FIXED / PENDING HARDWARE
- Hardware validation overall: PENDING / COMPLETE TO PHASE 1G SCOPE
- Field readiness: PENDING
- Release readiness: PENDING
- Tester signature/date:


