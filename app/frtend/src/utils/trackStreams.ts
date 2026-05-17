import type {
  Session,
  SessionEvent,
  TrackPoint,
  TrackRole,
  TrackSegment,
  TrackStream,
  TrackStreamStats,
} from '@/types/models';
import type { WorkspaceRangeSelection } from '@/types/workspace';

const DEFAULT_PRIMARY_TRACK_ID = 'primary';

export function getPrimaryTrackId(tracks: TrackStream[]): string {
  return (
    tracks.find((track) => track.role === 'primary')?.id ??
    tracks[0]?.id ??
    DEFAULT_PRIMARY_TRACK_ID
  );
}

export function getActiveTrackPoints(
  tracks: TrackStream[],
  trackPointsById: Record<string, TrackPoint[]>,
  activeTrackId: string | null,
): TrackPoint[] {
  const activeTrack =
    tracks.find((track) => track.id === activeTrackId) ?? tracks[0] ?? null;
  return activeTrack ? trackPointsById[activeTrack.id] ?? [] : [];
}

export function resolveEventTrackId(
  event: SessionEvent,
  primaryTrackId: string,
): string {
  return event.trackId ?? primaryTrackId;
}

export function resolveRangeTrackId(
  range: WorkspaceRangeSelection,
  primaryTrackId: string,
): string {
  return range.trackId ?? primaryTrackId;
}

export function convertImportedTimeToSessionTime(
  importedMs: number,
  options: {
    importOriginUnixMs?: number;
    sessionOriginUnixMs?: number;
    appendAfterMs?: number;
    fallbackIndex?: number;
    sampleIntervalMs?: number;
  } = {},
): number {
  if (
    options.importOriginUnixMs != null &&
    options.sessionOriginUnixMs != null &&
    Number.isFinite(importedMs)
  ) {
    return Math.round(options.importOriginUnixMs + importedMs - options.sessionOriginUnixMs);
  }

  if (Number.isFinite(importedMs)) return Math.round(importedMs);

  const index = options.fallbackIndex ?? 0;
  const interval = options.sampleIntervalMs ?? 1000;
  return Math.round((options.appendAfterMs ?? 0) + index * interval);
}

export function buildTrackStats(
  points: TrackPoint[],
  fallback?: TrackStreamStats,
): TrackStreamStats {
  if (points.length === 0) {
    return fallback ?? { duration: 0, distance: 0, maxSpeed: 0, avgSpeed: 0, turnCount: 0 };
  }

  const first = points[0]!;
  const last = points[points.length - 1]!;
  const duration = Math.max(0, Math.round((last.t - first.t) / 1000));
  const maxSpeed = Math.max(0, ...points.map((point) => point.s ?? 0));
  const avgSpeed =
    points.length > 0
      ? points.reduce((sum, point) => sum + (point.s ?? 0), 0) / points.length
      : 0;

  return {
    ...fallback,
    duration,
    distance: fallback?.distance ?? 0,
    maxSpeed: Math.round(maxSpeed * 10) / 10,
    avgSpeed: Math.round(avgSpeed * 10) / 10,
    turnCount: fallback?.turnCount ?? 0,
  };
}

export function buildTrackSegment(
  trackId: string,
  points: TrackPoint[],
  options: {
    id?: string;
    sourceFileName?: string;
    sourcePath?: string;
  } = {},
): TrackSegment {
  const first = points[0]?.t ?? 0;
  const last = points[points.length - 1]?.t ?? first;
  return {
    id: options.id ?? `${trackId}-segment-1`,
    trackId,
    sourceFileName: options.sourceFileName,
    sourcePath: options.sourcePath,
    startMs: first,
    endMs: last,
    pointCount: points.length,
  };
}

export function createTrackStream(
  session: Pick<Session, 'id' | 'name' | 'stats' | 'trackTimeOriginUnixMs'>,
  points: TrackPoint[],
  options: {
    id?: string;
    name?: string;
    role?: TrackRole;
    sourceFileName?: string;
    sourcePath?: string;
    trackTimeOriginUnixMs?: number;
    color?: string;
    now?: string;
  } = {},
): TrackStream {
  const id = options.id ?? DEFAULT_PRIMARY_TRACK_ID;
  const now = options.now ?? new Date().toISOString();
  const stats = buildTrackStats(points, session.stats);
  return {
    id,
    sessionId: session.id,
    name: options.name ?? session.name ?? 'Primary Track',
    role: options.role ?? 'primary',
    color: options.color,
    visible: true,
    trackTimeOriginUnixMs:
      options.trackTimeOriginUnixMs ?? session.trackTimeOriginUnixMs,
    segments: [
      buildTrackSegment(id, points, {
        sourceFileName: options.sourceFileName,
        sourcePath: options.sourcePath,
      }),
    ],
    stats,
    createdAt: now,
    updatedAt: now,
  };
}
