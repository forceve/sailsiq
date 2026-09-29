# Sailball Phase B Functional Correctness Report

**HISTORICAL SNAPSHOT:** This report records Phase B acceptance on the previous four-buffer Recorder pool. The explicitly authorized Phase 1F revision uses three 8 KiB buffers; its affected Recorder/Storage cases were revalidated at 10 Hz. See `implementation-status-v1.0.md` and `build-and-test-v1.0.md` for current status and artifacts.

> **Historical snapshot — Phase B implementation close, before Phase B independent acceptance and before Phase C.** Its test count, ELF hashes, RAM values, and “Phase C not started” statements describe that earlier point in time. Current project state and final profile artifacts are in `implementation-status-v1.0.md` and `build-and-test-v1.0.md`; Phase C results are in `phase-c-software-completion-report.md`.

## Phase B close claim - 2026-09-29 snapshot

The A01-A11 and II-01-II-04 defects/evidence gaps remain closed. The III-01 to III-03 race repairs are implemented: Control retains TX queue ownership through a generation-checked adapter handoff; Storage publication claims have tokenized final completion; BLE invalidates the Control-visible generation immediately. Deferred Control cleanup now records the invalidated generation and cannot clear a fresh same-link HELLO session. Phase B implementation claim: PASS; focused independent strict read-only acceptance: PENDING. H10-S remains FIXED; H10-F remains PENDING. No hardware validation or Phase C work occurred.

The III regression harness exercises two HELLO generation advances before candidate commit, an old BLE HELLO queued across fast session invalidation, fresh same-link HELLO before old deferred cleanup, no-fresh cleanup, multiple invalidations, and Storage abort after fake USB/BLE/TCP physical output has accepted bytes but before the production adapter can complete the Transfer result. The fresh HELLO response remains Control-owned and is committed exactly once after stale cleanup becomes a no-op. This deterministic fake schedule is software evidence, not hardware timing evidence.

Current fresh artifacts (2026-09-29): DEV ELF `A6D4C437ED711B1A36C531AE2E3CDC57A42BDAC09385C5C2BD4BBE4A301F3DFB`, VALIDATION `3128CF2678AEC29D6D339E022FCBED9CA3658B85C97ED125B63E28C0CB7780DD`, PRODUCTION `B1748523D13C4695710E172DA680E8A282AB69ECCD234D3F0F88AF443F3515CF`. Full sizes and section measurements are in `build-and-test-v1.0.md`.

- A01: COBS output streams from disjoint header/payload/CRC input; long nonzero runs and maximum legal frames pass USB/TCP wire regression.
- A02 / II-01: clean SIZE_LIMIT retains the triggering block and already queued READY blocks in the existing four-buffer pool. Storage opens the next file, publishes metadata, rewrites each retained block file-local sequence and commits the same buffers. Normal rollover preserves recorder session identity, increments file sequence, creates a new physical file session, resets block sequence to zero and does not count loss. An existing Transfer reader on the old file remains open.
- A03/A04 / II-02: Transport synchronizes each adapter generation after draining ingress and before selecting Control output. HELLO RESPONSE is delivered once at the correct sequence; BLE logical reset preserves physical fragment frame-ID progression.
- A05/A06/A08: terminal traffic uses a four-frame streak limit when BULK waits; BLE terminal sends have a five-second stall deadline; TCP bootstrap starts its own stall clock at activation.
- A07: FIN preserves complete inbound TCP frames until the production Transport drain submits them to Control. Partial final frames are discarded.
- A09 / II-03: the Storage epoch claim is the serialized canonical-to-physical publication point. Queued stale BULK is rejected; USB/TCP/BLE recheck after each physical operation that may yield. An epoch abort during partial publication ends the corresponding session/connection before the result can complete successfully. Storage never holds its epoch lock over physical I/O.
- II-04: stale BLE BULK invalidates the logical SP session before best-effort physical disconnect; a failed terminate does not preserve the old logical session.
- A10: the combined congestion harness compiles current production BLE/Wi-Fi TX and generation-setter function bodies with fake physical notify/socket primitives. It still fakes selected disconnect/recovery helpers; this is function-level physical-adapter evidence, not full wireless integration. Exact production-source and extracted-body hashes are in `build/phase_a_tests/extraction_manifest.json`; executable and source hashes are in `build/test-artifact-manifest.json`. Final Four interleavings inject Storage epoch abort from inside USB write, BLE notify and partial TCP send, reject false BULK completion, consume the real Transport session-end signal, and establish a fresh logical BLE session even when physical terminate fails.
- A11: the fixed metadata-profile gate checks production publication/count source shape across component C files and rejects four negative fixtures. It is **not** a general C call-graph proof; changes beyond its recognized source shape require manual H04 review.
- III-03 deferred cleanup: each pending cleanup stores the generation being invalidated, not its successor. Generation advance and cleanup-token creation are serialized together. Control applies cleanup only while the live generation is exactly the token's successor; after a fresh HELLO advances again, the stale token is discarded. Repeated fast invalidations coalesce to the latest invalidated generation. The production-owner host test covers fresh HELLO before cleanup (including exactly-once RESPONSE ownership), cleanup without a fresh HELLO, multiple invalidations, and preservation of newer-generation state.

The earlier sections below are a **historical snapshot**. Their build hashes and evidence descriptions are superseded by this section and the current build report.

At this snapshot, `scripts/test.ps1` passed with 26 native host executables. The artifact manifest records executable hashes, production source inputs and extraction hashes, including the updated Control test and `control.c`. Architecture, metadata reachability, stack/frame and H10-S gates passed. DEV, VALIDATION and PRODUCTION were freshly reconfigured and linked. Seven Frozen document SHA-256 values were unchanged. No flash, monitor or board test occurred.

Artifact identity reconciliation: the pre-repair production ELF hash recorded in the prior build report was `0E0DD9D6E85DFF2A6B9A13855C3961F60FDC7C6F45CC3B5F483C3EED420AEB59`. The different hash string transcribed in the repair prompt did not match that prior report. This repair records the freshly rebuilt artifacts below.

Updated: 2026-09-29. Target: ESP32-C3-WROOM-02-N4, ESP-IDF v6.1.

## Result

**PHASE B IMPLEMENTATION CLAIM = PASS; PHASE B SOFTWARE ACCEPTANCE = PENDING.** H04 is closed by a bounded production metadata-state proof, and H05 by a combined production-owner congestion test that reaches the BLE notify and TCP socket send adapters. The final three race fixes are included in the current implementation and host evidence. No Phase C work or hardware validation was performed. H10-F remains PENDING.

| Finding | Status | Evidence and remaining gap |
| --- | --- | --- |
| C02 | FIXED | `wifi_tcp_adapter_test.c` drives production `receive_tcp`, `queue_tcp_frame` and `send_queued_tcp` with a fake socket. One, bytewise, split, two and three-frame RX; empty/malformed/oversized/CRC-invalid frames; FIN mid-frame and after delimiter; and partial/nonblocking TX pass. Golden wire is COBS(SP)+0x00. |
| C04 | FIXED | `recorder_block_sequence_test.c` drives production Recorder and LDC at 1/3/4/10 Hz. Jitter, missing slots, availability and UTC transitions, early close, STOP and 15-second limit pass; emitted block headers, presence bits, rational slot counts and exclusive interval nonoverlap are checked. |
| H01 | FIXED | Existing production profile publish, durable reload and validation test passes. |
| H02 | FIXED | Expanded `gnss_recorder_integration_test.c` drives fake UART bytes through production GNSS owner, ATGM parser, normalized Fix Queue and Recorder. RMC/GGA/GSA 2D/3D, missing GSA, mixed talker/order, RMC V, GGA quality zero, partial fields, checksum/malformed-number recovery, bytewise and multi-sentence chunks, UTC epochs, silence, drop-newest and sample-sequence gap pass. Hardware ATGM validation remains pending. |
| H03 | FIXED | New `epoch_three_owner_test.c` runs production Recorder, Storage and Transfer together against a fake filesystem. Active Transfer, queued WRITING blocks and a FILLING block experience critical sync failure; all four block buffers become reusable and loss is accounted. Failed then successful remount creates a new Recorder session/file identity. A pending Transfer READ is interrupted by another Recorder-submitted failing write; old epoch/Transfer completion cannot publish data into the new epoch. |
| H04 | FIXED | Current production profile publishes exactly seven catalog entries and seven definitions, once per fresh file, against capacities 64 and 256. Availability only selects subsets of those version-1 descriptors; it cannot grow metadata. `check_v1_metadata_reachability.py` fails closed if the publication graph/profile changes. **Metadata-capacity rollover is unreachable in the current v1 production profile**, not a simulated passing branch. Existing production Storage and Recorder tests verify size rollover identity, queued no-space handling/restoration, and persistent uncertain-I/O new-session identity. |
| H05 | FIXED | `congestion_storage_commit_test.c` runs production Control, Transport, Recorder and Storage together with production BLE TX queue/notify and Wi-Fi TX queue/COBS/socket-send function bodies extracted from current source at test time. NimBLE mbuf/notify, socket `send` and physical disconnection are faked. Under stalled USB, failed BLE notify, TCP EWOULDBLOCK/zero progress and terminal/event/live/BULK backlog, 40 fixes are consumed and multiple critical writes complete two flushes each; `readable_size`, file length, LDCM marker and block return agree. Bounded partial TCP send and BLE notify recover, terminal frames and BULK complete. Separate C02/H11 tests cover production adapter disconnect behavior. |
| H06 | FIXED | Production Control HELLO/reset/generation tests include fast invalidation followed by fresh same-link BLE HELLO before deferred cleanup; old cleanup is a no-op and the new HELLO RESPONSE remains owned and is handed off exactly once. |
| H11 | FIXED | `ble_owner_integration_test.c` drives production NimBLE RX callback, bounded fragment handoff and Transport-owner reassembly through normal frames, queue full, timeout, duplicate/overlap/gap/changed-total fragments, replacement, disconnect/reconnect and frame-ID wrap. Slow production USB/TCP partial sends allow owner service. The wrap test seeds only the parser's expected-ID boundary; callback and owner still process both frames. |
| H12 | FIXED | The fake filesystem drives production `storage_task`: long LIST yields between bounded slices while an injected critical block is served; high-priority Transfer READ gets service after four critical writes; critical work resumes; epoch abort interrupts an active LIST and completes its waiter. Architecture gate confirms actual `vTaskDelay(1u)` rather than a zero-tick `pdMS_TO_TICKS(1)` assumption. |
| M01 | FIXED | DEV, VALIDATION and PRODUCTION generated configs remain 4 MiB and all images fit the 0x180000 factory partition. |

H07, H09 and M02-M06 remain outside this work.

## H04 production metadata state space

The only Storage publication call is `publish_gnss_profile()` in `create_recording()`, after `sb_ldc_metadata_initialize()` starts a fresh file. The publication writes catalog IDs 1–7, seven fixed version-1 definitions and 12 auxiliary bytes. The LDC bank limits are 64 catalog entries and 256 definitions. Recorder block construction selects a subset of field IDs 1–7 as availability changes and always writes `definition_version=1`; it never publishes a new definition. Repeated blocks therefore add zero metadata entries, and rollover/new-session files begin with a new metadata state. The current legal maximum **per file** is 7 catalog entries, 7 definitions and 12 auxiliary bytes. `SB_STORAGE_REASON_METADATA_FULL` is not emitted by production Storage under this profile. The generic Frozen capacity behavior remains specified for format completeness. A future profile or publication call-graph change invalidates this proof and trips `check_v1_metadata_reachability.py`.

Production Storage tests cover size boundary, queued READY blocks under known no-space, restoration, new file creation and persistence of a distinct caller-provided 16-byte file session ID. Recorder tests assert size rollover keeps `recorder_session_id`, increments `file_sequence` and resets block sequence; the three-owner epoch test asserts persistent uncertain I/O starts a new Recorder session with file sequence and block sequence zero. Metadata-capacity rollover is classified **NOT APPLICABLE / UNREACHABLE** for current v1 production, not reported as a runtime-tested branch.

## H05 physical-adapter schedule

The combined harness automatically extracts the BLE queue/notify and Wi-Fi queue/COBS/TCP-send function bodies from current production source on every test run. Real Control and Transport scheduling passes frames into those functions. The fake NimBLE notify rejects fragments then recovers; the fake socket returns EWOULDBLOCK, zero progress, then three-byte partial sends. During the blocked interval, production Recorder consumes 40 fixes and production Storage makes multiple two-flush LDC commits, advances `readable_size` only after commit and returns buffers. The recovery phase drains terminal traffic and the queued BULK frame. Finally the fake physical links disconnect during active TX and production Control closes their logical sessions. The separate C02/H11 tests retain the full TCP RX and BLE callback/owner disconnect recovery coverage; this combined harness specifically proves physical TX congestion does not stop durable critical progress.

## Integration work and defects found

The prior integration harness families remain. This closure extends the combined Control+Transport+Recorder+Storage binary with automatically extracted production BLE and Wi-Fi TX functions. The fake layer implements only the physical notify/socket calls and scheduler/filesystem; production queueing, fragmentation, COBS encoding, partial-send offsets and completion logic execute in the same deterministic schedule as durable Storage commits. The GNSS-to-Recorder parser matrix and Recorder+Storage+Transfer epoch test remain passing.

Across the integration work, tests exposed three local production defects:

1. Wi-Fi `receive_tcp()` discarded bytes returned in the same `recv` as FIN. It now processes those bytes and the completed COBS delimiter before handling close.
2. Storage returned NO_SPACE for the first block but treated already queued READY blocks as an I/O fault, aborting the epoch. The Storage owner now retains the known no-space condition until a new file is successfully created or the epoch is aborted, so queued blocks receive NO_SPACE.
3. A checksummed RMC sentence with malformed numeric coordinates could create an empty epoch and later emit a phantom NO_FIX. The parser now publishes an epoch only after a valid RMC or GGA contributed data. Valid RMC V and GGA quality-zero NO_FIX reports still publish.

That earlier statement applies to the H04/H05 closure snapshot only. The later independent audits found III-01/III-03 generation invalidation races and the III-02 final publication race; this report's current top section records their repairs. No test was weakened. Existing Phase A groups and seven Transfer/RPC schedules remain in `scripts/test.ps1`.

## Test and build evidence

`scripts/test.ps1`: **PASS, exit 0**, 26 native host executables. Architecture, v1 metadata reachability, eight-task stack/frame, generated profile configuration and H10-S gates pass. H10-F remains pending. Deterministic Final Three tests cover candidate generation advances, stale BLE request suppression after fast invalidation, and accepted USB/BLE/TCP output followed by Storage epoch abort with no successful completion. The deferred-cleanup regression additionally verifies same-link fresh HELLO supersession, cleanup without a replacement session, coalesced repeated invalidations, newer state preservation and exactly-once terminal handoff.

All profiles were reconfigured, compiled and linked after the latest production edits:

| Profile | BIN bytes | ELF SHA-256 | `.bss` | `.data` | IDF DRAM use | Factory partition free |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| DEV | 985936 | A6D4C437ED711B1A36C531AE2E3CDC57A42BDAC09385C5C2BD4BBE4A301F3DFB | 212968 | 14425 | 320559 / 321296 | 586928 |
| VALIDATION | 965040 | 3128CF2678AEC29D6D339E022FCBED9CA3658B85C97ED125B63E28C0CB7780DD | 213464 | 14425 | 320859 / 321296 | 607824 |
| PRODUCTION | 964624 | B1748523D13C4695710E172DA680E8A282AB69ECCD234D3F0F88AF443F3515CF | 212968 | 14425 | 320363 / 321296 | 608240 |

The PRODUCTION raw main RAM tail is 72,656 bytes. Linker-region use is not a runtime free-heap measurement. The compiled gate reports single frames below their task allocations; the largest known frames are 2,240 B (Control/Transport), 1,440 B (Recorder) and 1,344 B (Storage). Full nested/indirect call-chain and runtime watermark margins remain unverified without hardware.

## Readiness and next step

C01, C03, H08 and H10-S remain FIXED. H10-F and full Phase A runtime acceptance remain PENDING. Frozen v1.0 documents, protocol and LDC format were not changed. No flash, monitor or physical board test occurred.

The next step is an independent **strict read-only Phase B acceptance audit**. This implementation claim does not verify physical BLE/Wi-Fi throughput, heap coexistence or hardware SD durability; those remain pending hardware validation. Phase C was not started.
