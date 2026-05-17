/** Session stats (cached summary per API architecture doc). */
export interface SessionStats {
  duration: number; // seconds
  distance: number; // meters (API doc); we use meters, convert for display
  maxSpeed: number; // knots
  avgSpeed: number; // knots
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
  stats: SessionStats;
  /**
   * Wall-clock Unix ms for session timeline 0 (first track sample), when imported from a file with reliable timestamps.
   * Used to align video `offsetMs` to recording time when the video start lies inside the session wall-clock range.
   */
  trackTimeOriginUnixMs?: number;
  analysisInputs?: SessionAnalysisInputs;
  /** Number of event annotations (for list display; may be derived). */
  eventCount?: number;
  /** Canvas type chosen at creation; present only for canvas-mode sessions. */
  canvasType?: 'worldmap' | 'blank';
  createdAt: string;
  updatedAt: string;
}

export type VideoType = 'flat' | '360';

export type WorkspaceMode = 'data' | 'overlay' | 'split';

export type VideoSyncAnchorSource =
  | 'manual-video-track'
  | 'manual-video-realtime'
  | 'auto-file-time'
  | 'metadata';

export type VideoSyncConfidence = 'high' | 'medium' | 'low';

export type VideoSyncMode = 'single-anchor' | 'multi-anchor';

export interface VideoSyncAnchor {
  id: string;
  /** Video-local media time in ms. */
  videoTimeMs: number;
  /** Replay session time in ms, using the normalized track timeline. */
  trackTimeMs: number;
  /** UTC wall-clock Unix ms when the anchor came from a real-time assignment. */
  realUnixMs?: number;
  source: VideoSyncAnchorSource;
  confidence?: VideoSyncConfidence;
  note?: string;
  createdAt: string;
}

export interface VideoSyncBinding {
  version: 1;
  mode: VideoSyncMode;
  /**
   * Compatibility field used by the existing playback path.
   * For single-anchor sync: trackTimeMs - videoTimeMs.
   */
  offsetMs: number;
  anchors: VideoSyncAnchor[];
  /** Wall-clock Unix ms for replay session time 0, when known. */
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

export interface LocalSessionVideo {
  file: File;
  objectUrl: string;
  signature: string;
  videoType: VideoType;
  offsetMs: number;
  sync?: VideoSyncBinding;
  sourceKind: 'workspace' | 'file_picker';
  label?: string;
  workspaceRelativePath?: string;
}

/** Track point per API architecture (short field names). */
export interface TrackPoint {
  t: number; // Session-local timestamp ms
  lat: number;
  lon: number;
  s?: number; // Speed (SOG) knots
  h?: number; // Heading degrees
  w_s?: number; // Wind speed knots
  w_d?: number; // Wind direction degrees
}

/** Alias for components that use long names. */
export type TelemetryPoint = TrackPoint;

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
  duration: number; // seconds
  distance: number; // meters
  maxSpeed: number; // knots
  avgSpeed: number; // knots
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

export interface ExportResult {
  url: string;
  format: string;
  createdAt: string;
}

export interface UserSettings {
  speedUnit: 'knots' | 'kmh' | 'ms';
  distanceUnit: 'nm' | 'km' | 'm';
  timeFormat: '24h' | '12h';
  dataCollection: boolean;
}

export interface ParseResult {
  success: boolean;
  fields: {
    time: boolean;
    lat: boolean;
    lon: boolean;
    speed: boolean;
    heading: boolean;
    wind: boolean;
  };
  pointCount: number;
  duration: number;
  /** Extracted from file for auto-fill */
  date?: string;
  /** Derived from first point for auto-fill */
  location?: string;
  previewPoints: { lat: number; lon: number }[];
  warnings: string[];
}

export interface SessionStatsResponse {
  duration: number;
  distance: number;
  maxSpeed: number;
  avgSpeed: number;
  turnCount: number;
}
