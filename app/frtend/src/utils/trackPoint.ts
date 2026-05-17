import type { TrackPoint } from '@/types/models';

/** Get speed in knots (SOG). */
export function getSpeed(pt: TrackPoint): number {
  return pt.s ?? 0;
}

/** Get heading in degrees. */
export function getHeading(pt: TrackPoint): number {
  return pt.h ?? 0;
}

function normalizeAngleDelta(degrees: number): number {
  return ((degrees + 180) % 360 + 360) % 360 - 180;
}

/** Get wind direction in degrees. */
export function getWindDir(pt: TrackPoint): number | undefined {
  return pt.w_d;
}

/** Get wind speed in knots. */
export function getWindSpeed(pt: TrackPoint): number | undefined {
  return pt.w_s;
}

/** Get VMG to wind in knots based on boat speed projected onto wind direction. */
export function getVmgToWind(pt: TrackPoint, windDirOverride?: number): number | undefined {
  const heading = pt.h;
  const windDir = windDirOverride ?? pt.w_d;
  if (heading == null || windDir == null) return undefined;

  const delta = normalizeAngleDelta(heading - windDir);
  return getSpeed(pt) * Math.cos((delta * Math.PI) / 180);
}

/** Get timestamp in ms. */
export function getTime(pt: TrackPoint): number {
  return pt.t;
}
