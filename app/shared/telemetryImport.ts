export type TelemetryChannelGroup =
  | 'acceleration'
  | 'angularRate'
  | 'magnetic'
  | 'attitude'
  | 'quality'
  | 'generic';

export interface TelemetrySample {
  t: number;
  v: number;
}

export interface TelemetryChannel {
  id: string;
  label: string;
  unit: string;
  group: TelemetryChannelGroup;
  axis?: 'x' | 'y' | 'z';
  sourceColumn?: string;
  validChannelId?: string;
  samples: TelemetrySample[];
  sampleCount: number;
  min?: number;
  max?: number;
  avg?: number;
}

export interface TelemetrySegment {
  id: string;
  startMs: number;
  endMs: number;
  sampleCount: number;
}

export interface TelemetryDataset {
  id: string;
  sessionId?: string;
  kind: 'sensor_timeseries' | 'derived' | 'external';
  label: string;
  sourceFileName?: string;
  importedAt: string;
  timeOrigin: 'device' | 'session' | 'unix' | 'synthetic';
  sampleCount: number;
  durationMs: number;
  segments: TelemetrySegment[];
  channels: TelemetryChannel[];
  warnings: string[];
}

export interface ParsedTelemetryImport {
  dataset: TelemetryDataset;
  detectedColumns: string[];
  ignoredColumns: string[];
}

const UTF8_DECODER = new TextDecoder('utf-8');
const MAX_CHANNEL_SAMPLES = 50000;
const LEGACY_SAILSIQ_IMU_HEADERS = [
  'timestamp_us',
  'gps_time_valid',
  'accel_valid',
  'gyro_valid',
  'mag_valid',
  'accel_x_g',
  'accel_y_g',
  'accel_z_g',
  'gyro_x_dps',
  'gyro_y_dps',
  'gyro_z_dps',
  'mag_x_counts',
  'mag_y_counts',
  'mag_z_counts',
] as const;
const SAILSIQ_IMU_HEADERS = [
  'timestamp_us',
  'gps_time_valid',
  'accel_valid',
  'gyro_valid',
  'mag_valid',
  'sw1_pressed',
  'sw2_pressed',
  'sw3_pressed',
  'sw4_pressed',
  'accel_x_g',
  'accel_y_g',
  'accel_z_g',
  'gyro_x_dps',
  'gyro_y_dps',
  'gyro_z_dps',
  'mag_x_counts',
  'mag_y_counts',
  'mag_z_counts',
  'accel_cal_x_g',
  'accel_cal_y_g',
  'accel_cal_z_g',
  'gyro_cal_x_dps',
  'gyro_cal_y_dps',
  'gyro_cal_z_dps',
  'mag_cal_x_counts',
  'mag_cal_y_counts',
  'mag_cal_z_counts',
] as const;

function normalizeColumnName(value: string): string {
  return value
    .trim()
    .replace(/^\uFEFF/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function parseNumber(value: string | undefined): number | undefined {
  if (value == null) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseTimestampValue(value: string | undefined): number | undefined {
  if (value == null) return undefined;
  const numeric = parseNumber(value);
  if (numeric != null) return numeric;

  const parsed = Date.parse(value.trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

function detectDelimiter(line: string): string {
  const candidates = [',', '\t', ';'];
  return candidates
    .map((delimiter) => ({
      delimiter,
      count: splitDelimitedLine(line, delimiter).length,
    }))
    .sort((a, b) => b.count - a.count)[0]?.delimiter ?? ',';
}

function splitDelimitedLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;
    const next = line[i + 1];
    if (char === '"') {
      if (quoted && next === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === delimiter && !quoted) {
      cells.push(current);
      current = '';
      continue;
    }
    current += char;
  }

  cells.push(current);
  return cells;
}

function parseDelimitedText(text: string): { headers: string[]; rows: string[][] } {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  if (lines.length < 2) {
    throw new Error('Telemetry file must contain a header and at least one data row.');
  }

  const delimiter = detectDelimiter(lines[0]!);
  const headers = splitDelimitedLine(lines[0]!, delimiter).map((header) => header.trim());
  const rows = lines.slice(1).map((line) => splitDelimitedLine(line, delimiter));
  return normalizeSailSiqImuRows(headers, rows);
}

function sameNormalizedHeaders(headers: string[], expected: readonly string[]): boolean {
  if (headers.length !== expected.length) return false;
  return headers.every((header, index) => normalizeColumnName(header) === expected[index]);
}

function looksLikeSailSiqImu(headers: string[], rows: string[][]): boolean {
  return (
    sameNormalizedHeaders(headers, LEGACY_SAILSIQ_IMU_HEADERS) ||
    sameNormalizedHeaders(headers, SAILSIQ_IMU_HEADERS) ||
    (headers.length >= 14 &&
      rows.some((row) => row.length === 14 || row.length === 18 || row.length === 27) &&
      normalizeColumnName(headers[0] ?? '') === 'timestamp_us' &&
      normalizeColumnName(headers[1] ?? '') === 'gps_time_valid')
  );
}

function normalizeSailSiqImuRows(
  headers: string[],
  rows: string[][],
): { headers: string[]; rows: string[][] } {
  if (!looksLikeSailSiqImu(headers, rows)) {
    return { headers, rows };
  }

  const normalizedRows = rows.map((row) => {
    if (row.length === 14) {
      return [
        ...row.slice(0, 5),
        '',
        '',
        '',
        '',
        ...row.slice(5, 14),
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
      ];
    }
    if (row.length === 18) {
      return [
        ...row.slice(0, 18),
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
      ];
    }
    return row.slice(0, SAILSIQ_IMU_HEADERS.length);
  });

  return {
    headers: [...SAILSIQ_IMU_HEADERS],
    rows: normalizedRows,
  };
}

function inferTimeScale(name: string, values: number[]): number {
  if (/_us$|micro|usec/.test(name)) return 0.001;
  if (/_ms$|msec/.test(name)) return 1;
  if (/unix|epoch/.test(name)) return 1;
  const max = Math.max(...values);
  if (max > 1e12) return 1;
  if (max > 1e9) return 1000;
  if (max > 1e6) return 0.001;
  return 1000;
}

function isTimeColumn(name: string): boolean {
  return (
    name === 't' ||
    name === 'time' ||
    name === 'timestamp' ||
    name === 'timestamp_us' ||
    name === 'timestamp_ms' ||
    name === 'time_us' ||
    name === 'time_ms' ||
    /^(device_)?timestamp/.test(name)
  );
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function normalizeTimes(
  normalizedHeaders: string[],
  rows: string[][],
): { times: number[]; segments: TelemetrySegment[]; timeOrigin: TelemetryDataset['timeOrigin']; warnings: string[] } {
  const timeIndex = normalizedHeaders.findIndex(isTimeColumn);
  const warnings: string[] = [];

  if (timeIndex < 0) {
    warnings.push('No time column was found; synthesized a 1 Hz timeline.');
    return {
      times: rows.map((_, index) => index * 1000),
      segments: [
        {
          id: 'segment-1',
          startMs: 0,
          endMs: Math.max(0, rows.length - 1) * 1000,
          sampleCount: rows.length,
        },
      ],
      timeOrigin: 'synthetic',
      warnings,
    };
  }

  const raw = rows.map((row) => parseTimestampValue(row[timeIndex]) ?? Number.NaN);
  const finiteRaw = raw.filter((value) => Number.isFinite(value));
  if (finiteRaw.length === 0) {
    warnings.push('Time column contained no numeric values; synthesized a 1 Hz timeline.');
    return {
      times: rows.map((_, index) => index * 1000),
      segments: [
        {
          id: 'segment-1',
          startMs: 0,
          endMs: Math.max(0, rows.length - 1) * 1000,
          sampleCount: rows.length,
        },
      ],
      timeOrigin: 'synthetic',
      warnings,
    };
  }

  const scale = finiteRaw.some((value) => value >= 1e12)
    ? 1
    : inferTimeScale(normalizedHeaders[timeIndex]!, finiteRaw);
  const scaled = raw.map((value, index) =>
    Number.isFinite(value) ? value * scale : index * 1000,
  );
  const positiveIntervals: number[] = [];
  for (let i = 1; i < scaled.length; i++) {
    const dt = scaled[i]! - scaled[i - 1]!;
    if (dt > 0 && dt < 60000) positiveIntervals.push(dt);
  }
  const fallbackDt = median(positiveIntervals) || 1000;

  const times: number[] = [];
  const segments: TelemetrySegment[] = [];
  let currentSegmentStartIndex = 0;
  let currentSegmentStartMs = 0;
  let outputOffset = 0;
  let rawSegmentStart = scaled[0] ?? 0;
  let lastRaw = rawSegmentStart;
  let lastOutput = 0;

  scaled.forEach((rawMs, index) => {
    if (index > 0 && rawMs <= lastRaw) {
      segments.push({
        id: `segment-${segments.length + 1}`,
        startMs: currentSegmentStartMs,
        endMs: lastOutput,
        sampleCount: index - currentSegmentStartIndex,
      });
      outputOffset = lastOutput + fallbackDt;
      currentSegmentStartIndex = index;
      currentSegmentStartMs = outputOffset;
      rawSegmentStart = rawMs;
    }

    const t = Math.max(0, Math.round(outputOffset + rawMs - rawSegmentStart));
    times.push(t);
    lastRaw = rawMs;
    lastOutput = t;
  });

  segments.push({
    id: `segment-${segments.length + 1}`,
    startMs: currentSegmentStartMs,
    endMs: lastOutput,
    sampleCount: rows.length - currentSegmentStartIndex,
  });

  if (segments.length > 1) {
    warnings.push(`Time reset was detected; imported as ${segments.length} segments.`);
  }

  return {
    times,
    segments,
    timeOrigin:
      normalizedHeaders[timeIndex]?.includes('unix') ||
      Math.max(...finiteRaw) > 1e9
        ? 'unix'
        : 'device',
    warnings,
  };
}

function forEachNonEmptyLine(
  text: string,
  callback: (line: string, lineIndex: number) => void,
): void {
  let lineStart = 0;
  let lineIndex = 0;

  for (let i = 0; i <= text.length; i++) {
    const atEnd = i === text.length;
    const char = atEnd ? '' : text[i]!;
    if (!atEnd && char !== '\n') continue;

    const lineEnd = i > lineStart && text[i - 1] === '\r' ? i - 1 : i;
    const line = text.slice(lineStart, lineEnd);
    lineStart = i + 1;
    if (line.trim().length === 0) continue;
    callback(line, lineIndex);
    lineIndex += 1;
  }
}

function normalizeSailSiqImuRow(row: string[]): string[] {
  if (row.length === 14) {
    return [
      ...row.slice(0, 5),
      '',
      '',
      '',
      '',
      ...row.slice(5, 14),
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
    ];
  }
  if (row.length === 18) {
    return [
      ...row.slice(0, 18),
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
    ];
  }
  return row.slice(0, SAILSIQ_IMU_HEADERS.length);
}

function selectSampleRowIndices(rowCount: number): number[] {
  if (rowCount <= MAX_CHANNEL_SAMPLES) {
    return Array.from({ length: rowCount }, (_, index) => index);
  }

  const lastIndex = rowCount - 1;
  const indices: number[] = [];
  let previous = -1;
  for (let i = 0; i < MAX_CHANNEL_SAMPLES; i++) {
    const index = Math.round((i * lastIndex) / (MAX_CHANNEL_SAMPLES - 1));
    if (index !== previous) {
      indices.push(index);
      previous = index;
    }
  }
  return indices;
}

function parseSailSiqImuTelemetryText(
  fileName: string,
  text: string,
  options: { sessionId?: string; datasetId?: string },
): ParsedTelemetryImport | null {
  let headers: string[] | null = null;
  let delimiter = ',';
  let rowCount = 0;
  const positiveIntervals: number[] = [];
  let previousRawMs: number | null = null;

  forEachNonEmptyLine(text, (line, lineIndex) => {
    if (lineIndex === 0) {
      delimiter = detectDelimiter(line);
      headers = splitDelimitedLine(line, delimiter).map((header) => header.trim());
      return;
    }

    if (!headers || !looksLikeSailSiqImu(headers, [])) return;
    const row = splitDelimitedLine(line, delimiter);
    const timestampUs = parseNumber(row[0]);
    if (timestampUs != null) {
      const rawMs = timestampUs * 0.001;
      if (previousRawMs != null) {
        const interval = rawMs - previousRawMs;
        if (interval > 0 && interval < 60000) positiveIntervals.push(interval);
      }
      previousRawMs = rawMs;
    }
    rowCount += 1;
  });

  if (!headers || !looksLikeSailSiqImu(headers, []) || rowCount === 0) {
    return null;
  }

  const normalizedHeaders = [...SAILSIQ_IMU_HEADERS];
  const normalizedHeaderList: string[] = normalizedHeaders;
  const sampleRowIndices = selectSampleRowIndices(rowCount);
  const sampleIndexSet = new Set(sampleRowIndices);
  const fallbackDt = median(positiveIntervals) || 1000;
  const warnings: string[] = [];
  const segments: TelemetrySegment[] = [];
  const detectedColumns = new Set<string>();
  const ignoredColumns: string[] = [];
  const channelDefs = normalizedHeaders
    .map((header, columnIndex) => {
      if (isTimeColumn(header)) {
        detectedColumns.add(header);
        return null;
      }
      const channel = channelFromColumn(header, header);
      if (!channel) {
        ignoredColumns.push(header);
        return null;
      }
      detectedColumns.add(header);
      return {
        columnIndex,
        channel,
        validIndex:
          channel.validChannelId != null
            ? normalizedHeaderList.indexOf(channel.validChannelId)
            : -1,
        samples: [] as TelemetrySample[],
      };
    })
    .filter(
      (
        item,
      ): item is {
        columnIndex: number;
        channel: Omit<TelemetryChannel, 'samples' | 'sampleCount'>;
        validIndex: number;
        samples: TelemetrySample[];
      } => item != null,
    );

  let dataRowIndex = 0;
  let currentSegmentStartIndex = 0;
  let currentSegmentStartMs = 0;
  let outputOffset = 0;
  let rawSegmentStart: number | null = null;
  let lastRaw: number | null = null;
  let lastOutput = 0;
  const sampledTimes: number[] = [];

  forEachNonEmptyLine(text, (line, lineIndex) => {
    if (lineIndex === 0) return;

    const sourceRow = splitDelimitedLine(line, delimiter);
    const timestampUs = parseNumber(sourceRow[0]);
    if (timestampUs == null) {
      dataRowIndex += 1;
      return;
    }

    const rawMs = timestampUs * 0.001;
    if (rawSegmentStart == null) {
      rawSegmentStart = rawMs;
      lastRaw = rawMs;
    } else if (lastRaw != null && rawMs <= lastRaw) {
      segments.push({
        id: `segment-${segments.length + 1}`,
        startMs: currentSegmentStartMs,
        endMs: lastOutput,
        sampleCount: dataRowIndex - currentSegmentStartIndex,
      });
      outputOffset = lastOutput + fallbackDt;
      currentSegmentStartIndex = dataRowIndex;
      currentSegmentStartMs = outputOffset;
      rawSegmentStart = rawMs;
    }

    const t = Math.max(0, Math.round(outputOffset + rawMs - rawSegmentStart));
    lastRaw = rawMs;
    lastOutput = t;

    if (sampleIndexSet.has(dataRowIndex)) {
      const row = normalizeSailSiqImuRow(sourceRow);
      sampledTimes.push(t);
      channelDefs.forEach((definition) => {
        const valid =
          definition.validIndex < 0 ||
          (parseNumber(row[definition.validIndex]) ?? 1) > 0;
        const value = parseNumber(row[definition.columnIndex]);
        if (valid && value != null) {
          definition.samples.push({ t, v: value });
        }
      });
    }

    dataRowIndex += 1;
  });

  segments.push({
    id: `segment-${segments.length + 1}`,
    startMs: currentSegmentStartMs,
    endMs: lastOutput,
    sampleCount: rowCount - currentSegmentStartIndex,
  });

  if (segments.length > 1) {
    warnings.push(`Time reset was detected; imported as ${segments.length} segments.`);
  }
  if (sampleRowIndices.length < rowCount) {
    warnings.push(
      `Large telemetry file was downsampled from ${rowCount} rows to ${sampleRowIndices.length} samples per channel.`,
    );
  }

  const channels = channelDefs
    .map((definition) =>
      definition.samples.length > 0
        ? finalizeChannel(definition.channel, definition.samples)
        : null,
    )
    .filter((channel): channel is TelemetryChannel => channel != null);
  const outputChannels = addDerivedChannels(channels, sampledTimes);
  if (outputChannels.length === 0) {
    throw new Error('No supported telemetry columns were found in this file.');
  }

  return {
    dataset: {
      id: options.datasetId ?? createDatasetId(fileName),
      sessionId: options.sessionId,
      kind: 'sensor_timeseries',
      label: fileName.replace(/\.[^.]+$/, '') || 'Sensor telemetry',
      sourceFileName: fileName,
      importedAt: new Date().toISOString(),
      timeOrigin: 'unix',
      sampleCount: rowCount,
      durationMs: lastOutput,
      segments,
      channels: outputChannels,
      warnings,
    },
    detectedColumns: Array.from(detectedColumns),
    ignoredColumns,
  };
}

function channelFromColumn(name: string, sourceColumn: string): Omit<TelemetryChannel, 'samples' | 'sampleCount'> | null {
  const axisMatch = name.match(/(?:^|_)(x|y|z)(?:_|$)/);
  const axis = axisMatch?.[1] as 'x' | 'y' | 'z' | undefined;
  const isCalibrated = name.includes('_cal_') || name.includes('calibrated');

  if (name.endsWith('_valid') || name.includes('valid')) {
    return {
      id: `quality.${name}`,
      label: sourceColumn,
      unit: '',
      group: 'quality',
      sourceColumn,
    };
  }

  if (/^accel|acceleration|accelerometer/.test(name)) {
    return {
      id: `imu.${isCalibrated ? 'accelerationCal' : 'acceleration'}.${axis ?? sourceColumn}`,
      label: axis
        ? `${isCalibrated ? 'Cal acceleration' : 'Acceleration'} ${axis.toUpperCase()}`
        : sourceColumn,
      unit: name.includes('_g') || name.endsWith('g') ? 'g' : 'm/s^2',
      group: 'acceleration',
      axis,
      sourceColumn,
      validChannelId: 'accel_valid',
    };
  }

  if (/^gyro|angular_rate|gyroscope/.test(name)) {
    return {
      id: `imu.${isCalibrated ? 'angularRateCal' : 'angularRate'}.${axis ?? sourceColumn}`,
      label: axis ? `${isCalibrated ? 'Cal gyro' : 'Gyro'} ${axis.toUpperCase()}` : sourceColumn,
      unit: /dps|deg/.test(name) ? 'deg/s' : 'rad/s',
      group: 'angularRate',
      axis,
      sourceColumn,
      validChannelId: 'gyro_valid',
    };
  }

  if (/^mag|magnet|compass/.test(name)) {
    return {
      id: `imu.${isCalibrated ? 'magneticCal' : 'magneticRaw'}.${axis ?? sourceColumn}`,
      label: axis ? `${isCalibrated ? 'Cal mag' : 'Mag'} ${axis.toUpperCase()}` : sourceColumn,
      unit: /count/.test(name) ? 'counts' : 'uT',
      group: 'magnetic',
      axis,
      sourceColumn,
      validChannelId: 'mag_valid',
    };
  }

  if (name === 'heel' || name === 'heel_deg' || name === 'roll' || name === 'roll_deg') {
    return {
      id: 'imu.heel',
      label: sourceColumn,
      unit: 'deg',
      group: 'attitude',
      sourceColumn,
    };
  }

  return null;
}

function summarizeSamples(samples: TelemetrySample[]): Pick<TelemetryChannel, 'sampleCount' | 'min' | 'max' | 'avg'> {
  const values = samples.map((sample) => sample.v).filter((value) => Number.isFinite(value));
  if (values.length === 0) return { sampleCount: samples.length };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    sampleCount: samples.length,
    min,
    max,
    avg,
  };
}

function finalizeChannel(channel: Omit<TelemetryChannel, 'samples' | 'sampleCount'>, samples: TelemetrySample[]): TelemetryChannel {
  return {
    ...channel,
    samples,
    ...summarizeSamples(samples),
  };
}

function addDerivedChannels(channels: TelemetryChannel[], times: number[]): TelemetryChannel[] {
  const byId = new Map(channels.map((channel) => [channel.id, channel]));
  const ax = byId.get('imu.acceleration.x');
  const ay = byId.get('imu.acceleration.y');
  const az = byId.get('imu.acceleration.z');
  const mx = byId.get('imu.magneticRaw.x');
  const my = byId.get('imu.magneticRaw.y');
  const mz = byId.get('imu.magneticRaw.z');
  const derived: TelemetryChannel[] = [];

  const getValue = (channel: TelemetryChannel | undefined, index: number) =>
    channel?.samples[index]?.v;

  if (ax && ay && az) {
    const magnitude = times.map((t, index) => {
      const x = getValue(ax, index);
      const y = getValue(ay, index);
      const z = getValue(az, index);
      return {
        t,
        v:
          x != null && y != null && z != null
            ? Math.sqrt(x * x + y * y + z * z)
            : Number.NaN,
      };
    });
    derived.push(
      finalizeChannel(
        {
          id: 'imu.acceleration.magnitude',
          label: 'Acceleration magnitude',
          unit: ax.unit,
          group: 'acceleration',
        },
        magnitude,
      ),
    );

    const heel = times.map((t, index) => {
      const y = getValue(ay, index);
      const z = getValue(az, index);
      return {
        t,
        v: y != null && z != null ? (Math.atan2(y, -z) * 180) / Math.PI : Number.NaN,
      };
    });
    derived.push(
      finalizeChannel(
        {
          id: 'imu.heel',
          label: 'Heel',
          unit: 'deg',
          group: 'attitude',
        },
        heel,
      ),
    );
  }

  if (mx && my && mz) {
    const magnitude = times.map((t, index) => {
      const x = getValue(mx, index);
      const y = getValue(my, index);
      const z = getValue(mz, index);
      return {
        t,
        v:
          x != null && y != null && z != null
            ? Math.sqrt(x * x + y * y + z * z)
            : Number.NaN,
      };
    });
    derived.push(
      finalizeChannel(
        {
          id: 'imu.magneticRaw.magnitude',
          label: 'Mag magnitude',
          unit: mx.unit,
          group: 'magnetic',
        },
        magnitude,
      ),
    );
  }

  return [...derived, ...channels];
}

function createDatasetId(fileName: string): string {
  const base = fileName
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'telemetry';
  return `${base}-${Date.now().toString(36)}`;
}

export function parseTelemetryImportBytes(
  fileName: string,
  bytes: Uint8Array | ArrayBuffer,
  options: { sessionId?: string; datasetId?: string } = {},
): ParsedTelemetryImport {
  const normalizedBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const text = UTF8_DECODER.decode(normalizedBytes).replace(/^\uFEFF/, '');
  const sailSiqImuTelemetry = parseSailSiqImuTelemetryText(fileName, text, options);
  if (sailSiqImuTelemetry) {
    return sailSiqImuTelemetry;
  }

  const { headers, rows } = parseDelimitedText(text);
  const normalizedHeaders = headers.map(normalizeColumnName);
  const time = normalizeTimes(normalizedHeaders, rows);
  const sampleRowIndices = selectSampleRowIndices(rows.length);
  const channels: TelemetryChannel[] = [];
  const detectedColumns = new Set<string>();
  const ignoredColumns: string[] = [];

  headers.forEach((header, columnIndex) => {
    const normalizedHeader = normalizedHeaders[columnIndex]!;
    if (isTimeColumn(normalizedHeader)) {
      detectedColumns.add(header);
      return;
    }

    const channelInfo = channelFromColumn(normalizedHeader, header);
    if (!channelInfo) {
      ignoredColumns.push(header);
      return;
    }

    detectedColumns.add(header);
    const validIndex =
      channelInfo.validChannelId != null
        ? normalizedHeaders.indexOf(channelInfo.validChannelId)
        : -1;
    const samples = sampleRowIndices
      .map((rowIndex) => {
        const row = rows[rowIndex]!;
        const valid =
          validIndex < 0 ||
          (parseNumber(row[validIndex]) ?? 1) > 0;
        const value = parseNumber(row[columnIndex]);
        return valid && value != null
          ? { t: time.times[rowIndex] ?? rowIndex * 1000, v: value }
          : null;
      })
      .filter((sample): sample is TelemetrySample => sample != null);

    if (samples.length > 0) {
      channels.push(finalizeChannel(channelInfo, samples));
    }
  });

  const outputTimes = sampleRowIndices.map((rowIndex) => time.times[rowIndex] ?? rowIndex * 1000);
  const outputChannels = addDerivedChannels(channels, outputTimes);
  if (outputChannels.length === 0) {
    throw new Error('No supported telemetry columns were found in this file.');
  }

  const durationMs = Math.max(0, ...time.times) - Math.min(0, ...time.times);
  const warnings =
    sampleRowIndices.length < rows.length
      ? [
          ...time.warnings,
          `Large telemetry file was downsampled from ${rows.length} rows to ${sampleRowIndices.length} samples per channel.`,
        ]
      : time.warnings;
  const dataset: TelemetryDataset = {
    id: options.datasetId ?? createDatasetId(fileName),
    sessionId: options.sessionId,
    kind: 'sensor_timeseries',
    label: fileName.replace(/\.[^.]+$/, '') || 'Sensor telemetry',
    sourceFileName: fileName,
    importedAt: new Date().toISOString(),
    timeOrigin: time.timeOrigin,
    sampleCount: rows.length,
    durationMs,
    segments: time.segments,
    channels: outputChannels,
    warnings,
  };

  return {
    dataset,
    detectedColumns: Array.from(detectedColumns),
    ignoredColumns,
  };
}
