import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Viewer } from '@photo-sphere-viewer/core';
import { EquirectangularVideoAdapter } from '@photo-sphere-viewer/equirectangular-video-adapter';
import { VideoPlugin } from '@photo-sphere-viewer/video-plugin';
import { clamp } from '@/utils/formatters';
import type { ManagedVideoStageProps } from './videoStageTypes';
import '@photo-sphere-viewer/core/index.css';
import '@photo-sphere-viewer/video-plugin/index.css';

const IMMEDIATE_SEEK_THRESHOLD_MS = 60;
const SOFT_SYNC_THRESHOLD_MS = 220;
const MEDIUM_SYNC_THRESHOLD_MS = 500;
const HARD_SYNC_THRESHOLD_MS = 1200;
const WAITING_OVERLAY_DELAY_MS = 250;

function getPanoramaErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'Unable to load this 360-degree video.';
}

function getMediaErrorMessage(video: HTMLVideoElement): string {
  const detail = `readyState ${video.readyState}, networkState ${video.networkState}`;

  switch (video.error?.code) {
    case MediaError.MEDIA_ERR_ABORTED:
      return `360-degree video loading was aborted (${detail}).`;
    case MediaError.MEDIA_ERR_NETWORK:
      return `360-degree video failed because of a network or file access error (${detail}).`;
    case MediaError.MEDIA_ERR_DECODE:
      return `360-degree video could not be decoded by this browser (${detail}).`;
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return `360-degree video format is not supported or the file is not directly playable (${detail}).`;
    default:
      return `Unable to load this 360-degree video source (${detail}).`;
  }
}

function getAdjustedPlaybackRate(baseRate: number, driftMs: number): number {
  const driftAbs = Math.abs(driftMs);

  if (driftAbs < SOFT_SYNC_THRESHOLD_MS) return baseRate;

  if (driftAbs < MEDIUM_SYNC_THRESHOLD_MS) {
    return driftMs > 0 ? baseRate * 1.04 : baseRate * 0.96;
  }

  return driftMs > 0 ? baseRate * 1.08 : baseRate * 0.92;
}

export default function PanoramaVideoStage({
  sourceUrl,
  mediaLabel,
  targetTimeMs,
  isPlaying,
  playbackSpeed,
  crossOrigin,
  className = '',
  overlay,
  onClockChange,
  onDurationChange,
  onReadyChange,
  onErrorChange,
}: ManagedVideoStageProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rafRef = useRef<number>(0);
  const waitingTimerRef = useRef<number | null>(null);
  const onClockChangeRef = useRef(onClockChange);
  const onDurationChangeRef = useRef(onDurationChange);
  const onReadyChangeRef = useRef(onReadyChange);
  const onErrorChangeRef = useRef(onErrorChange);
  const [isReady, setIsReady] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasEnded, setHasEnded] = useState(false);
  const durationMsRef = useRef(0);

  const targetSeconds = clamp(
    targetTimeMs / 1000,
    0,
    durationMsRef.current > 0 ? durationMsRef.current / 1000 : Number.MAX_SAFE_INTEGER,
  );

  const clearWaitingOverlayTimer = () => {
    if (waitingTimerRef.current !== null) {
      window.clearTimeout(waitingTimerRef.current);
      waitingTimerRef.current = null;
    }
  };

  const hideLoadingOverlay = () => {
    clearWaitingOverlayTimer();
    setIsLoading(false);
  };

  const scheduleWaitingOverlay = () => {
    clearWaitingOverlayTimer();
    waitingTimerRef.current = window.setTimeout(() => {
      setIsLoading(true);
      waitingTimerRef.current = null;
    }, WAITING_OVERLAY_DELAY_MS);
  };

  useEffect(() => {
    onClockChangeRef.current = onClockChange;
    onDurationChangeRef.current = onDurationChange;
    onReadyChangeRef.current = onReadyChange;
    onErrorChangeRef.current = onErrorChange;
  }, [onClockChange, onDurationChange, onErrorChange, onReadyChange]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    let isMounted = true;
    let viewer: Viewer | null = null;
    let startViewerTimer: number | null = null;

    const video = document.createElement('video');
    video.src = sourceUrl;
    video.preload = 'auto';
    video.playsInline = true;
    if (crossOrigin) video.crossOrigin = crossOrigin;
    videoRef.current = video;

    setIsLoading(true);
    setIsReady(false);
    setErrorMessage(null);
    setHasEnded(false);
    clearWaitingOverlayTimer();
    onReadyChangeRef.current?.(false);
    onErrorChangeRef.current?.(null);

    const handleLoadedMetadata = () => {
      durationMsRef.current = Number.isFinite(video.duration) ? video.duration * 1000 : 0;
      onDurationChangeRef.current?.(durationMsRef.current);
      setHasEnded(false);
      hideLoadingOverlay();
    };
    const handleCanPlay = () => {
      if (!isMounted) return;
      setIsReady(true);
      hideLoadingOverlay();
      onReadyChangeRef.current?.(true);
      onErrorChangeRef.current?.(null);
    };
    const handleWaiting = () => {
      if (isMounted) scheduleWaitingOverlay();
    };
    const handlePlaying = () => {
      if (isMounted) {
        hideLoadingOverlay();
        if (durationMsRef.current <= 0 || video.currentTime * 1000 < durationMsRef.current - 80) {
          setHasEnded(false);
        }
      }
    };
    const handleEnded = () => {
      if (!isMounted) return;
      setHasEnded(true);
      onClockChangeRef.current?.(durationMsRef.current);
    };
    const handleError = () => {
      if (!isMounted) return;
      const nextMessage = getMediaErrorMessage(video);
      setErrorMessage(nextMessage);
      hideLoadingOverlay();
      setIsReady(false);
      onReadyChangeRef.current?.(false);
      onErrorChangeRef.current?.(nextMessage);
    };

    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('canplay', handleCanPlay);
    video.addEventListener('waiting', handleWaiting);
    video.addEventListener('playing', handlePlaying);
    video.addEventListener('ended', handleEnded);
    video.addEventListener('error', handleError);

    const viewerContainer = containerRef.current;
    if (!viewerContainer) return undefined;

    const showViewerError = (error: unknown) => {
      if (!isMounted) return;
      const nextMessage = getPanoramaErrorMessage(error);
      setErrorMessage(nextMessage);
      hideLoadingOverlay();
      setIsReady(false);
      onReadyChangeRef.current?.(false);
      onErrorChangeRef.current?.(nextMessage);
    };

    startViewerTimer = window.setTimeout(() => {
      if (!isMounted) return;

      try {
        viewer = new Viewer({
          container: viewerContainer,
          adapter: [EquirectangularVideoAdapter, { autoplay: false, muted: false }],
          plugins: [[VideoPlugin, { progressbar: false, bigbutton: false }]],
          navbar: false,
          mousemove: true,
          mousewheel: true,
          touchmoveTwoFingers: false,
          defaultYaw: 0,
          defaultPitch: 0,
        });

        void viewer
          .setPanorama({ source: video }, { showLoader: false })
          .catch(showViewerError);
        video.load();
      } catch (error) {
        showViewerError(error);
      }
    }, 0);

    return () => {
      isMounted = false;
      if (startViewerTimer !== null) {
        window.clearTimeout(startViewerTimer);
      }
      clearWaitingOverlayTimer();
      cancelAnimationFrame(rafRef.current);
      video.pause();
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('canplay', handleCanPlay);
      video.removeEventListener('waiting', handleWaiting);
      video.removeEventListener('playing', handlePlaying);
      video.removeEventListener('ended', handleEnded);
      video.removeEventListener('error', handleError);
      viewer?.destroy();
      videoRef.current = null;
      onReadyChangeRef.current?.(false);
    };
  }, [crossOrigin, sourceUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !isReady) return;

    const driftMs = targetTimeMs - video.currentTime * 1000;
    if (!isPlaying) {
      if (Math.abs(driftMs) > IMMEDIATE_SEEK_THRESHOLD_MS) {
        video.currentTime = targetSeconds;
      }
      return;
    }

    if (Math.abs(driftMs) > HARD_SYNC_THRESHOLD_MS) {
      video.currentTime = targetSeconds;
    }
  }, [isPlaying, isReady, targetSeconds, targetTimeMs]);

  useEffect(() => {
    if (durationMsRef.current <= 0) return;
    if (targetTimeMs < durationMsRef.current - 80) {
      setHasEnded(false);
    }
  }, [targetTimeMs]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !isReady) return undefined;

    const driftMs = targetTimeMs - video.currentTime * 1000;
    const nextPlaybackRate = isPlaying
      ? getAdjustedPlaybackRate(playbackSpeed, driftMs)
      : playbackSpeed;
    if (video.playbackRate !== nextPlaybackRate) {
      video.playbackRate = nextPlaybackRate;
    }

    const atEnd =
      durationMsRef.current > 0 && targetTimeMs >= durationMsRef.current - 80;

    if (isPlaying) {
      if (hasEnded || atEnd) {
        if (!video.paused) video.pause();
        return undefined;
      }
      if (video.paused) {
        void video.play().catch(() => {
          const nextMessage = 'Browser blocked playback for this 360-degree video source.';
          setErrorMessage(nextMessage);
          onErrorChangeRef.current?.(nextMessage);
        });
      }
    } else if (!video.paused) {
      video.pause();
    }

    return undefined;
  }, [hasEnded, isPlaying, isReady, playbackSpeed, targetTimeMs]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;

    const tick = () => {
      onClockChangeRef.current?.(video.currentTime * 1000);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [sourceUrl]);

  return (
    <div className={`relative h-full min-h-[280px] w-full overflow-hidden bg-black ${className}`}>
      <div ref={containerRef} className="h-full w-full" />

      {overlay ? <div className="pointer-events-none absolute inset-0 z-10">{overlay}</div> : null}

      {isLoading && !errorMessage ? (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/45 backdrop-blur-sm">
          <div className="flex items-center gap-3 rounded-full border border-white/15 bg-black/55 px-4 py-2 text-sm text-white">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Loading 360-degree video{mediaLabel ? `: ${mediaLabel}` : ''}</span>
          </div>
        </div>
      ) : null}

      {errorMessage ? (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/70 p-6">
          <div className="max-w-md rounded-2xl border border-red-400/35 bg-stone-950/85 p-5 text-white shadow-xl">
            <div className="mb-2 flex items-center gap-2 text-red-300">
              <AlertTriangle className="h-5 w-5" />
              <span className="font-semibold">360-degree video unavailable</span>
            </div>
            <p className="text-sm text-stone-200">{errorMessage}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
