import type {
  VideoSyncAnchor,
  VideoSyncAnchorSource,
  VideoSyncBinding,
  VideoSyncConfidence,
} from '@/types/models';

interface CreateVideoSyncAnchorInput {
  videoTimeMs: number;
  trackTimeMs: number;
  realUnixMs?: number;
  source: VideoSyncAnchorSource;
  confidence?: VideoSyncConfidence;
  note?: string;
  id?: string;
  createdAt?: string;
}

interface VideoSyncOptions {
  trackTimeOriginUnixMs?: number;
  updatedAt?: string;
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function createAnchorId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeOptionalMs(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : undefined;
}

export function createVideoSyncAnchor(
  input: CreateVideoSyncAnchorInput,
): VideoSyncAnchor {
  const realUnixMs = sanitizeOptionalMs(input.realUnixMs);
  return {
    id: input.id ?? createAnchorId(),
    videoTimeMs: Math.max(0, Math.round(finiteOr(input.videoTimeMs, 0))),
    trackTimeMs: Math.round(finiteOr(input.trackTimeMs, 0)),
    ...(realUnixMs != null ? { realUnixMs } : {}),
    source: input.source,
    ...(input.confidence ? { confidence: input.confidence } : {}),
    ...(input.note ? { note: input.note } : {}),
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

export function createVideoSyncBindingFromAnchor(
  input: CreateVideoSyncAnchorInput,
  options: VideoSyncOptions = {},
): VideoSyncBinding {
  const anchor = createVideoSyncAnchor(input);
  const updatedAt = options.updatedAt ?? new Date().toISOString();
  return {
    version: 1,
    mode: 'single-anchor',
    offsetMs: Math.round(anchor.trackTimeMs - anchor.videoTimeMs),
    anchors: [anchor],
    ...(options.trackTimeOriginUnixMs != null
      ? { trackTimeOriginUnixMs: Math.round(options.trackTimeOriginUnixMs) }
      : {}),
    updatedAt,
  };
}

export function createOffsetOnlyVideoSync(
  offsetMs: number,
  options: VideoSyncOptions & {
    source?: VideoSyncAnchorSource;
    confidence?: VideoSyncConfidence;
  } = {},
): VideoSyncBinding {
  return createVideoSyncBindingFromAnchor(
    {
      videoTimeMs: 0,
      trackTimeMs: Math.round(finiteOr(offsetMs, 0)),
      source: options.source ?? 'manual-video-track',
      confidence: options.confidence ?? 'low',
    },
    options,
  );
}

export function isVideoSyncBinding(value: unknown): value is VideoSyncBinding {
  if (!value || typeof value !== 'object') return false;
  const maybe = value as Partial<VideoSyncBinding>;
  return (
    maybe.version === 1 &&
    (maybe.mode === 'single-anchor' || maybe.mode === 'multi-anchor') &&
    typeof maybe.offsetMs === 'number' &&
    Number.isFinite(maybe.offsetMs) &&
    Array.isArray(maybe.anchors)
  );
}

export function normalizeVideoSyncBinding(
  offsetMs: number,
  sync?: VideoSyncBinding,
  options: VideoSyncOptions & {
    source?: VideoSyncAnchorSource;
    confidence?: VideoSyncConfidence;
  } = {},
): VideoSyncBinding {
  if (isVideoSyncBinding(sync)) {
    const updatedAt = options.updatedAt ?? sync.updatedAt ?? new Date().toISOString();
    return {
      ...sync,
      offsetMs: Math.round(finiteOr(sync.offsetMs, offsetMs)),
      anchors: sync.anchors.map((anchor) =>
        createVideoSyncAnchor({
          ...anchor,
          source: anchor.source,
          createdAt: anchor.createdAt,
        }),
      ),
      ...(options.trackTimeOriginUnixMs != null
        ? { trackTimeOriginUnixMs: Math.round(options.trackTimeOriginUnixMs) }
        : sync.trackTimeOriginUnixMs != null
          ? { trackTimeOriginUnixMs: sync.trackTimeOriginUnixMs }
          : {}),
      updatedAt,
    };
  }

  return createOffsetOnlyVideoSync(offsetMs, options);
}

export function trackTimeFromRealTime(
  realUnixMs: number,
  trackTimeOriginUnixMs?: number,
): number | null {
  if (!Number.isFinite(realUnixMs) || !Number.isFinite(trackTimeOriginUnixMs)) {
    return null;
  }
  return Math.round(realUnixMs - Number(trackTimeOriginUnixMs));
}

export function realTimeFromTrackTime(
  trackTimeMs: number,
  trackTimeOriginUnixMs?: number,
): number | null {
  if (!Number.isFinite(trackTimeMs) || !Number.isFinite(trackTimeOriginUnixMs)) {
    return null;
  }
  return Math.round(Number(trackTimeOriginUnixMs) + trackTimeMs);
}

export function formatDatetimeLocalValue(unixMs: number): string {
  if (!Number.isFinite(unixMs)) return '';
  const date = new Date(unixMs);
  const pad = (value: number, length = 2) => String(value).padStart(length, '0');
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
  ].join('T');
}

export function parseDatetimeLocalValue(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}
