import type { TrackPoint } from '@/types/models';
import type { WorkspaceRangeSelection } from '@/types/workspace';
import type { TelemetrySeries } from '@/components/AdaptiveTelemetryPanel';
import { getVmgToWind } from '@/utils/trackPoint';

export function clampRatio(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function findTelemetryIndexAtTime(telemetry: TrackPoint[], timeMs: number): number {
  if (telemetry.length === 0) return 0;
  if (telemetry.length === 1) return 0;

  const target = Number.isFinite(timeMs) ? timeMs : 0;
  const firstTime = telemetry[0]?.t ?? 0;
  const lastTime = telemetry[telemetry.length - 1]?.t ?? firstTime;
  if (target <= firstTime) return 0;
  if (target >= lastTime) return telemetry.length - 1;

  let lo = 0;
  let hi = telemetry.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if ((telemetry[mid]?.t ?? 0) < target) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }

  const after = lo;
  const before = Math.max(0, after - 1);
  const beforeDelta = Math.abs(target - (telemetry[before]?.t ?? 0));
  const afterDelta = Math.abs((telemetry[after]?.t ?? 0) - target);
  return afterDelta < beforeDelta ? after : before;
}

export function buildRangeIndices(
  range: Pick<WorkspaceRangeSelection, 'startMs' | 'endMs'> | null,
  telemetry: TrackPoint[],
) {
  if (!range || telemetry.length < 2) return null;
  return {
    startIndex: findTelemetryIndexAtTime(telemetry, range.startMs),
    endIndex: findTelemetryIndexAtTime(telemetry, range.endMs),
  };
}

export function buildTurnRateData(headingData: number[]): number[] {
  if (headingData.length < 2) return [];
  const out: number[] = [0];
  for (let i = 1; i < headingData.length; i++) {
    let delta = headingData[i]! - headingData[i - 1]!;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    out.push(delta);
  }
  return out;
}

export function buildTelemetrySeries(
  telemetry: TrackPoint[],
  options: {
    windDir?: number;
    includeVmgToWind?: boolean;
    headingColor?: string;
  } = {},
): TelemetrySeries[] {
  const speedData = telemetry.map((point) => point.s ?? 0);
  const headingData = telemetry.map((point) => point.h ?? 0);
  const turnRateData = buildTurnRateData(headingData);

  const series: TelemetrySeries[] = [
    {
      source: 'speed',
      label: 'Speed',
      unit: 'kts',
      data: speedData,
    },
    {
      source: 'heading',
      label: 'Heading',
      unit: 'deg',
      data: headingData,
      color: options.headingColor,
    },
  ];

  if (options.includeVmgToWind) {
    series.push({
      source: 'vmgToWind',
      label: 'VMG to wind',
      unit: 'kts',
      data: telemetry.map((point) => getVmgToWind(point, options.windDir) ?? 0),
    });
  }

  series.push({
    source: 'turnRate',
    label: 'Turn rate',
    unit: 'deg/s',
    data: turnRateData,
  });

  return series.filter((item) => item.source !== 'turnRate' || item.data.length > 0);
}
