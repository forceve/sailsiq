import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import { useLocation, useNavigate, useParams, Link, useSearchParams } from 'react-router-dom';
import {
  Flag,
  Activity,
  Settings,
  Archive,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Globe,
  Film,
  Link2,
  Upload,
  Trash2,
  Loader2,
  Layers3,
  X,
} from 'lucide-react';
import { useTheme } from '@/theme/ThemeContext';
import { useWorkspaceContext } from '@/context/WorkspaceContext';
import type { MapBaselayerKind } from '@/components/MapControls';
import SessionTabs from '@/components/SessionTabs';
import Timeline, { type WorkspaceWindowMs } from '@/components/Timeline';
import SessionVideoStage from '@/components/SessionVideoStage';
import SessionVideoHud from '@/components/SessionVideoHud';
import VideoSyncDialog from '@/components/VideoSyncDialog';
import WorkspaceLensLayer from '@/components/WorkspaceLensLayer';
import WorkspaceMapStage from '@/components/WorkspaceMapStage';
import WorkspaceTelemetryStage from '@/components/WorkspaceTelemetryStage';
import { STAGE_CONTROL_LAYER_CLASS } from '@/components/workspaceLayers';
import ReplayVideoCompanionPage from '@/pages/ReplayVideoCompanionPage';
import type { ThemeStyles } from '@/theme/themeTypes';
import {
  sessionApi,
  trackApi,
  eventApi,
  markApi,
  videoApi,
} from '@/services/api';
import { clamp, formatDate, formatDuration, formatTimestamp } from '@/utils/formatters';
import {
  deriveVideoLabelFromUrl,
  getLocalVideoSignature,
  loadLocalVideoPrefs,
  loadSplitDirection,
  splitDirectionForAspectRatio,
  loadWorkspaceMode,
  saveLocalVideoPrefs,
  saveSplitDirection,
  saveWorkspaceMode,
} from '@/utils/videoSession';
import { tryComputeVideoOffsetFromWallClock } from '@/utils/videoAutoOffset';
import {
  createOffsetOnlyVideoSync,
  createVideoSyncBindingFromAnchor,
  normalizeVideoSyncBinding,
  trackTimeFromRealTime,
} from '@/utils/videoSync';
import { detectVideoTypeFromFile } from '@/utils/videoTypeDetection';
import {
  buildVideoCompanionUrl,
  getVideoCompanionWindowName,
  isVideoCompanionMessage,
  isVideoCompanionWindow,
  openVideoCompanionChannel,
  type CompanionConnectionState,
  type CompanionHostState,
} from '@/utils/videoCompanion';
import { getSpeed, getHeading, getWindDir, getWindSpeed, getVmgToWind } from '@/utils/trackPoint';
import {
  buildRangeIndices,
  findTelemetryIndexAtTime,
} from '@/utils/replayTelemetry';
import type {
  Session,
  TrackPoint,
  TrackStream,
  SessionEvent,
  Mark,
  SessionVideo,
  LocalSessionVideo,
  VideoSyncBinding,
  VideoType,
  WindInputSource,
  WorkspaceMode,
} from '@/types/models';
import type {
  ReplayNavigationState,
  SplitDirection,
  WorkspaceSessionBindingsManifest,
  WorkspaceRangeSelection,
  WorkspaceSelectionState,
  WorkspaceStageContent,
  WorkspaceStageLayoutMode,
  WorkspaceVideoBinding,
  WorkspaceVideoFileSummary,
} from '@/types/workspace';
import {
  getLocalWorkspaceSessionBundle,
  getLocalWorkspaceSessionBindings,
  getWorkspaceRelativeBindingPath,
  listLocalWorkspaceVideoFiles,
  loadLocalWorkspaceVideoFile,
  saveLocalWorkspaceSession,
  saveLocalWorkspaceSessionEvents,
  saveLocalWorkspaceSessionVideoBindings,
} from '@/services/workspace/localTrackSession';
import {
  createTrackStream,
  getActiveTrackPoints,
  getPrimaryTrackId,
  resolveEventTrackId,
  resolveRangeTrackId,
} from '@/utils/trackStreams';
import { detectManeuvers } from '../../../shared/maneuverDetection';
import {
  applyWindInputToTrackPoints,
  createManualGlobalWindInput,
  isManualGlobalWind,
} from '../../../shared/windInputs';

type SidebarTab = 'events' | 'marks';
type DragHandle = 'left' | 'right';

interface ActiveVideoSource {
  key: string;
  origin: 'remote' | 'local';
  id?: string;
  url: string;
  label?: string;
  videoType: VideoType;
  offsetMs: number;
  sync?: VideoSyncBinding;
  signature?: string;
  crossOrigin?: '' | 'anonymous';
}

const DESKTOP_MEDIA_QUERY = '(min-width: 1024px)';
const LEFT_SIDEBAR_MIN_WIDTH = 240;
const LEFT_SIDEBAR_DEFAULT_WIDTH = 288;
const RIGHT_SIDEBAR_MIN_WIDTH = 280;
const RIGHT_SIDEBAR_DEFAULT_WIDTH = 352;
const SIDEBAR_MAX_WIDTH = 480;
const CENTER_MIN_WIDTH = 520;
const SIDEBAR_COLLAPSED_WIDTH = 12;
const EVENT_ACTIVE_WINDOW_MS = 30000;
const COMPANION_HEARTBEAT_MS = 1200;
const COMPANION_TIMEOUT_MS = 4000;
const VIDEO_CLOCK_STATE_UPDATE_MS = 100;
const EDGE_TOGGLE_TOOLTIP_CLASS =
  'pointer-events-none absolute top-1/2 z-20 hidden -translate-y-1/2 whitespace-nowrap rounded-md border border-white/10 bg-black/85 px-2 py-1 text-[11px] font-medium text-white shadow-lg group-hover:block';
const DEFAULT_STAGE_PRIMARY: WorkspaceStageContent = 'map';
const DEFAULT_STAGE_LEFT: WorkspaceStageContent = 'map';
const DEFAULT_STAGE_RIGHT: WorkspaceStageContent = 'telemetry';
const EVENT_ENTRY_HIGHLIGHT_PADDING_MS = 4000;
const EVENT_EXIT_HIGHLIGHT_PADDING_MS = 2000;
const WIND_RECALC_EVENT_TYPES = new Set<SessionEvent['type']>([
  'tack',
  'gybe',
  'other_turn',
]);

interface StageContentOption {
  value: WorkspaceStageContent;
  label: string;
}

function StageContentSelect({
  value,
  onChange,
  label,
  options,
  variant = 'toolbar',
  themeStyles,
}: {
  value: WorkspaceStageContent;
  onChange: (content: WorkspaceStageContent) => void;
  label: string;
  options: StageContentOption[];
  variant?: 'toolbar' | 'overlay';
  themeStyles: ThemeStyles;
}) {
  const [open, setOpen] = useState(false);
  const selectedOption = options.find((option) => option.value === value);

  if (variant === 'overlay') {
    return (
      <div
        className={`relative h-6 w-full shrink-0 ${STAGE_CONTROL_LAYER_CLASS}`}
        onBlur={(event) => {
          const nextFocus = event.relatedTarget;
          if (!(nextFocus instanceof Node) || !event.currentTarget.contains(nextFocus)) {
            setOpen(false);
          }
        }}
      >
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className={`flex h-full w-full items-center gap-2 border-x-0 border-t-0 px-2 text-left shadow-sm backdrop-blur-md transition ${themeStyles.buttonSecondary} ${themeStyles.divider} ${themeStyles.cardHover} rounded-none`}
          title={`Show ${label.toLowerCase()} content`}
          aria-expanded={open}
        >
          <span className={`shrink-0 text-[10px] font-semibold uppercase leading-none tracking-[0.14em] ${themeStyles.textSecondary}`}>
            {label}
          </span>
          <span className={`min-w-0 flex-1 truncate text-[11px] leading-none ${themeStyles.textPrimary}`}>
            {selectedOption?.label ?? value}
          </span>
          <ChevronDown
            className={`h-3.5 w-3.5 shrink-0 transition-transform ${themeStyles.accent} ${
              open ? 'rotate-180' : ''
            }`}
          />
        </button>
        {open ? (
          <div className={`absolute left-0 right-0 top-full z-[1] shadow-xl backdrop-blur-md ${themeStyles.panel} ${themeStyles.divider} max-h-56 overflow-y-auto border-x-0 border-t-0 py-1 rounded-none`}>
            {options.map((option) => {
              const active = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs transition ${
                    active
                      ? themeStyles.accentBg
                      : `${themeStyles.textSecondary} ${themeStyles.cardHover}`
                  }`}
                  title={option.label}
                >
                  <span className="min-w-0 truncate">{option.label}</span>
                  {active ? <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${themeStyles.progressFill}`} /> : null}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <label
      className={
        'flex min-w-[150px] max-w-[220px] shrink-0 items-center gap-2'
      }
    >
      <span
        className={`text-xs uppercase tracking-[0.16em] ${themeStyles.textSecondary}`}
      >
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as WorkspaceStageContent)}
        className={`min-w-0 flex-1 rounded-lg px-2.5 py-1.5 text-sm ${themeStyles.input}`}
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

function localVideoKey(signature: string): string {
  return `local:${signature}`;
}

function remoteVideoKey(video: SessionVideo): string {
  return `remote:${video.id ?? video.url}`;
}

function isVideoStageContent(content: WorkspaceStageContent): boolean {
  return content.startsWith('video:');
}

function videoKeyFromStageContent(content: WorkspaceStageContent): string | null {
  return isVideoStageContent(content) ? content.slice('video:'.length) : null;
}

function shouldStoreVideoClock(previousMs: number | undefined, nextMs: number): boolean {
  if (!Number.isFinite(nextMs)) return false;
  if (previousMs == null) return true;
  return Math.abs(nextMs - previousMs) >= VIDEO_CLOCK_STATE_UPDATE_MS;
}

function eventFallbackHalfWindowMs(type: SessionEvent['type']): number {
  switch (type) {
    case 'mark_rounding':
      return 15000;
    case 'penalty_360':
      return 30000;
    case 'penalty_720':
      return 60000;
    case 'tack':
    case 'gybe':
    case 'other_turn':
      return 8000;
    default:
      return 5000;
  }
}

function rangeFromEvent(
  event: SessionEvent,
  trackId: string,
  totalDurationMs: number,
): WorkspaceRangeSelection {
  const fallback = eventFallbackHalfWindowMs(event.type);
  const rawStart = event.startTime ?? event.timestamp - fallback;
  const rawEnd = event.endTime ?? event.timestamp + fallback;
  const startMs = Math.max(0, rawStart - EVENT_ENTRY_HIGHLIGHT_PADDING_MS);
  const endLimit = totalDurationMs > 0 ? totalDurationMs : rawEnd + EVENT_EXIT_HIGHLIGHT_PADDING_MS;
  const endMs = Math.min(endLimit, rawEnd + EVENT_EXIT_HIGHLIGHT_PADDING_MS);
  return {
    trackId,
    startMs: Math.min(startMs, endMs),
    endMs: Math.max(startMs, endMs),
    source: 'turnRate',
  };
}

function seekTimeFromEvent(event: SessionEvent, totalDurationMs: number): number {
  return rangeFromEvent(event, event.trackId ?? 'primary', totalDurationMs).startMs;
}

function formatEventTimeLabel(event: SessionEvent): string {
  if (event.startTime != null && event.endTime != null) {
    return `${formatTimestamp(event.startTime)} - ${formatTimestamp(event.endTime)}`;
  }
  return formatTimestamp(event.timestamp);
}

function formatEventMeta(event: SessionEvent): string {
  const parts: string[] = [];
  if (event.autoDetected) parts.push('AUTO');
  parts.push(event.type);
  if (event.confidence != null) parts.push(`${Math.round(event.confidence * 100)}%`);
  return parts.join(' / ');
}

function hasEmbeddedWind(points: TrackPoint[]): boolean {
  return points.some((point) => point.w_d != null);
}

function createAutoEventId(trackId: string, type: SessionEvent['type'], timestamp: number, index: number) {
  return `auto-${trackId}-${type}-${Math.round(timestamp)}-${index}-${Date.now().toString(36)}`;
}

function buildDetectedWindEvents(
  sessionId: string,
  trackId: string,
  points: TrackPoint[],
  wind: WindInputSource,
): SessionEvent[] {
  const pointsWithWind = applyWindInputToTrackPoints(points, wind);
  return detectManeuvers({
    sessionId,
    trackId,
    points: pointsWithWind,
  })
    .filter((maneuver) => WIND_RECALC_EVENT_TYPES.has(maneuver.type))
    .map((maneuver, index) => ({
      id: createAutoEventId(trackId, maneuver.type, maneuver.timestamp, index),
      sessionId,
      trackId: maneuver.trackId,
      timestamp: maneuver.timestamp,
      startTime: maneuver.startTime,
      endTime: maneuver.endTime,
      type: maneuver.type,
      note: maneuver.note,
      autoDetected: true,
      verified: false,
      confidence: maneuver.confidence,
      linkedMarkId: maneuver.linkedMarkId,
      metrics: maneuver.metrics,
      reasonCodes: maneuver.reasonCodes,
    }));
}

function mergeWindRecalculatedEvents(
  existing: SessionEvent[],
  nextAutoEvents: SessionEvent[],
  trackId: string,
  primaryTrackId: string,
): {
  merged: SessionEvent[];
  replaced: SessionEvent[];
} {
  const replaced: SessionEvent[] = [];
  const kept = existing.filter((event) => {
    const sameTrack = resolveEventTrackId(event, primaryTrackId) === trackId;
    const replace =
      sameTrack &&
      event.autoDetected === true &&
      event.verified !== true &&
      WIND_RECALC_EVENT_TYPES.has(event.type);
    if (replace) replaced.push(event);
    return !replace;
  });

  return {
    merged: [...kept, ...nextAutoEvents].sort((a, b) => a.timestamp - b.timestamp),
    replaced,
  };
}

function clampWidth(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

function fitSidebarWidths(containerWidth: number, left: number, right: number) {
  let nextLeft = clampWidth(left, LEFT_SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH);
  let nextRight = clampWidth(right, RIGHT_SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH);

  const maxLeft = Math.min(
    SIDEBAR_MAX_WIDTH,
    containerWidth - nextRight - CENTER_MIN_WIDTH,
  );
  nextLeft = clampWidth(
    nextLeft,
    LEFT_SIDEBAR_MIN_WIDTH,
    Math.max(LEFT_SIDEBAR_MIN_WIDTH, maxLeft),
  );

  const maxRight = Math.min(
    SIDEBAR_MAX_WIDTH,
    containerWidth - nextLeft - CENTER_MIN_WIDTH,
  );
  nextRight = clampWidth(
    nextRight,
    RIGHT_SIDEBAR_MIN_WIDTH,
    Math.max(RIGHT_SIDEBAR_MIN_WIDTH, maxRight),
  );

  const retryMaxLeft = Math.min(
    SIDEBAR_MAX_WIDTH,
    containerWidth - nextRight - CENTER_MIN_WIDTH,
  );
  nextLeft = clampWidth(
    nextLeft,
    LEFT_SIDEBAR_MIN_WIDTH,
    Math.max(LEFT_SIDEBAR_MIN_WIDTH, retryMaxLeft),
  );

  return {
    left: nextLeft,
    right: nextRight,
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Request failed.';
}

function findNearestEvent(
  events: SessionEvent[],
  currentTime: number,
): SessionEvent | null {
  let best: SessionEvent | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;

  for (const event of events) {
    const delta = Math.abs(event.timestamp - currentTime);
    if (delta < bestDelta) {
      best = event;
      bestDelta = delta;
    }
  }

  return bestDelta <= EVENT_ACTIVE_WINDOW_MS ? best : null;
}

function getMediaBaseName(fileName: string): string {
  const trimmed = fileName.trim();
  const dotIndex = trimmed.lastIndexOf('.');
  const base = dotIndex > 0 ? trimmed.slice(0, dotIndex) : trimmed;
  return base.toLowerCase().replace(/[\s_-]+/g, '');
}

function getVideoDurationMs(video: HTMLVideoElement): number {
  return Number.isFinite(video.duration) && video.duration > 0 ? video.duration * 1000 : 0;
}

export default function ReplayWorkspacePage() {
  const [searchParams] = useSearchParams();

  if (isVideoCompanionWindow(searchParams)) {
    return <ReplayVideoCompanionPage />;
  }

  return <ReplayWorkspaceHostPage />;
}

function ReplayWorkspaceHostPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { s, themeId } = useTheme();
  const { currentWorkspace } = useWorkspaceContext();
  const replayNavigationState = location.state as ReplayNavigationState | null;
  const isRound =
    themeId === 'nordic' || themeId === 'frost' || themeId === 'neumorph';

  const [session, setSession] = useState<Session | null>(null);
  const [tracks, setTracks] = useState<TrackStream[]>([]);
  const [trackPointsById, setTrackPointsById] = useState<Record<string, TrackPoint[]>>({});
  const [activeTrackId, setActiveTrackId] = useState<string | null>(null);
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [sessionVideos, setSessionVideos] = useState<SessionVideo[]>([]);
  const [activeVideoKey, setActiveVideoKey] = useState<string | null>(null);
  const [activeRemoteVideoId, setActiveRemoteVideoId] = useState<string | null>(null);
  const [localVideo, setLocalVideo] = useState<LocalSessionVideo | null>(null);
  const [loading, setLoading] = useState(true);

  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('events');
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [workspaceWindow, setWorkspaceWindow] = useState<WorkspaceWindowMs>({
    startMs: 0,
    endMs: 0,
  });
  const [draftOffsetMs, setDraftOffsetMs] = useState<number | null>(null);
  const [mapLayer, setMapLayer] = useState<MapBaselayerKind>('vector');
  const [statsCollapsed, setStatsCollapsed] = useState(false);
  const [manualWind, setManualWind] = useState<{ dir: number; speed: number } | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('data');
  const [stageLayoutMode, setStageLayoutMode] =
    useState<WorkspaceStageLayoutMode>('full');
  const [primaryStageContent, setPrimaryStageContent] =
    useState<WorkspaceStageContent>(DEFAULT_STAGE_PRIMARY);
  const [leftStageContent, setLeftStageContent] =
    useState<WorkspaceStageContent>(DEFAULT_STAGE_LEFT);
  const [rightStageContent, setRightStageContent] =
    useState<WorkspaceStageContent>(DEFAULT_STAGE_RIGHT);
  const [splitDirection, setSplitDirection] = useState<SplitDirection>('left-right');
  const [videoDraftUrl, setVideoDraftUrl] = useState('');
  const [videoDraftType, setVideoDraftType] = useState<VideoType>('flat');
  const [videoBusy, setVideoBusy] = useState(false);
  const [videoControlError, setVideoControlError] = useState<string | null>(null);
  const [videoStageError, setVideoStageError] = useState<string | null>(null);
  const [videoStageReady, setVideoStageReady] = useState(false);
  const [videoDurationsByKey, setVideoDurationsByKey] = useState<Record<string, number>>({});
  const [videoClocksByKey, setVideoClocksByKey] = useState<Record<string, number>>({});
  const [videoDurationMs, setVideoDurationMs] = useState(0);
  const [videoClockMs, setVideoClockMs] = useState(0);
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [syncSessionTimeMs, setSyncSessionTimeMs] = useState(0);
  const [syncVideoTimeMs, setSyncVideoTimeMs] = useState(0);
  const [isVideoDialogOpen, setIsVideoDialogOpen] = useState(false);
  const [videoDialogTab, setVideoDialogTab] = useState<
    'recommended' | 'workspace' | 'local' | 'url'
  >('recommended');
  const [workspaceVideoFiles, setWorkspaceVideoFiles] = useState<WorkspaceVideoFileSummary[]>([]);
  const [workspaceVideoLoading, setWorkspaceVideoLoading] = useState(false);
  const [workspaceVideoError, setWorkspaceVideoError] = useState<string | null>(null);
  const [sessionBindings, setSessionBindings] =
    useState<WorkspaceSessionBindingsManifest | null>(null);
  const [sessionBindingsLoaded, setSessionBindingsLoaded] = useState(false);
  const [videoNeedsReview, setVideoNeedsReview] = useState(false);
  const [topBarWidth, setTopBarWidth] = useState(0);
  const [isDesktopLayout, setIsDesktopLayout] = useState(() =>
    typeof window !== 'undefined'
      ? window.matchMedia(DESKTOP_MEDIA_QUERY).matches
      : false,
  );
  const [activeHandle, setActiveHandle] = useState<DragHandle | null>(null);
  const [sidebarWidths, setSidebarWidths] = useState({
    left: LEFT_SIDEBAR_DEFAULT_WIDTH,
    right: RIGHT_SIDEBAR_DEFAULT_WIDTH,
  });
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [companionState, setCompanionState] = useState<CompanionConnectionState>('closed');
  const [selection, setSelection] = useState<WorkspaceSelectionState>({
    eventId: null,
    markId: null,
    range: null,
  });
  const prevLeftWidthRef = useRef(LEFT_SIDEBAR_DEFAULT_WIDTH);
  const prevRightWidthRef = useRef(RIGHT_SIDEBAR_DEFAULT_WIDTH);

  const animRef = useRef<number>(0);
  const lastFrameRef = useRef<number>(0);
  const resumeAfterScrubRef = useRef(false);
  const resumeAfterSyncRef = useRef(false);
  const workspaceRef = useRef<HTMLElement | null>(null);
  const stageCanvasRef = useRef<HTMLElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const topBarRef = useRef<HTMLDivElement | null>(null);
  const localVideoRef = useRef<LocalSessionVideo | null>(null);
  const localVideoObjectUrlRef = useRef<string | null>(null);
  const companionChannelRef = useRef<BroadcastChannel | null>(null);
  const companionHostStateRef = useRef<CompanionHostState | null>(null);
  const lastCompanionReadyAtRef = useRef(0);
  const resizeStateRef = useRef<{
    handle: DragHandle;
    pointerId: number;
    startX: number;
    startLeft: number;
    startRight: number;
    containerWidth: number;
  } | null>(null);
  const resizeMovedRef = useRef(false);
  const hasAppliedPreboundVideoRef = useRef(false);

  const primaryTrackId = useMemo(() => getPrimaryTrackId(tracks), [tracks]);
  const activeTrack = useMemo(
    () => tracks.find((track) => track.id === activeTrackId) ?? tracks[0] ?? null,
    [activeTrackId, tracks],
  );
  const telemetry = useMemo(
    () => getActiveTrackPoints(tracks, trackPointsById, activeTrackId),
    [activeTrackId, trackPointsById, tracks],
  );

  useEffect(() => {
    hasAppliedPreboundVideoRef.current = false;
  }, [sessionId]);

  const videoSources = useMemo<ActiveVideoSource[]>(() => {
    const sources: ActiveVideoSource[] = [];
    if (localVideo) {
      sources.push({
        key: localVideoKey(localVideo.signature),
        origin: 'local',
        url: localVideo.objectUrl,
        label: localVideo.label ?? localVideo.file.name,
        videoType: localVideo.videoType,
        offsetMs: localVideo.offsetMs,
        sync: localVideo.sync,
        signature: localVideo.signature,
        crossOrigin: '',
      });
    }

    sessionVideos.forEach((video) => {
      sources.push({
        key: remoteVideoKey(video),
        origin: 'remote',
        id: video.id,
        url: video.url,
        label: video.label,
        videoType: video.videoType,
        offsetMs: video.offsetMs,
        sync: video.sync,
        crossOrigin: 'anonymous',
      });
    });

    return sources;
  }, [localVideo, sessionVideos]);

  const activeVideo = useMemo<ActiveVideoSource | null>(() => {
    if (videoSources.length === 0) return null;
    return (
      videoSources.find((video) => video.key === activeVideoKey) ??
      videoSources.find(
        (video) =>
          video.origin === 'remote' &&
          sessionVideos.some(
            (sessionVideo) =>
              remoteVideoKey(sessionVideo) === video.key &&
              sessionVideo.id === activeRemoteVideoId,
          ),
      ) ??
      videoSources[0] ??
      null
    );
  }, [activeRemoteVideoId, activeVideoKey, sessionVideos, videoSources]);

  const selectActiveVideo = useCallback((video: ActiveVideoSource | null) => {
    setActiveVideoKey(video?.key ?? null);
    if (video?.origin === 'remote') {
      setActiveRemoteVideoId(video.id ?? null);
      setVideoDraftUrl(video.url);
      setVideoDraftType(video.videoType);
    } else if (video?.origin === 'local') {
      setActiveRemoteVideoId(null);
      setVideoDraftType(video.videoType);
    } else {
      setActiveRemoteVideoId(null);
    }
    setDraftOffsetMs(null);
    setVideoStageError(null);
    setVideoStageReady(false);
    setSyncSessionTimeMs(0);
    setSyncVideoTimeMs(0);
  }, []);

  const postCompanionMessage = useCallback((message: unknown) => {
    companionChannelRef.current?.postMessage(message);
  }, []);

  const broadcastCompanionState = useCallback(() => {
    const nextState = companionHostStateRef.current;
    if (!sessionId || !nextState) return;
    postCompanionMessage({
      type: 'host_state',
      sessionId,
      state: {
        ...nextState,
        sentAt: Date.now(),
      },
    });
  }, [postCompanionMessage, sessionId]);

  const sendLocalVideoToCompanion = useCallback(() => {
    if (!sessionId) return;

    const nextLocalVideo = localVideoRef.current;

    if (!nextLocalVideo) {
      postCompanionMessage({
        type: 'host_clear_local_video',
        sessionId,
        sentAt: Date.now(),
      });
      return;
    }

    postCompanionMessage({
      type: 'host_local_video',
      sessionId,
      sentAt: Date.now(),
      file: nextLocalVideo.file,
      label: nextLocalVideo.file.name,
      key: localVideoKey(nextLocalVideo.signature),
      signature: nextLocalVideo.signature,
      videoType: nextLocalVideo.videoType,
      offsetMs: nextLocalVideo.offsetMs,
      sync: nextLocalVideo.sync,
    });
  }, [postCompanionMessage, sessionId]);

  useEffect(() => {
    localVideoRef.current = localVideo;
    localVideoObjectUrlRef.current = localVideo?.objectUrl ?? null;
  }, [localVideo]);

  useEffect(() => {
    return () => {
      if (localVideoObjectUrlRef.current) {
        URL.revokeObjectURL(localVideoObjectUrlRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    setWorkspaceMode(loadWorkspaceMode(sessionId) ?? 'data');
    setSplitDirection(loadSplitDirection(sessionId) ?? 'left-right');
  }, [sessionId]);

  useLayoutEffect(() => {
    if (!sessionId) return;
    if (loadSplitDirection(sessionId) != null) return;
    const el = stageCanvasRef.current;
    if (!el) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (w > 0 && h > 0) {
      setSplitDirection(splitDirectionForAspectRatio(w, h));
    }
  }, [sessionId]);

  useLayoutEffect(() => {
    const el = topBarRef.current;
    if (!el) return;

    const updateTopBarWidth = () => {
      setTopBarWidth(el.clientWidth);
    };

    updateTopBarWidth();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateTopBarWidth);
      return () => window.removeEventListener('resize', updateTopBarWidth);
    }

    const observer = new ResizeObserver(updateTopBarWidth);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    saveWorkspaceMode(sessionId, workspaceMode);
  }, [sessionId, workspaceMode]);

  useEffect(() => {
    if (!sessionId) return;
    saveSplitDirection(sessionId, splitDirection);
  }, [sessionId, splitDirection]);

  useEffect(() => {
    if (!sessionId || !localVideo) return;
    saveLocalVideoPrefs(sessionId, localVideo.signature, {
      offsetMs: localVideo.offsetMs,
      sync: localVideo.sync,
      videoType: localVideo.videoType,
    });
  }, [localVideo, sessionId]);

  useEffect(() => {
    if (activeVideo) return;
    if (syncDialogOpen) {
      setSyncDialogOpen(false);
      setSyncSessionTimeMs(0);
      setSyncVideoTimeMs(0);
    }
  }, [activeVideo, syncDialogOpen]);

  useEffect(() => {
    const hasVideoContent =
      stageLayoutMode === 'split'
        ? isVideoStageContent(leftStageContent) || isVideoStageContent(rightStageContent)
        : isVideoStageContent(primaryStageContent);
    const nextMode: WorkspaceMode =
      stageLayoutMode === 'split' ? 'split' : hasVideoContent ? 'overlay' : 'data';
    setWorkspaceMode((current) => (current === nextMode ? current : nextMode));
  }, [leftStageContent, primaryStageContent, rightStageContent, stageLayoutMode]);

  useEffect(() => {
    if (!sessionId) {
      setCompanionState('closed');
      lastCompanionReadyAtRef.current = 0;
      companionChannelRef.current?.close();
      companionChannelRef.current = null;
      return;
    }

    setCompanionState((prev) => (prev === 'blocked' ? prev : 'closed'));
    const channel = openVideoCompanionChannel(sessionId);
    companionChannelRef.current = channel;
    lastCompanionReadyAtRef.current = 0;

    if (!channel) {
      return () => {
        if (companionChannelRef.current === channel) {
          companionChannelRef.current = null;
        }
      };
    }

    const handleMessage = (event: MessageEvent) => {
      if (!isVideoCompanionMessage(event.data) || event.data.sessionId !== sessionId) return;

      switch (event.data.type) {
        case 'companion_ready':
          lastCompanionReadyAtRef.current = Date.now();
          setCompanionState('connected');
          broadcastCompanionState();
          sendLocalVideoToCompanion();
          return;
        case 'companion_closed':
          lastCompanionReadyAtRef.current = 0;
          setCompanionState((prev) => (prev === 'blocked' ? prev : 'disconnected'));
          return;
        case 'focus_event':
          setSelection((prev) => ({
            ...prev,
            eventId: event.data.eventId,
            markId: null,
          }));
          setCurrentTime(event.data.timestamp);
          return;
        case 'focus_mark':
          setSelection((prev) => ({
            ...prev,
            markId: event.data.markId,
            eventId: null,
          }));
          return;
        case 'focus_range':
          setSelection((prev) => ({
            ...prev,
            range: event.data.range,
          }));
          if (event.data.range) {
            setCurrentTime((event.data.range.startMs + event.data.range.endMs) / 2);
          }
          return;
        case 'surface_role_changed':
          return;
        default:
          return;
      }
    };

    channel.addEventListener('message', handleMessage);

    const heartbeatTimer = window.setInterval(() => {
      channel.postMessage({
        type: 'host_ping',
        sessionId,
        sentAt: Date.now(),
      });

      if (
        lastCompanionReadyAtRef.current > 0 &&
        Date.now() - lastCompanionReadyAtRef.current > COMPANION_TIMEOUT_MS
      ) {
        setCompanionState((prev) =>
          prev === 'opening' || prev === 'connected' ? 'disconnected' : prev,
        );
      }
    }, COMPANION_HEARTBEAT_MS);

    return () => {
      window.clearInterval(heartbeatTimer);
      channel.removeEventListener('message', handleMessage);
      channel.close();
      if (companionChannelRef.current === channel) {
        companionChannelRef.current = null;
      }
    };
  }, [broadcastCompanionState, sendLocalVideoToCompanion, sessionId]);

  useEffect(() => {
    if (!sessionId || !companionChannelRef.current) return;
    if (lastCompanionReadyAtRef.current === 0) return;
    sendLocalVideoToCompanion();
  }, [
    localVideo?.file,
    localVideo?.offsetMs,
    localVideo?.signature,
    localVideo?.sync?.updatedAt,
    localVideo?.videoType,
    sendLocalVideoToCompanion,
    sessionId,
  ]);

  useEffect(() => {
    if (!sessionId) return;
    broadcastCompanionState();
  }, [
    activeVideo?.label,
    activeVideo?.offsetMs,
    activeVideo?.origin,
    activeVideo?.signature,
    activeVideo?.sync?.updatedAt,
    activeVideo?.url,
    activeVideo?.videoType,
    broadcastCompanionState,
    isPlaying,
    playbackSpeed,
    session?.name,
    sessionId,
    syncDialogOpen,
    syncSessionTimeMs,
    syncVideoTimeMs,
    workspaceMode,
    selection.eventId,
    selection.markId,
    selection.range?.endMs,
    selection.range?.source,
    selection.range?.startMs,
  ]);

  useEffect(() => {
    if (isPlaying || syncDialogOpen) return;
    broadcastCompanionState();
  }, [broadcastCompanionState, currentTime, isPlaying, syncDialogOpen]);

  useEffect(() => {
    if (!isPlaying || syncDialogOpen) return;
    const timer = window.setInterval(() => {
      broadcastCompanionState();
    }, 250);
    return () => window.clearInterval(timer);
  }, [broadcastCompanionState, isPlaying, syncDialogOpen]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mediaQuery = window.matchMedia(DESKTOP_MEDIA_QUERY);
    const updateLayout = () => setIsDesktopLayout(mediaQuery.matches);

    updateLayout();
    mediaQuery.addEventListener('change', updateLayout);
    return () => mediaQuery.removeEventListener('change', updateLayout);
  }, []);

  useEffect(() => {
    if (!isDesktopLayout) {
      resizeStateRef.current = null;
      setActiveHandle(null);
      return;
    }

    const syncSidebarWidths = () => {
      const containerWidth = workspaceRef.current?.clientWidth ?? 0;
      if (containerWidth <= 0) return;

      setSidebarWidths((prev) => {
        const next = fitSidebarWidths(containerWidth, prev.left, prev.right);
        return next.left === prev.left && next.right === prev.right ? prev : next;
      });
    };

    syncSidebarWidths();
    window.addEventListener('resize', syncSidebarWidths);
    return () => window.removeEventListener('resize', syncSidebarWidths);
  }, [isDesktopLayout]);

  useEffect(() => {
    if (!activeHandle) return;

    const handlePointerMove = (event: PointerEvent) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState || resizeState.pointerId !== event.pointerId) return;

      const containerWidth =
        workspaceRef.current?.clientWidth ?? resizeState.containerWidth;
      const delta = event.clientX - resizeState.startX;
      if (Math.abs(delta) > 3) {
        resizeMovedRef.current = true;
      }
      const next =
        resizeState.handle === 'left'
          ? fitSidebarWidths(
              containerWidth,
              resizeState.startLeft + delta,
              resizeState.startRight,
            )
          : fitSidebarWidths(
              containerWidth,
              resizeState.startLeft,
              resizeState.startRight - delta,
            );

      setSidebarWidths((prev) =>
        prev.left === next.left && prev.right === next.right ? prev : next,
      );
    };

    const stopResizing = (event?: PointerEvent) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState) return;
      if (event && resizeState.pointerId !== event.pointerId) return;

      resizeStateRef.current = null;
      setActiveHandle(null);
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResizing);
    window.addEventListener('pointercancel', stopResizing);

    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResizing);
      window.removeEventListener('pointercancel', stopResizing);
    };
  }, [activeHandle]);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    setLoading(true);
    setSession(null);
    setTracks([]);
    setTrackPointsById({});
    setActiveTrackId(null);
    setEvents([]);
    setMarks([]);
    setSessionVideos([]);
    setActiveVideoKey(null);
    setActiveRemoteVideoId(null);
    setVideoDraftUrl('');
    setVideoDraftType('flat');
    setCurrentTime(0);
    setIsPlaying(false);
    setWorkspaceWindow({ startMs: 0, endMs: 0 });
    setDraftOffsetMs(null);
    setVideoStageError(null);
    setVideoClockMs(0);
    setVideoDurationMs(0);
    setVideoStageReady(false);
    setSyncDialogOpen(false);
    setSyncSessionTimeMs(0);
    setSyncVideoTimeMs(0);
    setVideoControlError(null);
    setManualWind(null);

    const load = async () => {
      if (currentWorkspace) {
        try {
          const localBundle = await getLocalWorkspaceSessionBundle(
            currentWorkspace.id,
            sessionId,
          );
          if (localBundle) {
            return {
              nextSession: localBundle.session,
              nextTracks: localBundle.tracks,
              nextTrackPointsById: localBundle.trackPointsById,
              nextEvents: localBundle.events,
              nextMarks: localBundle.marks,
              nextVideos: [] as SessionVideo[],
            };
          }
        } catch {
          // Fall through to the existing remote APIs when local workspace access fails.
        }
      }

      const [nextSession, nextEvents, nextMarks, nextVideos] =
        await Promise.all([
          sessionApi.get(sessionId),
          eventApi.list(sessionId),
          markApi.list(sessionId),
          videoApi.list(sessionId).catch(async () => {
            const legacyVideo = await videoApi.get(sessionId);
            return legacyVideo ? [legacyVideo] : [];
          }),
        ]);
      let nextTracks: TrackStream[];
      let nextTrackPointsById: Record<string, TrackPoint[]>;
      try {
        nextTracks = await trackApi.list(sessionId);
        const entries = await Promise.all(
          nextTracks.map(async (track) => [
            track.id,
            await trackApi.getPoints(sessionId, track.id),
          ] as const),
        );
        nextTrackPointsById = Object.fromEntries(entries);
      } catch {
        const legacyTelemetry = await trackApi.get(sessionId);
        const primaryTrack = createTrackStream(nextSession, legacyTelemetry, {
          id: 'primary',
          trackTimeOriginUnixMs: nextSession.trackTimeOriginUnixMs,
        });
        nextTracks = [primaryTrack];
        nextTrackPointsById = { [primaryTrack.id]: legacyTelemetry };
      }

      return {
        nextSession,
        nextTracks,
        nextTrackPointsById,
        nextEvents,
        nextMarks,
        nextVideos,
      };
    };

    void load()
      .then(({ nextSession, nextTracks, nextTrackPointsById, nextEvents, nextMarks, nextVideos }) => {
        if (cancelled) return;
        setSession(nextSession);
        setManualWind(
          isManualGlobalWind(nextSession.analysisInputs?.wind)
            ? {
                dir: nextSession.analysisInputs.wind.twd,
                speed: nextSession.analysisInputs.wind.speed ?? 0,
              }
            : null,
        );
        setTracks(nextTracks);
        setTrackPointsById(nextTrackPointsById);
        setActiveTrackId(getPrimaryTrackId(nextTracks));
        setEvents(nextEvents);
        setMarks(nextMarks);
        setSessionVideos(nextVideos);
        setActiveRemoteVideoId(nextVideos[0]?.id ?? null);
        setActiveVideoKey(nextVideos[0] ? remoteVideoKey(nextVideos[0]) : null);
        const sessionDurMs = nextSession.stats.duration * 1000;
        setWorkspaceWindow({ startMs: 0, endMs: sessionDurMs });
        setVideoDraftUrl(nextVideos[0]?.url ?? '');
        setVideoDraftType(nextVideos[0]?.videoType ?? 'flat');
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setSession(null);
          setTracks([]);
          setTrackPointsById({});
          setActiveTrackId(null);
          setEvents([]);
          setMarks([]);
          setSessionVideos([]);
          setActiveVideoKey(null);
          setActiveRemoteVideoId(null);
          setVideoDraftUrl('');
          setVideoDraftType('flat');
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      setLocalVideo((prev) => {
        if (prev) URL.revokeObjectURL(prev.objectUrl);
        return null;
      });
    };
  }, [currentWorkspace, sessionId]);

  const refreshWorkspaceVideos = useCallback(async () => {
    if (!currentWorkspace) {
      setWorkspaceVideoFiles([]);
      setWorkspaceVideoError(null);
      return;
    }

    setWorkspaceVideoLoading(true);
    try {
      const files = await listLocalWorkspaceVideoFiles(currentWorkspace.id);
      setWorkspaceVideoFiles(files);
      setWorkspaceVideoError(null);
    } catch (error) {
      setWorkspaceVideoFiles([]);
      setWorkspaceVideoError(getErrorMessage(error));
    } finally {
      setWorkspaceVideoLoading(false);
    }
  }, [currentWorkspace]);

  useEffect(() => {
    if (!currentWorkspace || !sessionId) {
      setSessionBindings(null);
      setSessionBindingsLoaded(false);
      setWorkspaceVideoFiles([]);
      setWorkspaceVideoError(null);
      setWorkspaceVideoLoading(false);
      return;
    }

    setSessionBindingsLoaded(false);
    void refreshWorkspaceVideos();
    void getLocalWorkspaceSessionBindings(currentWorkspace.id, sessionId)
      .then((bindings) => {
        setSessionBindings(bindings);
        setSessionBindingsLoaded(true);
      })
      .catch(() => {
        setSessionBindings(null);
        setSessionBindingsLoaded(true);
      });
  }, [currentWorkspace, refreshWorkspaceVideos, sessionId]);

  const totalDuration = session ? session.stats.duration * 1000 : 0;

  const workspaceWindowEffective = useMemo((): WorkspaceWindowMs => {
    if (totalDuration <= 0) return { startMs: 0, endMs: 0 };
    const { startMs, endMs } = workspaceWindow;
    if (endMs > startMs) return { startMs, endMs };
    return { startMs: 0, endMs: totalDuration };
  }, [totalDuration, workspaceWindow]);

  const workspaceDurationMs = Math.max(
    0,
    workspaceWindowEffective.endMs - workspaceWindowEffective.startMs,
  );

  const workspaceEvents = useMemo(
    () =>
      events.filter(
        (ev) =>
          ev.timestamp >= workspaceWindowEffective.startMs &&
          ev.timestamp <= workspaceWindowEffective.endMs &&
          resolveEventTrackId(ev, primaryTrackId) ===
            (activeTrack?.id ?? primaryTrackId),
      ),
    [
      activeTrack?.id,
      events,
      primaryTrackId,
      workspaceWindowEffective.endMs,
      workspaceWindowEffective.startMs,
    ],
  );

  const effectiveOffsetMs = draftOffsetMs ?? activeVideo?.offsetMs ?? 0;
  const visibleStageVideoKeys = useMemo(() => {
    const contents =
      stageLayoutMode === 'split'
        ? [leftStageContent, rightStageContent]
        : [primaryStageContent];
    return new Set(
      contents
        .map((content) => videoKeyFromStageContent(content))
        .filter((key): key is string => Boolean(key)),
    );
  }, [leftStageContent, primaryStageContent, rightStageContent, stageLayoutMode]);
  const hasInlineVideoStage = Boolean(
    activeVideo && visibleStageVideoKeys.has(activeVideo.key),
  );

  useEffect(() => {
    if (totalDuration <= 0) return;
    setWorkspaceWindow((prev) => {
      if (prev.endMs <= prev.startMs) return { startMs: 0, endMs: totalDuration };
      return {
        startMs: clamp(prev.startMs, 0, totalDuration),
        endMs: clamp(prev.endMs, 0, totalDuration),
      };
    });
  }, [totalDuration]);

  useEffect(() => {
    const { startMs, endMs } = workspaceWindowEffective;
    if (endMs <= startMs) return;
    setCurrentTime((t) => clamp(t, startMs, endMs));
  }, [workspaceWindowEffective.endMs, workspaceWindowEffective.startMs]);

  useEffect(() => {
    if (!activeVideo || hasInlineVideoStage) return;

    let cancelled = false;
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.playsInline = true;
    if (activeVideo.crossOrigin) video.crossOrigin = activeVideo.crossOrigin;

    const syncDuration = () => {
      if (cancelled) return;
      const nextDurationMs = getVideoDurationMs(video);
      if (nextDurationMs > 0) {
        setVideoDurationMs((prev) => (prev === nextDurationMs ? prev : nextDurationMs));
      }
    };

    video.addEventListener('loadedmetadata', syncDuration);
    video.addEventListener('durationchange', syncDuration);
    video.src = activeVideo.url;
    video.load();
    syncDuration();

    return () => {
      cancelled = true;
      video.removeEventListener('loadedmetadata', syncDuration);
      video.removeEventListener('durationchange', syncDuration);
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [activeVideo, hasInlineVideoStage]);

  useEffect(() => {
    if (videoSources.length === 0) {
      setVideoDurationsByKey((prev) => (Object.keys(prev).length === 0 ? prev : {}));
      return;
    }

    let cancelled = false;
    const cleanup: Array<() => void> = [];

    videoSources.forEach((source) => {
      const existingDuration = videoDurationsByKey[source.key] ?? 0;
      if (existingDuration > 0) return;
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.playsInline = true;
      if (source.crossOrigin) video.crossOrigin = source.crossOrigin;

      const syncDuration = () => {
        if (cancelled) return;
        const nextDurationMs = getVideoDurationMs(video);
        if (nextDurationMs > 0) {
          setVideoDurationsByKey((prev) => ({
            ...prev,
            [source.key]: nextDurationMs,
          }));
        }
      };

      video.addEventListener('loadedmetadata', syncDuration);
      video.addEventListener('durationchange', syncDuration);
      video.src = source.url;
      video.load();
      cleanup.push(() => {
        video.removeEventListener('loadedmetadata', syncDuration);
        video.removeEventListener('durationchange', syncDuration);
        video.pause();
        video.removeAttribute('src');
        video.load();
      });
    });

    return () => {
      cancelled = true;
      cleanup.forEach((fn) => fn());
    };
  }, [videoDurationsByKey, videoSources]);

  useEffect(() => {
    if (!activeVideo) {
      setVideoDurationMs(0);
      setVideoClockMs(0);
      return;
    }
    setVideoDurationMs(videoDurationsByKey[activeVideo.key] ?? 0);
    setVideoClockMs(videoClocksByKey[activeVideo.key] ?? 0);
  }, [activeVideo, videoClocksByKey, videoDurationsByKey]);

  useEffect(() => {
    if (!isPlaying || totalDuration === 0) return;

    lastFrameRef.current = performance.now();
    const endMs = workspaceWindowEffective.endMs;

    const tick = (now: number) => {
      const delta = (now - lastFrameRef.current) * playbackSpeed;
      lastFrameRef.current = now;
      setCurrentTime((prev) => {
        const next = prev + delta;
        if (next >= endMs) {
          setIsPlaying(false);
          return endMs;
        }
        return next;
      });
      animRef.current = requestAnimationFrame(tick);
    };

    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, [isPlaying, playbackSpeed, totalDuration, workspaceWindowEffective.endMs]);

  const playheadIndex =
    telemetry.length > 0 ? findTelemetryIndexAtTime(telemetry, currentTime) : 0;

  const currentPoint = telemetry[playheadIndex];

  const workspaceTelemetryIndices = useMemo(() => {
    if (telemetry.length < 2 || workspaceDurationMs <= 0) return null;
    const startIdx = findTelemetryIndexAtTime(telemetry, workspaceWindowEffective.startMs);
    const endIdx = findTelemetryIndexAtTime(telemetry, workspaceWindowEffective.endMs);
    const a = Math.max(0, Math.min(startIdx, endIdx));
    const b = Math.max(0, Math.max(startIdx, endIdx));
    return { startIdx: a, endIdx: b };
  }, [
    telemetry,
    workspaceDurationMs,
    workspaceWindowEffective.endMs,
    workspaceWindowEffective.startMs,
  ]);

  const telemetryWorkspace = useMemo(() => {
    if (!workspaceTelemetryIndices) return telemetry;
    const { startIdx, endIdx } = workspaceTelemetryIndices;
    return telemetry.slice(startIdx, endIdx + 1);
  }, [telemetry, workspaceTelemetryIndices]);

  const chartPlayheadRatio =
    workspaceDurationMs > 0
      ? clamp(
          (currentTime - workspaceWindowEffective.startMs) / workspaceDurationMs,
          0,
          1,
        )
      : 0;

  const chartSelectionRange = useCallback(
    (source: WorkspaceRangeSelection['source']) => {
      if (selection.range?.source !== source || workspaceDurationMs <= 0) return null;
      if (
        resolveRangeTrackId(selection.range, primaryTrackId) !==
        (activeTrack?.id ?? primaryTrackId)
      ) {
        return null;
      }
      const ws = workspaceWindowEffective;
      const d = workspaceDurationMs;
      const s = clamp((selection.range.startMs - ws.startMs) / d, 0, 1);
      const e = clamp((selection.range.endMs - ws.startMs) / d, 0, 1);
      if (e <= s) return null;
      return { startRatio: s, endRatio: e };
    },
    [
      activeTrack?.id,
      primaryTrackId,
      selection.range,
      workspaceDurationMs,
      workspaceWindowEffective,
    ],
  );

  /** Map: only draw the track inside the workspace window (hide the rest). */
  const workspaceRouteClipRange = useMemo(() => {
    if (telemetry.length < 2) return null;
    if (
      workspaceWindowEffective.startMs <= 0 &&
      workspaceWindowEffective.endMs >= totalDuration
    ) {
      return null;
    }
    return buildRangeIndices(
      {
        startMs: workspaceWindowEffective.startMs,
        endMs: workspaceWindowEffective.endMs,
      },
      telemetry,
    );
  }, [telemetry, totalDuration, workspaceWindowEffective]);

  const nearestEvent = useMemo(
    () => findNearestEvent(workspaceEvents, currentTime),
    [currentTime, workspaceEvents],
  );
  const selectedEvent = useMemo(
    () => events.find((event) => event.id === selection.eventId) ?? null,
    [events, selection.eventId],
  );
  const selectedMark = useMemo(
    () => marks.find((mark) => mark.id === selection.markId) ?? null,
    [marks, selection.markId],
  );
  const highlightedRange = useMemo(
    () => {
      if (
        !selection.range ||
        resolveRangeTrackId(selection.range, primaryTrackId) !==
          (activeTrack?.id ?? primaryTrackId)
      ) {
        return null;
      }
      return buildRangeIndices(selection.range, telemetry);
    },
    [activeTrack?.id, primaryTrackId, selection.range, telemetry],
  );
  const recommendedWorkspaceVideos = useMemo(() => {
    const referenceName =
      sessionBindings?.track?.fileName ??
      session?.name ??
      '';
    const targetBaseName = getMediaBaseName(referenceName);
    if (!targetBaseName) return [];
    return workspaceVideoFiles.filter(
      (video) => getMediaBaseName(video.name) === targetBaseName,
    );
  }, [session?.name, sessionBindings?.track?.fileName, workspaceVideoFiles]);
  const otherWorkspaceVideos = useMemo(() => {
    const recommendedPaths = new Set(
      recommendedWorkspaceVideos.map((video) => video.relativePath),
    );
    return workspaceVideoFiles.filter(
      (video) => !recommendedPaths.has(video.relativePath),
    );
  }, [recommendedWorkspaceVideos, workspaceVideoFiles]);
  const boundWorkspaceVideoBindings = sessionBindings?.videos ?? [];
  const stageContentOptions = useMemo(
    () => [
      { value: 'map' as WorkspaceStageContent, label: 'Map' },
      { value: 'telemetry' as WorkspaceStageContent, label: 'Telemetry' },
      ...videoSources.map((video, index) => ({
        value: `video:${video.key}` as WorkspaceStageContent,
        label: `Video ${index + 1}: ${video.label ?? video.url}`,
      })),
    ],
    [videoSources],
  );

  const selectStageContent = useCallback(
    (content: WorkspaceStageContent, setter: (content: WorkspaceStageContent) => void) => {
      setter(content);
      const videoKey = videoKeyFromStageContent(content);
      if (!videoKey) return;
      const selectedVideo = videoSources.find((video) => video.key === videoKey);
      if (!selectedVideo) return;
      selectActiveVideo(selectedVideo);
    },
    [selectActiveVideo, videoSources],
  );

  useEffect(() => {
    const validContent = new Set(stageContentOptions.map((option) => option.value));
    const normalize = (content: WorkspaceStageContent, fallback: WorkspaceStageContent) =>
      validContent.has(content) ? content : fallback;
    setPrimaryStageContent((current) => normalize(current, DEFAULT_STAGE_PRIMARY));
    setLeftStageContent((current) => normalize(current, DEFAULT_STAGE_LEFT));
    setRightStageContent((current) => normalize(current, DEFAULT_STAGE_RIGHT));
  }, [stageContentOptions]);

  useEffect(() => {
    if (!isVideoDialogOpen) return;
    if (recommendedWorkspaceVideos.length > 0) {
      setVideoDialogTab('recommended');
      return;
    }
    if (currentWorkspace) {
      setVideoDialogTab('workspace');
      return;
    }
    setVideoDialogTab('local');
  }, [currentWorkspace, isVideoDialogOpen, recommendedWorkspaceVideos.length]);

  useEffect(() => {
    if (!sessionId) {
      companionHostStateRef.current = null;
      return;
    }

    companionHostStateRef.current = {
      sessionId,
      sessionName: session?.name,
      totalDurationMs: totalDuration,
      workspaceWindow: workspaceWindowEffective,
      currentTime,
      isPlaying,
      playbackSpeed,
      workspaceMode,
      stageLayout: {
        mode: stageLayoutMode,
        primary: primaryStageContent,
        left: leftStageContent,
        right: rightStageContent,
      },
      syncDialogOpen,
      syncSessionTimeMs,
      syncVideoTimeMs,
      currentPoint,
      activeTrackId: activeTrack?.id ?? primaryTrackId,
      activeTrackPoints: telemetry,
      windDir: manualWind?.dir ?? (currentPoint ? getWindDir(currentPoint) : undefined),
      windSpeed: manualWind?.speed ?? (currentPoint ? getWindSpeed(currentPoint) : undefined),
      nearestEvent,
      video: activeVideo
        ? {
            key: activeVideo.key,
            origin: activeVideo.origin,
            id: activeVideo.id,
            label: activeVideo.label,
            url: activeVideo.origin === 'remote' ? activeVideo.url : undefined,
            videoType: activeVideo.videoType,
            offsetMs: activeVideo.offsetMs,
            sync: activeVideo.sync,
            signature: activeVideo.signature,
          }
        : null,
      videos: videoSources.map((video) => ({
        key: video.key,
        origin: video.origin,
        id: video.id,
        label: video.label,
        url: video.origin === 'remote' ? video.url : undefined,
        videoType: video.videoType,
        offsetMs: video.offsetMs,
        sync: video.sync,
        signature: video.signature,
      })),
      selection,
      sentAt: Date.now(),
    };
  }, [
    activeVideo,
    activeVideo?.sync?.updatedAt,
    activeTrack?.id,
    currentPoint,
    currentTime,
    isPlaying,
    manualWind?.dir,
    manualWind?.speed,
    nearestEvent,
    playbackSpeed,
    session?.name,
    sessionId,
    selection,
    stageLayoutMode,
    primaryStageContent,
    leftStageContent,
    rightStageContent,
    syncDialogOpen,
    syncSessionTimeMs,
    syncVideoTimeMs,
    telemetry,
    totalDuration,
    workspaceWindowEffective,
    primaryTrackId,
    workspaceMode,
    videoSources,
  ]);

  const handleSeek = useCallback(
    (time: number) =>
      setCurrentTime(
        clamp(
          time,
          workspaceWindowEffective.startMs,
          Math.min(workspaceWindowEffective.endMs, totalDuration),
        ),
      ),
    [totalDuration, workspaceWindowEffective.endMs, workspaceWindowEffective.startMs],
  );

  const handleChartSeek = useCallback(
    (ratio: number) => {
      if (workspaceDurationMs <= 0) return;
      setCurrentTime(
        clamp(
          workspaceWindowEffective.startMs + ratio * workspaceDurationMs,
          workspaceWindowEffective.startMs,
          workspaceWindowEffective.endMs,
        ),
      );
    },
    [
      workspaceDurationMs,
      workspaceWindowEffective.endMs,
      workspaceWindowEffective.startMs,
    ],
  );

  const handleSkip = useCallback(
    (deltaMs: number) =>
      setCurrentTime((prev) =>
        clamp(prev + deltaMs, workspaceWindowEffective.startMs, workspaceWindowEffective.endMs),
      ),
    [workspaceWindowEffective.endMs, workspaceWindowEffective.startMs],
  );

  const handleSeekStart = useCallback(() => {
    resumeAfterScrubRef.current = isPlaying;
    setIsPlaying(false);
  }, [isPlaying]);

  const handleSeekEnd = useCallback(
    (time: number) => {
      if (
        resumeAfterScrubRef.current &&
        workspaceWindowEffective.endMs > workspaceWindowEffective.startMs &&
        time < workspaceWindowEffective.endMs
      ) {
        setIsPlaying(true);
      }
      resumeAfterScrubRef.current = false;
    },
    [workspaceWindowEffective.endMs, workspaceWindowEffective.startMs],
  );

  const handleAddEvent = useCallback(async () => {
    if (!sessionId) return;
    const note = prompt('Event note:');
    if (note == null || note.trim() === '') return;
    const event = await eventApi.create(sessionId, {
      trackId: activeTrack?.id ?? primaryTrackId,
      timestamp: currentTime,
      type: 'general',
      note: note.trim(),
    });
    setEvents((prev) => [...prev, event]);
  }, [activeTrack?.id, currentTime, primaryTrackId, sessionId]);

  const handleAddMark = useCallback(async () => {
    if (!sessionId || !currentPoint) return;
    const name = prompt('Mark name:', 'New Mark');
    const mark = await markApi.create(sessionId, {
      type: 'mark',
      name: name?.trim() || 'New Mark',
      lat: currentPoint.lat,
      lon: currentPoint.lon,
    });
    setMarks((prev) => [...prev, mark]);
  }, [sessionId, currentPoint]);

  const handleSnapshot = useCallback(() => {
    alert('Snapshot saved (placeholder).');
  }, []);

  const persistSessionSnapshot = useCallback(
    async (nextSession: Session): Promise<Session> => {
      if (currentWorkspace) {
        try {
          await saveLocalWorkspaceSession(currentWorkspace.id, nextSession);
          return nextSession;
        } catch {
          // Fall through to remote persistence when this session is not in the local workspace.
        }
      }

      return sessionApi.update(nextSession.id, {
        analysisInputs: nextSession.analysisInputs,
        eventCount: nextSession.eventCount,
      });
    },
    [currentWorkspace],
  );

  const persistWindRecalculatedEvents = useCallback(
    async (
      mergedEvents: SessionEvent[],
      replacedEvents: SessionEvent[],
      nextAutoEvents: SessionEvent[],
    ): Promise<SessionEvent[]> => {
      if (!sessionId) return events;

      if (currentWorkspace) {
        try {
          await saveLocalWorkspaceSessionEvents(currentWorkspace.id, sessionId, mergedEvents);
          return mergedEvents;
        } catch {
          // Fall through to remote persistence when this session is not in the local workspace.
        }
      }

      await Promise.all(replacedEvents.map((event) => eventApi.delete(sessionId, event.id)));
      const createdEvents = await Promise.all(
        nextAutoEvents.map((event) =>
          eventApi.create(sessionId, {
            trackId: event.trackId,
            timestamp: event.timestamp,
            startTime: event.startTime,
            endTime: event.endTime,
            type: event.type,
            note: event.note,
            autoDetected: event.autoDetected,
            verified: event.verified,
            confidence: event.confidence,
            linkedMarkId: event.linkedMarkId,
            metrics: event.metrics,
            reasonCodes: event.reasonCodes,
          }),
        ),
      );
      const keptEvents = events.filter(
        (event) => !replacedEvents.some((replaced) => replaced.id === event.id),
      );
      return [...keptEvents, ...createdEvents].sort((a, b) => a.timestamp - b.timestamp);
    },
    [currentWorkspace, events, sessionId],
  );

  const handleWindChange = useCallback(
    async (dir: number, speed: number) => {
      if (!session || !sessionId) {
        setManualWind({ dir, speed });
        return;
      }

      const wind = createManualGlobalWindInput(dir, speed, session.analysisInputs?.wind);
      const nextSession: Session = {
        ...session,
        analysisInputs: {
          ...session.analysisInputs,
          wind,
        },
        updatedAt: new Date().toISOString(),
      };

      setManualWind({ dir: wind.twd, speed: wind.speed ?? 0 });
      setSession(nextSession);

      const activeTrackIdForWind = activeTrack?.id ?? primaryTrackId;
      const activeTrackPoints = trackPointsById[activeTrackIdForWind] ?? telemetry;
      const promptMessage = hasEmbeddedWind(activeTrackPoints)
        ? `Manual wind set to ${Math.round(wind.twd)} deg. Recalculate unverified auto tack/gybe events for this track using the manual wind override?`
        : `Manual wind set to ${Math.round(wind.twd)} deg. This track has no embedded wind direction. Recalculate unverified auto tack/gybe events now?`;
      const shouldRecalculate = activeTrackPoints.length > 0 && window.confirm(promptMessage);

      if (!shouldRecalculate) {
        const persisted = await persistSessionSnapshot(nextSession);
        setSession(persisted);
        return;
      }

      const nextAutoEvents = buildDetectedWindEvents(
        sessionId,
        activeTrackIdForWind,
        activeTrackPoints,
        wind,
      );
      const { merged, replaced } = mergeWindRecalculatedEvents(
        events,
        nextAutoEvents,
        activeTrackIdForWind,
        primaryTrackId,
      );
      const finalEvents = await persistWindRecalculatedEvents(merged, replaced, nextAutoEvents);
      setEvents(finalEvents);

      const persisted = await persistSessionSnapshot({
        ...nextSession,
        eventCount: finalEvents.length,
      });
      setSession(persisted);
    },
    [
      activeTrack?.id,
      events,
      persistSessionSnapshot,
      persistWindRecalculatedEvents,
      primaryTrackId,
      session,
      sessionId,
      telemetry,
      trackPointsById,
    ],
  );

  const handleMarkMove = useCallback(
    async (markId: string, lat: number, lon: number) => {
      if (!sessionId) return;
      await markApi.update(sessionId, markId, { lat, lon });
      setMarks((prev) => prev.map((mark) => (mark.id === markId ? { ...mark, lat, lon } : mark)));
    },
    [sessionId],
  );

  const handleFocusEvent = useCallback((event: SessionEvent) => {
    const eventTrackId = resolveEventTrackId(event, primaryTrackId);
    setActiveTrackId(eventTrackId);
    setSelection((prev) => ({
      ...prev,
      eventId: event.id,
      markId: event.linkedMarkId ?? null,
      range: rangeFromEvent(event, eventTrackId, totalDuration),
    }));
    setCurrentTime(seekTimeFromEvent(event, totalDuration));
  }, [primaryTrackId, totalDuration]);

  const handleFocusMark = useCallback((mark: Mark) => {
    setSelection((prev) => ({
      ...prev,
      markId: mark.id,
      eventId: null,
    }));
  }, []);

  const handleRangeSelection = useCallback(
    (source: WorkspaceRangeSelection['source']) =>
      (range: { startRatio: number; endRatio: number } | null) => {
        if (range && workspaceDurationMs <= 0) return;
        const d = workspaceDurationMs;
        const nextRange = range
          ? {
              trackId: activeTrack?.id ?? primaryTrackId,
              startMs: Math.round(
                workspaceWindowEffective.startMs + range.startRatio * d,
              ),
              endMs: Math.round(workspaceWindowEffective.startMs + range.endRatio * d),
              source,
            }
          : null;
        setSelection((prev) => ({
          ...prev,
          range: nextRange,
        }));
        if (nextRange) {
          setCurrentTime(
            clamp(
              (nextRange.startMs + nextRange.endMs) / 2,
              workspaceWindowEffective.startMs,
              workspaceWindowEffective.endMs,
            ),
          );
        }
      },
    [
      activeTrack?.id,
      primaryTrackId,
      workspaceDurationMs,
      workspaceWindowEffective.endMs,
      workspaceWindowEffective.startMs,
    ],
  );

  const handleResizeStart = useCallback(
    (handle: DragHandle, event: React.PointerEvent<HTMLDivElement>) => {
      if (!isDesktopLayout) return;

      const containerWidth = workspaceRef.current?.clientWidth ?? 0;
      if (containerWidth <= 0) return;

      resizeStateRef.current = {
        handle,
        pointerId: event.pointerId,
        startX: event.clientX,
        startLeft: sidebarWidths.left,
        startRight: sidebarWidths.right,
        containerWidth,
      };
      resizeMovedRef.current = false;
      setActiveHandle(handle);
      event.preventDefault();
    },
    [isDesktopLayout, sidebarWidths.left, sidebarWidths.right],
  );

  const handleCollapseLeft = useCallback(() => {
    prevLeftWidthRef.current = sidebarWidths.left;
    setLeftCollapsed(true);
  }, [sidebarWidths.left]);

  const handleExpandLeft = useCallback(() => {
    setLeftCollapsed(false);
    setSidebarWidths((prev) => {
      const containerWidth = workspaceRef.current?.clientWidth ?? 0;
      if (containerWidth <= 0) return { ...prev, left: prevLeftWidthRef.current };
      const next = fitSidebarWidths(containerWidth, prevLeftWidthRef.current, prev.right);
      return { ...prev, left: next.left };
    });
  }, []);

  const handleCollapseRight = useCallback(() => {
    prevRightWidthRef.current = sidebarWidths.right;
    setRightCollapsed(true);
  }, [sidebarWidths.right]);

  const handleExpandRight = useCallback(() => {
    setRightCollapsed(false);
    setSidebarWidths((prev) => {
      const containerWidth = workspaceRef.current?.clientWidth ?? 0;
      if (containerWidth <= 0) return { ...prev, right: prevRightWidthRef.current };
      const next = fitSidebarWidths(containerWidth, prev.left, prevRightWidthRef.current);
      return { ...prev, right: next.right };
    });
  }, []);

  const clearLocalVideo = useCallback(() => {
    setLocalVideo((prev) => {
      if (prev) URL.revokeObjectURL(prev.objectUrl);
      return null;
    });
    setActiveVideoKey((prev) => (prev?.startsWith('local:') ? null : prev));
    setVideoStageError(null);
    setVideoClockMs(0);
    setVideoDurationMs(0);
    setVideoStageReady(false);
    setSyncSessionTimeMs(0);
    setSyncVideoTimeMs(0);
  }, []);

  const getDefaultOffsetForFile = useCallback(
    (file: File): number => {
      if (!session || totalDuration <= 0) return 0;
      return (
        tryComputeVideoOffsetFromWallClock(
          session,
          totalDuration,
          file.lastModified,
        ) ?? 0
      );
    },
    [session, totalDuration],
  );

  const getDefaultSyncForFile = useCallback(
    (file: File): VideoSyncBinding => {
      const wallClockOffsetMs =
        session && totalDuration > 0
          ? tryComputeVideoOffsetFromWallClock(session, totalDuration, file.lastModified)
          : null;
      if (session?.trackTimeOriginUnixMs != null && wallClockOffsetMs != null) {
        return createVideoSyncBindingFromAnchor(
          {
            videoTimeMs: 0,
            trackTimeMs: wallClockOffsetMs,
            realUnixMs: file.lastModified,
            source: 'auto-file-time',
            confidence: 'medium',
          },
          { trackTimeOriginUnixMs: session.trackTimeOriginUnixMs },
        );
      }
      const offsetMs = getDefaultOffsetForFile(file);
      return createOffsetOnlyVideoSync(offsetMs, {
        trackTimeOriginUnixMs: session?.trackTimeOriginUnixMs,
        source: 'manual-video-track',
        confidence: 'low',
      });
    },
    [getDefaultOffsetForFile, session, totalDuration],
  );

  const applyLocalVideoSelection = useCallback(
    (
      file: File,
      options?: {
        sourceKind?: LocalSessionVideo['sourceKind'];
        workspaceRelativePath?: string;
        label?: string;
        nextVideoType?: VideoType;
        nextOffsetMs?: number;
        nextSync?: VideoSyncBinding;
        promptReview?: boolean;
      },
    ) => {
      if (!sessionId) return;

      const signature = getLocalVideoSignature(file);
      const savedPrefs = loadLocalVideoPrefs(sessionId, signature);
      const objectUrl = URL.createObjectURL(file);

      const resolvedOffsetMs =
        options?.nextOffsetMs !== undefined
          ? options.nextOffsetMs
          : (savedPrefs?.offsetMs ?? getDefaultOffsetForFile(file));
      const resolvedSync = normalizeVideoSyncBinding(
        resolvedOffsetMs,
        options?.nextSync ?? savedPrefs?.sync ?? getDefaultSyncForFile(file),
        { trackTimeOriginUnixMs: session?.trackTimeOriginUnixMs },
      );

      const nextVideo: LocalSessionVideo = {
        file,
        objectUrl,
        signature,
        videoType: options?.nextVideoType ?? savedPrefs?.videoType ?? videoDraftType,
        offsetMs: resolvedSync.offsetMs,
        sync: resolvedSync,
        sourceKind: options?.sourceKind ?? 'file_picker',
        label: options?.label ?? file.name,
        workspaceRelativePath: options?.workspaceRelativePath,
      };

      setLocalVideo((prev) => {
        if (prev) URL.revokeObjectURL(prev.objectUrl);
        return nextVideo;
      });
      setActiveVideoKey(localVideoKey(nextVideo.signature));
      setVideoDraftType(nextVideo.videoType);
      setVideoControlError(null);
      setVideoStageError(null);
      setVideoClockMs(0);
      setVideoDurationMs(0);
      setVideoStageReady(false);
      setSyncSessionTimeMs(0);
      setSyncVideoTimeMs(0);
      setVideoNeedsReview(options?.promptReview ?? savedPrefs == null);
      setVideoDialogTab('recommended');
    },
    [getDefaultOffsetForFile, getDefaultSyncForFile, session?.trackTimeOriginUnixMs, sessionId, videoDraftType],
  );

  const saveWorkspaceVideoBinding = useCallback(
    async (input: {
      relativePath: string;
      fileName: string;
      label?: string;
      videoType: VideoType;
      offsetMs: number;
      sync?: VideoSyncBinding;
    }) => {
      if (!currentWorkspace || !sessionId) return;
      const sync = normalizeVideoSyncBinding(input.offsetMs, input.sync, {
        trackTimeOriginUnixMs: session?.trackTimeOriginUnixMs,
      });

      const videoBinding: WorkspaceVideoBinding = {
        path: `../../${input.relativePath.replace(/^\.?\//, '')}`,
        fileName: input.fileName,
        label: input.label,
        sourceKind: 'workspace_discovery',
        storageMode: 'workspace_relative_ref',
        videoType: input.videoType,
        offsetMs: sync.offsetMs,
        sync,
        copiedToWorkspace: false,
        confirmed: true,
        boundAt: new Date().toISOString(),
      };

      const nextVideos = [
        ...(sessionBindings?.videos.filter((video) => video.path !== videoBinding.path) ?? []),
        videoBinding,
      ];

      await saveLocalWorkspaceSessionVideoBindings(currentWorkspace.id, sessionId, nextVideos);
      setSessionBindings((prev) => ({
        track: prev?.track ?? null,
        videos: nextVideos,
      }));
    },
    [currentWorkspace, session?.trackTimeOriginUnixMs, sessionBindings?.videos, sessionId],
  );

  const removeWorkspaceVideoBinding = useCallback(
    async (relativePath: string) => {
      if (!currentWorkspace || !sessionId) return;
      const bindingPath = `../../${relativePath.replace(/^\.?\//, '')}`;
      const nextVideos =
        sessionBindings?.videos.filter((video) => video.path !== bindingPath) ?? [];
      await saveLocalWorkspaceSessionVideoBindings(
        currentWorkspace.id,
        sessionId,
        nextVideos,
      );
      setSessionBindings((prev) => ({
        track: prev?.track ?? null,
        videos: nextVideos,
      }));
    },
    [currentWorkspace, sessionBindings?.videos, sessionId],
  );

  const updateActiveSync = useCallback(
    async (nextSync: VideoSyncBinding) => {
      if (!sessionId || !activeVideo) return;
      const resolvedSync = normalizeVideoSyncBinding(nextSync.offsetMs, nextSync, {
        trackTimeOriginUnixMs: session?.trackTimeOriginUnixMs,
      });
      const nextOffsetMs = resolvedSync.offsetMs;

      if (activeVideo.origin === 'local') {
        setLocalVideo((prev) =>
          prev ? { ...prev, offsetMs: nextOffsetMs, sync: resolvedSync } : prev,
        );
        if (localVideo?.sourceKind === 'workspace' && localVideo.workspaceRelativePath) {
          try {
            await saveWorkspaceVideoBinding({
              relativePath: localVideo.workspaceRelativePath,
              fileName: localVideo.file.name,
              label: localVideo.label ?? localVideo.file.name,
              videoType: localVideo.videoType,
              offsetMs: nextOffsetMs,
              sync: resolvedSync,
            });
          } catch (error) {
            setVideoControlError(getErrorMessage(error));
          }
        }
        return;
      }

      setSessionVideos((prev) =>
        prev.map((video, index) =>
          (activeVideo.id ? video.id === activeVideo.id : index === 0)
            ? {
                ...video,
                offsetMs: nextOffsetMs,
                sync: resolvedSync,
                updatedAt: new Date().toISOString(),
              }
            : video,
        ),
      );

      try {
        const saved = await videoApi.sync(sessionId, {
          offsetMs: nextOffsetMs,
          sync: resolvedSync,
          videoId: activeVideo.id,
        });
        setSessionVideos((prev) =>
          prev.map((video, index) =>
            (saved.id ? video.id === saved.id : index === 0) ? saved : video,
          ),
        );
      } catch (error) {
        setVideoControlError(getErrorMessage(error));
      }
    },
    [activeVideo, localVideo, saveWorkspaceVideoBinding, session?.trackTimeOriginUnixMs, sessionId],
  );

  const updateActiveOffset = useCallback(
    async (nextOffsetMs: number) => {
      const nextSync = createOffsetOnlyVideoSync(Math.round(nextOffsetMs), {
        trackTimeOriginUnixMs: session?.trackTimeOriginUnixMs,
        source: 'manual-video-track',
        confidence: 'low',
      });
      await updateActiveSync(nextSync);
    },
    [session?.trackTimeOriginUnixMs, updateActiveSync],
  );

  const handleCommitVideoOffsetFromTimeline = useCallback(
    (ms: number, videoKey?: string) => {
      if (videoKey && videoKey !== activeVideo?.key) {
        const selected = videoSources.find((video) => video.key === videoKey) ?? null;
        if (selected) {
          selectActiveVideo(selected);
        }
      }
      void updateActiveOffset(Math.round(ms));
    },
    [activeVideo?.key, selectActiveVideo, updateActiveOffset, videoSources],
  );

  const handleLinkVideo = useCallback(async () => {
    if (!sessionId) return;
    const trimmed = videoDraftUrl.trim();
    if (!trimmed) {
      setVideoControlError('Enter a direct video URL before linking.');
      return;
    }

    try {
      new URL(trimmed, window.location.href);
    } catch {
      setVideoControlError('Enter a valid absolute or browser-resolvable URL.');
      return;
    }

    setVideoBusy(true);
    setVideoControlError(null);

    try {
      const initialSync = createOffsetOnlyVideoSync(0, {
        trackTimeOriginUnixMs: session?.trackTimeOriginUnixMs,
        source: 'manual-video-track',
        confidence: 'low',
      });
      const linked = await videoApi.link(sessionId, {
        videoUrl: trimmed,
        videoType: videoDraftType,
        label: deriveVideoLabelFromUrl(trimmed),
        offsetMs: initialSync.offsetMs,
        sync: initialSync,
      });
      setSessionVideos((prev) => [...prev, linked]);
      setActiveRemoteVideoId(linked.id ?? null);
      setActiveVideoKey(remoteVideoKey(linked));
      setVideoDraftUrl(linked.url);
      setVideoDraftType(linked.videoType);
      setVideoStageError(null);
      setVideoClockMs(0);
      setVideoDurationMs(0);
      setVideoStageReady(false);
      setSyncSessionTimeMs(0);
      setSyncVideoTimeMs(0);
      setVideoNeedsReview(true);
      setVideoDialogTab('recommended');
    } catch (error) {
      setVideoControlError(getErrorMessage(error));
    } finally {
      setVideoBusy(false);
    }
  }, [clearLocalVideo, session?.trackTimeOriginUnixMs, sessionId, videoDraftType, videoDraftUrl]);

  const handleSelectLocalVideo = useCallback(
    async (file: File) => {
      try {
        setVideoControlError(null);
        const signature = sessionId ? getLocalVideoSignature(file) : null;
        const savedPrefs =
          sessionId && signature ? loadLocalVideoPrefs(sessionId, signature) : null;
        const detected = savedPrefs ? null : await detectVideoTypeFromFile(file);
        applyLocalVideoSelection(file, {
          sourceKind: 'file_picker',
          label: file.name,
          nextVideoType: detected?.videoType,
          promptReview: true,
        });
      } catch (error) {
        setVideoControlError(getErrorMessage(error));
      }
    },
    [applyLocalVideoSelection, sessionId],
  );

  const loadWorkspaceVideoIntoPlayer = useCallback(
    async (
      relativePath: string,
      options?: {
        label?: string;
        nextVideoType?: VideoType;
        nextOffsetMs?: number;
        nextSync?: VideoSyncBinding;
        promptReview?: boolean;
      },
    ) => {
      if (!currentWorkspace) {
        throw new Error('No current workspace selected for this video binding.');
      }

      const file = await loadLocalWorkspaceVideoFile(
        currentWorkspace.id,
        relativePath,
      );
      const signature = getLocalVideoSignature(file);
      const savedPrefs = sessionId ? loadLocalVideoPrefs(sessionId, signature) : null;
      const detected = options?.nextVideoType || savedPrefs?.videoType
        ? null
        : await detectVideoTypeFromFile(file);
      const nextVideoType =
        options?.nextVideoType ?? savedPrefs?.videoType ?? detected?.videoType ?? videoDraftType;
      const nextOffsetMs =
        options?.nextOffsetMs ?? savedPrefs?.offsetMs ?? getDefaultOffsetForFile(file);
      const nextSync = normalizeVideoSyncBinding(
        nextOffsetMs,
        options?.nextSync ?? savedPrefs?.sync ?? getDefaultSyncForFile(file),
        { trackTimeOriginUnixMs: session?.trackTimeOriginUnixMs },
      );

      applyLocalVideoSelection(file, {
        sourceKind: 'workspace',
        workspaceRelativePath: relativePath,
        label: options?.label ?? file.name,
        nextVideoType,
        nextOffsetMs: nextSync.offsetMs,
        nextSync,
        promptReview: options?.promptReview,
      });
      await saveWorkspaceVideoBinding({
        relativePath,
        fileName: file.name,
        label: options?.label ?? file.name,
        videoType: nextVideoType,
        offsetMs: nextSync.offsetMs,
        sync: nextSync,
      });
    },
    [
      applyLocalVideoSelection,
      currentWorkspace,
      getDefaultOffsetForFile,
      getDefaultSyncForFile,
      saveWorkspaceVideoBinding,
      session?.trackTimeOriginUnixMs,
      sessionId,
      videoDraftType,
    ],
  );

  const handleSelectWorkspaceVideo = useCallback(
    async (video: WorkspaceVideoFileSummary) => {
      try {
        setVideoControlError(null);
        await loadWorkspaceVideoIntoPlayer(video.relativePath, {
          label: video.name,
          promptReview: true,
        });
        setIsVideoDialogOpen(false);
      } catch (error) {
        setVideoControlError(getErrorMessage(error));
      }
    },
    [loadWorkspaceVideoIntoPlayer],
  );

  useEffect(() => {
    if (!sessionId || hasAppliedPreboundVideoRef.current) return;

    const preboundVideo = replayNavigationState?.preboundVideo;
    if (!preboundVideo && !currentWorkspace) {
      hasAppliedPreboundVideoRef.current = true;
      return;
    }

    if (preboundVideo?.kind === 'workspace_video' && currentWorkspace) {
      hasAppliedPreboundVideoRef.current = true;
      void loadWorkspaceVideoIntoPlayer(preboundVideo.relativePath ?? '', {
        label: preboundVideo.label ?? preboundVideo.fileName,
        nextVideoType: preboundVideo.videoType,
        nextOffsetMs: preboundVideo.offsetMs,
        nextSync: preboundVideo.sync,
        promptReview: preboundVideo.promptSync,
      })
        .catch((error) => {
          setVideoControlError(getErrorMessage(error));
        })
        .finally(() => {
          navigate(`${location.pathname}${location.search}`, {
            replace: true,
            state: null,
          });
        });
      return;
    }

    if (preboundVideo?.kind === 'local_file' && preboundVideo.file) {
      hasAppliedPreboundVideoRef.current = true;
      applyLocalVideoSelection(preboundVideo.file, {
        sourceKind: 'file_picker',
        label: preboundVideo.label ?? preboundVideo.fileName,
        nextVideoType: preboundVideo.videoType,
        nextOffsetMs: preboundVideo.offsetMs,
        nextSync: preboundVideo.sync,
        promptReview: preboundVideo.promptSync,
      });
      navigate(`${location.pathname}${location.search}`, {
        replace: true,
        state: null,
      });
      return;
    }

    const workspaceBinding = sessionBindings?.videos[0];
    if (
      currentWorkspace &&
      workspaceBinding &&
      workspaceBinding.storageMode === 'workspace_relative_ref' &&
      workspaceBinding.path
    ) {
      hasAppliedPreboundVideoRef.current = true;
      void loadWorkspaceVideoIntoPlayer(
        getWorkspaceRelativeBindingPath(workspaceBinding.path),
        {
          label: workspaceBinding.label ?? workspaceBinding.fileName,
          nextVideoType: workspaceBinding.videoType,
          nextOffsetMs: workspaceBinding.offsetMs,
          nextSync: workspaceBinding.sync,
          promptReview: false,
        },
      ).catch((error) => {
        setVideoControlError(getErrorMessage(error));
      });
      return;
    }

    if (!preboundVideo && (!currentWorkspace || sessionBindingsLoaded)) {
      hasAppliedPreboundVideoRef.current = true;
    }
  }, [
    applyLocalVideoSelection,
    currentWorkspace,
    loadWorkspaceVideoIntoPlayer,
    location.pathname,
    location.search,
    navigate,
    replayNavigationState?.preboundVideo,
    sessionBindings,
    sessionBindingsLoaded,
    sessionId,
  ]);

  const handleChooseFile = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleOpenCompanionWindow = useCallback(() => {
    if (!sessionId) return;

    if (typeof BroadcastChannel === 'undefined') {
      setCompanionState('blocked');
      setVideoControlError('This browser does not support companion windows.');
      return;
    }

    setVideoControlError(null);
    setCompanionState('opening');

    const nextUrl = buildVideoCompanionUrl(window.location.href);
    const windowName = getVideoCompanionWindowName(sessionId);
    const companion = window.open(
      nextUrl,
      windowName,
      'popup=yes,width=1280,height=820,resizable=yes,scrollbars=no',
    );

    if (!companion) {
      setCompanionState('blocked');
      setVideoControlError('Browser blocked the companion window. Allow popups and retry.');
      return;
    }

    companion.focus();
    broadcastCompanionState();
    sendLocalVideoToCompanion();
  }, [
    broadcastCompanionState,
    sendLocalVideoToCompanion,
    sessionId,
  ]);

  const handleRemoveVideo = useCallback(async () => {
    if (!sessionId || !activeVideo) return;

    setVideoControlError(null);

    if (activeVideo.origin === 'local') {
      if (localVideo?.sourceKind === 'workspace' && localVideo.workspaceRelativePath) {
        try {
          await removeWorkspaceVideoBinding(localVideo.workspaceRelativePath);
        } catch (error) {
          setVideoControlError(getErrorMessage(error));
          return;
        }
      }
      clearLocalVideo();
      setVideoNeedsReview(false);
      return;
    }

    setVideoBusy(true);
    try {
      await videoApi.remove(sessionId, activeVideo.id);
      setSessionVideos((prev) => {
        const next = activeVideo.id
          ? prev.filter((video) => video.id !== activeVideo.id)
          : prev.slice(1);
        setActiveRemoteVideoId(next[0]?.id ?? null);
        setActiveVideoKey(next[0] ? remoteVideoKey(next[0]) : null);
        return next;
      });
      setVideoDraftUrl('');
      setVideoStageError(null);
      setVideoClockMs(0);
      setVideoDurationMs(0);
      setVideoStageReady(false);
      setSyncSessionTimeMs(0);
      setSyncVideoTimeMs(0);
      setVideoNeedsReview(false);
    } catch (error) {
      setVideoControlError(getErrorMessage(error));
    } finally {
      setVideoBusy(false);
    }
  }, [activeVideo, clearLocalVideo, localVideo, removeWorkspaceVideoBinding, sessionId]);

  const handleOpenSync = useCallback(() => {
    if (!activeVideo) return;
    resumeAfterSyncRef.current = isPlaying;
    setIsPlaying(false);
    setSyncSessionTimeMs(currentTime);
    setSyncVideoTimeMs(videoClockMs);
    setSyncDialogOpen(true);
    setVideoNeedsReview(false);
  }, [activeVideo, currentTime, isPlaying, videoClockMs]);

  const handleCloseSync = useCallback(() => {
    setCurrentTime(syncSessionTimeMs);
    setSyncDialogOpen(false);
    if (
      resumeAfterSyncRef.current &&
      totalDuration > 0 &&
      syncSessionTimeMs < totalDuration
    ) {
      setIsPlaying(true);
    }
    resumeAfterSyncRef.current = false;
  }, [syncSessionTimeMs, totalDuration]);

  const handleAlignCurrentFrame = useCallback(() => {
    const videoTimeMs = syncDialogOpen ? syncVideoTimeMs : videoClockMs;
    const trackTimeMs = syncDialogOpen ? syncSessionTimeMs : currentTime;
    const nextSync = createVideoSyncBindingFromAnchor(
      {
        videoTimeMs,
        trackTimeMs,
        source: 'manual-video-track',
        confidence: 'high',
      },
      { trackTimeOriginUnixMs: session?.trackTimeOriginUnixMs },
    );
    void updateActiveSync(nextSync);
  }, [
    currentTime,
    session?.trackTimeOriginUnixMs,
    syncDialogOpen,
    syncSessionTimeMs,
    syncVideoTimeMs,
    updateActiveSync,
    videoClockMs,
  ]);

  const handleBindVideoRealTime = useCallback(
    (realUnixMs: number) => {
      const trackTimeMs = trackTimeFromRealTime(realUnixMs, session?.trackTimeOriginUnixMs);
      if (trackTimeMs == null) {
        setVideoControlError('This track does not have a reliable wall-clock origin.');
        return;
      }
      if (trackTimeMs < 0 || trackTimeMs > totalDuration) {
        setVideoControlError('The selected real time falls outside the track duration.');
        return;
      }

      const videoTimeMs = syncDialogOpen ? syncVideoTimeMs : videoClockMs;
      const nextSync = createVideoSyncBindingFromAnchor(
        {
          videoTimeMs,
          trackTimeMs,
          realUnixMs,
          source: 'manual-video-realtime',
          confidence: 'high',
        },
        { trackTimeOriginUnixMs: session?.trackTimeOriginUnixMs },
      );
      setSyncSessionTimeMs(trackTimeMs);
      setCurrentTime(trackTimeMs);
      setVideoControlError(null);
      void updateActiveSync(nextSync);
    },
    [
      session?.trackTimeOriginUnixMs,
      syncDialogOpen,
      syncVideoTimeMs,
      totalDuration,
      updateActiveSync,
      videoClockMs,
    ],
  );

  const handleResetOffsetToDefault = useCallback(() => {
    const defaultSync = localVideo
      ? getDefaultSyncForFile(localVideo.file)
      : createOffsetOnlyVideoSync(0, {
          trackTimeOriginUnixMs: session?.trackTimeOriginUnixMs,
          source: 'manual-video-track',
          confidence: 'low',
        });
    void updateActiveSync(defaultSync);
  }, [getDefaultSyncForFile, localVideo, session?.trackTimeOriginUnixMs, updateActiveSync]);

  const handleSyncSessionSeek = useCallback(
    (timeMs: number) => {
      const nextTimeMs = Math.max(0, Math.min(timeMs, totalDuration));
      setSyncSessionTimeMs(nextTimeMs);
      setCurrentTime(nextTimeMs);
    },
    [totalDuration],
  );

  const handleSyncVideoSeek = useCallback(
    (timeMs: number) => {
      const nextTimeMs = Math.max(0, Math.min(timeMs, videoDurationMs || timeMs));
      setSyncVideoTimeMs(nextTimeMs);
    },
    [videoDurationMs],
  );

  const windDir = manualWind?.dir ?? (currentPoint ? getWindDir(currentPoint) : undefined);
  const windSpeed = manualWind?.speed ?? (currentPoint ? getWindSpeed(currentPoint) : undefined);

  const renderMapCanvas = useCallback(
    (viewportKey: string) => (
      <WorkspaceMapStage
        telemetry={telemetry}
        marks={marks}
        playheadIndex={playheadIndex}
        currentPoint={currentPoint}
        currentTimeMs={currentTime}
        windDir={windDir}
        windSpeed={windSpeed}
        mapLayer={mapLayer}
        onMapLayerChange={setMapLayer}
        onSnapshot={handleSnapshot}
        onAddEvent={handleAddEvent}
        onAddMark={handleAddMark}
        onWindChange={handleWindChange}
        onMarkMove={handleMarkMove}
        viewportKey={viewportKey}
        highlightRange={highlightedRange}
        routeClipRange={workspaceRouteClipRange}
        selectedEvent={selectedEvent}
        selectedMark={selectedMark}
        selectedRange={selection.range}
      />
    ),
    [
      currentPoint,
      currentTime,
      handleAddEvent,
      handleAddMark,
      handleMarkMove,
      handleSnapshot,
      handleWindChange,
      highlightedRange,
      mapLayer,
      marks,
      playheadIndex,
      selectedEvent,
      selectedMark,
      selection.range,
      telemetry,
      windDir,
      windSpeed,
      workspaceRouteClipRange,
    ],
  );

  const renderTelemetryStage = useCallback(
    () => (
      <WorkspaceTelemetryStage
        telemetry={telemetryWorkspace}
        totalDurationMs={workspaceDurationMs}
        playheadRatio={chartPlayheadRatio}
        onSeek={handleChartSeek}
        onRangeSelect={(source, range) => handleRangeSelection(source)(range)}
        selectedRangeForSource={chartSelectionRange}
        chartHeight={110}
        includeVmgToWind
        windDir={manualWind?.dir}
        headingColor={themeId === 'cyber' ? '#22c55e' : undefined}
      />
    ),
    [
      chartPlayheadRatio,
      chartSelectionRange,
      handleChartSeek,
      handleRangeSelection,
      manualWind?.dir,
      telemetryWorkspace,
      themeId,
      workspaceDurationMs,
    ],
  );

  const renderVideoStageFor = useCallback(
    (video: ActiveVideoSource | null, mode: WorkspaceMode, className = '') => {
      if (!video) {
        return (
          <div className={`flex h-full min-h-[280px] items-center justify-center bg-black p-6 ${className}`}>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-5 py-4 text-sm text-white/70">
              No video selected
            </div>
          </div>
        );
      }

      const durationMs = videoDurationsByKey[video.key] ?? 0;
      const rawVideoTimeMs = syncDialogOpen && video.key === activeVideo?.key
        ? syncVideoTimeMs
        : currentTime - video.offsetMs;
      const videoHasStarted = rawVideoTimeMs >= 0;
      const targetVideoTimeMs = syncDialogOpen && video.key === activeVideo?.key
        ? Math.max(0, Math.min(syncVideoTimeMs, durationMs || Number.MAX_SAFE_INTEGER))
        : Math.max(
            0,
            Math.min(
              currentTime - video.offsetMs,
              durationMs || Number.MAX_SAFE_INTEGER,
            ),
          );
      const completionNotice = !(syncDialogOpen && video.key === activeVideo?.key)
        ? !videoHasStarted
          ? `Video not started yet. Starts at session ${formatTimestamp(Math.max(0, video.offsetMs))}.`
          : currentTime < totalDuration && durationMs > 0 && rawVideoTimeMs >= durationMs
            ? 'Video ended before session replay.'
            : currentTime >= totalDuration &&
                totalDuration > 0 &&
                durationMs > 0 &&
                rawVideoTimeMs < durationMs
              ? 'Session replay ended before video.'
              : null
        : null;

      return (
        <SessionVideoStage
          key={`${video.key}:${video.url}:${video.videoType}`}
          videoType={video.videoType}
          sourceUrl={video.url}
          mediaLabel={video.label}
          targetTimeMs={targetVideoTimeMs}
          isPlaying={syncDialogOpen && video.key === activeVideo?.key ? false : isPlaying && videoHasStarted}
          playbackSpeed={playbackSpeed}
          crossOrigin={video.crossOrigin}
          className={className}
          overlay={
            <>
              <SessionVideoHud
                sessionName={session?.name ?? 'Session video'}
                mode={mode}
                currentTime={currentTime}
                currentPoint={currentPoint}
                windDir={windDir}
                windSpeed={windSpeed}
                nearestEvent={selectedEvent ?? nearestEvent}
                mediaLabel={video.label}
                completionNotice={completionNotice}
              />
              <WorkspaceLensLayer
                selectedEvent={selectedEvent}
                selectedMark={selectedMark}
                selectedRange={selection.range}
                currentPoint={currentPoint}
                currentTimeMs={currentTime}
                windDir={windDir}
                windSpeed={windSpeed}
                compact
                className="pt-28"
              />
            </>
          }
          onClockChange={(timeMs) => {
            setVideoClocksByKey((prev) => {
              if (!shouldStoreVideoClock(prev[video.key], timeMs)) return prev;
              return { ...prev, [video.key]: timeMs };
            });
            if (video.key === activeVideo?.key) {
              setVideoClockMs((prev) =>
                shouldStoreVideoClock(prev, timeMs) ? timeMs : prev,
              );
            }
          }}
          onDurationChange={(durationMs) => {
            setVideoDurationsByKey((prev) =>
              prev[video.key] === durationMs ? prev : { ...prev, [video.key]: durationMs },
            );
            if (video.key === activeVideo?.key) {
              setVideoDurationMs((prev) => (prev === durationMs ? prev : durationMs));
            }
          }}
          onReadyChange={setVideoStageReady}
          onErrorChange={setVideoStageError}
        />
      );
    },
    [
      activeVideo,
      currentPoint,
      currentTime,
      isPlaying,
      nearestEvent,
      playbackSpeed,
      selectedEvent,
      selectedMark,
      selection.range,
      session?.name,
      syncDialogOpen,
      syncVideoTimeMs,
      totalDuration,
      videoDurationsByKey,
      windDir,
      windSpeed,
    ],
  );

  const renderStageContent = useCallback(
    (content: WorkspaceStageContent, viewportKey: string) => {
      if (content === 'map') return renderMapCanvas(viewportKey);
      if (content === 'telemetry') return renderTelemetryStage();
      const videoKey = videoKeyFromStageContent(content);
      const video = videoSources.find((source) => source.key === videoKey) ?? null;
      return renderVideoStageFor(video, stageLayoutMode === 'split' ? 'split' : 'overlay', 'h-full');
    },
    [renderMapCanvas, renderTelemetryStage, renderVideoStageFor, stageLayoutMode, videoSources],
  );

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className={`${s.skeleton} w-16 h-16 rounded-full`} />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className={s.textSecondary}>Session not found</p>
      </div>
    );
  }

  const stats = session.stats;
  const distanceNm = stats.distance / 1852;
  const vmgToWind =
    currentPoint && windDir != null ? getVmgToWind(currentPoint, windDir) : undefined;
  const statsRows = [
    { label: 'Duration', val: formatDuration(stats.duration), unit: '' },
    { label: 'Distance', val: distanceNm.toFixed(1), unit: 'NM' },
    { label: 'Avg SOG', val: stats.avgSpeed.toFixed(1), unit: 'kts' },
    { label: 'Max SOG', val: stats.maxSpeed.toFixed(1), unit: 'kts' },
    { label: 'Turn Count', val: String(stats.turnCount), unit: '' },
    {
      label: 'Speed',
      val: currentPoint ? getSpeed(currentPoint).toFixed(1) : '--',
      unit: 'kts',
    },
    {
      label: 'Heading',
      val: currentPoint ? getHeading(currentPoint).toFixed(0) : '--',
      unit: 'deg',
    },
    {
      label: 'Wind Dir',
      val: windDir != null ? Math.round(windDir).toString() : '--',
      unit: 'deg',
    },
    {
      label: 'VMG to wind',
      val: vmgToWind != null ? vmgToWind.toFixed(1) : '--',
      unit: 'kts',
    },
  ];
  const metadataItems = [
    { key: 'date', label: 'Date', value: formatDate(session.date) },
    {
      key: 'location',
      label: 'Location',
      value: session.location || '',
    },
    {
      key: 'boat',
      label: 'Boat',
      value: session.boatType ?? '',
    },
    {
      key: 'team',
      label: 'Team',
      value: session.teamName ?? '',
    },
    { key: 'track', label: 'Track', value: `${distanceNm.toFixed(1)} NM` },
    {
      key: 'source',
      label: 'Source',
      value: '',
      tooltipValue: session.source === 'imported' ? 'Imported archive' : 'Connected session',
      icon: session.source === 'imported' ? Archive : Globe,
    },
  ].filter((item) => item.value || item.icon);
  const topBarMetadataItems = metadataItems.filter((item) =>
    ['date', 'location', 'track', 'source'].includes(item.key),
  );
  const liveCards = [
    {
      label: 'Speed',
      value: currentPoint ? `${getSpeed(currentPoint).toFixed(1)} kts` : '--',
    },
    {
      label: 'Heading',
      value: currentPoint ? `${getHeading(currentPoint).toFixed(0)} deg` : '--',
    },
    {
      label: 'Wind',
      value:
        windDir != null && windSpeed != null
          ? `${Math.round(windDir)} deg / ${windSpeed.toFixed(1)} kts`
          : 'No data',
    },
  ];
  const sectionLabelClass = `text-[11px] uppercase tracking-[0.18em] ${s.textSecondary}`;
  const surfaceClass = `${s.panel} rounded-none border-0 shadow-none`;
  const leftColWidth = leftCollapsed ? SIDEBAR_COLLAPSED_WIDTH : sidebarWidths.left;
  const rightColWidth = rightCollapsed ? SIDEBAR_COLLAPSED_WIDTH : sidebarWidths.right;
  const workspaceGridStyle = isDesktopLayout
    ? {
        gridTemplateColumns: `${leftColWidth}px 12px minmax(0,1fr) 12px ${rightColWidth}px`,
      }
    : undefined;
  const activeVideoSummary = activeVideo
    ? activeVideo.origin === 'local'
      ? `${
          localVideo?.sourceKind === 'workspace' ? 'Workspace video' : 'Local file'
        } · ${activeVideo.videoType === '360' ? '360' : 'Flat'}`
      : `Linked URL · ${activeVideo.videoType === '360' ? '360' : 'Flat'}`
    : 'No video attached';
  const videoFeedback = videoControlError ?? videoStageError;
  const activeVideoDefaultOffsetMs = localVideo
    ? getDefaultOffsetForFile(localVideo.file)
    : 0;
  const companionStatusMeta = (() => {
    switch (companionState) {
      case 'opening':
        return {
          label: 'Screen 2 opening',
          tone: `border ${s.divider} ${s.textSecondary}`,
        };
      case 'connected':
        return {
          label: 'Screen 2 connected',
          tone: 'border border-emerald-300/30 text-emerald-100',
        };
      case 'blocked':
        return {
          label: 'Screen 2 blocked',
          tone: 'border border-red-300/30 text-red-100',
        };
      case 'disconnected':
        return {
          label: 'Screen 2 disconnected',
          tone: 'border border-amber-300/30 text-amber-100',
        };
      default:
        return {
          label: 'Screen 2 closed',
          tone: `border ${s.divider} ${s.textSecondary}`,
        };
    }
  })();
  const companionStatusLabel = companionStatusMeta.label.replace('Screen 2 ', 'S2 ');
  const showTopBarLocation = topBarWidth >= 1420;
  const showTopBarSource = topBarWidth >= 1600;
  const showTopBarSessionTabs = topBarWidth >= 1480;
  const showTopBarVideoOffset = Boolean(activeVideo) && topBarWidth >= 1360;
  const showTopBarVideoOrigin = topBarWidth >= 1320;
  const videoStatusLabel = activeVideo
    ? `${videoSources.length} video${videoSources.length > 1 ? 's' : ''}`
    : 'No video';
  const videoStatusTitle = activeVideo
    ? `${activeVideo.label ?? 'Untitled video'} · ${activeVideoSummary} · Offset ${(
        activeVideo.offsetMs / 1000
      ).toFixed(1)}s`
    : activeVideoSummary;
  const companionDisabledReason =
    typeof BroadcastChannel === 'undefined'
      ? 'Browser unsupported'
      : null;

  return (
    <div
      className={`min-h-screen lg:h-screen w-full relative overflow-hidden transition-colors duration-500 ${s.wrapper}`}
    >
      {s.bgEffect && <div className={s.bgEffect} />}

      <main
        ref={workspaceRef}
        className="relative z-10 grid min-h-screen grid-cols-1 overflow-hidden lg:h-screen lg:grid-rows-[auto_minmax(0,1fr)_auto]"
        style={workspaceGridStyle}
      >
        <section
          className={`order-1 ${surfaceClass} border-b ${s.divider} lg:col-start-3 lg:row-start-1`}
        >
          <div className="flex h-full flex-col">
            <div
              ref={topBarRef}
              className="flex min-h-[64px] items-center gap-1.5 overflow-hidden px-3 py-2 whitespace-nowrap"
            >
              <Link
                to="/"
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-none border-0 ${s.buttonSecondary}`}
                title="Back to sessions"
              >
                <ChevronLeft className="h-5 w-5" />
              </Link>
              <div className="min-w-[130px] max-w-[205px] shrink">
                <p className={sectionLabelClass}>Metadata</p>
                <h1 className={`truncate text-base font-semibold md:text-lg ${s.textPrimary}`}>
                  {session.name}
                </h1>
              </div>

              {topBarMetadataItems.map((item) => {
                const visibilityClass =
                  item.key === 'location'
                    ? showTopBarLocation
                      ? 'inline-flex'
                      : 'hidden'
                    : item.key === 'source'
                      ? showTopBarSource
                        ? 'inline-flex'
                        : 'hidden'
                      : 'inline-flex';
                return (
                  <div
                    key={item.key}
                    className={`${visibilityClass} min-h-8 max-w-[130px] shrink-0 items-center gap-2 border ${s.divider} px-2 py-1.5 text-sm ${
                      isRound ? 'rounded-full' : 'rounded-sm'
                    }`}
                    title={item.tooltipValue ?? item.value}
                  >
                    {item.icon ? <item.icon className={`h-4 w-4 shrink-0 ${s.textSecondary}`} /> : null}
                    {item.value ? (
                      <span className={`truncate font-semibold ${s.textPrimary}`}>{item.value}</span>
                    ) : null}
                  </div>
                );
              })}

              <span
                className={`max-w-[86px] shrink-0 truncate rounded-full border ${s.divider} px-2.5 py-1 text-xs ${s.textSecondary}`}
                title={videoStatusTitle}
              >
                {videoStatusLabel}
              </span>
              {activeVideo && showTopBarVideoOffset ? (
                <span className={`inline-flex shrink-0 rounded-full border ${s.divider} px-3 py-1 text-xs ${s.textSecondary}`}>
                  Offset {(activeVideo.offsetMs / 1000).toFixed(1)}s
                </span>
              ) : null}
              {tracks.length > 1 ? (
                <label className="flex min-w-[150px] max-w-[210px] shrink-0 items-center gap-2">
                  <span className={sectionLabelClass}>Track</span>
                  <select
                    value={activeTrack?.id ?? ''}
                    onChange={(event) => {
                      setActiveTrackId(event.target.value);
                      setSelection((prev) => ({ ...prev, eventId: null, range: null }));
                    }}
                    className={`min-w-0 flex-1 rounded-lg px-2.5 py-1.5 text-sm ${s.input}`}
                  >
                    {tracks.map((track) => (
                      <option key={track.id} value={track.id}>
                        {track.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <span
                className={`shrink-0 rounded-full px-3 py-1 text-xs ${companionStatusMeta.tone}`}
                title={companionStatusMeta.label}
              >
                {companionStatusLabel}
              </span>
              <div className={`flex shrink-0 items-center rounded-lg border ${s.divider} p-0.5`}>
                {(['full', 'split'] as WorkspaceStageLayoutMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => {
                      setStageLayoutMode(mode);
                      setWorkspaceMode(mode === 'split' ? 'split' : 'data');
                    }}
                    className={`rounded-md px-2.5 py-1.5 text-sm transition ${
                      stageLayoutMode === mode ? s.buttonPrimary : s.buttonSecondary
                    }`}
                  >
                    {mode === 'full' ? 'Full' : 'Split'}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setIsVideoDialogOpen(true)}
                className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full border ${s.divider} px-2.5 py-1.5 text-sm ${s.textPrimary} transition-colors hover:bg-current/5`}
              >
                {activeVideo ? (
                  <>
                    <Film className="h-4 w-4" />
                    <span>Video</span>
                    {showTopBarVideoOrigin ? (
                      activeVideo.origin === 'local' ? (
                        <Upload className="h-3.5 w-3.5 opacity-70 ml-1" />
                      ) : (
                        <Link2 className="h-3.5 w-3.5 opacity-70 ml-1" />
                      )
                    ) : null}
                  </>
                ) : (
                  <>
                    <Film className="h-4 w-4" />
                    <span>Video</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={handleOpenCompanionWindow}
                disabled={Boolean(companionDisabledReason)}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1.5 text-sm ${
                  companionDisabledReason
                    ? `${s.buttonSecondary} cursor-not-allowed opacity-40`
                    : s.buttonSecondary
                }`}
                title={companionDisabledReason ?? 'Open Screen 2 surface'}
              >
                <Film className="h-4 w-4" />
                <span>Screen 2</span>
              </button>

              <div className="ml-auto flex min-w-0 shrink items-center gap-2">
                {showTopBarSessionTabs ? (
                  <SessionTabs
                    sessionId={sessionId}
                    compact
                    className="max-w-[220px]"
                  />
                ) : null}
                <Link
                  to="/settings"
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-none border-0 ${s.buttonSecondary}`}
                  title="Settings"
                >
                  <Settings className="h-4 w-4" />
                </Link>
              </div>
            </div>

                {activeVideo && videoNeedsReview ? (
                  <div className={`rounded-2xl border ${s.divider} px-4 py-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between`}>
                    <div className="min-w-0">
                      <div className={`text-sm font-semibold ${s.textPrimary}`}>
                        Video attached: {activeVideo.label ?? 'Untitled video'}
                      </div>
                      <div className={`text-xs ${s.textSecondary}`}>
                        Keep the current offset or open sync now to fine-tune alignment.
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setVideoNeedsReview(false)}
                        className={`px-3 py-2 text-sm ${s.buttonSecondary}`}
                      >
                        Use As-Is
                      </button>
                      <button
                        type="button"
                        onClick={handleOpenSync}
                        className={`px-3 py-2 text-sm ${s.buttonPrimary}`}
                      >
                        Adjust Sync Now
                      </button>
                    </div>
                  </div>
                ) : null}

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      void handleSelectLocalVideo(file);
                    }
                    event.currentTarget.value = '';
                  }}
                />
            </div>
        </section>

        <section
          ref={stageCanvasRef}
          className="order-2 flex min-h-[420px] flex-col lg:col-start-3 lg:row-start-2 lg:min-h-0"
        >
          {stageLayoutMode === 'split' ? (
            <div
              className="relative grid min-h-[420px] flex-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-px bg-black/20 lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]"
            >
              <div className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-black">
                <StageContentSelect
                  label="Left"
                  value={leftStageContent}
                  variant="overlay"
                  options={stageContentOptions}
                  themeStyles={s}
                  onChange={(content) => selectStageContent(content, setLeftStageContent)}
                />
                <div className="relative flex min-h-0 flex-1 overflow-hidden">
                  {renderStageContent(leftStageContent, `${sessionId ?? session.id}:split-left`)}
                </div>
              </div>
              <div className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-black">
                <StageContentSelect
                  label="Right"
                  value={rightStageContent}
                  variant="overlay"
                  options={stageContentOptions}
                  themeStyles={s}
                  onChange={(content) => selectStageContent(content, setRightStageContent)}
                />
                <div className="relative flex min-h-0 flex-1 overflow-hidden">
                  {renderStageContent(rightStageContent, `${sessionId ?? session.id}:split-right`)}
                </div>
              </div>
            </div>
          ) : (
            <div className="relative flex flex-1 min-h-[420px] flex-col overflow-hidden lg:min-h-0">
              <StageContentSelect
                label="Stage"
                value={primaryStageContent}
                variant="overlay"
                options={stageContentOptions}
                themeStyles={s}
                onChange={(content) => selectStageContent(content, setPrimaryStageContent)}
              />
              <div className="relative flex min-h-0 flex-1 overflow-hidden">
                {renderStageContent(primaryStageContent, `${sessionId ?? session.id}:full`)}
              </div>
            </div>
          )}
        </section>

        <Timeline
          className={`order-3 rounded-none border-0 border-t ${s.divider} shadow-none lg:col-start-3 lg:row-start-3 lg:min-h-0`}
          currentTime={currentTime}
          totalDuration={totalDuration}
          workspaceWindow={workspaceWindow}
          onChangeWorkspace={setWorkspaceWindow}
          videoOffsetMs={activeVideo?.offsetMs ?? 0}
          videoDurationMs={videoDurationMs}
          videoTracks={videoSources.map((video, index) => ({
            id: video.key,
            label: video.label ?? `Video ${index + 1}`,
            offsetMs: video.offsetMs,
            durationMs: videoDurationsByKey[video.key] ?? 0,
            active: activeVideo?.key === video.key,
          }))}
          draftVideoOffsetMs={draftOffsetMs}
          onDraftVideoOffset={setDraftOffsetMs}
          onCommitVideoOffset={handleCommitVideoOffsetFromTimeline}
          onSelectVideoTrack={(videoKey) => {
            const selected = videoSources.find((video) => video.key === videoKey) ?? null;
            selectActiveVideo(selected);
          }}
          showVideoTrack={videoSources.length > 0}
          isPlaying={isPlaying}
          playbackSpeed={playbackSpeed}
          workspaceEvents={workspaceEvents}
          onSelectEvent={handleFocusEvent}
          onTogglePlay={() => setIsPlaying((playing) => !playing)}
          onSeek={handleSeek}
          onSeekStart={handleSeekStart}
          onSeekEnd={handleSeekEnd}
          onSpeedChange={setPlaybackSpeed}
          onSkip={handleSkip}
          onOpenSync={handleOpenSync}
          syncDisabled={!activeVideo}
          syncLabel={
            !activeVideo
              ? 'No video'
              : videoStageReady
                ? 'Sync video'
                : 'Sync pending'
          }
        />

        <aside
          className={`order-4 flex min-h-[320px] flex-col ${surfaceClass} border-t ${s.divider} lg:order-none lg:col-start-1 lg:row-span-3 lg:min-h-0 lg:border-r lg:border-t-0 overflow-hidden ${
            leftCollapsed ? 'lg:!min-w-0' : ''
          }`}
        >
          {leftCollapsed && isDesktopLayout ? (
            <button
              type="button"
              onClick={handleExpandLeft}
              className={`group hidden lg:flex flex-col items-center justify-center w-full h-full min-h-[200px] cursor-pointer transition-colors ${s.textSecondary} hover:bg-current/10 hover:opacity-100`}
              title="Expand left sidebar"
              aria-label="Expand left sidebar"
            >
              <span className={`${EDGE_TOGGLE_TOOLTIP_CLASS} left-full ml-2`}>Expand left sidebar</span>
              <div className="flex items-center gap-1.5 h-full">
                <span className="w-0.5 h-8 bg-current opacity-70 rounded-full" />
                <span className="w-0.5 h-8 bg-current opacity-70 rounded-full" />
              </div>
            </button>
          ) : (
            <>
          <div className={`border-b ${s.divider} px-4 py-3 flex items-center justify-between gap-2`}>
            <div className="flex items-center justify-between gap-4 min-w-0 flex-1">
              <div className="flex gap-4">
                <button
                  onClick={() => setSidebarTab('events')}
                  className={`border-b-2 pb-2 text-sm font-bold transition-colors ${
                    sidebarTab === 'events'
                      ? `${s.accent} border-current`
                      : `${s.textSecondary} border-transparent`
                  }`}
                >
                  Events
                </button>
                <button
                  onClick={() => setSidebarTab('marks')}
                  className={`border-b-2 pb-2 text-sm font-bold transition-colors ${
                    sidebarTab === 'marks'
                      ? `${s.accent} border-current`
                      : `${s.textSecondary} border-transparent`
                  }`}
                >
                  Marks
                </button>
              </div>
              <span className={`text-xs ${s.textSecondary}`}>
                {sidebarTab === 'events'
                  ? `${workspaceEvents.length} items`
                  : `${marks.length} items`}
              </span>
            </div>
            <button
              type="button"
              onClick={handleCollapseLeft}
              className={`shrink-0 p-1 rounded transition-colors ${s.textSecondary} hover:bg-current/10 lg:flex hidden`}
              title="Collapse left sidebar"
              aria-label="Collapse left sidebar"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {sidebarTab === 'events' &&
              workspaceEvents.map((event) => {
                const isActive =
                  selection.eventId === event.id ||
                  Math.abs(event.timestamp - currentTime) < EVENT_ACTIVE_WINDOW_MS;
                return (
                  <div
                    key={event.id}
                    onClick={() => handleFocusEvent(event)}
                    className={`cursor-pointer border-b ${s.divider} border-l-2 px-4 py-3 transition-colors group ${
                      isActive
                        ? `border-current bg-current/10 ${s.accent}`
                        : `border-transparent hover:bg-current/5`
                    }`}
                  >
                    <div className={`mb-1 text-xs ${isActive ? s.accent : s.textSecondary}`}>
                      {formatEventTimeLabel(event)} / {formatEventMeta(event)}
                    </div>
                    <div
                      className={`font-medium transition-transform group-hover:translate-x-1 ${s.textPrimary}`}
                    >
                      {event.note}
                    </div>
                    {event.metrics?.speedLoss != null || event.metrics?.headingChange != null ? (
                      <div className={`mt-1 text-xs ${s.textSecondary}`}>
                        {event.metrics?.headingChange != null
                          ? `HDG ${Math.round(event.metrics.headingChange)} deg`
                          : ''}
                        {event.metrics?.headingChange != null && event.metrics?.speedLoss != null
                          ? ' / '
                          : ''}
                        {event.metrics?.speedLoss != null
                          ? `Loss ${event.metrics.speedLoss.toFixed(1)} kts`
                          : ''}
                      </div>
                    ) : null}
                  </div>
                );
              })}

            {sidebarTab === 'marks' &&
              marks.map((mark) => (
                <div
                  key={mark.id}
                  onClick={() => handleFocusMark(mark)}
                  className={`cursor-pointer border-b ${s.divider} border-l-2 px-4 py-3 transition-colors group hover:bg-current/5 ${
                    selection.markId === mark.id ? `border-current bg-current/10 ${s.accent}` : 'border-transparent'
                  }`}
                >
                  <div className={`mb-1 text-xs ${s.textSecondary}`}>{mark.type}</div>
                  <div
                    className={`font-medium transition-transform group-hover:translate-x-1 ${s.textPrimary}`}
                  >
                    {mark.name ?? mark.type}
                  </div>
                  <div className={`mt-1 text-xs ${s.textSecondary}`}>
                    {mark.lat.toFixed(4)}, {mark.lon.toFixed(4)}
                  </div>
                </div>
              ))}

            {sidebarTab === 'events' && workspaceEvents.length === 0 && (
              <p className={`px-4 py-6 text-center text-sm ${s.textSecondary}`}>
                No events in workspace
              </p>
            )}
            {sidebarTab === 'marks' && marks.length === 0 && (
              <p className={`px-4 py-6 text-center text-sm ${s.textSecondary}`}>No marks yet</p>
            )}
          </div>

          <div className={`border-t ${s.divider}`}>
            <button
              onClick={sidebarTab === 'events' ? handleAddEvent : handleAddMark}
              className={`flex w-full items-center justify-center gap-2 rounded-none border-0 py-4 ${s.accentBg}`}
            >
              <Flag className="h-4 w-4" />
              {sidebarTab === 'events' ? 'Add Event' : 'Add Mark'}
            </button>
          </div>
            </>
          )}
        </aside>

        <div
          className={`group relative hidden touch-none cursor-col-resize lg:flex lg:col-start-2 lg:row-span-3 ${
            leftCollapsed ? 'lg:hidden' : ''
          } ${
            activeHandle === 'left' ? `${s.accent} bg-current/10` : `${s.textSecondary} hover:bg-current/5`
          }`}
          onPointerDown={(event) => handleResizeStart('left', event)}
          onClick={() => {
            if (resizeMovedRef.current) {
              resizeMovedRef.current = false;
              return;
            }
            handleCollapseLeft();
          }}
          role="separator"
          title="Collapse left sidebar"
          aria-label="Resize or collapse left sidebar"
          aria-orientation="vertical"
        >
          <span className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-current opacity-50" />
          <span className={`${EDGE_TOGGLE_TOOLTIP_CLASS} left-full ml-2`}>Collapse left sidebar</span>
        </div>

        <div
          className={`group relative hidden touch-none cursor-col-resize lg:flex lg:col-start-4 lg:row-span-3 ${
            rightCollapsed ? 'lg:hidden' : ''
          } ${
            activeHandle === 'right'
              ? `${s.accent} bg-current/10`
              : `${s.textSecondary} hover:bg-current/5`
          }`}
          onPointerDown={(event) => handleResizeStart('right', event)}
          onClick={() => {
            if (resizeMovedRef.current) {
              resizeMovedRef.current = false;
              return;
            }
            handleCollapseRight();
          }}
          role="separator"
          title="Collapse right sidebar"
          aria-label="Resize or collapse right sidebar"
          aria-orientation="vertical"
        >
          <span className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-current opacity-50" />
          <span className={`${EDGE_TOGGLE_TOOLTIP_CLASS} right-full mr-2`}>Collapse right sidebar</span>
        </div>

        <aside
          className={`order-5 flex min-h-[360px] flex-col ${surfaceClass} border-t ${s.divider} lg:order-none lg:col-start-5 lg:row-span-3 lg:min-h-0 lg:border-l lg:border-t-0 overflow-hidden ${
            rightCollapsed ? 'lg:!min-w-0' : ''
          }`}
        >
          {rightCollapsed && isDesktopLayout ? (
            <button
              type="button"
              onClick={handleExpandRight}
              className={`group hidden lg:flex flex-col items-center justify-center w-full h-full min-h-[200px] cursor-pointer transition-colors ${s.textSecondary} hover:bg-current/10 hover:opacity-100`}
              title="Expand right sidebar"
              aria-label="Expand right sidebar"
            >
              <span className={`${EDGE_TOGGLE_TOOLTIP_CLASS} right-full mr-2`}>Expand right sidebar</span>
              <div className="flex items-center gap-1.5 h-full">
                <span className="w-0.5 h-8 bg-current opacity-70 rounded-full" />
                <span className="w-0.5 h-8 bg-current opacity-70 rounded-full" />
              </div>
            </button>
          ) : (
            <>
          <div className={`flex items-center justify-between border-b ${s.divider} px-4 py-3`}>
            <div>
              <p className={sectionLabelClass}>Right Sidebar</p>
              <h3 className={`text-lg font-semibold ${s.textPrimary}`}>Session stats</h3>
            </div>
            <div className="flex items-center gap-2">
            <button onClick={() => setStatsCollapsed((collapsed) => !collapsed)} className="flex items-center gap-2">
              <span className={`text-sm ${s.textSecondary}`}>
                {statsCollapsed ? 'Expand' : 'Collapse'}
              </span>
              {statsCollapsed ? (
                <ChevronDown className={`h-4 w-4 ${s.textSecondary}`} />
              ) : (
                <ChevronUp className={`h-4 w-4 ${s.textSecondary}`} />
              )}
            </button>
            <button
              type="button"
              onClick={handleCollapseRight}
              className={`shrink-0 p-1 rounded transition-colors ${s.textSecondary} hover:bg-current/10 lg:flex hidden`}
              title="Collapse right sidebar"
              aria-label="Collapse right sidebar"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            </div>
          </div>

          {!statsCollapsed && (
            <div className={`grid grid-cols-2 border-b ${s.divider}`}>
              {statsRows.map((stat, index) => (
                <div
                  key={stat.label}
                  className={`flex min-h-[88px] flex-col items-center justify-center px-3 py-3 text-center ${
                    index % 2 === 0 ? `border-r ${s.divider}` : ''
                  } ${index < statsRows.length - 1 ? `border-b ${s.divider}` : ''}`}
                >
                  <span className={`mb-1 text-xs ${s.textSecondary}`}>{stat.label}</span>
                  <span className={`text-lg font-bold ${s.textPrimary}`}>
                    {stat.val}{' '}
                    <span className="text-xs font-normal opacity-70">{stat.unit}</span>
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="flex min-h-0 flex-1 flex-col">
            <div className={`border-b ${s.divider} px-4 py-3`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className={sectionLabelClass}>Telemetry</p>
                  <h3 className={`text-lg font-semibold ${s.textPrimary}`}>Live data</h3>
                </div>
                <Activity className={`h-4 w-4 ${s.textSecondary}`} />
              </div>
            </div>

            <div className={`grid grid-cols-3 border-b ${s.divider}`}>
              {liveCards.map((card, index) => (
                <div
                  key={card.label}
                  className={`min-w-0 px-3 py-3 ${index < liveCards.length - 1 ? `border-r ${s.divider}` : ''}`}
                >
                  <p className={`text-[10px] uppercase tracking-[0.14em] ${s.textSecondary}`}>
                    {card.label}
                  </p>
                  <p className={`truncate text-sm font-semibold ${s.textPrimary}`}>
                    {card.value}
                  </p>
                </div>
              ))}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              <div className="mb-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-white/55">
                  <Film className="h-3.5 w-3.5" />
                  <span>Video status</span>
                </div>
                <div className={`text-sm font-semibold ${s.textPrimary}`}>
                  {activeVideo ? activeVideoSummary : 'Data-only replay'}
                </div>
                {activeVideo ? (
                  <div className={`mt-1 text-xs ${s.textSecondary}`}>
                    {activeVideo.label ?? activeVideo.url}
                  </div>
                ) : null}
              </div>

              <WorkspaceTelemetryStage
                telemetry={telemetryWorkspace}
                totalDurationMs={workspaceDurationMs}
                playheadRatio={chartPlayheadRatio}
                onSeek={handleChartSeek}
                onRangeSelect={(source, range) => handleRangeSelection(source)(range)}
                selectedRangeForSource={chartSelectionRange}
                chartHeight={82}
                className="!h-auto !overflow-visible !p-0"
                includeVmgToWind
                windDir={manualWind?.dir}
                headingColor={themeId === 'cyber' ? '#22c55e' : undefined}
              />
            </div>
          </div>
            </>
          )}
        </aside>

        {activeVideo ? (
          <VideoSyncDialog
            isOpen={syncDialogOpen}
            offsetMs={activeVideo.offsetMs}
            sessionTimeMs={syncDialogOpen ? syncSessionTimeMs : currentTime}
            videoTimeMs={syncDialogOpen ? syncVideoTimeMs : videoClockMs}
            totalDurationMs={totalDuration}
            videoDurationMs={videoDurationMs}
            trackTimeOriginUnixMs={session?.trackTimeOriginUnixMs}
            anchorCount={activeVideo.sync?.anchors.length ?? 0}
            onClose={handleCloseSync}
            onAlignCurrentFrame={handleAlignCurrentFrame}
            onBindVideoRealTime={handleBindVideoRealTime}
            onAdjustOffset={(deltaMs) => {
              void updateActiveOffset(activeVideo.offsetMs + deltaMs);
            }}
            onResetOffset={handleResetOffsetToDefault}
            onSessionSeek={handleSyncSessionSeek}
            onVideoSeek={handleSyncVideoSeek}
          />
        ) : null}

        {isVideoDialogOpen && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className={`${s.panel} w-full max-w-3xl p-6 flex flex-col gap-5 relative`} onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <div>
                  <h3 className={`text-lg font-semibold ${s.textPrimary}`}>
                    {activeVideo ? 'Manage Video' : 'Bind Video'}
                  </h3>
                  <p className={`mt-1 text-sm ${s.textSecondary}`}>
                    Choose a recommended workspace video, bind a local file, or link a URL.
                  </p>
                </div>
                <button onClick={() => setIsVideoDialogOpen(false)} className={`p-1 hover:bg-current/10 rounded-full transition-colors ${s.textSecondary}`}>
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className={`rounded-2xl border ${s.divider} p-4 flex flex-col gap-3`}>
                <div className="flex flex-wrap items-center gap-3">
                  <div className={`rounded-full border ${s.divider} px-3 py-1 text-xs ${s.textSecondary}`}>
                    {activeVideoSummary}
                  </div>
                  {activeVideo ? (
                    <div className={`rounded-full border ${s.divider} px-3 py-1 text-xs ${s.textSecondary}`}>
                      Offset {(activeVideo.offsetMs / 1000).toFixed(1)}s
                    </div>
                  ) : null}
                  {localVideo?.workspaceRelativePath ? (
                    <div className={`rounded-full border ${s.divider} px-3 py-1 text-xs ${s.textSecondary}`}>
                      {localVideo.workspaceRelativePath}
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-col gap-2">
                  <label className={`text-xs uppercase tracking-wider ${s.textSecondary}`}>Video Type</label>
                  <select
                    value={videoDraftType}
                    onChange={(event) => setVideoDraftType(event.target.value as VideoType)}
                    className={`w-full px-3 py-2 text-sm rounded-lg ${s.input}`}
                  >
                    <option value="flat">Flat video</option>
                    <option value="360">360 video</option>
                  </select>
                </div>
              </div>

              <div className={`flex flex-wrap gap-2 ${s.panel} p-1`}>
                {(
                  [
                    ['recommended', 'Recommended'],
                    ['workspace', 'Workspace Videos'],
                    ['local', 'Local File'],
                    ['url', 'Link URL'],
                  ] as const
                ).map(([tabId, label]) => (
                  <button
                    key={tabId}
                    type="button"
                    onClick={() => setVideoDialogTab(tabId)}
                    className={`px-4 py-2 text-sm transition-all ${
                      videoDialogTab === tabId
                        ? `${s.accentBg} font-medium`
                        : `${s.textSecondary} hover:opacity-70`
                    } ${tabId !== 'workspace' && tabId !== 'recommended' ? (isRound ? 'rounded-xl' : 'rounded-sm') : isRound ? 'rounded-xl' : 'rounded-sm'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
                <div className={`rounded-2xl border ${s.divider} p-4 flex flex-col gap-4 min-h-[320px]`}>
                  {videoDialogTab === 'recommended' ? (
                    recommendedWorkspaceVideos.length > 0 ? (
                      <div className="grid gap-2">
                        {recommendedWorkspaceVideos.map((video) => (
                          <button
                            key={video.relativePath}
                            type="button"
                            onClick={() => void handleSelectWorkspaceVideo(video)}
                            className={`flex items-center justify-between gap-3 px-3 py-3 text-left transition-all ${
                              localVideo?.workspaceRelativePath === video.relativePath
                                ? `${s.accentBg}`
                                : s.buttonSecondary
                            } ${isRound ? 'rounded-xl' : 'rounded-sm'}`}
                          >
                            <div className="min-w-0">
                              <div className={`truncate text-sm font-medium ${s.textPrimary}`}>
                                {video.name}
                              </div>
                              <div className={`text-xs ${s.textSecondary}`}>
                                {video.relativePath}
                              </div>
                            </div>
                            <span className={`shrink-0 text-xs ${s.textSecondary}`}>Recommended</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className={`text-sm ${s.textSecondary}`}>
                        No recommended workspace videos matched this session yet. Try the
                        full workspace list or choose a local file.
                      </div>
                    )
                  ) : null}

                  {videoDialogTab === 'workspace' ? (
                    workspaceVideoLoading ? (
                      <div className="grid gap-2">
                        {[1, 2, 3].map((item) => (
                          <div key={item} className={`${s.skeleton} h-16`} />
                        ))}
                      </div>
                    ) : workspaceVideoFiles.length > 0 ? (
                      <div className="grid gap-2 max-h-[340px] overflow-y-auto">
                        {[...recommendedWorkspaceVideos, ...otherWorkspaceVideos].map((video) => (
                          <button
                            key={video.relativePath}
                            type="button"
                            onClick={() => void handleSelectWorkspaceVideo(video)}
                            className={`flex items-center justify-between gap-3 px-3 py-3 text-left transition-all ${
                              localVideo?.workspaceRelativePath === video.relativePath
                                ? `${s.accentBg}`
                                : s.buttonSecondary
                            } ${isRound ? 'rounded-xl' : 'rounded-sm'}`}
                          >
                            <div className="min-w-0">
                              <div className={`truncate text-sm font-medium ${s.textPrimary}`}>
                                {video.name}
                              </div>
                              <div className={`text-xs ${s.textSecondary}`}>
                                {video.relativePath}
                              </div>
                            </div>
                            <span className={`shrink-0 text-xs ${s.textSecondary}`}>
                              {video.collection === 'incoming' ? 'Incoming' : 'Library'}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className={`text-sm ${s.textSecondary}`}>
                        No workspace videos found in incoming/video or library/video.
                      </div>
                    )
                  ) : null}

                  {videoDialogTab === 'local' ? (
                    <div className="flex flex-col gap-4">
                      <p className={`text-sm ${s.textSecondary}`}>
                        Bind a local file for this browser session. This is fast, but less
                        portable than binding a workspace video.
                      </p>
                      <button
                        type="button"
                        onClick={handleChooseFile}
                        className={`flex items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm ${s.buttonSecondary}`}
                      >
                        <Upload className="h-4 w-4" />
                        {localVideo ? 'Replace Local File' : 'Choose Local File'}
                      </button>
                    </div>
                  ) : null}

                  {videoDialogTab === 'url' ? (
                    <div className="flex flex-col gap-3">
                      <label className={`text-xs uppercase tracking-wider ${s.textSecondary}`}>Link URL</label>
                      <input
                        type="url"
                        value={videoDraftUrl}
                        onChange={(event) => setVideoDraftUrl(event.target.value)}
                        placeholder="https://example.com/session-video.mp4"
                        className={`w-full px-3 py-2 text-sm rounded-lg ${s.input}`}
                      />
                      <button
                        type="button"
                        onClick={handleLinkVideo}
                        disabled={videoBusy}
                        className={`flex items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm ${s.buttonSecondary} ${
                          videoBusy ? 'opacity-50 cursor-wait' : ''
                        }`}
                      >
                        {videoBusy ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Link2 className="h-4 w-4" />
                        )}
                        Link Video URL
                      </button>
                    </div>
                  ) : null}

                  {workspaceVideoError ? (
                    <div className="rounded-lg border border-red-300/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                      {workspaceVideoError}
                    </div>
                  ) : null}
                  {videoFeedback ? (
                    <div className="rounded-lg border border-red-300/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                      {videoFeedback}
                    </div>
                  ) : null}
                </div>

                <div className={`rounded-2xl border ${s.divider} p-4 flex flex-col gap-4`}>
                  {boundWorkspaceVideoBindings.length > 0 || sessionVideos.length > 0 ? (
                    <div>
                      <p className={`text-xs uppercase tracking-wider ${s.textSecondary}`}>
                        Bound Videos
                      </p>
                      <div className="mt-2 flex max-h-44 flex-col gap-2 overflow-y-auto">
                        {boundWorkspaceVideoBindings.map((binding) => {
                          const relativePath = getWorkspaceRelativeBindingPath(binding.path);
                          const isActive =
                            localVideo?.sourceKind === 'workspace' &&
                            localVideo.workspaceRelativePath === relativePath;
                          return (
                            <button
                              key={binding.path}
                              type="button"
                              onClick={() => {
                                void loadWorkspaceVideoIntoPlayer(relativePath, {
                                  label: binding.label ?? binding.fileName,
                                  nextVideoType: binding.videoType,
                                  nextOffsetMs: binding.offsetMs,
                                  nextSync: binding.sync,
                                  promptReview: false,
                                });
                              }}
                              className={`px-3 py-2 text-left text-xs transition-colors ${
                                isActive ? s.accentBg : s.buttonSecondary
                              } ${isRound ? 'rounded-xl' : 'rounded-sm'}`}
                            >
                              <div className={`truncate font-medium ${s.textPrimary}`}>
                                {binding.label ?? binding.fileName}
                              </div>
                              <div className={`truncate ${s.textSecondary}`}>
                                Workspace · {(binding.offsetMs / 1000).toFixed(1)}s
                              </div>
                            </button>
                          );
                        })}
                        {sessionVideos.map((video, index) => {
                          const isActive =
                            activeVideo?.origin === 'remote' &&
                            (video.id ? activeVideo.id === video.id : index === 0);
                          return (
                            <button
                              key={video.id ?? `${video.url}:${index}`}
                              type="button"
                              onClick={() => {
                                setActiveRemoteVideoId(video.id ?? null);
                                setActiveVideoKey(remoteVideoKey(video));
                                setVideoDraftUrl(video.url);
                                setVideoDraftType(video.videoType);
                                setVideoStageError(null);
                                setVideoClockMs(0);
                                setVideoDurationMs(0);
                                setVideoStageReady(false);
                                setSyncSessionTimeMs(0);
                                setSyncVideoTimeMs(0);
                              }}
                              className={`px-3 py-2 text-left text-xs transition-colors ${
                                isActive ? s.accentBg : s.buttonSecondary
                              } ${isRound ? 'rounded-xl' : 'rounded-sm'}`}
                            >
                              <div className={`truncate font-medium ${s.textPrimary}`}>
                                {video.label ?? video.url}
                              </div>
                              <div className={`truncate ${s.textSecondary}`}>
                                Linked URL · {(video.offsetMs / 1000).toFixed(1)}s
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  <div>
                    <p className={`text-xs uppercase tracking-wider ${s.textSecondary}`}>
                      Current Video Status
                    </p>
                    <div className={`mt-2 text-sm font-semibold ${s.textPrimary}`}>
                      {activeVideo ? activeVideo.label ?? activeVideo.url : 'No video attached'}
                    </div>
                    <div className={`mt-1 text-xs ${s.textSecondary}`}>
                      {activeVideoSummary}
                    </div>
                  </div>

                  <div className={`rounded-xl ${s.accentBg} p-3 text-sm ${s.textSecondary}`}>
                    Bind in Replay, then use Sync to confirm alignment. Workspace videos are
                    preferred because they can be recovered from the current workspace.
                  </div>

                  {activeVideo ? (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setIsVideoDialogOpen(false);
                          handleOpenSync();
                        }}
                        className={`px-4 py-2 text-sm ${s.buttonPrimary}`}
                      >
                        Adjust Sync Now
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setVideoNeedsReview(false);
                          setIsVideoDialogOpen(false);
                        }}
                        className={`px-4 py-2 text-sm ${s.buttonSecondary}`}
                      >
                        Keep Current Offset
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void handleResetOffsetToDefault();
                          setVideoNeedsReview(false);
                        }}
                        disabled={
                          videoBusy || activeVideo.offsetMs === activeVideoDefaultOffsetMs
                        }
                        className={`px-4 py-2 text-sm ${s.buttonSecondary} ${
                          videoBusy || activeVideo.offsetMs === activeVideoDefaultOffsetMs
                            ? 'opacity-50 cursor-not-allowed'
                            : ''
                        }`}
                      >
                        Reset to Default Offset
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void handleRemoveVideo();
                          setIsVideoDialogOpen(false);
                        }}
                        disabled={videoBusy}
                        className={`flex items-center justify-center gap-2 px-4 py-2 text-sm border border-red-500/30 text-red-500 hover:bg-red-500/10 transition-colors ${
                          videoBusy ? 'opacity-50 cursor-wait' : ''
                        }`}
                      >
                        <Trash2 className="h-4 w-4" />
                        Remove Video
                      </button>
                    </>
                  ) : (
                    <div className={`text-sm ${s.textSecondary}`}>
                      Once a video is attached, you can confirm or refine sync here.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
