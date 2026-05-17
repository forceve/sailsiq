import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CalendarDays,
  FolderOpen,
  HardDrive,
  PlusCircle,
  RefreshCw,
  Route as RouteIcon,
  ShieldAlert,
  ShieldCheck,
  Video,
  Waves,
} from 'lucide-react';
import { useWorkspaceContext } from '@/context/WorkspaceContext';
import { useTheme } from '@/theme/ThemeContext';
import Panel from '@/components/Panel';
import { listLocalWorkspaceSessions } from '@/services/workspace/localTrackSession';
import type { Session } from '@/types/models';
import type { LocalWorkspaceSummary } from '@/types/workspace';

type HomeAction = 'idle' | 'using' | 'authorizing' | 'scanning';

function formatDateTime(value: string | null): string {
  if (!value) return 'Never';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function getPermissionTone(
  workspace: LocalWorkspaceSummary | null,
  s: ReturnType<typeof useTheme>['s'],
) {
  if (!workspace) return s.textSecondary;
  return workspace.permissionState === 'granted' ? 'text-emerald-300' : 'text-amber-200';
}

export default function HomePage() {
  const { s } = useTheme();
  const {
    workspaces,
    currentWorkspace,
    supported,
    loading,
    useWorkspace,
    authorizeWorkspace,
    scanWorkspace,
    reloadWorkspaces,
  } = useWorkspaceContext();
  const [busy, setBusy] = useState<HomeAction>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [localSessions, setLocalSessions] = useState<Session[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  useEffect(() => {
    if (!currentWorkspace || currentWorkspace.permissionState !== 'granted') {
      setLocalSessions([]);
      setSessionsLoading(false);
      return;
    }

    let cancelled = false;
    setSessionsLoading(true);
    void listLocalWorkspaceSessions(currentWorkspace.id)
      .then((sessions) => {
        if (!cancelled) {
          setLocalSessions(sessions);
        }
      })
      .catch((sessionError) => {
        if (!cancelled) {
          setLocalSessions([]);
          setError(
            sessionError instanceof Error
              ? sessionError.message
              : 'Failed to load workspace sessions.',
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSessionsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentWorkspace]);

  const runWorkspaceAction = async (
    action: HomeAction,
    task: () => Promise<{ name: string }>,
    success: (name: string) => string,
  ) => {
    setBusy(action);
    setError(null);
    setMessage(null);
    try {
      const result = await task();
      setMessage(success(result.name));
    } catch (taskError) {
      setError(taskError instanceof Error ? taskError.message : 'Workspace action failed.');
    } finally {
      setBusy('idle');
    }
  };

  const handleUseCurrent = async () => {
    if (!currentWorkspace) return;
    await runWorkspaceAction(
      'using',
      () => useWorkspace(currentWorkspace.id),
      (name) => `Using workspace "${name}".`,
    );
  };

  const handleAuthorizeCurrent = async () => {
    if (!currentWorkspace) return;
    await runWorkspaceAction(
      'authorizing',
      () => authorizeWorkspace(currentWorkspace.id),
      (name) => `Access restored for "${name}".`,
    );
  };

  const handleScanCurrent = async () => {
    if (!currentWorkspace) return;
    await runWorkspaceAction(
      'scanning',
      () => scanWorkspace(currentWorkspace.id),
      (name) => `Scanned "${name}".`,
    );
  };

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto grid gap-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className={`${s.skeleton} h-32`} />
        ))}
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className={`text-xl font-bold ${s.textPrimary}`}>Workspace Home</h2>
          <p className={`mt-1 text-sm ${s.textSecondary}`}>
            Phase 1 uses the current local workspace as the entry point for setup,
            permissions, scanning, and session discovery.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            to="/settings"
            className={`flex items-center gap-2 px-4 py-2 text-sm no-underline ${s.buttonSecondary}`}
          >
            <FolderOpen className="w-4 h-4" />
            Workspace Settings
          </Link>
          <Link
            to="/new"
            className={`flex items-center gap-2 px-4 py-2 text-sm no-underline ${s.buttonPrimary}`}
          >
            <PlusCircle className="w-4 h-4" />
            New Session
          </Link>
        </div>
      </div>

      {!supported && (
        <Panel>
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 h-5 w-5 text-amber-300" />
            <div>
              <p className={`font-semibold ${s.textPrimary}`}>Directory access unavailable</p>
              <p className={`mt-1 text-sm ${s.textSecondary}`}>
                This browser does not expose the File System Access API. Phase 1
                workspace setup requires a supported browser environment.
              </p>
            </div>
          </div>
        </Panel>
      )}

      {message && (
        <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          {message}
        </div>
      )}

      {error && (
        <div className="rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {!currentWorkspace ? (
        <Panel>
          <div className="py-12 text-center">
            <HardDrive className={`mx-auto h-12 w-12 ${s.textSecondary} opacity-50`} />
            <p className={`mt-4 text-lg font-semibold ${s.textPrimary}`}>
              No current workspace selected
            </p>
            <p className={`mx-auto mt-2 max-w-xl text-sm ${s.textSecondary}`}>
              Finish Phase 1 setup in Settings first. Create a new local workspace
              or use an existing one, then return here to manage discovery and
              workspace state.
            </p>
            <div className="mt-5 flex justify-center">
              <Link
                to="/settings"
                className={`flex items-center gap-2 px-5 py-2 text-sm no-underline ${s.buttonPrimary}`}
              >
                <FolderOpen className="w-4 h-4" />
                Open Workspace Setup
              </Link>
            </div>
          </div>
        </Panel>
      ) : (
        <>
          <Panel>
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className={`text-lg font-semibold ${s.textPrimary}`}>
                    {currentWorkspace.name}
                  </h3>
                  <span className={`inline-flex items-center gap-1 px-2 py-1 text-xs ${s.accentBg}`}>
                    <HardDrive className="w-3 h-3" />
                    Current Workspace
                  </span>
                </div>
                <div className={`mt-3 grid gap-2 text-sm ${s.textSecondary}`}>
                  <div>Directory: {currentWorkspace.rootName}</div>
                  <div>
                    Last scan: {formatDateTime(currentWorkspace.discovery.lastScanAt)}
                  </div>
                  <div className={getPermissionTone(currentWorkspace, s)}>
                    Permission: {currentWorkspace.permissionState}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void handleUseCurrent()}
                  disabled={busy !== 'idle'}
                  className={`px-3 py-2 text-sm ${s.buttonSecondary} ${
                    busy !== 'idle' ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                >
                  {busy === 'using' ? 'Using...' : 'Use Workspace'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleAuthorizeCurrent()}
                  disabled={busy !== 'idle'}
                  className={`inline-flex items-center gap-2 px-3 py-2 text-sm ${s.buttonSecondary} ${
                    busy !== 'idle' ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                >
                  {currentWorkspace.permissionState === 'granted' ? (
                    <ShieldCheck className="w-4 h-4" />
                  ) : (
                    <ShieldAlert className="w-4 h-4" />
                  )}
                  {busy === 'authorizing' ? 'Checking...' : 'Grant Access'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleScanCurrent()}
                  disabled={busy !== 'idle' || currentWorkspace.permissionState !== 'granted'}
                  className={`inline-flex items-center gap-2 px-3 py-2 text-sm ${s.buttonSecondary} ${
                    busy !== 'idle' || currentWorkspace.permissionState !== 'granted'
                      ? 'opacity-50 cursor-not-allowed'
                      : ''
                  }`}
                >
                  <RefreshCw className="w-4 h-4" />
                  {busy === 'scanning' ? 'Scanning...' : 'Scan Workspace'}
                </button>
              </div>
            </div>
          </Panel>

          <div className="grid gap-4 md:grid-cols-3">
            <Panel>
              <div className="flex items-center gap-2">
                <Waves className={`h-4 w-4 ${s.accent}`} />
                <p className={`text-xs uppercase tracking-[0.18em] ${s.textSecondary}`}>
                  Pending tracks
                </p>
              </div>
              <p className={`mt-3 text-3xl font-bold ${s.textPrimary}`}>
                {currentWorkspace.discovery.pendingTracks}
              </p>
              <p className={`mt-2 text-sm ${s.textSecondary}`}>
                Files detected in `incoming/track` and ready for later session creation.
              </p>
            </Panel>

            <Panel>
              <div className="flex items-center gap-2">
                <Video className={`h-4 w-4 ${s.accent}`} />
                <p className={`text-xs uppercase tracking-[0.18em] ${s.textSecondary}`}>
                  Pending videos
                </p>
              </div>
              <p className={`mt-3 text-3xl font-bold ${s.textPrimary}`}>
                {currentWorkspace.discovery.pendingVideos}
              </p>
              <p className={`mt-2 text-sm ${s.textSecondary}`}>
                Videos discovered in `incoming/video` and `library/video`.
              </p>
            </Panel>

            <Panel>
              <div className="flex items-center gap-2">
                <ShieldAlert className={`h-4 w-4 ${s.accent}`} />
                <p className={`text-xs uppercase tracking-[0.18em] ${s.textSecondary}`}>
                  Broken refs
                </p>
              </div>
              <p className={`mt-3 text-3xl font-bold ${s.textPrimary}`}>
                {currentWorkspace.discovery.brokenRefs}
              </p>
              <p className={`mt-2 text-sm ${s.textSecondary}`}>
                Placeholder for missing asset detection. Full relocation arrives after the
                replay and asset phases.
              </p>
            </Panel>
          </div>

          <Panel>
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className={`text-lg font-semibold ${s.textPrimary}`}>
                  Workspace Sessions
                </h3>
                <p className={`mt-1 text-sm ${s.textSecondary}`}>
                  Sessions saved under sessions/&lt;sessionId&gt;/ in the current workspace.
                  Imported sessions still open the remote replay route in this phase.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void reloadWorkspaces()}
                className={`inline-flex items-center gap-2 px-3 py-2 text-sm ${s.buttonSecondary}`}
              >
                <RefreshCw className="w-4 h-4" />
                Refresh
              </button>
            </div>

            {sessionsLoading ? (
              <div className="mt-4 grid gap-3">
                {[1, 2].map((item) => (
                  <div key={item} className={`${s.skeleton} h-24`} />
                ))}
              </div>
            ) : localSessions.length === 0 ? (
              <div className={`mt-4 rounded-2xl border ${s.divider} p-5`}>
                <div className="flex flex-col gap-2">
                  <p className={`text-sm font-semibold ${s.textPrimary}`}>No local sessions yet</p>
                  <p className={`text-sm ${s.textSecondary}`}>
                    Create an imported session or a canvas session to generate a local
                    bundle in this workspace.
                  </p>
                </div>
              </div>
            ) : (
              <div className="mt-4 grid gap-3">
                {localSessions.map((session) => {
                  const targetPath = session.canvasType
                    ? `/session/${session.id}/canvas`
                    : `/session/${session.id}/replay`;
                  return (
                    <Link
                      key={session.id}
                      to={targetPath}
                      className={`rounded-2xl border ${s.divider} p-4 no-underline transition-colors hover:bg-current/5`}
                    >
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className={`truncate text-base font-semibold ${s.textPrimary}`}>
                              {session.name}
                            </p>
                            <span className={`px-2 py-1 text-xs ${s.accentBg}`}>
                              {session.canvasType ? 'Canvas' : 'Imported Track'}
                            </span>
                          </div>
                          <div className={`mt-2 flex flex-wrap gap-x-4 gap-y-2 text-sm ${s.textSecondary}`}>
                            <span className="inline-flex items-center gap-1">
                              <CalendarDays className="w-3.5 h-3.5" />
                              {session.date}
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <RouteIcon className="w-3.5 h-3.5" />
                              {session.location || 'No location'}
                            </span>
                          </div>
                        </div>

                        <div className="grid grid-cols-3 gap-3 text-right text-sm">
                          <div>
                            <div className={s.textPrimary}>
                              {Math.round(session.stats.duration / 60)} min
                            </div>
                            <div className={`text-xs ${s.textSecondary}`}>Duration</div>
                          </div>
                          <div>
                            <div className={s.textPrimary}>
                              {(session.stats.distance / 1000).toFixed(2)} km
                            </div>
                            <div className={`text-xs ${s.textSecondary}`}>Distance</div>
                          </div>
                          <div>
                            <div className={s.textPrimary}>
                              {session.eventCount ?? 0}
                            </div>
                            <div className={`text-xs ${s.textSecondary}`}>Events</div>
                          </div>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </Panel>
        </>
      )}

      <Panel>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className={`text-lg font-semibold ${s.textPrimary}`}>Remembered Workspaces</h3>
            <p className={`mt-1 text-sm ${s.textSecondary}`}>
              Local browser bindings restored from File System Access handles.
            </p>
          </div>
          <span className={`px-3 py-1 text-xs ${s.accentBg}`}>{workspaces.length} tracked</span>
        </div>

        {workspaces.length === 0 ? (
          <div className={`mt-4 rounded-2xl border ${s.divider} p-5 text-sm ${s.textSecondary}`}>
            No workspace bindings stored in this browser yet.
          </div>
        ) : (
          <div className="mt-4 grid gap-3">
            {workspaces.map((workspace) => (
              <div
                key={workspace.id}
                className={`rounded-2xl border ${s.divider} p-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between`}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className={`font-semibold ${s.textPrimary}`}>{workspace.name}</p>
                    {workspace.isCurrent ? (
                      <span className={`px-2 py-1 text-xs ${s.accentBg}`}>Current</span>
                    ) : null}
                  </div>
                  <p className={`text-sm ${s.textSecondary}`}>
                    {workspace.rootName} · {workspace.permissionState}
                  </p>
                </div>
                <div className="text-sm text-right">
                  <div className={s.textPrimary}>
                    {workspace.discovery.pendingTracks} tracks / {workspace.discovery.pendingVideos} videos
                  </div>
                  <div className={s.textSecondary}>
                    Scanned {formatDateTime(workspace.discovery.lastScanAt)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
