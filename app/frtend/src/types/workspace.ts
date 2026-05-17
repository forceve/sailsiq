import type {
  SessionEvent,
  TrackPoint,
  VideoSyncBinding,
  VideoType,
  WorkspaceMode,
} from '@/types/models';

export type SurfaceRole = 'command' | 'geo' | 'telemetry' | 'video';

export type StageType = 'map' | 'video' | 'chart' | 'compare';

export type LensType = 'metric' | 'event' | 'range' | 'compare';

export type WorkspaceStageLayoutMode = 'full' | 'split';

export type WorkspaceStageContent = 'map' | 'telemetry' | `video:${string}`;

export interface WorkspaceStageLayout {
  mode: WorkspaceStageLayoutMode;
  primary: WorkspaceStageContent;
  left: WorkspaceStageContent;
  right: WorkspaceStageContent;
}

export type WorkspacePreset =
  | 'travel_duo_geo'
  | 'travel_duo_telemetry'
  | 'travel_duo_video';

export type SplitDirection = 'left-right' | 'top-bottom';

export interface WorkspaceRangeSelection {
  trackId?: string;
  startMs: number;
  endMs: number;
  source: 'speed' | 'heading' | 'vmgToWind' | 'turnRate';
}

export interface WorkspaceSelectionState {
  eventId: string | null;
  markId: string | null;
  range: WorkspaceRangeSelection | null;
}

export interface WorkspaceTimeWindow {
  startMs: number;
  endMs: number;
}

export interface WorkspaceVideoDescriptor {
  key: string;
  origin: 'remote' | 'local';
  id?: string;
  label?: string;
  url?: string;
  videoType: VideoType;
  offsetMs: number;
  sync?: VideoSyncBinding;
  signature?: string;
}

export interface WorkspaceSurfaceState {
  role: SurfaceRole;
  followFocus: boolean;
}

export interface WorkspaceSharedState {
  sessionId: string;
  sessionName?: string;
  totalDurationMs: number;
  workspaceWindow: WorkspaceTimeWindow;
  currentTime: number;
  isPlaying: boolean;
  playbackSpeed: number;
  workspaceMode: WorkspaceMode;
  /** Legacy surface preset, kept optional for older companion windows. */
  workspacePreset?: WorkspacePreset;
  stageLayout: WorkspaceStageLayout;
  syncDialogOpen: boolean;
  syncSessionTimeMs: number;
  syncVideoTimeMs: number;
  currentPoint?: TrackPoint;
  activeTrackId?: string | null;
  activeTrackPoints?: TrackPoint[];
  windDir?: number;
  windSpeed?: number;
  nearestEvent?: SessionEvent | null;
  video: WorkspaceVideoDescriptor | null;
  videos: WorkspaceVideoDescriptor[];
  selection: WorkspaceSelectionState;
  /** Legacy role driven surface state, kept optional for older companion windows. */
  remoteSurface?: WorkspaceSurfaceState;
  sentAt: number;
}

export type FocusMessage =
  | {
      type: 'focus_event';
      sessionId: string;
      sentAt: number;
      eventId: string;
      timestamp: number;
    }
  | {
      type: 'focus_mark';
      sessionId: string;
      sentAt: number;
      markId: string;
    }
  | {
      type: 'focus_range';
      sessionId: string;
      sentAt: number;
      range: WorkspaceRangeSelection;
    }
  | {
      type: 'surface_role_changed';
      sessionId: string;
      sentAt: number;
      role: SurfaceRole;
    };

export type WorkspacePermissionState =
  | 'granted'
  | 'prompt'
  | 'denied'
  | 'unsupported'
  | 'unknown';

export type WorkspaceAssetStorageMode =
  | 'workspace_copy'
  | 'workspace_relative_ref'
  | 'external_absolute_ref';

export interface WorkspaceDiscoverySummary {
  lastScanAt: string | null;
  pendingTracks: number;
  pendingVideos: number;
  brokenRefs: number;
}

export interface WorkspaceManifest {
  id: string;
  name: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  sessionsIndex: string[];
  discovery: WorkspaceDiscoverySummary;
}

export interface LocalWorkspaceSummary {
  id: string;
  name: string;
  rootName: string;
  createdAt: string;
  updatedAt: string;
  sessionCount?: number;
  discovery: WorkspaceDiscoverySummary;
  permissionState: WorkspacePermissionState;
  isCurrent: boolean;
  hasManifest: boolean;
}

export interface WorkspaceTrackFileSummary {
  name: string;
  relativePath: string;
  size: number;
  updatedAt: string;
}

export interface WorkspaceVideoFileSummary {
  name: string;
  relativePath: string;
  size: number;
  updatedAt: string;
  collection: 'incoming' | 'library';
}

export type WorkspaceTrackBindingSource =
  | 'workspace_discovery'
  | 'external_file_picker';

export type WorkspaceTrackSaveStrategy =
  | 'workspace_source'
  | 'save_copy'
  | 'save_session_only';

export interface WorkspaceTrackBinding {
  path: string;
  fileName: string;
  sourceKind: WorkspaceTrackBindingSource;
  storageMode: WorkspaceAssetStorageMode;
  saveStrategy: WorkspaceTrackSaveStrategy;
  copiedToWorkspace: boolean;
  confirmed: boolean;
  boundAt: string;
}

export type WorkspaceVideoBindingSource =
  | 'workspace_discovery'
  | 'external_file_picker'
  | 'linked_url';

export interface WorkspaceVideoBinding {
  path: string;
  fileName: string;
  label?: string;
  sourceKind: WorkspaceVideoBindingSource;
  storageMode: WorkspaceAssetStorageMode;
  videoType: VideoType;
  offsetMs: number;
  sync?: VideoSyncBinding;
  copiedToWorkspace: boolean;
  confirmed: boolean;
  boundAt: string;
}

export interface ReplayPreboundVideoState {
  kind: 'workspace_video' | 'local_file';
  fileName: string;
  file?: File;
  relativePath?: string;
  label?: string;
  videoType: VideoType;
  offsetMs: number;
  sync?: VideoSyncBinding;
  promptSync: boolean;
}

export interface ReplayNavigationState {
  preboundVideo?: ReplayPreboundVideoState;
}

export interface WorkspaceSessionBindingsManifest {
  track: WorkspaceTrackBinding | null;
  videos: WorkspaceVideoBinding[];
}
