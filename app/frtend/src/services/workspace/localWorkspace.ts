import type {
  LocalWorkspaceSummary,
  WorkspaceDiscoverySummary,
  WorkspaceManifest,
  WorkspacePermissionState,
  WorkspaceSessionBindingsManifest,
} from '@/types/workspace';

const REGISTRY_KEY = 'sailsiq_local_workspace_registry';
const CURRENT_WORKSPACE_KEY = 'sailsiq_current_workspace_id';
const DB_NAME = 'sailsiq-local-workspaces';
const DB_VERSION = 1;
const HANDLE_STORE = 'handles';
const WORKSPACE_VERSION = 1;
const TRACK_EXTENSIONS = new Set(['.gpx', '.ubx', '.bin']);
const VIDEO_EXTENSIONS = new Set([
  '.mp4',
  '.mov',
  '.m4v',
  '.webm',
  '.mkv',
  '.avi',
]);

interface StoredWorkspaceRecord {
  id: string;
  name: string;
  rootName: string;
  createdAt: string;
  updatedAt: string;
}

interface WorkspaceRegistryPayload {
  version: number;
  workspaces: StoredWorkspaceRecord[];
}

type FsPermissionMode = 'read' | 'readwrite';
type ImportTarget = 'track' | 'video';
type ImportMode = 'copy' | 'cut';

export interface WorkspaceImportResult {
  importedCount: number;
  target: ImportTarget;
  mode: ImportMode;
  warnings: string[];
}

export interface WorkspaceImportProgress {
  currentFileName: string;
  currentFileIndex: number;
  totalFiles: number;
  writtenBytes: number;
  totalBytes: number;
}

export interface WorkspacePickedFile {
  handle: FileSystemFileHandle;
  file: File;
  name: string;
  size: number;
  lastModified: number;
}

function canUseBrowserApis(): boolean {
  return typeof window !== 'undefined' && typeof indexedDB !== 'undefined';
}

export function supportsLocalWorkspaceDirectories(): boolean {
  return (
    canUseBrowserApis() &&
    typeof window !== 'undefined' &&
    typeof window.showDirectoryPicker === 'function'
  );
}

function getDirectoryPicker(): NonNullable<Window['showDirectoryPicker']> {
  if (!supportsLocalWorkspaceDirectories() || !window.showDirectoryPicker) {
    throw new Error('This browser does not support local workspace directories.');
  }
  return window.showDirectoryPicker;
}

function getOpenFilePicker(): NonNullable<Window['showOpenFilePicker']> {
  if (typeof window === 'undefined' || typeof window.showOpenFilePicker !== 'function') {
    throw new Error('This browser does not support importing files from the local file picker.');
  }
  return window.showOpenFilePicker;
}

function getDefaultDiscovery(): WorkspaceDiscoverySummary {
  return {
    lastScanAt: null,
    pendingTracks: 0,
    pendingVideos: 0,
    brokenRefs: 0,
  };
}

function createManifest(name: string, now: string): WorkspaceManifest {
  return {
    id:
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `ws_${Date.now()}`,
    name,
    version: WORKSPACE_VERSION,
    createdAt: now,
    updatedAt: now,
    sessionsIndex: [],
    discovery: getDefaultDiscovery(),
  };
}

function normalizeWorkspaceFolderName(name: string): string {
  return name
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/\.+$/g, '')
    .trim();
}

function getStoredRegistry(): WorkspaceRegistryPayload {
  if (typeof window === 'undefined') {
    return { version: 1, workspaces: [] };
  }

  try {
    const raw = window.localStorage.getItem(REGISTRY_KEY);
    if (!raw) return { version: 1, workspaces: [] };
    const parsed = JSON.parse(raw) as Partial<WorkspaceRegistryPayload>;
    return {
      version: 1,
      workspaces: Array.isArray(parsed.workspaces)
        ? parsed.workspaces.filter(
            (entry): entry is StoredWorkspaceRecord =>
              entry != null &&
              typeof entry.id === 'string' &&
              typeof entry.name === 'string' &&
              typeof entry.rootName === 'string' &&
              typeof entry.createdAt === 'string' &&
              typeof entry.updatedAt === 'string',
          )
        : [],
    };
  } catch {
    return { version: 1, workspaces: [] };
  }
}

function saveRegistry(workspaces: StoredWorkspaceRecord[]): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(
    REGISTRY_KEY,
    JSON.stringify({
      version: 1,
      workspaces,
    } satisfies WorkspaceRegistryPayload),
  );
}

export function getCurrentWorkspaceId(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(CURRENT_WORKSPACE_KEY);
}

export function setCurrentWorkspaceId(workspaceId: string | null): void {
  if (typeof window === 'undefined') return;
  if (workspaceId) {
    window.localStorage.setItem(CURRENT_WORKSPACE_KEY, workspaceId);
  } else {
    window.localStorage.removeItem(CURRENT_WORKSPACE_KEY);
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB.'));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(HANDLE_STORE)) {
        db.createObjectStore(HANDLE_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function idbGet<T>(key: string): Promise<T | null> {
  const db = await openDb();
  return new Promise<T | null>((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE, 'readonly');
    const store = tx.objectStore(HANDLE_STORE);
    const request = store.get(key);
    request.onerror = () => reject(request.error ?? new Error('Failed to read workspace handle.'));
    request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
  }).finally(() => db.close());
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE, 'readwrite');
    tx.onerror = () => reject(tx.error ?? new Error('Failed to store workspace handle.'));
    tx.oncomplete = () => resolve();
    tx.objectStore(HANDLE_STORE).put(value, key);
  }).finally(() => db.close());
}

async function idbDelete(key: string): Promise<void> {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE, 'readwrite');
    tx.onerror = () => reject(tx.error ?? new Error('Failed to remove workspace handle.'));
    tx.oncomplete = () => resolve();
    tx.objectStore(HANDLE_STORE).delete(key);
  }).finally(() => db.close());
}

async function getStoredHandle(
  workspaceId: string,
): Promise<FileSystemDirectoryHandle | null> {
  if (!canUseBrowserApis()) return null;
  return idbGet<FileSystemDirectoryHandle>(workspaceId);
}

async function putStoredHandle(
  workspaceId: string,
  handle: FileSystemDirectoryHandle,
): Promise<void> {
  await idbSet(workspaceId, handle);
}

async function getRequiredWorkspaceHandle(
  workspaceId: string,
): Promise<FileSystemDirectoryHandle> {
  const handle = await getStoredHandle(workspaceId);
  if (!handle) {
    throw new Error('Workspace directory handle is no longer available.');
  }

  let permissionState = await getPermissionState(handle);
  if (permissionState !== 'granted') {
    const permission = await handle.requestPermission({
      mode: 'readwrite' as FsPermissionMode,
    });
    permissionState = normalizePermissionState(permission);
  }

  if (permissionState !== 'granted') {
    throw new Error('Workspace directory access is not granted.');
  }

  return handle;
}

export async function getRequiredWorkspaceDirectoryHandle(
  workspaceId: string,
): Promise<FileSystemDirectoryHandle> {
  return getRequiredWorkspaceHandle(workspaceId);
}

function fileNotFound(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'NotFoundError';
}

export function isWorkspacePickerAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function isProtectedWorkspaceDirectoryError(error: unknown): boolean {
  if (!(error instanceof DOMException || error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes('contains system files') ||
    message.includes('无法将其打开') ||
    message.includes('system files') ||
    message.includes('unable to open') ||
    message.includes('cannot open')
  );
}

export function getWorkspacePickerErrorMessage(error: unknown): string {
  if (isProtectedWorkspaceDirectoryError(error)) {
    return '所选目录属于受保护目录，浏览器不允许网页直接访问。请选择普通父目录，例如 D:\\Workspaces 或 F:\\SailSIQData。';
  }
  return error instanceof Error ? error.message : 'Workspace directory operation failed.';
}

async function ensureDirectory(
  parent: FileSystemDirectoryHandle,
  name: string,
): Promise<FileSystemDirectoryHandle> {
  return parent.getDirectoryHandle(name, { create: true });
}

async function getDirectoryIfExists(
  parent: FileSystemDirectoryHandle,
  name: string,
): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await parent.getDirectoryHandle(name);
  } catch (error) {
    if (fileNotFound(error)) return null;
    throw error;
  }
}

async function writeJsonFile(
  directoryHandle: FileSystemDirectoryHandle,
  fileName: string,
  payload: unknown,
): Promise<void> {
  const fileHandle = await directoryHandle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(payload, null, 2));
  await writable.close();
}

async function readJsonFile<T>(
  directoryHandle: FileSystemDirectoryHandle,
  fileName: string,
): Promise<T | null> {
  try {
    const fileHandle = await directoryHandle.getFileHandle(fileName);
    const file = await fileHandle.getFile();
    return JSON.parse(await file.text()) as T;
  } catch (error) {
    if (fileNotFound(error)) return null;
    throw error;
  }
}

async function hasAnyEntries(
  directoryHandle: FileSystemDirectoryHandle,
): Promise<boolean> {
  for await (const _entry of directoryHandle.values()) {
    return true;
  }
  return false;
}

async function ensureWorkspaceStructure(
  directoryHandle: FileSystemDirectoryHandle,
): Promise<void> {
  const incoming = await ensureDirectory(directoryHandle, 'incoming');
  await ensureDirectory(incoming, 'track');
  await ensureDirectory(incoming, 'video');

  const library = await ensureDirectory(directoryHandle, 'library');
  await ensureDirectory(library, 'source');
  await ensureDirectory(library, 'video');

  await ensureDirectory(directoryHandle, 'sessions');
  await ensureDirectory(directoryHandle, 'cache');
  await ensureDirectory(directoryHandle, 'index');
}

async function loadManifest(
  directoryHandle: FileSystemDirectoryHandle,
): Promise<WorkspaceManifest | null> {
  return readJsonFile<WorkspaceManifest>(directoryHandle, 'workspace.json');
}

export async function loadWorkspaceManifest(
  directoryHandle: FileSystemDirectoryHandle,
): Promise<WorkspaceManifest | null> {
  return loadManifest(directoryHandle);
}

async function saveManifest(
  directoryHandle: FileSystemDirectoryHandle,
  manifest: WorkspaceManifest,
): Promise<void> {
  await writeJsonFile(directoryHandle, 'workspace.json', manifest);
}

export async function saveWorkspaceManifest(
  directoryHandle: FileSystemDirectoryHandle,
  manifest: WorkspaceManifest,
): Promise<void> {
  await saveManifest(directoryHandle, manifest);
}

export async function ensureWorkspaceSubdirectory(
  parent: FileSystemDirectoryHandle,
  name: string,
): Promise<FileSystemDirectoryHandle> {
  return ensureDirectory(parent, name);
}

export async function writeWorkspaceJsonFile(
  directoryHandle: FileSystemDirectoryHandle,
  fileName: string,
  payload: unknown,
): Promise<void> {
  await writeJsonFile(directoryHandle, fileName, payload);
}

export async function readWorkspaceJsonFile<T>(
  directoryHandle: FileSystemDirectoryHandle,
  fileName: string,
): Promise<T | null> {
  return readJsonFile<T>(directoryHandle, fileName);
}

function normalizePermissionState(
  state: PermissionState | 'unsupported' | 'unknown',
): WorkspacePermissionState {
  if (state === 'granted' || state === 'denied' || state === 'prompt') {
    return state;
  }
  return state;
}

async function getPermissionState(
  directoryHandle: FileSystemDirectoryHandle | null,
): Promise<WorkspacePermissionState> {
  if (!supportsLocalWorkspaceDirectories()) return 'unsupported';
  if (!directoryHandle) return 'unknown';

  try {
    const descriptor = { mode: 'readwrite' as FsPermissionMode };
    const status = await directoryHandle.queryPermission(descriptor);
    return normalizePermissionState(status);
  } catch {
    return 'unknown';
  }
}

function getFileExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : '';
}

async function getUniqueFileHandle(
  directoryHandle: FileSystemDirectoryHandle,
  fileName: string,
): Promise<FileSystemFileHandle> {
  const dotIndex = fileName.lastIndexOf('.');
  const baseName = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
  const extension = dotIndex > 0 ? fileName.slice(dotIndex) : '';

  let attempt = 0;
  while (attempt < 500) {
    const candidate =
      attempt === 0 ? fileName : `${baseName}-${String(attempt).padStart(2, '0')}${extension}`;
    try {
      await directoryHandle.getFileHandle(candidate);
      attempt += 1;
    } catch (error) {
      if (fileNotFound(error)) {
        return directoryHandle.getFileHandle(candidate, { create: true });
      }
      throw error;
    }
  }

  throw new Error(`Unable to allocate a target file name for "${fileName}".`);
}

async function copyFileToDirectory(
  sourceFile: File,
  targetDirectory: FileSystemDirectoryHandle,
  onChunkWritten?: (bytes: number) => void,
): Promise<string> {
  const targetHandle = await getUniqueFileHandle(targetDirectory, sourceFile.name);
  const writable = await targetHandle.createWritable();
  try {
    if (typeof sourceFile.stream === 'function') {
      const reader = sourceFile.stream().getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        await writable.write(value);
        onChunkWritten?.(value.byteLength);
      }
      await writable.close();
      return targetHandle.name;
    }

    await writable.write(sourceFile);
    onChunkWritten?.(sourceFile.size);
    await writable.close();
    return targetHandle.name;
  } catch (error) {
    try {
      await writable.abort();
    } catch {
      // Ignore abort failures and preserve the original error.
    }
    throw error;
  }
}

export async function copyWorkspaceFileIntoDirectory(
  targetDirectoryHandle: FileSystemDirectoryHandle,
  sourceFile: File,
): Promise<string> {
  return copyFileToDirectory(sourceFile, targetDirectoryHandle);
}

function getImportPickerTypes(target: ImportTarget) {
  if (target === 'track') {
    return [
      {
        description: 'Track files',
        accept: {
          'application/gpx+xml': ['.gpx'],
          'application/octet-stream': ['.ubx', '.bin'],
        },
      },
    ];
  }

  return [
    {
      description: 'Video files',
      accept: {
        'video/*': ['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi'],
      },
    },
  ];
}

async function countFilesByExtension(
  directoryHandle: FileSystemDirectoryHandle,
  extensions: Set<string>,
  excludedNames?: Set<string>,
): Promise<number> {
  let count = 0;
  for await (const entry of directoryHandle.values()) {
    if (
      entry.kind === 'file' &&
      extensions.has(getFileExtension(entry.name)) &&
      !excludedNames?.has(entry.name)
    ) {
      count += 1;
    }
  }
  return count;
}

async function collectBoundIncomingTrackNames(
  directoryHandle: FileSystemDirectoryHandle,
  manifest: WorkspaceManifest,
): Promise<Set<string>> {
  const boundNames = new Set<string>();
  const sessionsDirectory = await getDirectoryIfExists(directoryHandle, 'sessions');
  if (!sessionsDirectory) return boundNames;

  for (const sessionId of manifest.sessionsIndex) {
    const sessionDirectory = await getDirectoryIfExists(sessionsDirectory, sessionId);
    if (!sessionDirectory) continue;

    try {
      const bindings = await readJsonFile<WorkspaceSessionBindingsManifest>(
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
      // Discovery is rebuildable cache; skip broken binding files during scan.
    }
  }

  return boundNames;
}

async function scanWorkspaceDiscovery(
  directoryHandle: FileSystemDirectoryHandle,
  manifest: WorkspaceManifest,
): Promise<WorkspaceManifest> {
  const incoming = await ensureDirectory(directoryHandle, 'incoming');
  const trackDirectory = await ensureDirectory(incoming, 'track');
  const videoDirectory = await ensureDirectory(incoming, 'video');
  const library = await ensureDirectory(directoryHandle, 'library');
  const libraryVideoDirectory = await ensureDirectory(library, 'video');
  const boundIncomingTrackNames = await collectBoundIncomingTrackNames(
    directoryHandle,
    manifest,
  );

  const pendingTracks = await countFilesByExtension(
    trackDirectory,
    TRACK_EXTENSIONS,
    boundIncomingTrackNames,
  );
  const incomingVideos = await countFilesByExtension(videoDirectory, VIDEO_EXTENSIONS);
  const libraryVideos = await countFilesByExtension(libraryVideoDirectory, VIDEO_EXTENSIONS);
  const lastScanAt = new Date().toISOString();

  return {
    ...manifest,
    updatedAt: lastScanAt,
    discovery: {
      lastScanAt,
      pendingTracks,
      pendingVideos: incomingVideos + libraryVideos,
      brokenRefs: manifest.discovery?.brokenRefs ?? 0,
    },
  };
}

function toWorkspaceSummary(
  record: StoredWorkspaceRecord,
  options: {
    currentWorkspaceId: string | null;
    permissionState: WorkspacePermissionState;
    manifest: WorkspaceManifest | null;
  },
): LocalWorkspaceSummary {
  return {
    id: record.id,
    name: options.manifest?.name ?? record.name,
    rootName: record.rootName,
    createdAt: options.manifest?.createdAt ?? record.createdAt,
    updatedAt: options.manifest?.updatedAt ?? record.updatedAt,
    discovery: options.manifest?.discovery ?? getDefaultDiscovery(),
    permissionState: options.permissionState,
    isCurrent: options.currentWorkspaceId === record.id,
    hasManifest: options.manifest != null,
  };
}

async function upsertWorkspaceRecord(
  record: StoredWorkspaceRecord,
): Promise<void> {
  const registry = getStoredRegistry();
  const workspaces = registry.workspaces.filter((item) => item.id !== record.id);
  workspaces.unshift(record);
  saveRegistry(workspaces);
}

export async function listLocalWorkspaces(): Promise<LocalWorkspaceSummary[]> {
  const registry = getStoredRegistry();
  const currentWorkspaceId = getCurrentWorkspaceId();

  const workspaces = await Promise.all(
    registry.workspaces.map(async (record) => {
      const handle = await getStoredHandle(record.id);
      const permissionState = await getPermissionState(handle);
      const manifest =
        permissionState === 'granted' && handle ? await loadManifest(handle) : null;
      return toWorkspaceSummary(record, {
        currentWorkspaceId,
        permissionState,
        manifest,
      });
    }),
  );

  return workspaces.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

export async function createLocalWorkspace(
  name: string,
): Promise<LocalWorkspaceSummary> {
  if (!supportsLocalWorkspaceDirectories()) {
    throw new Error('This browser does not support local workspace directories.');
  }

  const normalizedName = normalizeWorkspaceFolderName(name);
  if (!normalizedName) {
    throw new Error('Workspace name is required.');
  }

  const parentDirectoryHandle = await getDirectoryPicker()({ mode: 'readwrite' });
  const existingDirectoryHandle = await getDirectoryIfExists(
    parentDirectoryHandle,
    normalizedName,
  );

  if (existingDirectoryHandle) {
    const existingManifest = await loadManifest(existingDirectoryHandle);
    if (existingManifest) {
      throw new Error(
        `A workspace folder named "${normalizedName}" already exists in the selected location.`,
      );
    }
    if (await hasAnyEntries(existingDirectoryHandle)) {
      throw new Error(
        `A non-workspace folder named "${normalizedName}" already exists in the selected location.`,
      );
    }
  }

  const directoryHandle = await ensureDirectory(parentDirectoryHandle, normalizedName);
  const now = new Date().toISOString();
  const manifest = createManifest(name.trim() || normalizedName, now);

  await ensureWorkspaceStructure(directoryHandle);
  const scannedManifest = await scanWorkspaceDiscovery(directoryHandle, manifest);
  await saveManifest(directoryHandle, scannedManifest);
  await putStoredHandle(scannedManifest.id, directoryHandle);

  await upsertWorkspaceRecord({
    id: scannedManifest.id,
    name: scannedManifest.name,
    rootName: directoryHandle.name,
    createdAt: scannedManifest.createdAt,
    updatedAt: scannedManifest.updatedAt,
  });
  setCurrentWorkspaceId(scannedManifest.id);

  return {
    id: scannedManifest.id,
    name: scannedManifest.name,
    rootName: directoryHandle.name,
    createdAt: scannedManifest.createdAt,
    updatedAt: scannedManifest.updatedAt,
    discovery: scannedManifest.discovery,
    permissionState: 'granted',
    isCurrent: true,
    hasManifest: true,
  };
}

export async function registerExistingWorkspace(): Promise<LocalWorkspaceSummary> {
  if (!supportsLocalWorkspaceDirectories()) {
    throw new Error('This browser does not support local workspace directories.');
  }

  const directoryHandle = await getDirectoryPicker()({ mode: 'readwrite' });
  const permissionState = await getPermissionState(directoryHandle);
  if (permissionState === 'denied') {
    throw new Error('Directory permission was denied.');
  }

  const manifest = await loadManifest(directoryHandle);
  if (!manifest) {
    throw new Error('The selected directory is not a SailSIQ workspace yet.');
  }

  const scannedManifest = await scanWorkspaceDiscovery(directoryHandle, manifest);
  await saveManifest(directoryHandle, scannedManifest);
  await putStoredHandle(scannedManifest.id, directoryHandle);
  await upsertWorkspaceRecord({
    id: scannedManifest.id,
    name: scannedManifest.name,
    rootName: directoryHandle.name,
    createdAt: scannedManifest.createdAt,
    updatedAt: scannedManifest.updatedAt,
  });
  setCurrentWorkspaceId(scannedManifest.id);

  return {
    id: scannedManifest.id,
    name: scannedManifest.name,
    rootName: directoryHandle.name,
    createdAt: scannedManifest.createdAt,
    updatedAt: scannedManifest.updatedAt,
    discovery: scannedManifest.discovery,
    permissionState: 'granted',
    isCurrent: true,
    hasManifest: true,
  };
}

export async function requestWorkspaceAccess(
  workspaceId: string,
): Promise<LocalWorkspaceSummary> {
  const registry = getStoredRegistry();
  const record = registry.workspaces.find((item) => item.id === workspaceId);
  if (!record) {
    throw new Error('Workspace record was not found.');
  }

  const handle = await getStoredHandle(workspaceId);
  if (!handle) {
    throw new Error('Workspace directory handle is no longer available.');
  }

  const permission = await handle.requestPermission({
    mode: 'readwrite' as FsPermissionMode,
  });
  if (permission !== 'granted') {
    throw new Error('Workspace permission was not granted.');
  }

  const manifest = await loadManifest(handle);
  return toWorkspaceSummary(record, {
    currentWorkspaceId: getCurrentWorkspaceId(),
    permissionState: 'granted',
    manifest,
  });
}

export async function useStoredWorkspace(
  workspaceId: string,
): Promise<LocalWorkspaceSummary> {
  const registry = getStoredRegistry();
  const record = registry.workspaces.find((item) => item.id === workspaceId);
  if (!record) {
    throw new Error('Workspace record was not found.');
  }

  const handle = await getStoredHandle(workspaceId);
  if (!handle) {
    throw new Error('Workspace directory handle is no longer available.');
  }

  let permissionState = await getPermissionState(handle);
  if (permissionState !== 'granted') {
    const permission = await handle.requestPermission({
      mode: 'readwrite' as FsPermissionMode,
    });
    permissionState = normalizePermissionState(permission);
  }

  if (permissionState !== 'granted') {
    throw new Error('Workspace directory access is not granted.');
  }

  setCurrentWorkspaceId(workspaceId);
  const manifest = await loadManifest(handle);
  return toWorkspaceSummary(record, {
    currentWorkspaceId: workspaceId,
    permissionState,
    manifest,
  });
}

export async function scanStoredWorkspace(
  workspaceId: string,
): Promise<LocalWorkspaceSummary> {
  const registry = getStoredRegistry();
  const record = registry.workspaces.find((item) => item.id === workspaceId);
  if (!record) {
    throw new Error('Workspace record was not found.');
  }

  const handle = await getStoredHandle(workspaceId);
  if (!handle) {
    throw new Error('Workspace directory handle is no longer available.');
  }

  const permissionState = await getPermissionState(handle);
  if (permissionState !== 'granted') {
    throw new Error('Workspace directory access is not granted.');
  }

  const manifest = await loadManifest(handle);
  if (!manifest) {
    throw new Error('workspace.json was not found in the selected directory.');
  }

  const scannedManifest = await scanWorkspaceDiscovery(handle, manifest);
  await saveManifest(handle, scannedManifest);
  await upsertWorkspaceRecord({
    id: scannedManifest.id,
    name: scannedManifest.name,
    rootName: record.rootName,
    createdAt: scannedManifest.createdAt,
    updatedAt: scannedManifest.updatedAt,
  });

  return toWorkspaceSummary(
    {
      ...record,
      name: scannedManifest.name,
      updatedAt: scannedManifest.updatedAt,
    },
    {
      currentWorkspaceId: getCurrentWorkspaceId(),
      permissionState: 'granted',
      manifest: scannedManifest,
    },
  );
}

export async function importFilesIntoWorkspace(
  target: ImportTarget,
): Promise<WorkspacePickedFile[]> {
  const picker = getOpenFilePicker();
  const sourceHandles = await picker({
    multiple: true,
    excludeAcceptAllOption: false,
    types: getImportPickerTypes(target),
  });

  return Promise.all(
    sourceHandles.map(async (handle) => {
      const file = await handle.getFile();
      return {
        handle,
        file,
        name: file.name,
        size: file.size,
        lastModified: file.lastModified,
      } satisfies WorkspacePickedFile;
    }),
  );
}

export async function importPickedFilesIntoWorkspace(
  workspaceId: string,
  target: ImportTarget,
  mode: ImportMode,
  pickedFiles: WorkspacePickedFile[],
  onProgress?: (progress: WorkspaceImportProgress) => void,
): Promise<WorkspaceImportResult> {
  const workspaceHandle = await getRequiredWorkspaceHandle(workspaceId);

  if (pickedFiles.length === 0) {
    return {
      importedCount: 0,
      target,
      mode,
      warnings: [],
    };
  }

  const incomingDirectory = await ensureDirectory(workspaceHandle, 'incoming');
  const targetDirectory = await ensureDirectory(incomingDirectory, target);
  const warnings: string[] = [];
  const totalBytes = pickedFiles.reduce((sum, file) => sum + file.size, 0);
  let writtenBytes = 0;

  for (const [index, sourceFile] of pickedFiles.entries()) {
    onProgress?.({
      currentFileName: sourceFile.name,
      currentFileIndex: index + 1,
      totalFiles: pickedFiles.length,
      writtenBytes,
      totalBytes,
    });

    await copyFileToDirectory(sourceFile.file, targetDirectory, (chunkBytes) => {
      writtenBytes += chunkBytes;
      onProgress?.({
        currentFileName: sourceFile.name,
        currentFileIndex: index + 1,
        totalFiles: pickedFiles.length,
        writtenBytes,
        totalBytes,
      });
    });

    if (mode === 'cut') {
      if (typeof sourceFile.handle.remove === 'function') {
        try {
          await sourceFile.handle.remove();
        } catch {
          warnings.push(`Imported "${sourceFile.name}" but could not remove the original file.`);
        }
      } else {
        warnings.push(
          `Imported "${sourceFile.name}" by copy because this browser does not support deleting the source file from the picker.`,
        );
      }
    }
  }

  const manifest = await loadManifest(workspaceHandle);
  if (manifest) {
    const scannedManifest = await scanWorkspaceDiscovery(workspaceHandle, manifest);
    await saveManifest(workspaceHandle, scannedManifest);
    await upsertWorkspaceRecord({
      id: scannedManifest.id,
      name: scannedManifest.name,
      rootName: workspaceHandle.name,
      createdAt: scannedManifest.createdAt,
      updatedAt: scannedManifest.updatedAt,
    });
  }

  return {
    importedCount: pickedFiles.length,
    target,
    mode,
    warnings,
  };
}

export async function removeStoredWorkspace(workspaceId: string): Promise<void> {
  const registry = getStoredRegistry();
  const nextWorkspaces = registry.workspaces.filter((item) => item.id !== workspaceId);
  saveRegistry(nextWorkspaces);
  await idbDelete(workspaceId);
  if (getCurrentWorkspaceId() === workspaceId) {
    setCurrentWorkspaceId(nextWorkspaces[0]?.id ?? null);
  }
}
