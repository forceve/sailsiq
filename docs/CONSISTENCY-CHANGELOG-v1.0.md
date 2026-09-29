# Sailball v1.0 Consistency & Protocol Freeze Changelog

## 2026-09-29 — Authorized Recorder pool capacity revision

The ESP32-C3-WROOM-02-N4 shared IRAM/DRAM linker closure changes the Recorder static block pool from four 8 KiB buffers to three 8 KiB buffers. One block of backlog elasticity is intentionally removed. At full occupancy, Recorder keeps consuming normalized GNSS fixes, counts new recording loss explicitly, and resumes when Storage returns a buffer. Clean SIZE_LIMIT rollover retains already accepted blocks; epoch abort releases every owned buffer. The affected Recorder/Storage capacity acceptance cases were revalidated at 10 Hz before carrying forward the earlier Phase B software acceptance.

The 8 KiB block size, LDC v1 format and durability barriers, Storage ownership, rollover and epoch-abort identity semantics, GNSS queue consumption, and SP v1 wire format remain unchanged. This is an explicit Frozen architecture and acceptance baseline revision; previous four-buffer test evidence is historical.

**Revision date:** 2026-09-26  
**Scope:** Cross-document consistency repair after Firmware Architecture freeze review.

## 1. Documents in this revision

- `sailball-protocol-v1.0.md`
- `sailball-client-interface-v1.0.md`
- `LDC_v1_Format_Specification-v1.0.md`
- `firmware-architecture-v1.0.md`
- `runtime-recovery-policy-v1.0.md`
- `test-acceptance-v1.0.md`

## 2. Compatibility statement

This revision does **not** intentionally change the frozen SP Frame layout, Service/Command IDs, permission matrix, LDC binary layout, 16 KiB Metadata Region, 96-byte BlockHeader, 16-byte StreamDescriptor, 16-byte CommitFooter, or existing codec/CRC definitions.

The revision primarily resolves cross-document semantics and runtime implementation rules.

The one significant new runtime mechanism is the active-transfer 16 KiB Metadata Region snapshot. It uses device RAM and existing `OPEN_READ/READ/CLOSE` messages; it adds no SP field and changes no LDC byte layout.

## 3. Resolved consistency issues

### 3.1 Recorder session versus LDC file session

Two identity layers are now explicit:

- SP Recorder wire `session_id`: boot-local uint32 logical Recorder session.
- LDC Superblock `session_id`: opaque nonzero 16-byte identity unique per LDC file.

Normal SIZE_LIMIT/METADATA_FULL rollover keeps the SP Recorder session, increments internal `file_sequence`, creates a new 16-byte LDC file session ID and resets file-local `block_sequence`.

Persistent Storage failure recovery creates a new logical Recorder session and a new LDC file identity.

### 3.2 Exact LDC commit ordering

Firmware documentation now exactly follows LDC section 9.3:

```text
write Header/Directory/Payload/Bitmap/Footer[0:12]
-> durability barrier #1
-> write 4-byte commit_magic
-> durability barrier #2
-> advance readable_size / release buffer
```

Any uncertain write/sync tail abandons that file; later blocks are not appended to it.

### 3.3 Active LDC transfer consistency

For an active file, `OPEN_READ` now freezes both:

- `readable_size=N`;
- a full 16 KiB RAM copy of the Metadata Region.

Offsets `<0x4000` read from the snapshot. Offsets `>=0x4000` read from the committed append-only Data Region and never beyond N.

Firmware v1 permits one global active Bulk Transfer, so only one 16 KiB snapshot is required.

### 3.4 BLE handover ownership

The device does not automatically disconnect an existing BLE connection when Wi-Fi becomes ONLINE.

Controller confirms TRANSPORT_READY + HELLO + Wi-Fi ONLINE and then disconnects BLE through the platform BLE API.

Wi-Fi ONLINE suppresses new advertising, but does not forcibly kick the existing connection.

### 3.5 LDC per-field availability

The LDC Presence Bitmap is confirmed as a whole-sample-slot bitmap, not a per-field null bitmap.

A per-field availability change, such as altitude/COG becoming invalid independently, causes a block boundary / changed field set. Firmware does not fabricate zero or independently null one STREAM using the common bitmap.

### 3.6 `fix_type` mapping

Firmware uses a richer internal normalized fix type and maps independently to SP and LDC.

Frozen SP mapping:

| Internal/LDC state | SP state |
| --- | --- |
| NONE | NO_FIX |
| FIX_2D | FIX_2D |
| FIX_3D | FIX_3D |
| TIME_ONLY | NO_FIX |
| DEAD_RECKONING | UNKNOWN |
| GNSS_DR | UNKNOWN |
| unknown | UNKNOWN |

LDC on-disk enum values remain unchanged.

### 3.7 Error Ring schema

Error Record retains the earlier complete key layout:

```text
0 error_id
1 first_mono_us
2 last_mono_us
3 service_id
4 error_code
5 severity
6 occurrence_count
7 utc_us?
```

v1 does not coalesce significant errors, therefore `first_mono_us == last_mono_us` and `occurrence_count=1`.

Paging and empty-Ring behavior are now specified. `CLEAR_ERRORS` does not reset the error ID allocator.

### 3.8 BLE Status/Event schema

BLE Status is now:

```text
{0: state, 1: mtu?}
```

BLE `STATE_CHANGED` v1 is:

```text
{0: state}
```

No unallocated reason enum or DISCONNECTED enum is invented.

### 3.9 BLE advertising intent

`BLE.SET_ADVERTISING(enabled)` modifies internal `advertising_intent`.

Actual advertising is:

```text
advertising_intent && !ble_connected && !wifi_online
```

An explicit false therefore survives later Wi-Fi fallback.

### 3.10 Transfer edge conditions

Frozen behavior now includes:

- `length=0` -> OUT_OF_RANGE;
- `offset>=readable_size` -> OUT_OF_RANGE;
- only an EOF-tail request may succeed with a short BULK;
- non-EOF short reads must be completed internally or fail IO_ERROR;
- CLOSE correct ID + outstanding READ -> BUSY;
- CLOSE wrong active ID -> NOT_FOUND;
- no active Transfer -> CLOSE OK.

### 3.11 Graceful reboot

USB `CORE.REBOOT` performs bounded graceful shutdown after ACCEPTED enters TX: stop/settle long background work, request Recorder close/commit, sync/close where possible, then reset. A global deadline prevents broken hardware from blocking reboot forever.

### 3.12 Intent-aware critical health

`critical_path_healthy` now means the critical system is healthy relative to current recording intent.

Intentional Recorder STOPPED with `recording_intent=false` is not a fault. The field does not mean “currently RECORDING”.

### 3.13 Storage Epoch Abort

Persistent critical Storage failure now explicitly drains/fails the current WRITING block, queued READY blocks and pending critical operations, accounts loss and returns Block Buffers. This prevents Storage failure from permanently exhausting the Block Pool and backpressuring GNSS.

### 3.14 Task architecture

Firmware architecture now freezes eight application tasks including `transport_task`, separating blocking Transport I/O/session scheduling from `control_task` command semantics.

### 3.15 Device and boot identity

Firmware v1 uses a stable u64 device identity derived from the ESP32-C3 base eFuse MAC, with the 48-bit MAC in the low 48 bits and upper 16 bits zero.

- LDC stores it as u64 LE.
- SP exposes the same value as a fixed 8-byte LE Byte String.
- `boot_id` is random nonzero uint32 generated each boot and is not persisted.

### 3.16 Filesystem

Firmware v1 product target is FatFS FAT16/FAT32 with LFN enabled. Firmware-generated recording names are ASCII. exFAT is not required. Mount failure never triggers automatic format.

### 3.17 15-second block language

Documentation no longer promises that sudden power loss is unconditionally limited to exactly 15 seconds of loss. LDC bounds an unfinished block and Sailball performs per-block durability barriers, but filesystem/media behavior remains part of the failure model.

## 4. Protocol Open Issues closed by this revision

- OI-01: SP/LDC fix type mapping.
- OI-02: Recorder session versus LDC file session identity.
- OI-03: active LDC metadata snapshot consistency.
- OI-04: Error Record shape and pagination behavior.
- OI-05: BLE Status/Event shape and advertising policy conflict.
- OI-09: UI timing classified as firmware tuning, not SP ABI.
- OI-10: Transfer READ/CLOSE boundary cases.
- OI-11: graceful reboot, abandoned Recorder STOP and advertising-intent portions.

## 5. Final protocol closure

The remaining OI-06/OI-07/OI-08/OI-11/OI-12 items were closed in the final v1.0 protocol pass. No v1.0 Open Issues remain.

- bootstrap minimum payload is 256 B; sequence=0 HELLO resets logical Session on an existing physical Transport;
- CBOR root is depth1/max6; public Counters are saturating uint64; age/range/last_error rules are frozen;
- BLE UUIDs are fixed: Service `ff26c6cf-0ed6-51c9-810d-b7bcfd0a9573`, RX `dc7fc9d8-c2cf-51e8-8c75-5aaef0042d68`, TX `0653875c-6670-562b-be88-54c11297fba7`;
- USB VID/PID/interface discovery is outside SP ABI;
- Recorder/Wi-Fi race response tables are frozen;
- unsupported Major, reserved header, request_id=0, duplicate pending request, SUBSCRIBE_EVENTS and oversized-response rules are frozen.

## 6. Authority order

1. `LDC_v1_Format_Specification-v1.0.md` — persistent bytes.
2. `sailball-protocol-v1.0.md` — SP wire behavior.
3. `sailball-client-interface-v1.0.md` — Controller guide.
4. `firmware-architecture-v1.0.md` — internal ownership/task/resource architecture.
5. `runtime-recovery-policy-v1.0.md` — runtime/recovery behavior.
6. `test-acceptance-v1.0.md` — acceptance evidence.

Future changes require an explicit additive v1.x specification or new major; implementations must not silently reinterpret frozen v1.0 behavior.
