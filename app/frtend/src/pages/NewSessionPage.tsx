import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle,
  Database,
  FileText,
  Film,
  Grid,
  Map as MapIcon,
  Pencil,
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
import type { ParseResult, VideoSyncBinding, VideoType } from '@/types/models';
import { tryComputeVideoOffsetFromWallClock } from '@/utils/videoAutoOffset';
import { detectVideoTypeFromFile } from '@/utils/videoTypeDetection';
import {
  createOffsetOnlyVideoSync,
  createVideoSyncBindingFromAnchor,
} from '@/utils/videoSync';
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
  videoType: VideoType;
  workspaceVideo?: WorkspaceVideoFileSummary;
}

const SUPPORTED_IMPORT_EXTENSIONS = new Set(['gpx', 'ubx', 'bin']);
const SUPPORTED_IMPORT_LABEL = '.gpx, .ubx, .bin';

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
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
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

function getBaseName(fileName: string): string {
  const trimmed = fileName.trim();
  const dotIndex = trimmed.lastIndexOf('.');
  const baseName = dotIndex > 0 ? trimmed.slice(0, dotIndex) : trimmed;
  return baseName.toLowerCase().replace(/[\s_-]+/g, '');
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
  const [selectedVideo, setSelectedVideo] = useState<SelectedVideoSource | null>(null);
  const [videoSelectionError, setVideoSelectionError] = useState<string | null>(null);
  const [videoType, setVideoType] = useState<VideoType>('flat');
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
    setSelectedVideo(null);
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

  const handleSelectWorkspaceVideo = async (workspaceVideo: WorkspaceVideoFileSummary) => {
    if (!currentWorkspace) return;
    setVideoSelectionError(null);
    try {
      const file = await loadLocalWorkspaceVideoFile(
        currentWorkspace.id,
        workspaceVideo.relativePath,
      );
      const detected = await detectVideoTypeFromFile(file);
      setVideoType(detected.videoType);
      setSelectedVideo({
        kind: 'workspace_video',
        file,
        workspaceVideo,
        videoType: detected.videoType,
      });
    } catch (error) {
      setVideoSelectionError(
        error instanceof Error
          ? error.message
          : 'Failed to load the selected workspace video.',
      );
    }
  };

  const handlePickLocalVideo = useCallback(
    async (file: File) => {
      setVideoSelectionError(null);
      try {
        const detected = await detectVideoTypeFromFile(file);
        setVideoType(detected.videoType);
        setSelectedVideo({
          kind: 'local_file',
          file,
          videoType: detected.videoType,
        });
      } catch (error) {
        setVideoSelectionError(
          error instanceof Error ? error.message : 'Failed to inspect the selected video.',
        );
      }
    },
    [],
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

  useEffect(() => {
    if (!selectedVideo) return;
    setSelectedVideo((prev) => (prev ? { ...prev, videoType } : prev));
  }, [videoType]);

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
        const wallClockVideoOffset =
          selectedVideo && trackOriginForVideo != null
            ? tryComputeVideoOffsetFromWallClock(
                { ...importedSession, trackTimeOriginUnixMs: trackOriginForVideo },
                durationMsForVideo,
                selectedVideo.file.lastModified,
              )
            : null;
        const resolvedPreboundVideoOffsetMs = wallClockVideoOffset ?? 0;
        const resolvedPreboundVideoSync: VideoSyncBinding = wallClockVideoOffset != null
          ? createVideoSyncBindingFromAnchor(
              {
                videoTimeMs: 0,
                trackTimeMs: wallClockVideoOffset,
                realUnixMs: selectedVideo?.file.lastModified,
                source: 'auto-file-time',
                confidence: 'medium',
              },
              { trackTimeOriginUnixMs: trackOriginForVideo },
            )
          : createOffsetOnlyVideoSync(resolvedPreboundVideoOffsetMs, {
              trackTimeOriginUnixMs: trackOriginForVideo,
              source: 'manual-video-track',
              confidence: 'low',
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

          if (selectedVideo?.kind === 'workspace_video' && selectedVideo.workspaceVideo) {
            const videoBinding: WorkspaceVideoBinding = {
              path: `../../${selectedVideo.workspaceVideo.relativePath}`,
              fileName: selectedVideo.file.name,
              label: selectedVideo.workspaceVideo.name,
              sourceKind: 'workspace_discovery',
              storageMode: 'workspace_relative_ref',
              videoType: selectedVideo.videoType,
              offsetMs: resolvedPreboundVideoOffsetMs,
              sync: resolvedPreboundVideoSync,
              copiedToWorkspace: false,
              confirmed: true,
              boundAt: new Date().toISOString(),
            };
            await saveLocalWorkspaceSessionVideoBindings(currentWorkspace.id, importedSession.id, [
              videoBinding,
            ]);
          }

          await reloadWorkspaces();
          await refreshWorkspaceTracks();
          await refreshWorkspaceVideos();
        }

        const navigationState: ReplayNavigationState | undefined = selectedVideo
          ? {
              preboundVideo:
                selectedVideo.kind === 'workspace_video' && selectedVideo.workspaceVideo
                  ? {
                      kind: 'workspace_video',
                      fileName: selectedVideo.file.name,
                      relativePath: selectedVideo.workspaceVideo.relativePath,
                      label: selectedVideo.workspaceVideo.name,
                      videoType: selectedVideo.videoType,
                      offsetMs: resolvedPreboundVideoOffsetMs,
                      sync: resolvedPreboundVideoSync,
                      promptSync: wallClockVideoOffset === null,
                    }
                  : {
                      kind: 'local_file',
                      fileName: selectedVideo.file.name,
                      file: selectedVideo.file,
                      label: selectedVideo.file.name,
                      videoType: selectedVideo.videoType,
                      offsetMs: resolvedPreboundVideoOffsetMs,
                      sync: resolvedPreboundVideoSync,
                      promptSync: wallClockVideoOffset === null,
                    },
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
                    Drag & drop your <strong>.gpx</strong>, <strong>.ubx</strong>, or <strong>.bin</strong> file here
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
                      accept=".gpx,.ubx,.bin"
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
                      Pre-bind a video now, then fine-tune sync in Replay.
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

                <div className="flex flex-col gap-2">
                  <label className={`text-xs uppercase tracking-wider ${s.textSecondary}`}>
                    Video Type
                  </label>
                  <select
                    value={videoType}
                    onChange={(event) => setVideoType(event.target.value as VideoType)}
                    className={`w-full px-3 py-2 text-sm rounded-lg ${s.input}`}
                  >
                    <option value="flat">Flat video</option>
                    <option value="360">360 video</option>
                  </select>
                </div>

                {selectedVideo ? (
                  <div className={`rounded-xl ${s.accentBg} p-3 flex items-start justify-between gap-3`}>
                    <div className="min-w-0">
                      <div className={`truncate text-sm font-semibold ${s.textPrimary}`}>
                        {selectedVideo.workspaceVideo?.name ?? selectedVideo.file.name}
                      </div>
                      <div className={`mt-1 text-xs ${s.textSecondary}`}>
                        {selectedVideo.kind === 'workspace_video'
                          ? `Workspace video · ${selectedVideo.workspaceVideo?.relativePath}`
                          : 'Local file · Prebound for Replay only'}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedVideo(null)}
                      className={`text-xs ${s.textSecondary} hover:opacity-70 flex items-center gap-1`}
                    >
                      <X className="w-3 h-3" />
                      Remove
                    </button>
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
                          {recommendedWorkspaceVideos.map((video) => (
                            <button
                              key={video.relativePath}
                              type="button"
                              onClick={() => void handleSelectWorkspaceVideo(video)}
                              className={`flex items-center justify-between gap-3 px-3 py-3 text-left transition-all ${
                                selectedVideo?.kind === 'workspace_video' &&
                                selectedVideo.workspaceVideo?.relativePath === video.relativePath
                                  ? `${s.accentBg}`
                                  : s.buttonSecondary
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
                              <span className={`shrink-0 text-xs ${s.textSecondary}`}>Recommended</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {additionalWorkspaceVideos.length > 0 ? (
                      <div className="flex flex-col gap-2">
                        <p className={`text-xs uppercase tracking-wider ${s.textSecondary}`}>
                          Other Workspace Videos
                        </p>
                        <div className="grid gap-2 max-h-48 overflow-y-auto">
                          {additionalWorkspaceVideos.map((video) => (
                            <button
                              key={video.relativePath}
                              type="button"
                              onClick={() => void handleSelectWorkspaceVideo(video)}
                              className={`flex items-center justify-between gap-3 px-3 py-3 text-left transition-all ${
                                selectedVideo?.kind === 'workspace_video' &&
                                selectedVideo.workspaceVideo?.relativePath === video.relativePath
                                  ? `${s.accentBg}`
                                  : s.buttonSecondary
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
                                {video.collection === 'incoming' ? 'Incoming' : 'Library'}
                              </span>
                            </button>
                          ))}
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
                    Local Video File
                  </p>
                  <button
                    type="button"
                    onClick={() => videoInputRef.current?.click()}
                    className={`inline-flex items-center justify-center gap-2 px-4 py-2 text-sm ${s.buttonSecondary}`}
                  >
                    <Upload className="w-4 h-4" />
                    {selectedVideo?.kind === 'local_file' ? 'Replace Local Video' : 'Choose Local Video'}
                  </button>
                  <p className={`text-xs ${s.textSecondary}`}>
                    Local file prebinding carries into Replay for this navigation. Use workspace
                    videos for a more stable local-first path.
                  </p>
                </div>

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
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      void handlePickLocalVideo(file);
                    }
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
