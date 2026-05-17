import type {
  ImportedTrackPoint,
  ParsedImportTrack,
} from '../../../../shared/trackImport';
import {
  getSessionNameFromImportFile,
  parseImportBytes,
} from '../../../../shared/trackImport';
import { detectManeuvers } from '../../../../shared/maneuverDetection';
import type {
  Mark,
  ParseResult,
  Session,
  SessionEvent,
  TrackPoint,
  TrackStream,
} from '@/types/models';
import type {
  WorkspaceSessionBindingsManifest,
  WorkspaceTrackFileSummary,
  WorkspaceVideoBinding,
  WorkspaceVideoFileSummary,
} from '@/types/workspace';
import {
  copyWorkspaceFileIntoDirectory,
  ensureWorkspaceSubdirectory,
  getRequiredWorkspaceDirectoryHandle,
  loadWorkspaceManifest,
  readWorkspaceJsonFile,
  saveWorkspaceManifest,
  scanStoredWorkspace,
  writeWorkspaceJsonFile,
} from '@/services/workspace/localWorkspace';
import { createTrackStream } from '@/utils/trackStreams';

type WorkspaceTrackImportSource =
  | {
      kind: 'workspace_discovery';
      relativePath: string;
    }
  | {
      kind: 'external_file_picker';
      copySourceToWorkspace: boolean;
    };

export interface CreateLocalImportedTrackSessionInput {
  workspaceId: string;
  session: Session;
  sourceFile: File;
  source: WorkspaceTrackImportSource;
  parsedTrack?: ParsedImportTrack;
}

export interface LocalWorkspaceSessionBundle {
  session: Session;
  track: TrackPoint[];
  tracks: TrackStream[];
  trackPointsById: Record<string, TrackPoint[]>;
  events: SessionEvent[];
  marks: Mark[];
  bindings: WorkspaceSessionBindingsManifest | null;
}

const TRACK_EXTENSIONS = new Set(['.gpx', '.ubx', '.bin']);
const VIDEO_EXTENSIONS = new Set([
  '.mp4',
  '.mov',
  '.m4v',
  '.webm',
  '.mkv',
  '.avi',
]);

function fileNotFound(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'NotFoundError';
}

function getFileExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : '';
}

function toTrackPoints(points: ImportedTrackPoint[]): TrackPoint[] {
  return points.map((point) => ({
    t: point.t,
    lat: point.lat,
    lon: point.lon,
    s: point.s,
    h: point.h,
    w_s: point.w_s,
    w_d: point.w_d,
  }));
}

function toSessionRelativePath(workspaceRelativePath: string): string {
  return `../../${workspaceRelativePath.replace(/^\.?\//, '')}`;
}

function toWorkspaceRelativePath(sessionBindingPath: string): string {
  return sessionBindingPath.replace(/^(?:\.\.\/)+/, '');
}

async function getSessionDirectory(
  workspaceId: string,
  sessionId: string,
): Promise<FileSystemDirectoryHandle> {
  const workspaceHandle = await getRequiredWorkspaceDirectoryHandle(workspaceId);
  const sessionsDirectory = await ensureWorkspaceSubdirectory(workspaceHandle, 'sessions');
  return ensureWorkspaceSubdirectory(sessionsDirectory, sessionId);
}

async function getExistingSessionDirectory(
  workspaceHandle: FileSystemDirectoryHandle,
  sessionId: string,
): Promise<FileSystemDirectoryHandle | null> {
  try {
    const sessionsDirectory = await workspaceHandle.getDirectoryHandle('sessions');
    return await sessionsDirectory.getDirectoryHandle(sessionId);
  } catch (error) {
    if (fileNotFound(error)) return null;
    throw error;
  }
}

async function readLocalTrackBundle(
  sessionDirectory: FileSystemDirectoryHandle,
  session: Session,
): Promise<{
  tracks: TrackStream[];
  trackPointsById: Record<string, TrackPoint[]>;
  primaryPoints: TrackPoint[];
}> {
  const tracks = await readWorkspaceJsonFile<TrackStream[]>(
    sessionDirectory,
    'tracks.json',
  );

  if (tracks && tracks.length > 0) {
    let tracksDirectory: FileSystemDirectoryHandle | null = null;
    try {
      tracksDirectory = await sessionDirectory.getDirectoryHandle('tracks');
    } catch (error) {
      if (!fileNotFound(error)) throw error;
    }

    const trackPointsById: Record<string, TrackPoint[]> = {};
    await Promise.all(
      tracks.map(async (track) => {
        trackPointsById[track.id] = tracksDirectory
          ? (await readWorkspaceJsonFile<TrackPoint[]>(
              tracksDirectory,
              `${track.id}.json`,
            )) ?? []
          : [];
      }),
    );

    const primaryTrack = tracks.find((track) => track.role === 'primary') ?? tracks[0]!;
    return {
      tracks,
      trackPointsById,
      primaryPoints: trackPointsById[primaryTrack.id] ?? [],
    };
  }

  const legacyPoints =
    (await readWorkspaceJsonFile<TrackPoint[]>(sessionDirectory, 'track.json')) ?? [];
  const primaryTrack = createTrackStream(session, legacyPoints, { id: 'primary' });
  return {
    tracks: [primaryTrack],
    trackPointsById: { [primaryTrack.id]: legacyPoints },
    primaryPoints: legacyPoints,
  };
}

async function collectBoundIncomingTrackNames(
  workspaceHandle: FileSystemDirectoryHandle,
): Promise<Set<string>> {
  const manifest = await loadWorkspaceManifest(workspaceHandle);
  const boundNames = new Set<string>();
  if (!manifest) return boundNames;

  for (const sessionId of manifest.sessionsIndex) {
    const sessionDirectory = await getExistingSessionDirectory(
      workspaceHandle,
      sessionId,
    );
    if (!sessionDirectory) continue;

    try {
      const bindings = await readWorkspaceJsonFile<WorkspaceSessionBindingsManifest>(
        sessionDirectory,
        'bindings.json',
      );
      const trackPath = bindings?.track?.path;
      if (!trackPath || !trackPath.includes('incoming/track/')) continue;
      const fileName = trackPath.split('/').pop();
      if (fileName) {
        boundNames.add(fileName);
      }
    } catch {
      // Ignore broken bindings while building the discovery list.
    }
  }

  return boundNames;
}

export async function parseLocalTrackFile(
  file: File,
): Promise<ParsedImportTrack> {
  const bytes = await file.arrayBuffer();
  return parseImportBytes(file.name, bytes);
}

export function getSessionNameFromLocalTrackFile(fileName: string): string {
  return getSessionNameFromImportFile(fileName);
}

export async function listLocalWorkspaceTrackFiles(
  workspaceId: string,
): Promise<WorkspaceTrackFileSummary[]> {
  const workspaceHandle = await getRequiredWorkspaceDirectoryHandle(workspaceId);
  const incomingDirectory = await ensureWorkspaceSubdirectory(workspaceHandle, 'incoming');
  const trackDirectory = await ensureWorkspaceSubdirectory(incomingDirectory, 'track');
  const boundTrackNames = await collectBoundIncomingTrackNames(workspaceHandle);
  const trackFiles: WorkspaceTrackFileSummary[] = [];

  for await (const entry of trackDirectory.values()) {
    if (
      entry.kind !== 'file' ||
      !TRACK_EXTENSIONS.has(getFileExtension(entry.name)) ||
      boundTrackNames.has(entry.name)
    ) {
      continue;
    }

    const fileHandle = entry as FileSystemFileHandle;
    const file = await fileHandle.getFile();
    trackFiles.push({
      name: entry.name,
      relativePath: `incoming/track/${entry.name}`,
      size: file.size,
      updatedAt: new Date(file.lastModified).toISOString(),
    });
  }

  return trackFiles.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

export async function loadLocalWorkspaceTrackFile(
  workspaceId: string,
  fileName: string,
): Promise<File> {
  const workspaceHandle = await getRequiredWorkspaceDirectoryHandle(workspaceId);
  const incomingDirectory = await ensureWorkspaceSubdirectory(workspaceHandle, 'incoming');
  const trackDirectory = await ensureWorkspaceSubdirectory(incomingDirectory, 'track');
  const fileHandle = await trackDirectory.getFileHandle(fileName);
  return fileHandle.getFile();
}

async function listVideoFilesFromDirectory(
  directoryHandle: FileSystemDirectoryHandle,
  collection: WorkspaceVideoFileSummary['collection'],
  baseRelativePath: string,
): Promise<WorkspaceVideoFileSummary[]> {
  const files: WorkspaceVideoFileSummary[] = [];

  for await (const entry of directoryHandle.values()) {
    if (
      entry.kind !== 'file' ||
      !VIDEO_EXTENSIONS.has(getFileExtension(entry.name))
    ) {
      continue;
    }

    const fileHandle = entry as FileSystemFileHandle;
    const file = await fileHandle.getFile();
    files.push({
      name: entry.name,
      relativePath: `${baseRelativePath}/${entry.name}`,
      size: file.size,
      updatedAt: new Date(file.lastModified).toISOString(),
      collection,
    });
  }

  return files;
}

export async function listLocalWorkspaceVideoFiles(
  workspaceId: string,
): Promise<WorkspaceVideoFileSummary[]> {
  const workspaceHandle = await getRequiredWorkspaceDirectoryHandle(workspaceId);
  const incomingDirectory = await ensureWorkspaceSubdirectory(workspaceHandle, 'incoming');
  const incomingVideoDirectory = await ensureWorkspaceSubdirectory(
    incomingDirectory,
    'video',
  );
  const libraryDirectory = await ensureWorkspaceSubdirectory(workspaceHandle, 'library');
  const libraryVideoDirectory = await ensureWorkspaceSubdirectory(
    libraryDirectory,
    'video',
  );

  const [incomingVideos, libraryVideos] = await Promise.all([
    listVideoFilesFromDirectory(incomingVideoDirectory, 'incoming', 'incoming/video'),
    listVideoFilesFromDirectory(libraryVideoDirectory, 'library', 'library/video'),
  ]);

  return [...incomingVideos, ...libraryVideos].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

export async function loadLocalWorkspaceVideoFile(
  workspaceId: string,
  relativePath: string,
): Promise<File> {
  const normalizedPath = relativePath.replace(/^\.?\//, '');
  const segments = normalizedPath.split('/').filter(Boolean);
  if (segments.length < 2) {
    throw new Error('Workspace video path is invalid.');
  }

  let directoryHandle = await getRequiredWorkspaceDirectoryHandle(workspaceId);
  for (const segment of segments.slice(0, -1)) {
    directoryHandle = await directoryHandle.getDirectoryHandle(segment);
  }

  const fileHandle = await directoryHandle.getFileHandle(segments[segments.length - 1]!);
  return fileHandle.getFile();
}

export async function getLocalWorkspaceSessionBindings(
  workspaceId: string,
  sessionId: string,
): Promise<WorkspaceSessionBindingsManifest | null> {
  const workspaceHandle = await getRequiredWorkspaceDirectoryHandle(workspaceId);
  const sessionDirectory = await getExistingSessionDirectory(workspaceHandle, sessionId);
  if (!sessionDirectory) return null;
  return readWorkspaceJsonFile<WorkspaceSessionBindingsManifest>(
    sessionDirectory,
    'bindings.json',
  );
}

export async function getLocalWorkspaceSessionBundle(
  workspaceId: string,
  sessionId: string,
): Promise<LocalWorkspaceSessionBundle | null> {
  const workspaceHandle = await getRequiredWorkspaceDirectoryHandle(workspaceId);
  const sessionDirectory = await getExistingSessionDirectory(workspaceHandle, sessionId);
  if (!sessionDirectory) return null;

  const [session, events, marks, bindings] = await Promise.all([
    readWorkspaceJsonFile<Session>(sessionDirectory, 'session.json'),
    readWorkspaceJsonFile<SessionEvent[]>(sessionDirectory, 'events.json'),
    readWorkspaceJsonFile<Mark[]>(sessionDirectory, 'marks.json'),
    readWorkspaceJsonFile<WorkspaceSessionBindingsManifest>(
      sessionDirectory,
      'bindings.json',
    ),
  ]);

  if (!session) return null;
  const { tracks, trackPointsById, primaryPoints } = await readLocalTrackBundle(
    sessionDirectory,
    session,
  );

  return {
    session,
    track: primaryPoints,
    tracks,
    trackPointsById,
    events: events ?? [],
    marks: marks ?? [],
    bindings,
  };
}

export async function saveLocalWorkspaceSessionVideoBindings(
  workspaceId: string,
  sessionId: string,
  videos: WorkspaceVideoBinding[],
): Promise<void> {
  const sessionDirectory = await getSessionDirectory(workspaceId, sessionId);
  const bindings =
    (await readWorkspaceJsonFile<WorkspaceSessionBindingsManifest>(
      sessionDirectory,
      'bindings.json',
    )) ?? {
      track: null,
      videos: [],
    };

  const nextBindings: WorkspaceSessionBindingsManifest = {
    ...bindings,
    videos,
  };
  await writeWorkspaceJsonFile(sessionDirectory, 'bindings.json', nextBindings);
}

export async function saveLocalWorkspaceSession(
  workspaceId: string,
  session: Session,
): Promise<void> {
  const sessionDirectory = await getSessionDirectory(workspaceId, session.id);
  await writeWorkspaceJsonFile(sessionDirectory, 'session.json', session);
}

export async function saveLocalWorkspaceSessionEvents(
  workspaceId: string,
  sessionId: string,
  events: SessionEvent[],
): Promise<void> {
  const sessionDirectory = await getSessionDirectory(workspaceId, sessionId);
  await writeWorkspaceJsonFile(sessionDirectory, 'events.json', events);
}

export function getWorkspaceRelativeBindingPath(
  sessionBindingPath: string,
): string {
  return toWorkspaceRelativePath(sessionBindingPath);
}

export async function createLocalImportedTrackSession(
  input: CreateLocalImportedTrackSessionInput,
): Promise<Session> {
  const workspaceHandle = await getRequiredWorkspaceDirectoryHandle(input.workspaceId);
  const manifest = await loadWorkspaceManifest(workspaceHandle);
  if (!manifest) {
    throw new Error('workspace.json was not found in the current workspace.');
  }

  const parsedTrack = input.parsedTrack ?? (await parseLocalTrackFile(input.sourceFile));
  const now = new Date().toISOString();
  const sessionDirectory = await getSessionDirectory(input.workspaceId, input.session.id);
  const session: Session = {
    ...input.session,
    source: 'imported',
    stats: parsedTrack.stats,
    eventCount: 0,
    updatedAt: now,
    ...(parsedTrack.trackTimeOriginUnixMs != null
      ? { trackTimeOriginUnixMs: parsedTrack.trackTimeOriginUnixMs }
      : {}),
  };
  const marks: Mark[] = [];
  const trackPoints = toTrackPoints(parsedTrack.points);
  const primaryTrack = createTrackStream(session, trackPoints, {
    id: 'primary',
    sourceFileName: input.sourceFile.name,
    trackTimeOriginUnixMs: parsedTrack.trackTimeOriginUnixMs,
    now,
  });
  const events: SessionEvent[] = detectManeuvers({
    sessionId: session.id,
    trackId: primaryTrack.id,
    points: trackPoints,
    marks,
  }).map((maneuver, index) => ({
    id: `auto-${primaryTrack.id}-${maneuver.type}-${Math.round(maneuver.timestamp)}-${index}`,
    sessionId: session.id,
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
  session.eventCount = events.length;

  let bindings: WorkspaceSessionBindingsManifest;
  if (input.source.kind === 'workspace_discovery') {
    bindings = {
      track: {
        path: toSessionRelativePath(input.source.relativePath),
        fileName: input.sourceFile.name,
        sourceKind: 'workspace_discovery',
        storageMode: 'workspace_relative_ref',
        saveStrategy: 'workspace_source',
        copiedToWorkspace: false,
        confirmed: true,
        boundAt: now,
      },
      videos: [],
    };
  } else if (input.source.copySourceToWorkspace) {
    const incomingDirectory = await ensureWorkspaceSubdirectory(workspaceHandle, 'incoming');
    const trackDirectory = await ensureWorkspaceSubdirectory(incomingDirectory, 'track');
    const copiedName = await copyWorkspaceFileIntoDirectory(
      trackDirectory,
      input.sourceFile,
    );
    bindings = {
      track: {
        path: toSessionRelativePath(`incoming/track/${copiedName}`),
        fileName: input.sourceFile.name,
        sourceKind: 'external_file_picker',
        storageMode: 'workspace_copy',
        saveStrategy: 'save_copy',
        copiedToWorkspace: true,
        confirmed: true,
        boundAt: now,
      },
      videos: [],
    };
  } else {
    bindings = {
      track: {
        path: input.sourceFile.name,
        fileName: input.sourceFile.name,
        sourceKind: 'external_file_picker',
        storageMode: 'external_absolute_ref',
        saveStrategy: 'save_session_only',
        copiedToWorkspace: false,
        confirmed: true,
        boundAt: now,
      },
      videos: [],
    };
  }

  await writeWorkspaceJsonFile(sessionDirectory, 'session.json', session);
  await writeWorkspaceJsonFile(sessionDirectory, 'tracks.json', [primaryTrack]);
  const tracksDirectory = await ensureWorkspaceSubdirectory(sessionDirectory, 'tracks');
  await writeWorkspaceJsonFile(tracksDirectory, `${primaryTrack.id}.json`, trackPoints);
  await writeWorkspaceJsonFile(sessionDirectory, 'track.json', trackPoints);
  await writeWorkspaceJsonFile(sessionDirectory, 'events.json', events);
  await writeWorkspaceJsonFile(sessionDirectory, 'marks.json', marks);
  await writeWorkspaceJsonFile(sessionDirectory, 'bindings.json', bindings);

  if (!manifest.sessionsIndex.includes(session.id)) {
    manifest.sessionsIndex = [session.id, ...manifest.sessionsIndex];
  }
  manifest.updatedAt = now;
  await saveWorkspaceManifest(workspaceHandle, manifest);
  await scanStoredWorkspace(input.workspaceId);

  return session;
}

export async function listLocalWorkspaceSessions(
  workspaceId: string,
): Promise<Session[]> {
  const workspaceHandle = await getRequiredWorkspaceDirectoryHandle(workspaceId);
  const manifest = await loadWorkspaceManifest(workspaceHandle);
  if (!manifest) {
    throw new Error('workspace.json was not found in the current workspace.');
  }

  const sessions = await Promise.all(
    manifest.sessionsIndex.map(async (sessionId) => {
      const sessionDirectory = await getExistingSessionDirectory(
        workspaceHandle,
        sessionId,
      );
      if (!sessionDirectory) return null;
      return readWorkspaceJsonFile<Session>(sessionDirectory, 'session.json');
    }),
  );

  return sessions
    .filter((session): session is Session => session != null)
    .sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
}

export type { ParsedImportTrack, ParseResult };
