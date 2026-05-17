import { useEffect, useState } from 'react';
import {
  ArrowRightLeft,
  Check,
  Cpu,
  FolderCog,
  FolderOpen,
  Gauge,
  HardDrive,
  Info,
  RefreshCw,
  Save,
  Shield,
  Star,
  Trash2,
  User,
  X,
} from 'lucide-react';
import { useWorkspaceContext } from '@/context/WorkspaceContext';
import { useTheme } from '@/theme/ThemeContext';
import Panel from '@/components/Panel';
import { settingsApi } from '@/services/api';
import {
  createLocalWorkspace,
  getWorkspacePickerErrorMessage,
  importFilesIntoWorkspace,
  importPickedFilesIntoWorkspace,
  isWorkspacePickerAbort,
  registerExistingWorkspace,
  removeStoredWorkspace,
  supportsLocalWorkspaceDirectories,
} from '@/services/workspace/localWorkspace';
import type { UserSettings } from '@/types/models';
import type { LocalWorkspaceSummary } from '@/types/workspace';
import type {
  WorkspaceImportProgress,
  WorkspacePickedFile,
} from '@/services/workspace/localWorkspace';

type WorkspaceAction =
  | 'idle'
  | 'creating'
  | 'opening'
  | 'using'
  | 'scanning'
  | 'authorizing'
  | 'removing'
  | 'opening_folder'
  | 'importing';

type ImportTarget = 'track' | 'video';
type ImportMode = 'copy' | 'cut';

const WORKSPACE_INIT_ENTRIES = [
  'workspace.json',
  'incoming/track/',
  'incoming/video/',
  'library/',
  'sessions/',
  'cache/',
  'index/',
] as const;

const WORKSPACE_PARENT_EXAMPLES = ['D:\\Workspaces', 'F:\\SailSIQData'] as const;

function formatDateTime(value: string | null): string {
  if (!value) return 'Never';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function getPermissionLabel(permission: LocalWorkspaceSummary['permissionState']): string {
  switch (permission) {
    case 'granted':
      return 'Read / write ready';
    case 'prompt':
      return 'Needs permission';
    case 'denied':
      return 'Access denied';
    case 'unsupported':
      return 'Browser unsupported';
    default:
      return 'Handle unavailable';
  }
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** unitIndex;
  return `${value.toFixed(unitIndex === 0 ? 0 : value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

export default function SettingsPage() {
  const { s, themeId, allThemes, setTheme } = useTheme();
  const {
    workspaces,
    currentWorkspace,
    reloadWorkspaces,
    useWorkspace,
    authorizeWorkspace,
    scanWorkspace,
  } = useWorkspaceContext();
  const [settings, setSettings] = useState<UserSettings>(settingsApi.get());
  const [saved, setSaved] = useState(false);
  const [workspaceName, setWorkspaceName] = useState('SailSIQWorkspace');
  const [workspaceBusy, setWorkspaceBusy] = useState<WorkspaceAction>('idle');
  const [workspaceMessage, setWorkspaceMessage] = useState<string | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importTarget, setImportTarget] = useState<ImportTarget>('track');
  const [importMode, setImportMode] = useState<ImportMode>('copy');
  const [pickedFiles, setPickedFiles] = useState<WorkspacePickedFile[]>([]);
  const [importProgress, setImportProgress] = useState<WorkspaceImportProgress | null>(null);

  const isRound =
    themeId === 'nordic' || themeId === 'frost' || themeId === 'neumorph';
  const localDirectorySupported = supportsLocalWorkspaceDirectories();
  const codeChip = `rounded px-1 py-0.5 font-mono text-[0.85em] ${s.accentBg}`;

  const update = <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  useEffect(() => {
    void reloadWorkspaces().catch((error) => {
      setWorkspaceError(
        error instanceof Error ? error.message : 'Failed to load workspaces.',
      );
    });
  }, [reloadWorkspaces]);

  const handleSave = () => {
    settingsApi.save(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleCreateWorkspace = async () => {
    setWorkspaceBusy('creating');
    setWorkspaceError(null);
    setWorkspaceMessage(null);
    try {
      const created = await createLocalWorkspace(workspaceName);
      await reloadWorkspaces();
      setWorkspaceMessage(`Workspace "${created.name}" is ready.`);
    } catch (error) {
      if (isWorkspacePickerAbort(error)) {
        setWorkspaceMessage(null);
        setWorkspaceError(null);
        return;
      }
      setWorkspaceError(getWorkspacePickerErrorMessage(error));
    } finally {
      setWorkspaceBusy('idle');
    }
  };

  const handleOpenWorkspace = async () => {
    setWorkspaceBusy('opening');
    setWorkspaceError(null);
    setWorkspaceMessage(null);
    try {
      const opened = await registerExistingWorkspace();
      await reloadWorkspaces();
      setWorkspaceMessage(`Using workspace "${opened.name}".`);
    } catch (error) {
      if (isWorkspacePickerAbort(error)) {
        setWorkspaceMessage(null);
        setWorkspaceError(null);
        return;
      }
      setWorkspaceError(getWorkspacePickerErrorMessage(error));
    } finally {
      setWorkspaceBusy('idle');
    }
  };

  const handleUseWorkspace = async (workspaceId: string) => {
    setWorkspaceBusy('using');
    setWorkspaceError(null);
    setWorkspaceMessage(null);
    try {
      const selected = await useWorkspace(workspaceId);
      setWorkspaceMessage(`Using workspace "${selected.name}".`);
    } catch (error) {
      setWorkspaceError(
        error instanceof Error ? error.message : 'Failed to use workspace.',
      );
    } finally {
      setWorkspaceBusy('idle');
    }
  };

  const handleAuthorizeWorkspace = async (workspaceId: string) => {
    setWorkspaceBusy('authorizing');
    setWorkspaceError(null);
    setWorkspaceMessage(null);
    try {
      const authorized = await authorizeWorkspace(workspaceId);
      setWorkspaceMessage(`Access restored for "${authorized.name}".`);
    } catch (error) {
      setWorkspaceError(
        error instanceof Error ? error.message : 'Failed to restore workspace access.',
      );
    } finally {
      setWorkspaceBusy('idle');
    }
  };

  const handleScanWorkspace = async (workspaceId: string) => {
    setWorkspaceBusy('scanning');
    setWorkspaceError(null);
    setWorkspaceMessage(null);
    try {
      const scanned = await scanWorkspace(workspaceId);
      setWorkspaceMessage(`Scanned "${scanned.name}".`);
    } catch (error) {
      setWorkspaceError(
        error instanceof Error ? error.message : 'Failed to scan workspace.',
      );
    } finally {
      setWorkspaceBusy('idle');
    }
  };

  const handleRemoveWorkspace = async (workspaceId: string) => {
    setWorkspaceBusy('removing');
    setWorkspaceError(null);
    setWorkspaceMessage(null);
    try {
      await removeStoredWorkspace(workspaceId);
      await reloadWorkspaces();
      setWorkspaceMessage('Workspace record removed from this browser.');
    } catch (error) {
      setWorkspaceError(
        error instanceof Error ? error.message : 'Failed to remove workspace.',
      );
    } finally {
      setWorkspaceBusy('idle');
    }
  };

  const handleOpenWorkspaceFolder = async (workspaceId: string) => {
    setWorkspaceBusy('opening_folder');
    setWorkspaceError(null);
    setWorkspaceMessage(null);
    try {
      const selected = await useWorkspace(workspaceId);
      setWorkspaceMessage(
        `Workspace folder "${selected.rootName}" is active in this browser. The browser cannot launch Windows Explorer directly, but the directory access is ready.`,
      );
    } catch (error) {
      setWorkspaceError(
        error instanceof Error ? error.message : 'Failed to open workspace folder.',
      );
    } finally {
      setWorkspaceBusy('idle');
    }
  };

  const handlePickImportFiles = async () => {
    setWorkspaceBusy('importing');
    setWorkspaceError(null);
    setWorkspaceMessage(null);
    try {
      const nextFiles = await importFilesIntoWorkspace(importTarget);
      setPickedFiles(nextFiles);
      setImportProgress(null);
    } catch (error) {
      if (isWorkspacePickerAbort(error)) {
        setWorkspaceMessage(null);
        setWorkspaceError(null);
        return;
      }
      setWorkspaceError(
        error instanceof Error ? error.message : 'Failed to import data into workspace.',
      );
    } finally {
      setWorkspaceBusy('idle');
    }
  };

  const handleImportData = async () => {
    if (!currentWorkspace) return;
    setWorkspaceBusy('importing');
    setWorkspaceError(null);
    setWorkspaceMessage(null);
    setImportProgress({
      currentFileName: pickedFiles[0]?.name ?? '',
      currentFileIndex: pickedFiles.length > 0 ? 1 : 0,
      totalFiles: pickedFiles.length,
      writtenBytes: 0,
      totalBytes: pickedFiles.reduce((sum, file) => sum + file.size, 0),
    });
    try {
      const result = await importPickedFilesIntoWorkspace(
        currentWorkspace.id,
        importTarget,
        importMode,
        pickedFiles,
        (progress) => {
          setImportProgress(progress);
        },
      );
      await reloadWorkspaces();
      setImportDialogOpen(false);
      setPickedFiles([]);
      setImportProgress(null);
      if (result.importedCount === 0) {
        setWorkspaceMessage('Import canceled.');
      } else {
        const warningText =
          result.warnings.length > 0 ? ` ${result.warnings.join(' ')}` : '';
        setWorkspaceMessage(
          `Imported ${result.importedCount} ${result.target} file(s) into incoming/${result.target}.${warningText}`,
        );
      }
    } catch (error) {
      if (isWorkspacePickerAbort(error)) {
        setWorkspaceMessage(null);
        setWorkspaceError(null);
        return;
      }
      setWorkspaceError(
        error instanceof Error ? error.message : 'Failed to import data into workspace.',
      );
    } finally {
      setWorkspaceBusy('idle');
    }
  };

  const importPercent =
    importProgress && importProgress.totalBytes > 0
      ? Math.min(100, Math.round((importProgress.writtenBytes / importProgress.totalBytes) * 100))
      : 0;

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-6">
      <h2 className={`text-xl font-bold ${s.textPrimary}`}>Settings</h2>

      <Panel>
        <div className="flex items-center gap-2 mb-4">
          <FolderCog className={`w-5 h-5 ${s.accent}`} />
          <h3 className={`font-bold ${s.textPrimary}`}>Workspace Setup</h3>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3">
              <div>
                <p className={`text-sm font-semibold tracking-tight ${s.textPrimary}`}>
                  Local directory mode
                </p>
                <p className={`mt-2 text-sm leading-relaxed ${s.textSecondary}`}>
                  Create or use a browser-bound SailSIQ workspace directory.
                </p>
              </div>
              <div className={`flex gap-3 ${s.panel} rounded-xl p-4 shadow-sm`} role="note">
                <Info className={`mt-0.5 h-5 w-5 shrink-0 ${s.accent}`} aria-hidden />
                <p className={`min-w-0 text-sm leading-relaxed ${s.textSecondary}`}>
                  When creating a workspace, SailSIQ first asks you to choose a parent folder,
                  then creates a new subfolder using the workspace name and initializes{' '}
                  {WORKSPACE_INIT_ENTRIES.map((name, i) => (
                    <span key={name}>
                      {i === 0 ? null : i === WORKSPACE_INIT_ENTRIES.length - 1 ? ' and ' : ', '}
                      <code className={codeChip}>{name}</code>
                    </span>
                  ))}
                  .
                </p>
              </div>
              <p className={`text-xs leading-relaxed sm:text-sm ${s.textSecondary}`}>
                Please choose a normal parent directory. Avoid system folders,
                protected folders, or locations that contain system files.
                Recommended examples:{' '}
                {WORKSPACE_PARENT_EXAMPLES.map((path, i) => (
                  <span key={path}>
                    {i > 0 ? ', ' : null}
                    <code className={codeChip}>{path}</code>
                  </span>
                ))}
                .
              </p>
            </div>

            <div className={`rounded-2xl border ${s.divider} p-4 flex flex-col gap-3`}>
              <label className={`text-sm ${s.textSecondary}`}>New workspace name</label>
              <input
                type="text"
                value={workspaceName}
                onChange={(event) => setWorkspaceName(event.target.value)}
                placeholder="e.g. SailSIQWorkspace"
                className={`w-full px-3 py-2 text-sm ${s.input} outline-none`}
              />
              <div className="flex w-full flex-nowrap gap-2 sm:gap-3">
                <button
                  type="button"
                  onClick={handleCreateWorkspace}
                  disabled={!localDirectorySupported || workspaceBusy !== 'idle'}
                  className={`flex min-w-0 flex-1 basis-0 items-center justify-center gap-2 px-3 py-2 text-sm sm:px-4 ${s.buttonPrimary} ${
                    !localDirectorySupported || workspaceBusy !== 'idle'
                      ? 'opacity-50 cursor-not-allowed'
                      : ''
                  }`}
                >
                  <HardDrive className="w-4 h-4" />
                  {workspaceBusy === 'creating' ? 'Creating...' : 'Create Workspace'}
                </button>
                <button
                  type="button"
                  onClick={handleOpenWorkspace}
                  disabled={!localDirectorySupported || workspaceBusy !== 'idle'}
                  className={`flex min-w-0 flex-1 basis-0 items-center justify-center gap-2 px-3 py-2 text-sm sm:px-4 ${s.buttonSecondary} ${
                    !localDirectorySupported || workspaceBusy !== 'idle'
                      ? 'opacity-50 cursor-not-allowed'
                      : ''
                  }`}
                >
                  <FolderOpen className="w-4 h-4" />
                  {workspaceBusy === 'opening' ? 'Using...' : 'Use Existing Workspace'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setImportDialogOpen(true);
                    setWorkspaceError(null);
                    setWorkspaceMessage(null);
                    setImportProgress(null);
                  }}
                  disabled={!currentWorkspace || workspaceBusy !== 'idle'}
                  className={`flex items-center gap-2 px-4 py-2 text-sm ${s.buttonSecondary} ${
                    !currentWorkspace || workspaceBusy !== 'idle'
                      ? 'opacity-50 cursor-not-allowed'
                      : ''
                  }`}
                >
                  <ArrowRightLeft className="w-4 h-4" />
                  Import Data
                </button>
              </div>
            </div>

            {workspaceMessage ? (
              <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
                {workspaceMessage}
              </div>
            ) : null}

            {workspaceError ? (
              <div className="rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {workspaceError}
              </div>
            ) : null}
          </div>

          <div className={`rounded-2xl border ${s.divider} p-4 flex flex-col gap-4`}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className={`text-xs uppercase tracking-[0.18em] ${s.textSecondary}`}>
                  Capability
                </p>
                <p className={`text-base font-semibold ${s.textPrimary}`}>
                  {localDirectorySupported ? 'Directory access available' : 'Fallback mode only'}
                </p>
              </div>
              <div className={`px-3 py-1 text-xs ${s.accentBg}`}>
                {localDirectorySupported ? 'File System Access API' : 'Unsupported'}
              </div>
            </div>

            <div className={`border-t ${s.divider}`} />

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-sm">
                <span className={s.textSecondary}>Current workspace</span>
                <span className={s.textPrimary}>{currentWorkspace?.name ?? 'None'}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className={s.textSecondary}>Permission</span>
                <span className={s.textPrimary}>
                  {currentWorkspace ? getPermissionLabel(currentWorkspace.permissionState) : '--'}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className={s.textSecondary}>Remembered workspaces</span>
                <span className={s.textPrimary}>{workspaces.length}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className={s.textSecondary}>Data drop zones</span>
                <span className={s.textPrimary}>incoming/track · incoming/video</span>
              </div>
            </div>
          </div>
        </div>
      </Panel>

      <Panel>
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <FolderOpen className={`w-5 h-5 ${s.accent}`} />
            <h3 className={`font-bold ${s.textPrimary}`}>Workspace Manager</h3>
          </div>
          <button
            type="button"
            onClick={() => void reloadWorkspaces()}
            className={`flex items-center gap-2 px-3 py-2 text-sm ${s.buttonSecondary}`}
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>

        {workspaces.length === 0 ? (
          <div className={`rounded-2xl border ${s.divider} p-6 text-sm ${s.textSecondary}`}>
            No local workspaces are registered in this browser yet.
          </div>
        ) : (
          <div className="grid gap-4">
            {workspaces.map((workspace) => (
              <div
                key={workspace.id}
                className={`rounded-2xl border ${s.divider} p-4 flex flex-col gap-4`}
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className={`text-lg font-semibold ${s.textPrimary}`}>
                        {workspace.name}
                      </h4>
                      {workspace.isCurrent ? (
                        <span className={`inline-flex items-center gap-1 px-2 py-1 text-xs ${s.accentBg}`}>
                          <Star className="w-3 h-3" />
                          Current
                        </span>
                      ) : null}
                    </div>
                    <p className={`text-sm ${s.textSecondary}`}>Directory: {workspace.rootName}</p>
                    <p className={`text-sm ${s.textSecondary}`}>
                      {getPermissionLabel(workspace.permissionState)}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void handleUseWorkspace(workspace.id)}
                      disabled={workspaceBusy !== 'idle'}
                      className={`px-3 py-2 text-sm ${s.buttonSecondary} ${
                        workspaceBusy !== 'idle' ? 'opacity-50 cursor-not-allowed' : ''
                      }`}
                    >
                      Use
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleOpenWorkspaceFolder(workspace.id)}
                      disabled={workspaceBusy !== 'idle'}
                      className={`px-3 py-2 text-sm ${s.buttonSecondary} ${
                        workspaceBusy !== 'idle' ? 'opacity-50 cursor-not-allowed' : ''
                      }`}
                    >
                      Open Folder
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleAuthorizeWorkspace(workspace.id)}
                      disabled={workspaceBusy !== 'idle'}
                      className={`px-3 py-2 text-sm ${s.buttonSecondary} ${
                        workspaceBusy !== 'idle' ? 'opacity-50 cursor-not-allowed' : ''
                      }`}
                    >
                      {workspace.permissionState === 'granted' ? 'Recheck Access' : 'Grant Access'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleScanWorkspace(workspace.id)}
                      disabled={workspaceBusy !== 'idle' || workspace.permissionState !== 'granted'}
                      className={`inline-flex items-center gap-2 px-3 py-2 text-sm ${s.buttonSecondary} ${
                        workspaceBusy !== 'idle' || workspace.permissionState !== 'granted'
                          ? 'opacity-50 cursor-not-allowed'
                          : ''
                      }`}
                    >
                      <RefreshCw className="w-4 h-4" />
                      Scan
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleRemoveWorkspace(workspace.id)}
                      disabled={workspaceBusy !== 'idle'}
                      className={`inline-flex items-center gap-2 px-3 py-2 text-sm border border-red-400/30 text-red-300 hover:bg-red-500/10 ${
                        isRound ? 'rounded-xl' : 'rounded-sm'
                      } ${workspaceBusy !== 'idle' ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      <Trash2 className="w-4 h-4" />
                      Remove
                    </button>
                  </div>
                </div>

                <div className={`grid gap-3 md:grid-cols-4`}>
                  <div className={`rounded-xl ${s.accentBg} p-3`}>
                    <div className={`text-xs uppercase tracking-[0.14em] ${s.textSecondary}`}>
                      Pending tracks
                    </div>
                    <div className={`mt-1 text-lg font-semibold ${s.textPrimary}`}>
                      {workspace.discovery.pendingTracks}
                    </div>
                  </div>
                  <div className={`rounded-xl ${s.accentBg} p-3`}>
                    <div className={`text-xs uppercase tracking-[0.14em] ${s.textSecondary}`}>
                      Pending videos
                    </div>
                    <div className={`mt-1 text-lg font-semibold ${s.textPrimary}`}>
                      {workspace.discovery.pendingVideos}
                    </div>
                  </div>
                  <div className={`rounded-xl ${s.accentBg} p-3`}>
                    <div className={`text-xs uppercase tracking-[0.14em] ${s.textSecondary}`}>
                      Broken refs
                    </div>
                    <div className={`mt-1 text-lg font-semibold ${s.textPrimary}`}>
                      {workspace.discovery.brokenRefs}
                    </div>
                  </div>
                  <div className={`rounded-xl ${s.accentBg} p-3`}>
                    <div className={`text-xs uppercase tracking-[0.14em] ${s.textSecondary}`}>
                      Last scan
                    </div>
                    <div className={`mt-1 text-sm font-semibold ${s.textPrimary}`}>
                      {formatDateTime(workspace.discovery.lastScanAt)}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel>
        <div className="flex items-center gap-2 mb-4">
          <Shield className={`w-5 h-5 ${s.accent}`} />
          <h3 className={`font-bold ${s.textPrimary}`}>Data & Privacy</h3>
        </div>
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className={`text-sm ${s.textPrimary}`}>Data Collection</p>
              <p className={`text-xs ${s.textSecondary}`}>
                Help improve SailSIQ with anonymous usage data
              </p>
            </div>
            <button
              onClick={() => update('dataCollection', !settings.dataCollection)}
              className={`w-12 h-7 rounded-full transition-colors relative ${
                settings.dataCollection ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'
              }`}
            >
              <div
                className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow-md transition-transform ${
                  settings.dataCollection ? 'translate-x-5' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>
          <p className={`text-xs ${s.textSecondary}`}>
            All data is anonymized and encrypted. See our{' '}
            <a href="#" className={`${s.accent} underline`}>
              Privacy Policy
            </a>{' '}
            for details.
          </p>
        </div>
      </Panel>

      <Panel>
        <div className="flex items-center gap-2 mb-4">
          <Gauge className={`w-5 h-5 ${s.accent}`} />
          <h3 className={`font-bold ${s.textPrimary}`}>Preferences</h3>
        </div>
        <div className="flex flex-col gap-4">
          <div>
            <label className={`block text-sm mb-2 ${s.textSecondary}`}>Speed Unit</label>
            <div className="flex gap-2 flex-wrap">
              {([
                ['knots', 'Knots (kts)'],
                ['kmh', 'km/h'],
                ['ms', 'm/s'],
              ] as const).map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => update('speedUnit', val)}
                  className={`px-4 py-2 text-sm transition-all ${
                    settings.speedUnit === val ? s.accentBg : `${s.buttonSecondary}`
                  } ${isRound ? 'rounded-xl' : 'rounded-sm'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className={`block text-sm mb-2 ${s.textSecondary}`}>Distance Unit</label>
            <div className="flex gap-2 flex-wrap">
              {([
                ['nm', 'Nautical Miles'],
                ['km', 'Kilometers'],
                ['m', 'Meters'],
              ] as const).map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => update('distanceUnit', val)}
                  className={`px-4 py-2 text-sm transition-all ${
                    settings.distanceUnit === val ? s.accentBg : `${s.buttonSecondary}`
                  } ${isRound ? 'rounded-xl' : 'rounded-sm'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className={`block text-sm mb-2 ${s.textSecondary}`}>Time Format</label>
            <div className="flex gap-2 flex-wrap">
              {([
                ['24h', '24-Hour'],
                ['12h', '12-Hour'],
              ] as const).map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => update('timeFormat', val)}
                  className={`px-4 py-2 text-sm transition-all ${
                    settings.timeFormat === val ? s.accentBg : `${s.buttonSecondary}`
                  } ${isRound ? 'rounded-xl' : 'rounded-sm'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Panel>

      <Panel>
        <div className="flex items-center gap-2 mb-4">
          <Cpu className={`w-5 h-5 ${s.accent}`} />
          <h3 className={`font-bold ${s.textPrimary}`}>Device & Import</h3>
        </div>
        <div className="flex flex-col gap-3">
          <p className={`text-sm ${s.textSecondary}`}>
            Import GPS, tracker, and video data through the workspace import dialog.
            Track files are written to <code className={codeChip}>incoming/track</code>;
            video files are written to <code className={codeChip}>incoming/video</code>.
          </p>
          <div className={`flex justify-between items-center ${s.divider} border-t pt-3`}>
            <span className={`text-sm ${s.textSecondary}`}>Firmware version</span>
            <span className={`text-sm ${s.textPrimary}`}>--</span>
          </div>
        </div>
      </Panel>

      <Panel>
        <div className="flex items-center gap-2 mb-4">
          <User className={`w-5 h-5 ${s.accent}`} />
          <h3 className={`font-bold ${s.textPrimary}`}>Account</h3>
        </div>
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className={`text-sm ${s.textSecondary}`}>Theme</span>
            <span className={`text-sm ${s.textPrimary}`}>Configured below</span>
          </div>
          <div className="flex gap-2 flex-wrap">
            {allThemes.map((theme) => (
              <button
                key={theme.id}
                onClick={() => setTheme(theme.id)}
                className={`px-4 py-2 text-sm transition-all ${
                  themeId === theme.id ? s.accentBg : `${s.buttonSecondary}`
                } ${isRound ? 'rounded-xl' : 'rounded-sm'}`}
              >
                {theme.label}
              </button>
            ))}
          </div>
          <div className={`border-t ${s.divider}`} />
          <div className="flex items-center justify-between">
            <span className={`text-sm ${s.textSecondary}`}>Language</span>
            <span className={`text-sm ${s.textPrimary}`}>English (placeholder)</span>
          </div>
          <div className={`border-t ${s.divider}`} />
          <div className="flex items-center justify-between">
            <span className={`text-sm ${s.textSecondary}`}>Status</span>
            <span className={`text-sm ${s.textPrimary}`}>
              {currentWorkspace ? `Local Mode / ${currentWorkspace.name}` : 'Local Mode'}
            </span>
          </div>
          <div className={`border-t ${s.divider}`} />
          <div className="flex items-center justify-between">
            <span className={`text-sm ${s.textSecondary}`}>App Version</span>
            <span className={`text-sm ${s.textPrimary}`}>0.1.0 (MVP)</span>
          </div>
        </div>
      </Panel>

      <div className="flex justify-end">
        <button
          onClick={handleSave}
          className={`flex items-center gap-2 px-6 py-2 text-sm ${s.buttonPrimary}`}
        >
          {saved ? (
            <>
              <Check className="w-4 h-4" /> Saved
            </>
          ) : (
            <>
              <Save className="w-4 h-4" /> Save Settings
            </>
          )}
        </button>
      </div>

      {importDialogOpen && currentWorkspace ? (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div
            className={`${s.panel} w-full max-w-2xl p-6 flex flex-col gap-5 relative`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className={`text-lg font-semibold ${s.textPrimary}`}>Import Data</h3>
                <p className={`mt-1 text-sm ${s.textSecondary}`}>
                  Choose local files and place them into the current workspace.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setImportDialogOpen(false);
                  setPickedFiles([]);
                  setImportProgress(null);
                }}
                className={`p-1 ${s.buttonSecondary}`}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className={`rounded-2xl border ${s.divider} p-4 flex flex-col gap-2 text-sm ${s.textSecondary}`}>
              <div>
                Workspace: <code className={codeChip}>{currentWorkspace.name}</code>
              </div>
              <div>
                Tracker destination: <code className={codeChip}>incoming/track</code>
              </div>
              <div>
                Video destination: <code className={codeChip}>incoming/video</code>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-2">
                <label className={`text-sm ${s.textSecondary}`}>Import target</label>
                <div className="flex flex-wrap gap-2">
                  {([
                    ['track', 'Tracker / GPX / UBX / bin'],
                    ['video', 'Video'],
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setImportTarget(value)}
                      className={`px-4 py-2 text-sm transition-all ${
                        importTarget === value ? s.accentBg : s.buttonSecondary
                      } ${isRound ? 'rounded-xl' : 'rounded-sm'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <label className={`text-sm ${s.textSecondary}`}>Transfer mode</label>
                <div className="flex flex-wrap gap-2">
                  {([
                    ['copy', 'Copy'],
                    ['cut', 'Cut'],
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setImportMode(value)}
                      className={`px-4 py-2 text-sm transition-all ${
                        importMode === value ? s.accentBg : s.buttonSecondary
                      } ${isRound ? 'rounded-xl' : 'rounded-sm'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className={`rounded-2xl border ${s.divider} p-4 text-sm ${s.textSecondary}`}>
              {importMode === 'copy'
                ? 'Copy keeps the original source files untouched.'
                : 'Cut tries to remove the original files after import. If the browser does not expose source-file deletion from the picker, SailSIQ falls back to copy and reports that in the result message.'}
            </div>

            <div className={`rounded-2xl border ${s.divider} p-4`}>
              <div className="flex items-center justify-between gap-3">
                <p className={`text-sm font-semibold ${s.textPrimary}`}>Selected files</p>
                <span className={`text-xs ${s.textSecondary}`}>{pickedFiles.length} item(s)</span>
              </div>
              {pickedFiles.length === 0 ? (
                <p className={`mt-3 text-sm ${s.textSecondary}`}>
                  No files selected yet. Click <strong>Select Files</strong> first, then review the
                  list before importing.
                </p>
              ) : (
                <div className="mt-3 max-h-56 overflow-y-auto">
                  <div className="grid gap-2">
                    {pickedFiles.map((file) => (
                      <div
                        key={`${file.name}:${file.size}:${file.lastModified}`}
                        className={`rounded-xl ${s.accentBg} px-3 py-2 text-sm`}
                      >
                        <div className={s.textPrimary}>{file.name}</div>
                        <div className={`text-xs ${s.textSecondary}`}>
                          {(file.size / 1024 / 1024).toFixed(2)} MB
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {importProgress ? (
              <div className={`rounded-2xl border ${s.divider} p-4`}>
                <div className="flex items-center justify-between gap-3">
                  <p className={`text-sm font-semibold ${s.textPrimary}`}>Import progress</p>
                  <span className={`text-xs ${s.textSecondary}`}>{importPercent}%</span>
                </div>
                <div className={`mt-3 h-2 overflow-hidden rounded-full ${s.accentBg}`}>
                  <div
                    className="h-full rounded-full bg-emerald-400 transition-[width] duration-200"
                    style={{ width: `${importPercent}%` }}
                  />
                </div>
                <div className={`mt-3 flex flex-col gap-1 text-sm ${s.textSecondary}`}>
                  <div>
                    {importProgress.currentFileIndex}/{importProgress.totalFiles}:{' '}
                    <span className={s.textPrimary}>
                      {importProgress.currentFileName || '--'}
                    </span>
                  </div>
                  <div>
                    {formatBytes(importProgress.writtenBytes)} /{' '}
                    {formatBytes(importProgress.totalBytes)}
                  </div>
                </div>
              </div>
            ) : null}

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setImportDialogOpen(false);
                  setPickedFiles([]);
                  setImportProgress(null);
                }}
                className={`px-4 py-2 text-sm ${s.buttonSecondary}`}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handlePickImportFiles()}
                disabled={workspaceBusy !== 'idle'}
                className={`inline-flex items-center gap-2 px-4 py-2 text-sm ${s.buttonPrimary} ${
                  workspaceBusy !== 'idle' ? 'opacity-50 cursor-not-allowed' : ''
                }`}
              >
                <ArrowRightLeft className="w-4 h-4" />
                {workspaceBusy === 'importing' ? 'Selecting...' : 'Select Files'}
              </button>
              <button
                type="button"
                onClick={() => void handleImportData()}
                disabled={workspaceBusy !== 'idle' || pickedFiles.length === 0}
                className={`inline-flex items-center gap-2 px-4 py-2 text-sm ${s.buttonPrimary} ${
                  workspaceBusy !== 'idle' || pickedFiles.length === 0
                    ? 'opacity-50 cursor-not-allowed'
                    : ''
                }`}
              >
                <ArrowRightLeft className="w-4 h-4" />
                {workspaceBusy === 'importing' ? 'Importing...' : 'Import to Workspace'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
