import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, Clock3, Minus, Plus, X } from 'lucide-react';
import { formatTimestamp } from '@/utils/formatters';
import {
  formatDatetimeLocalValue,
  parseDatetimeLocalValue,
  realTimeFromTrackTime,
  trackTimeFromRealTime,
} from '@/utils/videoSync';

const NUDGE_STEPS = [-5000, -1000, -100, 100, 1000, 5000] as const;

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
  offsetMs: number;
  sessionTimeMs: number;
  videoTimeMs: number;
  totalDurationMs: number;
  videoDurationMs: number;
  trackTimeOriginUnixMs?: number;
  anchorCount?: number;
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
  offsetMs,
  sessionTimeMs,
  videoTimeMs,
  totalDurationMs,
  videoDurationMs,
  trackTimeOriginUnixMs,
  anchorCount = 0,
  onClose,
  onAlignCurrentFrame,
  onBindVideoRealTime,
  onAdjustOffset,
  onResetOffset,
  onSessionSeek,
  onVideoSeek,
}: VideoSyncDialogProps) {
  const [realTimeInput, setRealTimeInput] = useState('');
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
    videoDurationMs > 0;

  useEffect(() => {
    if (!isOpen) return;
    setRealTimeInput(trackRealTimeMs != null ? formatDatetimeLocalValue(trackRealTimeMs) : '');
  }, [isOpen, trackTimeOriginUnixMs]); // Intentionally do not reset while scrubbing.

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-3xl border border-white/10 bg-stone-950/92 text-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
          <div>
            <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-[0.24em] text-white/55">
              <Clock3 className="h-3.5 w-3.5" />
              <span>Timeline Sync</span>
            </div>
            <h3 className="text-lg font-semibold">Align video to session time</h3>
            <div className="mt-1 text-sm text-white/55">
              {anchorCount > 0
                ? `${anchorCount} sync anchor${anchorCount > 1 ? 's' : ''}`
                : 'No saved sync anchor yet'}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 p-2 text-white/70 transition hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-4 px-5 py-5 md:grid-cols-4">
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
            <div className="mb-1 text-[10px] uppercase tracking-[0.2em] text-white/50">
              Session
            </div>
            <div className="text-xl font-semibold">{formatTimestamp(sessionTimeMs)}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
            <div className="mb-1 text-[10px] uppercase tracking-[0.2em] text-white/50">
              Video
            </div>
            <div className="text-xl font-semibold">{formatTimestamp(videoTimeMs)}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-cyan-500/10 px-4 py-3">
            <div className="mb-1 text-[10px] uppercase tracking-[0.2em] text-cyan-100/65">
              Offset
            </div>
            <div className="text-xl font-semibold">{(offsetMs / 1000).toFixed(1)}s</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
            <div className="mb-1 text-[10px] uppercase tracking-[0.2em] text-white/50">
              Track Clock
            </div>
            <div className="text-sm font-semibold leading-snug">
              {formatWallClock(trackRealTimeMs)}
            </div>
          </div>
        </div>

        <div className="px-5 pb-5">
          <div className="mb-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/70">
            Offset formula:{' '}
            <code className="rounded bg-black/30 px-1.5 py-0.5">
              sessionTime - videoTime
            </code>
            . Saved sync data keeps the anchor for future multi-anchor correction.
          </div>

          <div className="mb-4 grid gap-3">
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.2em] text-white/50">
                    Session side
                  </div>
                  <div className="text-sm text-white/80">
                    Pause here and drag the session timeline independently.
                  </div>
                </div>
                <div className="text-sm font-semibold">{formatTimestamp(sessionTimeMs)}</div>
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

            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.2em] text-white/50">
                    Video side
                  </div>
                  <div className="text-sm text-white/80">
                    Pause here and drag the video frame independently.
                  </div>
                </div>
                <div className="text-sm font-semibold">{formatTimestamp(videoTimeMs)}</div>
              </div>
              <input
                type="range"
                min={0}
                max={Math.max(videoDurationMs, 1)}
                step={100}
                value={Math.max(0, Math.min(videoTimeMs, Math.max(videoDurationMs, 1)))}
                onChange={(event) => onVideoSeek(Number(event.target.value))}
                disabled={videoDurationMs <= 0}
                className="w-full accent-cyan-500 disabled:opacity-40"
              />
            </div>
          </div>

          <div className="mb-4 flex flex-wrap gap-3">
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

          <div className="mb-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
            <div className="mb-3 flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-white/50">
              <CalendarClock className="h-3.5 w-3.5" />
              <span>Set Video Real Time</span>
            </div>
            <div className="grid gap-3 md:grid-cols-[1fr_auto]">
              <div>
                <input
                  type="datetime-local"
                  step={1}
                  value={realTimeInput}
                  onChange={(event) => setRealTimeInput(event.target.value)}
                  disabled={trackTimeOriginUnixMs == null}
                  className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-300/60 disabled:cursor-not-allowed disabled:opacity-45"
                />
                <div className="mt-2 text-xs text-white/60">
                  {trackTimeOriginUnixMs == null
                    ? 'This track has no reliable wall-clock origin.'
                    : realTrackTimeMs == null
                      ? 'Enter a real date and time for the current video frame.'
                      : realTimeInRange
                        ? `Maps to session ${formatTimestamp(realTrackTimeMs)}.`
                        : 'This real time falls outside the track duration.'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (parsedRealTimeMs != null) onBindVideoRealTime(parsedRealTimeMs);
                }}
                disabled={!canBindRealTime}
                className="rounded-full border border-cyan-300/25 bg-cyan-500/15 px-4 py-2 text-sm font-medium text-cyan-50 transition hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-45"
              >
                Bind real time
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {NUDGE_STEPS.map((deltaMs) => {
              const positive = deltaMs > 0;
              return (
                <button
                  key={deltaMs}
                  type="button"
                  onClick={() => onAdjustOffset(deltaMs)}
                  className="flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-sm transition hover:bg-white/10"
                >
                  {positive ? <Plus className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
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
      </div>
    </div>
  );
}
