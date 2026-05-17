import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  listLocalWorkspaces,
  requestWorkspaceAccess,
  scanStoredWorkspace,
  supportsLocalWorkspaceDirectories,
  useStoredWorkspace,
} from '@/services/workspace/localWorkspace';
import type { LocalWorkspaceSummary } from '@/types/workspace';

interface WorkspaceContextValue {
  workspaces: LocalWorkspaceSummary[];
  currentWorkspace: LocalWorkspaceSummary | null;
  loading: boolean;
  supported: boolean;
  reloadWorkspaces: () => Promise<void>;
  useWorkspace: (workspaceId: string) => Promise<LocalWorkspaceSummary>;
  authorizeWorkspace: (workspaceId: string) => Promise<LocalWorkspaceSummary>;
  scanWorkspace: (workspaceId: string) => Promise<LocalWorkspaceSummary>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspaces, setWorkspaces] = useState<LocalWorkspaceSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const reloadWorkspaces = useCallback(async () => {
    setLoading(true);
    try {
      const next = await listLocalWorkspaces();
      setWorkspaces(next);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reloadWorkspaces();
  }, [reloadWorkspaces]);

  const useWorkspace = useCallback(
    async (workspaceId: string) => {
      const workspace = await useStoredWorkspace(workspaceId);
      await reloadWorkspaces();
      return workspace;
    },
    [reloadWorkspaces],
  );

  const authorizeWorkspace = useCallback(
    async (workspaceId: string) => {
      const workspace = await requestWorkspaceAccess(workspaceId);
      await reloadWorkspaces();
      return workspace;
    },
    [reloadWorkspaces],
  );

  const scanWorkspace = useCallback(
    async (workspaceId: string) => {
      const workspace = await scanStoredWorkspace(workspaceId);
      await reloadWorkspaces();
      return workspace;
    },
    [reloadWorkspaces],
  );

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      workspaces,
      currentWorkspace: workspaces.find((workspace) => workspace.isCurrent) ?? null,
      loading,
      supported: supportsLocalWorkspaceDirectories(),
      reloadWorkspaces,
      useWorkspace,
      authorizeWorkspace,
      scanWorkspace,
    }),
    [authorizeWorkspace, loading, reloadWorkspaces, scanWorkspace, useWorkspace, workspaces],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspaceContext(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error('useWorkspaceContext must be used within WorkspaceProvider.');
  }
  return context;
}
