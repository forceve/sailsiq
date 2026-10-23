import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  CheckCircle,
  Database,
  FileText,
  Film,
  Grid,
  Map as MapIcon,
  Pencil,
  Plus,
  RefreshCw,
  Upload,
  X,
} from 'lucide-react';
import { useWorkspaceContext } from '@/context/WorkspaceContext';
import { useTheme } from '@/theme/ThemeContext';
import Panel from '@/components/Panel';
import { importApi, parseApi, sessionApi } from '@/services/api';
import { createLocalCanvasSession } from '@/services/workspace/localCanvasSession';
import {
  createLocalImportedTrackSession,
  getSessionNameFromLocalTrackFile,
  listLocalWorkspaceVideoFiles,
  listLocalWorkspaceTrackFiles,
  saveLocalWorkspaceSessionVideoBindings,
  loadLocalWorkspaceVideoFile,
  loadLocalWorkspaceTrackFile,
  parseLocalTrackFile,
  type ParsedImportTrack,
} from '@/services/workspace/localTrackSession';
import type {
  ParseResult,
  VideoPlacementConfidence,
  VideoPlacementSource,
  VideoSyncBinding,
  VideoType,
} from '@/types/models';
import {
  getVideoFileWallClockStartMs,
  tryComputeVideoOffsetFromWallClock,
} from '@/utils/videoAutoOffset';
import {
  createOffsetOnlyVideoSync,
  createVideoSyncBindingFromAnchor,
} from '@/utils/videoSync';
import { getLocalVideoSignature } from '@/utils/videoSession';
import type {
  ReplayNavigationState,
  WorkspaceTrackFileSummary,
  WorkspaceVideoBinding,
  WorkspaceVideoFileSummary,
} from '@/types/workspace';

type CreateMode = 'import' | 'canvas';
type CanvasType = 'worldmap' | 'blank';
type ImportSourceKind = 'workspace_file' | 'local_file';

interface SelectedTrackSource {
  kind: ImportSourceKind;
  file: File;
  workspaceFile?: WorkspaceTrackFileSummary;
}

type VideoSourceKind = 'workspace_video' | 'local_file';

interface SelectedVideoSource {
  kind: VideoSourceKind;
  file: File;
  durationMs: number;
  workspaceVideo?: WorkspaceVideoFileSummary;
}

interface SelectedVideoTrack {
  id: string;
  name: string;
  videoType: VideoType;
  clips: SelectedVideoSource[];
}

const SUPPORTED_IMPORT_EXTENSIONS = new Set(['gpx', 'ubx', 'ldc', 'bin', 'csv', 'tsv', 'txt']);
const SUPPORTED_IMPORT_LABEL = '.gpx, .ubx, .ldc, .bin, .csv, .tsv, .txt';

function isSupportedImportFile(fileName: string): boolean {
  const trimmed = fileName.trim();
  const dotIndex = trimmed.lastIndexOf('.');
  if (dotIndex <= 0) return false;
  return SUPPORTED_IMPORT_EXTENSIONS.has(
    trimmed.slice(dotIndex + 1).toLowerCase(),
  );
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(undefined, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
}

function formatFileSize(size: number): string {
  if (size <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const unitIndex = Math.min(
    Math.floor(Math.log(size) / Math.log(1024)),
    units.length - 1,
  );
  const value = size / 1024 ** unitIndex;
  return `${value.toFixed(unitIndex === 0 ? 0 : value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function formatVideoDurationMs(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 'Unknown duration';
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds.toString().padStart(2, '0')}s` : `${seconds}s`;
}

function getBaseName(fileName: string): string {
  const trimmed = fileName.trim();
  const dotIndex = trimmed.lastIndexOf('.');
  const baseName = dotIndex > 0 ? trimmed.slice(0, dotIndex) : trimmed;
  return baseName.toLowerCase().replace(/[\s_-]+/g, '');
}

function getSelectedVideoKey(video: SelectedVideoSource): string {
  return video.kind === 'workspace_video' && video.workspaceVideo
    ? `workspace:${video.workspaceVideo.relativePath}`
    : `local:${getLocalVideoSignature(video.file)}`;
}

function createPreboundVideoTrackId(): string {
  return `video-track-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function readVideoFileDurationMs(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    let settled = false;

    const finish = (durationMs: number) => {
      if (settled) return;
      settled = true;
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('durationchange', handleLoadedMetadata);
      video.removeEventListener('error', handleError);
      video.pause();
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
      resolve(durationMs);
    };

    const handleLoadedMetadata = () =>
      finish(Number.isFinite(video.duration) && video.duration > 0 ? video.duration * 1000 : 0);
    const handleError = () => finish(0);

    video.preload = 'metadata';
    video.playsInline = true;
    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('durationchange', handleLoadedMetadata);
    video.addEventListener('error', handleError);
    video.src = url;
    video.load();
  });
}

export default function NewSessionPage() {
  const { s, themeId } = useTheme();
  const { currentWorkspace, reloadWorkspaces } = useWorkspaceContext();
  const navigate = useNavigate();

  const [mode, setMode] = useState<CreateMode>('import');
  const [canvasType, setCanvasType] = useState<CanvasType>('worldmap');
  const [name, setName] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [location, setLocation] = useState('');
  const [boat, setBoat] = useState('');
  const [project, setProject] = useState('');
  const [selectedSource, setSelectedSource] = useState<SelectedTrackSource | null>(null);
  const [workspaceTrackFiles, setWorkspaceTrackFiles] = useState<WorkspaceTrackFileSummary[]>([]);
  const [workspaceVideoFiles, setWorkspaceVideoFiles] = useState<WorkspaceVideoFileSummary[]>([]);
  const [workspaceTrackError, setWorkspaceTrackError] = useState<string | null>(null);
  const [workspaceVideoError, setWorkspaceVideoError] = useState<string | null>(null);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [parsedTrackBundle, setParsedTrackBundle] = useState<ParsedImportTrack | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [autoName, setAutoName] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [saveImportToWorkspace, setSaveImportToWorkspace] = useState(true);
  const [copyImportSourceToWorkspace, setCopyImportSourceToWorkspace] = useState(true);
  const [videoTracks, setVideoTracks] = useState<SelectedVideoTrack[]>([]);
  const [expandedVideoTrackId, setExpandedVideoTrackId] = useState<string | null>(null);
  const [videoFilePickerTrackId, setVideoFilePickerTrackId] = useState<string | null>(null);
  const [videoSelectionError, setVideoSelectionError] = useState<string | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);

  const isRound =
    themeId === 'nordic' || themeId === 'frost' || themeId === 'neumorph';

  const refreshWorkspaceTracks = useCallback(async () => {
    if (!currentWorkspace) {
      setWorkspaceTrackFiles([]);
      setWorkspaceTrackError(null);
      return;
    }

    try {
      const files = await listLocalWorkspaceTrackFiles(currentWorkspace.id);
      setWorkspaceTrackFiles(files);
      setWorkspaceTrackError(null);
    } catch (error) {
      setWorkspaceTrackFiles([]);
      setWorkspaceTrackError(
        error instanceof Error
          ? error.message
          : 'Failed to read workspace track files.',
      );
    }
  }, [currentWorkspace]);

  const refreshWorkspaceVideos = useCallback(async () => {
    if (!currentWorkspace) {
      setWorkspaceVideoFiles([]);
      setWorkspaceVideoError(null);
      return;
    }

    try {
      const files = await listLocalWorkspaceVideoFiles(currentWorkspace.id);
      setWorkspaceVideoFiles(files);
      setWorkspaceVideoError(null);
    } catch (error) {
      setWorkspaceVideoFiles([]);
      setWorkspaceVideoError(
        error instanceof Error
          ? error.message
          : 'Failed to read workspace video files.',
      );
    }
  }, [currentWorkspace]);

  useEffect(() => {
    void refreshWorkspaceTracks();
    void refreshWorkspaceVideos();
  }, [refreshWorkspaceTracks, refreshWorkspaceVideos]);

  const resetSelectedSource = useCallback(() => {
    setSelectedSource(null);
    setAutoName(null);
    setParseResult(null);
    setParsedTrackBundle(null);
    setParseError(null);
    setVideoTracks([]);
    setExpandedVideoTrackId(null);
    setVideoFilePickerTrackId(null);
    setVideoSelectionError(null);
  }, []);

  const previewTrackSource = useCallback(
    async (
      file: File,
      sourceKind: ImportSourceKind,
      workspaceFile?: WorkspaceTrackFileSummary,
    ) => {
      if (!isSupportedImportFile(file.name)) {
        setSelectedSource(null);
        setAutoName(null);
        setParseResult(null);
        setParsedTrackBundle(null);
        setParseError(`Only ${SUPPORTED_IMPORT_LABEL} files are supported.`);
        setParsing(false);
        return;
      }

      const nextAutoName = getSessionNameFromLocalTrackFile(file.name);
      setSelectedSource({
        kind: sourceKind,
        file,
        workspaceFile,
      });
      setName((prev) =>
        prev.trim().length === 0 ||
        (autoName != null && prev === autoName)
          ? nextAutoName
          : prev,
      );
      setAutoName(nextAutoName);
      setParsing(true);
      setParseError(null);
      setCreateError(null);

      try {
        if (sourceKind === 'workspace_file' || currentWorkspace) {
          const parsed = await parseLocalTrackFile(file);
          setParsedTrackBundle(parsed);
          setParseResult(parsed.preview);
          if (parsed.preview.date) setDate(parsed.preview.date);
          if (parsed.preview.location) setLocation(parsed.preview.location);
        } else {
          const preview = await parseApi.preview(file);
          setParsedTrackBundle(null);
          setParseResult(preview);
          if (preview.date) setDate(preview.date);
          if (preview.location) setLocation(preview.location);
        }
      } catch (error) {
        setParsedTrackBundle(null);
        setParseResult(null);
        setParseError(
          error instanceof Error ? error.message : 'Failed to parse track file.',
        );
      } finally {
        setParsing(false);
      }
    },
    [autoName, currentWorkspace],
  );

  const handleSelectWorkspaceTrack = async (workspaceFile: WorkspaceTrackFileSummary) => {
    if (!currentWorkspace) return;
    setParsing(true);
    setParseError(null);
    setCreateError(null);
    try {
      const file = await loadLocalWorkspaceTrackFile(
        currentWorkspace.id,
        workspaceFile.name,
      );
      await previewTrackSource(file, 'workspace_file', workspaceFile);
    } catch (error) {
      setSelectedSource(null);
      setParsedTrackBundle(null);
      setParseResult(null);
      setParseError(
        error instanceof Error
          ? error.message
          : 'Failed to load the selected workspace track file.',
      );
    } finally {
      setParsing(false);
    }
  };

  const handleAddVideoTrack = useCallback(() => {
    const trackId = createPreboundVideoTrackId();
    setVideoTracks((prev) => [
      ...prev,
      {
        id: trackId,
        name: `Video Track ${prev.length + 1}`,
        videoType: 'flat',
        clips: [],
      },
    ]);
    setExpandedVideoTrackId(trackId);
  }, []);

  const handleRemoveVideoTrack = useCallback((trackId: string) => {
    setVideoTracks((prev) => prev.filter((track) => track.id !== trackId));
    setExpandedVideoTrackId((prev) => (prev === trackId ? null : prev));
    setVideoFilePickerTrackId((prev) => (prev === trackId ? null : prev));
  }, []);

  const updateVideoTrack = useCallback(
    (trackId: string, patch: Partial<Pick<SelectedVideoTrack, 'name' | 'videoType'>>) => {
      setVideoTracks((prev) =>
        prev.map((track) => (track.id === trackId ? { ...track, ...patch } : track)),
      );
    },
    [],
  );

  const addVideosToTrack = useCallback(
    (trackId: string, nextVideos: SelectedVideoSource[]) => {
      if (nextVideos.length === 0) return;
      setVideoTracks((prev) => {
        if (!prev.some((track) => track.id === trackId)) return prev;
        const nextKeys = new Set(nextVideos.map(getSelectedVideoKey));
        return prev.map((track) => {
          const retainedClips = track.clips.filter(
            (video) => !nextKeys.has(getSelectedVideoKey(video)),
          );
          return track.id === trackId
            ? { ...track, clips: [...retainedClips, ...nextVideos] }
            : { ...track, clips: retainedClips };
        });
      });
      setExpandedVideoTrackId(trackId);
    },
    [],
  );

  const removeVideoFromTrack = useCallback((trackId: string, videoKey: string) => {
    setVideoTracks((prev) =>
      prev.map((track) =>
        track.id === trackId
          ? {
              ...track,
              clips: track.clips.filter((video) => getSelectedVideoKey(video) !== videoKey),
            }
          : track,
      ),
    );
  }, []);

  const handleSelectWorkspaceVideo = async (
    workspaceVideo: WorkspaceVideoFileSummary,
    trackId: string,
  ) => {
    if (!currentWorkspace) return;
    if (!videoTracks.some((track) => track.id === trackId)) {
      setVideoSelectionError('Create or expand a video track before adding clips.');
      return;
    }
    setVideoSelectionError(null);
    try {
      const file = await loadLocalWorkspaceVideoFile(
        currentWorkspace.id,
        workspaceVideo.relativePath,
      );
      const durationMs = await readVideoFileDurationMs(file).catch(() => 0);
      const nextVideo: SelectedVideoSource = {
        kind: 'workspace_video',
        file,
        workspaceVideo,
        durationMs,
      };
      addVideosToTrack(trackId, [nextVideo]);
    } catch (error) {
      setVideoSelectionError(
        error instanceof Error
          ? error.message
          : 'Failed to load the selected workspace video.',
      );
    }
  };

  const handlePickLocalVideo = useCallback(
    async (files: File[], trackId: string) => {
      if (!videoTracks.some((track) => track.id === trackId)) {
        setVideoSelectionError('Create or expand a video track before adding clips.');
        return;
      }
      setVideoSelectionError(null);
      try {
        const nextVideos = await Promise.all(
          files.map(async (file) => {
            const durationMs = await readVideoFileDurationMs(file).catch(() => 0);
            return {
              kind: 'local_file' as const,
              file,
              durationMs,
            };
          }),
        );
        addVideosToTrack(trackId, nextVideos);
      } catch (error) {
        setVideoSelectionError(
          error instanceof Error ? error.message : 'Failed to inspect the selected video.',
        );
      }
    },
    [addVideosToTrack, videoTracks],
  );

  const recommendedWorkspaceVideos = useMemo(() => {
    if (!selectedSource) return [];
    const targetBaseName = getBaseName(selectedSource.file.name);
    if (!targetBaseName) return [];
    return workspaceVideoFiles.filter(
      (video) => getBaseName(video.name) === targetBaseName,
    );
  }, [selectedSource, workspaceVideoFiles]);

  const additionalWorkspaceVideos = useMemo(() => {
    const recommendedSet = new Set(
      recommendedWorkspaceVideos.map((video) => video.relativePath),
    );
    return workspaceVideoFiles.filter(
      (video) => !recommendedSet.has(video.relativePath),
    );
  }, [recommendedWorkspaceVideos, workspaceVideoFiles]);

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setDragOver(false);
      const file = event.dataTransfer.files[0];
      if (file) {
        void previewTrackSource(file, 'local_file');
      }
    },
    [previewTrackSource],
  );

  const handleCreate = async () => {
    const sessionName =
      name.trim() ||
      (mode === 'import' && selectedSource
        ? getSessionNameFromLocalTrackFile(selectedSource.file.name)
        : '') ||
      'Untitled Session';

    setCreating(true);
    setCreateError(null);
    try {
      if (mode === 'import') {
        if (!selectedSource) {
          throw new Error('Please select a track file before creating a session.');
        }

        const importedSession = await importApi.session(selectedSource.file, {
          name: sessionName,
          date,
          location,
          boatType: boat || undefined,
          projectId: project || undefined,
        });

        const durationMsForVideo = importedSession.stats.duration * 1000;
        const trackOriginForVideo =
          parsedTrackBundle?.trackTimeOriginUnixMs ??
          importedSession.trackTimeOriginUnixMs;
        const pendingClipEndsByTrack = new Map<string, number>();
        const preboundVideos = videoTracks.flatMap((track, trackIndex) => {
          const videoTrackName = track.name.trim() || `Video Track ${trackIndex + 1}`;
          return track.clips.map((video) => {
            const videoWallClockStartMs = getVideoFileWallClockStartMs(
              video.file,
              video.durationMs,
            );
            const wallClockVideoOffset =
              trackOriginForVideo != null && videoWallClockStartMs != null
                ? tryComputeVideoOffsetFromWallClock(
                    { ...importedSession, trackTimeOriginUnixMs: trackOriginForVideo },
                    durationMsForVideo,
                    videoWallClockStartMs,
                  )
                : null;
            const placementSource: VideoPlacementSource =
              wallClockVideoOffset != null ? 'file-time' : 'sequential-fallback';
            const placementConfidence: VideoPlacementConfidence =
              wallClockVideoOffset != null ? 'medium' : 'low';
            const offsetMs =
              wallClockVideoOffset ??
              pendingClipEndsByTrack.get(track.id) ??
              0;
            const clipEndMs = offsetMs + Math.max(0, video.durationMs);
            pendingClipEndsByTrack.set(
              track.id,
              Math.max(pendingClipEndsByTrack.get(track.id) ?? 0, clipEndMs),
            );
            const sync: VideoSyncBinding =
              wallClockVideoOffset != null
                ? createVideoSyncBindingFromAnchor(
                    {
                      videoTimeMs: 0,
                      trackTimeMs: wallClockVideoOffset,
                      realUnixMs: videoWallClockStartMs ?? undefined,
                      source: 'auto-file-time',
                      confidence: 'medium',
                    },
                    { trackTimeOriginUnixMs: trackOriginForVideo },
                  )
                : createOffsetOnlyVideoSync(offsetMs, {
                    trackTimeOriginUnixMs: trackOriginForVideo,
                    source: 'manual-video-track',
                    confidence: 'low',
                  });

            return {
              track,
              videoTrackName,
              video,
              offsetMs,
              sync,
              placementSource,
              placementConfidence,
              promptSync: wallClockVideoOffset === null,
            };
          });
        });

        if (
          currentWorkspace &&
          (selectedSource.kind === 'workspace_file' || saveImportToWorkspace)
        ) {
          await createLocalImportedTrackSession({
            workspaceId: currentWorkspace.id,
            session: importedSession,
            sourceFile: selectedSource.file,
            source:
              selectedSource.kind === 'workspace_file'
                ? {
                    kind: 'workspace_discovery',
                    relativePath:
                      selectedSource.workspaceFile?.relativePath ??
                      `incoming/track/${selectedSource.file.name}`,
                  }
                : {
                    kind: 'external_file_picker',
                    copySourceToWorkspace: copyImportSourceToWorkspace,
                  },
            parsedTrack: parsedTrackBundle ?? undefined,
          });

          const videoBindings: WorkspaceVideoBinding[] = preboundVideos
            .filter(
              (entry) =>
                entry.video.kind === 'workspace_video' &&
                entry.video.workspaceVideo,
            )
            .map((entry) => ({
              path: `../../${entry.video.workspaceVideo!.relativePath}`,
              fileName: entry.video.file.name,
              videoTrackId: entry.track.id,
              videoTrackName: entry.videoTrackName,
              label: entry.video.workspaceVideo!.name,
              sourceKind: 'workspace_discovery',
              storageMode: 'workspace_relative_ref',
              videoType: entry.track.videoType,
              offsetMs: entry.offsetMs,
              sync: entry.sync,
              placementSource: entry.placementSource,
              placementConfidence: entry.placementConfidence,
              copiedToWorkspace: false,
              confirmed: true,
              boundAt: new Date().toISOString(),
            }));
          if (videoBindings.length > 0) {
            await saveLocalWorkspaceSessionVideoBindings(
              currentWorkspace.id,
              importedSession.id,
              videoBindings,
            );
          }

          await reloadWorkspaces();
          await refreshWorkspaceTracks();
          await refreshWorkspaceVideos();
        }

        const navigationPreboundVideos = preboundVideos.map((entry) =>
          entry.video.kind === 'workspace_video' && entry.video.workspaceVideo
            ? {
                kind: 'workspace_video' as const,
                fileName: entry.video.file.name,
                relativePath: entry.video.workspaceVideo.relativePath,
                label: entry.video.workspaceVideo.name,
                videoTrackId: entry.track.id,
                videoTrackName: entry.videoTrackName,
                videoType: entry.track.videoType,
                offsetMs: entry.offsetMs,
                sync: entry.sync,
                placementSource: entry.placementSource,
                placementConfidence: entry.placementConfidence,
                promptSync: entry.promptSync,
              }
            : {
                kind: 'local_file' as const,
                fileName: entry.video.file.name,
                file: entry.video.file,
                label: entry.video.file.name,
                videoTrackId: entry.track.id,
                videoTrackName: entry.videoTrackName,
                videoType: entry.track.videoType,
                offsetMs: entry.offsetMs,
                sync: entry.sync,
                placementSource: entry.placementSource,
                placementConfidence: entry.placementConfidence,
                promptSync: entry.promptSync,
              },
        );
        const navigationState: ReplayNavigationState | undefined =
          navigationPreboundVideos.length > 0
            ? {
                preboundVideo: navigationPreboundVideos[0],
                preboundVideos: navigationPreboundVideos,
              }
            : undefined;

        navigate(`/session/${importedSession.id}/replay`, {
          state: navigationState,
        });
        return;
      }

      const session = currentWorkspace
        ? await createLocalCanvasSession({
            workspaceId: currentWorkspace.id,
            name: sessionName,
            date,
            location,
            boatType: boat || undefined,
            projectId: project || undefined,
            canvasType,
          })
        : await sessionApi.create({
            name: sessionName,
            date,
            location,
            boatType: boat || undefined,
            projectId: project || undefined,
            source: 'manual',
            canvasType,
          });

      if (currentWorkspace) {
        await reloadWorkspaces();
      }
      navigate(`/session/${session.id}/canvas`);
    } catch (error) {
      setCreateError(
        error instanceof Error ? error.message : 'Failed to create session.',
      );
    } finally {
      setCreating(false);
    }
  };

  const canCreate =
    (name.trim().length > 0 || (mode === 'import' && selectedSource != null)) &&
    (mode === 'canvas' || parseResult?.success);
  const fieldCheck = parseResult?.fields;

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-6">
      <h2 className={`text-xl font-bold ${s.textPrimary}`}>New Session</h2>

      <Panel>
        <div className="flex flex-col gap-4">
          <div>
            <label className={`block text-sm mb-1 ${s.textSecondary}`}>
              Session Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Morning Practice"
              className={`w-full px-3 py-2 text-sm ${s.input} outline-none`}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={`block text-sm mb-1 ${s.textSecondary}`}>
                Date
              </label>
              <input
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                className={`w-full px-3 py-2 text-sm ${s.input} outline-none`}
              />
            </div>
            <div>
              <label className={`block text-sm mb-1 ${s.textSecondary}`}>
                Location
              </label>
              <input
                type="text"
                value={location}
                onChange={(event) => setLocation(event.target.value)}
                placeholder="e.g. San Francisco Bay"
                className={`w-full px-3 py-2 text-sm ${s.input} outline-none`}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={`block text-sm mb-1 ${s.textSecondary}`}>
                Boat / Team
              </label>
              <input
                type="text"
                value={boat}
                onChange={(event) => setBoat(event.target.value)}
                placeholder="e.g. J/70"
                className={`w-full px-3 py-2 text-sm ${s.input} outline-none`}
              />
            </div>
            <div>
              <label className={`block text-sm mb-1 ${s.textSecondary}`}>
                Project
              </label>
              <input
                type="text"
                value={project}
                onChange={(event) => setProject(event.target.value)}
                placeholder="e.g. Spring Training"
                className={`w-full px-3 py-2 text-sm ${s.input} outline-none`}
              />
            </div>
          </div>
        </div>
      </Panel>

      <div className={`flex gap-4 ${s.panel} p-1`}>
        <button
          type="button"
          onClick={() => setMode('import')}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm transition-all ${
            mode === 'import'
              ? `${s.accentBg} font-medium`
              : `${s.textSecondary} hover:opacity-70`
          } ${isRound ? 'rounded-xl' : 'rounded-sm'}`}
        >
          <Upload className="w-4 h-4" />
          Import Data
        </button>
        <button
          type="button"
          onClick={() => setMode('canvas')}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm transition-all ${
            mode === 'canvas'
              ? `${s.accentBg} font-medium`
              : `${s.textSecondary} hover:opacity-70`
          } ${isRound ? 'rounded-xl' : 'rounded-sm'}`}
        >
          <Pencil className="w-4 h-4" />
          Canvas Mode
        </button>
      </div>

      {mode === 'import' && (
        <Panel>
          <div className="flex flex-col gap-6">
            {currentWorkspace ? (
              <div
                className={`rounded-2xl border ${s.divider} p-4 flex flex-col gap-4`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Database className={`w-4 h-4 ${s.accent}`} />
                      <p className={`text-sm font-semibold ${s.textPrimary}`}>
                        Use a track from "{currentWorkspace.name}"
                      </p>
                    </div>
                    <p className={`mt-1 text-xs ${s.textSecondary}`}>
                      Select files already in incoming/track without reopening the OS file picker.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void refreshWorkspaceTracks()}
                    className={`inline-flex items-center gap-2 px-3 py-2 text-xs ${s.buttonSecondary}`}
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Reload
                  </button>
                </div>

                {workspaceTrackError ? (
                  <div className="flex items-start gap-2 text-xs text-red-500">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{workspaceTrackError}</span>
                  </div>
                ) : null}

                {workspaceTrackFiles.length === 0 ? (
                  <p className={`text-sm ${s.textSecondary}`}>
                    No workspace track files found in incoming/track.
                  </p>
                ) : (
                  <div className="grid gap-2">
                    {workspaceTrackFiles.map((workspaceFile) => {
                      const isSelected =
                        selectedSource?.kind === 'workspace_file' &&
                        selectedSource.workspaceFile?.relativePath ===
                          workspaceFile.relativePath;
                      return (
                        <button
                          key={workspaceFile.relativePath}
                          type="button"
                          onClick={() => void handleSelectWorkspaceTrack(workspaceFile)}
                          className={`flex items-center justify-between gap-3 px-3 py-3 text-left transition-all ${
                            isSelected ? `${s.accentBg}` : s.buttonSecondary
                          } ${isRound ? 'rounded-xl' : 'rounded-sm'}`}
                        >
                          <div className="min-w-0">
                            <div className={`truncate text-sm font-medium ${s.textPrimary}`}>
                              {workspaceFile.name}
                            </div>
                            <div className={`text-xs ${s.textSecondary}`}>
                              {workspaceFile.relativePath}
                            </div>
                          </div>
                          <div className={`shrink-0 text-right text-xs ${s.textSecondary}`}>
                            <div>{formatFileSize(workspaceFile.size)}</div>
                            <div>{formatDateTime(workspaceFile.updatedAt)}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <div
                className={`rounded-2xl border ${s.divider} p-4 text-sm ${s.textSecondary}`}
              >
                No current workspace selected. Local file imports will use the existing
                remote import flow, and no session bundle will be saved to workspace.
              </div>
            )}

            <div
              onDragOver={(event) => {
                event.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              className={`border-2 border-dashed p-8 text-center transition-colors ${
                dragOver ? `${s.accent} border-current` : `${s.divider} border-current/20`
              } ${isRound ? 'rounded-2xl' : 'rounded-sm'}`}
            >
              {selectedSource?.kind === 'local_file' ? (
                <div className="flex flex-col items-center gap-2">
                  <FileText className={`w-8 h-8 ${s.accent}`} />
                  <span className={`text-sm font-medium ${s.textPrimary}`}>
                    {selectedSource.file.name}
                  </span>
                  <span className={`text-xs ${s.textSecondary}`}>Local file picker source</span>
                  <button
                    type="button"
                    onClick={resetSelectedSource}
                    className={`text-xs ${s.textSecondary} hover:opacity-70 flex items-center gap-1`}
                  >
                    <X className="w-3 h-3" /> Remove
                  </button>
                </div>
              ) : selectedSource?.kind === 'workspace_file' ? (
                <div className="flex flex-col items-center gap-2">
                  <Database className={`w-8 h-8 ${s.accent}`} />
                  <span className={`text-sm font-medium ${s.textPrimary}`}>
                    {selectedSource.file.name}
                  </span>
                  <span className={`text-xs ${s.textSecondary}`}>
                    Bound from {selectedSource.workspaceFile?.relativePath ?? 'incoming/track'}
                  </span>
                  <button
                    type="button"
                    onClick={resetSelectedSource}
                    className={`text-xs ${s.textSecondary} hover:opacity-70 flex items-center gap-1`}
                  >
                    <X className="w-3 h-3" /> Remove
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <Upload className={`w-10 h-10 ${s.textSecondary} opacity-50`} />
                  <p className={`text-sm ${s.textSecondary}`}>
                    Drag & drop your <strong>.gpx</strong>, <strong>.ubx</strong>, <strong>.ldc</strong>, <strong>.bin</strong>, or <strong>.csv</strong> file here
                  </p>
                  <p className={`text-xs ${s.textSecondary}`}>
                    Supports workspace files and direct local files. Workspace is optional,
                    not a replacement for the old import path.
                  </p>
                  <label
                    className={`inline-flex items-center gap-2 px-4 py-2 text-sm cursor-pointer ${s.buttonSecondary}`}
                  >
                    <Upload className="w-4 h-4" />
                    Browse Local File
                    <input
                      type="file"
                      accept=".gpx,.ubx,.ldc,.bin,.csv,.tsv,.txt"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) {
                          void previewTrackSource(file, 'local_file');
                        }
                        event.target.value = '';
                      }}
                    />
                  </label>
                </div>
              )}
            </div>

            {currentWorkspace && selectedSource?.kind === 'local_file' ? (
              <div className={`rounded-2xl border ${s.divider} p-4 flex flex-col gap-3`}>
                <p className={`text-sm font-semibold ${s.textPrimary}`}>
                  Workspace save options
                </p>
                <label className={`flex items-start gap-3 text-sm ${s.textSecondary}`}>
                  <input
                    type="checkbox"
                    checked={saveImportToWorkspace}
                    onChange={(event) => {
                      const nextChecked = event.target.checked;
                      setSaveImportToWorkspace(nextChecked);
                      if (!nextChecked) {
                        setCopyImportSourceToWorkspace(false);
                      } else {
                        setCopyImportSourceToWorkspace(true);
                      }
                    }}
                    className="mt-1 h-4 w-4"
                  />
                  <span>
                    Save this imported session into workspace "{currentWorkspace.name}".
                  </span>
                </label>
                <label
                  className={`flex items-start gap-3 text-sm ${
                    saveImportToWorkspace ? s.textSecondary : 'opacity-50'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={copyImportSourceToWorkspace}
                    disabled={!saveImportToWorkspace}
                    onChange={(event) =>
                      setCopyImportSourceToWorkspace(event.target.checked)
                    }
                    className="mt-1 h-4 w-4"
                  />
                  <span>
                    Copy the source track file into incoming/track and bind this
                    session to the workspace copy.
                  </span>
                </label>
              </div>
            ) : null}

            {selectedSource ? (
              <div className={`rounded-2xl border ${s.divider} p-4 flex flex-col gap-4`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Film className={`w-4 h-4 ${s.accent}`} />
                      <p className={`text-sm font-semibold ${s.textPrimary}`}>
                        Video (optional)
                      </p>
                    </div>
                    <p className={`mt-1 text-xs ${s.textSecondary}`}>
                      Pre-bind one or more clips to a video track, then fine-tune sync in Replay.
                    </p>
                  </div>
                  {currentWorkspace ? (
                    <button
                      type="button"
                      onClick={() => void refreshWorkspaceVideos()}
                      className={`inline-flex items-center gap-2 px-3 py-2 text-xs ${s.buttonSecondary}`}
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Reload Videos
                    </button>
                  ) : null}
                </div>

                <div className="flex items-center justify-between gap-3">
                  <p className={`text-xs uppercase tracking-wider ${s.textSecondary}`}>
                    Video Tracks
                  </p>
                  <button
                    type="button"
                    onClick={handleAddVideoTrack}
                    className={`inline-flex items-center gap-2 px-3 py-2 text-xs ${s.buttonSecondary}`}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    New Track
                  </button>
                </div>

                {videoTracks.length === 0 ? (
                  <div className={`border ${s.divider} px-3 py-4 text-sm ${s.textSecondary} ${
                    isRound ? 'rounded-xl' : 'rounded-sm'
                  }`}>
                    No video tracks selected.
                  </div>
                ) : (
                  <div className="grid gap-3">
                    {videoTracks.map((track, trackIndex) => {
                      const isExpanded = expandedVideoTrackId === track.id;
                      const trackName = track.name.trim() || `Video Track ${trackIndex + 1}`;
                      return (
                        <div
                          key={track.id}
                          className={`border ${s.divider} ${
                            isRound ? 'rounded-xl' : 'rounded-sm'
                          }`}
                        >
                          <div className="flex items-center gap-2 p-3">
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedVideoTrackId((prev) =>
                                  prev === track.id ? null : track.id,
                                )
                              }
                              className="flex min-w-0 flex-1 items-center gap-3 text-left"
                            >
                              {isExpanded ? (
                                <ChevronDown className={`h-4 w-4 shrink-0 ${s.textSecondary}`} />
                              ) : (
                                <ChevronRight className={`h-4 w-4 shrink-0 ${s.textSecondary}`} />
                              )}
                              <div className="min-w-0">
                                <div className={`truncate text-sm font-semibold ${s.textPrimary}`}>
                                  {trackName}
                                </div>
                                <div className={`text-xs ${s.textSecondary}`}>
                                  {track.videoType === '360' ? '360 video' : 'Flat video'} -{' '}
                                  {track.clips.length} clip{track.clips.length === 1 ? '' : 's'}
                                </div>
                              </div>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveVideoTrack(track.id)}
                              className={`shrink-0 text-xs ${s.textSecondary} hover:opacity-70 flex items-center gap-1`}
                            >
                              <X className="w-3 h-3" />
                              Remove
                            </button>
                          </div>

                          {isExpanded ? (
                            <div className={`border-t ${s.divider} p-3 flex flex-col gap-4`}>
                              <div className="grid gap-3 md:grid-cols-2">
                                <div className="flex flex-col gap-2">
                                  <label className={`text-xs uppercase tracking-wider ${s.textSecondary}`}>
                                    Track Name
                                  </label>
                                  <input
                                    type="text"
                                    value={track.name}
                                    onChange={(event) =>
                                      updateVideoTrack(track.id, { name: event.target.value })
                                    }
                                    placeholder={`Video Track ${trackIndex + 1}`}
                                    className={`w-full px-3 py-2 text-sm rounded-lg ${s.input}`}
                                  />
                                </div>
                                <div className="flex flex-col gap-2">
                                  <label className={`text-xs uppercase tracking-wider ${s.textSecondary}`}>
                                    Video Type
                                  </label>
                                  <select
                                    value={track.videoType}
                                    onChange={(event) =>
                                      updateVideoTrack(track.id, {
                                        videoType: event.target.value as VideoType,
                                      })
                                    }
                                    className={`w-full px-3 py-2 text-sm rounded-lg ${s.input}`}
                                  >
                                    <option value="flat">Flat video</option>
                                    <option value="360">360 video</option>
                                  </select>
                                </div>
                              </div>

                              {track.clips.length > 0 ? (
                                <div className="flex flex-col gap-2">
                                  <div className="flex items-center justify-between gap-3">
                                    <p className={`text-xs uppercase tracking-wider ${s.textSecondary}`}>
                                      Clips
                                    </p>
                                    <span className={`text-xs ${s.textSecondary}`}>
                                      {track.clips.length} clip{track.clips.length === 1 ? '' : 's'}
                                    </span>
                                  </div>
                                  <div className="grid gap-2 max-h-56 overflow-y-auto">
                                    {track.clips.map((video) => {
                                      const videoKey = getSelectedVideoKey(video);
                                      return (
                                        <div
                                          key={videoKey}
                                          className={`flex items-start justify-between gap-3 ${s.accentBg} px-3 py-2 ${
                                            isRound ? 'rounded-xl' : 'rounded-sm'
                                          }`}
                                        >
                                          <div className="min-w-0">
                                            <div className={`truncate text-sm font-semibold ${s.textPrimary}`}>
                                              {video.workspaceVideo?.name ?? video.file.name}
                                            </div>
                                            <div className={`mt-1 text-xs ${s.textSecondary}`}>
                                              {video.kind === 'workspace_video'
                                                ? `Workspace video - ${video.workspaceVideo?.relativePath}`
                                                : 'Local file - prebound for this Replay navigation'}
                                            </div>
                                            <div className={`mt-1 text-xs ${s.textSecondary}`}>
                                              {formatVideoDurationMs(video.durationMs)} -{' '}
                                              {formatFileSize(video.file.size)}
                                            </div>
                                          </div>
                                          <button
                                            type="button"
                                            onClick={() => removeVideoFromTrack(track.id, videoKey)}
                                            className={`shrink-0 text-xs ${s.textSecondary} hover:opacity-70 flex items-center gap-1`}
                                          >
                                            <X className="w-3 h-3" />
                                            Remove
                                          </button>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              ) : null}

                              {currentWorkspace ? (
                                <div className="grid gap-3">
                                  {workspaceVideoError ? (
                                    <div className="flex items-start gap-2 text-xs text-red-500">
                                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                      <span>{workspaceVideoError}</span>
                                    </div>
                                  ) : null}

                                  {recommendedWorkspaceVideos.length > 0 ? (
                                    <div className="flex flex-col gap-2">
                                      <p className={`text-xs uppercase tracking-wider ${s.textSecondary}`}>
                                        Recommended Workspace Videos
                                      </p>
                                      <div className="grid gap-2">
                                        {recommendedWorkspaceVideos.map((video) => {
                                          const containingTrack = videoTracks.find((candidate) =>
                                            candidate.clips.some(
                                              (entry) =>
                                                entry.kind === 'workspace_video' &&
                                                entry.workspaceVideo?.relativePath === video.relativePath,
                                            ),
                                          );
                                          const isSelected = containingTrack?.id === track.id;
                                          return (
                                            <button
                                              key={video.relativePath}
                                              type="button"
                                              onClick={() => void handleSelectWorkspaceVideo(video, track.id)}
                                              className={`flex items-center justify-between gap-3 px-3 py-3 text-left transition-all ${
                                                isSelected ? `${s.accentBg}` : s.buttonSecondary
                                              } ${isRound ? 'rounded-xl' : 'rounded-sm'}`}
                                            >
                                              <div className="min-w-0">
                                                <div className={`truncate text-sm font-medium ${s.textPrimary}`}>
                                                  {video.name}
                                                </div>
                                                <div className={`text-xs ${s.textSecondary}`}>
                                                  {video.relativePath}
                                                </div>
                                              </div>
                                              <span className={`shrink-0 text-xs ${s.textSecondary}`}>
                                                {isSelected
                                                  ? 'Added'
                                                  : containingTrack
                                                    ? 'Move Here'
                                                    : 'Add Clip'}
                                              </span>
                                            </button>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  ) : null}

                                  {additionalWorkspaceVideos.length > 0 ? (
                                    <div className="flex flex-col gap-2">
                                      <p className={`text-xs uppercase tracking-wider ${s.textSecondary}`}>
                                        Other Workspace Videos
                                      </p>
                                      <div className="grid gap-2 max-h-48 overflow-y-auto">
                                        {additionalWorkspaceVideos.map((video) => {
                                          const containingTrack = videoTracks.find((candidate) =>
                                            candidate.clips.some(
                                              (entry) =>
                                                entry.kind === 'workspace_video' &&
                                                entry.workspaceVideo?.relativePath === video.relativePath,
                                            ),
                                          );
                                          const isSelected = containingTrack?.id === track.id;
                                          return (
                                            <button
                                              key={video.relativePath}
                                              type="button"
                                              onClick={() => void handleSelectWorkspaceVideo(video, track.id)}
                                              className={`flex items-center justify-between gap-3 px-3 py-3 text-left transition-all ${
                                                isSelected ? `${s.accentBg}` : s.buttonSecondary
                                              } ${isRound ? 'rounded-xl' : 'rounded-sm'}`}
                                            >
                                              <div className="min-w-0">
                                                <div className={`truncate text-sm font-medium ${s.textPrimary}`}>
                                                  {video.name}
                                                </div>
                                                <div className={`text-xs ${s.textSecondary}`}>
                                                  {video.relativePath}
                                                </div>
                                              </div>
                                              <span className={`shrink-0 text-xs ${s.textSecondary}`}>
                                                {isSelected
                                                  ? 'Added'
                                                  : containingTrack
                                                    ? 'Move Here'
                                                    : video.collection === 'incoming'
                                                      ? 'Incoming'
                                                      : 'Library'}
                                              </span>
                                            </button>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  ) : workspaceVideoFiles.length === 0 ? (
                                    <p className={`text-sm ${s.textSecondary}`}>
                                      No workspace videos found in incoming/video or library/video.
                                    </p>
                                  ) : null}
                                </div>
                              ) : null}

                              <div className="flex flex-col gap-2">
                                <p className={`text-xs uppercase tracking-wider ${s.textSecondary}`}>
                                  Local Video Files
                                </p>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setVideoFilePickerTrackId(track.id);
                                    videoInputRef.current?.click();
                                  }}
                                  className={`inline-flex items-center justify-center gap-2 px-4 py-2 text-sm ${s.buttonSecondary}`}
                                >
                                  <Upload className="w-4 h-4" />
                                  {track.clips.some((video) => video.kind === 'local_file')
                                    ? 'Add Local Videos'
                                    : 'Choose Local Videos'}
                                </button>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}

                {videoSelectionError ? (
                  <div className="flex items-start gap-2 text-xs text-red-500">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{videoSelectionError}</span>
                  </div>
                ) : null}

                <input
                  ref={videoInputRef}
                  type="file"
                  accept="video/*"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    const files = Array.from(event.target.files ?? []);
                    const trackId = videoFilePickerTrackId ?? expandedVideoTrackId;
                    if (files.length > 0 && trackId) {
                      void handlePickLocalVideo(files, trackId);
                    } else if (files.length > 0) {
                      setVideoSelectionError('Create or expand a video track before adding clips.');
                    }
                    setVideoFilePickerTrackId(null);
                    event.currentTarget.value = '';
                  }}
                />
              </div>
            ) : null}

            {parsing && (
              <div className="text-center">
                <div className={`${s.skeleton} h-6 w-48 mx-auto`} />
              </div>
            )}

            {parseError && !parsing && (
              <div className="flex items-start gap-2 text-sm text-red-500">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{parseError}</span>
              </div>
            )}

            {parseResult && !parsing && (
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  {parseResult.success ? (
                    <CheckCircle className="w-5 h-5 text-green-500" />
                  ) : (
                    <AlertTriangle className="w-5 h-5 text-red-500" />
                  )}
                  <span className={`text-sm font-medium ${s.textPrimary}`}>
                    {parseResult.success
                      ? `Parsed ${parseResult.pointCount} points (${Math.round(parseResult.duration / 60)} min)`
                      : 'Parse failed'}
                  </span>
                </div>

                {fieldCheck && (
                  <div className="grid grid-cols-3 gap-2">
                    {(Object.entries(fieldCheck) as [string, boolean][]).map(
                      ([key, ok]) => (
                        <div
                          key={key}
                          className={`flex items-center gap-2 text-xs p-2 ${
                            ok ? 'text-green-500' : 'text-yellow-500'
                          } ${s.accentBg}`}
                        >
                          {ok ? (
                            <CheckCircle className="w-3.5 h-3.5" />
                          ) : (
                            <AlertTriangle className="w-3.5 h-3.5" />
                          )}
                          <span className="capitalize">{key}</span>
                        </div>
                      ),
                    )}
                  </div>
                )}

                {parseResult.warnings.map((warning, index) => (
                  <div
                    key={`${warning}:${index}`}
                    className={`flex items-start gap-2 text-xs p-2 text-yellow-600 ${s.accentBg}`}
                  >
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    {warning}
                  </div>
                ))}

                {parseResult.previewPoints.length > 0 && (
                  <div className={`h-32 ${s.mapBg} flex items-center justify-center`}>
                    <svg viewBox="0 0 100 100" className="w-full h-full p-4">
                      <polyline
                        points={parseResult.previewPoints
                          .map((point, _i, arr) => {
                            const lats = arr.map((entry) => entry.lat);
                            const lons = arr.map((entry) => entry.lon);
                            const minLat = Math.min(...lats);
                            const maxLat = Math.max(...lats);
                            const minLon = Math.min(...lons);
                            const maxLon = Math.max(...lons);
                            const x =
                              ((point.lon - minLon) / (maxLon - minLon || 1)) * 80 +
                              10;
                            const y =
                              ((maxLat - point.lat) / (maxLat - minLat || 1)) * 80 +
                              10;
                            return `${x},${y}`;
                          })
                          .join(' ')}
                        fill="none"
                        stroke={s.routeColor}
                        strokeWidth="2"
                      />
                    </svg>
                  </div>
                )}
              </div>
            )}
          </div>
        </Panel>
      )}

      {mode === 'canvas' && (
        <Panel>
          <div className="flex flex-col gap-4 py-2">
            <div className="flex items-start gap-4">
              <Pencil className={`w-8 h-8 shrink-0 mt-0.5 ${s.accent}`} />
              <div>
                <p className={`text-sm font-semibold mb-1 ${s.textPrimary}`}>
                  Manual Canvas Mode
                </p>
                <p className={`text-sm ${s.textSecondary}`}>
                  Draw your course and place marks directly on the canvas. No GPS file needed.
                </p>
              </div>
            </div>
            <div className={`text-xs ${s.textSecondary}`}>
              {currentWorkspace
                ? `Canvas sessions will be saved into workspace "${currentWorkspace.name}".`
                : 'No current workspace selected. Canvas mode will fall back to the remote session API until a workspace is selected.'}
            </div>
            <div className={`grid grid-cols-2 gap-3 pt-2 border-t ${s.divider}`}>
              <button
                type="button"
                onClick={() => setCanvasType('worldmap')}
                className={`p-3 text-left rounded-lg border-2 transition-all ${
                  canvasType === 'worldmap'
                    ? `${s.accentBg} border-current ${s.accent}`
                    : `${s.accentBg} border-transparent hover:opacity-80`
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <MapIcon
                    className={`w-4 h-4 ${
                      canvasType === 'worldmap' ? s.accent : s.textSecondary
                    }`}
                  />
                  <p className={`text-xs font-semibold ${s.textPrimary}`}>World Map</p>
                </div>
                <p className={`text-xs ${s.textSecondary}`}>
                  Draw on a real map (OSM or satellite tiles).
                </p>
              </button>
              <button
                type="button"
                onClick={() => setCanvasType('blank')}
                className={`p-3 text-left rounded-lg border-2 transition-all ${
                  canvasType === 'blank'
                    ? `${s.accentBg} border-current ${s.accent}`
                    : `${s.accentBg} border-transparent hover:opacity-80`
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Grid
                    className={`w-4 h-4 ${
                      canvasType === 'blank' ? s.accent : s.textSecondary
                    }`}
                  />
                  <p className={`text-xs font-semibold ${s.textPrimary}`}>Blank Canvas</p>
                </div>
                <p className={`text-xs ${s.textSecondary}`}>
                  Draw on a clean tactical board for abstract courses.
                </p>
              </button>
            </div>
          </div>
        </Panel>
      )}

      {createError ? (
        <div className="flex items-start gap-2 text-sm text-red-500">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{createError}</span>
        </div>
      ) : null}

      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={() => navigate('/')}
          className={`px-5 py-2 text-sm ${s.buttonSecondary}`}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void handleCreate()}
          disabled={!canCreate || creating}
          className={`px-5 py-2 text-sm ${s.buttonPrimary} ${
            !canCreate ? 'opacity-40 cursor-not-allowed' : ''
          }`}
        >
          {creating ? 'Creating...' : 'Create Session'}
        </button>
      </div>
    </div>
  );
}
