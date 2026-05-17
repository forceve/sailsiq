export interface Env {
  SESSIONS_KV: KVNamespace;
  ALLOWED_ORIGINS: string;
}

export interface SessionStats {
  duration: number;
  distance: number;
  maxSpeed: number;
  avgSpeed: number;
  turnCount: number;
}

export type WindInputKind = 'track_embedded' | 'manual_global' | 'file_timeseries';

export interface TrackEmbeddedWindInput {
  id: string;
  kind: 'track_embedded';
  label?: string;
  trackId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ManualGlobalWindInput {
  id: string;
  kind: 'manual_global';
  label?: string;
  twd: number;
  speed?: number;
  createdAt: string;
  updatedAt: string;
}

export interface WindTimeseriesSample {
  t: number;
  twd: number;
  speed?: number;
}

export interface FileTimeseriesWindInput {
  id: string;
  kind: 'file_timeseries';
  label?: string;
  sourceFileName?: string;
  sourcePath?: string;
  samples: WindTimeseriesSample[];
  createdAt: string;
  updatedAt: string;
}

export type WindInputSource =
  | TrackEmbeddedWindInput
  | ManualGlobalWindInput
  | FileTimeseriesWindInput;

export interface SessionAnalysisInputs {
  wind?: WindInputSource;
}

export interface Session {
  id: string;
  userId?: string;
  projectId?: string;
  name: string;
  date: string;
  location: string;
  source: 'imported' | 'manual';
  boatType?: string;
  teamName?: string;
  canvasType?: 'worldmap' | 'blank';
  stats: SessionStats;
  trackTimeOriginUnixMs?: number;
  analysisInputs?: SessionAnalysisInputs;
  eventCount?: number;
  createdAt: string;
  updatedAt: string;
}

export type VideoType = 'flat' | '360';

export type VideoSyncAnchorSource =
  | 'manual-video-track'
  | 'manual-video-realtime'
  | 'auto-file-time'
  | 'metadata';

export type VideoSyncConfidence = 'high' | 'medium' | 'low';

export type VideoSyncMode = 'single-anchor' | 'multi-anchor';

export interface VideoSyncAnchor {
  id: string;
  videoTimeMs: number;
  trackTimeMs: number;
  realUnixMs?: number;
  source: VideoSyncAnchorSource;
  confidence?: VideoSyncConfidence;
  note?: string;
  createdAt: string;
}

export interface VideoSyncBinding {
  version: 1;
  mode: VideoSyncMode;
  offsetMs: number;
  anchors: VideoSyncAnchor[];
  trackTimeOriginUnixMs?: number;
  updatedAt: string;
}

export interface SessionVideo {
  id?: string;
  videoType: VideoType;
  url: string;
  label?: string;
  offsetMs: number;
  sync?: VideoSyncBinding;
  linkedAt: string;
  updatedAt: string;
}

export interface TrackPoint {
  t: number;
  lat: number;
  lon: number;
  s?: number;
  h?: number;
  w_s?: number;
  w_d?: number;
}

export type TrackRole = 'primary' | 'comparison';

export interface TrackSegment {
  id: string;
  trackId: string;
  sourceFileName?: string;
  sourcePath?: string;
  startMs: number;
  endMs: number;
  pointCount: number;
}

export interface TrackStreamStats {
  duration: number;
  distance: number;
  maxSpeed: number;
  avgSpeed: number;
  turnCount: number;
}

export interface TrackStream {
  id: string;
  sessionId: string;
  name: string;
  role: TrackRole;
  boatId?: string;
  color?: string;
  visible: boolean;
  locked?: boolean;
  trackTimeOriginUnixMs?: number;
  offsetMs?: number;
  segments: TrackSegment[];
  stats: TrackStreamStats;
  createdAt: string;
  updatedAt: string;
}

export interface TrackStreamBundle {
  track: TrackStream;
  points: TrackPoint[];
}

export type EventType =
  | 'general'
  | 'tack'
  | 'gybe'
  | 'mark_rounding'
  | 'penalty_360'
  | 'penalty_720'
  | 'other_turn'
  | 'start'
  | 'finish';

export interface ManeuverMetrics {
  duration?: number;
  headingChange?: number;
  cumulativeTurn?: number;
  entryTwa?: number;
  exitTwa?: number;
  minAbsTwa?: number;
  maxAbsTwa?: number;
  speedBefore?: number;
  minSpeed?: number;
  speedLoss?: number;
  nearestMarkId?: string;
  nearestMarkDistance?: number;
}

export interface SessionEvent {
  id: string;
  sessionId: string;
  trackId?: string;
  timestamp: number;
  startTime?: number;
  endTime?: number;
  type: EventType;
  note: string;
  snapshotUrl?: string;
  autoDetected?: boolean;
  verified?: boolean;
  confidence?: number;
  linkedMarkId?: string;
  metrics?: ManeuverMetrics;
  reasonCodes?: string[];
}

export type MarkType = 'start_pin' | 'start_boat' | 'mark' | 'gate' | 'finish';

export interface Mark {
  id: string;
  sessionId: string;
  type: MarkType;
  name?: string;
  lat: number;
  lon: number;
  order?: number;
}

export interface ExportRequest {
  format: 'pdf' | 'link' | 'video';
  includeEvents: boolean;
  includeScreenshots: boolean;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}
