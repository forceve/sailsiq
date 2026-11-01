import LineChart from '@/components/LineChart';

export type TelemetrySeriesSource = string;

export interface TelemetrySeries {
  source: TelemetrySeriesSource;
  label: string;
  unit: string;
  data: number[];
  xValues?: number[];
  color?: string;
}

interface AdaptiveTelemetryPanelProps {
  series: TelemetrySeries[];
  totalLengthSeconds: number;
  playheadRatio: number;
  onSeek?: (ratio: number) => void;
  onRangeSelect: (
    source: TelemetrySeriesSource,
    range: { startRatio: number; endRatio: number } | null,
  ) => void;
  selectedRangeForSource: (
    source: TelemetrySeriesSource,
  ) => { startRatio: number; endRatio: number } | null;
  chartHeight?: number;
  className?: string;
  compact?: boolean;
}

export default function AdaptiveTelemetryPanel({
  series,
  totalLengthSeconds,
  playheadRatio,
  onSeek,
  onRangeSelect,
  selectedRangeForSource,
  chartHeight = 96,
  className = '',
  compact = false,
}: AdaptiveTelemetryPanelProps) {
  const visibleSeries = series.filter((item) => item.data.length > 0);

  return (
    <div
      className={`sailsiq-telemetry-panel flex h-full w-full min-w-0 flex-1 flex-col ${
        compact
          ? 'sailsiq-telemetry-panel--compact min-h-0 overflow-visible p-0'
          : 'min-h-[280px] overflow-y-auto p-4'
      } ${className}`}
    >
      <div className="sailsiq-telemetry-grid w-full min-w-0">
        {visibleSeries.map((item) => (
          <LineChart
            key={item.source}
            data={item.data}
            xValues={item.xValues}
            label={item.label}
            unit={item.unit}
            color={item.color}
            smoothing="auto"
            totalLengthSeconds={totalLengthSeconds}
            playheadRatio={playheadRatio}
            onSeek={onSeek}
            onRangeSelect={(range) => onRangeSelect(item.source, range)}
            selectedRange={selectedRangeForSource(item.source)}
            height={chartHeight}
            detailAnalysis
            compact={compact}
          />
        ))}
      </div>
    </div>
  );
}
