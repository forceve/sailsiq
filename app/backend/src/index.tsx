import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type {
  Env,
  Session,
  SessionEvent,
  Mark,
  TrackPoint,
  TrackSegment,
  TrackStream,
  TrackStreamBundle,
  SessionVideo,
  ApiError,
} from './types';
import {
  getSessionNameFromImportFile,
  parseImportBytes,
} from '../../shared/trackImport';
import { detectManeuvers } from '../../shared/maneuverDetection';

const app = new Hono<{ Bindings: Env }>();

function genId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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
  options: { id?: string; sourceFileName?: string; sourcePath?: string } = {},
): TrackSegment {
  const first = points[0]?.t ?? 0;
  const last = points[points.length - 1]?.t ?? first;
  return {
    id: options.id ?? `${trackId}-segment-${genId()}`,
    trackId,
    sourceFileName: options.sourceFileName,
    sourcePath: options.sourcePath,
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
    sourcePath?: string;
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
    segments: [
      buildTrackSegment(id, points, {
        sourceFileName: options.sourceFileName,
        sourcePath: options.sourcePath,
      }),
    ],
    stats: buildTrackStats(points, session.stats),
    createdAt: now,
    updatedAt: now,
  };
}

function err(code: string, message: string, status: number, details?: Record<string, unknown>) {
  const body: { error: ApiError } = { error: { code, message } };
  if (details) body.error.details = details;
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/* ── CORS ─────────────────────────────────────────────────────── */

app.use('/api/v1/*', async (c, next) => {
  const allowed = (c.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim());
  return cors({
    origin: allowed,
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
    maxAge: 86400,
  })(c, next);
});

/* ── KV Helpers ───────────────────────────────────────────────── */

async function kvGet<T>(kv: KVNamespace, key: string): Promise<T | null> {
  const raw = await kv.get(key, 'text');
  return raw ? JSON.parse(raw) : null;
}

async function kvPut<T>(kv: KVNamespace, key: string, value: T): Promise<void> {
  await kv.put(key, JSON.stringify(value));
}

async function getTrackStreams(
  kv: KVNamespace,
  session: Session,
): Promise<TrackStream[]> {
  const canonical = await kvGet<TrackStream[]>(kv, `session:${session.id}:tracks`);
  if (canonical && canonical.length > 0) return canonical;
  const legacyPoints =
    (await kvGet<TrackPoint[]>(kv, `session:${session.id}:track`)) ?? [];
  return [makeTrackStream(session, legacyPoints, { id: 'primary' })];
}

async function getPrimaryTrack(
  kv: KVNamespace,
  session: Session,
): Promise<TrackStream> {
  const tracks = await getTrackStreams(kv, session);
  return tracks.find((track) => track.role === 'primary') ?? tracks[0]!;
}

async function getTrackPoints(
  kv: KVNamespace,
  sessionId: string,
  trackId: string,
): Promise<TrackPoint[]> {
  const canonical = await kvGet<TrackPoint[]>(
    kv,
    `session:${sessionId}:track:${trackId}`,
  );
  if (canonical) return canonical;
  if (trackId === 'primary') {
    return (await kvGet<TrackPoint[]>(kv, `session:${sessionId}:track`)) ?? [];
  }
  return [];
}

async function savePrimaryCompatibilityTrack(
  kv: KVNamespace,
  sessionId: string,
  tracks: TrackStream[],
): Promise<void> {
  const primary = tracks.find((track) => track.role === 'primary') ?? tracks[0];
  if (!primary) return;
  const points = await getTrackPoints(kv, sessionId, primary.id);
  await kvPut(kv, `session:${sessionId}:track`, points);
}

function isFileLike(
  value: unknown,
): value is File & { name: string; arrayBuffer: () => Promise<ArrayBuffer> } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    'arrayBuffer' in value &&
    typeof (value as { arrayBuffer?: unknown }).arrayBuffer === 'function'
  );
}

/* ── Sessions ─────────────────────────────────────────────────── */

app.get('/api/v1/sessions', async (c) => {
  const kv = c.env.SESSIONS_KV;
  const list = await kv.list({ prefix: 'session:' });
  const sessions: Session[] = [];
  for (const key of list.keys) {
    if (
      key.name.includes(':events') ||
      key.name.includes(':marks') ||
      key.name.includes(':track')
    )
      continue;
    const s = await kvGet<Session>(kv, key.name);
    if (s) sessions.push(s);
  }
  sessions.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  const search = c.req.query('search')?.trim().toLowerCase();
  let filtered = sessions;
  if (search) {
    filtered = filtered.filter(
      (s) =>
        s.name.toLowerCase().includes(search) ||
        s.location.toLowerCase().includes(search),
    );
  }

  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10));
  const limit = Math.min(
    100,
    Math.max(1, parseInt(c.req.query('limit') ?? '20', 10)),
  );
  const start = (page - 1) * limit;
  const slice = filtered.slice(start, start + limit);

  return c.json(slice);
});

app.get('/api/v1/sessions/:id', async (c) => {
  const id = c.req.param('id');
  const session = await kvGet<Session>(c.env.SESSIONS_KV, `session:${id}`);
  if (!session)
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'Session not found' } },
      404,
    );
  return c.json(session);
});

app.post('/api/v1/sessions', async (c) => {
  const body = await c.req.json<Partial<Session>>();
  const id = genId();
  const now = new Date().toISOString();
  const session: Session = {
    id,
    name: body.name ?? 'Untitled',
    date: body.date ?? now.slice(0, 10),
    location: body.location ?? '',
    source: body.source ?? 'manual',
    boatType: body.boatType,
    teamName: body.teamName,
    canvasType: body.canvasType,
    projectId: body.projectId,
    stats: body.stats ?? defaultStats(),
    trackTimeOriginUnixMs: body.trackTimeOriginUnixMs,
    analysisInputs: body.analysisInputs,
    eventCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  await kvPut(c.env.SESSIONS_KV, `session:${id}`, session);
  return c.json(session, 201);
});

app.put('/api/v1/sessions/:id', async (c) => {
  const id = c.req.param('id');
  const kv = c.env.SESSIONS_KV;
  const existing = await kvGet<Session>(kv, `session:${id}`);
  if (!existing)
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'Session not found' } },
      404,
    );

  const body = await c.req.json<Partial<Session>>();
  if (body.stats)
    existing.stats = { ...existing.stats, ...body.stats };
  if (body.name != null) existing.name = body.name;
  if (body.date != null) existing.date = body.date;
  if (body.location != null) existing.location = body.location;
  if (body.source != null) existing.source = body.source;
  if (body.boatType !== undefined) existing.boatType = body.boatType;
  if (body.teamName !== undefined) existing.teamName = body.teamName;
  if (body.canvasType !== undefined) existing.canvasType = body.canvasType;
  if (body.projectId !== undefined) existing.projectId = body.projectId;
  if (body.trackTimeOriginUnixMs !== undefined) {
    existing.trackTimeOriginUnixMs = body.trackTimeOriginUnixMs;
  }
  if (body.analysisInputs !== undefined) existing.analysisInputs = body.analysisInputs;
  if (body.eventCount !== undefined) existing.eventCount = body.eventCount;
  existing.updatedAt = new Date().toISOString();

  await kvPut(kv, `session:${id}`, existing);
  return c.json(existing);
});

app.delete('/api/v1/sessions/:id', async (c) => {
  const id = c.req.param('id');
  const kv = c.env.SESSIONS_KV;
  await kv.delete(`session:${id}`);
  await kv.delete(`session:${id}:events`);
  await kv.delete(`session:${id}:marks`);
  await kv.delete(`session:${id}:track`);
  await kv.delete(`session:${id}:tracks`);
  await kv.delete(`session:${id}:video`);
  await kv.delete(`session:${id}:videos`);
  return c.json({ ok: true });
});

/* ── Track ───────────────────────────────────────────────────── */

app.get('/api/v1/sessions/:id/track', async (c) => {
  const id = c.req.param('id');
  const session = await kvGet<Session>(c.env.SESSIONS_KV, `session:${id}`);
  if (!session)
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'Session not found' } },
      404,
    );
  const primary = await getPrimaryTrack(c.env.SESSIONS_KV, session);
  let list = await getTrackPoints(c.env.SESSIONS_KV, id, primary.id);
  if (c.req.query('simplify') === 'true' && list.length > 100) {
    const step = Math.floor(list.length / 100);
    list = list.filter((_, i) => i % step === 0);
  }
  return c.json(list);
});

app.post('/api/v1/sessions/:id/track', async (c) => {
  const id = c.req.param('id');
  const kv = c.env.SESSIONS_KV;
  const session = await kvGet<Session>(kv, `session:${id}`);
  if (!session) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'Session not found' } },
      404,
    );
  }

  const body = await c.req.json<{ points?: TrackPoint[] }>();
  const points = body.points ?? [];
  const track = makeTrackStream(session, points, { id: 'primary' });
  await kvPut(kv, `session:${id}:tracks`, [track]);
  await kvPut(kv, `session:${id}:track:${track.id}`, points);
  await kvPut(kv, `session:${id}:track`, points);
  session.updatedAt = new Date().toISOString();
  await kvPut(kv, `session:${id}`, session);
  return c.json(points, 201);
});

app.get('/api/v1/sessions/:id/tracks', async (c) => {
  const id = c.req.param('id');
  const session = await kvGet<Session>(c.env.SESSIONS_KV, `session:${id}`);
  if (!session)
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'Session not found' } },
      404,
    );
  return c.json(await getTrackStreams(c.env.SESSIONS_KV, session));
});

app.post('/api/v1/sessions/:id/tracks', async (c) => {
  const sessionId = c.req.param('id');
  const kv = c.env.SESSIONS_KV;
  const session = await kvGet<Session>(kv, `session:${sessionId}`);
  if (!session)
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'Session not found' } },
      404,
    );

  const body = await c.req.json<{
    name?: string;
    role?: TrackStream['role'];
    boatId?: string;
    color?: string;
    points?: TrackPoint[];
    sourceFileName?: string;
    trackTimeOriginUnixMs?: number;
  }>();
  const existing = await getTrackStreams(kv, session);
  const points = body.points ?? [];
  const track = makeTrackStream(session, points, {
    id:
      body.role === 'primary' && !existing.some((item) => item.id === 'primary')
        ? 'primary'
        : genId(),
    name: body.name,
    role: body.role ?? 'comparison',
    sourceFileName: body.sourceFileName,
    trackTimeOriginUnixMs: body.trackTimeOriginUnixMs,
    color: body.color,
  });
  if (body.boatId) track.boatId = body.boatId;

  const tracks = [...existing, track];
  await kvPut(kv, `session:${sessionId}:tracks`, tracks);
  await kvPut(kv, `session:${sessionId}:track:${track.id}`, points);
  await savePrimaryCompatibilityTrack(kv, sessionId, tracks);
  session.updatedAt = new Date().toISOString();
  await kvPut(kv, `session:${sessionId}`, session);
  return c.json({ track, points } satisfies TrackStreamBundle, 201);
});

app.get('/api/v1/sessions/:id/tracks/:trackId/points', async (c) => {
  const sessionId = c.req.param('id');
  const trackId = c.req.param('trackId');
  const session = await kvGet<Session>(c.env.SESSIONS_KV, `session:${sessionId}`);
  if (!session)
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'Session not found' } },
      404,
    );
  const tracks = await getTrackStreams(c.env.SESSIONS_KV, session);
  if (!tracks.some((track) => track.id === trackId)) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Track not found' } }, 404);
  }
  return c.json(await getTrackPoints(c.env.SESSIONS_KV, sessionId, trackId));
});

app.put('/api/v1/sessions/:id/tracks/:trackId', async (c) => {
  const sessionId = c.req.param('id');
  const trackId = c.req.param('trackId');
  const kv = c.env.SESSIONS_KV;
  const session = await kvGet<Session>(kv, `session:${sessionId}`);
  if (!session)
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'Session not found' } },
      404,
    );
  const body = await c.req.json<Partial<TrackStream>>();
  const tracks = await getTrackStreams(kv, session);
  const index = tracks.findIndex((track) => track.id === trackId);
  if (index < 0) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Track not found' } }, 404);
  }
  tracks[index] = {
    ...tracks[index]!,
    ...body,
    id: trackId,
    sessionId,
    updatedAt: new Date().toISOString(),
  };
  await kvPut(kv, `session:${sessionId}:tracks`, tracks);
  await savePrimaryCompatibilityTrack(kv, sessionId, tracks);
  return c.json(tracks[index]);
});

app.delete('/api/v1/sessions/:id/tracks/:trackId', async (c) => {
  const sessionId = c.req.param('id');
  const trackId = c.req.param('trackId');
  const kv = c.env.SESSIONS_KV;
  const session = await kvGet<Session>(kv, `session:${sessionId}`);
  if (!session)
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'Session not found' } },
      404,
    );
  const tracks = await getTrackStreams(kv, session);
  const nextTracks = tracks.filter((track) => track.id !== trackId);
  if (nextTracks.length === tracks.length) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Track not found' } }, 404);
  }
  if (nextTracks.length === 0) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'Cannot delete the last track' } },
      400,
    );
  }
  await kvPut(kv, `session:${sessionId}:tracks`, nextTracks);
  await kv.delete(`session:${sessionId}:track:${trackId}`);
  await savePrimaryCompatibilityTrack(kv, sessionId, nextTracks);
  return c.json({ ok: true });
});

app.post('/api/v1/sessions/:id/tracks/:trackId/segments', async (c) => {
  const sessionId = c.req.param('id');
  const trackId = c.req.param('trackId');
  const kv = c.env.SESSIONS_KV;
  const session = await kvGet<Session>(kv, `session:${sessionId}`);
  if (!session)
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'Session not found' } },
      404,
    );

  const body = await c.req.json<{
    points?: TrackPoint[];
    sourceFileName?: string;
    sourcePath?: string;
    appendMode?: 'append' | 'insert-by-time';
  }>();
  const tracks = await getTrackStreams(kv, session);
  const index = tracks.findIndex((track) => track.id === trackId);
  if (index < 0) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Track not found' } }, 404);
  }

  const segmentPoints = body.points ?? [];
  const points = [
    ...(await getTrackPoints(kv, sessionId, trackId)),
    ...segmentPoints,
  ].sort((a, b) => a.t - b.t);
  const track = {
    ...tracks[index]!,
    segments: [
      ...tracks[index]!.segments,
      buildTrackSegment(trackId, segmentPoints, {
        sourceFileName: body.sourceFileName,
        sourcePath: body.sourcePath,
      }),
    ],
    stats: buildTrackStats(points, tracks[index]!.stats),
    updatedAt: new Date().toISOString(),
  };
  tracks[index] = track;
  await kvPut(kv, `session:${sessionId}:tracks`, tracks);
  await kvPut(kv, `session:${sessionId}:track:${trackId}`, points);
  await savePrimaryCompatibilityTrack(kv, sessionId, tracks);
  return c.json({ track, points } satisfies TrackStreamBundle, 201);
});

app.get('/api/v1/sessions/:id/stats', async (c) => {
  const id = c.req.param('id');
  const session = await kvGet<Session>(c.env.SESSIONS_KV, `session:${id}`);
  if (!session)
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'Session not found' } },
      404,
    );
  return c.json(session.stats);
});

/* ── Events ───────────────────────────────────────────────────── */

app.get('/api/v1/sessions/:id/events', async (c) => {
  const id = c.req.param('id');
  const data = await kvGet<SessionEvent[]>(c.env.SESSIONS_KV, `session:${id}:events`);
  return c.json(data ?? []);
});

app.post('/api/v1/sessions/:id/events', async (c) => {
  const sessionId = c.req.param('id');
  const kv = c.env.SESSIONS_KV;
  const body = await c.req.json<Partial<SessionEvent>>();

  const events = (await kvGet<SessionEvent[]>(kv, `session:${sessionId}:events`)) ?? [];
  const ev: SessionEvent = {
    id: genId(),
    sessionId,
    trackId: body.trackId,
    timestamp: body.timestamp ?? 0,
    startTime: body.startTime,
    endTime: body.endTime,
    type: body.type ?? 'general',
    note: body.note ?? 'New event',
    snapshotUrl: body.snapshotUrl,
    autoDetected: body.autoDetected,
    verified: body.verified,
    confidence: body.confidence,
    linkedMarkId: body.linkedMarkId,
    metrics: body.metrics,
    reasonCodes: body.reasonCodes,
  };
  if (!ev.trackId) {
    const session = await kvGet<Session>(kv, `session:${sessionId}`);
    if (session) ev.trackId = (await getPrimaryTrack(kv, session)).id;
  }
  events.push(ev);
  await kvPut(kv, `session:${sessionId}:events`, events);

  const session = await kvGet<Session>(kv, `session:${sessionId}`);
  if (session) {
    session.eventCount = events.length;
    await kvPut(kv, `session:${sessionId}`, session);
  }

  return c.json(ev, 201);
});

app.put('/api/v1/sessions/:id/events/:eid', async (c) => {
  const sessionId = c.req.param('id');
  const eid = c.req.param('eid');
  const kv = c.env.SESSIONS_KV;
  const body = await c.req.json<Partial<SessionEvent>>();

  const events = (await kvGet<SessionEvent[]>(kv, `session:${sessionId}:events`)) ?? [];
  const idx = events.findIndex((e) => e.id === eid);
  if (idx < 0)
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'Event not found' } },
      404,
    );

  events[idx] = { ...events[idx]!, ...body, id: eid, sessionId };
  await kvPut(kv, `session:${sessionId}:events`, events);
  return c.json(events[idx]);
});

app.delete('/api/v1/sessions/:id/events/:eid', async (c) => {
  const sessionId = c.req.param('id');
  const eid = c.req.param('eid');
  const kv = c.env.SESSIONS_KV;

  const events = (await kvGet<SessionEvent[]>(kv, `session:${sessionId}:events`)) ?? [];
  const filtered = events.filter((e) => e.id !== eid);
  await kvPut(kv, `session:${sessionId}:events`, filtered);

  const session = await kvGet<Session>(kv, `session:${sessionId}`);
  if (session) {
    session.eventCount = filtered.length;
    await kvPut(kv, `session:${sessionId}`, session);
  }

  return c.json({ ok: true });
});

/* ── Marks ────────────────────────────────────────────────────── */

app.get('/api/v1/sessions/:id/marks', async (c) => {
  const id = c.req.param('id');
  const data = await kvGet<Mark[]>(c.env.SESSIONS_KV, `session:${id}:marks`);
  return c.json(data ?? []);
});

app.post('/api/v1/sessions/:id/marks', async (c) => {
  const sessionId = c.req.param('id');
  const kv = c.env.SESSIONS_KV;
  const body = await c.req.json<Partial<Mark>>();

  const marks = (await kvGet<Mark[]>(kv, `session:${sessionId}:marks`)) ?? [];
  const mk: Mark = {
    id: genId(),
    sessionId,
    type: body.type ?? 'mark',
    name: body.name,
    lat: body.lat ?? 0,
    lon: body.lon ?? 0,
    order: body.order ?? marks.length,
  };
  marks.push(mk);
  await kvPut(kv, `session:${sessionId}:marks`, marks);
  return c.json(mk, 201);
});

app.delete('/api/v1/sessions/:id/marks/:mid', async (c) => {
  const sessionId = c.req.param('id');
  const mid = c.req.param('mid');
  const kv = c.env.SESSIONS_KV;

  const marks = (await kvGet<Mark[]>(kv, `session:${sessionId}:marks`)) ?? [];
  const filtered = marks.filter((m) => m.id !== mid);
  await kvPut(kv, `session:${sessionId}:marks`, filtered);
  return c.json({ ok: true });
});

app.put('/api/v1/sessions/:id/marks/:mid', async (c) => {
  const sessionId = c.req.param('id');
  const mid = c.req.param('mid');
  const kv = c.env.SESSIONS_KV;
  const body = await c.req.json<
    Partial<{ lat: number; lon: number; name: string; type: Mark['type'] }>
  >();

  const marks = (await kvGet<Mark[]>(kv, `session:${sessionId}:marks`)) ?? [];
  const idx = marks.findIndex((m) => m.id === mid);
  if (idx < 0)
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'Mark not found' } },
      404,
    );
  if (body.lat != null) marks[idx]!.lat = body.lat;
  if (body.lon != null) marks[idx]!.lon = body.lon;
  if (body.name !== undefined) marks[idx]!.name = body.name;
  if (body.type !== undefined) marks[idx]!.type = body.type;
  await kvPut(kv, `session:${sessionId}:marks`, marks);
  return c.json(marks[idx]);
});

/* ── Export & Share ──────────────────────────────────────────── */

app.post('/api/v1/sessions/:id/share', async (c) => {
  const sessionId = c.req.param('id');
  return c.json({
    url: `https://sailsiq.com/shared/${sessionId}/${genId()}`,
    format: 'link',
    createdAt: new Date().toISOString(),
  });
});

app.post('/api/v1/sessions/:id/export/pdf', async (c) => {
  const sessionId = c.req.param('id');
  return c.json({
    url: `https://sailsiq.com/export/${sessionId}/report-${genId()}.pdf`,
    format: 'pdf',
    createdAt: new Date().toISOString(),
  });
});

app.post('/api/v1/sessions/:id/export/video-assets', async (c) => {
  const sessionId = c.req.param('id');
  return c.json({
    url: `https://sailsiq.com/export/${sessionId}/video-assets-${genId()}.zip`,
    format: 'video',
    createdAt: new Date().toISOString(),
  });
});

/* ── Video ───────────────────────────────────────────────────── */

async function getSessionVideos(
  kv: KVNamespace,
  sessionId: string,
): Promise<SessionVideo[]> {
  const videos = await kvGet<SessionVideo[]>(kv, `session:${sessionId}:videos`);
  if (videos) return videos;

  const legacyVideo = await kvGet<SessionVideo>(kv, `session:${sessionId}:video`);
  if (!legacyVideo) return [];

  const migrated = [{ ...legacyVideo, id: legacyVideo.id ?? genId() }];
  await kvPut(kv, `session:${sessionId}:videos`, migrated);
  return migrated;
}

app.get('/api/v1/sessions/:id/video', async (c) => {
  const sessionId = c.req.param('id');
  const kv = c.env.SESSIONS_KV;
  const session = await kvGet<Session>(kv, `session:${sessionId}`);
  if (!session) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'Session not found' } },
      404,
    );
  }

  const videos = await getSessionVideos(kv, sessionId);
  return c.json(videos[0] ?? null);
});

app.get('/api/v1/sessions/:id/videos', async (c) => {
  const sessionId = c.req.param('id');
  const kv = c.env.SESSIONS_KV;
  const session = await kvGet<Session>(kv, `session:${sessionId}`);
  if (!session) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'Session not found' } },
      404,
    );
  }

  return c.json(await getSessionVideos(kv, sessionId));
});

app.post('/api/v1/sessions/:id/video/link', async (c) => {
  const sessionId = c.req.param('id');
  const kv = c.env.SESSIONS_KV;
  const session = await kvGet<Session>(kv, `session:${sessionId}`);
  if (!session) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'Session not found' } },
      404,
    );
  }

  const body = await c.req.json<{
    videoUrl?: string;
    videoType?: SessionVideo['videoType'];
    label?: string;
    offsetMs?: number;
    sync?: SessionVideo['sync'];
  }>();
  if (!body.videoUrl || body.videoUrl.trim() === '') {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'Video URL is required' } },
      400,
    );
  }

  const now = new Date().toISOString();
  const offsetMs = Number.isFinite(body.offsetMs)
    ? Number(body.offsetMs)
    : Number.isFinite(body.sync?.offsetMs)
      ? Number(body.sync?.offsetMs)
      : 0;
  const nextVideo: SessionVideo = {
    id: genId(),
    videoType: body.videoType ?? 'flat',
    url: body.videoUrl.trim(),
    label: body.label?.trim() || undefined,
    offsetMs,
    ...(body.sync ? { sync: { ...body.sync, offsetMs, updatedAt: now } } : {}),
    linkedAt: now,
    updatedAt: now,
  };

  const videos = await getSessionVideos(kv, sessionId);
  await kvPut(kv, `session:${sessionId}:videos`, [...videos, nextVideo]);
  await kvPut(kv, `session:${sessionId}:video`, nextVideo);
  session.updatedAt = now;
  await kvPut(kv, `session:${sessionId}`, session);
  return c.json(nextVideo, 201);
});

app.post('/api/v1/sessions/:id/video/sync', async (c) => {
  const sessionId = c.req.param('id');
  const kv = c.env.SESSIONS_KV;
  const session = await kvGet<Session>(kv, `session:${sessionId}`);
  if (!session) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'Session not found' } },
      404,
    );
  }

  const videos = await getSessionVideos(kv, sessionId);
  if (videos.length === 0) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'Video not linked' } },
      404,
    );
  }

  const body = await c.req.json<{
    offsetMs?: number;
    sync?: SessionVideo['sync'];
    videoId?: string;
  }>();
  const targetIndex = body.videoId
    ? videos.findIndex((video) => video.id === body.videoId)
    : 0;
  if (targetIndex < 0) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'Video not linked' } },
      404,
    );
  }

  const current = videos[targetIndex]!;
  const now = new Date().toISOString();
  const offsetMs = Number.isFinite(body.offsetMs)
    ? Number(body.offsetMs)
    : Number.isFinite(body.sync?.offsetMs)
      ? Number(body.sync?.offsetMs)
      : current.offsetMs;
  const nextVideo: SessionVideo = {
    ...current,
    offsetMs,
    ...(body.sync
      ? { sync: { ...body.sync, offsetMs, updatedAt: now } }
      : current.sync
        ? { sync: { ...current.sync, offsetMs, updatedAt: now } }
        : {}),
    updatedAt: now,
  };

  videos[targetIndex] = nextVideo;
  await kvPut(kv, `session:${sessionId}:videos`, videos);
  await kvPut(kv, `session:${sessionId}:video`, nextVideo);
  session.updatedAt = now;
  await kvPut(kv, `session:${sessionId}`, session);
  return c.json(nextVideo);
});

app.delete('/api/v1/sessions/:id/video', async (c) => {
  const sessionId = c.req.param('id');
  const kv = c.env.SESSIONS_KV;
  const session = await kvGet<Session>(kv, `session:${sessionId}`);
  if (!session) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'Session not found' } },
      404,
    );
  }

  const videoId = c.req.query('videoId');
  if (videoId) {
    const videos = await getSessionVideos(kv, sessionId);
    const nextVideos = videos.filter((video) => video.id !== videoId);
    await kvPut(kv, `session:${sessionId}:videos`, nextVideos);
    if (nextVideos.length > 0) {
      await kvPut(kv, `session:${sessionId}:video`, nextVideos[0]);
    } else {
      await kv.delete(`session:${sessionId}:video`);
    }
  } else {
    await kv.delete(`session:${sessionId}:video`);
    await kv.delete(`session:${sessionId}:videos`);
  }
  session.updatedAt = new Date().toISOString();
  await kvPut(kv, `session:${sessionId}`, session);
  return c.json({ ok: true });
});

/* ── Parser & Import ─────────────────────────────────────────── */

app.post('/api/v1/parser/preview', async (c) => {
  const formData = await c.req.formData();
  const file = formData.get('file');
  if (!isFileLike(file)) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'A GPX, UBX, or .bin file is required.' } },
      400,
    );
  }

  try {
    const parsed = parseImportBytes(file.name, await file.arrayBuffer());
    return c.json(parsed.preview);
  } catch (error) {
    return c.json(
      {
        error: {
          code: 'FILE_PARSE_ERROR',
          message:
            error instanceof Error ? error.message : 'Failed to parse import file.',
        },
      },
      422,
    );
  }
});

app.post('/api/v1/sessions/import', async (c) => {
  const formData = await c.req.formData();
  const file = formData.get('file');
  if (!isFileLike(file)) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'A GPX, UBX, or .bin file is required.' } },
      400,
    );
  }

  let parsed;
  try {
    parsed = parseImportBytes(file.name, await file.arrayBuffer());
  } catch (error) {
    return c.json(
      {
        error: {
          code: 'FILE_PARSE_ERROR',
          message:
            error instanceof Error ? error.message : 'Failed to parse import file.',
        },
      },
      422,
    );
  }

  const id = genId();
  const now = new Date().toISOString();
  const name = formData.get('name');
  const date = formData.get('date');
  const location = formData.get('location');
  const boatType = formData.get('boatType');
  const teamName = formData.get('teamName');
  const projectId = formData.get('projectId');
  const session: Session = {
    id,
    name:
      (typeof name === 'string' && name.trim()) ||
      getSessionNameFromImportFile(file.name),
    date:
      (typeof date === 'string' && date.trim()) ||
      parsed.preview.date ||
      now.slice(0, 10),
    location:
      (typeof location === 'string' && location.trim()) ||
      parsed.preview.location ||
      'Unknown',
    source: 'imported',
    boatType:
      typeof boatType === 'string' && boatType.trim() ? boatType.trim() : undefined,
    teamName:
      typeof teamName === 'string' && teamName.trim() ? teamName.trim() : undefined,
    projectId:
      typeof projectId === 'string' && projectId.trim() ? projectId.trim() : undefined,
    stats: parsed.stats,
    ...(parsed.trackTimeOriginUnixMs != null
      ? { trackTimeOriginUnixMs: parsed.trackTimeOriginUnixMs }
      : {}),
    eventCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  await kvPut(c.env.SESSIONS_KV, `session:${id}`, session);
  await kvPut(c.env.SESSIONS_KV, `session:${id}:events`, []);
  await kvPut(c.env.SESSIONS_KV, `session:${id}:marks`, []);
  const primaryTrack = makeTrackStream(session, parsed.points, {
    id: 'primary',
    sourceFileName: file.name,
    trackTimeOriginUnixMs: parsed.trackTimeOriginUnixMs,
  });
  const detectedEvents: SessionEvent[] = detectManeuvers({
    sessionId: id,
    trackId: primaryTrack.id,
    points: parsed.points,
  }).map((maneuver) => ({
    id: genId(),
    sessionId: id,
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
  session.eventCount = detectedEvents.length;
  await kvPut(c.env.SESSIONS_KV, `session:${id}:tracks`, [primaryTrack]);
  await kvPut(c.env.SESSIONS_KV, `session:${id}:track:${primaryTrack.id}`, parsed.points);
  await kvPut(c.env.SESSIONS_KV, `session:${id}:track`, parsed.points);
  await kvPut(c.env.SESSIONS_KV, `session:${id}:events`, detectedEvents);
  await kvPut(c.env.SESSIONS_KV, `session:${id}`, session);
  return c.json(session, 201);
});

/* ── Health ───────────────────────────────────────────────────── */

app.get('/api/v1/health', (c) => c.json({ status: 'ok', version: '0.1.0' }));

export default app;
