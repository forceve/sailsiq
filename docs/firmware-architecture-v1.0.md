# Sailball Firmware Architecture v1.0

**Status:** Frozen v1.0 Final — Consistency Revision  
**Target:** ESP32-C3 / ESP-IDF  
**Related specifications:** `sailball-protocol-v1.0.md`, `LDC_v1_Format_Specification-v1.0.md`

## 1. Goals and priority

Sailball is a GNSS logger for sailing. Firmware priority is:

1. recording reliability;
2. stored-data integrity and diagnosability;
3. predictable recovery;
4. communications convenience;
5. power optimization.

The only Critical Data Path is:

```text
GNSS -> Recorder -> Storage critical write/commit -> SD
```

Protocol, BLE, Wi-Fi, USB, file transfer, UI and textual logging are never synchronous dependencies of this path.

## 2. Core invariants

- **Service != Task.** Tasks exist because of blocking/resource ownership/realtime boundaries, not because a protocol Service exists.
- **Single Owner Rule.** Stateful/blocking/physical resources have one owner task.
- **Critical Path uses bounded/static resources.** It must not depend on runtime heap allocation for normal progress.
- **No silent data loss.** Every loss path must be represented by counters, sequence gaps and/or Error Ring evidence.
- **External/peripheral failures are recoverable conditions.** Internal impossible states may be fatal.
- **Wire/disk ABIs are explicitly serialized.** No compiler struct layout is an SP or LDC ABI.

## 3. Application tasks

Firmware v1 uses eight application tasks. Exact numeric FreeRTOS priorities are tuning; relative ordering is architectural.

| Task | Relative priority | Owner / responsibility |
| --- | ---: | --- |
| `gnss_task` | P10 | GNSS UART, parser, normalized fixes, latest fix snapshot |
| `recorder_task` | P8 | recording intent, Recorder state, LDC block builder, Block Pool acquisition |
| `storage_task` | P7 | SD/FatFS, all file handles, critical/background I/O |
| `supervisor_task` | P6 | progress health, recovery coordination, runtime metrics, optional battery ADC |
| `control_task` | P5 | SP command dispatch, source permissions, Service adapters |
| `transport_task` | P4 | USB/TCP/BLE SP I/O, framing, session and TX scheduling |
| `transfer_task` | P3 | logical file-transfer state, one outstanding READ |
| `ui_task` | P2 | BOOT button, page state, WS2818B |

ESP-IDF may create its own Wi-Fi/lwIP/NimBLE/system tasks. Sailball does not create a separate app task merely because a network Service exists.

All eight Sailball tasks are created once during boot and normally remain alive for the entire boot. Recovery changes task-owned state rather than deleting/recreating tasks.

## 4. Ownership map

| Resource/state | Sole owner |
| --- | --- |
| GNSS UART/parser/configuration | `gnss_task` |
| latest normalized GNSS snapshot | `gnss_task` |
| GNSS-owned counters | `gnss_task` |
| `recording_intent` | `recorder_task` |
| Recorder state / logical recorder session | `recorder_task` |
| current LDC builder / filling block | `recorder_task` |
| SD/FatFS / `FIL` / `DIR` | `storage_task` |
| recording and transfer file handles | `storage_task` |
| cached free-space/storage state | `storage_task` |
| `critical_path_healthy` | `supervisor_task` |
| optional battery voltage snapshot | `supervisor_task` |
| SP command dispatch/permissions | `control_task` |
| transport session/I/O/TX scheduling | `transport_task` |
| logical transfer state | `transfer_task` |
| UI page/button/LED | `ui_task` |

Counters obey the same ownership rule. One task never increments another subsystem's counter.

## 5. Public API layers

```text
External SP
   -> Command Adapter / permissions / CBOR semantics
   -> Public Service API
   -> Owner task
   -> Private driver/internal API
```

Public subsystem API has two normal shapes:

1. **Snapshot API:** bounded RAM-only read; no hardware I/O and no waiting.
2. **Request API:** bounded submission to the owner task, returning accepted/busy/invalid-state style results.

`ACCEPTED` ends the RPC. Completion is observed through status/event/error history, except `TRANSFER.READ`, whose success terminator is BULK DATA as defined by SP.

## 6. GNSS normalized data plane

A fixed-size normalized sample contains at least:

```text
sample_seq : uint32
mono_us    : uint64
utc_us + utc_valid
lat_e7 / lon_e7 + position_valid
altitude_cm
ground_speed_centi_kn
course_centi_deg
satellites_used
normalized_fix_type
```

`sample_seq` increments per normalized sample and naturally wraps. Recorder uses it to detect input gaps.

The internal fix enum is richer than SP and supports the LDC values NONE, DEAD_RECKONING, FIX_2D, FIX_3D, GNSS_DR, TIME_ONLY plus UNKNOWN. Conversion occurs at boundaries:

- Recorder maps internal state to LDC enum.
- Protocol adapter maps internal state to SP coarse enum: NONE->NO_FIX; 2D->2D; 3D->3D; TIME_ONLY->NO_FIX; DR/GNSS_DR/UNKNOWN->UNKNOWN.

Vendor enum numbers are never copied directly into either ABI.

## 7. GNSS Fix Queue

Baseline:

```text
GNSS_FIX_QUEUE_DEPTH = 32
```

The queue is a statically allocated FreeRTOS queue by value.

When full:

1. GNSS waits only a short bounded interval;
2. if still full, the newest incoming normalized sample is dropped;
3. GNSS increments its own `fix_queue_drops` and resumes UART processing;
4. Recorder later observes `sample_seq` gaps and increments Recorder-owned loss accounting.

Queued older samples are not overwritten silently.

## 8. LDC Block Pool

Baseline:

```text
LDC_BLOCK_CAPACITY = 8192 bytes
LDC_BLOCK_POOL_COUNT = 3
```

States:

```text
FREE -> FILLING -> READY -> WRITING -> FREE
```

A failed Storage epoch may use an internal FAILED/ABORTED transition solely to return ownership safely.

The pool has **three 8 KiB buffers**, one fewer block of backlog elasticity than the previous four-buffer design. It is not a guaranteed number of seconds. LDC block duration is at most 15 s and may be shorter because of buffer capacity or semantic boundaries. At 10 Hz, the pool can hold one Storage-owned block, one queued block, and one newly completed block; subsequent fixes must still be consumed and any recording loss counted explicitly until a buffer returns.

The Recorder builds samples in separate bounded sample storage. On finalization it acquires a pool buffer, passes through FILLING and READY, and submits the buffer to Storage as WRITING. More than one buffer may therefore appear WRITING from the Recorder ownership view while Storage executes only one critical write at a time. A clean rollover retains all submitted buffers; epoch-abort cleanup releases them. No pool buffer is overwritten to make room for new fixes.

If future fields make a 15-second block too large, firmware closes the block early before increasing critical RAM aggressively.

## 9. LDC format authority

`LDC_v1_Format_Specification-v1.0.md` is the authority for disk bytes.

Important implementation constraints include:

- Metadata Region is exactly 16 KiB.
- Data Region begins at physical `0x4000`.
- BlockHeader v1 is **96 bytes**, not the obsolete early 64-byte draft.
- StreamDescriptor is 16 bytes.
- CommitFooter is 16 bytes.
- `block_sequence` is file-local and starts at 0 in each new LDC file.
- definitions must be durably published before a block can reference them.
- Presence Bitmap describes whole sample-slot presence; there is no per-field null bitmap.

### Per-field availability

If a STREAM field such as altitude or COG becomes unavailable while other fields remain valid, Recorder must close the block and start a new block with an honest field set. It must not use the common Presence Bitmap as a per-field validity mask and must not fabricate zero.

## 10. Recorder ownership and recording intent

`recording_intent` is owned exclusively by `recorder_task`.

Boot requests intent=true. USB `RECORDER.STOP` requests intent=false. USB `RECORDER.START` requests intent=true.

System code never writes the variable directly.

When Recorder is intentionally STOPPED, it continues consuming GNSS input so that stopping recording never backpressures GNSS. These samples are intentionally discarded and accounted separately from unexpected loss.

## 11. Identity hierarchy

There are deliberately several identity layers:

```text
device_id
  -> boot_id
      -> recorder_session_id (SP wire field `session_id`, uint32)
          -> file_sequence (firmware internal)
              -> ldc_file_session_id (LDC 16-byte opaque `session_id`)
                  -> block_sequence (file-local u32)
```

### `device_id`

Firmware v1 derives a stable u64 from the ESP32-C3 base eFuse MAC: 48-bit MAC value in low 48 bits, upper 16 bits zero. LDC stores that u64 LE. SP exposes exactly the same value as a fixed 8-byte LE Byte String.

### `boot_id`

Each boot generates a random nonzero uint32 with `esp_random()` or equivalent. It is not persisted and is not an authentication secret.

### Recorder session

The SP wire field `session_id` is a boot-local uint32 logical Recorder session.

Normal SIZE_LIMIT or METADATA_FULL file rollover:

```text
recorder_session_id unchanged
file_sequence++
new LDC 16-byte file session_id
block_sequence = 0
```

Persistent storage failure recovery / SD removal recovery begins a new logical Recorder session when intent remains true.

The LDC 16-byte session ID is never a truncation/expansion of the SP uint32 ID.

## 12. File lifecycle and rollover

Block-only boundaries include:

- normal <=15 s duration;
- buffer safe-capacity boundary;
- UTC invalid->valid or material mapping discontinuity;
- GNSS restart/recovery timing discontinuity;
- sample-rate change;
- field-set/availability change;
- Field Definition version / CONST change.

File boundaries include:

- reset/power cycle;
- explicit new Recorder session;
- normal size rollover;
- Metadata Region capacity rollover;
- Storage recovery after an abandoned file.

File size policy is adaptive to actual media capacity. Firmware does not assume an SD card is at least 1 GiB. Exact reserve, target ratio and absolute maximum are tuning values.

Firmware does not rotate by midnight/date/hour.

## 13. File naming

Names are ASCII and never depend on UTC being available. A possible scheme is:

```text
SB_<boot>_S<recorder_session>_F<file_sequence>.ldc
```

UTC may be included only if already valid at file creation. The file is never renamed later when UTC becomes available.

Names are convenience metadata; LDC contents are authoritative.

Files are always created with no-overwrite semantics. Empty metadata-only files are retained rather than silently deleted.

## 14. LDC durable commit

Every committed block uses the exact two-barrier LDC writer order:

```text
1. Build final Header/Directory/Payload/Presence/Footer fields in RAM.
2. Write Header + Directory + Payload + Presence + first 12 bytes of Footer.
3. f_sync / durable barrier #1.
4. Write final 4-byte LDCM commit_magic.
5. f_sync / durable barrier #2.
6. Increment durable commit accounting.
7. Advance protocol/storage readable_size.
8. Release Block Buffer to FREE.
```

Any write or durability-barrier failure makes the tail uncertain. Firmware must not append later blocks to that file. The current Storage epoch is failed/abandoned and recovery creates a new file/session as applicable.

A 15-second maximum block duration must **not** be advertised as an unconditional “power loss can lose at most 15 seconds” guarantee; the filesystem/media remain in the failure model.

## 15. Storage queues

Storage has two bounded work classes.

### Critical queue

Baseline depth recommendation: 8. Contains recording OPEN, metadata publication, block writes and CLOSE. Critical requests are never silently dropped.

### Background queue

Baseline depth recommendation: 4. Contains Transfer reads, LIST/INFO, DELETE, FORMAT. Queue saturation returns BUSY.

Storage scheduling is:

```text
drain/check critical
-> at most one bounded background quantum
-> check critical again
-> if only background remains, perform a real schedulable wait before continuing
```

`taskYIELD()` alone is not considered sufficient to guarantee lower-priority work gets CPU time.

## 16. Storage Epoch Abort

Persistent critical I/O failure causes an Epoch Abort:

1. Storage enters ERROR.
2. current WRITING block is failed;
3. queued READY blocks for the failed epoch are failed;
4. pending Recorder critical operations receive explicit failure Ack;
5. uncommitted/lost blocks and samples are accounted;
6. affected buffers are returned to FREE after Recorder acknowledges loss state;
7. background I/O against the failed epoch stops;
8. periodic remount/recovery may begin after cooldown.

Recorder remains alive and drains GNSS. When Storage later recovers and `recording_intent=true`, firmware creates a new logical Recorder session and a new LDC file. The old uncertain file is never reopened for append.

## 17. Filesystem policy

Firmware v1 uses FatFS and product-tests FAT16/FAT32. LFN is enabled; firmware-generated names remain ASCII. exFAT is not required by the v1 baseline.

Mount failure never triggers automatic FORMAT. Firmware never auto-deletes old recordings to free space.

No-space is distinct from generic I/O failure: Storage can remain mounted so list/download/delete continue to work while Recorder cannot continue.

## 18. Active LDC transfer consistency

Firmware v1 allows one global Bulk file transfer.

For an active LDC, `TRANSFER.OPEN_READ`:

1. freezes `readable_size=N`;
2. copies the entire 16 KiB Metadata Region `[0,0x4000)` into one RAM Transfer metadata snapshot;
3. opens/uses an independent read file object owned by `storage_task`.

For that Transfer:

- offsets below `0x4000` read from the RAM snapshot;
- offsets at/above `0x4000` read from the committed append-only file prefix;
- reads never exceed N.

Recorder may continue publishing newer metadata/blocks without changing bytes observed by the current Transfer. Re-open is required to obtain newer content.

The active recording write handle and transfer read handle are separate `FIL` objects, both owned by `storage_task`.

## 19. Transfer and networking isolation

`transfer_task` owns logical transfer state but never FatFS. At most one Transfer exists globally and one READ may be outstanding.

Bulk TX backpressure pauses transfer. It cannot request Storage to delay Recorder critical writes.

Live GNSS uses a latest-value snapshot, not the Recorder queue. Slow network causes stale live samples to be replaced and counted, not queued indefinitely.

## 20. Transport architecture

`transport_task` owns app-side SP transport execution:

- USB/TCP byte stream framing (COBS + 0x00);
- TCP partial send/read handling;
- BLE fragment reassembly and fragmentation;
- Transport Session lifecycle;
- bounded RX/TX queues;
- SP TX priority scheduling.

`control_task` receives validated complete SP frames and handles CBOR/business semantics.

Transport TX priority is:

1. RESPONSE/bootstrap;
2. important Event;
3. BULK;
4. ordinary Event;
5. Live STREAM.

Scheduling is bounded: responses preempt Bulk, but repeated control traffic must not permanently starve Bulk.

If a response cannot be queued because the transport is irrecoverably backpressured, the logical Transport Session is reset/closed instead of blocking the control or recording path.

## 21. BLE/Wi-Fi runtime

Boot:

```text
BLE advertising intent = true
Wi-Fi = OFF
```

Saved credentials do not trigger automatic Wi-Fi connect.

BLE is bootstrap/fallback; Wi-Fi/TCP is high-bandwidth temporary transport.

Wi-Fi is ONLINE only after STA -> IP -> outbound TCP -> TRANSPORT_READY -> HELLO.

Handover failure keeps the original BLE Session usable. After Wi-Fi becomes ONLINE, actual advertising stops, but an existing BLE connection is **not automatically kicked by the device**. The Controller confirms the new Session then disconnects BLE through the platform BLE API.

### advertising intent

`BLE.SET_ADVERTISING(enabled)` modifies internal `advertising_intent`.

```text
actual advertising = intent && !ble_connected && !wifi_online
```

Therefore a user who explicitly disables advertising does not have it automatically re-enabled after Wi-Fi ends.

Normal TCP FIN ends the Wi-Fi Session without reconnect. RST/AP loss/timeout may use finite recovery/backoff and eventually fall back to Wi-Fi OFF plus BLE advertising only when advertising intent is true.

No SP heartbeat is required in v1; TCP state/optional keepalive is sufficient.

## 22. Supervisor and health

`supervisor_task` observes RAM snapshots, progress timestamps, queue pressure and counters. It never reads SD, parses UART or performs RF scans.

Task WDT answers “is the task execution loop alive?” Progress Watchdog answers “is useful work advancing?”.

Normal waits in critical tasks must be bounded so each task periodically returns to its loop/heartbeat. `portMAX_DELAY` waits that prevent watchdog/progress discrimination are avoided in critical runtime paths.

### Intent-aware health

When `recording_intent=true`, health requires the critical chain to be capable of making recording progress.

When `recording_intent=false`, Recorder STOPPED is an expected state and does not make health false merely because no blocks are committing.

Historical errors remain in Counters/Error Ring after health recovers. Health returns true after real progress following recovery, not merely after a state variable flips to READY.

## 23. Power/runtime hardware policy

Firmware v1 does not assume dedicated load-switch GPIOs for GNSS or SD.

- GNSS remains powered/running during normal runtime, including Recorder STOP.
- SD normally remains mounted.
- Wi-Fi is demand-driven and defaults OFF.
- BLE advertising is the default discovery mechanism.
- no Light Sleep / Deep Sleep policy in v1;
- no emergency brownout filesystem flush;
- no low-battery Recorder degradation in the baseline.

A future hardware revision may connect battery voltage through a divider to ESP32-C3 ADC. That capability is optional. `supervisor_task` may sample it at low rate and expose `voltage_mv + valid`; it does not automatically stop Recorder or change durability policy.

## 24. Logging and build profiles

Profiles:

- **DEV:** detailed logs/debugger/assert instrumentation allowed.
- **VALIDATION:** production-like timing with counters, latency/high-water, heap and stack metrics.
- **PRODUCTION:** Status/Counters/Error Ring/Watchdogs/fatal invariants; high-volume textual logging disabled.

Critical-path hot loops do not emit per-sample/per-byte synchronous text logs.

USB SP byte stream must be binary-clean and cannot be mixed with textual console output.

Wi-Fi passwords and credential payloads are never logged in any profile.

## 25. Fatal versus recoverable

Recoverable examples:

- GNSS no data/no fix;
- SD removed/full/write failure;
- TCP/Wi-Fi/BLE failure;
- background read failure.

Fatal invariant examples:

- impossible Block Pool ownership transition;
- encoder writes beyond proven buffer capacity;
- critical bookkeeping corruption;
- stack/heap corruption;
- critical task execution hang that does not return from a driver/system call.

Peripheral failure alone does not reset the MCU.

## 26. Component structure

Recommended components:

```text
sailball_common
sailball_board
sailball_system
sailball_diagnostics
sailball_supervisor
sailball_gnss
sailball_ldc
sailball_recorder
sailball_storage
sailball_sp
sailball_control
sailball_transfer
sailball_usb
sailball_ble
sailball_wifi
sailball_ui
```

`app_main()` is deliberately thin and starts system initialization only.

`sailball_ldc` is a pure format/codec library: no task, no FatFS, no UART, no networking.

`storage` never includes Recorder business logic; completion returns through Ack/message channels.

Circular component dependencies are architecture errors.

Public headers contain public snapshots/request APIs. Driver/task/state-machine internals use private headers. GPIO/UART/SPI/ADC mapping is centralized under `sailball_board`.

## 27. Language and synchronization rules

Firmware business logic is C-oriented. Critical code does not depend on C++ exceptions, RTTI or unbounded STL-style containers.

Large buffers are static pools, never task-stack locals.

Prefer queues, task notifications, event groups and short critical sections over broad recursive/global mutexes.

`volatile` is not a thread synchronization primitive.

ISRs do the minimum: clear/read hardware state, timestamp if necessary, and notify/queue with FromISR APIs. No FatFS, CBOR, LDC encoding, malloc or normal textual logging in ISR context.

## 28. Tuning versus frozen architecture

Tuning includes retry counts, timeout values, task stack sizes, SD SPI speed, file-size ratio/reserve, BLE advertising intervals, Wi-Fi reconnect backoff, LED brightness, WDT deadline, battery calibration and validation heap thresholds.

Tuning values may receive conservative defaults but are not SP/LDC ABI or architectural invariants.

# Frozen Protocol Edge Integration

Firmware implementation must follow Sailball Protocol v1.0 final edge rules without adding alternate behavior:

- every Transport supports at least 256 B SP bootstrap Payload;
- fixed 8 B device_id and random nonzero boot_id;
- sequence=0 HELLO can reset a logical SP Session on an existing physical Transport;
- public Diagnostics Counters encode as saturating uint64;
- BLE uses the frozen Service/RX/TX UUIDs and strict in-order fragment validation;
- USB VID/PID/discovery remains board/host integration, not SP ABI;
- Recorder and Wi-Fi owner state machines implement the frozen race response tables;
- legal successful Responses never exceed peer max_rx_payload; paging is used only where already defined;
- unsupported Major/reserved/request-id/duplicate rules are implemented in SP Core, not duplicated in Service handlers.

Timeouts for BLE fragment assembly, HELLO waiting, reconnect/backoff and graceful reboot deadline remain tuning values.
