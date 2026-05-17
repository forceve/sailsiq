# SailSIQ Automatic Maneuver Detection And Event Integration

> Goal: during track import, detect maneuvers from telemetry and generate normal `SessionEvent` records that work with the existing Events list, Timeline, map highlighting, and Lens surfaces.

## 1. Product Decision

Automatic detection should reuse the existing event system.

The detector does not create a separate "analysis marker" model for MVP. It writes `SessionEvent[]` with:

- `type`
- `trackId`
- `timestamp`
- `startTime`
- `endTime`
- `autoDetected`
- `verified`
- `confidence`
- optional metrics and reason codes

The UI then treats these as normal events with better metadata.

## 2. Dependency On Multi-Track Foundation

This feature should be implemented after the lightweight multi-track foundation is in place.

Required foundation fields:

```ts
SessionEvent.trackId?: string;
SessionEvent.startTime?: number;
SessionEvent.endTime?: number;
WorkspaceRangeSelection.trackId?: string;
```

Without `trackId`, imported events would be ambiguous once a session has split tracks or multiple boats.

## 3. Event Type Updates

Update `EventType` in frontend and backend:

```ts
export type EventType =
  | 'general'
  | 'tack'
  | 'gybe'
  | 'mark_rounding'
  | 'penalty_360'
  | 'penalty_720'
  | 'other_turn'
  | 'start'
  | 'finish';
```

Existing UI should continue to handle unknown or newly added event types by displaying their string label.

## 4. SessionEvent Metadata

Extend `SessionEvent`:

```ts
export interface ManeuverMetrics {
  duration?: number; // seconds
  headingChange?: number; // degrees
  cumulativeTurn?: number; // degrees
  entryTwa?: number; // degrees
  exitTwa?: number; // degrees
  minAbsTwa?: number; // degrees
  maxAbsTwa?: number; // degrees
  speedBefore?: number; // knots
  minSpeed?: number; // knots
  speedLoss?: number; // knots
  recoveryTime?: number; // seconds
  nearestMarkId?: string;
  nearestMarkDistance?: number; // meters
}

export interface SessionEvent {
  id: string;
  sessionId: string;
  trackId?: string;
  timestamp: number; // event center/apex on the session timeline
  startTime?: number;
  endTime?: number;
  type: EventType;
  note: string;
  snapshotUrl?: string;
  autoDetected?: boolean;
  verified?: boolean;
  confidence?: number;
  linkedMarkId?: string;
  metrics?: ManeuverMetrics;
  reasonCodes?: string[];
}
```

If keeping the schema smaller for the first implementation, the minimum useful addition is:

```ts
trackId?: string;
startTime?: number;
endTime?: number;
confidence?: number;
linkedMarkId?: string;
metrics?: Record<string, number | string | boolean | null>;
reasonCodes?: string[];
```

## 5. Import-Time Flow

### New Session Import

1. Parse file with existing `parseImportBytes`.
2. Create primary `TrackStream`.
3. Run maneuver detector on that track's normalized `TrackPoint[]`.
4. Create `SessionEvent[]` with `trackId`.
5. Write:
   - `session.json`
   - `tracks.json`
   - `tracks/<trackId>.json`
   - `events.json`
   - `marks.json`
   - `bindings.json`

### Add Segment To Existing Track

1. Normalize the new segment onto the session timeline.
2. Merge or append points in the selected `TrackStream`.
3. Run detection on a bounded window around the inserted segment.
4. Deduplicate against existing auto-detected events for that track.
5. Write updated points, segments, and events.

### Add New Boat Track

1. Create a new `TrackStream`.
2. Run detection on that track only.
3. Write events with the new `trackId`.

## 6. Detector Output Contract

The detector should be pure and independent from React/API code.

Suggested location:

```text
app/shared/maneuverDetection.ts
```

Input:

```ts
export interface DetectManeuversInput {
  sessionId: string;
  trackId: string;
  points: TrackPoint[];
  marks?: Mark[];
  options?: Partial<ManeuverDetectionOptions>;
}
```

Output:

```ts
export interface DetectedManeuver {
  type: EventType;
  trackId: string;
  timestamp: number;
  startTime: number;
  endTime: number;
  confidence: number;
  note: string;
  linkedMarkId?: string;
  metrics: ManeuverMetrics;
  reasonCodes: string[];
}
```

Conversion to `SessionEvent` happens at the import or API layer.

## 6.1 Detector Extension Boundaries

The detector should be small, but it must not bake in single-track assumptions.

Hard requirements:

- The detector receives exactly one `trackId` and one point array at a time.
- Every output maneuver includes that `trackId`.
- The detector does not read or mutate global Replay state.
- The detector does not decide which track is active or primary.
- The detector does not write files or call APIs directly.
- The detector does not modify `TrackPoint.t`; alignment and segment normalization happen before detection.
- The detector can be rerun for one track, one segment window, or one whole session without changing its output shape.

This keeps the MVP compatible with later full-system features:

- per-track detection settings
- segment-level reruns after split-file edits
- multi-boat event comparison
- server-side batch detection
- future ML classifier replacing only the classifier step, not the event model

## 7. Preprocessing Rules

The detector operates on session-local time `TrackPoint.t`.

Required preprocessing:

- Sort points by `t`.
- Drop invalid lat/lon points.
- Ignore sections where `s < 1.0` knots by default.
- Smooth heading and wind direction with circular averages.
- Use circular angle deltas in `[-180, 180]`.
- Estimate heading from COG when `h` is missing.
- Estimate SOG from distance/time when `s` is missing.

Existing import already estimates missing heading/speed. The detector should still defensively handle missing values.

## 8. Candidate Turn Detection

First detect candidate turn windows, then classify them.

Default thresholds:

```ts
const defaults = {
  minSpeedKnots: 1.0,
  turnRateStartDegPerSec: 6,
  turnRateEndDegPerSec: 2,
  minTurnDurationMs: 3000,
  maxTurnDurationMs: 30000,
  eventEndQuietMs: 5000,
  minHeadingChangeDeg: 35,
};
```

Candidate window features:

```ts
{
  startTime,
  endTime,
  apexTime,
  preHeading,
  postHeading,
  deltaHeading,
  cumulativeTurn,
  preTwa,
  postTwa,
  minAbsTwa,
  maxAbsTwa,
  speedBefore,
  minSpeed,
  speedLoss,
  duration,
}
```

If wind direction is unavailable, tack/gybe classification can fall back to heading geometry and speed loss, but confidence must be lower.

## 9. Classification Priority

Classify in this order:

1. `penalty_720`
2. `penalty_360`
3. `mark_rounding`
4. `tack`
5. `gybe`
6. `other_turn`

Penalty turns go first because they can contain tack/gybe-like sub-events.

Mark rounding should only be detected when marks are known. If no marks exist during import, skip `mark_rounding` and allow a later "rerun with marks" action.

## 10. Tack Rules

Tack definition:

- TWA side changes.
- Boat crosses near the wind direction.
- Pre/post TWA are upwind angles.

Default rules:

```ts
isTack =
  sign(preTwa) !== sign(postTwa) &&
  minAbsTwa < 45 &&
  abs(preTwa) >= 25 &&
  abs(preTwa) <= 80 &&
  abs(postTwa) >= 25 &&
  abs(postTwa) <= 80 &&
  abs(deltaHeading) >= 50 &&
  abs(deltaHeading) <= 150;
```

Recommended note:

```text
Auto tack · 87% · 13.2s · loss 1.1 kts
```

## 11. Gybe Rules

Gybe definition:

- TWA side changes.
- Boat crosses near downwind.
- Pre/post TWA are downwind angles.

Default rules:

```ts
isGybe =
  sign(preTwa) !== sign(postTwa) &&
  maxAbsTwa > 150 &&
  abs(preTwa) >= 110 &&
  abs(postTwa) >= 110 &&
  abs(deltaHeading) >= 30 &&
  abs(deltaHeading) <= 140;
```

Recommended note:

```text
Auto gybe · 82% · 10.4s · loss 0.4 kts
```

## 12. Penalty Rules

Penalty turns are short-duration full rotations.

Default rules:

```ts
penalty_360 =
  abs(cumulativeTurn) >= 300 &&
  abs(cumulativeTurn) <= 420 &&
  duration <= 90000 &&
  turnDirectionConsistency >= 0.75;

penalty_720 =
  abs(cumulativeTurn) >= 650 &&
  abs(cumulativeTurn) <= 800 &&
  duration <= 180000 &&
  turnDirectionConsistency >= 0.75;
```

Recommended note:

```text
Auto penalty 360 · 79% · 42.0s
```

## 13. Mark Rounding Rules

Mark rounding needs configured marks.

Input marks remain session-level `Mark[]`; they are not track-specific.

Default rules:

```ts
mark_rounding =
  nearestExpectedMark != null &&
  minDistanceToMark <= markRadiusMeters &&
  abs(cumulativeTurn) >= 45 &&
  exitsTowardNextLeg;
```

Recommended defaults:

```ts
markRadiusMeters = 50;
roundingSearchWindowMs = 90000;
```

Output:

```ts
{
  type: 'mark_rounding',
  linkedMarkId: nearestMark.id,
  metrics: {
    nearestMarkId: nearestMark.id,
    nearestMarkDistance: minDistance,
    cumulativeTurn,
  }
}
```

If marks are added after import, expose a later action:

```text
Analyze -> Re-run mark roundings
```

This can update only auto-detected, unverified `mark_rounding` events.

## 14. Confidence Scoring

Use additive scoring instead of true/false only.

Tack example:

```ts
score =
  sideChanged * 0.30 +
  crossedNoGoZone * 0.25 +
  headingChangeReasonable * 0.20 +
  durationReasonable * 0.10 +
  speedLossPlausible * 0.10 +
  cleanDataCoverage * 0.05;
```

Confidence thresholds:

- `>= 0.80`: show as high confidence auto event.
- `0.60 - 0.79`: show as lower confidence auto event.
- `< 0.60`: do not create an event by default; optionally keep for debug output.

## 15. Deduplication

When importing or rerunning detection, avoid duplicate auto events.

Two events are duplicates when:

```ts
same trackId &&
same type &&
abs(timestampA - timestampB) < dedupeWindowMs
```

Default:

```ts
dedupeWindowMs = 15000;
```

Rules:

- Do not delete user-created events.
- Do not overwrite `verified: true` events.
- It is safe to replace auto-detected unverified events in the same window.

## 16. UI Integration

### Events List

Use the existing sidebar Events list.

Add compact metadata:

```text
AUTO · Tack · 87%
03:12 - 03:25
Loss 1.1 kts
```

Manual events display as they do today.

### Timeline

Current timeline renders all events as yellow ticks.

Upgrade event marker rendering:

- `tack`: blue
- `gybe`: violet
- `mark_rounding`: amber
- `penalty_360` / `penalty_720`: red
- `other_turn`: gray
- manual `general`: yellow

If `startTime/endTime` exist, render a small event window under or behind the center tick.

### Map Highlight

Selecting an event should reuse the existing telemetry range highlight.

Derived range:

```ts
function rangeFromEvent(event: SessionEvent, fallbackHalfWindowMs: number) {
  const start = event.startTime ?? event.timestamp - fallbackHalfWindowMs;
  const end = event.endTime ?? event.timestamp + fallbackHalfWindowMs;
  return {
    trackId: event.trackId,
    startMs: Math.max(0, start - 2000),
    endMs: end + 2000,
    source: 'turnRate',
  };
}
```

This implements the desired "average maneuver duration plus 2 seconds before and after" behavior. If the detector provides actual start/end, use those. If not, use type-specific fallback windows:

```ts
const fallbackHalfWindowByType = {
  tack: 8000,
  gybe: 8000,
  mark_rounding: 15000,
  penalty_360: 30000,
  penalty_720: 60000,
  other_turn: 8000,
};
```

### Lens

`WorkspaceLensLayer` should show:

```text
Tack 87%
03:12 - 03:25
HDG +84 deg
Loss 1.1 kts
TWA -42 -> +39
```

Only show fields that exist. Avoid empty placeholders.

## 17. Mark Interaction

Marks stay as course objects. Events can point to marks:

```ts
linkedMarkId?: string;
```

When selecting a `mark_rounding` event:

- select/highlight the event
- derive and highlight event time range
- visually emphasize the linked mark if present

When selecting a mark:

- keep current mark focus behavior
- optionally list nearby `mark_rounding` events in a later phase

## 18. Backend And Mock API

Event create/update should preserve new optional fields:

- `trackId`
- `startTime`
- `endTime`
- `confidence`
- `linkedMarkId`
- `metrics`
- `reasonCodes`

Mock API should do the same.

The backend should not recompute detection for MVP unless using `/sessions/import`. It can simply store the generated events.

## 19. Local Workspace Writeback

When creating a local imported session, `createLocalImportedTrackSession` should:

1. create the track stream
2. run detection
3. write `events.json` with generated auto events

When no wind data exists:

- still detect generic `other_turn`
- optionally detect low-confidence tack/gybe from heading geometry
- do not create low-confidence tack/gybe unless confidence threshold is met

## 20. Testing Plan

### Unit Tests

Add tests for:

- circular angle delta around `359 -> 1`
- heading rate calculation
- candidate window extraction
- tack classification
- gybe classification
- penalty 360/720 classification
- duplicate event replacement

### Fixture Tests

Use small synthetic tracks:

- one tack
- one gybe
- one 360 penalty
- one mark rounding with marks
- one long file split into two segments
- two tracks in one session

### Manual UI Checks

- Imported tack events appear in the existing Events list.
- Clicking an auto event moves playhead to `timestamp`.
- Map highlight covers `startTime - 2s` to `endTime + 2s`.
- Timeline marker uses the event type color.
- Legacy manual events still work.

## 21. Acceptance Criteria

- Importing a track can generate auto-detected events without user action.
- Generated events are normal `SessionEvent` records.
- Each generated event includes `trackId`, `timestamp`, `startTime`, `endTime`, `autoDetected: true`, `verified: false`, and `confidence`.
- Selecting a generated event reuses the existing range highlight system with `+2s` padding.
- Existing manual event creation still works.
- Sessions with no wind data still import successfully.
- Sessions with no marks skip mark rounding detection without failure.
- Verified events are not overwritten by reruns.
- Detection can run for one selected track without reading the active Replay track from UI state.
- Detection output can be merged into `events.json` without creating any parallel marker store.
- Detection reruns can replace only auto-detected unverified events for the same `trackId` and time window.

## 22. Development Order

1. Extend event types and optional event metadata.
2. Add detector utilities in shared code.
3. Add detector unit tests with synthetic data.
4. Integrate detector into local import.
5. Integrate detector into backend `/sessions/import`.
6. Preserve metadata in mock/backend event APIs.
7. Add event selection to derive range highlight.
8. Upgrade timeline event colors.
9. Upgrade Lens event details.
10. Add rerun support for mark roundings after marks exist.

## 23. Non-Goals

- Do not replace the Events system.
- Do not create a separate analysis marker store for MVP.
- Do not require ML.
- Do not require marks to import tracks.
- Do not require multi-boat UI before generating track-aware events.
