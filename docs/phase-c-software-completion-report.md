# Sailball Phase C Software Completion Report

**HISTORICAL SNAPSHOT:** This report records the Phase C software completion run before the authorized Recorder pool reduction and Hardware Validation Phase 1F. Its artifact hashes and 30-test count are historical. Current status, 32-test result and profile artifacts are in `implementation-status-v1.0.md` and `build-and-test-v1.0.md`.

Date: 2026-09-29  
Target: ESP32-C3-WROOM-02-N4, 4 MiB flash, no PSRAM, ESP-IDF v6.1.

## 1. Result and scope

**PHASE C SOFTWARE COMPLETION = PASS.** Phase A software safety and Phase B software acceptance remain PASS after regression. H10-S remains FIXED. H10-F and hardware validation remain PENDING HARDWARE. No source change was made to the seven Frozen v1.0 documents, and no hardware was flashed, monitored, probed, or tested.

The current status documents and repository did not contain the original Phase C audit write-up with verbatim finding text. This work used the mapping in the user-provided Phase C request and checked each item against the Frozen requirements. The applied mapping is H07 event schemas, H09 health/readiness, M02 CBOR, M03 diagnostics ownership, M04 session/UI ownership, M05 protocol edge cases, and M06 integration evidence. No conflicting authoritative mapping was found.

## 2. H07 — event schemas and triggers

The Frozen event set was compared with production event generation. The production Control test decodes generated SP frames and CBOR payloads, and asserts EVENT type, zero request ID, service/message, field count, values, and sequence.

| Event | Frozen schema checked | Production trigger/state checked |
| --- | --- | --- |
| CORE.TRANSPORT_READY | Bootstrap event, existing TCP adapter regression | New physical TCP bootstrap |
| RECORDER.STATE_CHANGED | `{0:state, 1:session_id?, 2:reason?}` | State transition; optional session/reason fields |
| STORAGE.STATE_CHANGED | `{0:state}` | State transition |
| WIFI.STATE_CHANGED | `{0:state, 1:reason?}` | State/reason transition |
| WIFI.SCAN_COMPLETE | `{0:generation, 1:result_count}` | Completed scan generation and result count |
| BLE.STATE_CHANGED | `{0:state}` | State transition, no undefined reason field |
| DIAGNOSTICS.ERROR_RAISED | `{0:error_id, 1:service_id, 2:error_code, 3:severity}` | New legal error record notification |
| UI.PAGE_CHANGED | `{0:page}` | Page transition |

The production implementation no longer emits an invented CORE health event. Wi-Fi scan completion has its distinct event. Recorder/Storage/Wi-Fi/BLE/UI transitions use their Frozen schemas; diagnostics uses the fixed four-field form. Tests check duplicate state suppression and event behavior; ordinary events remain best effort as Frozen specifies. No GNSS or Transfer event was invented because Frozen defines none for those services.

## 3. H09 — health and readiness

The production Supervisor progress evaluator now models a recording start/recovery as awaiting a durable commit. Mount success, file open, metadata preparation, or submitted writes alone do not restore critical-path health. A durable commit from the current recording epoch restores health; an old-epoch commit does not.

The production Supervisor test covers cold/start state without a committed block, first commit, valid GNSS NO_FIX activity, GNSS silence, known storage failure, recovery remount, and a new-epoch durable commit. Valid sentence activity is kept distinct from position-fix availability. NO_FIX does not trigger GNSS restart. Genuine silence may request local GNSS recovery. The no-GNSS-started recording behavior remains allowed; health waits for the relevant durable progress rather than treating absence of UTC/fix as a storage failure.

The production System-to-UI snapshot test checks health, GNSS, Storage, USB, BLE, and Wi-Fi values composed from cached owner snapshots. UI reports health; it does not infer storage durability from a mount state.

## 4. M02 — CBOR structure and UTF-8

Production `sailball_sp` CBOR validation is exercised with a deterministic malformed corpus. It covers definite-length structure, unsupported major/simple forms, nested maps/arrays, integer map keys constrained to 0…255, duplicate nested keys, truncation, depth-limit behavior, and strict UTF-8 cases including malformed/truncated sequences, overlong encodings, surrogate values, out-of-range code points, and invalid continuation bytes. Inputs are bounded and malformed input is rejected without reading beyond the supplied payload. Frozen depth limit remains 6; root payload remains one map.

No floats, tags, undefined values, or indefinite-length encodings are accepted. The tests call the production CBOR parser/validator rather than a second parser model.

## 5. M03 — diagnostics ownership

Counters remain owner-mutated. Control no longer increments GNSS counters directly or counts a queued live sample as a physically transmitted frame. It submits a bounded telemetry note; the GNSS owner applies the live-drop metric. Transfer no longer mutates Storage-owned read-error state; it updates only Transfer-owned state. Architecture checks enforce these boundaries.

The production diagnostics test covers saturating public counters through `UINT64_MAX`, a bounded chronological Error Ring without coalescing, legal service/code/severity combinations, clear behavior without ID rewind, and error-ID exhaustion without wrap/reuse. Unsupported BLE and Storage error-ring entries were removed because Frozen allocates no matching BLE code and the old Storage code/severity combination was invalid. Storage's own counter remains available for that failure.

## 6. M04 — session and UI ownership

Logical SP sessions/subscriptions remain Control-owned; physical connection/framing state remains with Transport adapters. Phase B generation-scoped reset/disconnect tests remain in the regression suite.

Page requests now pass through a bounded mailbox and are applied by the UI owner. The production UI test checks owner-applied page changes, latest-request-wins behavior, and range rejection. Production System snapshot composition reads subsystem snapshots rather than UI walking storage files or parser internals. Frozen page behavior is retained: seven page IDs including reserved/unavailable Cellular, short press changes page, and long press has no v1 action.

## 7. M05 — protocol edges

Production Control tests and retained Phase B coverage check Frozen validation ordering: framing/cap and SP validity precede major/type/request/session semantics; service/command and transport permission precede payload validation where specified; field/range/state/resource checks precede execution. Tested competing-error cases include offline non-HELLO before unknown command, disallowed wireless operation before malformed CBOR, malformed Transfer READ before BUSY, and BUSY only after the request is otherwise valid.

The regression set retains HELLO/bootstrap sequence rules, request IDs, subscriptions (up to 32, duplicate services deduplicated and unknown services ignored), event framing, source permissions, response bounds, and Transfer READ's single BULK-on-success / one RESPONSE-on-failure contract. No Frozen permission or wire rule was changed.

## 8. M06 — production integration evidence

| Boundary | Production path exercised | Fake boundary / executable |
| --- | --- | --- |
| GNSS → Recorder | GNSS owner/backend, normalized fix queue, Recorder consume path | UART bytes and deterministic time; `phase-b-gnss-recorder.exe` |
| Recorder → Storage | Recorder block production and Storage critical commit | Filesystem/storage medium; `phase-b-three-owner-epoch.exe`, congestion integration executable |
| Storage → Transfer | Storage owner READ completion and Transfer lifetime/epoch handling | Filesystem and explicit scheduler/interleaving; three-owner epoch executable |
| Transfer → Control/BULK | Transfer result and Control/Transport BULK scheduling contracts, covered across owner and congestion harnesses | Completion/physical output fakes; Phase B Transfer and congestion executables. This is not claimed as one monolithic complete scheduler test. |
| Control → Transport | Production Control queue items, generation/priority ownership and Transport scheduling | Physical send primitives; Control session and congestion executables |
| BLE callback → Transport reassembly | Production callback adapter, bounded handoff and Transport-owned reassembly | NimBLE physical primitive; `phase-b-ble-owner.exe` |
| Wi-Fi socket → COBS/SP | Production socket adapter, stream delimiter, decode/validate and submission | Socket syscalls; `phase-b-wifi-tcp-adapter.exe` |
| Supervisor → subsystem health | Production Supervisor progress evaluation and health snapshot | Owner snapshot providers/time; `supervisor_health_test.exe` |
| UI → cached system snapshots | Production System-to-UI composition and UI owner page request | Subsystem getter providers/GPIO; `system_ui_snapshot_test.exe`, `ui_ownership_test.exe` |

The new tests invoke production owners/functions. Fakes replace external dependencies and deterministic scheduling boundaries. Some Phase B congestion tests use extracted production function bodies for adapter behavior; their fake physical/lifecycle boundary remains described in the Phase B report. This report does not claim real SD durability, physical GNSS correctness, runtime scheduler timing, or hardware wireless behavior.

## 9. Defects corrected and test observations

- Removed the unsupported CORE health event, implemented the distinct Wi-Fi scan completion payload, and aligned state/error events with Frozen fields.
- Corrected Supervisor readiness so a mount/reopen without a new durable block cannot restore recording health.
- Enforced nested CBOR map key and duplicate-key rules in recursive validation; extended UTF-8/depth/truncation negative cases.
- Restored owner boundaries for GNSS live-drop and Storage Transfer-read diagnostics; separated queued live data from physical TX accounting.
- Routed UI page changes through UI-owner application.
- Removed invalid diagnostics error records that used unallocated Frozen service/code/severity combinations.
- One initial H09 host case had a fixture ordering that made the Recorder sample stale before the intended first-commit timeout branch. The fake timestamps were corrected; the production health requirement was not weakened.
- During Frozen review, a temporary interpretation of the subscription limit as two was rejected and reverted before completion; Frozen explicitly allows up to 32. No Frozen file changed.

No unrelated feature or H10-F change was made. No Phase B architecture was redesigned.

## 10. Tests, builds, RAM and limits

Final recorded verification: 30/30 host executables PASS; architecture, metadata reachability, wireless admission, stack/frame gates PASS; DEV, VALIDATION, and PRODUCTION each freshly reconfigured, built, and linked. Exact executable hashes are in `build/test-artifact-manifest.json`.

| Profile | BIN | ELF SHA-256 | `.bss` | `.data` | Factory partition headroom |
| --- | ---: | --- | ---: | ---: | ---: |
| DEV | 987408 B | `ECA72E32430CC59ACA907319BE80E31A9C7D851E0247E9E36F9DFEFCA99B740B` | 212984 B | 14425 B | 585456 B |
| VALIDATION | 966512 B | `5BE9093B0C0A87A166470A3AC97DCC947AE4F323A515E0834FFD0A249824DF30` | 213480 B | 14425 B | 606352 B |
| PRODUCTION | 966096 B | `374545B9B44727965BAC1B0324A04BA66477B2E25672504B0E88AB65710243B6` | 212984 B | 14425 B | 606768 B |

PRODUCTION `.bss` is 16 B above the Phase C pre-build baseline (212968 B); `.data` is unchanged at 14425 B. The GNSS pending live-drop mailbox is 8 B; adjacent linker alignment/layout contributes to the section delta. No large frame buffer or unbounded allocation was added. Eight application task stacks passed the single-function frame gate. Full nested SDK/interrupt stack margin is not proven; runtime high-water marks are PENDING HARDWARE.

H10-S remains FIXED. H10-F remains PENDING HARDWARE: free heap, largest block, fragmentation, and BLE/Wi-Fi coexistence were not runtime measured. ATGM336H-6N74 remains the only GNSS backend; the vendor-neutral boundary remains and u-blox is not implemented.

## 11. Frozen integrity and next status

Seven Frozen document SHA-256 values were independently recalculated after Phase C and are unchanged:

| Frozen document | SHA-256 |
| --- | --- |
| `sailball-protocol-v1.0.md` | `6F2AC07126547BD1D3C2981AFC4805BECBDE18C7C54BC2F7F9ED516732C431A` |
| `sailball-client-interface-v1.0.md` | `1E7B5D14C8A89D4E1505C657E25B6A7F1E6CBE210FFEBEE62E3FB0EA643D1B3A` |
| `LDC_v1_Format_Specification-v1.0.md` | `78796316BFDB769DA2915A430A6696917CBCA707D53042FFCC9FB2C05442E7C6` |
| `firmware-architecture-v1.0.md` | `693A056CD702A1D7B797D4010F1A410C9010E5D3C2704251B2308E84F319636F` |
| `runtime-recovery-policy-v1.0.md` | `3B2F1C739C38F5B44CB0142925C64E49770F6AD9F7988A41EF480A554126A77E` |
| `test-acceptance-v1.0.md` | `06D0094A7455C1897A370D17D14CF6E97A83EDB67E37479AD766D1AF6974CB4A` |
| `CONSISTENCY-CHANGELOG-v1.0.md` | `02F35CC8A04488464AB4FD78D0E8F701596F43383B9FC7CBBB031D76937DA340` |

Recommended next step: plan hardware validation for H10-F, actual SD durability, GNSS module behavior, physical transport, and runtime stack/heap observations. Phase C PASS does not mean hardware, field, or release readiness.
