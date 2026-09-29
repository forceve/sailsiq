# Sailball Runtime and Recovery Policy v1.0

**Status:** Frozen v1.0 Final — Consistency Revision

## 1. Philosophy

Recovery order is:

```text
local bounded recovery -> degraded operation -> periodic recovery -> MCU reset only when software execution/trust is lost
```

Recording intent and data integrity take precedence over communications availability.

## 2. Boot

Boot never waits forever for a peripheral. Each subsystem reaches a stable running/ready/off/error state.

Firmware requests `recording_intent=true` at boot. Recorder may begin as soon as Storage can create and durably initialize a new LDC file; it does not wait for GNSS fix or UTC.

Wi-Fi boots OFF. BLE advertising intent boots true.

NVS failure does not block GNSS/Recorder/Storage. Wi-Fi persistent configuration may simply be unavailable.

Every reset begins a new logical Recorder session/file; old files are never repaired or appended automatically.

## 3. Recorder STOP/START semantics

USB START sets Recorder intent true. USB STOP sets intent false.

STOP normally ends the current partial block, performs the full LDC two-barrier commit, closes/syncs as required, and then enters STOPPED.

If the active Storage epoch has already been abandoned because durability cannot be trusted, STOP may clean internal pending operations and enter STOPPED without claiming the old file was cleanly closed.

STOPPED means no active Recorder session and no pending Recorder critical operation.

## 4. GNSS fault classification

Three different conditions must not be conflated:

1. **Valid messages but NO_FIX:** not a subsystem failure and does not trigger restart solely for lack of fix.
2. **UART bytes but no valid messages / UART silence:** progress fault eligible for local recovery.
3. **`gnss_task` execution hang:** software execution fault eligible for Task WDT reset.

GNSS stall detection uses last RX/valid-message progress, not last valid position fix.

## 5. GNSS recovery

Typical ladder:

```text
parser/UART transient recovery
-> internal GNSS restart
-> reapply known boot configuration
-> bounded quick retries
-> GNSS ERROR + low-frequency retry
```

Exact thresholds are tuning.

GNSS hardware failure alone never resets the ESP32-C3.

A GNSS restart or timing discontinuity cuts the current LDC block but normally keeps the same LDC file and Recorder session.

## 6. UTC recovery

Monotonic time is always authoritative for ordering/timeouts.

Recording may begin without UTC. Invalid->valid UTC, source/mapping discontinuity or other LDC time-basis transition closes the current block and begins a new block according to LDC rules. Historical blocks are never rewritten.

## 7. Recorder behavior while Storage is unavailable

Recorder must continue consuming `GnssFix` so GNSS cannot be backpressured by failed Storage.

- intent=false: samples are intentionally discarded;
- intent=true but recording impossible: samples are counted as unrecorded/lost-for-storage.

Input `sample_seq` gaps are accounted separately.

## 8. Block commit and transient write failure

A block remains owned in RAM until both LDC durability barriers succeed:

```text
write prefix through Footer[0:12]
-> durable sync #1
-> write LDCM commit magic
-> durable sync #2
```

Only then can `readable_size` advance and the buffer return FREE.

A transient write/sync failure retains the buffer and allows only a bounded retry policy. Firmware must not report a commit before the second barrier.

## 9. Persistent Storage failure / Epoch Abort

When bounded critical retries are exhausted or the file tail becomes uncertain:

1. mark Storage ERROR;
2. mark current LDC file/session abandoned;
3. never append another block to that file;
4. fail the current WRITING block;
5. fail queued READY blocks/pending critical operations belonging to the epoch;
6. generate explicit Ack/error/counters;
7. release buffers safely after loss is accounted;
8. stop normal background I/O against the failed epoch.

`critical_path_healthy=false` while intent=true and recording cannot progress.

## 10. Storage recovery

After cooldown, Storage may periodically reinitialize/remount. No recovery path auto-formats media.

If recovery succeeds and Recorder intent remains true:

```text
new recorder_session_id
file_sequence=0
new 16-byte LDC file session_id
new file / block_sequence=0
```

If intent=false, Storage may become READY without starting Recorder.

Health is not restored merely because mount succeeds; Supervisor waits for real Recorder/Storage progress, such as a successfully committed new block.

## 11. SD removal/reinsertion

Card removal abandons the active Storage epoch. GNSS, UI and communications continue if otherwise healthy.

Reinsertion follows normal Storage recovery and begins a new logical Recorder session if intent=true.

Old uncertain files remain untouched.

## 12. No space

No-space is distinct from generic I/O failure.

When reserve is reached:

- no new recording data is accepted beyond safely closable work;
- Recorder reports error/unavailable for recording;
- filesystem may remain mounted;
- LIST/GET_INFO/TRANSFER remain available where possible;
- USB DELETE can free space;
- no automatic deletion occurs.

After enough space is freed, intent=true causes a **new** Recorder session/file.

## 13. Normal file rollover

SIZE_LIMIT and METADATA_FULL are normal rollover conditions, not Storage failures.

They keep the same logical Recorder `session_id`, increment firmware `file_sequence`, allocate a new 16-byte LDC file `session_id`, reset file-local `block_sequence=0`, and continue RECORDING.

## 14. Active transfer during recording

OPEN_READ of active LDC freezes:

- `readable_size=N`;
- a 16 KiB RAM copy of the current Metadata Region.

Recorder may continue COW metadata publication and Data Region append. Current Transfer keeps seeing its frozen metadata bytes plus the frozen committed prefix up to N.

Transfer backpressure affects only Transfer/network. Storage critical writes retain priority.

## 15. Network recovery

### BLE

Actual advertising is controlled by `advertising_intent && !ble_connected && !wifi_online`.

Wi-Fi ONLINE suppresses advertising, but the firmware does not automatically kick an existing BLE connection after handover. Controller disconnects it when the new TCP Session is confirmed.

### Wi-Fi/TCP

Normal TCP FIN is intentional Session end:

```text
TCP close -> Wi-Fi OFF -> advertise only if advertising_intent=true
```

RST, AP loss, timeout or socket error may trigger finite recovery/backoff. If exhausted, Wi-Fi turns OFF and BLE fallback obeys advertising intent.

If AP/IP remain valid and only TCP is lost, reconnect TCP first rather than always redoing Wi-Fi association/DHCP.

Networking failure never directly changes critical health.

## 16. Protocol overload/backpressure

All queues/buffers are bounded.

- live stream: latest-value replacement, count drops;
- ordinary Event: may be dropped, count evidence;
- Bulk: pause until resources available;
- response: must not wait indefinitely; irrecoverably blocked Transport Session is closed/reset;
- malformed/flooded RX: bounded parser/queue; session may be terminated.

None of these paths block Recorder.

## 17. Task Watchdog versus Progress Watchdog

Task WDT detects a critical task that no longer returns to its execution loop.

Progress Watchdog detects a task/subsystem that is scheduled but useful progress is not advancing.

All legitimate waits in critical tasks are bounded. A task in ERROR/recovery wakes periodically for heartbeat/progress logic instead of sleeping longer than its watchdog budget in one blocking call.

Examples:

- GNSS task alive, UART no valid messages -> Progress Watchdog/local GNSS recovery.
- `f_sync()` or driver call never returns -> Storage Task WDT may reset MCU.

## 18. Intent-aware `critical_path_healthy`

When intent=true, GNSS/Recorder/Storage must be in states capable of useful recording progress.

When intent=false, an intentional Recorder STOPPED state is healthy if no current critical fault exists.

Thus Overview green means “current critical system health is good”, not necessarily “Recorder is currently RECORDING”.

Historical faults remain in counters/Error Ring after current health becomes true again.

## 19. Whole-MCU reset policy

Do **not** reset solely for:

- NO_FIX;
- GNSS hardware loss/restart failure;
- SD missing/full/ordinary I/O failure;
- BLE/Wi-Fi/TCP failure;
- UI fault;
- background Transfer read failure.

MCU reset is appropriate for:

- critical task execution hang;
- stack/heap corruption;
- impossible LDC/Block Pool invariant;
- critical ownership/state corruption;
- other states where continuing execution cannot be trusted.

## 20. Graceful USB reboot

`CORE.REBOOT` is USB-only and returns ACCEPTED before reboot work.

Bounded sequence:

```text
stop accepting long background work
-> terminate/settle Transfer
-> request Recorder graceful stop
-> perform final LDC commit/close where possible
-> restart
```

There is a global deadline. If cleanup cannot complete, restart anyway; do not wait indefinitely for broken hardware.

## 21. Unexpected power loss / brownout

Firmware does not perform emergency FatFS writes in brownout context.

Crash tolerance comes from LDC COW metadata and two-barrier block commit. An incomplete tail is ignored by readers; previously committed data remains the verified prefix subject to real media/filesystem integrity.

A 15-second block duration is not an absolute power-loss guarantee.

## 22. Optional battery ADC

A future board revision may use ESP32-C3 ADC for battery voltage. It is observational:

```text
voltage_mv
voltage_valid
```

Sampling occurs at low rate in Supervisor. ADC invalidity is non-critical. v1 does not automatically stop Recorder, reduce GNSS rate, weaken sync policy or shut down based on voltage.

## 23. Tuning parameters

Examples: GNSS stall threshold, quick retry count, low-frequency retry period, Storage retry count, remount cooldown, WDT deadline, graceful-reboot deadline, Wi-Fi retry/backoff, BLE advertising intervals, SD reserve/rollover target, task stack sizes and ADC calibration.

These defaults may change after validation without changing SP/LDC ABI.


# Protocol Session Recovery Rules

A logical SP Session may be reset on an existing physical Transport by a valid CORE.HELLO with sequence=0. The reset closes old Transfer state, live stream, subscriptions and pending/session TX state without affecting Recorder or Storage critical state.

BLE/TCP handshake and fragment-assembly timeouts are bounded but configurable. Their expiry tears down or resets only the affected communication state. USB may remain physically connected indefinitely before HELLO.

Malformed frames, wrong Major, reserved-header misuse, request_id=0 REQUEST and duplicate pending request_id are protocol/session faults only; they never change critical_path_healthy or force Recorder recovery.
