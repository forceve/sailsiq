# Sailball Test and Acceptance Policy v1.0

**Status:** Frozen v1.0 Final — Consistency Revision

## 1. Principle

“Build passes” is not a reliability acceptance result. Sailball v1 must prove that committed data remains parseable, data loss is never silent, network load cannot backpressure recording, failure/recovery follows the frozen policy and long runtime does not leak resources.

## 2. Acceptance levels

### Build Ready

- host/unit/static checks pass;
- ESP32-C3 target config succeeds;
- `idf.py build` passes.

### Lab Ready

- unit and component tests;
- protocol/LDC vectors;
- integration and fault injection;
- memory/queue pressure testing.

### Field Ready

- real GNSS and moving outdoor data;
- real SD cards;
- BLE/Wi-Fi handover/download;
- physical power cycles/card removal;
- long runtime.

### Release Ready

- VALIDATION profile passes required acceptance;
- critical cases repeated with PRODUCTION build.

Hardware-only tests must be reported `PENDING HARDWARE VALIDATION` when not actually executed.

## 3. LDC conformance

Tests must use the current LDC authority:

- Metadata Region 16 KiB;
- BlockHeader **96 B**;
- StreamDescriptor 16 B;
- Footer 16 B;
- correct little-endian explicit serialization;
- exact CRC32C vectors/coverage;
- FieldDefinition/Catalog/page-map/COW rules.

Old 64-byte-header prototypes are not valid acceptance fixtures.

## 4. LDC codec/golden tests

Cover:

- UVAR/SVAR/ZigZag extrema, truncation, overlong forms;
- RAW, DELTA_VARINT, CHANGE_VARINT, CONST_VARINT;
- circular delta wrap/tie;
- presence bitmap/popcount/tail bits;
- STREAM/CHANGE/CONST counts;
- deterministic golden files from fixed normalized inputs.

A refactor that changes frozen bytes must fail golden comparison unless the specification itself was intentionally revised.

## 5. Metadata COW crash testing

Inject failures before/after:

- inactive superblock invalidation;
- changed-page write;
- page flush;
- new superblock write/flush.

Readers must select the newest valid snapshot or valid older fallback as specified, never a torn metadata generation.

A block must never reference a definition that was not durably published first.

## 6. Two-barrier block commit tests

The writer must be instrumented/fault-injected at every stage:

```text
write header/directory/payload/bitmap/footer[0:12]
flush #1
write commit_magic
flush #2
```

Failures before flush #2 must **not** increment durable blocks, advance `readable_size`, release the Block Buffer as committed, or allow a later block to append to the same uncertain file.

Truncate/tear at every block byte and verify only the valid committed prefix is returned.

## 7. LDC per-field availability tests

Construct normalized GNSS where altitude/COG/position availability changes independently.

Verify Recorder closes the block and changes the descriptor field set rather than:

- writing fabricated zero;
- using the common Presence Bitmap as a per-field null bitmap.

Presence tests separately verify missing **whole sample slots**.

## 8. Identity tests

Verify:

- `device_id` remains stable across boots and SP 8 B LE representation matches LDC u64;
- `boot_id` is nonzero and changes per boot with overwhelming practical probability;
- SP Recorder uint32 `session_id` remains constant across normal file rollover;
- each new LDC file has a new 16 B `session_id`;
- `file_sequence` increments on normal rollover;
- `block_sequence` resets to 0 in each file;
- persistent Storage recovery creates a new Recorder session and new file identity.

## 9. SP frame/parser tests

Cover:

- exact 24-byte header and 28+payload total frame;
- CRC32C scope;
- LE fixed-width fields and independent CBOR rules;
- bad magic/length/CRC/COBS;
- oversize payload rejection before unbounded allocation;
- request_id rules and sequence wrap/gaps;
- duplicate/wrong-type/missing CBOR keys;
- CBOR root Map counts as depth1; maximum accepted nesting depth is 6.

Malformed external input must never crash or allocate by untrusted claimed length.

## 10. Permission matrix

Automate every command x source Transport. Any accidental wireless access to Recorder START/STOP, GNSS RESTART, SD DELETE/FORMAT, REBOOT or CLEAR_ERRORS is a failure.

Permissions are checked from actual Transport source, not payload.

## 11. Error Ring tests

Verify fixed v1 entry shape:

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

For each significant v1 error:

```text
first == last
occurrence_count == 1
```

Verify ascending pagination, recent-batch behavior without after_id, empty Ring oldest/newest=0, history-gap reporting when after_id is older than Ring contents, and `CLEAR_ERRORS` does not reset next_error_id or counters.

## 12. Recorder state machine

Cover at minimum:

```text
STOPPED -> STARTING -> RECORDING
RECORDING -> STOPPING -> STOPPED
START while RECORDING
START while STARTING
STOP while STOPPED
STOP while STOPPING
STOP during STARTING
STOP from abandoned ERROR
Storage unavailable during start
Storage failure during RECORDING
recovery with intent true/false
```

STOPPED after abandoned ERROR must not falsely imply the old file received a successful normal close.

## 13. Block Pool ownership

Legal ownership transition:

```text
FREE -> FILLING -> READY -> WRITING -> FREE
```

Epoch-abort cleanup is tested explicitly.

The v1 Recorder pool contains exactly three 8 KiB buffers. Tests must account for each buffer in exactly one state and exercise more than three reuse cycles. With all three buffers submitted or queued and Storage held, Recorder continues draining 10 Hz normalized fixes, reports new recording loss through Recorder-owned counters, and resumes automatically when Storage returns a buffer. Already accepted buffers must not be sacrificed at a clean SIZE_LIMIT boundary. Saturated rollover and epoch abort must leave no leaked or duplicated buffer ownership. Storage remains the sole physical critical writer, even while multiple Recorder buffers are marked WRITING pending their acknowledgements.

Illegal double-owner or impossible transition is a fatal invariant, not silently repaired.

## 14. Queue-pressure/data-accounting tests

Artificially delay Storage over increasing ranges and capture:

- Fix Queue depth/high-water;
- Block Pool free minimum;
- critical/background queue high-water;
- `sample_seq` gaps;
- GNSS queue drops;
- Recorder loss/unrecorded outcomes;
- health transitions.

Within validated capacity there must be zero recording loss.

Beyond capacity, all loss must remain explainable. Unknown disappearance is release-blocking.

## 15. Counter ownership/accounting

Tests must ensure tasks update only their owned counters. Example:

- GNSS counts queue drops;
- Recorder derives input sequence gaps from `sample_seq`;
- Storage counts commit/write outcomes.

Public SP counters may be coarser than internal validation metrics, but no task may mutate another owner's bookkeeping to make totals “look right”.

## 16. Storage latency validation

Measure block write, first sync, commit-magic write, second sync and total durable commit latency. Collect distribution (typical/P95/P99 where meaningful/max).

Use measured results to tune queue depth, pool count, stacks and Task WDT rather than asserting that three 8 KiB buffers equal a fixed number of seconds.

## 17. Storage transient/persistent fault injection

Inject:

- single write failure;
- first sync failure;
- commit-magic write failure;
- second sync failure;
- repeated failure;
- mount failure;
- card removal;
- no-space.

Transient recovery must preserve the original RAM block until commit succeeds.

Persistent/uncertain-tail failure must trigger Storage Epoch Abort, release queues/buffers with explicit loss accounting, never append the failed file again, and recover into a new Recorder session/file when intent=true.

## 18. No-space test

Fill the media until configured reserve is reached.

Expected:

- recording cannot continue normally;
- no auto-delete/auto-format;
- mounted read/list/download/delete may remain functional;
- freeing space via USB DELETE allows intent=true to create a new session/file.

Test on small FAT16/FAT32 media as well as larger cards; firmware may not assume >=1 GiB capacity.

## 19. SD removal/reinsertion

Remove card during recording.

Expected:

- GNSS remains serviced;
- UI/communications remain alive if otherwise healthy;
- Storage epoch is abandoned;
- buffers are eventually released/accounted;
- reinsertion/remount starts a new Recorder session when intent=true;
- old file is never appended.

## 20. Active LDC transfer consistency

While recording and while metadata COW updates are occurring:

1. OPEN_READ active file;
2. verify frozen N;
3. read Metadata Region in multiple chunks interleaved with new metadata publications;
4. download Data Region prefix;
5. verify downloaded first 16 KiB exactly match OPEN_READ-time RAM snapshot;
6. verify no bytes beyond N are exposed;
7. verify the resulting snapshot passes LDC validation for the frozen prefix.

A second global Bulk Transfer must return BUSY.

## 21. Transfer edge cases

Verify:

- READ length=0 -> OUT_OF_RANGE;
- offset==N and offset>N -> OUT_OF_RANGE;
- EOF final short BULK allowed;
- non-EOF underlying short read is internally completed or returns IO_ERROR;
- one outstanding READ maximum;
- CLOSE correct ID/no outstanding -> OK;
- CLOSE same ID/outstanding -> BUSY;
- CLOSE wrong ID while a transfer exists -> NOT_FOUND;
- no active Transfer -> CLOSE OK;
- disconnect invalidates transfer handle.

READ success returns exactly BULK, not OK RESPONSE + BULK.

## 22. GNSS fault tests

Separate:

- NO_FIX with valid messages: no restart solely for no fix;
- UART silence: progress recovery;
- malformed stream/no valid messages: parse counters then recovery;
- GNSS restart: LDC block discontinuity but normally same file/session.

Verify internal fix states map independently to LDC and SP enums.

## 23. UTC tests

Cover startup without UTC, acquisition, invalidation, source/mapping change, forward/backward discontinuity and recovery. Verify block boundaries and immutable historical blocks.

## 24. Network isolation

During continuous recording deliberately:

- stop reading TCP;
- saturate BLE notifications;
- flood status/invalid requests within transport bounds;
- download active LDC;
- run GNSS live stream.

Within valid Storage capacity, Recorder loss remains zero. Only transport/live/transfer counters may increase.

## 25. Live overload

Make source GNSS rate much higher than delivery rate. Verify newest live sample replaces stale pending sample, latency remains near-current, drop counters rise and Recorder remains unaffected.

## 26. BLE/Wi-Fi handover

Successful path:

```text
BLE HELLO -> configure/scan -> Controller listener ready -> WIFI.CONNECT
-> outbound TCP -> TRANSPORT_READY -> TCP HELLO -> WIFI ONLINE
-> Controller disconnects BLE
```

Verify the device does **not** automatically kick the existing BLE connection merely because Wi-Fi became ONLINE.

Failure at AP/auth/DHCP/TCP/HELLO keeps the original BLE Session usable.

## 27. advertising intent

Test `BLE.SET_ADVERTISING(false)` followed by Wi-Fi connect/end. Advertising must remain off after Wi-Fi ends. Setting true while BLE connected/Wi-Fi online stores intent but does not force immediate simultaneous advertising.

## 28. Wi-Fi recovery

Test FIN, RST, AP loss, router reboot and controller disappearance.

- FIN -> no reconnect, Wi-Fi OFF.
- abnormal -> finite retry/backoff, then OFF.
- BLE fallback occurs only when advertising intent permits.

Recorder remains unaffected.

## 29. Task WDT/progress watchdog

Test actual task execution hangs separately from stalled peripheral progress.

- critical task stuck in non-returning driver call -> Task WDT reset expected;
- task loop alive but GNSS/Storage progress stopped -> Supervisor local recovery expected;
- UI task failure alone must not reset logger.

## 30. Intent-aware health

Verify:

- intent=true + no recording progress -> unhealthy;
- successful recovery requires real progress before healthy returns;
- USB STOP -> intent=false + STOPPED can remain healthy;
- network offline has no effect on critical health.

## 31. Memory stress and leak testing

Worst expected combination:

```text
Recorder active
GNSS max configured rate
BLE connected
Wi-Fi/TCP ONLINE
Live stream
Bulk transfer
SD commit
Diagnostics requests
```

Measure free/minimum heap, largest free block and every task stack high-water mark.

Repeat BLE connect/disconnect, Wi-Fi handover and Transfer open/close many times. Stable baseline heap is required; per-cycle leaks are release blockers.

## 32. Build-profile validation

Reliability timing is validated primarily using VALIDATION profile: production-like logging volume with counters/high-water/latency metrics enabled.

PRODUCTION must repeat critical LDC/recording/fault tests.

USB SP and textual console must never share the same production byte stream.

## 33. Automated architecture checks

Where practical CI/scripts should reject forbidden dependencies, for example:

- Recorder includes SP/Wi-Fi/BLE/USB internals;
- Transfer includes FatFS/SD internals;
- Control includes GNSS private driver headers;
- cyclic ESP-IDF component REQUIRES relationships;
- critical large arrays allocated on task stacks.

## 34. Soak/field acceptance

Planned stages: at least 24 h then 72 h, with longer multi-day testing desirable.

Exercise periodic BLE/Wi-Fi lifecycle, live stream and download while recording. At completion:

- every LDC parses to its valid committed prefix;
- every discontinuity/loss/reset is explainable;
- no unexplained reset;
- no heap baseline decay;
- no stack/queue bound violation.

## 35. Release-critical requirements

Release is blocked unless all are demonstrated:

1. previously committed LDC blocks survive interruption to a verifiable prefix;
2. two-barrier writer order is implemented exactly;
3. no sample loss is silent;
4. validated short Storage stalls cause no recording loss;
5. persistent Storage failure abandons old file and recovers to a new session/file;
6. NO_FIX does not cause false GNSS failure recovery;
7. network/transfer/UI backpressure cannot stall Recorder;
8. active transfer metadata snapshot is internally consistent;
9. network lifecycle has no persistent heap leak;
10. worst supported runtime has no OOM/stack overflow;
11. intentional Recorder STOP is not misreported as critical failure;
12. long soak produces only explainable faults/discontinuities.


# 40. Protocol Edge-Rule Acceptance

- HELLO with max_rx_payload=255 returns OUT_OF_RANGE; 256 succeeds when otherwise valid.
- TCP TRANSPORT_READY is device sequence0 and normal HELLO RESPONSE is device sequence1.
- On an ONLINE physical connection, valid HELLO with sequence0 clears old Session Transfer/subscriptions/live/pending state and starts a new logical Session; nonzero-sequence repeated HELLO returns INVALID_STATE.
- request_id=0 REQUEST is dropped without response; duplicate pending request_id is not executed twice.
- Major !=1 is dropped without v1 response.
- Nonzero v1 Flags/Channel/Reserved REQUEST returns UNSUPPORTED; the same defect on non-REQUEST messages is dropped.
- CBOR root Map counts as depth1; depth6 accepted, depth7 rejected.
- Public Counter values are uint64 and saturate at UINT64_MAX without wrap.
- BLE uses the exact frozen UUIDs; frame_id starts0; duplicate/gap/overlap/changed total_length/empty/overflow fragments drop current assembly.
- USB host discovery is not asserted by SP tests; identity is verified via HELLO device_id.
- Recorder START/STOP race table and Wi-Fi CONNECT/DISCONNECT race table match Protocol v1.0.
- LIST_FILES/GET_ERRORS may reduce returned entry count to fit peer max_rx_payload; GET_STATUS/GET_COUNTERS/GET_SCAN_RESULTS/GET_INFO return OUT_OF_RANGE rather than truncating when complete success cannot fit.
- SUBSCRIBE_EVENTS accepts at most32 IDs, removes duplicates and ignores unsupported IDs.
- Error precedence follows the frozen validation order.
