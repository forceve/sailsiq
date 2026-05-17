import type { ReactNode } from 'react';

export interface ManagedVideoStageProps {
  sourceUrl: string;
  mediaLabel?: string;
  targetTimeMs: number;
  isPlaying: boolean;
  playbackSpeed: number;
  crossOrigin?: '' | 'anonymous';
  className?: string;
  overlay?: ReactNode;
  onClockChange?: (timeMs: number) => void;
  onDurationChange?: (durationMs: number) => void;
  onReadyChange?: (ready: boolean) => void;
  onErrorChange?: (message: string | null) => void;
}
