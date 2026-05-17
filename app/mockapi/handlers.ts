import type {
  Session,
  SessionEvent,
  Mark,
  TrackPoint,
  TrackSegment,
  TrackStream,
  TrackStreamBundle,
  SessionVideo,
  ExportResult,
  ParseResult,
  SessionStatsResponse,
} from '../frtend/src/types/models';
import { mockSessions, mockEvents, mockMarks } from './data/sessions';
import { mockTelemetry } from './data/telemetry';
import {
  getSessionNameFromImportFile,
  parseImportBytes,
} from '../shared/trackImport';
import { detectManeuvers } from '../shared/maneuverDetection';

const sessions: Session[] = mockSessions.map((s) => ({ ...s }));
const events: Record<string, SessionEvent[]> = Object.fromEntries(
  Object.entries(mockEvents).map(([k, v]) => [k, v.map((e) => ({ ...e }))]),
);
const marks: Record<string, Mark[]> = Object.fromEntries(
  Object.entries(mockMarks).map(([k, v]) => [k, v.map((m) => ({ ...m }))]),
);
const telemetry: Record<string, TrackPoint[]> = { ...mockTelemetry };
const tracks: Record<string, TrackStream[]> = {};
const trackPoints: Record<string, Record<string, TrackPoint[]>> = {};
const videos: Record<string, SessionVideo[]> = {};

function delay(ms = 200): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function genId(): string {
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function defaultStats() {
  return {
    duration: 0,
    distance: 0,
    maxSpeed: 0,
    avgSpeed: 0,
    turnCount: 0,
  };
}

function buildTrackSegment(
  trackId: string,
  points: TrackPoint[],
  sourceFileName?: string,
): TrackSegment {
  const first = points[0]?.t ?? 0;
  const last = points[points.length - 1]?.t ?? first;
  return {
    id: `${trackId}-segment-${Date.now()}`,
    trackId,
    sourceFileName,
    startMs: first,
    endMs: last,
    pointCount: points.length,
  };
}

function buildTrackStats(points: TrackPoint[], fallback = defaultStats()) {
  if (points.length === 0) return fallback;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const speeds = points.map((point) => point.s ?? 0);
  return {
    ...fallback,
    duration: Math.max(0, Math.round((last.t - first.t) / 1000)),
    maxSpeed: Math.round(Math.max(0, ...speeds) * 10) / 10,
    avgSpeed:
      Math.round(
        (speeds.reduce((sum, value) => sum + value, 0) / Math.max(1, speeds.length)) *
          10,
      ) / 10,
  };
}

function makeTrackStream(
  session: Session,
  points: TrackPoint[],
  options: {
    id?: string;
    name?: string;
    role?: TrackStream['role'];
    sourceFileName?: string;
    trackTimeOriginUnixMs?: number;
    color?: string;
  } = {},
): TrackStream {
  const id = options.id ?? 'primary';
  const now = new Date().toISOString();
  return {
    id,
    sessionId: session.id,
    name: options.name ?? session.name,
    role: options.role ?? 'primary',
    color: options.color,
    visible: true,
    trackTimeOriginUnixMs:
      options.trackTimeOriginUnixMs ?? session.trackTimeOriginUnixMs,
    segments: [buildTrackSegment(id, points, options.sourceFileName)],
    stats: buildTrackStats(points, session.stats),
    createdAt: now,
    updatedAt: now,
  };
}

function ensureTrackStore(sessionId: string): TrackStream[] {
  if (tracks[sessionId]) return tracks[sessionId]!;
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) return [];
  const points = telemetry[sessionId] ?? [];
  const primary = makeTrackStream(session, points, { id: 'primary' });
  tracks[sessionId] = [primary];
  trackPoints[sessionId] = { [primary.id]: points };
  return tracks[sessionId]!;
}

function getPrimaryTrack(sessionId: string): TrackStream | null {
  const list = ensureTrackStore(sessionId);
  return list.find((track) => track.role === 'primary') ?? list[0] ?? null;
}

type RouteHandler = (
  params: Record<string, string>,
  body?: unknown,
  query?: Record<string, string>,
) => Promise<unknown>;

const routes: Record<string, { handler: RouteHandler }> = {
  'GET /v1/sessions': {
    handler: async (_p, _body, query) => {
      let list = [...sessions];
      const search = query?.search?.trim().toLowerCase();
      if (search) {
        list = list.filter(
          (s) =>
            s.name.toLowerCase().includes(search) ||
            s.location.toLowerCase().includes(search),
        );
      }
      const page = Math.max(1, parseInt(query?.page ?? '1', 10));
      const limit = Math.min(
        100,
        Math.max(1, parseInt(query?.limit ?? '20', 10)),
      );
      const start = (page - 1) * limit;
      return list.slice(start, start + limit);
    },
  },
  'GET /v1/sessions/:id': {
    handler: async (p) => {
      const s = sessions.find((session) => session.id === p.id);
      if (!s) throw new Error('Session not found');
      return s;
    },
  },
  'POST /v1/sessions': {
    handler: async (_p, body) => {
      const data = body as Partial<Session>;
      const newSession: Session = {
        id: genId(),
        name: data.name ?? 'Untitled Session',
        date: data.date ?? new Date().toISOString().slice(0, 10),
        location: data.location ?? 'Unknown',
        source: data.source ?? 'manual',
        boatType: data.boatType,
        teamName: data.teamName,
        projectId: data.projectId,
        stats: data.stats ?? defaultStats(),
        trackTimeOriginUnixMs: data.trackTimeOriginUnixMs,
        analysisInputs: data.analysisInputs,
        eventCount: 0,
        canvasType: data.canvasType,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      sessions.unshift(newSession);
      events[newSession.id] = [];
      marks[newSession.id] = [];
      return newSession;
    },
  },
  'PUT /v1/sessions/:id': {
    handler: async (p, body) => {
      const idx = sessions.findIndex((session) => session.id === p.id);
      if (idx < 0) throw new Error('Session not found');
      const b = body as Partial<Session>;
      const current = sessions[idx]!;
      if (b.stats) current.stats = { ...current.stats, ...b.stats };
      if (b.name != null) current.name = b.name;
      if (b.date != null) current.date = b.date;
      if (b.location != null) current.location = b.location;
      if (b.source != null) current.source = b.source;
      if (b.boatType !== undefined) current.boatType = b.boatType;
      if (b.teamName !== undefined) current.teamName = b.teamName;
      if (b.projectId !== undefined) current.projectId = b.projectId;
      if (b.trackTimeOriginUnixMs !== undefined) {
        current.trackTimeOriginUnixMs = b.trackTimeOriginUnixMs;
      }
      if (b.analysisInputs !== undefined) current.analysisInputs = b.analysisInputs;
      if (b.eventCount !== undefined) current.eventCount = b.eventCount;
      if (b.canvasType !== undefined) current.canvasType = b.canvasType;
      current.updatedAt = new Date().toISOString();
      return current;
    },
  },
  'DELETE /v1/sessions/:id': {
    handler: async (p) => {
      const idx = sessions.findIndex((session) => session.id === p.id);
      if (idx < 0) throw new Error('Session not found');
      sessions.splice(idx, 1);
      delete events[p.id!];
      delete marks[p.id!];
      delete telemetry[p.id!];
      delete tracks[p.id!];
      delete trackPoints[p.id!];
      delete videos[p.id!];
      return { ok: true };
    },
  },
  'GET /v1/sessions/:id/track': {
    handler: async (p, _body, query) => {
      const primary = getPrimaryTrack(p.id!);
      let list = primary ? trackPoints[p.id!]?.[primary.id] ?? [] : telemetry[p.id!] ?? [];
      if (query?.simplify === 'true' && list.length > 100) {
        const step = Math.floor(list.length / 100);
        list = list.filter((_, i) => i % step === 0);
      }
      return list;
    },
  },
  'POST /v1/sessions/:id/track': {
    handler: async (p, body) => {
      const session = sessions.find((s) => s.id === p.id);
      if (!session) throw new Error('Session not found');
      const data = body as { points?: TrackPoint[] };
      const points = [...(data.points ?? [])];
      telemetry[p.id!] = points;
      const primary = makeTrackStream(session, points, { id: 'primary' });
      tracks[p.id!] = [primary];
      trackPoints[p.id!] = { [primary.id]: points };
      session.updatedAt = new Date().toISOString();
      return telemetry[p.id!];
    },
  },
  'GET /v1/sessions/:id/tracks': {
    handler: async (p) => ensureTrackStore(p.id!),
  },
  'POST /v1/sessions/:id/tracks': {
    handler: async (p, body) => {
      const session = sessions.find((s) => s.id === p.id);
      if (!session) throw new Error('Session not found');
      const data = body as {
        name?: string;
        role?: TrackStream['role'];
        color?: string;
        points?: TrackPoint[];
        sourceFileName?: string;
        trackTimeOriginUnixMs?: number;
      };
      const list = ensureTrackStore(p.id!);
      const id =
        data.role === 'primary' && !list.some((track) => track.id === 'primary')
          ? 'primary'
          : genId();
      const points = [...(data.points ?? [])];
      const track = makeTrackStream(session, points, {
        id,
        name: data.name,
        role: data.role ?? 'comparison',
        color: data.color,
        sourceFileName: data.sourceFileName,
        trackTimeOriginUnixMs: data.trackTimeOriginUnixMs,
      });
      tracks[p.id!] = [...list, track];
      trackPoints[p.id!] = { ...(trackPoints[p.id!] ?? {}), [track.id]: points };
      session.updatedAt = new Date().toISOString();
      return { track, points } satisfies TrackStreamBundle;
    },
  },
  'GET /v1/sessions/:id/tracks/:trackId/points': {
    handler: async (p) => {
      ensureTrackStore(p.id!);
      return trackPoints[p.id!]?.[p.trackId!] ?? [];
    },
  },
  'PUT /v1/sessions/:id/tracks/:trackId': {
    handler: async (p, body) => {
      const list = ensureTrackStore(p.id!);
      const idx = list.findIndex((track) => track.id === p.trackId);
      if (idx < 0) throw new Error('Track not found');
      const next = {
        ...list[idx]!,
        ...(body as Partial<TrackStream>),
        id: p.trackId!,
        sessionId: p.id!,
        updatedAt: new Date().toISOString(),
      };
      list[idx] = next;
      return next;
    },
  },
  'DELETE /v1/sessions/:id/tracks/:trackId': {
    handler: async (p) => {
      const list = ensureTrackStore(p.id!);
      const next = list.filter((track) => track.id !== p.trackId);
      if (next.length === list.length) throw new Error('Track not found');
      if (next.length === 0) throw new Error('Cannot delete the last track');
      tracks[p.id!] = next;
      delete trackPoints[p.id!]?.[p.trackId!];
      return { ok: true };
    },
  },
  'POST /v1/sessions/:id/tracks/:trackId/segments': {
    handler: async (p, body) => {
      const list = ensureTrackStore(p.id!);
      const idx = list.findIndex((track) => track.id === p.trackId);
      if (idx < 0) throw new Error('Track not found');
      const data = body as { points?: TrackPoint[]; sourceFileName?: string };
      const currentPoints = trackPoints[p.id!]?.[p.trackId!] ?? [];
      const points = [...currentPoints, ...(data.points ?? [])].sort((a, b) => a.t - b.t);
      const track = {
        ...list[idx]!,
        segments: [
          ...list[idx]!.segments,
          buildTrackSegment(p.trackId!, data.points ?? [], data.sourceFileName),
        ],
        stats: buildTrackStats(points, list[idx]!.stats),
        updatedAt: new Date().toISOString(),
      };
      list[idx] = track;
      trackPoints[p.id!] = { ...(trackPoints[p.id!] ?? {}), [p.trackId!]: points };
      return { track, points } satisfies TrackStreamBundle;
    },
  },
  'GET /v1/sessions/:id/stats': {
    handler: async (p) => {
      const s = sessions.find((session) => session.id === p.id);
      if (!s) throw new Error('Session not found');
      const res: SessionStatsResponse = { ...s.stats };
      return res;
    },
  },
  'GET /v1/sessions/:id/events': {
    handler: async (p) => events[p.id!] ?? [],
  },
  'POST /v1/sessions/:id/events': {
    handler: async (p, body) => {
      const data = body as Partial<SessionEvent>;
      const ev: SessionEvent = {
        id: genId(),
        sessionId: p.id!,
        trackId: data.trackId ?? getPrimaryTrack(p.id!)?.id,
        timestamp: data.timestamp ?? 0,
        startTime: data.startTime,
        endTime: data.endTime,
        type: data.type ?? 'general',
        note: data.note ?? 'New event',
        snapshotUrl: data.snapshotUrl,
        autoDetected: data.autoDetected,
        verified: data.verified,
        confidence: data.confidence,
        linkedMarkId: data.linkedMarkId,
        metrics: data.metrics,
        reasonCodes: data.reasonCodes,
      };
      if (!events[p.id!]) events[p.id!] = [];
      events[p.id!]!.push(ev);
      const session = sessions.find((s) => s.id === p.id);
      if (session) session.eventCount = events[p.id!]!.length;
      return ev;
    },
  },
  'PUT /v1/sessions/:id/events/:eid': {
    handler: async (p, body) => {
      const list = events[p.id!];
      if (!list) throw new Error('Session not found');
      const idx = list.findIndex((e) => e.id === p.eid);
      if (idx < 0) throw new Error('Event not found');
      Object.assign(list[idx]!, body);
      return list[idx];
    },
  },
  'DELETE /v1/sessions/:id/events/:eid': {
    handler: async (p) => {
      const list = events[p.id!];
      if (!list) throw new Error('Session not found');
      const idx = list.findIndex((e) => e.id === p.eid);
      if (idx < 0) throw new Error('Event not found');
      list.splice(idx, 1);
      const session = sessions.find((s) => s.id === p.id);
      if (session) session.eventCount = list.length;
      return { ok: true };
    },
  },
  'GET /v1/sessions/:id/marks': {
    handler: async (p) => marks[p.id!] ?? [],
  },
  'POST /v1/sessions/:id/marks': {
    handler: async (p, body) => {
      const data = body as Partial<Mark>;
      const mk: Mark = {
        id: genId(),
        sessionId: p.id!,
        type: data.type ?? 'mark',
        name: data.name,
        lat: data.lat ?? 0,
        lon: data.lon ?? 0,
        order: data.order ?? (marks[p.id!]?.length ?? 0),
      };
      if (!marks[p.id!]) marks[p.id!] = [];
      marks[p.id!]!.push(mk);
      return mk;
    },
  },
  'DELETE /v1/sessions/:id/marks/:mid': {
    handler: async (p) => {
      const list = marks[p.id!];
      if (!list) throw new Error('Session not found');
      const idx = list.findIndex((m) => m.id === p.mid);
      if (idx < 0) throw new Error('Mark not found');
      list.splice(idx, 1);
      return { ok: true };
    },
  },
  'PUT /v1/sessions/:id/marks/:mid': {
    handler: async (p, body) => {
      const list = marks[p.id!];
      if (!list) throw new Error('Session not found');
      const idx = list.findIndex((m) => m.id === p.mid);
      if (idx < 0) throw new Error('Mark not found');
      const data = body as Partial<Mark>;
      if (data.lat != null) list[idx]!.lat = data.lat;
      if (data.lon != null) list[idx]!.lon = data.lon;
      if (data.name !== undefined) list[idx]!.name = data.name;
      if (data.type !== undefined) list[idx]!.type = data.type;
      return list[idx];
    },
  },
  'POST /v1/sessions/:id/share': {
    handler: async (p) => {
      const result: ExportResult = {
        url: `https://sailsiq.com/shared/${p.id}/${genId()}`,
        format: 'link',
        createdAt: new Date().toISOString(),
      };
      return result;
    },
  },
  'POST /v1/sessions/:id/export/pdf': {
    handler: async (p) => {
      const result: ExportResult = {
        url: `https://sailsiq.com/export/${p.id}/report-${genId()}.pdf`,
        format: 'pdf',
        createdAt: new Date().toISOString(),
      };
      return result;
    },
  },
  'POST /v1/sessions/:id/export/video-assets': {
    handler: async (p) => {
      const result: ExportResult = {
        url: `https://sailsiq.com/export/${p.id}/video-assets-${genId()}.zip`,
        format: 'video',
        createdAt: new Date().toISOString(),
      };
      return result;
    },
  },
  'GET /v1/sessions/:id/video': {
    handler: async (p) => {
      const session = sessions.find((s) => s.id === p.id);
      if (!session) throw new Error('Session not found');
      return videos[p.id!]?.[0] ?? null;
    },
  },
  'GET /v1/sessions/:id/videos': {
    handler: async (p) => {
      const session = sessions.find((s) => s.id === p.id);
      if (!session) throw new Error('Session not found');
      return videos[p.id!] ?? [];
    },
  },
  'POST /v1/sessions/:id/video/link': {
    handler: async (p, body) => {
      const session = sessions.find((s) => s.id === p.id);
      if (!session) throw new Error('Session not found');
      const data = body as Partial<SessionVideo> & { videoUrl?: string };
      if (!data.videoUrl || data.videoUrl.trim() === '') {
        throw new Error('Video URL is required');
      }

      const now = new Date().toISOString();
      const offsetMs = Number.isFinite(data.offsetMs)
        ? Number(data.offsetMs)
        : Number.isFinite(data.sync?.offsetMs)
          ? Number(data.sync?.offsetMs)
          : 0;
      const nextVideo: SessionVideo = {
        id: genId(),
        videoType: data.videoType ?? 'flat',
        url: data.videoUrl.trim(),
        label: data.label?.trim() || undefined,
        offsetMs,
        ...(data.sync ? { sync: { ...data.sync, offsetMs, updatedAt: now } } : {}),
        linkedAt: now,
        updatedAt: now,
      };

      videos[p.id!] = [...(videos[p.id!] ?? []), nextVideo];
      session.updatedAt = now;
      return nextVideo;
    },
  },
  'POST /v1/sessions/:id/video/sync': {
    handler: async (p, body) => {
      const session = sessions.find((s) => s.id === p.id);
      if (!session) throw new Error('Session not found');
      const list = videos[p.id!] ?? [];
      if (list.length === 0) throw new Error('Video not linked');

      const data = body as {
        offsetMs?: number;
        sync?: SessionVideo['sync'];
        videoId?: string;
      };
      const targetIndex = data.videoId
        ? list.findIndex((video) => video.id === data.videoId)
        : 0;
      if (targetIndex < 0) throw new Error('Video not linked');

      const current = list[targetIndex]!;
      const now = new Date().toISOString();
      const offsetMs = Number.isFinite(data.offsetMs)
        ? Number(data.offsetMs)
        : Number.isFinite(data.sync?.offsetMs)
          ? Number(data.sync?.offsetMs)
          : current.offsetMs;
      const nextVideo: SessionVideo = {
        ...current,
        offsetMs,
        ...(data.sync
          ? { sync: { ...data.sync, offsetMs, updatedAt: now } }
          : current.sync
            ? { sync: { ...current.sync, offsetMs, updatedAt: now } }
            : {}),
        updatedAt: now,
      };

      list[targetIndex] = nextVideo;
      videos[p.id!] = list;
      session.updatedAt = now;
      return nextVideo;
    },
  },
  'DELETE /v1/sessions/:id/video': {
    handler: async (p, _body, query) => {
      const session = sessions.find((s) => s.id === p.id);
      if (!session) throw new Error('Session not found');
      const videoId = query?.videoId;
      if (videoId) {
        videos[p.id!] = (videos[p.id!] ?? []).filter((video) => video.id !== videoId);
      } else {
        delete videos[p.id!];
      }
      session.updatedAt = new Date().toISOString();
      return { ok: true };
    },
  },
  'POST /v1/parser/preview': {
    handler: async (_p, body) => {
      if (!(body instanceof FormData)) {
        throw new Error('A GPX, UBX, or .bin file is required');
      }
      const file = body.get('file');
      if (!(file instanceof File)) {
        throw new Error('A GPX, UBX, or .bin file is required');
      }
      return parseImportBytes(file.name, await file.arrayBuffer())
        .preview as ParseResult;
    },
  },
  'POST /v1/sessions/import': {
    handler: async (_p, body) => {
      if (!(body instanceof FormData)) {
        throw new Error('A GPX, UBX, or .bin file is required');
      }
      const file = body.get('file');
      if (!(file instanceof File)) {
        throw new Error('A GPX, UBX, or .bin file is required');
      }
      const parsed = parseImportBytes(file.name, await file.arrayBuffer());
      const name = body.get('name');
      const date = body.get('date');
      const location = body.get('location');
      const boatType = body.get('boatType');
      const teamName = body.get('teamName');
      const projectId = body.get('projectId');
      const newSession: Session = {
        id: genId(),
        name:
          (typeof name === 'string' && name.trim()) ||
          getSessionNameFromImportFile(file.name),
        date:
          (typeof date === 'string' && date.trim()) ||
          parsed.preview.date ||
          new Date().toISOString().slice(0, 10),
        location:
          (typeof location === 'string' && location.trim()) ||
          parsed.preview.location ||
          'Unknown',
        source: 'imported',
        boatType:
          typeof boatType === 'string' && boatType.trim()
            ? boatType.trim()
            : undefined,
        teamName:
          typeof teamName === 'string' && teamName.trim()
            ? teamName.trim()
            : undefined,
        projectId:
          typeof projectId === 'string' && projectId.trim()
            ? projectId.trim()
            : undefined,
        stats: parsed.stats,
        eventCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...(parsed.trackTimeOriginUnixMs != null
          ? { trackTimeOriginUnixMs: parsed.trackTimeOriginUnixMs }
          : {}),
      };
      sessions.unshift(newSession);
      events[newSession.id] = [];
      marks[newSession.id] = [];
      telemetry[newSession.id] = parsed.points;
      const primary = makeTrackStream(newSession, parsed.points, {
        id: 'primary',
        sourceFileName: file.name,
        trackTimeOriginUnixMs: parsed.trackTimeOriginUnixMs,
      });
      const detectedEvents: SessionEvent[] = detectManeuvers({
        sessionId: newSession.id,
        trackId: primary.id,
        points: parsed.points,
      }).map((maneuver) => ({
        id: genId(),
        sessionId: newSession.id,
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
      events[newSession.id] = detectedEvents;
      newSession.eventCount = detectedEvents.length;
      tracks[newSession.id] = [primary];
      trackPoints[newSession.id] = { [primary.id]: parsed.points };
      return newSession;
    },
  },
  'POST /v1/example/seed': {
    handler: async () => {
      sessions.length = 0;
      sessions.push(...mockSessions.map((s) => ({ ...s })));
      Object.keys(events).forEach((k) => delete events[k]);
      Object.entries(mockEvents).forEach(([k, v]) => {
        events[k] = v.map((e) => ({ ...e }));
      });
      Object.keys(marks).forEach((k) => delete marks[k]);
      Object.entries(mockMarks).forEach(([k, v]) => {
        marks[k] = v.map((m) => ({ ...m }));
      });
      Object.keys(telemetry).forEach((k) => delete telemetry[k]);
      Object.entries(mockTelemetry).forEach(([k, v]) => {
        telemetry[k] = [...v];
      });
      Object.keys(tracks).forEach((k) => delete tracks[k]);
      Object.keys(trackPoints).forEach((k) => delete trackPoints[k]);
      Object.keys(videos).forEach((k) => delete videos[k]);
      return { ok: true };
    },
  },
};

function parseQuery(path: string): Record<string, string> {
  const i = path.indexOf('?');
  if (i < 0) return {};
  const q: Record<string, string> = {};
  for (const part of path.slice(i + 1).split('&')) {
    const [key, val] = part.split('=');
    if (key && val != null) q[decodeURIComponent(key)] = decodeURIComponent(val);
  }
  return q;
}

function matchRoute(
  method: string,
  path: string,
): {
  handler: RouteHandler;
  params: Record<string, string>;
  query: Record<string, string>;
} | null {
  const [pathname = '', queryStr] = path.split('?');
  const query = queryStr ? parseQuery('?' + queryStr) : {};

  for (const [pattern, route] of Object.entries(routes)) {
    const [routeMethod, routePath] = pattern.split(' ') as [string, string];
    if (routeMethod !== method) continue;

    const routeParts = routePath.split('/').filter(Boolean);
    const pathParts = pathname.split('/').filter(Boolean);

    if (routeParts.length !== pathParts.length) continue;

    const params: Record<string, string> = {};
    let match = true;

    for (let i = 0; i < routeParts.length; i++) {
      if (routeParts[i]!.startsWith(':')) {
        params[routeParts[i]!.slice(1)] = pathParts[i]!;
      } else if (routeParts[i] !== pathParts[i]) {
        match = false;
        break;
      }
    }

    if (match) return { handler: route.handler, params, query };
  }
  return null;
}

export async function handleRequest<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  await delay(100 + Math.random() * 200);

  const matched = matchRoute(method, path);
  if (!matched) throw new Error(`Mock: No handler for ${method} ${path}`);

  const result = await matched.handler(matched.params, body, matched.query);
  return result as T;
}
