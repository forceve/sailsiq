import LineChart from '@/components/LineChart';

export type TelemetrySeriesSource = 'speed' | 'heading' | 'vmgToWind' | 'turnRate';

export interface TelemetrySeries {
  source: TelemetrySeriesSource;
  label: string;
  unit: string;
  data: number[];
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
}: AdaptiveTelemetryPanelProps) {
  const visibleSeries = series.filter((item) => item.data.length > 0);

  return (
    <div className={`sailsiq-telemetry-panel flex h-full min-h-[280px] w-full min-w-0 flex-1 flex-col overflow-y-auto p-4 ${className}`}>
      <div className="sailsiq-telemetry-grid w-full min-w-0">
        {visibleSeries.map((item) => (
          <LineChart
            key={item.source}
            data={item.data}
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
          />
        ))}
      </div>
    </div>
  );
}
