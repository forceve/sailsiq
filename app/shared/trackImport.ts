export interface ImportedTrackPoint {
  t: number;
  lat: number;
  lon: number;
  s?: number;
  h?: number;
  w_s?: number;
  w_d?: number;
}

export interface ImportedSessionStats {
  duration: number;
  distance: number;
  maxSpeed: number;
  avgSpeed: number;
  turnCount: number;
}

export interface ImportedParseResult {
  success: boolean;
  fields: {
    time: boolean;
    lat: boolean;
    lon: boolean;
    speed: boolean;
    heading: boolean;
    wind: boolean;
  };
  pointCount: number;
  duration: number;
  date?: string;
  location?: string;
  previewPoints: { lat: number; lon: number }[];
  warnings: string[];
}

export interface ParsedImportTrack {
  points: ImportedTrackPoint[];
  stats: ImportedSessionStats;
  preview: ImportedParseResult;
  /** Reliable wall-clock ms for session time 0 when source timestamps were used as-is (not synthesized). */
  trackTimeOriginUnixMs?: number;
}

const KNOTS_PER_MPS = 1.9438444924406;
const UTF8_DECODER = new TextDecoder('utf-8');
const UBX_SYNC_CHAR_1 = 0xb5;
const UBX_SYNC_CHAR_2 = 0x62;
const UBX_NAV_CLASS = 0x01;
const UBX_NAV_PVT_ID = 0x07;
const UBX_NAV_PVT_LEN = 92;

function haversineMeters(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const r = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h =
    sinLat * sinLat +
    Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)));
}

function bearingDegrees(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

function findText(el: Element, names: string[]): string | null {
  const match = Array.from(el.getElementsByTagName('*')).find((node) => {
    const localName = node.localName?.toLowerCase();
    return localName != null && names.includes(localName);
  });
  return match?.textContent?.trim() ?? null;
}

function parseNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const num = Number(value.trim());
  return Number.isFinite(num) ? num : undefined;
}

function parseTimestampValue(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const asNumber = Number(trimmed);
  if (Number.isFinite(asNumber)) return asNumber;
  const ts = Date.parse(trimmed);
  return Number.isFinite(ts) ? ts : undefined;
}

function basename(fileName: string): string {
  const trimmed = fileName.trim();
  const dot = trimmed.lastIndexOf('.');
  return dot > 0 ? trimmed.slice(0, dot) : trimmed || 'Imported Session';
}

function normalizeHeading(value: number | undefined): number | undefined {
  if (value == null || !Number.isFinite(value)) return undefined;
  return ((value % 360) + 360) % 360;
}

function normalizeTimestampSeries(values: number[]): {
  normalized: number[];
  synthesizedTime: boolean;
  date?: string;
  originUnixMs: number;
} {
  if (values.length === 0) {
    return { normalized: [], synthesizedTime: false, originUnixMs: 0 };
  }

  const first = values[0]!;
  const max = Math.max(...values);
  const min = Math.min(...values);
  let scale = 1;

  if (max >= 1e12) {
    scale = 1;
  } else if (max >= 1e9) {
    scale = 1000;
  } else if (max >= 1e6 && min >= 0) {
    scale = 1;
  } else {
    scale = 1000;
  }

  const scaled = values.map((value) => Math.round(value * scale));
  let synthesizedTime = false;
  let last = scaled[0]!;
  const normalizedAbs = scaled.map((value, index) => {
    if (index === 0) return value;
    if (value <= last) {
      synthesizedTime = true;
      last = last + 1000;
    } else {
      last = value;
    }
    return last;
  });

  const origin = normalizedAbs[0]!;
  const normalized = normalizedAbs.map((value) => value - origin);
  const startedAt = new Date(origin);
  const date = Number.isNaN(startedAt.getTime())
    ? undefined
    : startedAt.toISOString().slice(0, 10);

  return { normalized, synthesizedTime, date, originUnixMs: origin };
}

function hasUbxChecksum(
  bytes: Uint8Array,
  start: number,
  frameEnd: number,
): boolean {
  let ckA = 0;
  let ckB = 0;
  for (let i = start + 2; i < frameEnd - 2; i++) {
    ckA = (ckA + bytes[i]!) & 0xff;
    ckB = (ckB + ckA) & 0xff;
  }
  return bytes[frameEnd - 2] === ckA && bytes[frameEnd - 1] === ckB;
}

function parseUbxTimestamp(
  view: DataView,
  payloadOffset: number,
): number | undefined {
  const year = view.getUint16(payloadOffset + 4, true);
  const month = view.getUint8(payloadOffset + 6);
  const day = view.getUint8(payloadOffset + 7);
  const hour = view.getUint8(payloadOffset + 8);
  const minute = view.getUint8(payloadOffset + 9);
  const second = view.getUint8(payloadOffset + 10);
  const nano = view.getInt32(payloadOffset + 16, true);

  if (
    year < 1970 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 60
  ) {
    return undefined;
  }

  const baseMs = Date.UTC(year, month - 1, day, hour, minute, second);
  if (Number.isNaN(baseMs)) {
    return undefined;
  }

  const timestamp = Math.round(baseMs + nano / 1e6);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function finalizePoints(
  rawPoints: Array<{
    t?: number;
    lat: number;
    lon: number;
    s?: number;
    h?: number;
    w_s?: number;
    w_d?: number;
  }>,
  options: {
    hadSourceTime: boolean;
    hadSourceSpeed: boolean;
    hadSourceHeading: boolean;
    hadSourceWind: boolean;
  },
): ParsedImportTrack {
  if (rawPoints.length === 0) {
    throw new Error('No track points were found in this file.');
  }

  const warnings: string[] = [];
  const sourceTimes = rawPoints.map((point, index) =>
    point.t != null ? point.t : index,
  );
  const timeInfo = normalizeTimestampSeries(sourceTimes);

  const points = rawPoints.map((point, index) => ({
    t: timeInfo.normalized[index] ?? index * 1000,
    lat: point.lat,
    lon: point.lon,
    s: point.s,
    h: normalizeHeading(point.h),
    w_s: point.w_s,
    w_d: normalizeHeading(point.w_d),
  }));

  for (let i = 0; i < points.length; i++) {
    const current = points[i]!;
    const prev = points[i - 1];
    const next = points[i + 1];

    if (current.h == null) {
      const bearingFrom = prev ?? current;
      const bearingTo = next ?? current;
      current.h =
        bearingFrom === bearingTo
          ? 0
          : Math.round(bearingDegrees(bearingFrom, bearingTo) * 10) / 10;
    }

    if (current.s == null) {
      if (prev) {
        const deltaSeconds = Math.max(1, (current.t - prev.t) / 1000);
        const meters = haversineMeters(prev, current);
        current.s =
          Math.round((meters / deltaSeconds) * KNOTS_PER_MPS * 10) / 10;
      } else {
        current.s = 0;
      }
    } else {
      current.s = Math.round(Math.max(0, current.s) * 10) / 10;
    }

    if (current.w_s != null) {
      current.w_s = Math.round(Math.max(0, current.w_s) * 10) / 10;
    }
  }

  if (!options.hadSourceTime || timeInfo.synthesizedTime) {
    warnings.push(
      'Some timestamps were missing or out of order and were normalized.',
    );
  }
  if (!options.hadSourceSpeed) {
    warnings.push('Speed was not present in the file and was estimated from movement.');
  }
  if (!options.hadSourceHeading) {
    warnings.push('Heading was not present in the file and was derived from nearby points.');
  }
  if (!options.hadSourceWind) {
    warnings.push('Wind data not found in file, you can enter it manually.');
  }

  const stats = buildStats(points);
  const location = `${points[0]!.lat.toFixed(4)}, ${points[0]!.lon.toFixed(4)}`;

  const trackTimeOriginUnixMs =
    options.hadSourceTime &&
    !timeInfo.synthesizedTime &&
    Number.isFinite(timeInfo.originUnixMs)
      ? timeInfo.originUnixMs
      : undefined;

  return {
    points,
    stats,
    ...(trackTimeOriginUnixMs != null ? { trackTimeOriginUnixMs } : {}),
    preview: {
      success: points.length > 1,
      fields: {
        time: true,
        lat: true,
        lon: true,
        speed: options.hadSourceSpeed,
        heading: options.hadSourceHeading,
        wind: options.hadSourceWind,
      },
      pointCount: points.length,
      duration: stats.duration,
      date: timeInfo.date,
      location,
      previewPoints: samplePreviewPoints(points),
      warnings,
    },
  };
}

function samplePreviewPoints(
  points: ImportedTrackPoint[],
  maxPoints = 100,
): { lat: number; lon: number }[] {
  if (points.length <= maxPoints) {
    return points.map((point) => ({ lat: point.lat, lon: point.lon }));
  }

  const step = (points.length - 1) / (maxPoints - 1);
  const sampled: { lat: number; lon: number }[] = [];
  for (let i = 0; i < maxPoints; i++) {
    const point = points[Math.round(i * step)]!;
    sampled.push({ lat: point.lat, lon: point.lon });
  }
  return sampled;
}

function countTurns(points: ImportedTrackPoint[]): number {
  if (points.length < 3) return 0;

  let count = 0;
  let accumulated = 0;
  let cooldown = 0;

  for (let i = 1; i < points.length; i++) {
    const prevHeading = points[i - 1]!.h;
    const nextHeading = points[i]!.h;
    if (prevHeading == null || nextHeading == null) continue;

    let delta = nextHeading - prevHeading;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;

    if (cooldown > 0) {
      cooldown -= 1;
      continue;
    }

    accumulated += Math.abs(delta);
    if (accumulated >= 70) {
      count += 1;
      accumulated = 0;
      cooldown = 3;
    }
  }

  return count;
}

function buildStats(points: ImportedTrackPoint[]): ImportedSessionStats {
  if (points.length < 2) {
    return {
      duration: 0,
      distance: 0,
      maxSpeed: 0,
      avgSpeed: 0,
      turnCount: 0,
    };
  }

  let distance = 0;
  let maxSpeed = 0;

  for (let i = 1; i < points.length; i++) {
    distance += haversineMeters(points[i - 1]!, points[i]!);
    maxSpeed = Math.max(maxSpeed, points[i]!.s ?? 0);
  }

  const durationSeconds = Math.max(
    0,
    Math.round(points[points.length - 1]!.t / 1000),
  );
  const avgSpeed =
    durationSeconds > 0 ? (distance / durationSeconds) * KNOTS_PER_MPS : 0;

  return {
    duration: durationSeconds,
    distance: Math.round(distance),
    maxSpeed: Math.round(maxSpeed * 10) / 10,
    avgSpeed: Math.round(avgSpeed * 10) / 10,
    turnCount: countTurns(points),
  };
}

function parseGpx(xml: string): ParsedImportTrack {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) {
    throw new Error('Invalid GPX file.');
  }

  const rawPoints = Array.from(doc.getElementsByTagName('*')).filter((node) => {
    const localName = node.localName?.toLowerCase();
    return localName === 'trkpt' || localName === 'rtept';
  });

  if (rawPoints.length === 0) {
    throw new Error('No track points were found in this GPX file.');
  }

  let hadSourceTime = false;
  let hadSourceSpeed = false;
  let hadSourceHeading = false;
  let hadSourceWind = false;

  const points = rawPoints.map((node, index) => {
    const lat = Number(node.getAttribute('lat'));
    const lon = Number(node.getAttribute('lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      throw new Error(`Track point ${index + 1} is missing a valid lat/lon.`);
    }

    const t = parseTimestampValue(findText(node, ['time']));
    const s =
      parseNumber(findText(node, ['speed'])) ??
      parseNumber(findText(node, ['velocity'])) ??
      parseNumber(findText(node, ['spe']));
    const h =
      parseNumber(findText(node, ['course'])) ??
      parseNumber(findText(node, ['heading'])) ??
      parseNumber(findText(node, ['bearing']));
    const w_s = parseNumber(findText(node, ['windspeed', 'ws']));
    const w_d = parseNumber(findText(node, ['winddirection', 'wd']));

    hadSourceTime ||= t != null;
    hadSourceSpeed ||= s != null;
    hadSourceHeading ||= h != null;
    hadSourceWind ||= w_s != null || w_d != null;

    return {
      t,
      lat,
      lon,
      s: s != null ? s * KNOTS_PER_MPS : undefined,
      h,
      w_s: w_s != null ? w_s * KNOTS_PER_MPS : undefined,
      w_d,
    };
  });

  return finalizePoints(points, {
    hadSourceTime,
    hadSourceSpeed,
    hadSourceHeading,
    hadSourceWind,
  });
}

function parseUbx(bytes: Uint8Array): ParsedImportTrack {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const points: Array<{
    t?: number;
    lat: number;
    lon: number;
    s?: number;
    h?: number;
    w_s?: number;
    w_d?: number;
  }> = [];

  let navPvtCount = 0;
  let skippedPoints = 0;
  let offset = 0;

  while (offset + 8 <= bytes.byteLength) {
    if (
      bytes[offset] !== UBX_SYNC_CHAR_1 ||
      bytes[offset + 1] !== UBX_SYNC_CHAR_2
    ) {
      offset += 1;
      continue;
    }

    const payloadLength = view.getUint16(offset + 4, true);
    const frameEnd = offset + 6 + payloadLength + 2;
    if (frameEnd > bytes.byteLength) {
      break;
    }

    if (!hasUbxChecksum(bytes, offset, frameEnd)) {
      offset += 2;
      continue;
    }

    const msgClass = bytes[offset + 2]!;
    const msgId = bytes[offset + 3]!;
    if (
      msgClass === UBX_NAV_CLASS &&
      msgId === UBX_NAV_PVT_ID &&
      payloadLength === UBX_NAV_PVT_LEN
    ) {
      navPvtCount += 1;

      const payloadOffset = offset + 6;
      const fixType = view.getUint8(payloadOffset + 20);
      const lat = view.getInt32(payloadOffset + 28, true) / 1e7;
      const lon = view.getInt32(payloadOffset + 24, true) / 1e7;
      const timestamp = parseUbxTimestamp(view, payloadOffset);

      if (
        fixType < 2 ||
        timestamp == null ||
        !Number.isFinite(lat) ||
        !Number.isFinite(lon) ||
        lat < -90 ||
        lat > 90 ||
        lon < -180 ||
        lon > 180
      ) {
        skippedPoints += 1;
      } else {
        points.push({
          t: timestamp,
          lat,
          lon,
          s: (view.getInt32(payloadOffset + 60, true) / 1000) * KNOTS_PER_MPS,
          h: view.getInt32(payloadOffset + 64, true) / 1e5,
        });
      }
    }

    offset = frameEnd;
  }

  if (navPvtCount === 0) {
    throw new Error('No NAV-PVT messages were found in this UBX file.');
  }

  if (points.length === 0) {
    throw new Error('No usable 2D/3D fixes were found in this UBX file.');
  }

  const parsed = finalizePoints(points, {
    hadSourceTime: true,
    hadSourceSpeed: true,
    hadSourceHeading: true,
    hadSourceWind: false,
  });

  if (skippedPoints > 0) {
    parsed.preview.warnings.unshift(
      `Skipped ${skippedPoints} UBX points without a usable 2D/3D fix.`,
    );
  }

  return parsed;
}

function looksLikeDelimitedText(text: string): boolean {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return false;
  return [',', ';', '\t'].some((delimiter) => lines[0]!.includes(delimiter));
}

function parseDelimitedBin(text: string): ParsedImportTrack {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) {
    throw new Error('The .bin text export does not contain enough rows.');
  }

  const delimiter = ['\t', ',', ';'].find((candidate) =>
    lines[0]!.includes(candidate),
  ) ?? ',';
  const headers = lines[0]!.split(delimiter).map((value) => value.trim().toLowerCase());
  const indexOfAny = (names: string[]) => headers.findIndex((header) => names.includes(header));

  const timeIndex = indexOfAny(['t', 'time', 'timestamp', 'ts']);
  const latIndex = indexOfAny(['lat', 'latitude']);
  const lonIndex = indexOfAny(['lon', 'lng', 'longitude']);
  const speedIndex = indexOfAny(['s', 'speed', 'sog']);
  const headingIndex = indexOfAny(['h', 'heading', 'cog', 'course']);
  const windSpeedIndex = indexOfAny(['w_s', 'ws', 'windspeed']);
  const windDirIndex = indexOfAny(['w_d', 'wd', 'winddirection']);

  if (latIndex < 0 || lonIndex < 0) {
    throw new Error('The .bin text export is missing lat/lon columns.');
  }

  const points = lines.slice(1).map((line, rowIndex) => {
    const values = line.split(delimiter).map((value) => value.trim());
    const lat = parseNumber(values[latIndex]);
    const lon = parseNumber(values[lonIndex]);
    if (lat == null || lon == null) {
      throw new Error(`Row ${rowIndex + 2} is missing a valid lat/lon.`);
    }
    return {
      t: timeIndex >= 0 ? parseTimestampValue(values[timeIndex]) : undefined,
      lat,
      lon,
      s: speedIndex >= 0 ? parseNumber(values[speedIndex]) : undefined,
      h: headingIndex >= 0 ? parseNumber(values[headingIndex]) : undefined,
      w_s: windSpeedIndex >= 0 ? parseNumber(values[windSpeedIndex]) : undefined,
      w_d: windDirIndex >= 0 ? parseNumber(values[windDirIndex]) : undefined,
    };
  });

  return finalizePoints(points, {
    hadSourceTime: timeIndex >= 0,
    hadSourceSpeed: speedIndex >= 0,
    hadSourceHeading: headingIndex >= 0,
    hadSourceWind: windSpeedIndex >= 0 || windDirIndex >= 0,
  });
}

function parseJsonBin(text: string): ParsedImportTrack {
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error('The .bin file is not valid JSON export data.');
  }

  const entries = Array.isArray(payload)
    ? payload
    : payload != null &&
        typeof payload === 'object' &&
        Array.isArray((payload as { points?: unknown[] }).points)
      ? (payload as { points: unknown[] }).points
      : null;

  if (!entries || entries.length === 0) {
    throw new Error('The .bin JSON export does not contain any points.');
  }

  let hadSourceTime = false;
  let hadSourceSpeed = false;
  let hadSourceHeading = false;
  let hadSourceWind = false;

  const points = entries.map((entry, index) => {
    if (entry == null || typeof entry !== 'object') {
      throw new Error(`Point ${index + 1} is not a valid object.`);
    }
    const record = entry as Record<string, unknown>;
    const lat = parseNumber(record.lat ?? record.latitude);
    const lon = parseNumber(record.lon ?? record.lng ?? record.longitude);
    if (lat == null || lon == null) {
      throw new Error(`Point ${index + 1} is missing a valid lat/lon.`);
    }
    const t = parseTimestampValue(record.t ?? record.time ?? record.timestamp ?? record.ts);
    const s = parseNumber(record.s ?? record.speed ?? record.sog);
    const h = parseNumber(record.h ?? record.heading ?? record.cog ?? record.course);
    const w_s = parseNumber(record.w_s ?? record.ws ?? record.windSpeed ?? record.windspeed);
    const w_d = parseNumber(record.w_d ?? record.wd ?? record.windDirection ?? record.winddirection);

    hadSourceTime ||= t != null;
    hadSourceSpeed ||= s != null;
    hadSourceHeading ||= h != null;
    hadSourceWind ||= w_s != null || w_d != null;

    return { t, lat, lon, s, h, w_s, w_d };
  });

  return finalizePoints(points, {
    hadSourceTime,
    hadSourceSpeed,
    hadSourceHeading,
    hadSourceWind,
  });
}

function scoreParsedPoints(points: ImportedTrackPoint[]): number {
  if (points.length < 2) return -1;
  let valid = 0;
  let moving = 0;
  let monotonic = 0;

  for (let i = 0; i < points.length; i++) {
    const point = points[i]!;
    if (
      Number.isFinite(point.lat) &&
      Number.isFinite(point.lon) &&
      point.lat >= -90 &&
      point.lat <= 90 &&
      point.lon >= -180 &&
      point.lon <= 180
    ) {
      valid += 1;
    }

    if (i > 0) {
      const prev = points[i - 1]!;
      if (point.t > prev.t) monotonic += 1;
      if (Math.abs(point.lat - prev.lat) + Math.abs(point.lon - prev.lon) > 1e-7) {
        moving += 1;
      }
    }
  }

  return valid + moving + monotonic;
}

function parseBinaryLayout(
  bytes: Uint8Array,
  parseRecord: (view: DataView, offset: number, index: number) => {
    t?: number;
    lat: number;
    lon: number;
    s?: number;
    h?: number;
    w_s?: number;
    w_d?: number;
  },
  recordSize: number,
  flags: {
    hadSourceTime: boolean;
    hadSourceSpeed: boolean;
    hadSourceHeading: boolean;
    hadSourceWind: boolean;
  },
): ParsedImportTrack | null {
  if (bytes.byteLength < recordSize * 2 || bytes.byteLength % recordSize !== 0) {
    return null;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const rawPoints: Array<{
    t?: number;
    lat: number;
    lon: number;
    s?: number;
    h?: number;
    w_s?: number;
    w_d?: number;
  }> = [];

  for (let offset = 0, index = 0; offset < bytes.byteLength; offset += recordSize, index++) {
    const point = parseRecord(view, offset, index);
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon)) {
      return null;
    }
    rawPoints.push(point);
  }

  try {
    const parsed = finalizePoints(rawPoints, flags);
    return scoreParsedPoints(parsed.points) > rawPoints.length * 2 ? parsed : null;
  } catch {
    return null;
  }
}

function parseBinaryBin(bytes: Uint8Array): ParsedImportTrack {
  const candidates = [
    parseBinaryLayout(
      bytes,
      (view, offset) => ({
        t: view.getUint32(offset, true),
        lat: view.getFloat32(offset + 4, true),
        lon: view.getFloat32(offset + 8, true),
        s: view.getFloat32(offset + 12, true),
        h: view.getFloat32(offset + 20, true),
        w_s: view.getFloat32(offset + 24, true),
        w_d: view.getFloat32(offset + 28, true),
      }),
      32,
      {
        hadSourceTime: true,
        hadSourceSpeed: true,
        hadSourceHeading: true,
        hadSourceWind: true,
      },
    ),
    parseBinaryLayout(
      bytes,
      (view, offset) => ({
        t: view.getUint32(offset, true),
        lat: view.getFloat32(offset + 4, true),
        lon: view.getFloat32(offset + 8, true),
        s: view.getFloat32(offset + 12, true),
        h: view.getFloat32(offset + 20, true),
      }),
      24,
      {
        hadSourceTime: true,
        hadSourceSpeed: true,
        hadSourceHeading: true,
        hadSourceWind: false,
      },
    ),
    parseBinaryLayout(
      bytes,
      (view, offset) => ({
        t: view.getUint32(offset, true),
        lat: view.getInt32(offset + 4, true) / 1e7,
        lon: view.getInt32(offset + 8, true) / 1e7,
        s: view.getFloat32(offset + 12, true),
        h: view.getFloat32(offset + 20, true),
        w_s: view.getFloat32(offset + 24, true),
        w_d: view.getFloat32(offset + 28, true),
      }),
      32,
      {
        hadSourceTime: true,
        hadSourceSpeed: true,
        hadSourceHeading: true,
        hadSourceWind: true,
      },
    ),
  ].filter((candidate): candidate is ParsedImportTrack => candidate != null);

  const best = candidates.sort(
    (a, b) => scoreParsedPoints(b.points) - scoreParsedPoints(a.points),
  )[0];
  if (!best) {
    throw new Error('Unsupported SailSIQ .bin structure.');
  }
  return best;
}

function parseBin(bytes: Uint8Array): ParsedImportTrack {
  const text = UTF8_DECODER.decode(bytes).replace(/^\uFEFF/, '').trim();

  if (text.startsWith('{') || text.startsWith('[')) {
    return parseJsonBin(text);
  }
  if (looksLikeDelimitedText(text)) {
    return parseDelimitedBin(text);
  }
  return parseBinaryBin(bytes);
}

export function parseImportBytes(
  fileName: string,
  bytes: Uint8Array | ArrayBuffer,
): ParsedImportTrack {
  const normalizedBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const ext = fileName.split('.').pop()?.toLowerCase();

  if (ext === 'gpx') {
    return parseGpx(UTF8_DECODER.decode(normalizedBytes));
  }

  if (ext === 'ubx') {
    return parseUbx(normalizedBytes);
  }

  if (ext === 'bin') {
    return parseBin(normalizedBytes);
  }

  throw new Error('Only GPX, UBX, and SailSIQ .bin imports are supported right now.');
}

export function getSessionNameFromImportFile(fileName: string): string {
  return basename(fileName);
}
