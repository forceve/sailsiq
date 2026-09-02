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
  Columns2,
  Rows2,
  Plus,
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
import SessionSummaryCard from '@/components/SessionSummaryCard';
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
import {
  getVideoFileWallClockStartMs,
  tryComputeVideoOffsetFromWallClock,
} from '@/utils/videoAutoOffset';
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
  TelemetryDataset,
  VideoPlacementConfidence,
  VideoPlacementSource,
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
  getLocalWorkspaceSessionBindings,
  getLocalWorkspaceSessionShell,
  getWorkspaceRelativeBindingPath,
  importLocalWorkspaceTelemetryFile,
  listLocalWorkspaceVideoFiles,
  loadLocalWorkspaceTelemetryDatasetsInChunks,
  loadLocalWorkspaceTrackPointsInChunks,
  loadLocalWorkspaceVideoFile,
  parseLocalTelemetryFile,
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
  videoTrackId: string;
  videoTrackName: string;
  url: string;
  label?: string;
  videoType: VideoType;
  offsetMs: number;
  sync?: VideoSyncBinding;
  placementSource?: VideoPlacementSource;
  placementConfidence?: VideoPlacementConfidence;
  signature?: string;
  crossOrigin?: '' | 'anonymous';
}

interface VideoTimelineClip {
  source: ActiveVideoSource;
  durationMs: number;
}

interface VideoTimelineTrack {
  id: string;
  label: string;
  clips: VideoTimelineClip[];
}

interface VideoTrackDraft {
  id: string;
  name: string;
  videoType: VideoType;
}

interface ManagedVideoTrack extends VideoTimelineTrack {
  videoType: VideoType;
  draftOnly: boolean;
}

interface VideoTrackTarget {
  id: string;
  name: string;
}

interface VideoPlacement {
  offsetMs: number;
  placementSource: VideoPlacementSource;
  placementConfidence: VideoPlacementConfidence;
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
const PLAYBACK_STATE_UPDATE_MS = 50;
const DEFAULT_VIDEO_TRACK_ID = 'video-track-main';
const NEW_VIDEO_TRACK_OPTION = '__new_video_track__';
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

function createVideoTrackId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `video-track-${crypto.randomUUID()}`;
  }
  return `video-track-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeVideoTrackName(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed || fallback;
}

function getLegacyVideoTrackId(videoKey: string): string {
  return `legacy-${videoKey.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

function resolveVideoTrackTarget(
  input: {
    selectedTrackId: string;
    newTrackName: string;
    existingTracks: VideoTimelineTrack[];
    sessionId?: string;
  },
): VideoTrackTarget {
  if (input.selectedTrackId === NEW_VIDEO_TRACK_OPTION) {
    return {
      id: createVideoTrackId(),
      name: sanitizeVideoTrackName(
        input.newTrackName,
        `Video Track ${input.existingTracks.length + 1}`,
      ),
    };
  }

  const existing = input.existingTracks.find((track) => track.id === input.selectedTrackId);
  if (existing) return { id: existing.id, name: existing.label };

  return {
    id: DEFAULT_VIDEO_TRACK_ID,
    name: 'Video Track 1',
  };
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

function stripTelemetryDatasetSamples(dataset: TelemetryDataset): TelemetryDataset {
  return {
    ...dataset,
    channels: dataset.channels.map((channel) => ({
      ...channel,
      samples: [],
    })),
  };
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

function readVideoFileDurationMs(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    let settled = false;

    const finish = (durationMs: number) => {
      if (settled) return;
      settled = true;
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('durationchange', handleLoadedMetadata);
      video.removeEventListener('error', handleError);
      video.pause();
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
      resolve(durationMs);
    };

    const handleLoadedMetadata = () => finish(getVideoDurationMs(video));
    const handleError = () => finish(0);

    video.preload = 'metadata';
    video.playsInline = true;
    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('durationchange', handleLoadedMetadata);
    video.addEventListener('error', handleError);
    video.src = url;
    video.load();
  });
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
  const [telemetryDatasets, setTelemetryDatasets] = useState<TelemetryDataset[]>([]);
  const [activeTrackId, setActiveTrackId] = useState<string | null>(null);
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [sessionVideos, setSessionVideos] = useState<SessionVideo[]>([]);
  const [manageClipDetailKey, setManageClipDetailKey] = useState<string | null>(null);
  const [localVideos, setLocalVideos] = useState<LocalSessionVideo[]>([]);
  const [loading, setLoading] = useState(true);

  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('events');
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [workspaceWindow, setWorkspaceWindow] = useState<WorkspaceWindowMs>({
    startMs: 0,
    endMs: 0,
  });
  const [timelineDraftClip, setTimelineDraftClip] = useState<{
    clipKey: string;
    ms: number;
  } | null>(null);
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
  const [videoTargetTrackId, setVideoTargetTrackId] = useState(DEFAULT_VIDEO_TRACK_ID);
  const [videoNewTrackName, setVideoNewTrackName] = useState('');
  const [videoTrackDrafts, setVideoTrackDrafts] = useState<Record<string, VideoTrackDraft>>({});
  const [expandedVideoTrackId, setExpandedVideoTrackId] = useState<string | null>(null);
  const [videoFilePickerTrackId, setVideoFilePickerTrackId] = useState<string | null>(null);
  const [videoBusy, setVideoBusy] = useState(false);
  const [videoControlError, setVideoControlError] = useState<string | null>(null);
  const [sensorImportMessage, setSensorImportMessage] = useState<string | null>(null);
  const [telemetryDataVersion, setTelemetryDataVersion] = useState(0);
  const [videoStageError, setVideoStageError] = useState<string | null>(null);
  const [videoStageReady, setVideoStageReady] = useState(false);
  const [videoDurationsByKey, setVideoDurationsByKey] = useState<Record<string, number>>({});
  const [videoClocksByKey, setVideoClocksByKey] = useState<Record<string, number>>({});
  const [videoDurationMs, setVideoDurationMs] = useState(0);
  const [videoClockMs, setVideoClockMs] = useState(0);
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [syncDialogClipKey, setSyncDialogClipKey] = useState<string | null>(null);
  const [syncSessionTimeMs, setSyncSessionTimeMs] = useState(0);
  const [syncVideoTimeMs, setSyncVideoTimeMs] = useState(0);
  const [isVideoDialogOpen, setIsVideoDialogOpen] = useState(false);
  const [sessionSummaryOpen, setSessionSummaryOpen] = useState(false);
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
  const currentTimeRef = useRef(0);
  const lastPlaybackStateUpdateRef = useRef(0);
  const resumeAfterScrubRef = useRef(false);
  const resumeAfterSyncRef = useRef(false);
  const workspaceRef = useRef<HTMLElement | null>(null);
  const stageCanvasRef = useRef<HTMLElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const sensorInputRef = useRef<HTMLInputElement | null>(null);
  const topBarRef = useRef<HTMLDivElement | null>(null);
  const localVideosRef = useRef<LocalSessionVideo[]>([]);
  const splitDirectionInitializedRef = useRef(false);
  const companionChannelRef = useRef<BroadcastChannel | null>(null);
  const companionHostStateRef = useRef<CompanionHostState | null>(null);
  const lastCompanionReadyAtRef = useRef(0);
  const telemetryWindowLoadSeqRef = useRef(0);
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
  const effectiveTrackTimeOriginUnixMs = useMemo(() => {
    const origin =
      session?.trackTimeOriginUnixMs ??
      activeTrack?.trackTimeOriginUnixMs ??
      tracks.find((track) => track.id === primaryTrackId)?.trackTimeOriginUnixMs ??
      tracks.find((track) => track.trackTimeOriginUnixMs != null)?.trackTimeOriginUnixMs;
    return origin != null && Number.isFinite(origin) ? origin : undefined;
  }, [activeTrack?.trackTimeOriginUnixMs, primaryTrackId, session?.trackTimeOriginUnixMs, tracks]);
  const sessionWithEffectiveTrackOrigin = useMemo(
    () =>
      session
        ? {
            ...session,
            ...(effectiveTrackTimeOriginUnixMs != null
              ? { trackTimeOriginUnixMs: effectiveTrackTimeOriginUnixMs }
              : {}),
          }
        : null,
    [effectiveTrackTimeOriginUnixMs, session],
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
    localVideos.forEach((video, index) => {
      const key = localVideoKey(video.signature);
      const fallbackTrackId =
        localVideos.length === 1 && sessionVideos.length === 0
          ? DEFAULT_VIDEO_TRACK_ID
          : getLegacyVideoTrackId(key);
      sources.push({
        key,
        origin: 'local',
        videoTrackId: video.videoTrackId ?? fallbackTrackId,
        videoTrackName:
          video.videoTrackName ??
          (video.videoTrackId ? 'Video Track' : `Video Track ${index + 1}`),
        url: video.objectUrl,
        label: video.label ?? video.file.name,
        videoType: video.videoType,
        offsetMs: video.offsetMs,
        sync: video.sync,
        placementSource: video.placementSource,
        placementConfidence: video.placementConfidence,
        signature: video.signature,
        crossOrigin: '',
      });
    });

    sessionVideos.forEach((video, index) => {
      const key = remoteVideoKey(video);
      const fallbackTrackId =
        sessionVideos.length === 1 && localVideos.length === 0
          ? DEFAULT_VIDEO_TRACK_ID
          : getLegacyVideoTrackId(key);
      sources.push({
        key,
        origin: 'remote',
        id: video.id,
        videoTrackId: video.videoTrackId ?? fallbackTrackId,
        videoTrackName:
          video.videoTrackName ??
          (video.videoTrackId ? 'Video Track' : `Video Track ${localVideos.length + index + 1}`),
        url: video.url,
        label: video.label,
        videoType: video.videoType,
        offsetMs: video.offsetMs,
        sync: video.sync,
        placementSource: video.placementSource,
        placementConfidence: video.placementConfidence,
        crossOrigin: 'anonymous',
      });
    });

    return sources;
  }, [localVideos, sessionVideos]);

  const getLocalVideoRow = useCallback(
    (source: ActiveVideoSource | null): LocalSessionVideo | null => {
      if (!source || source.origin !== 'local') return null;
      return localVideos.find((video) => localVideoKey(video.signature) === source.key) ?? null;
    },
    [localVideos],
  );

  const videoTimelineTracks = useMemo<VideoTimelineTrack[]>(() => {
    const byTrack = new Map<string, VideoTimelineTrack>();

    videoSources.forEach((source) => {
      const existing = byTrack.get(source.videoTrackId);
      const clip: VideoTimelineClip = {
        source,
        durationMs: videoDurationsByKey[source.key] ?? 0,
      };
      if (existing) {
        existing.clips.push(clip);
        return;
      }
      byTrack.set(source.videoTrackId, {
        id: source.videoTrackId,
        label: source.videoTrackName,
        clips: [clip],
      });
    });

    return Array.from(byTrack.values()).map((track) => ({
      ...track,
      clips: [...track.clips].sort((a, b) => {
        if (a.source.offsetMs !== b.source.offsetMs) {
          return a.source.offsetMs - b.source.offsetMs;
        }
        return (a.source.label ?? '').localeCompare(b.source.label ?? '');
      }),
    }));
  }, [videoDurationsByKey, videoSources]);

  const managedVideoTracks = useMemo<ManagedVideoTrack[]>(() => {
    const byTrack = new Map<string, ManagedVideoTrack>();

    videoTimelineTracks.forEach((track) => {
      const draft = videoTrackDrafts[track.id];
      byTrack.set(track.id, {
        ...track,
        label: draft?.name ?? track.label,
        videoType: draft?.videoType ?? track.clips[0]?.source.videoType ?? videoDraftType,
        draftOnly: false,
      });
    });

    Object.values(videoTrackDrafts).forEach((draft) => {
      if (byTrack.has(draft.id)) return;
      byTrack.set(draft.id, {
        id: draft.id,
        label: draft.name,
        videoType: draft.videoType,
        clips: [],
        draftOnly: true,
      });
    });

    return Array.from(byTrack.values());
  }, [videoDraftType, videoTimelineTracks, videoTrackDrafts]);

  const resolveVideoForTimelineTrack = useCallback(
    (trackId: string): ActiveVideoSource | null => {
      const track = videoTimelineTracks.find((item) => item.id === trackId);
      if (!track) return videoSources.find((source) => source.key === trackId) ?? null;

      const coveringClip = track.clips.find((clip) => {
        const durationMs = clip.durationMs || videoDurationsByKey[clip.source.key] || 0;
        return (
          durationMs > 0 &&
          currentTime >= clip.source.offsetMs &&
          currentTime < clip.source.offsetMs + durationMs
        );
      });
      if (coveringClip) return coveringClip.source;

      return track.clips[0]?.source ?? null;
    },
    [currentTime, videoDurationsByKey, videoSources, videoTimelineTracks],
  );

  const primaryStageVideo = useMemo(() => {
    const fromContent = (content: WorkspaceStageContent) => {
      const vk = videoKeyFromStageContent(content);
      if (!vk) return null;
      return resolveVideoForTimelineTrack(vk);
    };

    if (stageLayoutMode === 'split') {
      return (
        fromContent(leftStageContent) ??
        fromContent(rightStageContent) ??
        videoSources[0] ??
        null
      );
    }
    return fromContent(primaryStageContent) ?? videoSources[0] ?? null;
  }, [
    leftStageContent,
    primaryStageContent,
    resolveVideoForTimelineTrack,
    rightStageContent,
    stageLayoutMode,
    videoSources,
  ]);

  const manageClipDetailVideo = useMemo(
    () =>
      manageClipDetailKey
        ? videoSources.find((video) => video.key === manageClipDetailKey) ?? null
        : null,
    [manageClipDetailKey, videoSources],
  );

  const syncDialogVideo = useMemo(
    () =>
      syncDialogClipKey
        ? videoSources.find((video) => video.key === syncDialogClipKey) ?? null
        : null,
    [syncDialogClipKey, videoSources],
  );

  const activeVideo = primaryStageVideo;
  const localVideo = getLocalVideoRow(primaryStageVideo);

  useEffect(() => {
    const expandedTrack = expandedVideoTrackId
      ? managedVideoTracks.find((track) => track.id === expandedVideoTrackId)
      : null;
    if (expandedTrack) {
      setVideoTargetTrackId(expandedTrack.id);
      setVideoDraftType(expandedTrack.videoType);
      return;
    }

    const fallbackTrack =
      (primaryStageVideo
        ? managedVideoTracks.find((track) => track.id === primaryStageVideo.videoTrackId)
        : null) ??
      managedVideoTracks[0] ??
      null;
    if (fallbackTrack) {
      setVideoTargetTrackId(fallbackTrack.id);
      setVideoDraftType(fallbackTrack.videoType);
      return;
    }

    setVideoTargetTrackId(DEFAULT_VIDEO_TRACK_ID);
  }, [expandedVideoTrackId, managedVideoTracks, primaryStageVideo]);

  const handleAddManagedVideoTrack = useCallback(() => {
    const trackId = createVideoTrackId();
    const nextTrack: VideoTrackDraft = {
      id: trackId,
      name: `Video Track ${managedVideoTracks.length + 1}`,
      videoType: 'flat',
    };
    setVideoTrackDrafts((prev) => ({
      ...prev,
      [trackId]: nextTrack,
    }));
    setExpandedVideoTrackId(trackId);
    setVideoTargetTrackId(trackId);
    setVideoDraftType(nextTrack.videoType);
    setVideoNewTrackName('');
    setVideoDialogTab('recommended');
  }, [managedVideoTracks.length]);

  const updateManagedVideoTrackDraft = useCallback(
    (track: ManagedVideoTrack, patch: Partial<Pick<VideoTrackDraft, 'name' | 'videoType'>>) => {
      setVideoTrackDrafts((prev) => {
        const existing = prev[track.id];
        return {
          ...prev,
          [track.id]: {
            id: track.id,
            name: patch.name ?? existing?.name ?? track.label,
            videoType: patch.videoType ?? existing?.videoType ?? track.videoType,
          },
        };
      });
      if (patch.videoType) setVideoDraftType(patch.videoType);
    },
    [],
  );

  const commitManagedVideoTrackConfig = useCallback(
    async (
      track: ManagedVideoTrack,
      patch: Partial<Pick<VideoTrackDraft, 'name' | 'videoType'>>,
    ) => {
      const draft = videoTrackDrafts[track.id];
      const nextName = sanitizeVideoTrackName(
        patch.name ?? draft?.name ?? track.label,
        track.label || 'Video Track',
      );
      const nextVideoType = patch.videoType ?? draft?.videoType ?? track.videoType;
      const clipKeys = new Set(track.clips.map((clip) => clip.source.key));

      setVideoTrackDrafts((prev) => ({
        ...prev,
        [track.id]: {
          id: track.id,
          name: nextName,
          videoType: nextVideoType,
        },
      }));
      setVideoDraftType(nextVideoType);
      setLocalVideos((prev) =>
        prev.map((video) =>
          clipKeys.has(localVideoKey(video.signature))
            ? { ...video, videoTrackName: nextName, videoType: nextVideoType }
            : video,
        ),
      );
      setSessionVideos((prev) =>
        prev.map((video) =>
          clipKeys.has(remoteVideoKey(video))
            ? {
                ...video,
                videoTrackName: nextName,
                videoType: nextVideoType,
                updatedAt: new Date().toISOString(),
              }
            : video,
        ),
      );

      if (!sessionId || clipKeys.size === 0) return;

      const affectedRemoteVideos = sessionVideos.filter((video) =>
        clipKeys.has(remoteVideoKey(video)),
      );
      const nextBindings = sessionBindings?.videos.map((binding) =>
        binding.videoTrackId === track.id
          ? { ...binding, videoTrackName: nextName, videoType: nextVideoType }
          : binding,
      );

      if (affectedRemoteVideos.length === 0 && !nextBindings) return;

      setVideoBusy(true);
      setVideoControlError(null);
      try {
        await Promise.all([
          ...affectedRemoteVideos.map((video) =>
            videoApi.sync(sessionId, {
              offsetMs: video.offsetMs,
              sync: video.sync,
              videoId: video.id,
              videoType: nextVideoType,
              videoTrackId: track.id,
              videoTrackName: nextName,
              placementSource: video.placementSource,
              placementConfidence: video.placementConfidence,
            }),
          ),
          ...(currentWorkspace && nextBindings
            ? [
                saveLocalWorkspaceSessionVideoBindings(
                  currentWorkspace.id,
                  sessionId,
                  nextBindings,
                ).then(() => {
                  setSessionBindings((prev) => ({
                    track: prev?.track ?? null,
                    videos: nextBindings,
                  }));
                }),
              ]
            : []),
        ]);
      } catch (error) {
        setVideoControlError(getErrorMessage(error));
      } finally {
        setVideoBusy(false);
      }
    },
    [currentWorkspace, sessionBindings?.videos, sessionId, sessionVideos, videoTrackDrafts],
  );

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

    const nextLocalVideos = localVideosRef.current;

    if (nextLocalVideos.length === 0) {
      postCompanionMessage({
        type: 'host_clear_local_video',
        sessionId,
        sentAt: Date.now(),
      });
      return;
    }

    nextLocalVideos.forEach((video) => {
      postCompanionMessage({
        type: 'host_local_video',
        sessionId,
        sentAt: Date.now(),
        file: video.file,
        label: video.label ?? video.file.name,
        key: localVideoKey(video.signature),
        signature: video.signature,
        videoType: video.videoType,
        offsetMs: video.offsetMs,
        sync: video.sync,
      });
    });
  }, [postCompanionMessage, sessionId]);

  useEffect(() => {
    localVideosRef.current = localVideos;
  }, [localVideos]);

  useEffect(() => {
    return () => {
      localVideosRef.current.forEach((video) => URL.revokeObjectURL(video.objectUrl));
      localVideosRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    setWorkspaceMode(loadWorkspaceMode(sessionId) ?? 'data');
  }, [sessionId]);

  useLayoutEffect(() => {
    if (!sessionId) return;
    splitDirectionInitializedRef.current = false;

    const savedDirection = loadSplitDirection(sessionId);
    if (savedDirection) {
      setSplitDirection(savedDirection);
      splitDirectionInitializedRef.current = true;
      return;
    }

    const el = stageCanvasRef.current;
    const width = el?.clientWidth ?? (typeof window !== 'undefined' ? window.innerWidth : 0);
    const height = el?.clientHeight ?? (typeof window !== 'undefined' ? window.innerHeight : 0);
    setSplitDirection(splitDirectionForAspectRatio(width, height));
    splitDirectionInitializedRef.current = true;
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
    if (!splitDirectionInitializedRef.current) return;
    saveSplitDirection(sessionId, splitDirection);
  }, [sessionId, splitDirection]);

  useEffect(() => {
    if (!sessionId) return;
    localVideos.forEach((video) => {
      saveLocalVideoPrefs(sessionId, video.signature, {
        videoTrackId: video.videoTrackId,
        videoTrackName: video.videoTrackName,
        offsetMs: video.offsetMs,
        sync: video.sync,
        placementSource: video.placementSource,
        placementConfidence: video.placementConfidence,
        videoType: video.videoType,
      });
    });
  }, [localVideos, sessionId]);

  useEffect(() => {
    if (!syncDialogOpen) return;
    if (syncDialogVideo) return;
    setSyncDialogOpen(false);
    setSyncSessionTimeMs(0);
    setSyncVideoTimeMs(0);
    setSyncDialogClipKey(null);
  }, [syncDialogOpen, syncDialogVideo]);

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
    localVideos,
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
    setTelemetryDatasets([]);
    setActiveTrackId(null);
    setEvents([]);
    setMarks([]);
    setSessionVideos([]);
    setManageClipDetailKey(null);
    setVideoDraftUrl('');
    setVideoDraftType('flat');
    setCurrentTime(0);
    setIsPlaying(false);
    setWorkspaceWindow({ startMs: 0, endMs: 0 });
    setTimelineDraftClip(null);
    setVideoStageError(null);
    setVideoClockMs(0);
    setVideoDurationMs(0);
    setVideoStageReady(false);
    setSyncDialogOpen(false);
    setSyncSessionTimeMs(0);
    setSyncVideoTimeMs(0);
    setVideoControlError(null);
    setSensorImportMessage(null);
    setManualWind(null);
    telemetryWindowLoadSeqRef.current += 1;

    const load = async () => {
      if (currentWorkspace) {
        try {
          const localShell = await getLocalWorkspaceSessionShell(
            currentWorkspace.id,
            sessionId,
          );
          if (localShell) {
            return {
              nextSession: localShell.session,
              nextTracks: localShell.tracks,
              nextTrackPointsById: Object.fromEntries(
                localShell.tracks.map((track) => [track.id, [] as TrackPoint[]]),
              ),
              nextTelemetryDatasets: localShell.telemetryDatasets,
              nextEvents: localShell.events,
              nextMarks: localShell.marks,
              nextVideos: [] as SessionVideo[],
              chunkedLocalWorkspaceId: currentWorkspace.id,
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
        nextTelemetryDatasets: [] as TelemetryDataset[],
        nextEvents,
        nextMarks,
        nextVideos,
        chunkedLocalWorkspaceId: null,
      };
    };

    void load()
      .then(({
        nextSession,
        nextTracks,
        nextTrackPointsById,
        nextTelemetryDatasets,
        nextEvents,
        nextMarks,
        nextVideos,
        chunkedLocalWorkspaceId,
      }) => {
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
        setTelemetryDatasets(nextTelemetryDatasets);
        setActiveTrackId(getPrimaryTrackId(nextTracks));
        setEvents(nextEvents);
        setMarks(nextMarks);
        setSessionVideos(nextVideos);
        const sessionDurMs = nextSession.stats.duration * 1000;
        setWorkspaceWindow({ startMs: 0, endMs: sessionDurMs });
        setVideoDraftUrl(nextVideos[0]?.url ?? '');
        setVideoDraftType(nextVideos[0]?.videoType ?? 'flat');
        setLoading(false);

        if (chunkedLocalWorkspaceId) {
          nextTracks.forEach((track) => {
            void loadLocalWorkspaceTrackPointsInChunks(
              chunkedLocalWorkspaceId,
              sessionId,
              track.id,
              (chunk) => {
                if (cancelled || chunk.trackId !== track.id || chunk.points.length === 0) return;
                setTrackPointsById((prev) => ({
                  ...prev,
                  [track.id]: [...(prev[track.id] ?? []), ...chunk.points],
                }));
              },
            );
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSession(null);
          setTracks([]);
          setTrackPointsById({});
          setTelemetryDatasets([]);
          setActiveTrackId(null);
          setEvents([]);
          setMarks([]);
          setSessionVideos([]);
          setVideoDraftUrl('');
          setVideoDraftType('flat');
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      setLocalVideos((prev) => {
        prev.forEach((video) => URL.revokeObjectURL(video.objectUrl));
        return [];
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

  const handleImportSensorFiles = useCallback(
    async (files: File[]) => {
      if (!sessionId || files.length === 0) return;
      setSensorImportMessage(null);
      setVideoControlError(null);

      try {
        const parsed = await Promise.all(
          files.map((file) =>
            currentWorkspace
              ? importLocalWorkspaceTelemetryFile(
                  currentWorkspace.id,
                  sessionId,
                  file,
                )
              : parseLocalTelemetryFile(file, { sessionId }),
          ),
        );
        const nextDatasets = parsed.map((item) => item.dataset);
        const nextDatasetShells = nextDatasets.map(stripTelemetryDatasetSamples);
        setTelemetryDatasets((prev) => {
          const nextIds = new Set(nextDatasetShells.map((dataset) => dataset.id));
          return [
            ...prev.filter((dataset) => !nextIds.has(dataset.id)),
            ...nextDatasetShells,
          ];
        });
        const channelCount = nextDatasets.reduce(
          (sum, dataset) => sum + dataset.channels.length,
          0,
        );
        setSensorImportMessage(
          `Imported ${nextDatasets.length} sensor source${
            nextDatasets.length === 1 ? '' : 's'
          } with ${channelCount} channel${channelCount === 1 ? '' : 's'}.`,
        );
        setTelemetryDataVersion((version) => version + 1);
      } catch (error) {
        setVideoControlError(getErrorMessage(error));
      }
    },
    [currentWorkspace, sessionId],
  );

  const syncSessionJumpOptions = useMemo(
    () =>
      [...events]
        .map((e) => ({
          id: e.id,
          sessionTimeMs: seekTimeFromEvent(e, totalDuration),
          title: e.note?.trim() ? e.note : e.type.replace(/_/g, ' '),
          subtitle: formatEventTimeLabel(e),
          meta: formatEventMeta(e),
        }))
        .filter((x) => Number.isFinite(x.sessionTimeMs) && x.sessionTimeMs >= 0)
        .sort((a, b) => a.sessionTimeMs - b.sessionTimeMs),
    [events, totalDuration],
  );

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
    activeVideo && visibleStageVideoKeys.has(activeVideo.videoTrackId),
  );
  const telemetryStageVisible = useMemo(() => {
    if (stageLayoutMode === 'split') {
      return leftStageContent === 'telemetry' || rightStageContent === 'telemetry';
    }
    return primaryStageContent === 'telemetry';
  }, [leftStageContent, primaryStageContent, rightStageContent, stageLayoutMode]);
  const telemetryConsumerVisible =
    telemetryStageVisible || (isDesktopLayout && !rightCollapsed);
  const telemetryLoadBucket = Math.floor(currentTime / 30000);
  const telemetryLoadWindow = useMemo(() => {
    const center = telemetryLoadBucket * 30000;
    return {
      startMs: Math.max(workspaceWindowEffective.startMs, center - 120000),
      endMs: Math.min(workspaceWindowEffective.endMs, center + 120000),
    };
  }, [
    telemetryLoadBucket,
    workspaceWindowEffective.endMs,
    workspaceWindowEffective.startMs,
  ]);

  useEffect(() => {
    if (!currentWorkspace || !sessionId || !telemetryConsumerVisible) return;
    if (telemetryLoadWindow.endMs <= telemetryLoadWindow.startMs) return;

    let cancelled = false;
    const seq = ++telemetryWindowLoadSeqRef.current;
    const windowDatasets = new Map<string, TelemetryDataset>();
    void loadLocalWorkspaceTelemetryDatasetsInChunks(
      currentWorkspace.id,
      sessionId,
      (chunk) => {
        if (cancelled || seq !== telemetryWindowLoadSeqRef.current) return;
        const current = windowDatasets.get(chunk.datasetId);
        const merged = current
          ? {
              ...current,
              channels: current.channels.map((channel) => {
                const chunkChannel = chunk.dataset.channels.find(
                  (item) => item.id === channel.id,
                );
                return {
                  ...channel,
                  samples: [
                    ...channel.samples,
                    ...(chunkChannel?.samples ?? []),
                  ],
                };
              }),
            }
          : chunk.dataset;
        windowDatasets.set(chunk.datasetId, merged);
        setTelemetryDatasets(Array.from(windowDatasets.values()));
      },
      { timeWindow: telemetryLoadWindow },
    );

    return () => {
      cancelled = true;
    };
  }, [
    currentWorkspace,
    sessionId,
    telemetryDataVersion,
    telemetryLoadWindow,
    telemetryConsumerVisible,
  ]);

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
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  useEffect(() => {
    if (!isPlaying || totalDuration === 0) return;

    lastFrameRef.current = performance.now();
    lastPlaybackStateUpdateRef.current = lastFrameRef.current;
    const endMs = workspaceWindowEffective.endMs;

    const tick = (now: number) => {
      const delta = (now - lastFrameRef.current) * playbackSpeed;
      lastFrameRef.current = now;
      const next = currentTimeRef.current + delta;
      currentTimeRef.current = next >= endMs ? endMs : next;

      if (next >= endMs) {
        setCurrentTime(endMs);
        setIsPlaying(false);
        return;
      }

      if (now - lastPlaybackStateUpdateRef.current >= PLAYBACK_STATE_UPDATE_MS) {
        lastPlaybackStateUpdateRef.current = now;
        setCurrentTime(currentTimeRef.current);
      }

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
  const stageContentOptions = useMemo(
    () => [
      { value: 'map' as WorkspaceStageContent, label: 'Map' },
      { value: 'telemetry' as WorkspaceStageContent, label: 'Telemetry' },
      ...videoTimelineTracks.map((track, index) => ({
        value: `video:${track.id}` as WorkspaceStageContent,
        label: `Video Track ${index + 1}: ${track.label}`,
      })),
    ],
    [videoTimelineTracks],
  );

  const selectStageContent = useCallback(
    (content: WorkspaceStageContent, setter: (content: WorkspaceStageContent) => void) => {
      setter(content);
    },
    [],
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
      activeTrackPoints: undefined,
      telemetryDatasets: undefined,
      windDir: manualWind?.dir ?? (currentPoint ? getWindDir(currentPoint) : undefined),
      windSpeed: manualWind?.speed ?? (currentPoint ? getWindSpeed(currentPoint) : undefined),
      nearestEvent,
      video: activeVideo
        ? {
            key: activeVideo.key,
            origin: activeVideo.origin,
            id: activeVideo.id,
            videoTrackId: activeVideo.videoTrackId,
            videoTrackName: activeVideo.videoTrackName,
            label: activeVideo.label,
            url: activeVideo.origin === 'remote' ? activeVideo.url : undefined,
            videoType: activeVideo.videoType,
            offsetMs: activeVideo.offsetMs,
            sync: activeVideo.sync,
            placementSource: activeVideo.placementSource,
            placementConfidence: activeVideo.placementConfidence,
            signature: activeVideo.signature,
          }
        : null,
      videos: videoSources.map((video) => ({
        key: video.key,
        origin: video.origin,
        id: video.id,
        videoTrackId: video.videoTrackId,
        videoTrackName: video.videoTrackName,
        label: video.label,
        url: video.origin === 'remote' ? video.url : undefined,
        videoType: video.videoType,
        offsetMs: video.offsetMs,
        sync: video.sync,
        placementSource: video.placementSource,
        placementConfidence: video.placementConfidence,
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

  const handleDeleteMark = useCallback(
    async (mark: Mark) => {
      if (!sessionId) return;
      const label = mark.name ?? mark.type;
      if (!window.confirm(`Delete mark "${label}"?`)) return;

      await markApi.delete(sessionId, mark.id);
      setMarks((prev) => prev.filter((item) => item.id !== mark.id));
      setSelection((prev) =>
        prev.markId === mark.id
          ? {
              ...prev,
              markId: null,
            }
          : prev,
      );
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

  const removeLocalClipByKey = useCallback((clipKey: string) => {
    setLocalVideos((prev) =>
      prev.filter((video) => {
        const remove = localVideoKey(video.signature) === clipKey;
        if (remove) URL.revokeObjectURL(video.objectUrl);
        return !remove;
      }),
    );
    setVideoStageError(null);
    setVideoClockMs(0);
    setVideoDurationMs(0);
    setVideoStageReady(false);
    setSyncSessionTimeMs(0);
    setSyncVideoTimeMs(0);
  }, []);

  const getDefaultOffsetForFile = useCallback(
    (file: File, durationMs = 0): number => {
      if (!sessionWithEffectiveTrackOrigin || totalDuration <= 0) return 0;
      const videoWallClockStartMs = getVideoFileWallClockStartMs(file, durationMs);
      if (videoWallClockStartMs == null) return 0;
      return (
        tryComputeVideoOffsetFromWallClock(
          sessionWithEffectiveTrackOrigin,
          totalDuration,
          videoWallClockStartMs,
        ) ?? 0
      );
    },
    [sessionWithEffectiveTrackOrigin, totalDuration],
  );

  const getDefaultSyncForFile = useCallback(
    (file: File, durationMs = 0): VideoSyncBinding => {
      const videoWallClockStartMs = getVideoFileWallClockStartMs(file, durationMs);
      const wallClockOffsetMs =
        sessionWithEffectiveTrackOrigin && totalDuration > 0 && videoWallClockStartMs != null
          ? tryComputeVideoOffsetFromWallClock(
              sessionWithEffectiveTrackOrigin,
              totalDuration,
              videoWallClockStartMs,
            )
          : null;
      if (effectiveTrackTimeOriginUnixMs != null && wallClockOffsetMs != null) {
        return createVideoSyncBindingFromAnchor(
          {
            videoTimeMs: 0,
            trackTimeMs: wallClockOffsetMs,
            realUnixMs: videoWallClockStartMs ?? undefined,
            source: 'auto-file-time',
            confidence: 'medium',
          },
          { trackTimeOriginUnixMs: effectiveTrackTimeOriginUnixMs },
        );
      }
      const offsetMs = getDefaultOffsetForFile(file, durationMs);
      return createOffsetOnlyVideoSync(offsetMs, {
        trackTimeOriginUnixMs: effectiveTrackTimeOriginUnixMs,
        source: 'manual-video-track',
        confidence: 'low',
      });
    },
    [
      effectiveTrackTimeOriginUnixMs,
      getDefaultOffsetForFile,
      sessionWithEffectiveTrackOrigin,
      totalDuration,
    ],
  );

  const getTrackAppendStartMs = useCallback(
    (trackId: string, pendingClipEnds: number[] = []): number => {
      const track = videoTimelineTracks.find((item) => item.id === trackId);
      const existingEnds =
        track?.clips.map((clip) => {
          const durationMs = clip.durationMs || videoDurationsByKey[clip.source.key] || 0;
          return clip.source.offsetMs + Math.max(0, durationMs);
        }) ?? [];
      return Math.max(0, ...existingEnds, ...pendingClipEnds);
    },
    [videoDurationsByKey, videoTimelineTracks],
  );

  const getDefaultPlacementForFile = useCallback(
    (
      file: File,
      targetTrackId: string,
      durationMs = 0,
      pendingClipEnds: number[] = [],
    ): VideoPlacement => {
      if (sessionWithEffectiveTrackOrigin && totalDuration > 0) {
        const videoWallClockStartMs = getVideoFileWallClockStartMs(file, durationMs);
        const wallClockOffsetMs =
          videoWallClockStartMs != null
            ? tryComputeVideoOffsetFromWallClock(
                sessionWithEffectiveTrackOrigin,
                totalDuration,
                videoWallClockStartMs,
              )
            : null;
        if (wallClockOffsetMs != null) {
          pendingClipEnds.push(wallClockOffsetMs + Math.max(0, durationMs));
          return {
            offsetMs: wallClockOffsetMs,
            placementSource: 'file-time',
            placementConfidence: 'medium',
          };
        }
      }

      const offsetMs = getTrackAppendStartMs(targetTrackId, pendingClipEnds);
      pendingClipEnds.push(offsetMs + Math.max(0, durationMs));
      return {
        offsetMs,
        placementSource: 'sequential-fallback',
        placementConfidence: 'low',
      };
    },
    [getTrackAppendStartMs, sessionWithEffectiveTrackOrigin, totalDuration],
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
        videoTrackId?: string;
        videoTrackName?: string;
        placementSource?: VideoPlacementSource;
        placementConfidence?: VideoPlacementConfidence;
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
        { trackTimeOriginUnixMs: effectiveTrackTimeOriginUnixMs },
      );

      const nextVideo: LocalSessionVideo = {
        file,
        objectUrl,
        signature,
        videoTrackId: options?.videoTrackId ?? savedPrefs?.videoTrackId,
        videoTrackName: options?.videoTrackName ?? savedPrefs?.videoTrackName,
        videoType: options?.nextVideoType ?? savedPrefs?.videoType ?? videoDraftType,
        offsetMs: resolvedSync.offsetMs,
        sync: resolvedSync,
        placementSource: options?.placementSource ?? savedPrefs?.placementSource,
        placementConfidence: options?.placementConfidence ?? savedPrefs?.placementConfidence,
        sourceKind: options?.sourceKind ?? 'file_picker',
        label: options?.label ?? file.name,
        workspaceRelativePath: options?.workspaceRelativePath,
      };

      setLocalVideos((prev) => {
        const next = prev.filter((video) => {
          const sameSignature = video.signature === nextVideo.signature;
          const sameWorkspacePath =
            nextVideo.workspaceRelativePath &&
            video.workspaceRelativePath === nextVideo.workspaceRelativePath;
          const shouldReplace = sameSignature || sameWorkspacePath;
          if (shouldReplace) URL.revokeObjectURL(video.objectUrl);
          return !shouldReplace;
        });
        return [...next, nextVideo];
      });
      setVideoDraftType(nextVideo.videoType);
      if (nextVideo.videoTrackId) setVideoTargetTrackId(nextVideo.videoTrackId);
      setVideoControlError(null);
      setVideoStageError(null);
      setVideoClockMs(0);
      setVideoDurationMs(0);
      setVideoStageReady(false);
      setSyncSessionTimeMs(0);
      setSyncVideoTimeMs(0);
      setVideoNeedsReview(options?.promptReview ?? savedPrefs == null);
    },
    [
      getDefaultOffsetForFile,
      getDefaultSyncForFile,
      effectiveTrackTimeOriginUnixMs,
      sessionId,
      videoDraftType,
    ],
  );

  const saveWorkspaceVideoBinding = useCallback(
    async (input: {
      relativePath: string;
      fileName: string;
      label?: string;
      videoType: VideoType;
      videoTrackId?: string;
      videoTrackName?: string;
      offsetMs: number;
      sync?: VideoSyncBinding;
      placementSource?: VideoPlacementSource;
      placementConfidence?: VideoPlacementConfidence;
    }) => {
      if (!currentWorkspace || !sessionId) return;
      const sync = normalizeVideoSyncBinding(input.offsetMs, input.sync, {
        trackTimeOriginUnixMs: effectiveTrackTimeOriginUnixMs,
      });

      const videoBinding: WorkspaceVideoBinding = {
        path: `../../${input.relativePath.replace(/^\.?\//, '')}`,
        fileName: input.fileName,
        videoTrackId: input.videoTrackId,
        videoTrackName: input.videoTrackName,
        label: input.label,
        sourceKind: 'workspace_discovery',
        storageMode: 'workspace_relative_ref',
        videoType: input.videoType,
        offsetMs: sync.offsetMs,
        sync,
        placementSource: input.placementSource,
        placementConfidence: input.placementConfidence,
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
    [currentWorkspace, effectiveTrackTimeOriginUnixMs, sessionBindings?.videos, sessionId],
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

  const applyVideoSyncForSource = useCallback(
    async (video: ActiveVideoSource, nextSync: VideoSyncBinding) => {
      if (!sessionId) return;
      const resolvedSync = normalizeVideoSyncBinding(nextSync.offsetMs, nextSync, {
        trackTimeOriginUnixMs: effectiveTrackTimeOriginUnixMs,
      });
      const nextOffsetMs = resolvedSync.offsetMs;
      const localRow = getLocalVideoRow(video);

      if (video.origin === 'local') {
        setLocalVideos((prev) =>
          prev.map((row) =>
            localVideoKey(row.signature) === video.key
              ? {
                  ...row,
                  offsetMs: nextOffsetMs,
                  sync: resolvedSync,
                  placementSource: 'manual',
                  placementConfidence: 'low',
                }
              : row,
          ),
        );
        if (localRow?.sourceKind === 'workspace' && localRow.workspaceRelativePath) {
          try {
            await saveWorkspaceVideoBinding({
              relativePath: localRow.workspaceRelativePath,
              fileName: localRow.file.name,
              label: localRow.label ?? localRow.file.name,
              videoType: localRow.videoType,
              videoTrackId: localRow.videoTrackId,
              videoTrackName: localRow.videoTrackName,
              offsetMs: nextOffsetMs,
              sync: resolvedSync,
              placementSource: 'manual',
              placementConfidence: 'low',
            });
          } catch (error) {
            setVideoControlError(getErrorMessage(error));
          }
        }
        return;
      }

      setSessionVideos((prev) =>
        prev.map((row, index) =>
          (video.id ? row.id === video.id : index === 0)
            ? {
                ...row,
                offsetMs: nextOffsetMs,
                sync: resolvedSync,
                placementSource: 'manual',
                placementConfidence: 'low',
                updatedAt: new Date().toISOString(),
              }
            : row,
        ),
      );

      try {
        const saved = await videoApi.sync(sessionId, {
          offsetMs: nextOffsetMs,
          sync: resolvedSync,
          videoId: video.id,
          placementSource: 'manual',
          placementConfidence: 'low',
        });
        setSessionVideos((prev) =>
          prev.map((row, index) =>
            (saved.id ? row.id === saved.id : index === 0) ? saved : row,
          ),
        );
      } catch (error) {
        setVideoControlError(getErrorMessage(error));
      }
    },
    [
      getLocalVideoRow,
      saveWorkspaceVideoBinding,
      effectiveTrackTimeOriginUnixMs,
      sessionId,
    ],
  );

  const updateActiveSync = useCallback(
    async (nextSync: VideoSyncBinding) => {
      if (!syncDialogVideo) return;
      await applyVideoSyncForSource(syncDialogVideo, nextSync);
    },
    [applyVideoSyncForSource, syncDialogVideo],
  );

  const moveClipToTrack = useCallback(
    async (video: ActiveVideoSource, target: VideoTrackTarget) => {
      if (!sessionId) return;

      const localRow = getLocalVideoRow(video);

      if (video.origin === 'local') {
        setLocalVideos((prev) =>
          prev.map((row) =>
            localVideoKey(row.signature) === video.key
              ? {
                  ...row,
                  videoTrackId: target.id,
                  videoTrackName: target.name,
                }
              : row,
          ),
        );
        if (localRow?.sourceKind === 'workspace' && localRow.workspaceRelativePath) {
          try {
            await saveWorkspaceVideoBinding({
              relativePath: localRow.workspaceRelativePath,
              fileName: localRow.file.name,
              label: localRow.label ?? localRow.file.name,
              videoType: localRow.videoType,
              videoTrackId: target.id,
              videoTrackName: target.name,
              offsetMs: localRow.offsetMs,
              sync: localRow.sync,
              placementSource: localRow.placementSource,
              placementConfidence: localRow.placementConfidence,
            });
          } catch (error) {
            setVideoControlError(getErrorMessage(error));
          }
        }
        setVideoTargetTrackId(target.id);
        setVideoNewTrackName('');
        return;
      }

      setSessionVideos((prev) =>
        prev.map((row, index) =>
          (video.id ? row.id === video.id : index === 0)
            ? {
                ...row,
                videoTrackId: target.id,
                videoTrackName: target.name,
                updatedAt: new Date().toISOString(),
              }
            : row,
        ),
      );

      try {
        const saved = await videoApi.sync(sessionId, {
          offsetMs: video.offsetMs,
          sync: video.sync,
          videoId: video.id,
          videoTrackId: target.id,
          videoTrackName: target.name,
          placementSource: video.placementSource,
          placementConfidence: video.placementConfidence,
        });
        setSessionVideos((prev) =>
          prev.map((row, index) =>
            (saved.id ? row.id === saved.id : index === 0) ? saved : row,
          ),
        );
        setVideoTargetTrackId(target.id);
        setVideoNewTrackName('');
      } catch (error) {
        setVideoControlError(getErrorMessage(error));
      }
    },
    [getLocalVideoRow, saveWorkspaceVideoBinding, sessionId],
  );

  const updateVideoOffsetForClipKey = useCallback(
    async (clipKey: string, nextOffsetMs: number) => {
      const src = videoSources.find((video) => video.key === clipKey);
      if (!src) return;
      const nextSync = createOffsetOnlyVideoSync(Math.round(nextOffsetMs), {
        trackTimeOriginUnixMs: effectiveTrackTimeOriginUnixMs,
        source: 'manual-video-track',
        confidence: 'low',
      });
      await applyVideoSyncForSource(src, nextSync);
    },
    [applyVideoSyncForSource, effectiveTrackTimeOriginUnixMs, videoSources],
  );

  const updateActiveOffset = useCallback(
    async (nextOffsetMs: number) => {
      if (!syncDialogVideo) return;
      await updateVideoOffsetForClipKey(syncDialogVideo.key, nextOffsetMs);
    },
    [syncDialogVideo, updateVideoOffsetForClipKey],
  );

  const buildShiftedVideoSync = useCallback(
    (video: ActiveVideoSource, deltaMs: number): VideoSyncBinding => {
      const nextOffsetMs = Math.round(video.offsetMs + deltaMs);
      if (!video.sync) {
        return createOffsetOnlyVideoSync(nextOffsetMs, {
          trackTimeOriginUnixMs: effectiveTrackTimeOriginUnixMs,
          source: 'manual-video-track',
          confidence: 'low',
        });
      }

      return normalizeVideoSyncBinding(
        nextOffsetMs,
        {
          ...video.sync,
          offsetMs: nextOffsetMs,
          anchors: video.sync.anchors.map((anchor) => ({
            ...anchor,
            trackTimeMs: Math.round(anchor.trackTimeMs + deltaMs),
          })),
          updatedAt: new Date().toISOString(),
        },
        { trackTimeOriginUnixMs: effectiveTrackTimeOriginUnixMs },
      );
    },
    [effectiveTrackTimeOriginUnixMs],
  );

  const shiftVideoTrackByMs = useCallback(
    async (trackId: string, deltaMs: number) => {
      if (!sessionId) return;
      const track = videoTimelineTracks.find((item) => item.id === trackId);
      if (!track || track.clips.length === 0) return;

      const shiftedByKey = new Map<
        string,
        { offsetMs: number; sync: VideoSyncBinding }
      >();
      track.clips.forEach((clip) => {
        const sync = buildShiftedVideoSync(clip.source, deltaMs);
        shiftedByKey.set(clip.source.key, {
          offsetMs: sync.offsetMs,
          sync,
        });
      });

      setVideoBusy(true);
      setVideoControlError(null);

      setLocalVideos((prev) =>
        prev.map((video) => {
          const shifted = shiftedByKey.get(localVideoKey(video.signature));
          return shifted
            ? {
                ...video,
                offsetMs: shifted.offsetMs,
                sync: shifted.sync,
                placementSource: 'manual',
                placementConfidence: 'low',
              }
            : video;
        }),
      );
      setSessionVideos((prev) =>
        prev.map((video) => {
          const shifted = shiftedByKey.get(remoteVideoKey(video));
          return shifted
            ? {
                ...video,
                offsetMs: shifted.offsetMs,
                sync: shifted.sync,
                placementSource: 'manual',
                placementConfidence: 'low',
                updatedAt: new Date().toISOString(),
              }
            : video;
        }),
      );

      try {
        await Promise.all(
          localVideos
            .filter((video) => shiftedByKey.has(localVideoKey(video.signature)))
            .map((video) => {
              const shifted = shiftedByKey.get(localVideoKey(video.signature));
              if (
                !shifted ||
                video.sourceKind !== 'workspace' ||
                !video.workspaceRelativePath
              ) {
                return Promise.resolve();
              }
              return saveWorkspaceVideoBinding({
                relativePath: video.workspaceRelativePath,
                fileName: video.file.name,
                label: video.label ?? video.file.name,
                videoType: video.videoType,
                videoTrackId: video.videoTrackId,
                videoTrackName: video.videoTrackName,
                offsetMs: shifted.offsetMs,
                sync: shifted.sync,
                placementSource: 'manual',
                placementConfidence: 'low',
              });
            }),
        );

        const savedRemoteVideos = await Promise.all(
          sessionVideos
            .filter((video) => shiftedByKey.has(remoteVideoKey(video)))
            .map((video) => {
              const shifted = shiftedByKey.get(remoteVideoKey(video))!;
              return videoApi.sync(sessionId, {
                offsetMs: shifted.offsetMs,
                sync: shifted.sync,
                videoId: video.id,
                videoTrackId: video.videoTrackId,
                videoTrackName: video.videoTrackName,
                placementSource: 'manual',
                placementConfidence: 'low',
              });
            }),
        );

        if (savedRemoteVideos.length > 0) {
          setSessionVideos((prev) =>
            prev.map((video, index) => {
              const saved = savedRemoteVideos.find((item) =>
                item.id ? item.id === video.id : index === 0,
              );
              return saved ?? video;
            }),
          );
        }
      } catch (error) {
        setVideoControlError(getErrorMessage(error));
      } finally {
        setVideoBusy(false);
      }
    },
    [
      buildShiftedVideoSync,
      localVideos,
      saveWorkspaceVideoBinding,
      sessionId,
      sessionVideos,
      videoTimelineTracks,
    ],
  );

  const handleCommitVideoClipOffsetFromTimeline = useCallback(
    (ms: number, clipKey: string) => {
      setTimelineDraftClip(null);
      void updateVideoOffsetForClipKey(clipKey, Math.round(ms));
    },
    [updateVideoOffsetForClipKey],
  );

  const handleLinkVideo = useCallback(async (target?: VideoTrackTarget & { videoType?: VideoType }) => {
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
      const targetTrack =
        target ??
        resolveVideoTrackTarget({
          selectedTrackId: videoTargetTrackId,
          newTrackName: videoNewTrackName,
          existingTracks: videoTimelineTracks,
          sessionId,
        });
      const placement: VideoPlacement = {
        offsetMs: getTrackAppendStartMs(targetTrack.id),
        placementSource: 'sequential-fallback',
        placementConfidence: 'low',
      };
      const initialSync = createOffsetOnlyVideoSync(placement.offsetMs, {
        trackTimeOriginUnixMs: effectiveTrackTimeOriginUnixMs,
        source: 'manual-video-track',
        confidence: 'low',
      });
      const linked = await videoApi.link(sessionId, {
        videoUrl: trimmed,
        videoType: target?.videoType ?? videoDraftType,
        videoTrackId: targetTrack.id,
        videoTrackName: targetTrack.name,
        label: deriveVideoLabelFromUrl(trimmed),
        offsetMs: initialSync.offsetMs,
        sync: initialSync,
        placementSource: placement.placementSource,
        placementConfidence: placement.placementConfidence,
      });
      setSessionVideos((prev) => [...prev, linked]);
      setVideoTargetTrackId(linked.videoTrackId ?? targetTrack.id);
      setVideoNewTrackName('');
      setVideoDraftUrl(linked.url);
      setVideoDraftType(linked.videoType);
      setVideoStageError(null);
      setVideoClockMs(0);
      setVideoDurationMs(0);
      setVideoStageReady(false);
      setSyncSessionTimeMs(0);
      setSyncVideoTimeMs(0);
      setVideoNeedsReview(true);
    } catch (error) {
      setVideoControlError(getErrorMessage(error));
    } finally {
      setVideoBusy(false);
    }
  }, [
    effectiveTrackTimeOriginUnixMs,
    getTrackAppendStartMs,
    sessionId,
    videoDraftType,
    videoDraftUrl,
    videoNewTrackName,
    videoTargetTrackId,
    videoTimelineTracks,
  ]);

  const handleSelectLocalVideos = useCallback(
    async (files: File[], target?: VideoTrackTarget & { videoType?: VideoType }) => {
      if (files.length === 0 || !sessionId) return;
      try {
        setVideoControlError(null);
        const targetTrack =
          target ??
          resolveVideoTrackTarget({
            selectedTrackId: videoTargetTrackId,
            newTrackName: videoNewTrackName,
            existingTracks: videoTimelineTracks,
            sessionId,
          });
        const pendingClipEnds: number[] = [];

        for (const file of files) {
          const signature = getLocalVideoSignature(file);
          const savedPrefs = loadLocalVideoPrefs(sessionId, signature);
          const [durationMs, detected] = await Promise.all([
            readVideoFileDurationMs(file).catch(() => 0),
            savedPrefs ? Promise.resolve(null) : detectVideoTypeFromFile(file),
          ]);
          const placement = getDefaultPlacementForFile(
            file,
            targetTrack.id,
            durationMs,
            pendingClipEnds,
          );
          const nextSync = createOffsetOnlyVideoSync(placement.offsetMs, {
            trackTimeOriginUnixMs: effectiveTrackTimeOriginUnixMs,
            source:
              placement.placementSource === 'file-time'
                ? 'auto-file-time'
                : 'manual-video-track',
            confidence: placement.placementConfidence,
          });
          applyLocalVideoSelection(file, {
            sourceKind: 'file_picker',
            label: file.name,
            nextVideoType: target?.videoType ?? detected?.videoType,
            nextOffsetMs: placement.offsetMs,
            nextSync,
            videoTrackId: targetTrack.id,
            videoTrackName: targetTrack.name,
            placementSource: placement.placementSource,
            placementConfidence: placement.placementConfidence,
            promptReview: true,
          });
          if (durationMs > 0) {
            setVideoDurationsByKey((prev) => ({
              ...prev,
              [localVideoKey(signature)]: durationMs,
            }));
          }
        }
        setVideoTargetTrackId(targetTrack.id);
        setVideoNewTrackName('');
      } catch (error) {
        setVideoControlError(getErrorMessage(error));
      }
    },
    [
      applyLocalVideoSelection,
      effectiveTrackTimeOriginUnixMs,
      getDefaultPlacementForFile,
      sessionId,
      videoNewTrackName,
      videoTargetTrackId,
      videoTimelineTracks,
    ],
  );

  const loadWorkspaceVideoIntoPlayer = useCallback(
    async (
      relativePath: string,
      options?: {
        label?: string;
        nextVideoType?: VideoType;
        nextOffsetMs?: number;
        nextSync?: VideoSyncBinding;
        videoTrackId?: string;
        videoTrackName?: string;
        placementSource?: VideoPlacementSource;
        placementConfidence?: VideoPlacementConfidence;
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
      const targetTrack =
        options?.videoTrackId && options.videoTrackName
          ? { id: options.videoTrackId, name: options.videoTrackName }
          : resolveVideoTrackTarget({
              selectedTrackId: videoTargetTrackId,
              newTrackName: videoNewTrackName,
              existingTracks: videoTimelineTracks,
              sessionId,
            });
      const durationMs = await readVideoFileDurationMs(file).catch(() => 0);
      const placement =
        options?.nextOffsetMs != null
          ? {
              offsetMs: options.nextOffsetMs,
              placementSource: options.placementSource ?? savedPrefs?.placementSource ?? 'manual',
              placementConfidence:
                options.placementConfidence ?? savedPrefs?.placementConfidence ?? 'low',
            }
          : getDefaultPlacementForFile(file, targetTrack.id, durationMs);
      const nextOffsetMs = placement.offsetMs;
      const nextSync = normalizeVideoSyncBinding(
        nextOffsetMs,
        options?.nextSync ??
          savedPrefs?.sync ??
          createOffsetOnlyVideoSync(nextOffsetMs, {
            trackTimeOriginUnixMs: effectiveTrackTimeOriginUnixMs,
            source:
              placement.placementSource === 'file-time'
                ? 'auto-file-time'
                : 'manual-video-track',
            confidence: placement.placementConfidence,
          }),
        { trackTimeOriginUnixMs: effectiveTrackTimeOriginUnixMs },
      );

      applyLocalVideoSelection(file, {
        sourceKind: 'workspace',
        workspaceRelativePath: relativePath,
        label: options?.label ?? file.name,
        nextVideoType,
        nextOffsetMs: nextSync.offsetMs,
        nextSync,
        videoTrackId: targetTrack.id,
        videoTrackName: targetTrack.name,
        placementSource: placement.placementSource,
        placementConfidence: placement.placementConfidence,
        promptReview: options?.promptReview,
      });
      if (durationMs > 0) {
        setVideoDurationsByKey((prev) => ({
          ...prev,
          [localVideoKey(signature)]: durationMs,
        }));
      }
      await saveWorkspaceVideoBinding({
        relativePath,
        fileName: file.name,
        label: options?.label ?? file.name,
        videoType: nextVideoType,
        videoTrackId: targetTrack.id,
        videoTrackName: targetTrack.name,
        offsetMs: nextSync.offsetMs,
        sync: nextSync,
        placementSource: placement.placementSource,
        placementConfidence: placement.placementConfidence,
      });
      setVideoTargetTrackId(targetTrack.id);
      setVideoNewTrackName('');
    },
    [
      applyLocalVideoSelection,
      currentWorkspace,
      effectiveTrackTimeOriginUnixMs,
      getDefaultPlacementForFile,
      saveWorkspaceVideoBinding,
      sessionId,
      videoDraftType,
      videoNewTrackName,
      videoTargetTrackId,
      videoTimelineTracks,
    ],
  );

  const handleSelectWorkspaceVideo = useCallback(
    async (video: WorkspaceVideoFileSummary, target?: ManagedVideoTrack) => {
      try {
        setVideoControlError(null);
        await loadWorkspaceVideoIntoPlayer(video.relativePath, {
          label: video.name,
          nextVideoType: target?.videoType,
          videoTrackId: target?.id,
          videoTrackName: target?.label,
          promptReview: true,
        });
      } catch (error) {
        setVideoControlError(getErrorMessage(error));
      }
    },
    [loadWorkspaceVideoIntoPlayer],
  );

  useEffect(() => {
    if (!sessionId || hasAppliedPreboundVideoRef.current) return;

    const preboundVideos =
      replayNavigationState?.preboundVideos ??
      (replayNavigationState?.preboundVideo ? [replayNavigationState.preboundVideo] : []);
    const workspacePreboundVideos = preboundVideos.filter(
      (video) => video.kind === 'workspace_video',
    );
    const localPreboundVideos = preboundVideos.filter(
      (video) => video.kind === 'local_file' && video.file,
    );

    if (preboundVideos.length === 0 && !currentWorkspace) {
      hasAppliedPreboundVideoRef.current = true;
      return;
    }

    if (workspacePreboundVideos.length > 0 && !currentWorkspace) {
      return;
    }

    if (preboundVideos.length > 0) {
      hasAppliedPreboundVideoRef.current = true;
      void Promise.all([
        ...workspacePreboundVideos.map((video) =>
          loadWorkspaceVideoIntoPlayer(video.relativePath ?? '', {
            label: video.label ?? video.fileName,
            nextVideoType: video.videoType,
            nextOffsetMs: video.offsetMs,
            nextSync: video.sync,
            videoTrackId: video.videoTrackId,
            videoTrackName: video.videoTrackName,
            placementSource: video.placementSource,
            placementConfidence: video.placementConfidence,
            promptReview: video.promptSync,
          }),
        ),
        ...localPreboundVideos.map((video) => {
          applyLocalVideoSelection(video.file!, {
            sourceKind: 'file_picker',
            label: video.label ?? video.fileName,
            nextVideoType: video.videoType,
            nextOffsetMs: video.offsetMs,
            nextSync: video.sync,
            videoTrackId: video.videoTrackId,
            videoTrackName: video.videoTrackName,
            placementSource: video.placementSource,
            placementConfidence: video.placementConfidence,
            promptReview: video.promptSync,
          });
          return Promise.resolve();
        }),
      ])
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

    const workspaceBindings =
      sessionBindings?.videos.filter(
        (binding) =>
          binding.storageMode === 'workspace_relative_ref' &&
          Boolean(binding.path),
      ) ?? [];
    if (
      currentWorkspace &&
      workspaceBindings.length > 0
    ) {
      hasAppliedPreboundVideoRef.current = true;
      void Promise.all(
        workspaceBindings.map((binding) =>
          loadWorkspaceVideoIntoPlayer(
            getWorkspaceRelativeBindingPath(binding.path),
            {
              label: binding.label ?? binding.fileName,
              nextVideoType: binding.videoType,
              nextOffsetMs: binding.offsetMs,
              nextSync: binding.sync,
              videoTrackId: binding.videoTrackId,
              videoTrackName: binding.videoTrackName,
              placementSource: binding.placementSource,
              placementConfidence: binding.placementConfidence,
              promptReview: false,
            },
          ),
        ),
      ).catch((error) => {
        setVideoControlError(getErrorMessage(error));
      });
      return;
    }

    if (preboundVideos.length === 0 && (!currentWorkspace || sessionBindingsLoaded)) {
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
    replayNavigationState?.preboundVideos,
    sessionBindings,
    sessionBindingsLoaded,
    sessionId,
  ]);

  const handleChooseFile = useCallback((trackId?: string) => {
    setVideoFilePickerTrackId(trackId ?? expandedVideoTrackId);
    fileInputRef.current?.click();
  }, [expandedVideoTrackId]);

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

  const handleRemoveManageClip = useCallback(async () => {
    const target = manageClipDetailVideo;
    if (!sessionId || !target) return;

    setVideoControlError(null);

    if (target.origin === 'local') {
      const row = getLocalVideoRow(target);
      if (row?.sourceKind === 'workspace' && row.workspaceRelativePath) {
        try {
          await removeWorkspaceVideoBinding(row.workspaceRelativePath);
        } catch (error) {
          setVideoControlError(getErrorMessage(error));
          return;
        }
      }
      removeLocalClipByKey(target.key);
      setManageClipDetailKey(null);
      setVideoNeedsReview(false);
      return;
    }

    setVideoBusy(true);
    try {
      await videoApi.remove(sessionId, target.id);
      setSessionVideos((prev) =>
        target.id ? prev.filter((video) => video.id !== target.id) : prev.slice(1),
      );
      setVideoDraftUrl('');
      setVideoStageError(null);
      setVideoClockMs(0);
      setVideoDurationMs(0);
      setVideoStageReady(false);
      setSyncSessionTimeMs(0);
      setSyncVideoTimeMs(0);
      setVideoNeedsReview(false);
      setManageClipDetailKey(null);
    } catch (error) {
      setVideoControlError(getErrorMessage(error));
    } finally {
      setVideoBusy(false);
    }
  }, [
    getLocalVideoRow,
    manageClipDetailVideo,
    removeLocalClipByKey,
    removeWorkspaceVideoBinding,
    sessionId,
  ]);

  const handleOpenSync = useCallback(() => {
    const key = primaryStageVideo?.key ?? videoSources[0]?.key ?? null;
    if (!key) return;
    setSyncDialogClipKey(key);
    resumeAfterSyncRef.current = isPlaying;
    setIsPlaying(false);
    setSyncSessionTimeMs(currentTime);
    setSyncVideoTimeMs(videoClocksByKey[key] ?? videoClockMs);
    setSyncDialogOpen(true);
    setVideoNeedsReview(false);
  }, [
    currentTime,
    isPlaying,
    primaryStageVideo?.key,
    videoClockMs,
    videoClocksByKey,
    videoSources,
  ]);

  const handleResetManageClipOffset = useCallback(() => {
    const v = manageClipDetailVideo;
    if (!v) return;
    const row = getLocalVideoRow(v);
    const defaultSync =
      v.origin === 'local' && row
        ? getDefaultSyncForFile(row.file, videoDurationsByKey[v.key] ?? 0)
        : createOffsetOnlyVideoSync(0, {
            trackTimeOriginUnixMs: effectiveTrackTimeOriginUnixMs,
            source: 'manual-video-track',
            confidence: 'low',
          });
    void applyVideoSyncForSource(v, defaultSync);
  }, [
    applyVideoSyncForSource,
    getDefaultSyncForFile,
    getLocalVideoRow,
    manageClipDetailVideo,
    effectiveTrackTimeOriginUnixMs,
    videoDurationsByKey,
  ]);

  const handleOpenSyncForManageClip = useCallback(() => {
    const v = manageClipDetailVideo;
    if (!v) return;
    setManageClipDetailKey(null);
    setSyncDialogClipKey(v.key);
    resumeAfterSyncRef.current = isPlaying;
    setIsPlaying(false);
    setSyncSessionTimeMs(currentTime);
    setSyncVideoTimeMs(videoClocksByKey[v.key] ?? 0);
    setSyncDialogOpen(true);
    setVideoNeedsReview(false);
  }, [currentTime, isPlaying, manageClipDetailVideo, videoClocksByKey]);

  const handleCloseSync = useCallback(() => {
    setCurrentTime(syncSessionTimeMs);
    setSyncDialogOpen(false);
    setSyncDialogClipKey(null);
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
      { trackTimeOriginUnixMs: effectiveTrackTimeOriginUnixMs },
    );
    void updateActiveSync(nextSync);
  }, [
    currentTime,
    effectiveTrackTimeOriginUnixMs,
    syncDialogOpen,
    syncSessionTimeMs,
    syncVideoTimeMs,
    updateActiveSync,
    videoClockMs,
  ]);

  const handleBindVideoRealTime = useCallback(
    (realUnixMs: number) => {
      const trackTimeMs = trackTimeFromRealTime(realUnixMs, effectiveTrackTimeOriginUnixMs);
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
        { trackTimeOriginUnixMs: effectiveTrackTimeOriginUnixMs },
      );
      setSyncSessionTimeMs(trackTimeMs);
      setCurrentTime(trackTimeMs);
      setVideoControlError(null);
      void updateActiveSync(nextSync);
    },
    [
      effectiveTrackTimeOriginUnixMs,
      syncDialogOpen,
      syncVideoTimeMs,
      totalDuration,
      updateActiveSync,
      videoClockMs,
    ],
  );

  const handleResetOffsetToDefault = useCallback(() => {
    const v = syncDialogVideo;
    if (!v) return;
    const row = getLocalVideoRow(v);
    const defaultSync =
      v.origin === 'local' && row
        ? getDefaultSyncForFile(row.file, videoDurationsByKey[v.key] ?? 0)
        : createOffsetOnlyVideoSync(0, {
            trackTimeOriginUnixMs: effectiveTrackTimeOriginUnixMs,
            source: 'manual-video-track',
            confidence: 'low',
          });
    void updateActiveSync(defaultSync);
  }, [
    getDefaultSyncForFile,
    getLocalVideoRow,
    effectiveTrackTimeOriginUnixMs,
    syncDialogVideo,
    updateActiveSync,
    videoDurationsByKey,
  ]);

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
      const cap =
        syncDialogOpen && syncDialogVideo
          ? videoDurationsByKey[syncDialogVideo.key] ?? videoDurationMs
          : videoDurationMs;
      const nextTimeMs = Math.max(0, Math.min(timeMs, cap || timeMs));
      setSyncVideoTimeMs(nextTimeMs);
    },
    [syncDialogOpen, syncDialogVideo, videoDurationsByKey, videoDurationMs],
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
        telemetryDatasets={telemetryDatasets}
        telemetryWindow={telemetryLoadWindow}
        telemetryTimeOriginMs={workspaceWindowEffective.startMs}
      />
    ),
    [
      chartPlayheadRatio,
      chartSelectionRange,
      handleChartSeek,
      handleRangeSelection,
      manualWind?.dir,
      telemetryWorkspace,
      telemetryDatasets,
      telemetryLoadWindow,
      themeId,
      workspaceDurationMs,
      workspaceWindowEffective,
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
      const syncOverlay =
        syncDialogOpen && syncDialogClipKey != null && video.key === syncDialogClipKey;
      const mirrorGlobalClock = syncOverlay || video.key === primaryStageVideo?.key;
      const rawVideoTimeMs = syncOverlay ? syncVideoTimeMs : currentTime - video.offsetMs;
      const videoHasStarted = rawVideoTimeMs >= 0;
      const targetVideoTimeMs = syncOverlay
        ? Math.max(0, Math.min(syncVideoTimeMs, durationMs || Number.MAX_SAFE_INTEGER))
        : Math.max(
            0,
            Math.min(
              currentTime - video.offsetMs,
              durationMs || Number.MAX_SAFE_INTEGER,
            ),
          );
      const completionNotice = !syncOverlay
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
          isPlaying={syncOverlay ? false : isPlaying && videoHasStarted}
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
            if (mirrorGlobalClock) {
              setVideoClockMs((prev) =>
                shouldStoreVideoClock(prev, timeMs) ? timeMs : prev,
              );
            }
          }}
          onDurationChange={(durationMs) => {
            setVideoDurationsByKey((prev) =>
              prev[video.key] === durationMs ? prev : { ...prev, [video.key]: durationMs },
            );
            if (mirrorGlobalClock) {
              setVideoDurationMs((prev) => (prev === durationMs ? prev : durationMs));
            }
          }}
          onReadyChange={setVideoStageReady}
          onErrorChange={setVideoStageError}
        />
      );
    },
    [
      currentPoint,
      currentTime,
      isPlaying,
      nearestEvent,
      playbackSpeed,
      primaryStageVideo?.key,
      selectedEvent,
      selectedMark,
      selection.range,
      session?.name,
      syncDialogClipKey,
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
      const video = videoKey ? resolveVideoForTimelineTrack(videoKey) : null;
      return renderVideoStageFor(video, stageLayoutMode === 'split' ? 'split' : 'overlay', 'h-full');
    },
    [
      renderMapCanvas,
      renderTelemetryStage,
      renderVideoStageFor,
      resolveVideoForTimelineTrack,
      stageLayoutMode,
    ],
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
  const summaryWindLabel =
    windDir != null && windSpeed != null
      ? `${Math.round(windDir)} deg / ${windSpeed.toFixed(1)} kts`
      : 'No data';
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
        } · ${activeVideo.videoTrackName} · ${activeVideo.videoType === '360' ? '360' : 'Flat'}`
      : `Linked URL · ${activeVideo.videoTrackName} · ${activeVideo.videoType === '360' ? '360' : 'Flat'}`
    : 'No video attached';
  const videoFeedback = videoControlError ?? videoStageError;
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
    ? `${videoTimelineTracks.length} track${videoTimelineTracks.length > 1 ? 's' : ''} / ${videoSources.length} clip${videoSources.length > 1 ? 's' : ''}`
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
  const splitGridClass =
    splitDirection === 'top-bottom'
      ? 'relative grid min-h-[420px] flex-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-px bg-black/20 lg:min-h-0'
      : 'relative grid min-h-[420px] flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-px bg-black/20 lg:min-h-0';
  const splitPrimaryLabel = splitDirection === 'top-bottom' ? 'Top' : 'Left';
  const splitSecondaryLabel = splitDirection === 'top-bottom' ? 'Bottom' : 'Right';

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
              <button
                type="button"
                onClick={() => setSessionSummaryOpen(true)}
                className={`min-w-[130px] max-w-[205px] shrink border px-2 py-1.5 text-left transition-colors ${s.divider} ${s.cardHover} ${
                  isRound ? 'rounded-xl' : 'rounded-sm'
                }`}
                title="Open session summary"
              >
                <p className={sectionLabelClass}>Metadata</p>
                <h1 className={`truncate text-base font-semibold md:text-lg ${s.textPrimary}`}>
                  {session.name}
                </h1>
              </button>

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
              {stageLayoutMode === 'split' ? (
                <div className={`flex shrink-0 items-center rounded-lg border ${s.divider} p-0.5`}>
                  <button
                    type="button"
                    onClick={() => setSplitDirection('left-right')}
                    className={`inline-flex h-8 w-8 items-center justify-center rounded-md transition ${
                      splitDirection === 'left-right' ? s.buttonPrimary : s.buttonSecondary
                    }`}
                    title="Left / right split"
                    aria-label="Left / right split"
                  >
                    <Columns2 className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setSplitDirection('top-bottom')}
                    className={`inline-flex h-8 w-8 items-center justify-center rounded-md transition ${
                      splitDirection === 'top-bottom' ? s.buttonPrimary : s.buttonSecondary
                    }`}
                    title="Top / bottom split"
                    aria-label="Top / bottom split"
                  >
                    <Rows2 className="h-4 w-4" />
                  </button>
                </div>
              ) : null}

              <button
                type="button"
                onClick={() => {
                  const targetTrackId =
                    activeVideo?.videoTrackId ?? managedVideoTracks[0]?.id ?? null;
                  setExpandedVideoTrackId(targetTrackId);
                  if (targetTrackId) setVideoTargetTrackId(targetTrackId);
                  setIsVideoDialogOpen(true);
                }}
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
                onClick={() => sensorInputRef.current?.click()}
                className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full border ${s.divider} px-2.5 py-1.5 text-sm ${s.textPrimary} transition-colors hover:bg-current/5`}
                title="Import sensor telemetry"
              >
                <Activity className="h-4 w-4" />
                <span>Sensor</span>
                {telemetryDatasets.length > 0 ? (
                  <span className={`ml-0.5 rounded-full px-1.5 py-0.5 text-[10px] ${s.buttonSecondary}`}>
                    {telemetryDatasets.length}
                  </span>
                ) : null}
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
              <input
                ref={sensorInputRef}
                type="file"
                accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
                multiple
                className="hidden"
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  if (files.length > 0) {
                    void handleImportSensorFiles(files);
                  }
                  event.currentTarget.value = '';
                }}
              />

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

                {sensorImportMessage ? (
                  <div className={`border-t ${s.divider} px-4 py-2 text-xs ${s.textSecondary}`}>
                    {sensorImportMessage}
                  </div>
                ) : null}

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
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    const files = Array.from(event.target.files ?? []);
                    const targetTrackId = videoFilePickerTrackId ?? expandedVideoTrackId;
                    const targetTrack = targetTrackId
                      ? managedVideoTracks.find((track) => track.id === targetTrackId)
                      : null;
                    if (files.length > 0 && targetTrack) {
                      void handleSelectLocalVideos(files, {
                        id: targetTrack.id,
                        name: targetTrack.label,
                        videoType: targetTrack.videoType,
                      });
                    } else if (files.length > 0) {
                      setVideoControlError('Create or expand a video track before adding clips.');
                    }
                    setVideoFilePickerTrackId(null);
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
              className={splitGridClass}
            >
              <div className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-black">
                <StageContentSelect
                  label={splitPrimaryLabel}
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
                  label={splitSecondaryLabel}
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
          videoOffsetMs={primaryStageVideo?.offsetMs ?? 0}
          videoDurationMs={videoDurationMs}
          videoTracks={videoTimelineTracks.map((track) => ({
            id: track.id,
            label: track.label,
            clips: track.clips.map((clip) => ({
              id: clip.source.key,
              label: clip.source.label ?? clip.source.url,
              offsetMs: clip.source.offsetMs,
              durationMs: clip.durationMs,
            })),
          }))}
          draftVideoClip={timelineDraftClip}
          onDraftVideoClipOffset={setTimelineDraftClip}
          onCommitVideoClipOffset={handleCommitVideoClipOffsetFromTimeline}
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
          syncDisabled={!primaryStageVideo}
          syncLabel={
            !primaryStageVideo
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
                const eventMetricSummary = [
                  event.metrics?.headingChange != null
                    ? `HDG ${Math.round(event.metrics.headingChange)} deg`
                    : null,
                  event.metrics?.speedLoss != null
                    ? `Loss ${event.metrics.speedLoss.toFixed(1)} kts`
                    : null,
                  event.metrics?.distanceLoss != null
                    ? `Dist loss ${Math.round(event.metrics.distanceLoss)} m`
                    : null,
                ].filter((value): value is string => Boolean(value));
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
                    {eventMetricSummary.length > 0 ? (
                      <div className={`mt-1 text-xs ${s.textSecondary}`}>
                        {eventMetricSummary.join(' / ')}
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
                  <div className="flex items-start justify-between gap-3">
                    <div
                      className={`min-w-0 flex-1 font-medium transition-transform group-hover:translate-x-1 ${s.textPrimary}`}
                    >
                      {mark.name ?? mark.type}
                    </div>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleDeleteMark(mark);
                      }}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-red-500 opacity-70 transition-colors hover:bg-red-500/10 hover:opacity-100"
                      title="Delete mark"
                      aria-label={`Delete ${mark.name ?? mark.type}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
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
                telemetryDatasets={telemetryDatasets}
                telemetryWindow={telemetryLoadWindow}
                telemetryTimeOriginMs={workspaceWindowEffective.startMs}
              />
            </div>
          </div>
            </>
          )}
        </aside>

        {sessionSummaryOpen ? (
          <div
            className="fixed inset-0 z-[10040] flex items-end justify-center overflow-y-auto bg-black/55 p-3 backdrop-blur-sm sm:items-center sm:p-4"
            onClick={() => setSessionSummaryOpen(false)}
            role="presentation"
          >
            <div
              className="flex w-full justify-center"
              onClick={(event) => event.stopPropagation()}
              role="presentation"
            >
              <SessionSummaryCard
                session={session}
                telemetry={telemetry}
                marks={marks}
                eventCount={events.length}
                windLabel={summaryWindLabel}
                onClose={() => setSessionSummaryOpen(false)}
              />
            </div>
          </div>
        ) : null}

        {syncDialogVideo ? (
          <VideoSyncDialog
            isOpen={syncDialogOpen}
            sourceUrl={syncDialogVideo.url}
            videoType={syncDialogVideo.videoType}
            mediaLabel={syncDialogVideo.label ?? syncDialogVideo.url}
            crossOrigin={syncDialogVideo.crossOrigin}
            offsetMs={syncDialogVideo.offsetMs}
            sessionTimeMs={syncDialogOpen ? syncSessionTimeMs : currentTime}
            videoTimeMs={syncDialogOpen ? syncVideoTimeMs : videoClockMs}
            totalDurationMs={totalDuration}
            videoDurationMs={videoDurationsByKey[syncDialogVideo.key] ?? videoDurationMs}
            trackTimeOriginUnixMs={effectiveTrackTimeOriginUnixMs}
            anchorCount={syncDialogVideo.sync?.anchors.length ?? 0}
            sessionJumpOptions={syncSessionJumpOptions}
            onClose={handleCloseSync}
            onAlignCurrentFrame={handleAlignCurrentFrame}
            onBindVideoRealTime={handleBindVideoRealTime}
            onAdjustOffset={(deltaMs) => {
              void updateActiveOffset(syncDialogVideo.offsetMs + deltaMs);
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
                    Add clips to a camera track, move clips between tracks, or refine sync.
                  </p>
                </div>
                <button
                  onClick={() => {
                    setManageClipDetailKey(null);
                    setIsVideoDialogOpen(false);
                  }}
                  className={`p-1 hover:bg-current/10 rounded-full transition-colors ${s.textSecondary}`}
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className={`rounded-full border ${s.divider} px-3 py-1 text-xs ${s.textSecondary}`}>
                  {activeVideoSummary}
                </div>
                <div className={`rounded-full border ${s.divider} px-3 py-1 text-xs ${s.textSecondary}`}>
                  Stage:{' '}
                  {primaryStageVideo ? primaryStageVideo.label ?? primaryStageVideo.url : '—'}
                </div>
                <span className={`text-xs ${s.textSecondary}`}>
                  Tip: click any clip row to edit that video.
                </span>
              </div>

              <div className="flex items-center justify-between gap-3">
                <p className={`text-xs uppercase tracking-wider ${s.textSecondary}`}>
                  Video Tracks
                </p>
                <button
                  type="button"
                  onClick={handleAddManagedVideoTrack}
                  className={`inline-flex items-center gap-2 px-3 py-2 text-xs ${s.buttonSecondary}`}
                >
                  <Plus className="h-3.5 w-3.5" />
                  New Track
                </button>
              </div>

              {managedVideoTracks.length === 0 ? (
                <div className={`rounded-2xl border ${s.divider} p-4 text-sm ${s.textSecondary}`}>
                  Create a video track first, then add workspace, local, or URL clips into it.
                </div>
              ) : (
                <div className="flex max-h-[68vh] flex-col gap-3 overflow-y-auto pr-1">
                  {managedVideoTracks.map((track, trackIndex) => {
                    const isExpanded = expandedVideoTrackId === track.id;
                    const isActiveTrack = primaryStageVideo?.videoTrackId === track.id;
                    const trackName = track.label || `Video Track ${trackIndex + 1}`;
                    return (
                      <div
                        key={track.id}
                        className={`border ${s.divider} ${isActiveTrack ? s.accentBg : ''} ${
                          isRound ? 'rounded-2xl' : 'rounded-sm'
                        }`}
                      >
                        <div className="flex items-center gap-2 p-3">
                          <button
                            type="button"
                            onClick={() => {
                              setExpandedVideoTrackId((prev) =>
                                prev === track.id ? null : track.id,
                              );
                              setVideoTargetTrackId(track.id);
                              setVideoDraftType(track.videoType);
                            }}
                            className="flex min-w-0 flex-1 items-center gap-3 text-left"
                          >
                            {isExpanded ? (
                              <ChevronDown className={`h-4 w-4 shrink-0 ${s.textSecondary}`} />
                            ) : (
                              <ChevronRight className={`h-4 w-4 shrink-0 ${s.textSecondary}`} />
                            )}
                            <div className="min-w-0">
                              <div className={`truncate text-sm font-semibold ${s.textPrimary}`}>
                                {trackName}
                              </div>
                              <div className={`text-xs ${s.textSecondary}`}>
                                {track.videoType === '360' ? '360 video' : 'Flat video'} -{' '}
                                {track.clips.length} clip{track.clips.length === 1 ? '' : 's'}
                              </div>
                            </div>
                          </button>
                          {isActiveTrack ? (
                            <span className={`shrink-0 text-xs ${s.textSecondary}`}>
                              On stage
                            </span>
                          ) : null}
                          {track.draftOnly ? (
                            <button
                              type="button"
                              onClick={() => {
                                setVideoTrackDrafts((prev) => {
                                  const next = { ...prev };
                                  delete next[track.id];
                                  return next;
                                });
                                setExpandedVideoTrackId((prev) => (prev === track.id ? null : prev));
                              }}
                              className={`shrink-0 text-xs ${s.textSecondary} hover:opacity-70`}
                            >
                              Remove
                            </button>
                          ) : null}
                        </div>

                        {isExpanded ? (
                          <div className={`border-t ${s.divider} p-3 flex flex-col gap-4`}>
                            <div className="grid gap-3 md:grid-cols-2">
                              <div className="flex flex-col gap-2">
                                <label className={`text-xs uppercase tracking-wider ${s.textSecondary}`}>
                                  Track Name
                                </label>
                                <input
                                  type="text"
                                  value={videoTrackDrafts[track.id]?.name ?? trackName}
                                  onChange={(event) =>
                                    updateManagedVideoTrackDraft(track, {
                                      name: event.target.value,
                                    })
                                  }
                                  onBlur={(event) =>
                                    void commitManagedVideoTrackConfig(track, {
                                      name: event.target.value,
                                    })
                                  }
                                  className={`w-full px-3 py-2 text-sm rounded-lg ${s.input}`}
                                />
                              </div>
                              <div className="flex flex-col gap-2">
                                <label className={`text-xs uppercase tracking-wider ${s.textSecondary}`}>
                                  Video Type
                                </label>
                                <select
                                  value={videoTrackDrafts[track.id]?.videoType ?? track.videoType}
                                  onChange={(event) => {
                                    const nextType = event.target.value as VideoType;
                                    updateManagedVideoTrackDraft(track, { videoType: nextType });
                                    void commitManagedVideoTrackConfig(track, {
                                      videoType: nextType,
                                    });
                                  }}
                                  className={`w-full px-3 py-2 text-sm rounded-lg ${s.input}`}
                                >
                                  <option value="flat">Flat video</option>
                                  <option value="360">360 video</option>
                                </select>
                              </div>
                            </div>

                            {manageClipDetailVideo &&
                            manageClipDetailVideo.videoTrackId !== track.id ? (
                              <button
                                type="button"
                                onClick={() =>
                                  void moveClipToTrack(manageClipDetailVideo, {
                                    id: track.id,
                                    name: trackName,
                                  })
                                }
                                disabled={videoBusy}
                                className={`px-3 py-2 text-sm ${s.buttonSecondary} ${
                                  videoBusy ? 'opacity-50 cursor-wait' : ''
                                }`}
                              >
                                Move selected clip here
                              </button>
                            ) : null}

                            {track.clips.length > 0 ? (
                              <div className="flex flex-col gap-2">
                                <p className={`text-xs uppercase tracking-wider ${s.textSecondary}`}>
                                  Clips
                                </p>
                                <div className="grid gap-2">
                                  {track.clips.map((clip) => {
                                    const video = clip.source;
                                    const isManaging = manageClipDetailKey === video.key;
                                    const localClip = localVideos.find(
                                      (item) => localVideoKey(item.signature) === video.key,
                                    );
                                    const originLabel =
                                      video.origin === 'remote'
                                        ? 'URL'
                                        : localClip?.sourceKind === 'workspace'
                                          ? 'Workspace'
                                          : 'Local';
                                    return (
                                      <button
                                        key={video.key}
                                        type="button"
                                        onClick={() => setManageClipDetailKey(video.key)}
                                        className={`px-3 py-2 text-left text-xs transition-colors ${
                                          isManaging ? s.buttonPrimary : s.buttonSecondary
                                        } ${isRound ? 'rounded-xl' : 'rounded-sm'}`}
                                      >
                                        <div className={`truncate font-medium ${s.textPrimary}`}>
                                          {video.label ?? video.url}
                                        </div>
                                        <div className={`truncate ${s.textSecondary}`}>
                                          {originLabel} - {(video.offsetMs / 1000).toFixed(1)}s -{' '}
                                          {clip.durationMs > 0
                                            ? formatTimestamp(clip.durationMs)
                                            : 'duration pending'}
                                        </div>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            ) : null}

                            {track.clips.length > 0 ? (
                              <div>
                                <p className={`text-xs uppercase tracking-wider ${s.textSecondary}`}>
                                  Track Sync
                                </p>
                                <div className="mt-2 grid grid-cols-4 gap-1.5">
                                  {[
                                    { label: '-5s', deltaMs: -5000 },
                                    { label: '-1s', deltaMs: -1000 },
                                    { label: '+1s', deltaMs: 1000 },
                                    { label: '+5s', deltaMs: 5000 },
                                  ].map((item) => (
                                    <button
                                      key={item.label}
                                      type="button"
                                      onClick={() => {
                                        void shiftVideoTrackByMs(track.id, item.deltaMs);
                                      }}
                                      disabled={videoBusy}
                                      className={`px-2 py-1.5 text-xs ${s.buttonSecondary} ${
                                        videoBusy ? 'opacity-50 cursor-wait' : ''
                                      } ${isRound ? 'rounded-lg' : 'rounded-sm'}`}
                                      title={`Shift every clip in ${trackName} by ${item.label}`}
                                    >
                                      {item.label}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            ) : null}

                            <div className={`flex flex-wrap gap-2 ${s.panel} p-1`}>
                              {(
                                [
                                  ['recommended', 'Recommended'],
                                  ['workspace', 'Workspace Videos'],
                                  ['local', 'Local Files'],
                                  ['url', 'Link URL'],
                                ] as const
                              ).map(([tabId, label]) => (
                                <button
                                  key={tabId}
                                  type="button"
                                  onClick={() => setVideoDialogTab(tabId)}
                                  className={`px-3 py-2 text-sm transition-all ${
                                    videoDialogTab === tabId
                                      ? `${s.accentBg} font-medium`
                                      : `${s.textSecondary} hover:opacity-70`
                                  } ${isRound ? 'rounded-xl' : 'rounded-sm'}`}
                                >
                                  {label}
                                </button>
                              ))}
                            </div>

                            {videoDialogTab === 'recommended' ? (
                              recommendedWorkspaceVideos.length > 0 ? (
                                <div className="grid gap-2">
                                  {recommendedWorkspaceVideos.map((video) => {
                                    const containingTrack = managedVideoTracks.find((candidate) =>
                                      candidate.clips.some((clip) => {
                                        const clipLocalVideo = localVideos.find(
                                          (item) => localVideoKey(item.signature) === clip.source.key,
                                        );
                                        return clipLocalVideo?.workspaceRelativePath === video.relativePath;
                                      }),
                                    );
                                    const isSelected = containingTrack?.id === track.id;
                                    return (
                                      <button
                                        key={video.relativePath}
                                        type="button"
                                        onClick={() => void handleSelectWorkspaceVideo(video, track)}
                                        className={`flex items-center justify-between gap-3 px-3 py-3 text-left transition-all ${
                                          isSelected ? `${s.accentBg}` : s.buttonSecondary
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
                                          {isSelected
                                            ? 'Added'
                                            : containingTrack
                                              ? 'Move Here'
                                              : 'Add Clip'}
                                        </span>
                                      </button>
                                    );
                                  })}
                                </div>
                              ) : (
                                <div className={`text-sm ${s.textSecondary}`}>
                                  No recommended workspace videos matched this session yet.
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
                                <div className="grid gap-2 max-h-[260px] overflow-y-auto">
                                  {[...recommendedWorkspaceVideos, ...otherWorkspaceVideos].map((video) => {
                                    const containingTrack = managedVideoTracks.find((candidate) =>
                                      candidate.clips.some((clip) => {
                                        const clipLocalVideo = localVideos.find(
                                          (item) => localVideoKey(item.signature) === clip.source.key,
                                        );
                                        return clipLocalVideo?.workspaceRelativePath === video.relativePath;
                                      }),
                                    );
                                    const isSelected = containingTrack?.id === track.id;
                                    return (
                                      <button
                                        key={video.relativePath}
                                        type="button"
                                        onClick={() => void handleSelectWorkspaceVideo(video, track)}
                                        className={`flex items-center justify-between gap-3 px-3 py-3 text-left transition-all ${
                                          isSelected ? `${s.accentBg}` : s.buttonSecondary
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
                                          {isSelected
                                            ? 'Added'
                                            : containingTrack
                                              ? 'Move Here'
                                              : video.collection === 'incoming'
                                                ? 'Incoming'
                                                : 'Library'}
                                        </span>
                                      </button>
                                    );
                                  })}
                                </div>
                              ) : (
                                <div className={`text-sm ${s.textSecondary}`}>
                                  No workspace videos found in incoming/video or library/video.
                                </div>
                              )
                            ) : null}

                            {videoDialogTab === 'local' ? (
                              <div className="flex flex-col gap-3">
                                <button
                                  type="button"
                                  onClick={() => handleChooseFile(track.id)}
                                  className={`flex items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm ${s.buttonSecondary}`}
                                >
                                  <Upload className="h-4 w-4" />
                                  {track.clips.some((clip) => {
                                    const localClip = localVideos.find(
                                      (item) => localVideoKey(item.signature) === clip.source.key,
                                    );
                                    return localClip?.sourceKind !== 'workspace';
                                  })
                                    ? 'Add Local Files'
                                    : 'Choose Local Files'}
                                </button>
                              </div>
                            ) : null}

                            {videoDialogTab === 'url' ? (
                              <div className="flex flex-col gap-3">
                                <label className={`text-xs uppercase tracking-wider ${s.textSecondary}`}>
                                  Link URL
                                </label>
                                <input
                                  type="url"
                                  value={videoDraftUrl}
                                  onChange={(event) => setVideoDraftUrl(event.target.value)}
                                  placeholder="https://example.com/session-video.mp4"
                                  className={`w-full px-3 py-2 text-sm rounded-lg ${s.input}`}
                                />
                                <button
                                  type="button"
                                  onClick={() =>
                                    void handleLinkVideo({
                                      id: track.id,
                                      name: trackName,
                                      videoType: track.videoType,
                                    })
                                  }
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
                                  Link URL to This Track
                                </button>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}

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

            {manageClipDetailVideo ? (
              <div
                className="absolute inset-0 z-[110] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
                onClick={() => setManageClipDetailKey(null)}
                role="presentation"
              >
                <div
                  className={`${s.panel} flex w-full max-w-lg flex-col gap-4 rounded-2xl border p-6 shadow-2xl`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className={`text-xs uppercase tracking-wider ${s.textSecondary}`}>
                        Selected clip
                      </p>
                      <h4 className={`truncate text-lg font-semibold ${s.textPrimary}`}>
                        {manageClipDetailVideo.label ?? manageClipDetailVideo.url}
                      </h4>
                      <p className={`mt-1 text-xs ${s.textSecondary}`}>
                        {manageClipDetailVideo.videoTrackName} · offset{' '}
                        {(manageClipDetailVideo.offsetMs / 1000).toFixed(1)}s ·{' '}
                        {manageClipDetailVideo.videoType === '360' ? '360°' : 'Flat'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setManageClipDetailKey(null)}
                      className={`shrink-0 rounded-full p-1 transition-colors hover:bg-current/10 ${s.textSecondary}`}
                      aria-label="Close clip settings"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                  <p className={`text-xs ${s.textSecondary}`}>
                    Use &ldquo;Move selected clip here&rdquo; on a track below to change tracks.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setVideoNeedsReview(false);
                        handleOpenSyncForManageClip();
                      }}
                      className={`px-4 py-2 text-sm ${s.buttonPrimary}`}
                    >
                      Adjust sync…
                    </button>
                    <button
                      type="button"
                      onClick={() => setVideoNeedsReview(false)}
                      className={`px-4 py-2 text-sm ${s.buttonSecondary}`}
                    >
                      Keep current offset
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        handleResetManageClipOffset();
                        setVideoNeedsReview(false);
                      }}
                      disabled={videoBusy}
                      className={`px-4 py-2 text-sm ${s.buttonSecondary}`}
                    >
                      Reset to default offset
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void handleRemoveManageClip();
                      }}
                      disabled={videoBusy}
                      className={`flex items-center justify-center gap-2 border border-red-500/30 px-4 py-2 text-sm text-red-500 transition-colors hover:bg-red-500/10 ${
                        videoBusy ? 'cursor-wait opacity-50' : ''
                      }`}
                    >
                      <Trash2 className="h-4 w-4" />
                      Remove clip
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </main>
    </div>
  );
}
