import type { VideoSyncBinding, VideoType } from '@/types/models';
import type { SurfaceRole, WorkspaceSharedState } from '@/types/workspace';

export const VIDEO_COMPANION_QUERY_KEY = 'companion';
export const VIDEO_COMPANION_QUERY_VALUE = 'surface';
export const LEGACY_VIDEO_COMPANION_QUERY_VALUE = 'video';
export const SURFACE_ROLE_QUERY_KEY = 'surfaceRole';

const CHANNEL_PREFIX = 'sailsiq_video_companion:';

export type CompanionConnectionState =
  | 'closed'
  | 'opening'
  | 'connected'
  | 'blocked'
  | 'disconnected';

export type CompanionHostState = WorkspaceSharedState;

export type VideoCompanionMessage =
  | {
      type: 'companion_ready';
      sessionId: string;
      sentAt: number;
    }
  | {
      type: 'companion_closed';
      sessionId: string;
      sentAt: number;
    }
  | {
      type: 'host_ping';
      sessionId: string;
      sentAt: number;
    }
  | {
      type: 'host_state';
      sessionId: string;
      state: CompanionHostState;
    }
  | {
      type: 'host_local_video';
      sessionId: string;
      sentAt: number;
      file: File;
      label?: string;
      key?: string;
      signature: string;
      videoType: VideoType;
      offsetMs: number;
      sync?: VideoSyncBinding;
    }
  | {
      type: 'host_clear_local_video';
      sessionId: string;
      sentAt: number;
    }
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
      range: CompanionHostState['selection']['range'];
    }
  | {
      type: 'surface_role_changed';
      sessionId: string;
      sentAt: number;
      role: SurfaceRole;
    };

export function canUseBroadcastChannel(): boolean {
  return typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined';
}

export function isVideoCompanionWindow(searchParams: URLSearchParams): boolean {
  const value = searchParams.get(VIDEO_COMPANION_QUERY_KEY);
  return value === VIDEO_COMPANION_QUERY_VALUE || value === LEGACY_VIDEO_COMPANION_QUERY_VALUE;
}

export function buildVideoCompanionUrl(
  currentHref: string,
  role: SurfaceRole = 'video',
): string {
  const url = new URL(currentHref);
  url.searchParams.set(VIDEO_COMPANION_QUERY_KEY, VIDEO_COMPANION_QUERY_VALUE);
  url.searchParams.set(SURFACE_ROLE_QUERY_KEY, role);
  return url.toString();
}

export function getRequestedSurfaceRole(
  searchParams: URLSearchParams,
): SurfaceRole {
  const raw = searchParams.get(SURFACE_ROLE_QUERY_KEY);
  if (raw === 'command' || raw === 'geo' || raw === 'telemetry' || raw === 'video') {
    return raw;
  }
  return 'video';
}

export function getVideoCompanionWindowName(sessionId: string): string {
  return `sailsiq-video-companion-${sessionId}`;
}

export function openVideoCompanionChannel(sessionId: string): BroadcastChannel | null {
  if (!canUseBroadcastChannel()) return null;
  return new BroadcastChannel(`${CHANNEL_PREFIX}${sessionId}`);
}

export function isVideoCompanionMessage(value: unknown): value is VideoCompanionMessage {
  if (!value || typeof value !== 'object') return false;
  const maybe = value as Partial<VideoCompanionMessage>;
  return typeof maybe.type === 'string' && typeof maybe.sessionId === 'string';
}
