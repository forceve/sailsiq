import { useCallback, useMemo } from 'react';
import AdaptiveTelemetryPanel, {
  type TelemetrySeriesSource,
} from '@/components/AdaptiveTelemetryPanel';
import type { TrackPoint } from '@/types/models';
import type { WorkspaceRangeSelection } from '@/types/workspace';
import { buildTelemetrySeries, clampRatio } from '@/utils/replayTelemetry';

interface WorkspaceTelemetryStageProps {
  telemetry: TrackPoint[];
  totalDurationMs: number;
  playheadRatio: number;
  selectedRange?: WorkspaceRangeSelection | null;
  onSeek?: (ratio: number) => void;
  onRangeSelect: (
    source: TelemetrySeriesSource,
    range: { startRatio: number; endRatio: number } | null,
  ) => void;
  selectedRangeForSource?: (
    source: TelemetrySeriesSource,
  ) => { startRatio: number; endRatio: number } | null;
  chartHeight?: number;
  className?: string;
  includeVmgToWind?: boolean;
  windDir?: number;
  headingColor?: string;
}

export default function WorkspaceTelemetryStage({
  telemetry,
  totalDurationMs,
  playheadRatio,
  selectedRange,
  onSeek,
  onRangeSelect,
  selectedRangeForSource,
  chartHeight = 110,
  className = '',
  includeVmgToWind = false,
  windDir,
  headingColor,
}: WorkspaceTelemetryStageProps) {
  const series = useMemo(
    () =>
      buildTelemetrySeries(telemetry, {
        windDir,
        includeVmgToWind,
        headingColor,
      }),
    [headingColor, includeVmgToWind, telemetry, windDir],
  );

  const defaultSelectedRangeForSource = useCallback(
    (source: TelemetrySeriesSource) => {
      if (selectedRange?.source !== source || totalDurationMs <= 0) return null;
      const startRatio = clampRatio(selectedRange.startMs / totalDurationMs);
      const endRatio = clampRatio(selectedRange.endMs / totalDurationMs);
      return endRatio > startRatio ? { startRatio, endRatio } : null;
    },
    [selectedRange, totalDurationMs],
  );

  return (
    <div className={`min-h-0 flex-1 ${className}`}>
      <AdaptiveTelemetryPanel
        series={series}
        totalLengthSeconds={totalDurationMs / 1000}
        playheadRatio={playheadRatio}
        onSeek={onSeek}
        onRangeSelect={onRangeSelect}
        selectedRangeForSource={selectedRangeForSource ?? defaultSelectedRangeForSource}
        chartHeight={chartHeight}
      />
    </div>
  );
}
