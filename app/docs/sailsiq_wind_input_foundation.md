# SailSIQ Wind Input Foundation

> Goal: make wind a session-level analysis input, not a temporary Replay UI value and not metadata hidden inside track points. This prepares the product for embedded track wind, manual global wind, and future wind files.

## 1. Product Model

Wind can come from several sources:

- `track_embedded`: wind fields already present on `TrackPoint.w_d / TrackPoint.w_s`.
- `manual_global`: one user-confirmed TWD / wind speed applied to the whole session or active track analysis.
- `file_timeseries`: future imported wind file with timestamped TWD / speed samples.

The current Replay wind widget is now treated as `manual_global`.

## 2. Persistence

Wind source belongs on the session:

```ts
interface Session {
  analysisInputs?: {
    wind?: WindInputSource;
  };
}
```

Do not persist manual wind only in React state. React state may cache the current wind for rendering, but `Session.analysisInputs.wind` is the source of truth.

## 3. Detection Rule

Automatic maneuver detection receives a point array with wind already adapted:

```ts
const pointsForDetection = applyWindInputToTrackPoints(points, session.analysisInputs?.wind);
detectManeuvers({ sessionId, trackId, points: pointsForDetection });
```

The detector does not know whether wind came from the track, a manual global value, or a future wind file.

## 4. Recalculation Rule

When the user applies a manual wind direction:

- persist `manual_global` to `Session.analysisInputs.wind`
- ask whether to recalculate unverified auto tack/gybe/turn events for the active track
- replace only:
  - `autoDetected: true`
  - `verified !== true`
  - same `trackId`
  - `type in tack / gybe / other_turn`

Do not replace:

- manual events
- verified events
- penalty events
- mark roundings unless course/marks are part of the rerun

## 5. Future Wind File

Future wind file import should create:

```ts
{
  kind: 'file_timeseries',
  sourceFileName,
  sourcePath,
  samples: [{ t, twd, speed }]
}
```

Do not mutate every `TrackPoint` to permanently copy wind samples. Adapt wind at analysis/render time.

