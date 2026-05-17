import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Pause, Clock } from 'lucide-react';
import { useTheme } from '@/theme/ThemeContext';
import { clamp, formatTimestamp } from '@/utils/formatters';
import type { SessionEvent } from '@/types/models';

export interface WorkspaceWindowMs {
  startMs: number;
  endMs: number;
}

export interface TimelineVideoTrack {
  id: string;
  label: string;
  offsetMs: number;
  durationMs: number;
  active?: boolean;
}

interface TimelineProps {
  currentTime: number;
  totalDuration: number;
  workspaceWindow: WorkspaceWindowMs;
  onChangeWorkspace: (next: WorkspaceWindowMs) => void;
  /** Committed video offset (session time at video t=0) */
  videoOffsetMs: number;
  videoDurationMs: number;
  videoTracks?: TimelineVideoTrack[];
  /** While dragging video bar, preview offset; null = use videoOffsetMs */
  draftVideoOffsetMs: number | null;
  onDraftVideoOffset: (ms: number | null) => void;
  onCommitVideoOffset: (ms: number, videoId?: string) => void;
  onSelectVideoTrack?: (videoId: string) => void;
  showVideoTrack: boolean;
  isPlaying: boolean;
  playbackSpeed: number;
  /** Events already filtered to workspace (for workspace track markers) */
  workspaceEvents: SessionEvent[];
  onSelectEvent?: (event: SessionEvent) => void;
  className?: string;
  onTogglePlay: () => void;
  onSeek: (time: number) => void;
  onSeekStart?: () => void;
  onSeekEnd?: (time: number) => void;
  onSpeedChange: (speed: number) => void;
  onSkip: (deltaMs: number) => void;
  onOpenSync?: () => void;
  syncDisabled?: boolean;
  syncLabel?: string;
}

const MIN_SPEED = 0.5;
const MAX_SPEED = 10;
const SPEED_STEP = 0.1;
const SPEED_PRESETS = [0.5, 1, 2, 5, 10] as const;
const MIN_WORKSPACE_SPAN_MS = 5000;
const GLOBAL_HANDLE_PX = 10;
const JUMP_CONTROLS = [
  { label: '-30s', deltaMs: -30000 },
  { label: '-10s', deltaMs: -10000 },
  { label: '+10s', deltaMs: 10000 },
  { label: '+30s', deltaMs: 30000 },
] as const;

/** Match video drag strip: semi-transparent violet */
const VIDEO_NUDGE_BTN_CLASS =
  'shrink-0 px-1.5 py-0.5 min-w-[2.35rem] text-[10px] font-mono leading-tight rounded border border-violet-400/90 bg-violet-500/35 text-white/90 hover:bg-violet-500/50 active:bg-violet-500/60 disabled:opacity-40 disabled:pointer-events-none disabled:cursor-not-allowed';
const VIDEO_NUDGE_TOOLBAR_CLASS =
  'pointer-events-none absolute bottom-full z-20 mb-2 flex w-[9rem] -translate-x-1/2 items-center justify-center gap-1 rounded-full border border-violet-300/30 bg-stone-950/88 px-1.5 py-1 shadow-lg opacity-0 backdrop-blur-sm transition duration-150 group-hover:opacity-100 group-hover:pointer-events-auto';
const VIDEO_NUDGE_TOOLBAR_BTN_CLASS =
  'inline-flex min-w-[1.9rem] items-center justify-center rounded-full px-2 py-1 text-[10px] font-mono leading-none text-white/88 transition hover:bg-violet-500/35 active:bg-violet-500/45 disabled:opacity-40 disabled:pointer-events-none disabled:cursor-not-allowed';
const TRACK_LABEL_WIDTH_CLASS = 'hidden sm:flex w-28 md:w-32 shrink-0';
const EVENT_ENTRY_HIGHLIGHT_PADDING_MS = 4000;

function eventMarkerClass(type: SessionEvent['type']): string {
  switch (type) {
    case 'tack':
      return 'bg-[#38BDF8]';
    case 'gybe':
      return 'bg-[#6366F1]';
    case 'mark_rounding':
      return 'bg-amber-400';
    case 'penalty_360':
    case 'penalty_720':
      return 'bg-red-500';
    case 'other_turn':
      return 'bg-stone-400';
    default:
      return 'bg-yellow-400';
  }
}

function eventTitle(event: SessionEvent): string {
  const parts = [event.note];
  if (event.autoDetected) parts.push('Auto detected');
  if (event.confidence != null) parts.push(`${Math.round(event.confidence * 100)}% confidence`);
  return parts.join('\n');
}

function eventSeekTime(event: SessionEvent): number {
  const start = event.startTime ?? event.timestamp;
  return Math.max(0, start - EVENT_ENTRY_HIGHLIGHT_PADDING_MS);
}

function formatSignedSeconds(ms: number): string {
  const sign = ms > 0 ? '+' : ms < 0 ? '-' : '';
  return `${sign}${(Math.abs(ms) / 1000).toFixed(1)}s`;
}

function timeFromClientX(
  el: HTMLDivElement | null,
  clientX: number,
  totalDuration: number,
): number {
  if (!el || totalDuration <= 0) return 0;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0) return 0;
  const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
  return ratio * totalDuration;
}

export default function Timeline({
  currentTime,
  totalDuration,
  workspaceWindow,
  onChangeWorkspace,
  videoOffsetMs,
  videoDurationMs,
  videoTracks,
  draftVideoOffsetMs,
  onDraftVideoOffset,
  onCommitVideoOffset,
  onSelectVideoTrack,
  showVideoTrack,
  isPlaying,
  playbackSpeed,
  workspaceEvents,
  onSelectEvent,
  className = '',
  onTogglePlay,
  onSeek,
  onSeekStart,
  onSeekEnd,
  onSpeedChange,
  onSkip,
  onOpenSync,
  syncDisabled = false,
  syncLabel = 'Sync',
}: TimelineProps) {
  const { s, themeId } = useTheme();
  const workspaceBarRef = useRef<HTMLDivElement>(null);
  const globalBarRef = useRef<HTMLDivElement>(null);
  const videoBarRef = useRef<HTMLDivElement>(null);

  const seekFrameRef = useRef<number>(0);
  const pendingSeekRef = useRef<number | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const [isScrubbingWorkspace, setIsScrubbingWorkspace] = useState(false);
  const [scrubTime, setScrubTime] = useState<number | null>(null);

  const workspaceDurationMs = Math.max(0, workspaceWindow.endMs - workspaceWindow.startMs);
  const normalizedVideoTracks =
    videoTracks && videoTracks.length > 0
      ? videoTracks
      : showVideoTrack
        ? [
            {
              id: 'active',
              label: 'Video',
              offsetMs: videoOffsetMs,
              durationMs: videoDurationMs,
              active: true,
            },
          ]
        : [];
  const activeVideoTrack =
    normalizedVideoTracks.find((track) => track.active) ?? normalizedVideoTracks[0] ?? null;
  const effectiveVideoOffset = draftVideoOffsetMs ?? activeVideoTrack?.offsetMs ?? videoOffsetMs;
  const effectiveVideoDurationMs = activeVideoTrack?.durationMs ?? videoDurationMs;

  const displayGlobalTime = scrubTime ?? currentTime;

  const workspaceLocalMs =
    workspaceDurationMs > 0
      ? clamp(displayGlobalTime - workspaceWindow.startMs, 0, workspaceDurationMs)
      : 0;
  const workspacePlayheadRatio =
    workspaceDurationMs > 0 ? workspaceLocalMs / workspaceDurationMs : 0;
  const workspacePct = `${(workspacePlayheadRatio * 100).toFixed(2)}%`;

  const globalPlayheadRatio = totalDuration > 0 ? displayGlobalTime / totalDuration : 0;
  const globalPct = `${(globalPlayheadRatio * 100).toFixed(2)}%`;

  const windowStartRatio = totalDuration > 0 ? workspaceWindow.startMs / totalDuration : 0;
  const windowEndRatio = totalDuration > 0 ? workspaceWindow.endMs / totalDuration : 0;

  const videoStartRatio =
    totalDuration > 0 ? clamp(effectiveVideoOffset / totalDuration, 0, 1) : 0;
  const videoEndRatio =
    totalDuration > 0 && effectiveVideoDurationMs > 0
      ? clamp((effectiveVideoOffset + effectiveVideoDurationMs) / totalDuration, 0, 1)
      : videoStartRatio;
  const videoLeftPct = `${(videoStartRatio * 100).toFixed(2)}%`;
  const videoWidthPct = `${(Math.max(0, videoEndRatio - videoStartRatio) * 100).toFixed(2)}%`;
  const videoCenterPct = `${(((videoStartRatio + videoEndRatio) / 2) * 100).toFixed(2)}%`;

  const isCyber = themeId === 'cyber';
  const isRound = themeId === 'nordic' || themeId === 'frost' || themeId === 'neumorph';

  const flushSeek = useCallback(
    (time?: number) => {
      const nextTime = time ?? pendingSeekRef.current;
      if (nextTime == null) return;

      if (seekFrameRef.current) {
        cancelAnimationFrame(seekFrameRef.current);
        seekFrameRef.current = 0;
      }

      pendingSeekRef.current = null;
      onSeek(nextTime);
    },
    [onSeek],
  );

  const scheduleSeek = useCallback(
    (time: number) => {
      const clamped =
        workspaceDurationMs > 0
          ? clamp(time, workspaceWindow.startMs, workspaceWindow.endMs)
          : clamp(time, 0, totalDuration);
      setScrubTime(clamped);
      pendingSeekRef.current = clamped;

      if (seekFrameRef.current) return;
      seekFrameRef.current = requestAnimationFrame(() => {
        seekFrameRef.current = 0;
        flushSeek();
      });
    },
    [
      flushSeek,
      totalDuration,
      workspaceDurationMs,
      workspaceWindow.endMs,
      workspaceWindow.startMs,
    ],
  );

  const finishWorkspaceScrub = useCallback(
    (target: HTMLDivElement, pointerId: number, time: number) => {
      const clamped =
        workspaceDurationMs > 0
          ? clamp(time, workspaceWindow.startMs, workspaceWindow.endMs)
          : clamp(time, 0, totalDuration);
      flushSeek(clamped);
      setIsScrubbingWorkspace(false);
      setScrubTime(null);
      activePointerIdRef.current = null;
      if (target.hasPointerCapture(pointerId)) {
        target.releasePointerCapture(pointerId);
      }
      onSeekEnd?.(clamped);
    },
    [
      flushSeek,
      onSeekEnd,
      totalDuration,
      workspaceDurationMs,
      workspaceWindow.endMs,
      workspaceWindow.startMs,
    ],
  );

  const handleWorkspacePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (workspaceDurationMs <= 0 && totalDuration <= 0) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;

      const el = workspaceBarRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0) return;
      const ratio = clamp((e.clientX - rect.left) / rect.width, 0, 1);
      const t =
        workspaceDurationMs > 0
          ? workspaceWindow.startMs + ratio * workspaceDurationMs
          : ratio * totalDuration;

      activePointerIdRef.current = e.pointerId;
      setIsScrubbingWorkspace(true);
      onSeekStart?.();
      e.currentTarget.setPointerCapture(e.pointerId);
      scheduleSeek(t);
      e.preventDefault();
    },
    [
      onSeekStart,
      scheduleSeek,
      totalDuration,
      workspaceDurationMs,
      workspaceWindow.startMs,
    ],
  );

  const handleWorkspacePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isScrubbingWorkspace || activePointerIdRef.current !== e.pointerId) return;
      const el = workspaceBarRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0) return;
      const ratio = clamp((e.clientX - rect.left) / rect.width, 0, 1);
      const t =
        workspaceDurationMs > 0
          ? workspaceWindow.startMs + ratio * workspaceDurationMs
          : ratio * totalDuration;
      scheduleSeek(t);
    },
    [isScrubbingWorkspace, scheduleSeek, workspaceDurationMs, workspaceWindow.startMs],
  );

  const handleWorkspacePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isScrubbingWorkspace || activePointerIdRef.current !== e.pointerId) return;
      const el = workspaceBarRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const ratio = rect.width > 0 ? clamp((e.clientX - rect.left) / rect.width, 0, 1) : 0;
      const t =
        workspaceDurationMs > 0
          ? workspaceWindow.startMs + ratio * workspaceDurationMs
          : ratio * totalDuration;
      finishWorkspaceScrub(e.currentTarget, e.pointerId, t);
    },
    [finishWorkspaceScrub, isScrubbingWorkspace, workspaceDurationMs, workspaceWindow.startMs],
  );

  const handleWorkspacePointerCancel = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isScrubbingWorkspace || activePointerIdRef.current !== e.pointerId) return;
      finishWorkspaceScrub(e.currentTarget, e.pointerId, scrubTime ?? currentTime);
    },
    [currentTime, finishWorkspaceScrub, isScrubbingWorkspace, scrubTime],
  );

  type GlobalDragMode = 'move' | 'resize-left' | 'resize-right' | 'jump' | null;
  const globalDragRef = useRef<{
    mode: GlobalDragMode;
    pointerId: number;
    startX: number;
    startWindow: WorkspaceWindowMs;
    grabOffsetMs?: number;
  } | null>(null);

  const minSpanMs = Math.min(MIN_WORKSPACE_SPAN_MS, Math.max(0, totalDuration));

  const clampWindow = useCallback(
    (start: number, end: number): WorkspaceWindowMs => {
      if (totalDuration <= 0) return { startMs: 0, endMs: 0 };
      const minSpan = Math.min(MIN_WORKSPACE_SPAN_MS, totalDuration);
      let startMs = clamp(start, 0, totalDuration);
      let endMs = clamp(end, 0, totalDuration);
      if (endMs - startMs < minSpan) {
        if (startMs + minSpan <= totalDuration) {
          endMs = startMs + minSpan;
        } else {
          endMs = totalDuration;
          startMs = Math.max(0, endMs - minSpan);
        }
      }
      if (startMs >= endMs) {
        endMs = Math.min(totalDuration, startMs + minSpan);
      }
      return { startMs, endMs };
    },
    [totalDuration],
  );

  const hitTestGlobal = useCallback(
    (clientX: number): { mode: GlobalDragMode; t: number } => {
      const el = globalBarRef.current;
      const t = timeFromClientX(el, clientX, totalDuration);
      if (!el || totalDuration <= 0) return { mode: 'jump', t };

      const rect = el.getBoundingClientRect();
      const x = clientX - rect.left;
      const w = rect.width;
      const ws = windowStartRatio * w;
      const we = windowEndRatio * w;

      if (x >= ws - GLOBAL_HANDLE_PX && x <= ws + GLOBAL_HANDLE_PX) {
        return { mode: 'resize-left', t };
      }
      if (x >= we - GLOBAL_HANDLE_PX && x <= we + GLOBAL_HANDLE_PX) {
        return { mode: 'resize-right', t };
      }
      if (x > ws + GLOBAL_HANDLE_PX && x < we - GLOBAL_HANDLE_PX) {
        return { mode: 'move', t };
      }
      return { mode: 'jump', t };
    },
    [totalDuration, windowEndRatio, windowStartRatio],
  );

  const handleGlobalPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (totalDuration <= 0) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;

      const { mode, t } = hitTestGlobal(e.clientX);

      if (mode === 'jump') {
        const span = workspaceWindow.endMs - workspaceWindow.startMs;
        let nw = { ...workspaceWindow };
        if (t < nw.startMs || t > nw.endMs) {
          const nextStart = clamp(t - span / 2, 0, Math.max(0, totalDuration - span));
          nw = clampWindow(nextStart, nextStart + span);
          onChangeWorkspace(nw);
        }
        onSeek(clamp(t, nw.startMs, nw.endMs));
        e.preventDefault();
        return;
      }

      let grabOffsetMs = 0;
      if (mode === 'move') {
        grabOffsetMs = t - workspaceWindow.startMs;
      }

      globalDragRef.current = {
        mode,
        pointerId: e.pointerId,
        startX: e.clientX,
        startWindow: { ...workspaceWindow },
        grabOffsetMs,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
      e.preventDefault();
    },
    [clampWindow, hitTestGlobal, onChangeWorkspace, onSeek, totalDuration, workspaceWindow],
  );

  const handleGlobalPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = globalDragRef.current;
      if (!drag || drag.pointerId !== e.pointerId || totalDuration <= 0) return;

      const el = globalBarRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0) return;
      const deltaMs = ((e.clientX - drag.startX) / rect.width) * totalDuration;

      if (drag.mode === 'move') {
        const span = drag.startWindow.endMs - drag.startWindow.startMs;
        const tNow = timeFromClientX(el, e.clientX, totalDuration);
        const grab = drag.grabOffsetMs ?? 0;
        const nextStart = clamp(tNow - grab, 0, Math.max(0, totalDuration - span));
        onChangeWorkspace(clampWindow(nextStart, nextStart + span));
        return;
      }

      if (drag.mode === 'resize-left') {
        const nextStart = clamp(
          drag.startWindow.startMs + deltaMs,
          0,
          drag.startWindow.endMs - minSpanMs,
        );
        onChangeWorkspace(clampWindow(nextStart, drag.startWindow.endMs));
        return;
      }

      if (drag.mode === 'resize-right') {
        const nextEnd = clamp(
          drag.startWindow.endMs + deltaMs,
          drag.startWindow.startMs + minSpanMs,
          totalDuration,
        );
        onChangeWorkspace(clampWindow(drag.startWindow.startMs, nextEnd));
      }
    },
    [clampWindow, minSpanMs, onChangeWorkspace, totalDuration],
  );

  const handleGlobalPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = globalDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    globalDragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }, []);

  const videoDragRef = useRef<{
    pointerId: number;
    originOffsetMs: number;
    startClientX: number;
  } | null>(null);

  const handleVideoBarPointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (!showVideoTrack || totalDuration <= 0 || effectiveVideoDurationMs <= 0) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.stopPropagation();
      videoDragRef.current = {
        pointerId: e.pointerId,
        originOffsetMs: effectiveVideoOffset,
        startClientX: e.clientX,
      };
      onDraftVideoOffset(effectiveVideoOffset);
      e.currentTarget.setPointerCapture(e.pointerId);
      e.preventDefault();
    },
    [effectiveVideoDurationMs, effectiveVideoOffset, onDraftVideoOffset, showVideoTrack, totalDuration],
  );

  const handleVideoBarPointerMove = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      const drag = videoDragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      const el = videoBarRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0) return;
      const deltaMs = ((e.clientX - drag.startClientX) / rect.width) * totalDuration;
      const next = drag.originOffsetMs + deltaMs;
      onDraftVideoOffset(next);
    },
    [onDraftVideoOffset, totalDuration],
  );

  const handleVideoBarPointerUp = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      const drag = videoDragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      videoDragRef.current = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      const el = videoBarRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const deltaMs =
        rect.width > 0 ? ((e.clientX - drag.startClientX) / rect.width) * totalDuration : 0;
      const next = drag.originOffsetMs + deltaMs;
      onCommitVideoOffset(next, activeVideoTrack?.id);
      onDraftVideoOffset(null);
    },
    [activeVideoTrack?.id, onCommitVideoOffset, onDraftVideoOffset],
  );

  const handleVideoBarPointerCancel = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      const drag = videoDragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      videoDragRef.current = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      onDraftVideoOffset(null);
    },
    [onDraftVideoOffset],
  );

  const nudgeVideoOffsetMs = useCallback(
    (deltaMs: number) => {
      if (!showVideoTrack || effectiveVideoDurationMs <= 0) return;
      const next = effectiveVideoOffset + deltaMs;
      onDraftVideoOffset(null);
      onCommitVideoOffset(next, activeVideoTrack?.id);
    },
    [
      activeVideoTrack?.id,
      effectiveVideoDurationMs,
      effectiveVideoOffset,
      onCommitVideoOffset,
      onDraftVideoOffset,
      showVideoTrack,
    ],
  );

  useEffect(() => {
    return () => {
      if (seekFrameRef.current) {
        cancelAnimationFrame(seekFrameRef.current);
      }
    };
  }, []);

  const playheadKnobClass = `absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 shadow-md ${
    isCyber
      ? 'bg-pink-500 rounded-none h-6 w-2'
      : isRound
        ? 'bg-white rounded-full border border-stone-300'
        : 'bg-white rounded-full'
  }`;

  const renderTrackRow = (
    label: string,
    leftTime: string,
    rightTime: string,
    bar: React.ReactNode,
    options?: {
      key?: string;
      subtitle?: string;
      detail?: string;
      active?: boolean;
      onSelect?: () => void;
    },
  ) => (
    <div key={options?.key} className="w-full flex items-center gap-2 sm:gap-3">
      {options?.onSelect ? (
        <button
          type="button"
          onClick={options.onSelect}
          className={`${TRACK_LABEL_WIDTH_CLASS} group/label relative h-7 items-center justify-start overflow-visible rounded-sm border px-2 text-left ${
            options.active
              ? 'border-violet-300/60 bg-violet-500/25 text-white'
              : `${s.divider} ${s.textSecondary} hover:bg-current/5`
          }`}
          title={options.detail ?? options.subtitle ?? label}
          aria-pressed={options.active}
        >
          <span className="w-full truncate text-[10px] font-medium leading-none normal-case tracking-normal">
            {label}
          </span>
          {options.detail ? (
            <span className="pointer-events-none absolute bottom-full left-0 z-40 mb-2 hidden w-64 max-w-[70vw] whitespace-pre-line rounded-md border border-white/10 bg-stone-950/95 px-3 py-2 text-xs leading-relaxed text-white shadow-xl group-hover/label:block">
              {options.detail}
            </span>
          ) : null}
        </button>
      ) : (
        <span
          className={`${TRACK_LABEL_WIDTH_CLASS} items-center overflow-hidden text-[10px] uppercase tracking-wider ${s.textSecondary}`}
          title={label}
        >
          <span className="truncate">{label}</span>
        </span>
      )}
      <span className={`text-xs font-mono w-14 shrink-0 text-right ${s.textPrimary}`}>
        {leftTime}
      </span>
      <div className="flex-1 min-w-0">{bar}</div>
      <span className={`text-xs font-mono w-14 shrink-0 ${s.textSecondary}`}>{rightTime}</span>
    </div>
  );

  return (
    <footer className={`${s.panel} ${className} p-4 z-10 relative flex flex-col gap-3`}>
      <div className="w-full flex flex-col gap-2.5">
        {renderTrackRow(
          'Workspace',
          formatTimestamp(workspaceLocalMs),
          formatTimestamp(workspaceDurationMs),
          <div
            ref={workspaceBarRef}
            onPointerDown={handleWorkspacePointerDown}
            onPointerMove={handleWorkspacePointerMove}
            onPointerUp={handleWorkspacePointerUp}
            onPointerCancel={handleWorkspacePointerCancel}
            className={`h-2.5 relative overflow-visible touch-none select-none ${
              isScrubbingWorkspace ? 'cursor-grabbing' : 'cursor-pointer'
            } ${s.progressTrack}`}
            title="Workspace timeline — scrub playhead"
          >
            <div
              className={`absolute top-0 left-0 h-full ${s.progressFill} opacity-90`}
              style={{ width: workspacePct }}
            />
            <div className={playheadKnobClass} style={{ left: workspacePct }} />
            {workspaceEvents.map((ev) => {
              if (workspaceDurationMs <= 0) return null;
              const seekTime = eventSeekTime(ev);
              const local = ev.timestamp - workspaceWindow.startMs;
              const evRatio = clamp(local / workspaceDurationMs, 0, 1);
              const hasWindow = ev.startTime != null && ev.endTime != null && ev.endTime > ev.startTime;
              const windowStartRatio = hasWindow
                ? clamp((ev.startTime! - workspaceWindow.startMs) / workspaceDurationMs, 0, 1)
                : evRatio;
              const windowEndRatio = hasWindow
                ? clamp((ev.endTime! - workspaceWindow.startMs) / workspaceDurationMs, 0, 1)
                : evRatio;
              const markerClass = eventMarkerClass(ev.type);
              return (
                <button
                  key={ev.id}
                  type="button"
                  className="absolute inset-y-0 z-10 cursor-pointer bg-transparent p-0"
                  style={{
                    left: hasWindow
                      ? `${(windowStartRatio * 100).toFixed(2)}%`
                      : `calc(${(evRatio * 100).toFixed(2)}% - 0.5rem)`,
                    width: hasWindow
                      ? `${(Math.max(0.01, windowEndRatio - windowStartRatio) * 100).toFixed(2)}%`
                      : '1rem',
                  }}
                  title={eventTitle(ev)}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (onSelectEvent) {
                      onSelectEvent(ev);
                      return;
                    }
                    onSeek(seekTime);
                  }}
                  aria-label={`Seek to ${ev.type} start`}
                >
                  {hasWindow ? (
                    <div
                      className={`absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-sm opacity-35 ${markerClass}`}
                    />
                  ) : null}
                  <div
                    className={`absolute top-1/2 -translate-y-1/2 w-1.5 h-3 rounded-sm ${markerClass}`}
                    style={{
                      left: hasWindow
                        ? `${(clamp((ev.timestamp - (ev.startTime ?? ev.timestamp)) / Math.max(1, (ev.endTime ?? ev.timestamp) - (ev.startTime ?? ev.timestamp)), 0, 1) * 100).toFixed(2)}%`
                        : '50%',
                    }}
                  />
                </button>
              );
            })}
          </div>,
        )}

        {renderTrackRow(
          'Session',
          formatTimestamp(displayGlobalTime),
          formatTimestamp(totalDuration),
          <div
            ref={globalBarRef}
            onPointerDown={handleGlobalPointerDown}
            onPointerMove={handleGlobalPointerMove}
            onPointerUp={handleGlobalPointerUp}
            onPointerCancel={handleGlobalPointerUp}
            className={`h-2 relative overflow-visible touch-none select-none cursor-pointer ${s.progressTrack}`}
            title="Session timeline — workspace window & context"
          >
            <div
              className={`absolute top-0 left-0 h-full ${s.progressFill} opacity-25`}
              style={{ width: globalPct }}
            />
            <div
              className="absolute top-0 bottom-0 rounded-sm border-2 border-cyan-500/90 bg-cyan-400/15"
              style={{
                left: `${(windowStartRatio * 100).toFixed(2)}%`,
                width: `${Math.max(0, windowEndRatio - windowStartRatio) * 100}%`,
              }}
            >
              <div className="absolute left-0 top-0 bottom-0 w-1 bg-cyan-400 cursor-ew-resize" />
              <div className="absolute right-0 top-0 bottom-0 w-1 bg-cyan-400 cursor-ew-resize" />
            </div>
            <div className={playheadKnobClass} style={{ left: globalPct }} />
          </div>,
        )}

        {normalizedVideoTracks.length > 0
          ? normalizedVideoTracks.map((track, index) => {
              const isActiveTrack = activeVideoTrack?.id === track.id;
              const trackOffset =
                isActiveTrack && draftVideoOffsetMs != null ? effectiveVideoOffset : track.offsetMs;
              const trackDuration =
                isActiveTrack ? effectiveVideoDurationMs : track.durationMs;
              const startRatio = totalDuration > 0 ? clamp(trackOffset / totalDuration, 0, 1) : 0;
              const endRatio =
                totalDuration > 0 && trackDuration > 0
                  ? clamp((trackOffset + trackDuration) / totalDuration, 0, 1)
                  : startRatio;
              const leftPct = `${(startRatio * 100).toFixed(2)}%`;
              const widthPct = `${(Math.max(0, endRatio - startRatio) * 100).toFixed(2)}%`;
              const centerPct = `${(((startRatio + endRatio) / 2) * 100).toFixed(2)}%`;
              const videoLocalMs = clamp(displayGlobalTime - trackOffset, 0, trackDuration || 0);
              const videoTrackName =
                normalizedVideoTracks.length > 1 ? `Video ${index + 1}` : 'Video';
              const videoTrackLabel = track.label
                ? `${videoTrackName} (${track.label})`
                : videoTrackName;
              const videoTrackDetail = [
                `${videoTrackName}: ${track.label || 'Untitled video'}`,
                `Offset: ${formatSignedSeconds(trackOffset)}`,
                `Duration: ${trackDuration > 0 ? formatTimestamp(trackDuration) : 'pending'}`,
              ].join('\n');

              return renderTrackRow(
                videoTrackLabel,
                formatTimestamp(videoLocalMs),
                trackDuration > 0 ? formatTimestamp(trackDuration) : '--',
                <div className="flex flex-1 min-w-0 items-center">
                  <div
                    ref={isActiveTrack ? videoBarRef : undefined}
                    className={`group relative flex-1 min-w-0 min-h-[1.25rem] overflow-visible touch-none select-none ${s.progressTrack}`}
                    title={
                      isActiveTrack
                        ? 'Drag video clip to adjust sync offset'
                        : 'Select this video to adjust sync'
                    }
                  >
                    <div
                      className={`absolute top-1/2 -translate-y-1/2 left-0 right-0 h-2 ${s.progressTrack}`}
                    >
                      <div
                        className={`absolute top-0 left-0 h-full ${s.progressFill} opacity-15`}
                        style={{ width: globalPct }}
                      />
                      {isActiveTrack && trackDuration > 0 ? (
                        <div
                          className={VIDEO_NUDGE_TOOLBAR_CLASS}
                          style={{ left: `clamp(4.5rem, ${centerPct}, calc(100% - 4.5rem))` }}
                          role="group"
                          aria-label="Nudge video sync"
                        >
                          <button
                            type="button"
                            className={VIDEO_NUDGE_TOOLBAR_BTN_CLASS}
                            onClick={(e) => {
                              e.stopPropagation();
                              nudgeVideoOffsetMs(-5000);
                            }}
                            title="Offset -5s (video earlier)"
                          >
                            -5
                          </button>
                          <button
                            type="button"
                            className={VIDEO_NUDGE_TOOLBAR_BTN_CLASS}
                            onClick={(e) => {
                              e.stopPropagation();
                              nudgeVideoOffsetMs(-1000);
                            }}
                            title="Offset -1s (video earlier)"
                          >
                            -1
                          </button>
                          <button
                            type="button"
                            className={VIDEO_NUDGE_TOOLBAR_BTN_CLASS}
                            onClick={(e) => {
                              e.stopPropagation();
                              nudgeVideoOffsetMs(1000);
                            }}
                            title="Offset +1s (video later)"
                          >
                            +1
                          </button>
                          <button
                            type="button"
                            className={VIDEO_NUDGE_TOOLBAR_BTN_CLASS}
                            onClick={(e) => {
                              e.stopPropagation();
                              nudgeVideoOffsetMs(5000);
                            }}
                            title="Offset +5s (video later)"
                          >
                            +5
                          </button>
                        </div>
                      ) : null}
                      {trackDuration > 0 ? (
                        isActiveTrack ? (
                          <button
                            type="button"
                            onPointerDown={handleVideoBarPointerDown}
                            onPointerMove={handleVideoBarPointerMove}
                            onPointerUp={handleVideoBarPointerUp}
                            onPointerCancel={handleVideoBarPointerCancel}
                            className="absolute top-1/2 -translate-y-1/2 h-4 min-h-[1.25rem] rounded border border-violet-400/90 bg-violet-500/35 hover:bg-violet-500/50 cursor-grab active:cursor-grabbing"
                            style={{ left: leftPct, width: widthPct }}
                            aria-label="Drag to adjust video sync offset"
                          />
                        ) : (
                          <div
                            className="absolute top-1/2 -translate-y-1/2 h-3 rounded border border-violet-300/35 bg-violet-500/18"
                            style={{ left: leftPct, width: widthPct }}
                          />
                        )
                      ) : (
                        <span className={`absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-[10px] ${s.textSecondary}`}>
                          Duration pending...
                        </span>
                      )}
                      <div
                        className={`${playheadKnobClass} pointer-events-none`}
                        style={{ left: globalPct }}
                      />
                    </div>
                  </div>
                </div>,
                {
                  key: track.id,
                  subtitle: track.label,
                  detail: videoTrackDetail,
                  active: isActiveTrack,
                  onSelect: () => onSelectVideoTrack?.(track.id),
                },
              );
            })
          : renderTrackRow(
              'Video',
              '--',
              '--',
              <div
                className={`h-2 relative flex items-center px-2 ${s.progressTrack} ${s.textSecondary} text-[10px]`}
              >
                No video bound
              </div>,
            )}

        {false && (showVideoTrack
          ? renderTrackRow(
              'Video',
              formatTimestamp(
                clamp(displayGlobalTime - effectiveVideoOffset, 0, videoDurationMs || 0),
              ),
              formatTimestamp(videoDurationMs),
              <div className="flex flex-1 min-w-0 items-center gap-1.5">
                <div
                  className="hidden"
                  role="group"
                  aria-label="Nudge video sync earlier"
                >
                  <button
                    type="button"
                    className={VIDEO_NUDGE_BTN_CLASS}
                    disabled={videoDurationMs <= 0}
                    onClick={(e) => {
                      e.stopPropagation();
                      nudgeVideoOffsetMs(-1000);
                    }}
                    title="Offset −1s (video earlier)"
                  >
                    −1s
                  </button>
                  <button
                    type="button"
                    className={VIDEO_NUDGE_BTN_CLASS}
                    disabled={videoDurationMs <= 0}
                    onClick={(e) => {
                      e.stopPropagation();
                      nudgeVideoOffsetMs(-5000);
                    }}
                    title="Offset −5s (video earlier)"
                  >
                    −5s
                  </button>
                </div>
                <div
                  ref={videoBarRef}
                  className={`group relative flex-1 min-w-0 min-h-[1.25rem] overflow-visible touch-none select-none ${s.progressTrack}`}
                  title="Drag video clip to adjust sync offset"
                >
                  <div
                    className={`absolute top-1/2 -translate-y-1/2 left-0 right-0 h-2 ${s.progressTrack}`}
                  >
                    <div
                      className={`absolute top-0 left-0 h-full ${s.progressFill} opacity-15`}
                      style={{ width: globalPct }}
                    />
                    {videoDurationMs > 0 ? (
                      <div
                        className={VIDEO_NUDGE_TOOLBAR_CLASS}
                        style={{ left: `clamp(4.5rem, ${videoCenterPct}, calc(100% - 4.5rem))` }}
                        role="group"
                        aria-label="Nudge video sync"
                      >
                        <button
                          type="button"
                          className={VIDEO_NUDGE_TOOLBAR_BTN_CLASS}
                          disabled={videoDurationMs <= 0}
                          onClick={(e) => {
                            e.stopPropagation();
                            nudgeVideoOffsetMs(-5000);
                          }}
                          title="Offset -5s (video earlier)"
                        >
                          -5
                        </button>
                        <button
                          type="button"
                          className={VIDEO_NUDGE_TOOLBAR_BTN_CLASS}
                          disabled={videoDurationMs <= 0}
                          onClick={(e) => {
                            e.stopPropagation();
                            nudgeVideoOffsetMs(-1000);
                          }}
                          title="Offset -1s (video earlier)"
                        >
                          -1
                        </button>
                        <button
                          type="button"
                          className={VIDEO_NUDGE_TOOLBAR_BTN_CLASS}
                          disabled={videoDurationMs <= 0}
                          onClick={(e) => {
                            e.stopPropagation();
                            nudgeVideoOffsetMs(1000);
                          }}
                          title="Offset +1s (video later)"
                        >
                          +1
                        </button>
                        <button
                          type="button"
                          className={VIDEO_NUDGE_TOOLBAR_BTN_CLASS}
                          disabled={videoDurationMs <= 0}
                          onClick={(e) => {
                            e.stopPropagation();
                            nudgeVideoOffsetMs(5000);
                          }}
                          title="Offset +5s (video later)"
                        >
                          +5
                        </button>
                      </div>
                    ) : null}
                    {videoDurationMs > 0 ? (
                      <button
                        type="button"
                        onPointerDown={handleVideoBarPointerDown}
                        onPointerMove={handleVideoBarPointerMove}
                        onPointerUp={handleVideoBarPointerUp}
                        onPointerCancel={handleVideoBarPointerCancel}
                        className="absolute top-1/2 -translate-y-1/2 h-4 min-h-[1.25rem] rounded border border-violet-400/90 bg-violet-500/35 hover:bg-violet-500/50 cursor-grab active:cursor-grabbing"
                        style={{ left: videoLeftPct, width: videoWidthPct }}
                        aria-label="Drag to adjust video sync offset"
                      />
                    ) : (
                      <span className={`absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-[10px] ${s.textSecondary}`}>
                        Duration pending…
                      </span>
                    )}
                    <div
                      className={`${playheadKnobClass} pointer-events-none`}
                      style={{ left: globalPct }}
                    />
                  </div>
                </div>
                <div
                  className="hidden"
                  role="group"
                  aria-label="Nudge video sync later"
                >
                  <button
                    type="button"
                    className={VIDEO_NUDGE_BTN_CLASS}
                    disabled={videoDurationMs <= 0}
                    onClick={(e) => {
                      e.stopPropagation();
                      nudgeVideoOffsetMs(1000);
                    }}
                    title="Offset +1s (video later)"
                  >
                    +1s
                  </button>
                  <button
                    type="button"
                    className={VIDEO_NUDGE_BTN_CLASS}
                    disabled={videoDurationMs <= 0}
                    onClick={(e) => {
                      e.stopPropagation();
                      nudgeVideoOffsetMs(5000);
                    }}
                    title="Offset +5s (video later)"
                  >
                    +5s
                  </button>
                </div>
              </div>,
            )
          : renderTrackRow(
              'Video',
              '—',
              '—',
              <div
                className={`h-2 relative flex items-center px-2 ${s.progressTrack} ${s.textSecondary} text-[10px]`}
              >
                No video bound
              </div>,
            ))}
      </div>

      {/* Controls */}
      <div className="flex justify-between items-center px-2 flex-wrap gap-4">
        <div className="flex flex-col gap-1.5 min-w-[140px]">
          <div className="flex items-center gap-3">
            <span className={`text-xs w-8 shrink-0 ${s.textSecondary}`}>
              {playbackSpeed.toFixed(1)}x
            </span>
            <input
              type="range"
              min={MIN_SPEED}
              max={MAX_SPEED}
              step={SPEED_STEP}
              value={playbackSpeed}
              onChange={(e) => onSpeedChange(parseFloat(e.target.value))}
              className="flex-1 h-2 accent-cyan-500"
            />
          </div>
          <div
            className="flex flex-wrap items-center gap-1 pl-[2.75rem]"
            role="group"
            aria-label="Playback speed presets"
          >
            {SPEED_PRESETS.map((preset) => {
              const active = Math.abs(playbackSpeed - preset) < 0.01;
              const label = `${preset}×`;
              return (
                <button
                  key={preset}
                  type="button"
                  onClick={() => onSpeedChange(preset)}
                  className={`min-w-[2.25rem] px-1.5 py-0.5 text-[10px] font-medium tabular-nums ${
                    active ? s.buttonPrimary : s.accentBg
                  } ${isRound ? 'rounded-md' : 'rounded-sm'}`}
                  title={`${label} speed`}
                  aria-pressed={active}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap justify-center">
          {JUMP_CONTROLS.slice(0, 2).map((control) => (
            <button
              key={control.label}
              onClick={() => onSkip(control.deltaMs)}
              className={`min-w-[56px] px-2 py-1 text-xs ${s.accentBg} ${
                isRound ? 'rounded-md' : 'rounded-sm'
              }`}
              title={control.label}
            >
              {control.label}
            </button>
          ))}
          <button
            onClick={onTogglePlay}
            className={`w-12 h-12 flex items-center justify-center ${s.buttonPrimary}`}
          >
            {isPlaying ? (
              <Pause className="w-5 h-5" fill="currentColor" />
            ) : (
              <Play className="w-6 h-6 ml-1" fill="currentColor" />
            )}
          </button>
          {JUMP_CONTROLS.slice(2).map((control) => (
            <button
              key={control.label}
              onClick={() => onSkip(control.deltaMs)}
              className={`min-w-[56px] px-2 py-1 text-xs ${s.accentBg} ${
                isRound ? 'rounded-md' : 'rounded-sm'
              }`}
              title={control.label}
            >
              {control.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onOpenSync}
            disabled={syncDisabled || !onOpenSync}
            className={`text-xs hover:opacity-70 flex items-center gap-1 ${s.textSecondary}`}
          >
            <Clock className="w-4 h-4" /> {syncLabel}
          </button>
        </div>
      </div>
    </footer>
  );
}
