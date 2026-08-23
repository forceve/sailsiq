import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarClock,
  Clock3,
  Flag,
  Minus,
  Pause,
  Play,
  Plus,
  X,
} from 'lucide-react';
import SessionVideoStage from '@/components/SessionVideoStage';
import { formatTimestamp } from '@/utils/formatters';
import type { VideoType } from '@/types/models';
import {
  formatDatetimeLocalValue,
  parseDatetimeLocalValue,
  realTimeFromTrackTime,
  trackTimeFromRealTime,
} from '@/utils/videoSync';

const NUDGE_STEPS = [-5000, -1000, -100, 100, 1000, 5000] as const;
const STAGE_CLOCK_THROTTLE_MS = 90;

export interface VideoSyncSessionJumpOption {
  id: string;
  sessionTimeMs: number;
  title: string;
  subtitle: string;
  meta?: string;
}

function formatWallClock(unixMs: number | null): string {
  if (unixMs == null || !Number.isFinite(unixMs)) return 'No track clock';
  return new Date(unixMs).toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

interface VideoSyncDialogProps {
  isOpen: boolean;
  sourceUrl: string;
  videoType: VideoType;
  mediaLabel?: string;
  crossOrigin?: '' | 'anonymous';
  offsetMs: number;
  sessionTimeMs: number;
  videoTimeMs: number;
  totalDurationMs: number;
  videoDurationMs: number;
  trackTimeOriginUnixMs?: number;
  anchorCount?: number;
  sessionJumpOptions?: VideoSyncSessionJumpOption[];
  onClose: () => void;
  onAlignCurrentFrame: () => void;
  onBindVideoRealTime: (realUnixMs: number) => void;
  onAdjustOffset: (deltaMs: number) => void;
  onResetOffset: () => void;
  onSessionSeek: (timeMs: number) => void;
  onVideoSeek: (timeMs: number) => void;
}

export default function VideoSyncDialog({
  isOpen,
  sourceUrl,
  videoType,
  mediaLabel,
  crossOrigin,
  offsetMs,
  sessionTimeMs,
  videoTimeMs,
  totalDurationMs,
  videoDurationMs,
  trackTimeOriginUnixMs,
  anchorCount = 0,
  sessionJumpOptions = [],
  onClose,
  onAlignCurrentFrame,
  onBindVideoRealTime,
  onAdjustOffset,
  onResetOffset,
  onSessionSeek,
  onVideoSeek,
}: VideoSyncDialogProps) {
  const [realTimeInput, setRealTimeInput] = useState('');
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [resolvedVideoDurationMs, setResolvedVideoDurationMs] = useState(videoDurationMs);
  const lastStageClockEmitRef = useRef(0);

  const effectiveVideoDurationMs = Math.max(resolvedVideoDurationMs, videoDurationMs, 1);

  const trackRealTimeMs = realTimeFromTrackTime(sessionTimeMs, trackTimeOriginUnixMs);
  const parsedRealTimeMs = useMemo(
    () => parseDatetimeLocalValue(realTimeInput),
    [realTimeInput],
  );
  const realTrackTimeMs =
    parsedRealTimeMs == null
      ? null
      : trackTimeFromRealTime(parsedRealTimeMs, trackTimeOriginUnixMs);
  const realTimeInRange =
    realTrackTimeMs != null &&
    realTrackTimeMs >= 0 &&
    realTrackTimeMs <= Math.max(totalDurationMs, 0);
  const canBindRealTime =
    trackTimeOriginUnixMs != null &&
    parsedRealTimeMs != null &&
    realTimeInRange &&
    effectiveVideoDurationMs > 0;

  useEffect(() => {
    if (!isOpen) return;
    const wall = realTimeFromTrackTime(sessionTimeMs, trackTimeOriginUnixMs);
    setRealTimeInput(wall != null ? formatDatetimeLocalValue(wall) : '');
    // Seed when dialog opens / origin changes only — not while scrubbing session.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [isOpen, trackTimeOriginUnixMs]);

  useEffect(() => {
    if (isOpen) {
      setPreviewPlaying(false);
      setResolvedVideoDurationMs(videoDurationMs);
    }
  }, [isOpen, sourceUrl, videoDurationMs]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const handleStageClock = useCallback(
    (ms: number) => {
      const now = performance.now();
      if (now - lastStageClockEmitRef.current < STAGE_CLOCK_THROTTLE_MS) return;
      lastStageClockEmitRef.current = now;
      onVideoSeek(ms);
    },
    [onVideoSeek],
  );

  const handleStageDuration = useCallback((durationMs: number) => {
    if (durationMs > 0) {
      setResolvedVideoDurationMs((prev) => Math.max(prev, durationMs));
    }
  }, []);

  if (!isOpen) return null;

  const statTile =
    'rounded-xl border border-white/10 bg-white/5 px-3 py-2 sm:px-4 sm:py-2.5';

  return (
    <div className="fixed inset-0 z-[10050] flex items-center justify-center overflow-y-auto bg-black/55 p-3 backdrop-blur-sm sm:p-4">
      <div className="my-auto flex w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-stone-950/92 text-white shadow-2xl max-h-[calc(100vh-1.5rem)] min-h-0">
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-5 sm:py-4">
          <div className="min-w-0">
            <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-[0.24em] text-white/55">
              <Clock3 className="h-3.5 w-3.5 shrink-0" />
              <span>Timeline sync</span>
            </div>
            <h3 className="text-base font-semibold sm:text-lg">Align video to session time</h3>
            <div className="mt-1 text-xs text-white/55 sm:text-sm">
              {anchorCount > 0
                ? `${anchorCount} sync anchor${anchorCount > 1 ? 's' : ''} on file`
                : 'No saved sync anchor yet — use bind when the frame matches.'}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-full border border-white/10 p-2 text-white/70 transition hover:bg-white/10 hover:text-white"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 lg:flex-row lg:items-stretch lg:gap-5 lg:overflow-hidden lg:p-5">
          {/* Left: session nodes */}
          <aside className="flex shrink-0 flex-col lg:order-1 lg:w-52 xl:w-56">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-white/50">
              <Flag className="h-3.5 w-3.5" />
              <span>Session moments</span>
            </div>
            <p className="mt-1 text-[11px] leading-snug text-white/45">
              Jump the session to an event, pause the video on the matching frame, then bind.
            </p>
            <div className="mt-2 flex max-h-[min(28rem,50vh)] flex-col gap-1 overflow-y-auto rounded-2xl border border-white/10 bg-black/25 p-1.5 lg:min-h-[10rem]">
              {sessionJumpOptions.length === 0 ? (
                <p className="px-2 py-3 text-center text-xs text-white/45">No session events yet.</p>
              ) : (
                sessionJumpOptions.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => onSessionSeek(opt.sessionTimeMs)}
                    className="rounded-xl px-2.5 py-2 text-left text-xs transition hover:bg-white/10"
                  >
                    <div className="line-clamp-2 font-medium text-white/90">{opt.title}</div>
                    <div className="mt-0.5 font-mono text-[10px] text-cyan-200/80">{opt.subtitle}</div>
                    {opt.meta ? (
                      <div className="mt-0.5 text-[10px] uppercase tracking-wide text-white/40">
                        {opt.meta}
                      </div>
                    ) : null}
                  </button>
                ))
              )}
            </div>
          </aside>

          {/* Center: stage + timeline controls */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 lg:order-2 lg:min-h-0">
            <div className="relative aspect-video w-full min-h-[180px] overflow-hidden rounded-2xl border border-white/10 bg-black shadow-inner sm:min-h-[220px]">
              {sourceUrl ? (
                <SessionVideoStage
                  videoType={videoType}
                  sourceUrl={sourceUrl}
                  mediaLabel={mediaLabel}
                  targetTimeMs={videoTimeMs}
                  isPlaying={previewPlaying}
                  playbackSpeed={1}
                  crossOrigin={crossOrigin}
                  className="!min-h-0 h-full rounded-2xl"
                  onClockChange={handleStageClock}
                  onDurationChange={handleStageDuration}
                />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-white/50">
                  No video URL
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className={statTile}>
                <div className="mb-0.5 text-[9px] uppercase tracking-wider text-white/45">Session</div>
                <div className="truncate font-mono text-sm font-semibold sm:text-base">
                  {formatTimestamp(sessionTimeMs)}
                </div>
              </div>
              <div className={statTile}>
                <div className="mb-0.5 text-[9px] uppercase tracking-wider text-white/45">Video</div>
                <div className="truncate font-mono text-sm font-semibold sm:text-base">
                  {formatTimestamp(videoTimeMs)}
                </div>
              </div>
              <div className={`${statTile} border-cyan-400/25 bg-cyan-500/10`}>
                <div className="mb-0.5 text-[9px] uppercase tracking-wider text-cyan-100/65">Offset</div>
                <div className="font-mono text-sm font-semibold sm:text-base">{(offsetMs / 1000).toFixed(1)}s</div>
              </div>
              <div className={statTile}>
                <div className="mb-0.5 text-[9px] uppercase tracking-wider text-white/45">Track clock</div>
                <div className="line-clamp-2 text-[11px] font-semibold leading-snug sm:text-xs">
                  {formatWallClock(trackRealTimeMs)}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-3 sm:p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="text-[10px] uppercase tracking-[0.2em] text-white/50">Scrubbers</div>
                <button
                  type="button"
                  onClick={() => setPreviewPlaying((p) => !p)}
                  disabled={effectiveVideoDurationMs <= 0}
                  className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/30 px-3 py-1.5 text-xs font-medium text-white/90 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {previewPlaying ? (
                    <>
                      <Pause className="h-3.5 w-3.5" />
                      Pause preview
                    </>
                  ) : (
                    <>
                      <Play className="h-3.5 w-3.5" />
                      Play preview
                    </>
                  )}
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <div className="mb-1.5 flex items-center justify-between gap-2 text-xs text-white/75">
                    <span>Session timeline</span>
                    <span className="font-mono">{formatTimestamp(sessionTimeMs)}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={Math.max(totalDurationMs, 1)}
                    step={100}
                    value={Math.max(0, Math.min(sessionTimeMs, totalDurationMs))}
                    onChange={(event) => onSessionSeek(Number(event.target.value))}
                    className="w-full accent-cyan-500"
                  />
                </div>
                <div>
                  <div className="mb-1.5 flex items-center justify-between gap-2 text-xs text-white/75">
                    <span>Video (same engine as main stage)</span>
                    <span className="font-mono">{formatTimestamp(videoTimeMs)}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={Math.max(effectiveVideoDurationMs, 1)}
                    step={100}
                    value={Math.max(0, Math.min(videoTimeMs, Math.max(effectiveVideoDurationMs, 1)))}
                    onChange={(event) => onVideoSeek(Number(event.target.value))}
                    disabled={effectiveVideoDurationMs <= 0}
                    className="w-full accent-cyan-500 disabled:opacity-40"
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onAlignCurrentFrame}
                className="rounded-full border border-cyan-300/25 bg-cyan-500/15 px-4 py-2 text-sm font-medium text-cyan-50 transition hover:bg-cyan-500/25"
              >
                Bind current pair
              </button>
              <button
                type="button"
                onClick={onResetOffset}
                className="rounded-full border border-white/10 px-4 py-2 text-sm text-white/75 transition hover:bg-white/10 hover:text-white"
              >
                Reset to default offset
              </button>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-[11px] leading-relaxed text-white/55 sm:text-xs">
              Offset = session time − video time at the anchor. Bind after both scrubbers show the moment you want
              linked; or jump an event, set the video frame, then bind.
            </div>
          </div>

          {/* Right: wall clock + nudges */}
          <aside className="flex shrink-0 flex-col gap-3 lg:order-3 lg:w-56 xl:w-60">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-3 sm:p-4">
              <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-white/50">
                <CalendarClock className="h-3.5 w-3.5" />
                <span>Wall clock → session</span>
              </div>
              <input
                type="datetime-local"
                step={1}
                value={realTimeInput}
                onChange={(event) => setRealTimeInput(event.target.value)}
                disabled={trackTimeOriginUnixMs == null}
                className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-300/60 disabled:cursor-not-allowed disabled:opacity-45"
              />
              <div className="mt-2 text-[11px] text-white/55">
                {trackTimeOriginUnixMs == null
                  ? 'This track has no reliable wall-clock origin.'
                  : realTrackTimeMs == null
                    ? 'Enter the real date/time for the current video frame.'
                    : realTimeInRange
                      ? `Maps to session ${formatTimestamp(realTrackTimeMs)}.`
                      : 'This real time is outside the track duration.'}
              </div>
              <button
                type="button"
                onClick={() => {
                  if (parsedRealTimeMs != null) onBindVideoRealTime(parsedRealTimeMs);
                }}
                disabled={!canBindRealTime}
                className="mt-3 w-full rounded-full border border-cyan-300/25 bg-cyan-500/15 px-4 py-2 text-sm font-medium text-cyan-50 transition hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-45"
              >
                Bind real time
              </button>
            </div>

            <div>
              <div className="mb-2 text-[10px] uppercase tracking-[0.2em] text-white/50">Nudge offset</div>
              <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
                {NUDGE_STEPS.map((deltaMs) => {
                  const positive = deltaMs > 0;
                  return (
                    <button
                      key={deltaMs}
                      type="button"
                      onClick={() => onAdjustOffset(deltaMs)}
                      className="flex items-center justify-center gap-1 rounded-xl border border-white/10 bg-white/5 px-2 py-2.5 text-xs transition hover:bg-white/10 sm:text-sm"
                    >
                      {positive ? <Plus className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
                      <span>
                        {Math.abs(deltaMs) >= 1000
                          ? `${Math.abs(deltaMs) / 1000}s`
                          : `${Math.abs(deltaMs)}ms`}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
