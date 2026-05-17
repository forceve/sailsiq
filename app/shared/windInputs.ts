export type WindInputKind = 'track_embedded' | 'manual_global' | 'file_timeseries';

export interface TrackEmbeddedWindInput {
  id: string;
  kind: 'track_embedded';
  label?: string;
  trackId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ManualGlobalWindInput {
  id: string;
  kind: 'manual_global';
  label?: string;
  twd: number;
  speed?: number;
  createdAt: string;
  updatedAt: string;
}

export interface WindTimeseriesSample {
  t: number;
  twd: number;
  speed?: number;
}

export interface FileTimeseriesWindInput {
  id: string;
  kind: 'file_timeseries';
  label?: string;
  sourceFileName?: string;
  sourcePath?: string;
  samples: WindTimeseriesSample[];
  createdAt: string;
  updatedAt: string;
}

export type WindInputSource =
  | TrackEmbeddedWindInput
  | ManualGlobalWindInput
  | FileTimeseriesWindInput;

export interface WindTrackPoint {
  t: number;
  lat: number;
  lon: number;
  s?: number;
  h?: number;
  w_s?: number;
  w_d?: number;
}

function normalizeDegrees(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return ((Math.round(value) % 360) + 360) % 360;
}

function finiteOrUndefined(value: number | undefined): number | undefined {
  return value != null && Number.isFinite(value) ? value : undefined;
}

function windInputId(kind: WindInputKind): string {
  return `${kind}-${Date.now().toString(36)}`;
}

export function createManualGlobalWindInput(
  twd: number,
  speed: number | undefined,
  existing?: WindInputSource,
): ManualGlobalWindInput {
  const now = new Date().toISOString();
  return {
    id: existing?.kind === 'manual_global' ? existing.id : windInputId('manual_global'),
    kind: 'manual_global',
    label: 'Manual wind',
    twd: normalizeDegrees(twd),
    speed: finiteOrUndefined(speed),
    createdAt: existing?.kind === 'manual_global' ? existing.createdAt : now,
    updatedAt: now,
  };
}

export function windAtTime(
  wind: WindInputSource | undefined,
  timeMs: number,
): { twd?: number; speed?: number } {
  if (!wind || wind.kind === 'track_embedded') return {};

  if (wind.kind === 'manual_global') {
    return { twd: wind.twd, speed: wind.speed };
  }

  if (wind.samples.length === 0) return {};
  let best = wind.samples[0]!;
  let bestDelta = Math.abs(timeMs - best.t);
  for (const sample of wind.samples.slice(1)) {
    const delta = Math.abs(timeMs - sample.t);
    if (delta < bestDelta) {
      best = sample;
      bestDelta = delta;
    }
  }
  return { twd: best.twd, speed: best.speed };
}

export function applyWindInputToTrackPoints<T extends WindTrackPoint>(
  points: T[],
  wind: WindInputSource | undefined,
): T[] {
  if (!wind || wind.kind === 'track_embedded') return points;

  return points.map((point) => {
    const applied = windAtTime(wind, point.t);
    return {
      ...point,
      ...(applied.twd != null ? { w_d: applied.twd } : {}),
      ...(applied.speed != null ? { w_s: applied.speed } : {}),
    };
  });
}

export function isManualGlobalWind(
  wind: WindInputSource | undefined,
): wind is ManualGlobalWindInput {
  return wind?.kind === 'manual_global';
}

