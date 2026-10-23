import type {
  ImportedTrackPoint,
  ParsedImportTrack,
} from '../../../../shared/trackImport';
import {
  getSessionNameFromImportFile,
  parseImportBytes,
} from '../../../../shared/trackImport';
import {
  parseTelemetryImportBytes,
  type ParsedTelemetryImport,
} from '../../../../shared/telemetryImport';
import { detectManeuvers } from '../../../../shared/maneuverDetection';
import type {
  Mark,
  ParseResult,
  Session,
  SessionEvent,
  TelemetryDataset,
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
  telemetryDatasets: TelemetryDataset[];
  events: SessionEvent[];
  marks: Mark[];
  bindings: WorkspaceSessionBindingsManifest | null;
}

export interface LocalWorkspaceSessionShell {
  session: Session;
  tracks: TrackStream[];
  telemetryDatasets: TelemetryDataset[];
  events: SessionEvent[];
  marks: Mark[];
  bindings: WorkspaceSessionBindingsManifest | null;
}

export interface LocalTrackPointsChunk {
  trackId: string;
  points: TrackPoint[];
  chunkIndex: number;
  chunkCount: number;
  totalPoints: number;
}

export interface LocalTelemetryDatasetChunk {
  datasetId: string;
  dataset: TelemetryDataset;
  chunkIndex: number;
  chunkCount: number;
}

interface TrackPointsChunkManifest {
  version: 1;
  trackId: string;
  chunkSize: number;
  pointCount: number;
  chunks: Array<{
    fileName: string;
    startIndex: number;
    endIndex: number;
    startMs: number;
    endMs: number;
  }>;
}

interface TelemetryDatasetChunkManifest {
  version: 1;
  chunkSize: number;
  datasets: TelemetryDataset[];
  chunksByDatasetId: Record<
    string,
    Array<{
      fileName: string;
      chunkIndex: number;
      startSampleIndex: number;
      endSampleIndex: number;
      startMs: number;
      endMs: number;
    }>
  >;
}

type TelemetryDatasetChunkInfo =
  TelemetryDatasetChunkManifest['chunksByDatasetId'][string][number];

const TRACK_EXTENSIONS = new Set(['.gpx', '.ubx', '.ldc', '.bin', '.csv', '.tsv', '.txt']);
const TELEMETRY_EXTENSIONS = new Set(['.csv', '.tsv', '.txt']);
const VIDEO_EXTENSIONS = new Set([
  '.mp4',
  '.mov',
  '.m4v',
  '.webm',
  '.mkv',
  '.avi',
]);
const TRACK_POINT_CHUNK_SIZE = 10000;
const TELEMETRY_SAMPLE_CHUNK_SIZE = 500;

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
          ? await readTrackPointsForTrack(tracksDirectory, track.id)
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

export async function parseLocalTelemetryFile(
  file: File,
  options: { sessionId?: string } = {},
): Promise<ParsedTelemetryImport> {
  const bytes = await file.arrayBuffer();
  return parseTelemetryImportBytes(file.name, bytes, options);
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
  const telemetryDatasets = await readFullTelemetryDatasets(sessionDirectory);

  return {
    session,
    track: primaryPoints,
    tracks,
    trackPointsById,
    telemetryDatasets,
    events: events ?? [],
    marks: marks ?? [],
    bindings,
  };
}

async function readTrackPointsForTrack(
  tracksDirectory: FileSystemDirectoryHandle,
  trackId: string,
): Promise<TrackPoint[]> {
  const chunked = await readChunkedTrackPoints(tracksDirectory, trackId);
  if (chunked) return chunked;

  const points =
    (await readWorkspaceJsonFile<TrackPoint[]>(tracksDirectory, `${trackId}.json`)) ?? [];
  if (points.length > TRACK_POINT_CHUNK_SIZE) {
    await writeChunkedTrackPoints(tracksDirectory, trackId, points);
  }
  return points;
}

async function getTrackPointsDirectory(
  tracksDirectory: FileSystemDirectoryHandle,
  trackId: string,
  create: boolean,
): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await tracksDirectory.getDirectoryHandle(trackId, { create });
  } catch (error) {
    if (fileNotFound(error)) return null;
    throw error;
  }
}

async function readChunkedTrackPoints(
  tracksDirectory: FileSystemDirectoryHandle,
  trackId: string,
): Promise<TrackPoint[] | null> {
  const pointsDirectory = await getTrackPointsDirectory(tracksDirectory, trackId, false);
  if (!pointsDirectory) return null;

  const manifest = await readWorkspaceJsonFile<TrackPointsChunkManifest>(
    pointsDirectory,
    'manifest.json',
  );
  if (!manifest || manifest.version !== 1 || manifest.chunks.length === 0) {
    return null;
  }

  const chunks = await Promise.all(
    manifest.chunks.map(
      async (chunk) =>
        (await readWorkspaceJsonFile<TrackPoint[]>(pointsDirectory, chunk.fileName)) ?? [],
    ),
  );
  return chunks.flat();
}

async function writeChunkedTrackPoints(
  tracksDirectory: FileSystemDirectoryHandle,
  trackId: string,
  points: TrackPoint[],
): Promise<void> {
  const pointsDirectory = await getTrackPointsDirectory(tracksDirectory, trackId, true);
  if (!pointsDirectory) return;

  const chunks: TrackPointsChunkManifest['chunks'] = [];
  for (let start = 0, chunkIndex = 0; start < points.length; start += TRACK_POINT_CHUNK_SIZE, chunkIndex++) {
    const chunkPoints = points.slice(start, start + TRACK_POINT_CHUNK_SIZE);
    const endIndex = start + chunkPoints.length - 1;
    const fileName = `chunk-${String(chunkIndex).padStart(5, '0')}.json`;
    await writeWorkspaceJsonFile(pointsDirectory, fileName, chunkPoints);
    chunks.push({
      fileName,
      startIndex: start,
      endIndex,
      startMs: chunkPoints[0]?.t ?? 0,
      endMs: chunkPoints[chunkPoints.length - 1]?.t ?? chunkPoints[0]?.t ?? 0,
    });
  }

  await writeWorkspaceJsonFile(pointsDirectory, 'manifest.json', {
    version: 1,
    trackId,
    chunkSize: TRACK_POINT_CHUNK_SIZE,
    pointCount: points.length,
    chunks,
  } satisfies TrackPointsChunkManifest);
}

function stripTelemetrySamples(dataset: TelemetryDataset): TelemetryDataset {
  return {
    ...dataset,
    channels: dataset.channels.map((channel) => ({
      ...channel,
      samples: [],
    })),
  };
}

function appendTelemetryChunk(
  base: TelemetryDataset,
  chunk: TelemetryDataset,
): TelemetryDataset {
  const chunkChannels = new Map(chunk.channels.map((channel) => [channel.id, channel]));
  return {
    ...base,
    channels: base.channels.map((channel) => ({
      ...channel,
      samples: [
        ...channel.samples,
        ...(chunkChannels.get(channel.id)?.samples ?? []),
      ],
    })),
  };
}

async function getTelemetryDirectory(
  sessionDirectory: FileSystemDirectoryHandle,
  create: boolean,
): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await sessionDirectory.getDirectoryHandle('telemetry', { create });
  } catch (error) {
    if (fileNotFound(error)) return null;
    throw error;
  }
}

async function readTelemetryManifest(
  sessionDirectory: FileSystemDirectoryHandle,
): Promise<{
  directory: FileSystemDirectoryHandle;
  manifest: TelemetryDatasetChunkManifest;
} | null> {
  const directory = await getTelemetryDirectory(sessionDirectory, false);
  if (!directory) return null;
  const manifest = await readWorkspaceJsonFile<TelemetryDatasetChunkManifest>(
    directory,
    'manifest.json',
  );
  if (!manifest || manifest.version !== 1) return null;
  return { directory, manifest: normalizeTelemetryManifestChunkTimes(manifest) };
}

function normalizeTelemetryManifestChunkTimes(
  manifest: TelemetryDatasetChunkManifest,
): TelemetryDatasetChunkManifest {
  const datasetsById = new Map(manifest.datasets.map((dataset) => [dataset.id, dataset]));
  const chunksByDatasetId: TelemetryDatasetChunkManifest['chunksByDatasetId'] = {};

  Object.entries(manifest.chunksByDatasetId).forEach(([datasetId, chunks]) => {
    const dataset = datasetsById.get(datasetId);
    const sortedChunks = [...chunks].sort((a, b) => a.chunkIndex - b.chunkIndex);
    const maxEndIndex = Math.max(0, ...sortedChunks.map((chunk) => chunk.endSampleIndex));
    chunksByDatasetId[datasetId] = sortedChunks.map((chunk) => {
      if (Number.isFinite(chunk.startMs) && Number.isFinite(chunk.endMs)) {
        return chunk;
      }

      const durationMs = Math.max(0, dataset?.durationMs ?? 0);
      const startRatio = maxEndIndex > 0 ? chunk.startSampleIndex / maxEndIndex : 0;
      const endRatio = maxEndIndex > 0 ? chunk.endSampleIndex / maxEndIndex : 0;
      return {
        ...chunk,
        startMs: Math.round(durationMs * startRatio),
        endMs: Math.round(durationMs * endRatio),
      };
    });
  });

  return {
    ...manifest,
    chunksByDatasetId,
  };
}

async function readTelemetryShell(
  sessionDirectory: FileSystemDirectoryHandle,
): Promise<TelemetryDataset[]> {
  const chunked = await readTelemetryManifest(sessionDirectory);
  if (chunked) return chunked.manifest.datasets;

  // Legacy telemetry.json can be very large; skip it in the shell path and let
  // the background chunk loader read and migrate it.
  return [];
}

async function readFullTelemetryDatasets(
  sessionDirectory: FileSystemDirectoryHandle,
): Promise<TelemetryDataset[]> {
  const chunked = await readTelemetryManifest(sessionDirectory);
  if (!chunked) {
    const legacy =
      (await readWorkspaceJsonFile<TelemetryDataset[]>(sessionDirectory, 'telemetry.json')) ?? [];
    if (legacy.length > 0) {
      await writeChunkedTelemetryDatasets(sessionDirectory, legacy);
    }
    return legacy;
  }

  const byId = new Map(
    chunked.manifest.datasets.map((dataset) => [dataset.id, stripTelemetrySamples(dataset)]),
  );

  for (const dataset of chunked.manifest.datasets) {
    const chunks = chunked.manifest.chunksByDatasetId[dataset.id] ?? [];
    for (const chunk of chunks) {
      const chunkDataset = await readWorkspaceJsonFile<TelemetryDataset>(
        chunked.directory,
        chunk.fileName,
      );
      if (!chunkDataset) continue;
      const current = byId.get(dataset.id) ?? stripTelemetrySamples(dataset);
      byId.set(dataset.id, appendTelemetryChunk(current, chunkDataset));
    }
  }

  return Array.from(byId.values());
}

async function writeChunkedTelemetryDatasets(
  sessionDirectory: FileSystemDirectoryHandle,
  datasets: TelemetryDataset[],
): Promise<void> {
  const directory = await getTelemetryDirectory(sessionDirectory, true);
  if (!directory) return;

  const chunksByDatasetId: TelemetryDatasetChunkManifest['chunksByDatasetId'] = {};
  for (const dataset of datasets) {
    const maxSamples = Math.max(0, ...dataset.channels.map((channel) => channel.samples.length));
    const chunks = [];
    for (let start = 0, chunkIndex = 0; start < maxSamples; start += TELEMETRY_SAMPLE_CHUNK_SIZE, chunkIndex++) {
      const end = Math.min(maxSamples, start + TELEMETRY_SAMPLE_CHUNK_SIZE);
      const chunkDataset: TelemetryDataset = {
        ...stripTelemetrySamples(dataset),
        channels: dataset.channels.map((channel) => ({
          ...channel,
          samples: channel.samples.slice(start, end),
        })),
      };
      const fileName = `${dataset.id}-chunk-${String(chunkIndex).padStart(5, '0')}.json`;
      await writeWorkspaceJsonFile(directory, fileName, chunkDataset);
      const chunkTimes = chunkDataset.channels.flatMap((channel) =>
        channel.samples.map((sample) => sample.t),
      );
      chunks.push({
        fileName,
        chunkIndex,
        startSampleIndex: start,
        endSampleIndex: end - 1,
        startMs: chunkTimes.length > 0 ? Math.min(...chunkTimes) : 0,
        endMs: chunkTimes.length > 0 ? Math.max(...chunkTimes) : 0,
      });
    }
    chunksByDatasetId[dataset.id] = chunks;
  }

  await writeWorkspaceJsonFile(directory, 'manifest.json', {
    version: 1,
    chunkSize: TELEMETRY_SAMPLE_CHUNK_SIZE,
    datasets: datasets.map(stripTelemetrySamples),
    chunksByDatasetId,
  } satisfies TelemetryDatasetChunkManifest);
}

async function readLocalTrackShell(
  sessionDirectory: FileSystemDirectoryHandle,
  session: Session,
): Promise<TrackStream[]> {
  const tracks = await readWorkspaceJsonFile<TrackStream[]>(
    sessionDirectory,
    'tracks.json',
  );
  if (tracks && tracks.length > 0) return tracks;

  const legacyPoints =
    (await readWorkspaceJsonFile<TrackPoint[]>(sessionDirectory, 'track.json')) ?? [];
  return [createTrackStream(session, legacyPoints, { id: 'primary' })];
}

export async function getLocalWorkspaceSessionShell(
  workspaceId: string,
  sessionId: string,
): Promise<LocalWorkspaceSessionShell | null> {
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

  const [tracks, telemetryDatasets] = await Promise.all([
    readLocalTrackShell(sessionDirectory, session),
    readTelemetryShell(sessionDirectory),
  ]);

  return {
    session,
    tracks,
    telemetryDatasets,
    events: events ?? [],
    marks: marks ?? [],
    bindings,
  };
}

export async function loadLocalWorkspaceTrackPointsInChunks(
  workspaceId: string,
  sessionId: string,
  trackId: string,
  onChunk: (chunk: LocalTrackPointsChunk) => void,
): Promise<TrackPoint[]> {
  const workspaceHandle = await getRequiredWorkspaceDirectoryHandle(workspaceId);
  const sessionDirectory = await getExistingSessionDirectory(workspaceHandle, sessionId);
  if (!sessionDirectory) return [];

  let tracksDirectory: FileSystemDirectoryHandle | null = null;
  try {
    tracksDirectory = await sessionDirectory.getDirectoryHandle('tracks');
  } catch (error) {
    if (!fileNotFound(error)) throw error;
  }

  if (!tracksDirectory) {
    const legacyPoints =
      (await readWorkspaceJsonFile<TrackPoint[]>(sessionDirectory, 'track.json')) ?? [];
    onChunk({
      trackId,
      points: legacyPoints,
      chunkIndex: 0,
      chunkCount: legacyPoints.length > 0 ? 1 : 0,
      totalPoints: legacyPoints.length,
    });
    return legacyPoints;
  }

  const pointsDirectory = await getTrackPointsDirectory(tracksDirectory, trackId, false);
  const manifest = pointsDirectory
    ? await readWorkspaceJsonFile<TrackPointsChunkManifest>(pointsDirectory, 'manifest.json')
    : null;

  if (pointsDirectory && manifest?.version === 1 && manifest.chunks.length > 0) {
    const allPoints: TrackPoint[] = [];
    for (const [chunkIndex, chunk] of manifest.chunks.entries()) {
      const points =
        (await readWorkspaceJsonFile<TrackPoint[]>(pointsDirectory, chunk.fileName)) ?? [];
      allPoints.push(...points);
      onChunk({
        trackId,
        points,
        chunkIndex,
        chunkCount: manifest.chunks.length,
        totalPoints: manifest.pointCount,
      });
    }
    return allPoints;
  }

  const points =
    (await readWorkspaceJsonFile<TrackPoint[]>(tracksDirectory, `${trackId}.json`)) ?? [];
  if (points.length > TRACK_POINT_CHUNK_SIZE) {
    await writeChunkedTrackPoints(tracksDirectory, trackId, points);
  }

  const chunkCount = Math.ceil(points.length / TRACK_POINT_CHUNK_SIZE);
  for (let start = 0, chunkIndex = 0; start < points.length; start += TRACK_POINT_CHUNK_SIZE, chunkIndex++) {
    onChunk({
      trackId,
      points: points.slice(start, start + TRACK_POINT_CHUNK_SIZE),
      chunkIndex,
      chunkCount,
      totalPoints: points.length,
    });
  }

  return points;
}

export async function loadLocalWorkspaceTelemetryDatasetsInChunks(
  workspaceId: string,
  sessionId: string,
  onChunk: (chunk: LocalTelemetryDatasetChunk) => void,
  options: { timeWindow?: { startMs: number; endMs: number } } = {},
): Promise<TelemetryDataset[]> {
  const workspaceHandle = await getRequiredWorkspaceDirectoryHandle(workspaceId);
  const sessionDirectory = await getExistingSessionDirectory(workspaceHandle, sessionId);
  if (!sessionDirectory) return [];

  const chunked = await readTelemetryManifest(sessionDirectory);
  if (chunked) {
    const completed = new Map<string, TelemetryDataset>();
    for (const dataset of chunked.manifest.datasets) {
      const chunks = chunked.manifest.chunksByDatasetId[dataset.id] ?? [];
      let current = stripTelemetrySamples(dataset);
      if (chunks.length === 0) {
        completed.set(dataset.id, current);
        continue;
      }

      for (const chunk of chunks) {
        if (
          options.timeWindow &&
          (chunk.endMs < options.timeWindow.startMs || chunk.startMs > options.timeWindow.endMs)
        ) {
          continue;
        }
        const chunkDataset = await readWorkspaceJsonFile<TelemetryDataset>(
          chunked.directory,
          chunk.fileName,
        );
        if (!chunkDataset) continue;
        current = appendTelemetryChunk(current, chunkDataset);
        onChunk({
          datasetId: dataset.id,
          dataset: chunkDataset,
          chunkIndex: chunk.chunkIndex,
          chunkCount: chunks.length,
        });
      }
      completed.set(dataset.id, current);
    }
    return Array.from(completed.values());
  }

  const legacy =
    (await readWorkspaceJsonFile<TelemetryDataset[]>(sessionDirectory, 'telemetry.json')) ?? [];
  if (legacy.length > 0) {
    await writeChunkedTelemetryDatasets(sessionDirectory, legacy);
    return loadLocalWorkspaceTelemetryDatasetsInChunks(
      workspaceId,
      sessionId,
      onChunk,
      options,
    );
  }
  return legacy;
}

export async function saveLocalWorkspaceTelemetryDatasets(
  workspaceId: string,
  sessionId: string,
  datasets: TelemetryDataset[],
): Promise<void> {
  const sessionDirectory = await getSessionDirectory(workspaceId, sessionId);
  await writeChunkedTelemetryDatasets(sessionDirectory, datasets);
}

export async function importLocalWorkspaceTelemetryFile(
  workspaceId: string,
  sessionId: string,
  file: File,
): Promise<ParsedTelemetryImport> {
  if (!TELEMETRY_EXTENSIONS.has(getFileExtension(file.name))) {
    throw new Error('Only CSV, TSV, and delimited text sensor telemetry files are supported.');
  }

  const parsed = await parseLocalTelemetryFile(file, { sessionId });
  const sessionDirectory = await getSessionDirectory(workspaceId, sessionId);
  const existing = await readFullTelemetryDatasets(sessionDirectory);
  const withoutSameId = existing.filter((dataset) => dataset.id !== parsed.dataset.id);
  await writeChunkedTelemetryDatasets(sessionDirectory, [
    ...withoutSameId,
    parsed.dataset,
  ]);
  return parsed;
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
  const parsedTelemetry = TELEMETRY_EXTENSIONS.has(getFileExtension(input.sourceFile.name))
    ? await parseLocalTelemetryFile(input.sourceFile, { sessionId: input.session.id }).catch(() => null)
    : null;
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
  await writeChunkedTrackPoints(tracksDirectory, primaryTrack.id, trackPoints);
  if (parsedTelemetry && parsedTelemetry.dataset.channels.length > 0) {
    await writeChunkedTelemetryDatasets(sessionDirectory, [parsedTelemetry.dataset]);
  }
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

export interface LocalSessionDeletePreview {
  exists: boolean;
  exclusiveCopiedTrackPath: string | null;
}

export interface DeleteLocalWorkspaceSessionResult {
  warning: string | null;
}

function normalizeWorkspaceRelativePath(bindingPath: string): string {
  return bindingPath.replace(/^(?:\.\.\/)+/, '').replace(/^\.?\//, '');
}

function getCopiedIncomingTrackPath(
  bindings: WorkspaceSessionBindingsManifest | null,
): string | null {
  const track = bindings?.track;
  if (!track?.copiedToWorkspace || track.storageMode !== 'workspace_copy') return null;
  const segments = normalizeWorkspaceRelativePath(track.path).split('/').filter(Boolean);
  if (segments.length !== 3 || segments[0] !== 'incoming' || segments[1] !== 'track') {
    return null;
  }
  return segments.join('/');
}

async function isTrackPathReferencedByOtherSession(
  workspaceHandle: FileSystemDirectoryHandle,
  manifest: Awaited<ReturnType<typeof loadWorkspaceManifest>>,
  sessionId: string,
  relativePath: string,
): Promise<boolean> {
  if (!manifest) return false;
  for (const otherId of manifest.sessionsIndex) {
    if (otherId === sessionId) continue;
    const sessionDirectory = await getExistingSessionDirectory(workspaceHandle, otherId);
    if (!sessionDirectory) continue;
    const bindings = await readWorkspaceJsonFile<WorkspaceSessionBindingsManifest>(
      sessionDirectory,
      'bindings.json',
    );
    const otherPath = bindings?.track?.path
      ? normalizeWorkspaceRelativePath(bindings.track.path)
      : null;
    if (otherPath === relativePath) return true;
  }
  return false;
}

async function removeWorkspaceRelativeFile(
  workspaceHandle: FileSystemDirectoryHandle,
  relativePath: string,
): Promise<void> {
  const segments = relativePath.split('/').filter(Boolean);
  if (segments.length !== 3 || segments[0] !== 'incoming' || segments[1] !== 'track') {
    throw new Error('Refusing to delete a track file outside incoming/track.');
  }
  let directoryHandle = workspaceHandle;
  for (const segment of segments.slice(0, -1)) {
    directoryHandle = await directoryHandle.getDirectoryHandle(segment);
  }
  await directoryHandle.removeEntry(segments[segments.length - 1]!);
}

export async function getLocalSessionDeletePreview(
  workspaceId: string,
  sessionId: string,
): Promise<LocalSessionDeletePreview> {
  const workspaceHandle = await getRequiredWorkspaceDirectoryHandle(workspaceId);
  const sessionDirectory = await getExistingSessionDirectory(workspaceHandle, sessionId);
  if (!sessionDirectory) {
    return { exists: false, exclusiveCopiedTrackPath: null };
  }

  const bindings = await readWorkspaceJsonFile<WorkspaceSessionBindingsManifest>(
    sessionDirectory,
    'bindings.json',
  );
  const copiedPath = getCopiedIncomingTrackPath(bindings);
  if (!copiedPath) {
    return { exists: true, exclusiveCopiedTrackPath: null };
  }

  const manifest = await loadWorkspaceManifest(workspaceHandle);
  const shared = await isTrackPathReferencedByOtherSession(
    workspaceHandle,
    manifest,
    sessionId,
    copiedPath,
  );
  return {
    exists: true,
    exclusiveCopiedTrackPath: shared ? null : copiedPath,
  };
}

export async function deleteLocalWorkspaceSession(
  workspaceId: string,
  sessionId: string,
  options?: { deleteCopiedTrackSource?: boolean },
): Promise<DeleteLocalWorkspaceSessionResult> {
  const workspaceHandle = await getRequiredWorkspaceDirectoryHandle(workspaceId);
  const manifest = await loadWorkspaceManifest(workspaceHandle);
  if (!manifest) {
    throw new Error('workspace.json was not found in the current workspace.');
  }

  let copiedPath: string | null = null;
  if (options?.deleteCopiedTrackSource) {
    const preview = await getLocalSessionDeletePreview(workspaceId, sessionId);
    copiedPath = preview.exclusiveCopiedTrackPath;
  }

  try {
    const sessionsDirectory = await workspaceHandle.getDirectoryHandle('sessions');
    await sessionsDirectory.removeEntry(sessionId, { recursive: true });
  } catch (error) {
    if (!fileNotFound(error)) throw error;
  }

  const now = new Date().toISOString();
  manifest.sessionsIndex = manifest.sessionsIndex.filter((id) => id !== sessionId);
  manifest.updatedAt = now;
  await saveWorkspaceManifest(workspaceHandle, manifest);

  let warning: string | null = null;
  if (options?.deleteCopiedTrackSource) {
    if (!copiedPath) {
      warning =
        'Session deleted. The copied track file was kept because it is missing or still used by another session.';
    } else {
      const stillShared = await isTrackPathReferencedByOtherSession(
        workspaceHandle,
        manifest,
        sessionId,
        copiedPath,
      );
      if (stillShared) {
        warning =
          'Session deleted. The copied track file was kept because another session still uses it.';
      } else {
        try {
          await removeWorkspaceRelativeFile(workspaceHandle, copiedPath);
        } catch (error) {
          if (!fileNotFound(error)) {
            warning =
              error instanceof Error
                ? `Session deleted, but the copied track file could not be removed: ${error.message}`
                : 'Session deleted, but the copied track file could not be removed.';
          }
        }
      }
    }
  }

  try {
    await scanStoredWorkspace(workspaceId);
  } catch (error) {
    warning =
      warning ??
      (error instanceof Error
        ? `Session deleted, but the workspace scan failed: ${error.message}`
        : 'Session deleted, but the workspace scan failed.');
  }

  return { warning };
}

export type { ParsedImportTrack, ParseResult };
