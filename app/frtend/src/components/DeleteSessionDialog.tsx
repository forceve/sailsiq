import { useState } from 'react';
import { Loader2, Trash2, X } from 'lucide-react';
import { useTheme } from '@/theme/ThemeContext';
import { sessionApi } from '@/services/api';
import {
  deleteLocalWorkspaceSession,
  getLocalSessionDeletePreview,
  type LocalSessionDeletePreview,
} from '@/services/workspace/localTrackSession';

export interface SessionDeleteTarget {
  id: string;
  name: string;
}

export interface SessionDeleteResult {
  warning: string | null;
}

interface UseSessionDeleteActionOptions {
  workspaceId: string | null;
  allowRemoteFallback: boolean;
  onDeleted: (session: SessionDeleteTarget, result: SessionDeleteResult) => void;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Failed to delete session.';
}

export function useSessionDeleteAction({
  workspaceId,
  allowRemoteFallback,
  onDeleted,
}: UseSessionDeleteActionOptions) {
  const [target, setTarget] = useState<SessionDeleteTarget | null>(null);
  const [preview, setPreview] = useState<LocalSessionDeletePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [deleteCopiedTrack, setDeleteCopiedTrack] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestDelete = async (session: SessionDeleteTarget) => {
    setTarget(session);
    setPreview(null);
    setDeleteCopiedTrack(false);
    setError(null);
    setBusy(false);

    if (!workspaceId) {
      setPreview({ exists: false, exclusiveCopiedTrackPath: null });
      return;
    }

    setPreviewLoading(true);
    try {
      const nextPreview = await getLocalSessionDeletePreview(workspaceId, session.id);
      setPreview(nextPreview);
    } catch (previewError) {
      setError(getErrorMessage(previewError));
    } finally {
      setPreviewLoading(false);
    }
  };

  const cancelDelete = () => {
    if (busy) return;
    setTarget(null);
    setPreview(null);
    setError(null);
    setDeleteCopiedTrack(false);
  };

  const confirmDelete = async () => {
    if (!target || previewLoading || busy) return;
    setBusy(true);
    setError(null);
    try {
      let result: SessionDeleteResult = { warning: null };
      if (workspaceId && preview?.exists) {
        result = await deleteLocalWorkspaceSession(workspaceId, target.id, {
          deleteCopiedTrackSource:
            deleteCopiedTrack && Boolean(preview.exclusiveCopiedTrackPath),
        });
      } else if (workspaceId && !allowRemoteFallback) {
        result = await deleteLocalWorkspaceSession(workspaceId, target.id);
      } else if (allowRemoteFallback) {
        await sessionApi.delete(target.id);
      } else {
        throw new Error('This session is not in the current workspace.');
      }

      const deleted = target;
      setTarget(null);
      setPreview(null);
      setDeleteCopiedTrack(false);
      onDeleted(deleted, result);
    } catch (deleteError) {
      setError(getErrorMessage(deleteError));
    } finally {
      setBusy(false);
    }
  };

  return {
    target,
    preview,
    previewLoading,
    deleteCopiedTrack,
    setDeleteCopiedTrack,
    busy,
    error,
    requestDelete,
    cancelDelete,
    confirmDelete,
  };
}

interface DeleteSessionDialogProps {
  target: SessionDeleteTarget | null;
  preview: LocalSessionDeletePreview | null;
  previewLoading: boolean;
  deleteCopiedTrack: boolean;
  onDeleteCopiedTrackChange: (checked: boolean) => void;
  busy: boolean;
  error: string | null;
  allowRemoteFallback: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function DeleteSessionDialog({
  target,
  preview,
  previewLoading,
  deleteCopiedTrack,
  onDeleteCopiedTrackChange,
  busy,
  error,
  allowRemoteFallback,
  onCancel,
  onConfirm,
}: DeleteSessionDialogProps) {
  const { s, themeId } = useTheme();
  if (!target) return null;

  const isRound = themeId === 'nordic' || themeId === 'frost' || themeId === 'neumorph';
  const isWorkspaceSession = Boolean(preview?.exists) || !allowRemoteFallback;
  const canConfirm = !previewLoading && !busy && preview != null;

  return (
    <div
      className="fixed inset-0 z-[10060] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-session-title"
        className={`${s.panel} relative w-full max-w-lg p-6`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 id="delete-session-title" className={`text-lg font-semibold ${s.textPrimary}`}>
              Delete session
            </h3>
            <p className={`mt-1 text-sm ${s.textSecondary}`}>
              {target.name}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className={`p-1 ${s.buttonSecondary}`}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className={`mt-4 text-sm ${s.textSecondary}`}>
          {previewLoading ? (
            <p className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking session files…
            </p>
          ) : isWorkspaceSession ? (
            <p>
              This removes the session folder from the current workspace. Videos in
              incoming/video and library/video stay on disk, and source files used by
              other sessions are kept.
            </p>
          ) : (
            <p>This removes the session from the server. This cannot be undone.</p>
          )}
        </div>

        {preview?.exclusiveCopiedTrackPath ? (
          <label className={`mt-4 flex items-start gap-3 text-sm ${s.textSecondary}`}>
            <input
              type="checkbox"
              checked={deleteCopiedTrack}
              disabled={busy}
              onChange={(event) => onDeleteCopiedTrackChange(event.target.checked)}
              className="mt-1 h-4 w-4"
            />
            <span>
              Also delete the copied track file{' '}
              <span className={`font-medium ${s.textPrimary}`}>
                {preview.exclusiveCopiedTrackPath}
              </span>
              . No other session uses it.
            </span>
          </label>
        ) : null}

        {error ? (
          <p className="mt-4 rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-200">
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className={`px-4 py-2 text-sm ${s.buttonSecondary}`}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canConfirm}
            className={`inline-flex items-center gap-2 border border-red-400/30 px-4 py-2 text-sm text-red-700 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-200 ${
              isRound ? 'rounded-xl' : 'rounded-sm'
            }`}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Delete session
          </button>
        </div>
      </div>
    </div>
  );
}
