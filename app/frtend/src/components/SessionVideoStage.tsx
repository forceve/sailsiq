import type { VideoType } from '@/types/models';
import FlatVideoStage from './FlatVideoStage';
import PanoramaVideoStage from './PanoramaVideoStage';
import type { ManagedVideoStageProps } from './videoStageTypes';

interface SessionVideoStageProps extends ManagedVideoStageProps {
  videoType: VideoType;
}

export default function SessionVideoStage({
  videoType,
  ...props
}: SessionVideoStageProps) {
  if (videoType === '360') {
    return <PanoramaVideoStage {...props} />;
  }

  return <FlatVideoStage {...props} />;
}
