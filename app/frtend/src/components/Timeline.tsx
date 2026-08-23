import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Play, Pause, Clock } from 'lucide-react';
import { useTheme } from '@/theme/ThemeContext';
import { clamp, formatTimestamp } from '@/utils/formatters';
import type { SessionEvent } from '@/types/models';

export interface WorkspaceWindowMs {
  startMs: number;
  endMs: number;
}

export interface TimelineVideoClip {
  id: string;
  label: string;
  offsetMs: number;
  durationMs: number;
}

export interface TimelineVideoTrack {
  id: string;
  label: string;
  clips?: TimelineVideoClip[];
  offsetMs?: number;
  durationMs?: number;
}

interface TimelineProps {
  currentTime: number;
  totalDuration: number;
  workspaceWindow: WorkspaceWindowMs;
  onChangeWorkspace: (next: WorkspaceWindowMs) => void;
  /** Committed video offset (session time at video t=0) — legacy fallback when no clips */
  videoOffsetMs: number;
  videoDurationMs: number;
  videoTracks?: TimelineVideoTrack[];
  /** Timeline drag preview: which clip key and draft session-time offset */
  draftVideoClip: { clipKey: string; ms: number } | null;
  onDraftVideoClipOffset: (next: { clipKey: string; ms: number } | null) => void;
  /** Always scoped to the edited clip bar */
  onCommitVideoClipOffset: (ms: number, clipKey: string) => void;
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

type NormalizedTimelineVideoTrack = TimelineVideoTrack & {
  clips: TimelineVideoClip[];
};

const MIN_SPEED = 0.5;
const MAX_SPEED = 50;
const SPEED_STEP = 0.1;
const SPEED_PRESETS = [0.5, 1, 2, 5, 10, 20, 50] as const;
const MIN_WORKSPACE_SPAN_MS = 5000;
const GLOBAL_HANDLE_PX = 10;
const JUMP_CONTROLS = [
  { label: '-30s', deltaMs: -30000 },
  { label: '-10s', deltaMs: -10000 },
  { label: '+10s', deltaMs: 10000 },
  { label: '+30s', deltaMs: 30000 },
] as const;

/** Video clip bar: semi-transparent violet (lighter default, stronger on hover) — not fully transparent */
const VIDEO_NUDGE_BTN_CLASS =
  'shrink-0 px-1.5 py-0.5 min-w-[2.35rem] text-[10px] font-mono leading-tight rounded border border-violet-400/85 bg-violet-500/35 text-white/95 hover:bg-violet-500/50 active:bg-violet-500/60 disabled:opacity-40 disabled:pointer-events-none disabled:cursor-not-allowed';
const VIDEO_NUDGE_TOOLBAR_CLASS =
  'pointer-events-none absolute bottom-full left-1/2 z-30 flex w-[8rem] -translate-x-1/2 items-center justify-center gap-0.5 rounded-full border border-violet-300/30 bg-stone-950/88 px-1 py-0.5 shadow-md opacity-0 backdrop-blur-sm transition duration-150 group-hover/clip:pointer-events-auto group-hover/clip:opacity-100';
const VIDEO_NUDGE_TOOLBAR_BTN_CLASS =
  'inline-flex min-h-0 min-w-[1.35rem] items-center justify-center rounded-full bg-violet-500/38 px-1 py-0.5 text-[9px] font-mono leading-none text-white/95 transition hover:bg-violet-500/52 active:bg-violet-500/62 disabled:opacity-40 disabled:pointer-events-none disabled:cursor-not-allowed';
const TRACK_LABEL_WIDTH_CLASS = 'hidden sm:flex w-28 md:w-32 shrink-0';
const EVENT_ENTRY_HIGHLIGHT_PADDING_MS = 4000;
const TIMELINE_TRACK_BAR_HEIGHT_PX = 5.33;
const VIDEO_CLIP_LANE_HEIGHT_PX = 12;
const VIDEO_CLIP_TRACK_PADDING_PX = 4;
const MIN_VIDEO_CLIP_VISUAL_RATIO = 0.008;
const VIDEO_CLIP_VISUAL_GAP_RATIO = 0.0025;

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
  draftVideoClip,
  onDraftVideoClipOffset,
  onCommitVideoClipOffset,
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
  const normalizedVideoTracks: NormalizedTimelineVideoTrack[] =
    videoTracks && videoTracks.length > 0
      ? videoTracks.map((track) => ({
          ...track,
          clips:
            track.clips && track.clips.length > 0
              ? track.clips
              : [
                  {
                    id: track.id,
                    label: track.label,
                    offsetMs: track.offsetMs ?? videoOffsetMs,
                    durationMs: track.durationMs ?? videoDurationMs,
                  },
                ],
        }))
      : showVideoTrack
        ? [
            {
              id: 'active',
              label: 'Video',
              clips: [
                {
                  id: 'active',
                  label: 'Video',
                  offsetMs: videoOffsetMs,
                  durationMs: videoDurationMs,
                },
              ],
            },
          ]
        : [];
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
  const workspaceChangeFrameRef = useRef<number>(0);
  const pendingWorkspaceChangeRef = useRef<WorkspaceWindowMs | null>(null);

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

  const flushWorkspaceChange = useCallback(
    (next?: WorkspaceWindowMs) => {
      const pending = next ?? pendingWorkspaceChangeRef.current;
      if (!pending) return;

      if (workspaceChangeFrameRef.current) {
        cancelAnimationFrame(workspaceChangeFrameRef.current);
        workspaceChangeFrameRef.current = 0;
      }

      pendingWorkspaceChangeRef.current = null;
      onChangeWorkspace(pending);
    },
    [onChangeWorkspace],
  );

  const scheduleWorkspaceChange = useCallback(
    (next: WorkspaceWindowMs) => {
      pendingWorkspaceChangeRef.current = next;
      if (workspaceChangeFrameRef.current) return;

      workspaceChangeFrameRef.current = requestAnimationFrame(() => {
        workspaceChangeFrameRef.current = 0;
        flushWorkspaceChange();
      });
    },
    [flushWorkspaceChange],
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
          flushWorkspaceChange(nw);
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
    [clampWindow, flushWorkspaceChange, hitTestGlobal, onSeek, totalDuration, workspaceWindow],
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
        scheduleWorkspaceChange(clampWindow(nextStart, nextStart + span));
        return;
      }

      if (drag.mode === 'resize-left') {
        const nextStart = clamp(
          drag.startWindow.startMs + deltaMs,
          0,
          drag.startWindow.endMs - minSpanMs,
        );
        scheduleWorkspaceChange(clampWindow(nextStart, drag.startWindow.endMs));
        return;
      }

      if (drag.mode === 'resize-right') {
        const nextEnd = clamp(
          drag.startWindow.endMs + deltaMs,
          drag.startWindow.startMs + minSpanMs,
          totalDuration,
        );
        scheduleWorkspaceChange(clampWindow(drag.startWindow.startMs, nextEnd));
      }
    },
    [clampWindow, minSpanMs, scheduleWorkspaceChange, totalDuration],
  );

  const handleGlobalPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = globalDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    flushWorkspaceChange();
    globalDragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }, [flushWorkspaceChange]);

  const videoDragRef = useRef<{
    pointerId: number;
    originOffsetMs: number;
    startClientX: number;
    clipKey: string;
  } | null>(null);
  const videoDraftFrameRef = useRef<number>(0);
  const pendingVideoDraftRef = useRef<{ clipKey: string; ms: number } | null>(null);

  const flushVideoDraft = useCallback(
    (next?: { clipKey: string; ms: number } | null) => {
      const pending = next === undefined ? pendingVideoDraftRef.current : next;

      if (videoDraftFrameRef.current) {
        cancelAnimationFrame(videoDraftFrameRef.current);
        videoDraftFrameRef.current = 0;
      }

      pendingVideoDraftRef.current = null;
      onDraftVideoClipOffset(pending);
    },
    [onDraftVideoClipOffset],
  );

  const scheduleVideoDraft = useCallback(
    (next: { clipKey: string; ms: number }) => {
      pendingVideoDraftRef.current = next;
      if (videoDraftFrameRef.current) return;

      videoDraftFrameRef.current = requestAnimationFrame(() => {
        videoDraftFrameRef.current = 0;
        flushVideoDraft();
      });
    },
    [flushVideoDraft],
  );

  const handleVideoBarPointerDown = useCallback(
    (
      e: React.PointerEvent<HTMLButtonElement>,
      clipKey: string,
      clipOffsetMs: number,
      clipDurationMs: number,
    ) => {
      if (!showVideoTrack || totalDuration <= 0 || clipDurationMs <= 0) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.stopPropagation();
      videoDragRef.current = {
        pointerId: e.pointerId,
        originOffsetMs: clipOffsetMs,
        startClientX: e.clientX,
        clipKey,
      };
      flushVideoDraft({ clipKey, ms: clipOffsetMs });
      e.currentTarget.setPointerCapture(e.pointerId);
      e.preventDefault();
    },
    [flushVideoDraft, showVideoTrack, totalDuration],
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
      scheduleVideoDraft({ clipKey: drag.clipKey, ms: next });
    },
    [scheduleVideoDraft, totalDuration],
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
      onCommitVideoClipOffset(next, drag.clipKey);
      flushVideoDraft(null);
    },
    [flushVideoDraft, onCommitVideoClipOffset],
  );

  const handleVideoBarPointerCancel = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      const drag = videoDragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      videoDragRef.current = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      flushVideoDraft(null);
    },
    [flushVideoDraft],
  );

  const nudgeClipVideoOffsetMs = useCallback(
    (deltaMs: number, clipKey: string, clipOffsetMs: number, clipDurationMs: number) => {
      if (!showVideoTrack || clipDurationMs <= 0) return;
      const next = clipOffsetMs + deltaMs;
      flushVideoDraft(null);
      onCommitVideoClipOffset(next, clipKey);
    },
    [flushVideoDraft, onCommitVideoClipOffset, showVideoTrack],
  );

  useEffect(() => {
    return () => {
      if (seekFrameRef.current) {
        cancelAnimationFrame(seekFrameRef.current);
      }
      if (workspaceChangeFrameRef.current) {
        cancelAnimationFrame(workspaceChangeFrameRef.current);
      }
      if (videoDraftFrameRef.current) {
        cancelAnimationFrame(videoDraftFrameRef.current);
      }
    };
  }, []);

  const playheadKnobClass = `absolute top-1/2 -translate-x-1/2 -translate-y-1/2 h-[10.67px] w-[10.67px] shadow-md ${
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
      <div className="w-full flex flex-col gap-0">
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
            className={`h-[6.67px] relative overflow-visible touch-none select-none ${
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
            className={`h-[5.33px] relative overflow-visible touch-none select-none cursor-pointer ${s.progressTrack}`}
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
              const videoTrackName =
                track.label ||
                (normalizedVideoTracks.length > 1 ? `Video Track ${index + 1}` : 'Video Track');
              const trackStartMs = track.clips.reduce(
                (min, clip) => Math.min(min, clip.offsetMs),
                Number.POSITIVE_INFINITY,
              );
              const trackEndMs = track.clips.reduce(
                (max, clip) =>
                  Math.max(max, clip.offsetMs + Math.max(0, clip.durationMs)),
                0,
              );
              const trackDuration = Number.isFinite(trackStartMs)
                ? Math.max(0, trackEndMs - trackStartMs)
                : 0;
              const coveringForPlayhead =
                track.clips.find((clip) => {
                  const dur = clip.durationMs;
                  return (
                    dur > 0 &&
                    displayGlobalTime >= clip.offsetMs &&
                    displayGlobalTime < clip.offsetMs + dur
                  );
                }) ?? null;
              const referenceClip = coveringForPlayhead ?? track.clips[0] ?? null;
              const referenceDuration = referenceClip?.durationMs ?? 0;
              const clipLayouts = track.clips.map((clip) => {
                const clipDraft =
                  draftVideoClip?.clipKey === clip.id ? draftVideoClip.ms : null;
                const committedOffset = clip.offsetMs;
                const clipOffset = clipDraft ?? committedOffset;
                const clipDuration = clip.durationMs;
                const startRatio =
                  totalDuration > 0 ? clamp(clipOffset / totalDuration, 0, 1) : 0;
                const endRatio =
                  totalDuration > 0 && clipDuration > 0
                    ? clamp((clipOffset + clipDuration) / totalDuration, 0, 1)
                    : startRatio;
                const rawWidthRatio = Math.max(0, endRatio - startRatio);
                const visualWidthRatio = Math.min(
                  1,
                  Math.max(rawWidthRatio, MIN_VIDEO_CLIP_VISUAL_RATIO),
                );
                const visualStartRatio = Math.min(
                  startRatio,
                  Math.max(0, 1 - visualWidthRatio),
                );
                const visualEndRatio = Math.min(1, visualStartRatio + visualWidthRatio);

                return {
                  clip,
                  clipOffset,
                  clipDuration,
                  startRatio,
                  endRatio,
                  visualStartRatio,
                  visualWidthRatio,
                  visualCenterRatio: (visualStartRatio + visualEndRatio) / 2,
                };
              });
              const sortedForZ = [...clipLayouts].sort((a, b) => {
                if (a.clipOffset !== b.clipOffset) return a.clipOffset - b.clipOffset;
                return (a.clip.label ?? '').localeCompare(b.clip.label ?? '');
              });
              const zByClipId = new Map(
                sortedForZ.map((layout, i) => [layout.clip.id, i + 12]),
              );

              const referenceOffset =
                referenceClip && draftVideoClip?.clipKey === referenceClip.id
                  ? draftVideoClip.ms
                  : (referenceClip?.offsetMs ?? 0);
              const videoLocalMs = referenceClip
                ? clamp(
                    displayGlobalTime - referenceOffset,
                    0,
                    referenceDuration || 0,
                  )
                : 0;
              const laneCount = 1;
              const videoTrackHeight =
                laneCount * VIDEO_CLIP_LANE_HEIGHT_PX + VIDEO_CLIP_TRACK_PADDING_PX * 2;
              const videoTrackDetail = [
                `${videoTrackName}: ${track.clips.length} clip${track.clips.length === 1 ? '' : 's'}`,
                `Span: ${Number.isFinite(trackStartMs) ? formatTimestamp(trackStartMs) : '--'} - ${
                  trackEndMs > 0 ? formatTimestamp(trackEndMs) : '--'
                }`,
                'Hover a clip bar for nudge controls; drag bar to adjust offset for that clip.',
              ].join('\n');

              return renderTrackRow(
                videoTrackName,
                referenceClip ? formatTimestamp(videoLocalMs) : '--',
                trackDuration > 0 ? formatTimestamp(trackDuration) : '--',
                <div className="flex flex-1 min-w-0 items-center">
                  <div
                    ref={videoBarRef}
                    className="relative flex-1 min-w-0 overflow-visible touch-none select-none"
                    style={{ height: `${videoTrackHeight}px` }}
                    title="Video track — hover a clip bar for sync nudges; drag a bar to move that clip."
                  >
                    {Array.from({ length: laneCount }).map((_, lane) => (
                      <div
                        key={lane}
                        className={`absolute left-0 right-0 h-[5.33px] ${s.progressTrack}`}
                        style={{
                          top: `${VIDEO_CLIP_TRACK_PADDING_PX + lane * VIDEO_CLIP_LANE_HEIGHT_PX + (VIDEO_CLIP_LANE_HEIGHT_PX - TIMELINE_TRACK_BAR_HEIGHT_PX) / 2}px`,
                        }}
                      >
                        <div
                          className={`absolute top-0 left-0 h-full ${s.progressFill} opacity-15`}
                          style={{ width: globalPct }}
                        />
                      </div>
                    ))}
                    {clipLayouts.map((layout) => {
                        const {
                          clip,
                          clipOffset,
                          clipDuration,
                          startRatio,
                          visualStartRatio,
                          visualWidthRatio,
                        } = layout;
                        const lane = 0;
                        const leftPct = `${(visualStartRatio * 100).toFixed(2)}%`;
                        const widthPct = `${(visualWidthRatio * 100).toFixed(2)}%`;
                        const laneCenterPx =
                          VIDEO_CLIP_TRACK_PADDING_PX +
                          lane * VIDEO_CLIP_LANE_HEIGHT_PX +
                          VIDEO_CLIP_LANE_HEIGHT_PX / 2;
                        const clipDetail = [
                          clip.label || 'Untitled video',
                          `Offset: ${formatSignedSeconds(clipOffset)}`,
                          `Duration: ${clipDuration > 0 ? formatTimestamp(clipDuration) : 'pending'}`,
                        ].join('\n');
                        const clipZIndex = zByClipId.get(clip.id) ?? 12;

                        return (
                          <Fragment key={clip.id}>
                            {clipDuration > 0 ? (
                              <div
                                className="group/clip pointer-events-auto absolute -translate-y-1/2 rounded border border-violet-400/50 bg-violet-500/30 shadow-sm shadow-violet-950/20 h-[10.67px] hover:border-violet-300/65 hover:bg-violet-500/45"
                                style={{
                                  left: leftPct,
                                  top: `${laneCenterPx}px`,
                                  width: widthPct,
                                  zIndex: clipZIndex + 20,
                                }}
                              >
                                <div
                                  className={VIDEO_NUDGE_TOOLBAR_CLASS}
                                  role="group"
                                  aria-label="Nudge clip sync"
                                >
                                  <button
                                    type="button"
                                    className={VIDEO_NUDGE_TOOLBAR_BTN_CLASS}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      nudgeClipVideoOffsetMs(-5000, clip.id, clipOffset, clipDuration);
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
                                      nudgeClipVideoOffsetMs(-1000, clip.id, clipOffset, clipDuration);
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
                                      nudgeClipVideoOffsetMs(1000, clip.id, clipOffset, clipDuration);
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
                                      nudgeClipVideoOffsetMs(5000, clip.id, clipOffset, clipDuration);
                                    }}
                                    title="Offset +5s (video later)"
                                  >
                                    +5
                                  </button>
                                </div>
                                <button
                                  type="button"
                                  onPointerDown={(e) =>
                                    handleVideoBarPointerDown(
                                      e,
                                      clip.id,
                                      clipOffset,
                                      clipDuration,
                                    )
                                  }
                                  onPointerMove={handleVideoBarPointerMove}
                                  onPointerUp={handleVideoBarPointerUp}
                                  onPointerCancel={handleVideoBarPointerCancel}
                                  className="absolute inset-0 cursor-grab active:cursor-grabbing rounded-[inherit] bg-transparent"
                                  title={clipDetail}
                                  aria-label={`Drag to adjust sync offset · ${clip.label || 'video clip'}`}
                                />
                              </div>
                            ) : (
                              <button
                                type="button"
                                className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-violet-400/50 bg-violet-500/32 hover:border-violet-300/70 hover:bg-violet-500/48"
                                style={{
                                  left: `${(startRatio * 100).toFixed(2)}%`,
                                  top: `${laneCenterPx}px`,
                                  zIndex: clipZIndex + 20,
                                }}
                                title={clipDetail}
                                aria-label={clip.label || 'Video clip pending duration'}
                              />
                            )}
                          </Fragment>
                        );
                      })}
                      <div
                        className="absolute top-0 bottom-0 w-[1px] bg-white/20 pointer-events-none z-10"
                        style={{ left: globalPct, transform: 'translateX(-50%)' }}
                      />
                      <div
                        className={`${playheadKnobClass} pointer-events-none z-20`}
                        style={{ left: globalPct }}
                      />
                  </div>
                </div>,
                {
                  key: track.id,
                  subtitle: videoTrackName,
                  detail: videoTrackDetail,
                },
              );
            })
          : renderTrackRow(
              'Video',
              '--',
              '--',
              <div
                className={`h-[5.33px] relative flex items-center px-2 ${s.progressTrack} ${s.textSecondary} text-[10px]`}
              >
                No video bound
              </div>,
            )}
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
              className="flex-1 h-[5.33px] accent-cyan-500"
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
