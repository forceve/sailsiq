import type { Mark, Session, SessionStats, TrackPoint } from '@/types/models';
import type { WorkspaceSessionBindingsManifest } from '@/types/workspace';
import {
  ensureWorkspaceSubdirectory,
  getRequiredWorkspaceDirectoryHandle,
  loadWorkspaceManifest,
  readWorkspaceJsonFile,
  saveWorkspaceManifest,
  writeWorkspaceJsonFile,
} from '@/services/workspace/localWorkspace';

type CanvasType = 'worldmap' | 'blank';

interface CreateLocalCanvasSessionInput {
  workspaceId: string;
  name: string;
  date: string;
  location: string;
  boatType?: string;
  projectId?: string;
  canvasType: CanvasType;
}

function createSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `local_session_${Date.now()}`;
}

function getEmptyStats(): SessionStats {
  return {
    duration: 0,
    distance: 0,
    maxSpeed: 0,
    avgSpeed: 0,
    turnCount: 0,
  };
}

async function getSessionDirectory(
  workspaceId: string,
  sessionId: string,
): Promise<FileSystemDirectoryHandle> {
  const workspaceHandle = await getRequiredWorkspaceDirectoryHandle(workspaceId);
  const sessionsDirectory = await ensureWorkspaceSubdirectory(workspaceHandle, 'sessions');
  return ensureWorkspaceSubdirectory(sessionsDirectory, sessionId);
}

export async function createLocalCanvasSession(
  input: CreateLocalCanvasSessionInput,
): Promise<Session> {
  const workspaceHandle = await getRequiredWorkspaceDirectoryHandle(input.workspaceId);
  const manifest = await loadWorkspaceManifest(workspaceHandle);
  if (!manifest) {
    throw new Error('workspace.json was not found in the current workspace.');
  }

  const sessionId = createSessionId();
  const now = new Date().toISOString();
  const session: Session = {
    id: sessionId,
    name: input.name,
    date: input.date,
    location: input.location,
    source: 'manual',
    boatType: input.boatType,
    projectId: input.projectId,
    canvasType: input.canvasType,
    stats: getEmptyStats(),
    eventCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  const sessionDirectory = await getSessionDirectory(input.workspaceId, sessionId);
  const bindings: WorkspaceSessionBindingsManifest = {
    track: null,
    videos: [],
  };
  await writeWorkspaceJsonFile(sessionDirectory, 'session.json', session);
  await writeWorkspaceJsonFile(sessionDirectory, 'track.json', []);
  await writeWorkspaceJsonFile(sessionDirectory, 'marks.json', []);
  await writeWorkspaceJsonFile(sessionDirectory, 'events.json', []);
  await writeWorkspaceJsonFile(sessionDirectory, 'bindings.json', bindings);

  if (!manifest.sessionsIndex.includes(sessionId)) {
    manifest.sessionsIndex = [sessionId, ...manifest.sessionsIndex];
  }
  manifest.updatedAt = now;
  await saveWorkspaceManifest(workspaceHandle, manifest);

  return session;
}

export async function getLocalCanvasSession(
  workspaceId: string,
  sessionId: string,
): Promise<Session | null> {
  const sessionDirectory = await getSessionDirectory(workspaceId, sessionId);
  return readWorkspaceJsonFile<Session>(sessionDirectory, 'session.json');
}

export async function getLocalCanvasTrack(
  workspaceId: string,
  sessionId: string,
): Promise<TrackPoint[]> {
  const sessionDirectory = await getSessionDirectory(workspaceId, sessionId);
  return (await readWorkspaceJsonFile<TrackPoint[]>(sessionDirectory, 'track.json')) ?? [];
}

export async function getLocalCanvasMarks(
  workspaceId: string,
  sessionId: string,
): Promise<Mark[]> {
  const sessionDirectory = await getSessionDirectory(workspaceId, sessionId);
  return (await readWorkspaceJsonFile<Mark[]>(sessionDirectory, 'marks.json')) ?? [];
}

export async function saveLocalCanvasSession(
  workspaceId: string,
  sessionId: string,
  data: {
    session: Session;
    track: TrackPoint[];
    marks: Mark[];
  },
): Promise<void> {
  const workspaceHandle = await getRequiredWorkspaceDirectoryHandle(workspaceId);
  const manifest = await loadWorkspaceManifest(workspaceHandle);
  if (!manifest) {
    throw new Error('workspace.json was not found in the current workspace.');
  }

  const sessionDirectory = await getSessionDirectory(workspaceId, sessionId);
  const now = new Date().toISOString();
  const session: Session = {
    ...data.session,
    updatedAt: now,
    eventCount: data.marks.length,
  };

  await writeWorkspaceJsonFile(sessionDirectory, 'session.json', session);
  await writeWorkspaceJsonFile(sessionDirectory, 'track.json', data.track);
  await writeWorkspaceJsonFile(sessionDirectory, 'marks.json', data.marks);

  if (!manifest.sessionsIndex.includes(sessionId)) {
    manifest.sessionsIndex = [sessionId, ...manifest.sessionsIndex];
  }
  manifest.updatedAt = now;
  await saveWorkspaceManifest(workspaceHandle, manifest);
}
