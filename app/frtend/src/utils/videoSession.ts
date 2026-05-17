import type { VideoSyncBinding, VideoType, WorkspaceMode } from '@/types/models';
import type { SplitDirection, SurfaceRole, WorkspacePreset } from '@/types/workspace';
import { isVideoSyncBinding } from '@/utils/videoSync';

const MODE_KEY_PREFIX = 'sailsiq_video_mode:';
const LOCAL_VIDEO_KEY_PREFIX = 'sailsiq_local_video:';
const PRESET_KEY_PREFIX = 'sailsiq_workspace_preset:';
const REMOTE_ROLE_KEY_PREFIX = 'sailsiq_remote_surface_role:';
const SPLIT_DIRECTION_KEY_PREFIX = 'sailsiq_split_direction:';

interface StoredLocalVideoPrefs {
  offsetMs: number;
  sync?: VideoSyncBinding;
  videoType: VideoType;
}

const WORKSPACE_PRESETS: WorkspacePreset[] = [
  'travel_duo_geo',
  'travel_duo_telemetry',
  'travel_duo_video',
];
const SURFACE_ROLES: SurfaceRole[] = ['command', 'geo', 'telemetry', 'video'];

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function getLocalVideoSignature(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export function deriveVideoLabelFromUrl(url: string): string {
  try {
    const parsed = new URL(url, typeof window !== 'undefined' ? window.location.href : 'http://localhost');
    const pathParts = parsed.pathname.split('/').filter(Boolean);
    const tail = pathParts[pathParts.length - 1];
    return tail || parsed.hostname || url;
  } catch {
    return url;
  }
}

export function loadWorkspaceMode(sessionId: string): WorkspaceMode | null {
  if (!canUseStorage()) return null;

  const raw = window.localStorage.getItem(`${MODE_KEY_PREFIX}${sessionId}`);
  if (raw === 'data' || raw === 'overlay' || raw === 'split') {
    return raw;
  }
  return null;
}

export function saveWorkspaceMode(sessionId: string, mode: WorkspaceMode): void {
  if (!canUseStorage()) return;
  window.localStorage.setItem(`${MODE_KEY_PREFIX}${sessionId}`, mode);
}

export function loadLocalVideoPrefs(
  sessionId: string,
  signature: string,
): StoredLocalVideoPrefs | null {
  if (!canUseStorage()) return null;

  try {
    const raw = window.localStorage.getItem(`${LOCAL_VIDEO_KEY_PREFIX}${sessionId}:${signature}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredLocalVideoPrefs>;
    if (
      typeof parsed.offsetMs === 'number' &&
      (parsed.videoType === 'flat' || parsed.videoType === '360')
    ) {
      return {
        offsetMs: parsed.offsetMs,
        ...(isVideoSyncBinding(parsed.sync) ? { sync: parsed.sync } : {}),
        videoType: parsed.videoType,
      };
    }
  } catch {
    return null;
  }

  return null;
}

export function saveLocalVideoPrefs(
  sessionId: string,
  signature: string,
  prefs: StoredLocalVideoPrefs,
): void {
  if (!canUseStorage()) return;

  window.localStorage.setItem(
    `${LOCAL_VIDEO_KEY_PREFIX}${sessionId}:${signature}`,
    JSON.stringify(prefs),
  );
}

export function loadWorkspacePreset(sessionId: string): WorkspacePreset | null {
  if (!canUseStorage()) return null;

  const raw = window.localStorage.getItem(`${PRESET_KEY_PREFIX}${sessionId}`);
  return WORKSPACE_PRESETS.includes(raw as WorkspacePreset)
    ? (raw as WorkspacePreset)
    : null;
}

export function saveWorkspacePreset(
  sessionId: string,
  preset: WorkspacePreset,
): void {
  if (!canUseStorage()) return;
  window.localStorage.setItem(`${PRESET_KEY_PREFIX}${sessionId}`, preset);
}

/** Taller canvas → top/bottom split; wider or square → left/right. */
export function splitDirectionForAspectRatio(
  width: number,
  height: number,
): SplitDirection {
  if (width <= 0 || height <= 0) return 'left-right';
  return height > width ? 'top-bottom' : 'left-right';
}

export function loadSplitDirection(sessionId: string): SplitDirection | null {
  if (!canUseStorage()) return null;

  const raw = window.localStorage.getItem(`${SPLIT_DIRECTION_KEY_PREFIX}${sessionId}`);
  if (raw === 'left-right' || raw === 'top-bottom') {
    return raw;
  }
  return null;
}

export function saveSplitDirection(
  sessionId: string,
  direction: SplitDirection,
): void {
  if (!canUseStorage()) return;
  window.localStorage.setItem(`${SPLIT_DIRECTION_KEY_PREFIX}${sessionId}`, direction);
}

export function loadRemoteSurfaceRole(sessionId: string): SurfaceRole | null {
  if (!canUseStorage()) return null;

  const raw = window.localStorage.getItem(`${REMOTE_ROLE_KEY_PREFIX}${sessionId}`);
  return SURFACE_ROLES.includes(raw as SurfaceRole) ? (raw as SurfaceRole) : null;
}

export function saveRemoteSurfaceRole(
  sessionId: string,
  role: SurfaceRole,
): void {
  if (!canUseStorage()) return;
  window.localStorage.setItem(`${REMOTE_ROLE_KEY_PREFIX}${sessionId}`, role);
}
