# SailSIQ Multi-Track Foundation Upgrade

> Goal: upgrade Replay and session storage from a single `track.json` model to a track-aware model that still behaves exactly like the current single-track product, while preparing for long sessions split across files and future multi-boat comparison.

## 1. Why This Comes First

Automatic maneuver detection should generate normal `SessionEvent` records. Once a session can contain more than one track, every event and highlighted range must know which track it belongs to.

If tack/gybe/rounding detection is implemented first against the current single `telemetry: TrackPoint[]` model, these surfaces will need rework later:

- event selection
- map route highlighting
- telemetry chart ranges
- timeline markers
- video sync context
- later multi-boat comparison

The right first step is not to build the full multi-boat UI. The right first step is to make the data model and Replay state track-aware while preserving the existing single-track experience.

## 2. Product Scope

### In Scope

- One session can contain one or more logical tracks.
- A logical track can contain multiple source segments from split files.
- Existing single-track sessions continue to load and display.
- Replay still defaults to one primary active track.
- Events and selected ranges can refer to a specific track.
- The legacy `/track` API and `track.json` remain compatible as primary-track shortcuts.

### Out of Scope For This Phase

- Full multi-boat race comparison UI.
- Advanced track alignment controls.
- Team/boat roster management.
- Automatic merging of overlapping files with conflict resolution.
- ML-based analysis.

## 2.1 Foundation Quality Bar

This phase is intentionally small, but it must be a real foundation. The implementation should reduce future migration cost, not hide single-track assumptions behind new names.

Hard requirements:

- Track identity is explicit and stable. Every `TrackStream` has an ID that is safe to reference from events, selections, video alignment, future comments, and exported artifacts.
- Session time remains the shared coordinate system. `TrackPoint.t`, event times, selected ranges, and video offsets all stay on session-local milliseconds.
- The primary track is only a default, not a data-model shortcut. Code may derive an active/primary track for current UI, but persisted records should not depend on array index `0` as identity.
- A split file and a different boat are different concepts. Split files become `TrackSegment[]` under one `TrackStream`; different boats become separate `TrackStream` records.
- Course marks remain session-level objects. Do not duplicate marks per track.
- Events remain session-level annotations that may reference a `trackId`. Do not store events inside track point files.
- Legacy compatibility must be isolated at read/write boundaries. Internal Replay state should not keep branching on `track.json` after data is loaded.
- No new feature should require rewriting imported point arrays just to attach derived metadata.

Implementation quality checks:

- There is one helper for resolving legacy event/range track IDs to the primary track.
- There is one helper for deriving the active track's point array.
- There is one helper for converting imported file time into session time.
- Components receive explicit `trackId` when a selected range or event is track-specific.
- Tests or fixtures cover old single-track sessions and new multi-track sessions.

## 3. Concepts

### Session Timeline

The session timeline remains the global time axis in milliseconds. All tracks, videos, events, and ranges are positioned on this axis.

### Track Stream

A `TrackStream` is a logical boat/device track inside a session.

Examples:

- `primary` track from a single GPX file.
- `primary` track composed from three consecutive GPX files.
- `boat-a` and `boat-b` tracks in the same session for later comparison.

### Track Segment

A `TrackSegment` is one imported source file or one continuous portion of a source file. Multiple segments can belong to the same `TrackStream`.

Use segments for long sessions split across files. Use multiple track streams for different boats.

## 4. Data Model

Add these types to `app/frtend/src/types/models.ts` and mirror them in `app/backend/src/types.ts`.

```ts
export type TrackRole = 'primary' | 'comparison';

export interface TrackSegment {
  id: string;
  trackId: string;
  sourceFileName?: string;
  sourcePath?: string;
  startMs: number;
  endMs: number;
  pointCount: number;
}

export interface TrackStreamStats {
  duration: number; // seconds
  distance: number; // meters
  maxSpeed: number; // knots
  avgSpeed: number; // knots
  turnCount: number;
}

export interface TrackStream {
  id: string;
  sessionId: string;
  name: string;
  role: TrackRole;
  boatId?: string;
  color?: string;
  visible: boolean;
  locked?: boolean;
  trackTimeOriginUnixMs?: number;
  offsetMs?: number;
  segments: TrackSegment[];
  stats: TrackStreamStats;
  createdAt: string;
  updatedAt: string;
}

export interface TrackStreamBundle {
  track: TrackStream;
  points: TrackPoint[];
}
```

Update `SessionEvent`:

```ts
export interface SessionEvent {
  id: string;
  sessionId: string;
  trackId?: string; // optional for legacy events; resolved to primary at runtime
  timestamp: number;
  startTime?: number;
  endTime?: number;
  type: EventType;
  note: string;
  snapshotUrl?: string;
  autoDetected?: boolean;
  verified?: boolean;
}
```

Update `WorkspaceRangeSelection` in `app/frtend/src/types/workspace.ts`:

```ts
export interface WorkspaceRangeSelection {
  trackId?: string; // optional for legacy range state
  startMs: number;
  endMs: number;
  source: 'speed' | 'heading' | 'vmgToWind' | 'turnRate';
}
```

## 5. Storage Layout

### Current Layout

```text
sessions/<sessionId>/
  session.json
  track.json
  events.json
  marks.json
  bindings.json
```

### New Layout

```text
sessions/<sessionId>/
  session.json
  tracks.json
  tracks/
    <trackId>.json
  events.json
  marks.json
  bindings.json
```

`tracks.json` stores `TrackStream[]`. Each `tracks/<trackId>.json` stores `TrackPoint[]`.

Keep reading legacy `track.json`. During migration or next write, create:

```text
tracks.json
tracks/primary.json
```

The legacy `track.json` can be kept as a compatibility copy for one release cycle. New code should read `tracks.json` first.

## 6. API Shape

Keep existing endpoints:

```text
GET  /v1/sessions/:id/track
POST /v1/sessions/:id/track
```

Their meaning becomes: get or replace the primary track.

Add track-aware endpoints:

```text
GET    /v1/sessions/:id/tracks
POST   /v1/sessions/:id/tracks
GET    /v1/sessions/:id/tracks/:trackId/points
PUT    /v1/sessions/:id/tracks/:trackId
DELETE /v1/sessions/:id/tracks/:trackId
POST   /v1/sessions/:id/tracks/:trackId/segments
```

Suggested payloads:

```ts
// POST /tracks
{
  name: string;
  role?: 'primary' | 'comparison';
  boatId?: string;
  color?: string;
  points: TrackPoint[];
  sourceFileName?: string;
  trackTimeOriginUnixMs?: number;
}

// POST /tracks/:trackId/segments
{
  points: TrackPoint[];
  sourceFileName?: string;
  sourcePath?: string;
  appendMode: 'append' | 'insert-by-time';
  trackTimeOriginUnixMs?: number;
}
```

## 7. Frontend State

Current Replay state:

```ts
const [telemetry, setTelemetry] = useState<TrackPoint[]>([]);
```

Target state:

```ts
const [tracks, setTracks] = useState<TrackStream[]>([]);
const [trackPointsById, setTrackPointsById] = useState<Record<string, TrackPoint[]>>({});
const [activeTrackId, setActiveTrackId] = useState<string | null>(null);
```

Derived compatibility values:

```ts
const activeTrack = tracks.find((track) => track.id === activeTrackId) ?? tracks[0] ?? null;
const telemetry = activeTrack ? trackPointsById[activeTrack.id] ?? [] : [];
const primaryTrackId =
  tracks.find((track) => track.role === 'primary')?.id ?? tracks[0]?.id ?? 'primary';
```

This lets most existing components continue to receive `telemetry` while the page becomes track-aware internally.

## 8. Component Changes

### ReplayWorkspacePage

Primary ownership:

- load tracks and point arrays
- resolve legacy event/range `trackId`
- maintain `activeTrackId`
- filter events by active track unless multi-track display is enabled
- derive `highlightedRange` using the selected range's track

### MapCanvas

Phase 1 can stay single-track by receiving the active track points as `telemetry`.

Phase 2 should accept optional multi-track overlays:

```ts
trackLayers?: Array<{
  track: TrackStream;
  telemetry: TrackPoint[];
  active: boolean;
}>;
```

Rendering rule:

- active track: current route styling
- inactive visible tracks: thinner, lower opacity, track color
- selected range: highlight only the range's `trackId`

### AdaptiveTelemetryPanel

Phase 1: show active track only.

Phase 2: support track selector or multiple chart series.

### Timeline

Phase 1: events filtered to active track.

Phase 2: display event markers colored by event type and optionally grouped by track.

## 9. Import Behavior

### Create New Session From One File

- Create one `TrackStream` with `role: 'primary'`.
- Store points under `tracks/<trackId>.json`.
- Also write legacy `track.json` during transition.

### Add Split File To Same Boat

- Append as a new `TrackSegment` to the selected `TrackStream`.
- Normalize segment point times into the session timeline.
- If the imported file has wall-clock timestamps, align by wall-clock time.
- If no wall-clock timestamps exist, append after previous segment with a small configurable gap, default `0ms`.

### Add Different Boat

- Create a new `TrackStream` with `role: 'comparison'`.
- Do not merge points with primary.
- Events generated from this track must include its `trackId`.

## 10. Time Normalization Rules

`TrackPoint.t` remains session-local milliseconds.

For imported files:

- If source times are valid wall-clock timestamps, preserve `trackTimeOriginUnixMs` and normalize points to session time.
- If adding a segment to an existing session, convert using the session's global origin when available.
- If source times are synthetic, append or insert using the user's chosen mode.

Segment metadata must match the normalized points:

```ts
startMs = points[0].t
endMs = points[points.length - 1].t
pointCount = points.length
```

## 11. Event And Range Compatibility

Legacy events have no `trackId`. At runtime:

```ts
function resolveEventTrackId(event: SessionEvent, primaryTrackId: string) {
  return event.trackId ?? primaryTrackId;
}
```

Legacy selected ranges behave the same way:

```ts
function resolveRangeTrackId(range: WorkspaceRangeSelection, primaryTrackId: string) {
  return range.trackId ?? primaryTrackId;
}
```

Do not rewrite existing event files just to add `trackId`. Add it when events are edited, verified, or generated.

## 12. Migration Strategy

### Read Path

1. Try `tracks.json`.
2. If missing, read `track.json`.
3. Wrap the legacy points in a synthetic primary `TrackStream`.
4. Set `activeTrackId` to that track.

### Write Path

New writes should use the new layout. For transition safety, when the primary track changes, also update `track.json`.

### Remote API

Remote KV can store:

```text
session:<id>:tracks
session:<id>:track:<trackId>
```

Legacy key remains:

```text
session:<id>:track
```

## 12.1 Path To The Complete Multi-Track Model

The minimal foundation should leave clear extension points for the complete version:

### Phase A: Track-Aware Single-Track Replay

This document's first implementation target:

- one or more `TrackStream` records can be stored
- current Replay displays one active track
- events/ranges carry or resolve `trackId`
- legacy sessions still work

### Phase B: Split-File Track Management

Add user-facing controls for long sessions split across files:

- append a file as a segment to the same track
- inspect segment boundaries
- remove or replace a segment
- re-run import normalization for a segment
- re-run auto detection only around changed segment time windows

No multi-boat UI is required for this phase.

### Phase C: Multi-Boat Replay

Expose multiple visible tracks in Replay:

- per-track visibility and color
- active track selector
- event filtering by track
- map overlay for inactive visible tracks
- chart series selection by track

Events still remain a single session-level list with `trackId`, not separate per-track event stores.

### Phase D: Alignment And Comparison

Add comparison-specific constructs without changing the base track model:

```ts
interface TrackAlignment {
  id: string;
  sessionId: string;
  trackId: string;
  mode: 'wall-clock' | 'manual-offset' | 'sync-point' | 'start-line';
  offsetMs: number;
  anchors?: Array<{
    trackTimeMs: number;
    referenceTimeMs: number;
    note?: string;
  }>;
  updatedAt: string;
}
```

Do not bake comparison alignment into `TrackPoint.t`. Keep `TrackPoint.t` as the stored session time and apply alignment as a view/model transform.

### Phase E: Rich Track Metadata

The complete version can add richer metadata without changing the point storage contract:

```ts
interface BoatProfile {
  id: string;
  name: string;
  sailNumber?: string;
  className?: string;
  crew?: string[];
}

interface TrackSource {
  id: string;
  trackId: string;
  segmentId?: string;
  sourceKind: 'workspace_file' | 'external_file' | 'device_sync' | 'manual';
  fileName?: string;
  path?: string;
  importedAt: string;
  parserVersion?: string;
}
```

These should reference `trackId` and `segmentId`; they should not require changing every `TrackPoint`.

## 12.2 Explicit Anti-Patterns

Avoid these shortcuts even in the minimal implementation:

- Do not store multiple tracks as `{ primary: TrackPoint[], comparison: TrackPoint[] }`.
- Do not infer identity from `tracks[0]`, filename, display name, or color.
- Do not merge different boats into one point array with a `boatName` field per point.
- Do not represent split files as separate boats.
- Do not store events in `tracks/<trackId>.events.json`.
- Do not make `trackId` optional in newly generated events.
- Do not apply video or comparison offsets by mutating all point timestamps.
- Do not add UI-only state to persisted track records unless it is intentionally portable, such as `visible` or `color`.
- Do not create a second event model for automatic maneuvers.

## 13. Implementation Order

1. Add shared types in frontend/backend.
2. Add local workspace read support for `tracks.json` with legacy fallback.
3. Add local workspace write support for new imported sessions.
4. Add frontend state in `ReplayWorkspacePage` with active-track derived `telemetry`.
5. Add remote/mock track-aware endpoints.
6. Keep legacy `/track` behavior mapped to primary.
7. Add a small track selector in Replay only when `tracks.length > 1`.
8. Add tests or manual fixtures for:
   - old single `track.json`
   - new one-track session
   - one track with two segments
   - two separate tracks

## 14. Acceptance Criteria

- Existing sessions open exactly as before.
- A newly imported single file produces one primary track and works in Replay.
- A session can store at least two tracks without data loss.
- A selected event/range can resolve its target track.
- Map, telemetry, timeline, and video sync still work for the active track.
- Legacy `/track` and `trackApi.get(sessionId)` still return the primary track.
- No multi-track-specific UI is shown when a session has only one track.
- New events generated after this upgrade include `trackId`.
- The internal Replay state uses `tracks`, `trackPointsById`, and `activeTrackId`, even when displaying a single active track.
- There is a documented path from this minimal foundation to split-file management, multi-boat replay, and alignment without changing the base `TrackPoint` contract.

## 15. Development Notes

- Do not block automatic maneuver detection on complete multi-boat UI.
- Do not move marks into track data. Marks remain session-level course objects.
- Do not store generated events inside track point files. Events remain `events.json`.
- Keep `TrackPoint.t` session-local. Do not switch it back to Unix time.
- Track-specific wall-clock origin belongs on `TrackStream.trackTimeOriginUnixMs`.
- Treat `track.json` and `/track` as compatibility facades, not the canonical internal model.
- Prefer selectors/helpers over scattering `activeTrackId` lookup logic through components.
- When adding complete multi-track features later, extend by references (`trackId`, `segmentId`, `alignmentId`) rather than by changing point arrays.
