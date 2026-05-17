import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Clock3, Layers3, MonitorPlay, Radar, WifiOff } from 'lucide-react';
import { useParams, useSearchParams } from 'react-router-dom';
import type { MapBaselayerKind } from '@/components/MapControls';
import SessionVideoHud from '@/components/SessionVideoHud';
import SessionVideoStage from '@/components/SessionVideoStage';
import WorkspaceLensLayer from '@/components/WorkspaceLensLayer';
import WorkspaceMapStage from '@/components/WorkspaceMapStage';
import WorkspaceTelemetryStage from '@/components/WorkspaceTelemetryStage';
import { sessionApi, trackApi, eventApi, markApi } from '@/services/api';
import { useTheme } from '@/theme/ThemeContext';
import type {
  Mark,
  Session,
  SessionEvent,
  TrackPoint,
  VideoSyncBinding,
} from '@/types/models';
import type {
  WorkspaceRangeSelection,
  WorkspaceSelectionState,
  WorkspaceStageContent,
  WorkspaceStageLayoutMode,
  WorkspaceVideoDescriptor,
} from '@/types/workspace';
import {
  getRequestedSurfaceRole,
  isVideoCompanionMessage,
  openVideoCompanionChannel,
  type CompanionHostState,
} from '@/utils/videoCompanion';
import { formatDate, formatTimestamp } from '@/utils/formatters';
import { getWindDir, getWindSpeed } from '@/utils/trackPoint';
import {
  buildRangeIndices,
  clampRatio,
  findTelemetryIndexAtTime,
} from '@/utils/replayTelemetry';

const HOST_TIMEOUT_MS = 4000;
const READY_INTERVAL_MS = 1200;

interface LocalCompanionVideo {
  key?: string;
  signature: string;
  objectUrl: string;
  label?: string;
  videoType: NonNullable<CompanionHostState['video']>['videoType'];
  offsetMs: number;
  sync?: VideoSyncBinding;
}

interface CompanionPlayableVideo {
  key: string;
  origin: 'remote' | 'local';
  url: string;
  label?: string;
  videoType: NonNullable<CompanionHostState['video']>['videoType'];
  offsetMs: number;
  sync?: VideoSyncBinding;
  signature?: string;
  crossOrigin?: '' | 'anonymous';
}

const DEFAULT_STAGE_PRIMARY: WorkspaceStageContent = 'map';
const DEFAULT_STAGE_LEFT: WorkspaceStageContent = 'map';
const DEFAULT_STAGE_RIGHT: WorkspaceStageContent = 'telemetry';

interface StageContentOption {
  value: WorkspaceStageContent;
  label: string;
}

function StageContentSelect({
  value,
  onChange,
  label,
  options,
}: {
  value: WorkspaceStageContent;
  onChange: (content: WorkspaceStageContent) => void;
  label: string;
  options: StageContentOption[];
}) {
  return (
    <label className="flex min-w-[180px] flex-1 items-center gap-2">
      <span className="text-xs uppercase tracking-[0.16em] text-white/55">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as WorkspaceStageContent)}
        className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/50"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function videoKeyFromStageContent(content: WorkspaceStageContent): string | null {
  return content.startsWith('video:') ? content.slice('video:'.length) : null;
}

export default function ReplayVideoCompanionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [searchParams] = useSearchParams();
  const { s } = useTheme();

  const [hostState, setHostState] = useState<CompanionHostState | null>(null);
  const [hostConnected, setHostConnected] = useState(false);
  const [videoStageReady, setVideoStageReady] = useState(false);
  const [videoStageError, setVideoStageError] = useState<string | null>(null);
  const [videoDurationsByKey, setVideoDurationsByKey] = useState<Record<string, number>>({});
  const [localVideo, setLocalVideo] = useState<LocalCompanionVideo | null>(null);
  const [surfaceLayoutMode, setSurfaceLayoutMode] =
    useState<WorkspaceStageLayoutMode>('full');
  const [primaryStageContent, setPrimaryStageContent] =
    useState<WorkspaceStageContent>(DEFAULT_STAGE_PRIMARY);
  const [leftStageContent, setLeftStageContent] =
    useState<WorkspaceStageContent>(DEFAULT_STAGE_LEFT);
  const [rightStageContent, setRightStageContent] =
    useState<WorkspaceStageContent>(DEFAULT_STAGE_RIGHT);
  const [followFocus, setFollowFocus] = useState(true);
  const [frozenSelection, setFrozenSelection] = useState<WorkspaceSelectionState>({
    eventId: null,
    markId: null,
    range: null,
  });
  const [session, setSession] = useState<Session | null>(null);
  const [telemetry, setTelemetry] = useState<TrackPoint[]>([]);
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [loading, setLoading] = useState(true);
  const [mapLayer, setMapLayer] = useState<MapBaselayerKind>('vector');

  const channelRef = useRef<BroadcastChannel | null>(null);
  const lastHostMessageAtRef = useRef(0);
  const localVideoObjectUrlRef = useRef<string | null>(null);
  const didInitializeStageContentRef = useRef(false);
  const requestedRole = getRequestedSurfaceRole(searchParams);

  useEffect(() => {
    localVideoObjectUrlRef.current = localVideo?.objectUrl ?? null;
  }, [localVideo?.objectUrl]);

  useEffect(() => {
    return () => {
      if (localVideoObjectUrlRef.current) {
        URL.revokeObjectURL(localVideoObjectUrlRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    setLoading(true);

    const load = async () => {
      const [nextSession, nextEvents, nextMarks] = await Promise.all([
        sessionApi.get(sessionId),
        eventApi.list(sessionId),
        markApi.list(sessionId),
      ]);

      let nextTelemetry: TrackPoint[] = [];
      try {
        const tracks = await trackApi.list(sessionId);
        const primaryTrack = tracks.find((track) => track.role === 'primary') ?? tracks[0];
        nextTelemetry = primaryTrack
          ? await trackApi.getPoints(sessionId, primaryTrack.id)
          : [];
      } catch {
        nextTelemetry = await trackApi.get(sessionId).catch(() => []);
      }

      return { nextSession, nextTelemetry, nextEvents, nextMarks };
    };

    load()
      .then(({ nextSession, nextTelemetry, nextEvents, nextMarks }) => {
        if (cancelled) return;
        setSession(nextSession);
        setTelemetry(nextTelemetry);
        setEvents(nextEvents);
        setMarks(nextMarks);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const postCompanionReady = useCallback(() => {
    if (!sessionId || !channelRef.current) return;
    channelRef.current.postMessage({
      type: 'companion_ready',
      sessionId,
      sentAt: Date.now(),
    });
  }, [sessionId]);

  const postMessage = useCallback((message: unknown) => {
    channelRef.current?.postMessage(message);
  }, []);

  useEffect(() => {
    if (!sessionId) return;

    const channel = openVideoCompanionChannel(sessionId);
    channelRef.current = channel;

    if (!channel) {
      setHostConnected(false);
      return;
    }

    const handleMessage = (event: MessageEvent) => {
      if (!isVideoCompanionMessage(event.data) || event.data.sessionId !== sessionId) return;

      lastHostMessageAtRef.current = Date.now();
      setHostConnected(true);

      switch (event.data.type) {
        case 'host_ping':
          return;
        case 'host_state':
          setHostState(event.data.state);
          return;
        case 'host_local_video': {
          setLocalVideo((prev) => {
            if (prev && prev.signature === event.data.signature) {
              return {
                ...prev,
                key: event.data.key ?? prev.key,
                label: event.data.label ?? prev.label,
                videoType: event.data.videoType,
                offsetMs: event.data.offsetMs,
                sync: event.data.sync,
              };
            }

            const objectUrl = URL.createObjectURL(event.data.file);
            if (prev) URL.revokeObjectURL(prev.objectUrl);
            return {
              key: event.data.key,
              signature: event.data.signature,
              objectUrl,
              label: event.data.label ?? event.data.file.name,
              videoType: event.data.videoType,
              offsetMs: event.data.offsetMs,
              sync: event.data.sync,
            };
          });
          return;
        }
        case 'host_clear_local_video':
          setLocalVideo((prev) => {
            if (prev) URL.revokeObjectURL(prev.objectUrl);
            return null;
          });
          return;
        default:
          return;
      }
    };

    const handleBeforeUnload = () => {
      channel.postMessage({
        type: 'companion_closed',
        sessionId,
        sentAt: Date.now(),
      });
    };

    channel.addEventListener('message', handleMessage);
    window.addEventListener('beforeunload', handleBeforeUnload);
    postCompanionReady();

    const readyTimer = window.setInterval(postCompanionReady, READY_INTERVAL_MS);
    const heartbeatTimer = window.setInterval(() => {
      if (
        lastHostMessageAtRef.current > 0 &&
        Date.now() - lastHostMessageAtRef.current > HOST_TIMEOUT_MS
      ) {
        setHostConnected(false);
      }
    }, 1000);

    return () => {
      window.clearInterval(readyTimer);
      window.clearInterval(heartbeatTimer);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      channel.removeEventListener('message', handleMessage);
      channel.close();
      channelRef.current = null;
    };
  }, [postCompanionReady, sessionId]);

  useEffect(() => {
    if (!hostState?.sessionName) return;
    document.title = `${hostState.sessionName} | Surface`;
    return () => {
      document.title = 'SailSIQ';
    };
  }, [hostState?.sessionName]);

  useEffect(() => {
    const nextVideo = hostState?.video;
    if (!nextVideo || nextVideo.origin !== 'local') return;

    setLocalVideo((prev) => {
      if (!prev || prev.signature !== nextVideo.signature) return prev;
      return {
        ...prev,
        key: nextVideo.key ?? prev.key,
        label: nextVideo.label ?? prev.label,
        videoType: nextVideo.videoType,
        offsetMs: nextVideo.offsetMs,
        sync: nextVideo.sync,
      };
    });
  }, [hostState?.video]);

  useEffect(() => {
    if (followFocus && hostState) {
      setFrozenSelection(hostState.selection);
    }
  }, [followFocus, hostState]);

  const currentTime = hostState?.syncDialogOpen
    ? hostState.syncSessionTimeMs
    : hostState?.currentTime ?? 0;
  const totalDuration = hostState?.totalDurationMs ?? 0;
  const activeTelemetry =
    hostState?.activeTrackPoints && hostState.activeTrackPoints.length > 0
      ? hostState.activeTrackPoints
      : telemetry;
  const workspaceWindowEffective = useMemo(() => {
    const hostWindow = hostState?.workspaceWindow;
    if (totalDuration <= 0) return { startMs: 0, endMs: 0 };
    if (hostWindow && hostWindow.endMs > hostWindow.startMs) {
      return {
        startMs: Math.max(0, Math.min(hostWindow.startMs, totalDuration)),
        endMs: Math.max(0, Math.min(hostWindow.endMs, totalDuration)),
      };
    }
    return { startMs: 0, endMs: totalDuration };
  }, [hostState?.workspaceWindow, totalDuration]);
  const workspaceDurationMs = Math.max(
    0,
    workspaceWindowEffective.endMs - workspaceWindowEffective.startMs,
  );
  const telemetryWorkspaceIndices = useMemo(() => {
    if (activeTelemetry.length < 2 || workspaceDurationMs <= 0) return null;
    const startIdx = findTelemetryIndexAtTime(activeTelemetry, workspaceWindowEffective.startMs);
    const endIdx = findTelemetryIndexAtTime(activeTelemetry, workspaceWindowEffective.endMs);
    const a = Math.max(0, Math.min(startIdx, endIdx));
    const b = Math.max(0, Math.max(startIdx, endIdx));
    return { startIdx: a, endIdx: b };
  }, [
    activeTelemetry,
    workspaceDurationMs,
    workspaceWindowEffective.endMs,
    workspaceWindowEffective.startMs,
  ]);
  const telemetryWorkspace = useMemo(() => {
    if (!telemetryWorkspaceIndices) return activeTelemetry;
    const { startIdx, endIdx } = telemetryWorkspaceIndices;
    return activeTelemetry.slice(startIdx, endIdx + 1);
  }, [activeTelemetry, telemetryWorkspaceIndices]);
  const chartPlayheadRatio =
    workspaceDurationMs > 0
      ? clampRatio((currentTime - workspaceWindowEffective.startMs) / workspaceDurationMs)
      : 0;
  const playheadIndex =
    activeTelemetry.length > 0 ? findTelemetryIndexAtTime(activeTelemetry, currentTime) : 0;
  const currentPoint = activeTelemetry[playheadIndex] ?? hostState?.currentPoint;
  const windDir = hostState?.windDir ?? (currentPoint ? getWindDir(currentPoint) : undefined);
  const windSpeed = hostState?.windSpeed ?? (currentPoint ? getWindSpeed(currentPoint) : undefined);
  const effectiveSelection = followFocus ? hostState?.selection : frozenSelection;
  const selectedEvent = events.find((event) => event.id === effectiveSelection?.eventId) ?? null;
  const selectedMark = marks.find((mark) => mark.id === effectiveSelection?.markId) ?? null;
  const highlightedRange = buildRangeIndices(
    effectiveSelection?.range ?? null,
    activeTelemetry,
  );
  const chartSelectionRange = useCallback(
    (source: WorkspaceRangeSelection['source']) => {
      if (effectiveSelection?.range?.source !== source || workspaceDurationMs <= 0) return null;
      const startRatio = clampRatio(
        (effectiveSelection.range.startMs - workspaceWindowEffective.startMs) / workspaceDurationMs,
      );
      const endRatio = clampRatio(
        (effectiveSelection.range.endMs - workspaceWindowEffective.startMs) / workspaceDurationMs,
      );
      return endRatio > startRatio ? { startRatio, endRatio } : null;
    },
    [
      effectiveSelection?.range,
      workspaceDurationMs,
      workspaceWindowEffective.startMs,
    ],
  );

  const videoDescriptors = useMemo<WorkspaceVideoDescriptor[]>(() => {
    const listed = hostState?.videos ?? [];
    if (listed.length > 0) return listed;
    return hostState?.video ? [hostState.video] : [];
  }, [hostState?.video, hostState?.videos]);

  const playableVideos = useMemo<CompanionPlayableVideo[]>(() => {
    const nextVideos: CompanionPlayableVideo[] = [];

    videoDescriptors.forEach((descriptor) => {
      if (descriptor.origin === 'local') {
        if (!localVideo || localVideo.signature !== descriptor.signature) return;
        nextVideos.push({
          key: descriptor.key,
          origin: 'local',
          url: localVideo.objectUrl,
          label: descriptor.label ?? localVideo.label,
          videoType: descriptor.videoType,
          offsetMs: descriptor.offsetMs,
          sync: descriptor.sync,
          signature: descriptor.signature,
          crossOrigin: '',
        });
        return;
      }

      if (!descriptor.url) return;
      nextVideos.push({
        key: descriptor.key,
        origin: 'remote',
        url: descriptor.url,
        label: descriptor.label,
        videoType: descriptor.videoType,
        offsetMs: descriptor.offsetMs,
        sync: descriptor.sync,
        crossOrigin: 'anonymous',
      });
    });

    return nextVideos;
  }, [localVideo, videoDescriptors]);

  const stageContentOptions = useMemo(
    () => [
      { value: 'map' as WorkspaceStageContent, label: 'Map' },
      { value: 'telemetry' as WorkspaceStageContent, label: 'Telemetry' },
      ...videoDescriptors.map((video, index) => ({
        value: `video:${video.key}` as WorkspaceStageContent,
        label: `Video ${index + 1}: ${video.label ?? video.url ?? 'Local video'}`,
      })),
    ],
    [videoDescriptors],
  );

  useEffect(() => {
    if (didInitializeStageContentRef.current) return;
    if (requestedRole === 'video' && videoDescriptors.length === 0) return;

    const defaultContent: WorkspaceStageContent =
      requestedRole === 'video' && videoDescriptors[0]
        ? `video:${videoDescriptors[0].key}`
        : requestedRole === 'telemetry'
          ? 'telemetry'
          : 'map';

    setPrimaryStageContent(defaultContent);
    didInitializeStageContentRef.current = true;
  }, [requestedRole, videoDescriptors]);

  useEffect(() => {
    const validContent = new Set(stageContentOptions.map((option) => option.value));
    const normalize = (content: WorkspaceStageContent, fallback: WorkspaceStageContent) =>
      validContent.has(content) ? content : fallback;
    setPrimaryStageContent((current) => normalize(current, DEFAULT_STAGE_PRIMARY));
    setLeftStageContent((current) => normalize(current, DEFAULT_STAGE_LEFT));
    setRightStageContent((current) => normalize(current, DEFAULT_STAGE_RIGHT));
  }, [stageContentOptions]);

  const statusBadge = useMemo(() => {
    if (typeof BroadcastChannel === 'undefined') {
      return {
        label: 'BroadcastChannel unavailable',
        tone: 'bg-red-500/20 text-red-100 border-red-300/30',
      };
    }
    if (!hostConnected && !hostState) {
      return {
        label: 'Waiting for host',
        tone: 'bg-white/10 text-white/85 border-white/15',
      };
    }
    if (!hostConnected) {
      return {
        label: 'Host disconnected',
        tone: 'bg-amber-500/20 text-amber-50 border-amber-300/30',
      };
    }
    return {
      label: `Connected | ${surfaceLayoutMode}`,
      tone: 'bg-emerald-500/18 text-emerald-50 border-emerald-300/25',
    };
  }, [hostConnected, hostState, surfaceLayoutMode]);

  const sendRangeFocus = useCallback(
    (range: WorkspaceRangeSelection | null) => {
      if (!sessionId) return;
      postMessage({
        type: 'focus_range',
        sessionId,
        sentAt: Date.now(),
        range,
      });
    },
    [postMessage, sessionId],
  );

  const getVideoTiming = useCallback(
    (video: CompanionPlayableVideo) => {
      const durationMs = videoDurationsByKey[video.key] ?? 0;
      const rawMs =
        hostState?.syncDialogOpen && hostState.video?.key === video.key
          ? hostState.syncVideoTimeMs
          : currentTime - video.offsetMs;
      const safeDuration = durationMs || Number.MAX_SAFE_INTEGER;
      const targetMs = Math.max(0, Math.min(rawMs, safeDuration));
      let notice: string | null = null;

      if (!hostState?.syncDialogOpen) {
        if (rawMs < 0) {
          notice = `Video not started yet. Starts at session ${formatTimestamp(
            Math.max(0, video.offsetMs),
          )}.`;
        } else if (currentTime < totalDuration && durationMs > 0 && rawMs >= durationMs) {
          notice = 'Video ended before session replay';
        } else if (
          currentTime >= totalDuration &&
          totalDuration > 0 &&
          durationMs > 0 &&
          rawMs < durationMs
        ) {
          notice = 'Session replay ended before video';
        }
      }

      return { durationMs, rawMs, targetMs, notice };
    },
    [
      currentTime,
      hostState?.syncDialogOpen,
      hostState?.syncVideoTimeMs,
      hostState?.video?.key,
      totalDuration,
      videoDurationsByKey,
    ],
  );

  const renderMapStage = useCallback(
    (viewportKey: string) => (
      <WorkspaceMapStage
        telemetry={activeTelemetry}
        marks={marks}
        playheadIndex={playheadIndex}
        currentPoint={currentPoint}
        currentTimeMs={currentTime}
        windDir={windDir}
        windSpeed={windSpeed}
        mapLayer={mapLayer}
        onMapLayerChange={setMapLayer}
        viewportKey={viewportKey}
        highlightRange={highlightedRange}
        selectedEvent={selectedEvent}
        selectedMark={selectedMark}
        selectedRange={effectiveSelection?.range ?? null}
      />
    ),
    [
      activeTelemetry,
      currentPoint,
      currentTime,
      effectiveSelection?.range,
      highlightedRange,
      mapLayer,
      marks,
      playheadIndex,
      selectedEvent,
      selectedMark,
      windDir,
      windSpeed,
    ],
  );

  const renderTelemetryStageContent = useCallback(
    () => (
      <WorkspaceTelemetryStage
        telemetry={telemetryWorkspace}
        totalDurationMs={workspaceDurationMs}
        playheadRatio={chartPlayheadRatio}
        selectedRangeForSource={chartSelectionRange}
        onRangeSelect={(source, range) => {
          if (!range || workspaceDurationMs <= 0) {
            sendRangeFocus(null);
            return;
          }
          sendRangeFocus({
            trackId: hostState?.activeTrackId ?? undefined,
            startMs: Math.round(
              workspaceWindowEffective.startMs + range.startRatio * workspaceDurationMs,
            ),
            endMs: Math.round(
              workspaceWindowEffective.startMs + range.endRatio * workspaceDurationMs,
            ),
            source,
          });
        }}
        includeVmgToWind
        windDir={windDir}
      />
    ),
    [
      chartPlayheadRatio,
      chartSelectionRange,
      hostState?.activeTrackId,
      sendRangeFocus,
      telemetryWorkspace,
      windDir,
      workspaceDurationMs,
      workspaceWindowEffective.startMs,
    ],
  );

  const renderVideoStageContent = useCallback(
    (content: WorkspaceStageContent) => {
      const videoKey = videoKeyFromStageContent(content);
      const descriptor = videoDescriptors.find((video) => video.key === videoKey) ?? null;
      const video = playableVideos.find((item) => item.key === videoKey) ?? null;

      if (!videoKey || !descriptor) {
        return (
          <div className="flex flex-1 items-center justify-center p-6">
            <div className="max-w-lg rounded-2xl border border-white/10 bg-stone-950/80 p-6 text-white shadow-2xl backdrop-blur-md">
              <div className="mb-2 text-xs uppercase tracking-[0.22em] text-white/55">
                Video Surface
              </div>
              <div className="text-xl font-semibold">No video selected.</div>
            </div>
          </div>
        );
      }

      if (!video) {
        return (
          <div className="flex flex-1 items-center justify-center p-6">
            <div className="max-w-lg rounded-2xl border border-white/10 bg-stone-950/80 p-6 text-white shadow-2xl backdrop-blur-md">
              <div className="mb-2 text-xs uppercase tracking-[0.22em] text-white/55">
                Video Surface
              </div>
              <div className="text-xl font-semibold">
                {descriptor.origin === 'local'
                  ? 'Local video is not available in this window yet.'
                  : 'Video source is unavailable.'}
              </div>
            </div>
          </div>
        );
      }

      const timing = getVideoTiming(video);
      return (
        <div className="relative flex min-h-0 flex-1">
          <SessionVideoStage
            key={`${video.key}:${video.url}:${video.videoType}`}
            videoType={video.videoType}
            sourceUrl={video.url}
            mediaLabel={video.label}
            targetTimeMs={timing.targetMs}
            isPlaying={
              hostState?.syncDialogOpen
                ? false
                : (hostState?.isPlaying ?? false) && timing.rawMs >= 0
            }
            playbackSpeed={hostState?.playbackSpeed ?? 1}
            crossOrigin={video.crossOrigin}
            className="h-full"
            overlay={
              <>
                <SessionVideoHud
                  sessionName={session?.name ?? hostState?.sessionName ?? 'Video'}
                  mode={surfaceLayoutMode === 'split' ? 'split' : 'overlay'}
                  currentTime={currentTime}
                  currentPoint={currentPoint}
                  windDir={windDir}
                  windSpeed={windSpeed}
                  nearestEvent={selectedEvent ?? hostState?.nearestEvent}
                  mediaLabel={video.label}
                  completionNotice={timing.notice}
                />
                <WorkspaceLensLayer
                  selectedEvent={selectedEvent}
                  selectedMark={selectedMark}
                  selectedRange={effectiveSelection?.range ?? null}
                  currentPoint={currentPoint}
                  currentTimeMs={currentTime}
                  windDir={windDir}
                  windSpeed={windSpeed}
                  compact
                  className="pt-28"
                />
              </>
            }
            onClockChange={(_timeMs) => {
              /* host-driven */
            }}
            onDurationChange={(durationMs) => {
              setVideoDurationsByKey((prev) => ({ ...prev, [video.key]: durationMs }));
            }}
            onReadyChange={setVideoStageReady}
            onErrorChange={setVideoStageError}
          />
        </div>
      );
    },
    [
      currentPoint,
      currentTime,
      effectiveSelection?.range,
      getVideoTiming,
      hostState?.isPlaying,
      hostState?.nearestEvent,
      hostState?.playbackSpeed,
      hostState?.sessionName,
      hostState?.syncDialogOpen,
      hostState?.video?.key,
      playableVideos,
      selectedEvent,
      selectedMark,
      session?.name,
      surfaceLayoutMode,
      videoDescriptors,
      windDir,
      windSpeed,
    ],
  );

  const renderSurfaceContent = useCallback(
    (content: WorkspaceStageContent, viewportKey: string) => {
      if (content === 'map') return renderMapStage(viewportKey);
      if (content === 'telemetry') return renderTelemetryStageContent();
      return renderVideoStageContent(content);
    },
    [renderMapStage, renderTelemetryStageContent, renderVideoStageContent],
  );

  const hasVisibleVideoStage =
    surfaceLayoutMode === 'split'
      ? Boolean(videoKeyFromStageContent(leftStageContent) || videoKeyFromStageContent(rightStageContent))
      : Boolean(videoKeyFromStageContent(primaryStageContent));

  return (
    <div className={`min-h-screen w-full overflow-hidden ${s.wrapper}`}>
      {s.bgEffect ? <div className={s.bgEffect} /> : null}

      <div className="relative z-10 flex min-h-screen flex-col bg-black/70">
        <header className="border-b border-white/10 bg-black/35 px-4 py-3 backdrop-blur-md">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <div className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm shadow-lg ${statusBadge.tone}`}>
                {hostConnected ? <MonitorPlay className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
                <span>{statusBadge.label}</span>
              </div>
              <div className="rounded-full border border-white/10 bg-black/35 px-4 py-2 text-sm text-white/80">
                {session?.name ?? hostState?.sessionName ?? 'Remote surface'}
              </div>
              <div className="rounded-full border border-white/10 bg-black/35 px-4 py-2 text-sm text-white/60">
                {session ? `${formatDate(session.date)} | ${session.location || 'Location pending'}` : 'Session loading'}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center rounded-full border border-white/10 bg-black/25 p-0.5">
                {(['full', 'split'] as WorkspaceStageLayoutMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setSurfaceLayoutMode(mode)}
                    className={`rounded-full px-3 py-1.5 text-sm ${
                      surfaceLayoutMode === mode ? s.buttonPrimary : s.buttonSecondary
                    }`}
                  >
                    {mode === 'full' ? 'Full' : 'Split'}
                  </button>
                ))}
              </div>
              {surfaceLayoutMode === 'split' ? (
                <>
                  <StageContentSelect
                    label="Left"
                    value={leftStageContent}
                    options={stageContentOptions}
                    onChange={setLeftStageContent}
                  />
                  <StageContentSelect
                    label="Right"
                    value={rightStageContent}
                    options={stageContentOptions}
                    onChange={setRightStageContent}
                  />
                </>
              ) : (
                <StageContentSelect
                  label="Stage"
                  value={primaryStageContent}
                  options={stageContentOptions}
                  onChange={setPrimaryStageContent}
                />
              )}
              <button
                type="button"
                onClick={() => setFollowFocus((current) => !current)}
                className={`rounded-full px-3 py-1.5 text-sm ${
                  followFocus ? s.buttonPrimary : s.buttonSecondary
                }`}
              >
                {followFocus ? 'Follow focus' : 'Inspect locally'}
              </button>
            </div>
          </div>
        </header>

        {loading ? (
          <div className="flex flex-1 items-center justify-center">
            <div className={`${s.skeleton} h-16 w-16 rounded-full`} />
          </div>
        ) : (
          <main className="flex min-h-0 flex-1">
            {surfaceLayoutMode === 'split' ? (
              <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-px bg-black/25 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
                <div className="flex h-full min-h-0 min-w-0 overflow-hidden bg-black">
                  {renderSurfaceContent(leftStageContent, `${sessionId ?? 'surface'}:left`)}
                </div>
                <div className="flex h-full min-h-0 min-w-0 overflow-hidden bg-black">
                  {renderSurfaceContent(rightStageContent, `${sessionId ?? 'surface'}:right`)}
                </div>
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 overflow-hidden bg-black">
                {renderSurfaceContent(primaryStageContent, `${sessionId ?? 'surface'}:full`)}
              </div>
            )}

          </main>
        )}

        <footer className="border-t border-white/10 bg-black/35 px-4 py-3 text-sm text-white/65 backdrop-blur-md">
          <div className="flex flex-wrap items-center gap-4">
            <span className="inline-flex items-center gap-2">
              <Clock3 className="h-4 w-4" />
              Session {formatTimestamp(currentTime)} / {formatTimestamp(totalDuration)}
            </span>
            <span className="inline-flex items-center gap-2">
              <Layers3 className="h-4 w-4" />
              Surface {surfaceLayoutMode}
            </span>
            <span className="inline-flex items-center gap-2">
              <Activity className="h-4 w-4" />
              {session ? `${session.boatType ?? 'Boat'} | ${session.teamName ?? 'Team pending'}` : 'Session metadata pending'}
            </span>
            {videoStageError ? <span className="text-red-200">{videoStageError}</span> : null}
            {!videoStageReady && hasVisibleVideoStage && playableVideos.length > 0 ? (
              <span className="inline-flex items-center gap-2 text-white/55">
                <Radar className="h-4 w-4" />
                Preparing media
              </span>
            ) : null}
          </div>
        </footer>
      </div>
    </div>
  );
}
