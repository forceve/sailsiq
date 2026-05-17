import type { VideoType } from '@/types/models';

const EQUIRECTANGULAR_RATIO = 2;
const EQUIRECTANGULAR_RATIO_TOLERANCE = 0.08;

export interface VideoTypeDetectionResult {
  videoType: VideoType;
  width: number;
  height: number;
}

function inferVideoTypeFromDimensions(width: number, height: number): VideoType {
  if (width <= 0 || height <= 0) return 'flat';
  const ratio = width / height;
  return Math.abs(ratio - EQUIRECTANGULAR_RATIO) <= EQUIRECTANGULAR_RATIO_TOLERANCE
    ? '360'
    : 'flat';
}

export function detectVideoTypeFromFile(file: File): Promise<VideoTypeDetectionResult> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const objectUrl = URL.createObjectURL(file);
    let settled = false;

    const cleanup = () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('error', handleError);
      video.pause();
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(objectUrl);
    };

    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };

    function handleLoadedMetadata() {
      const width = video.videoWidth;
      const height = video.videoHeight;
      settle(() => {
        resolve({
          videoType: inferVideoTypeFromDimensions(width, height),
          width,
          height,
        });
      });
    }

    function handleError() {
      settle(() => reject(new Error('Failed to read video metadata.')));
    }

    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('error', handleError);
    video.src = objectUrl;
    video.load();
  });
}
