import { useCallback, useMemo, useState } from 'react';
import AdaptiveTelemetryPanel, {
  type TelemetrySeriesSource,
} from '@/components/AdaptiveTelemetryPanel';
import type { TelemetryDataset, TrackPoint } from '@/types/models';
import type { WorkspaceRangeSelection } from '@/types/workspace';
import { buildTelemetrySeries, clampRatio } from '@/utils/replayTelemetry';
import { useTheme } from '@/theme/ThemeContext';

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
  telemetryDatasets?: TelemetryDataset[];
  telemetryWindow?: { startMs: number; endMs: number };
  telemetryTimeOriginMs?: number;
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
  telemetryDatasets = [],
  telemetryWindow,
  telemetryTimeOriginMs,
}: WorkspaceTelemetryStageProps) {
  const { s } = useTheme();
  const [selectedSourceFilter, setSelectedSourceFilter] =
    useState<'all' | 'track' | 'imu'>('all');
  const hasSensorTelemetry = telemetryDatasets.some((dataset) =>
    dataset.channels.some((channel) => channel.group !== 'quality' && channel.samples.length > 0),
  );
  const sourceFilter = hasSensorTelemetry ? selectedSourceFilter : 'track';
  const series = useMemo(
    () =>
      buildTelemetrySeries(telemetry, {
        windDir,
        includeVmgToWind,
        headingColor,
        telemetryDatasets,
        timeWindow: telemetryWindow,
        timeOriginMs: telemetryTimeOriginMs,
        sourceFilter,
      }),
    [
      headingColor,
      includeVmgToWind,
      sourceFilter,
      telemetry,
      telemetryDatasets,
      telemetryTimeOriginMs,
      telemetryWindow,
      windDir,
    ],
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
      {hasSensorTelemetry ? (
        <div className={`flex shrink-0 items-center gap-1 border-b px-4 py-2 ${s.divider}`}>
          {(['all', 'track', 'imu'] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setSelectedSourceFilter(item)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                sourceFilter === item
                  ? s.buttonPrimary
                  : s.buttonSecondary
              }`}
            >
              {item === 'all' ? 'All' : item === 'track' ? 'Track' : 'IMU'}
            </button>
          ))}
          <span className={`ml-auto truncate text-xs ${s.textSecondary}`}>
            {telemetryDatasets.length} sensor source{telemetryDatasets.length === 1 ? '' : 's'}
          </span>
        </div>
      ) : null}
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
