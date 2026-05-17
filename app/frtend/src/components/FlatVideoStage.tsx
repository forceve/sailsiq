import { useEffect, useRef, useState } from 'react';
import { Loader2, AlertTriangle } from 'lucide-react';
import { clamp } from '@/utils/formatters';
import type { ManagedVideoStageProps } from './videoStageTypes';

const IMMEDIATE_SEEK_THRESHOLD_MS = 60;
const SOFT_SYNC_THRESHOLD_MS = 220;
const MEDIUM_SYNC_THRESHOLD_MS = 500;
const HARD_SYNC_THRESHOLD_MS = 1200;
const WAITING_OVERLAY_DELAY_MS = 250;

function getMediaErrorMessage(video: HTMLVideoElement): string {
  switch (video.error?.code) {
    case MediaError.MEDIA_ERR_ABORTED:
      return 'Video loading was aborted.';
    case MediaError.MEDIA_ERR_NETWORK:
      return 'Video failed to load due to a network error.';
    case MediaError.MEDIA_ERR_DECODE:
      return 'Video could not be decoded by this browser.';
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return 'Video format is not supported or the URL is not directly playable.';
    default:
      return 'Unable to load this video source.';
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

export default function FlatVideoStage({
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
    const video = videoRef.current;
    if (!video) return undefined;

    const handleLoadedMetadata = () => {
      durationMsRef.current = Number.isFinite(video.duration) ? video.duration * 1000 : 0;
      onDurationChangeRef.current?.(durationMsRef.current);
      hideLoadingOverlay();
      setHasEnded(false);
    };
    const handleCanPlay = () => {
      setIsReady(true);
      hideLoadingOverlay();
      setErrorMessage(null);
      onReadyChangeRef.current?.(true);
      onErrorChangeRef.current?.(null);
    };
    const handleWaiting = () => scheduleWaitingOverlay();
    const handlePlaying = () => {
      hideLoadingOverlay();
      if (durationMsRef.current <= 0 || video.currentTime * 1000 < durationMsRef.current - 80) {
        setHasEnded(false);
      }
    };
    const handleEnded = () => {
      setHasEnded(true);
      onClockChangeRef.current?.(durationMsRef.current);
    };
    const handleError = () => {
      const nextMessage = getMediaErrorMessage(video);
      setErrorMessage(nextMessage);
      hideLoadingOverlay();
      setIsReady(false);
      onReadyChangeRef.current?.(false);
      onErrorChangeRef.current?.(nextMessage);
    };

    setIsReady(false);
    setIsLoading(true);
    setErrorMessage(null);
    setHasEnded(false);
    clearWaitingOverlayTimer();
    onReadyChangeRef.current?.(false);
    onErrorChangeRef.current?.(null);

    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('canplay', handleCanPlay);
    video.addEventListener('waiting', handleWaiting);
    video.addEventListener('playing', handlePlaying);
    video.addEventListener('ended', handleEnded);
    video.addEventListener('error', handleError);

    video.load();

    return () => {
      clearWaitingOverlayTimer();
      video.pause();
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('canplay', handleCanPlay);
      video.removeEventListener('waiting', handleWaiting);
      video.removeEventListener('playing', handlePlaying);
      video.removeEventListener('ended', handleEnded);
      video.removeEventListener('error', handleError);
      onReadyChangeRef.current?.(false);
    };
  }, [sourceUrl]);

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
          const nextMessage = 'Browser blocked playback for this video source.';
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
      <video
        ref={videoRef}
        src={sourceUrl}
        crossOrigin={crossOrigin || undefined}
        playsInline
        preload="auto"
        className="h-full w-full object-cover"
      />

      {overlay ? <div className="pointer-events-none absolute inset-0 z-10">{overlay}</div> : null}

      {isLoading && !errorMessage ? (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/45 backdrop-blur-sm">
          <div className="flex items-center gap-3 rounded-full border border-white/15 bg-black/55 px-4 py-2 text-sm text-white">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Loading video{mediaLabel ? `: ${mediaLabel}` : ''}</span>
          </div>
        </div>
      ) : null}

      {errorMessage ? (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/70 p-6">
          <div className="max-w-md rounded-2xl border border-red-400/35 bg-stone-950/85 p-5 text-white shadow-xl">
            <div className="mb-2 flex items-center gap-2 text-red-300">
              <AlertTriangle className="h-5 w-5" />
              <span className="font-semibold">Video unavailable</span>
            </div>
            <p className="text-sm text-stone-200">{errorMessage}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
