import type { TelemetryDataset, TrackPoint } from '@/types/models';
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
    telemetryDatasets?: TelemetryDataset[];
    timeWindow?: { startMs: number; endMs: number };
    timeOriginMs?: number;
    sourceFilter?: 'all' | 'track' | 'imu';
  } = {},
): TelemetrySeries[] {
  const sourceFilter = options.sourceFilter ?? 'all';
  const timeOriginMs = options.timeOriginMs ?? options.timeWindow?.startMs ?? 0;
  const trackTelemetry = sliceTelemetryByWindow(telemetry, options.timeWindow);
  const trackXValues = options.timeWindow
    ? trackTelemetry.map((point) => (point.t - timeOriginMs) / 1000)
    : undefined;
  const speedData = trackTelemetry.map((point) => point.s ?? 0);
  const headingData = trackTelemetry.map((point) => point.h ?? 0);
  const turnRateData = buildTurnRateData(headingData);
  const xValueProps = trackXValues ? { xValues: trackXValues } : {};

  const series: TelemetrySeries[] = [];

  if (sourceFilter !== 'imu') {
    series.push(
      {
        source: 'speed',
        label: 'Speed',
        unit: 'kts',
        data: speedData,
        ...xValueProps,
      },
      {
        source: 'heading',
        label: 'Heading',
        unit: 'deg',
        data: headingData,
        color: options.headingColor,
        ...xValueProps,
      },
    );
  }

  if (options.includeVmgToWind && sourceFilter !== 'imu') {
    series.push({
      source: 'vmgToWind',
      label: 'VMG to wind',
      unit: 'kts',
      data: trackTelemetry.map((point) => getVmgToWind(point, options.windDir) ?? 0),
      ...xValueProps,
    });
  }

  if (sourceFilter !== 'imu') {
    series.push({
      source: 'turnRate',
      label: 'Turn rate',
      unit: 'deg/s',
      data: turnRateData,
      ...xValueProps,
    });
  }

  if (sourceFilter !== 'track') {
    series.push(
      ...buildSensorTelemetrySeries(
        options.telemetryDatasets ?? [],
        options.timeWindow,
        timeOriginMs,
      ),
    );
  }

  return series.filter((item) => item.source !== 'turnRate' || item.data.length > 0);
}

function lowerBoundTelemetryTime(telemetry: TrackPoint[], timeMs: number): number {
  let lo = 0;
  let hi = telemetry.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if ((telemetry[mid]?.t ?? 0) < timeMs) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

function upperBoundTelemetryTime(telemetry: TrackPoint[], timeMs: number): number {
  let lo = 0;
  let hi = telemetry.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if ((telemetry[mid]?.t ?? 0) <= timeMs) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

function sliceTelemetryByWindow(
  telemetry: TrackPoint[],
  timeWindow?: { startMs: number; endMs: number },
): TrackPoint[] {
  if (!timeWindow || telemetry.length === 0) return telemetry;
  if (timeWindow.endMs < timeWindow.startMs) return [];
  const startIndex = lowerBoundTelemetryTime(telemetry, timeWindow.startMs);
  const endIndex = upperBoundTelemetryTime(telemetry, timeWindow.endMs);
  return startIndex < endIndex ? telemetry.slice(startIndex, endIndex) : [];
}

const SENSOR_CHANNEL_ORDER = [
  'imu.heel',
  'imu.acceleration.magnitude',
  'imu.acceleration.x',
  'imu.acceleration.y',
  'imu.acceleration.z',
  'imu.angularRate.x',
  'imu.angularRate.y',
  'imu.angularRate.z',
  'imu.magneticRaw.magnitude',
  'imu.magneticRaw.x',
  'imu.magneticRaw.y',
  'imu.magneticRaw.z',
];

function buildSensorTelemetrySeries(
  datasets: TelemetryDataset[],
  timeWindow?: { startMs: number; endMs: number },
  timeOriginMs = timeWindow?.startMs ?? 0,
): TelemetrySeries[] {
  const series: TelemetrySeries[] = [];
  const order = new Map(SENSOR_CHANNEL_ORDER.map((id, index) => [id, index]));

  datasets.forEach((dataset) => {
    const channels = [...dataset.channels]
      .filter((channel) => channel.group !== 'quality')
      .sort((a, b) => {
        const orderA = order.get(a.id) ?? Number.MAX_SAFE_INTEGER;
        const orderB = order.get(b.id) ?? Number.MAX_SAFE_INTEGER;
        if (orderA !== orderB) return orderA - orderB;
        return a.label.localeCompare(b.label);
      });

    channels.forEach((channel) => {
      const samples = timeWindow
        ? channel.samples.filter(
            (sample) =>
              sample.t >= timeWindow.startMs && sample.t <= timeWindow.endMs,
          )
        : channel.samples;
      const data = samples
        .map((sample) => sample.v)
        .filter((value) => Number.isFinite(value));
      if (data.length === 0) return;
      const xValues = samples
        .filter((sample) => Number.isFinite(sample.v))
        .map((sample) =>
          timeWindow ? (sample.t - timeOriginMs) / 1000 : sample.t / 1000,
        );

      series.push({
        source: `${dataset.id}:${channel.id}`,
        label:
          datasets.length > 1
            ? `${dataset.label} / ${channel.label}`
            : channel.label,
        unit: channel.unit,
        data,
        xValues,
      });
    });
  });

  return series;
}
