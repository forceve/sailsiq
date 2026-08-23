import type { Session } from '@/types/models';

export function getVideoFileWallClockStartMs(
  file: Pick<File, 'lastModified'>,
  durationMs = 0,
): number | null {
  const ms = file.lastModified;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const recordingStartMs =
    Number.isFinite(durationMs) && durationMs > 0 ? ms - durationMs : ms;
  return Math.round(recordingStartMs / 1000) * 1000;
}

/**
 * When the session was imported with a reliable track time origin, and the video's
 * wall-clock start (typically `File.lastModified - videoDuration`) falls within the session's
 * wall-clock span, returns `offsetMs` such that sessionTime − offsetMs = videoTime
 * (same convention as Replay: rawVideoTimeMs = currentTime − offsetMs).
 */
export function tryComputeVideoOffsetFromWallClock(
  session: Session,
  sessionDurationMs: number,
  videoWallStartMs: number,
): number | null {
  const origin = session.trackTimeOriginUnixMs;
  if (
    origin == null ||
    !Number.isFinite(origin) ||
    !Number.isFinite(videoWallStartMs) ||
    sessionDurationMs <= 0
  ) {
    return null;
  }
  const sessionEnd = origin + sessionDurationMs;
  if (videoWallStartMs < origin || videoWallStartMs > sessionEnd) {
    return null;
  }
  return Math.round(videoWallStartMs - origin);
}
