import type {
  Session,
  SessionEvent,
  Mark,
  TrackPoint,
  TrackStream,
  TrackStreamBundle,
  SessionVideo,
  VideoSyncBinding,
  VideoType,
  ExportResult,
  ParseResult,
  UserSettings,
  SessionStatsResponse,
} from '@/types/models';

const USE_MOCK = import.meta.env.VITE_USE_MOCK === '1';
const API_BASE = import.meta.env.VITE_API_BASE || '';

type MockModule = typeof import('@mockapi/handlers');
let _mockModule: MockModule | null = null;

async function getMock(): Promise<MockModule> {
  if (!_mockModule) {
    _mockModule = await import('@mockapi/handlers');
  }
  return _mockModule;
}

export interface ListSessionsParams {
  page?: number;
  limit?: number;
  search?: string;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  if (USE_MOCK) {
    const mock = await getMock();
    return mock.handleRequest<T>(method, path, body);
  }

  const url = `${API_BASE}/api${path}`;
  const res = await fetch(url, {
    method,
    headers: body != null && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {},
    body: body instanceof FormData ? body : body != null ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    let msg = text;
    try {
      const err = JSON.parse(text) as { error?: { message?: string; code?: string } };
      if (err.error?.message) msg = err.error.message;
    } catch { /* noop */ }
    throw new Error(`API ${res.status}: ${msg}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

function buildQuery(params?: ListSessionsParams): string {
  if (!params) return '';
  const q = new URLSearchParams();
  if (params.page != null) q.set('page', String(params.page));
  if (params.limit != null) q.set('limit', String(params.limit));
  if (params.search != null && params.search.trim()) q.set('search', params.search.trim());
  const s = q.toString();
  return s ? `?${s}` : '';
}

export const sessionApi = {
  list: (params?: ListSessionsParams) =>
    request<Session[]>('GET', `/v1/sessions${buildQuery(params)}`),
  get: (id: string) => request<Session>('GET', `/v1/sessions/${id}`),
  create: (data: Partial<Session>) =>
    request<Session>('POST', '/v1/sessions', data),
  update: (id: string, data: Partial<Session>) =>
    request<Session>('PUT', `/v1/sessions/${id}`, data),
  delete: (id: string) => request<void>('DELETE', `/v1/sessions/${id}`),
};

export const trackApi = {
  get: (sessionId: string, simplify?: boolean) =>
    request<TrackPoint[]>(
      'GET',
      `/v1/sessions/${sessionId}/track${simplify ? '?simplify=true' : ''}`,
    ),
  upload: (sessionId: string, points: TrackPoint[]) =>
    request<TrackPoint[]>('POST', `/v1/sessions/${sessionId}/track`, { points }),
  list: (sessionId: string) =>
    request<TrackStream[]>('GET', `/v1/sessions/${sessionId}/tracks`),
  create: (
    sessionId: string,
    data: {
      name: string;
      role?: TrackStream['role'];
      boatId?: string;
      color?: string;
      points: TrackPoint[];
      sourceFileName?: string;
      trackTimeOriginUnixMs?: number;
    },
  ) => request<TrackStreamBundle>('POST', `/v1/sessions/${sessionId}/tracks`, data),
  getPoints: (sessionId: string, trackId: string) =>
    request<TrackPoint[]>(
      'GET',
      `/v1/sessions/${sessionId}/tracks/${encodeURIComponent(trackId)}/points`,
    ),
  updateTrack: (sessionId: string, trackId: string, data: Partial<TrackStream>) =>
    request<TrackStream>(
      'PUT',
      `/v1/sessions/${sessionId}/tracks/${encodeURIComponent(trackId)}`,
      data,
    ),
  deleteTrack: (sessionId: string, trackId: string) =>
    request<void>(
      'DELETE',
      `/v1/sessions/${sessionId}/tracks/${encodeURIComponent(trackId)}`,
    ),
  addSegment: (
    sessionId: string,
    trackId: string,
    data: {
      points: TrackPoint[];
      sourceFileName?: string;
      sourcePath?: string;
      appendMode: 'append' | 'insert-by-time';
      trackTimeOriginUnixMs?: number;
    },
  ) =>
    request<TrackStreamBundle>(
      'POST',
      `/v1/sessions/${sessionId}/tracks/${encodeURIComponent(trackId)}/segments`,
      data,
    ),
};

export const statsApi = {
  get: (sessionId: string) =>
    request<SessionStatsResponse>('GET', `/v1/sessions/${sessionId}/stats`),
};

export const eventApi = {
  list: (sessionId: string) =>
    request<SessionEvent[]>('GET', `/v1/sessions/${sessionId}/events`),
  create: (sessionId: string, data: Partial<SessionEvent>) =>
    request<SessionEvent>('POST', `/v1/sessions/${sessionId}/events`, data),
  update: (sessionId: string, eventId: string, data: Partial<SessionEvent>) =>
    request<SessionEvent>(
      'PUT',
      `/v1/sessions/${sessionId}/events/${eventId}`,
      data,
    ),
  delete: (sessionId: string, eventId: string) =>
    request<void>('DELETE', `/v1/sessions/${sessionId}/events/${eventId}`),
};

export const markApi = {
  list: (sessionId: string) =>
    request<Mark[]>('GET', `/v1/sessions/${sessionId}/marks`),
  create: (sessionId: string, data: Partial<Mark>) =>
    request<Mark>('POST', `/v1/sessions/${sessionId}/marks`, data),
  update: (
    sessionId: string,
    markId: string,
    data: Partial<Pick<Mark, 'lat' | 'lon' | 'name' | 'type'>>,
  ) =>
    request<Mark>('PUT', `/v1/sessions/${sessionId}/marks/${markId}`, data),
  delete: (sessionId: string, markId: string) =>
    request<void>('DELETE', `/v1/sessions/${sessionId}/marks/${markId}`),
};

export const exportApi = {
  share: (sessionId: string, options?: { readOnly?: boolean; expire?: string }) =>
    request<ExportResult>('POST', `/v1/sessions/${sessionId}/share`, options ?? {}),
  exportPdf: (sessionId: string, options?: { includeEvents?: boolean; includeScreenshots?: boolean }) =>
    request<ExportResult>('POST', `/v1/sessions/${sessionId}/export/pdf`, options ?? {}),
  exportVideoAssets: (sessionId: string, options?: { format?: string; components?: string[] }) =>
    request<ExportResult>('POST', `/v1/sessions/${sessionId}/export/video-assets`, options ?? {}),
};

export const videoApi = {
  get: (sessionId: string) =>
    request<SessionVideo | null>('GET', `/v1/sessions/${sessionId}/video`),
  list: (sessionId: string) =>
    request<SessionVideo[]>('GET', `/v1/sessions/${sessionId}/videos`),
  link: (
    sessionId: string,
    data: {
      videoUrl: string;
      videoType: VideoType;
      label?: string;
      offsetMs?: number;
      sync?: VideoSyncBinding;
    },
  ) => request<SessionVideo>('POST', `/v1/sessions/${sessionId}/video/link`, data),
  sync: (
    sessionId: string,
    data: { offsetMs: number; sync?: VideoSyncBinding; videoId?: string },
  ) =>
    request<SessionVideo>('POST', `/v1/sessions/${sessionId}/video/sync`, data),
  remove: (sessionId: string, videoId?: string) =>
    request<{ ok: boolean }>(
      'DELETE',
      `/v1/sessions/${sessionId}/video${videoId ? `?videoId=${encodeURIComponent(videoId)}` : ''}`,
    ),
};

export const parseApi = {
  preview: (file: File): Promise<ParseResult> => {
    const form = new FormData();
    form.set('file', file);
    return request<ParseResult>('POST', '/v1/parser/preview', form);
  },
};

export const importApi = {
  session: (
    file: File,
    metadata: {
      name?: string;
      date?: string;
      location?: string;
      boatType?: string;
      teamName?: string;
      projectId?: string;
    },
  ) => {
    const form = new FormData();
    form.set('file', file);
    Object.entries(metadata).forEach(([key, value]) => {
      if (value != null && value !== '') form.set(key, value);
    });
    return request<Session>('POST', '/v1/sessions/import', form);
  },
};

/** Mock-only: seed example data. */
export const exampleApi = {
  seed: () => request<{ ok: boolean }>('POST', '/v1/example/seed'),
};

const SETTINGS_KEY = 'sailsiq_settings';

const defaultSettings: UserSettings = {
  speedUnit: 'knots',
  distanceUnit: 'nm',
  timeFormat: '24h',
  dataCollection: false,
};

export const settingsApi = {
  get: (): UserSettings => {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) return { ...defaultSettings, ...JSON.parse(raw) };
    } catch { /* noop */ }
    return defaultSettings;
  },
  save: (s: UserSettings) => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  },
};
