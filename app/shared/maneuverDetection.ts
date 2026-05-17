export type ManeuverEventType =
  | 'tack'
  | 'gybe'
  | 'mark_rounding'
  | 'penalty_360'
  | 'penalty_720'
  | 'other_turn';

export interface ManeuverTrackPoint {
  t: number;
  lat: number;
  lon: number;
  s?: number;
  h?: number;
  w_s?: number;
  w_d?: number;
}

export interface ManeuverMark {
  id: string;
  name?: string;
  lat: number;
  lon: number;
  order?: number;
}

export interface ManeuverMetrics {
  duration?: number;
  headingChange?: number;
  cumulativeTurn?: number;
  entryTwa?: number;
  exitTwa?: number;
  minAbsTwa?: number;
  maxAbsTwa?: number;
  speedBefore?: number;
  minSpeed?: number;
  speedLoss?: number;
  nearestMarkId?: string;
  nearestMarkDistance?: number;
}

export interface ManeuverDetectionOptions {
  minSpeedKnots: number;
  turnRateStartDegPerSec: number;
  turnRateEndDegPerSec: number;
  minTurnDurationMs: number;
  maxTurnDurationMs: number;
  eventEndQuietMs: number;
  minHeadingChangeDeg: number;
  prePostWindowMs: number;
  minConfidence: number;
  markRadiusMeters: number;
}

export interface DetectManeuversInput {
  sessionId: string;
  trackId: string;
  points: ManeuverTrackPoint[];
  marks?: ManeuverMark[];
  options?: Partial<ManeuverDetectionOptions>;
}

export interface DetectedManeuver {
  type: ManeuverEventType;
  trackId: string;
  timestamp: number;
  startTime: number;
  endTime: number;
  confidence: number;
  note: string;
  linkedMarkId?: string;
  metrics: ManeuverMetrics;
  reasonCodes: string[];
}

interface PreparedPoint extends ManeuverTrackPoint {
  h: number;
  s: number;
  rate: number;
}

interface TurnWindow {
  startIndex: number;
  endIndex: number;
  apexIndex: number;
}

interface EventFeatures {
  startTime: number;
  endTime: number;
  apexTime: number;
  durationMs: number;
  preHeading?: number;
  postHeading?: number;
  deltaHeading: number;
  cumulativeTurn: number;
  turnDirectionConsistency: number;
  preTwa?: number;
  postTwa?: number;
  minAbsTwa?: number;
  maxAbsTwa?: number;
  speedBefore?: number;
  minSpeed?: number;
  speedLoss?: number;
  nearestMark?: {
    mark: ManeuverMark;
    distanceMeters: number;
  };
}

const DEFAULT_OPTIONS: ManeuverDetectionOptions = {
  minSpeedKnots: 1,
  turnRateStartDegPerSec: 6,
  turnRateEndDegPerSec: 2,
  minTurnDurationMs: 3000,
  maxTurnDurationMs: 180000,
  eventEndQuietMs: 3000,
  minHeadingChangeDeg: 35,
  prePostWindowMs: 6000,
  minConfidence: 0.6,
  markRadiusMeters: 50,
};

const KNOTS_PER_MPS = 1.9438444924406;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number | undefined, digits = 1): number | undefined {
  if (value == null || !Number.isFinite(value)) return undefined;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function normalizeHeading(value: number): number {
  return ((value % 360) + 360) % 360;
}

function angleDelta(from: number, to: number): number {
  return ((to - from + 180) % 360 + 360) % 360 - 180;
}

function absAngle(value: number | undefined): number | undefined {
  return value == null ? undefined : Math.abs(value);
}

function signedTwa(point: ManeuverTrackPoint): number | undefined {
  if (point.h == null || point.w_d == null) return undefined;
  return angleDelta(point.w_d, point.h);
}

function angularMean(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  let x = 0;
  let y = 0;
  for (const value of values) {
    const rad = (value * Math.PI) / 180;
    x += Math.cos(rad);
    y += Math.sin(rad);
  }
  if (x === 0 && y === 0) return undefined;
  return normalizeHeading((Math.atan2(y, x) * 180) / Math.PI);
}

function signedMean(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], p: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const index = clamp(Math.round((sorted.length - 1) * p), 0, sorted.length - 1);
  return sorted[index];
}

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
  return normalizeHeading((Math.atan2(y, x) * 180) / Math.PI);
}

function validLatLon(point: ManeuverTrackPoint): boolean {
  return (
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lon) &&
    Math.abs(point.lat) <= 90 &&
    Math.abs(point.lon) <= 180
  );
}

function estimateHeading(
  point: ManeuverTrackPoint,
  previous: ManeuverTrackPoint | undefined,
  next: ManeuverTrackPoint | undefined,
): number {
  if (point.h != null && Number.isFinite(point.h)) return normalizeHeading(point.h);
  const from = previous ?? point;
  const to = next ?? point;
  if (from === to || (from.lat === to.lat && from.lon === to.lon)) return 0;
  return bearingDegrees(from, to);
}

function estimateSpeed(
  point: ManeuverTrackPoint,
  previous: ManeuverTrackPoint | undefined,
): number {
  if (point.s != null && Number.isFinite(point.s)) return Math.max(0, point.s);
  if (!previous) return 0;
  const dt = Math.max(1, (point.t - previous.t) / 1000);
  return (haversineMeters(previous, point) / dt) * KNOTS_PER_MPS;
}

function preparePoints(points: ManeuverTrackPoint[]): PreparedPoint[] {
  const sorted = [...points]
    .filter((point) => Number.isFinite(point.t) && validLatLon(point))
    .sort((a, b) => a.t - b.t);

  const prepared = sorted.map((point, index): PreparedPoint => {
    const previous = sorted[index - 1];
    const next = sorted[index + 1];
    return {
      ...point,
      h: estimateHeading(point, previous, next),
      s: estimateSpeed(point, previous),
      rate: 0,
    };
  });

  for (let i = 1; i < prepared.length; i++) {
    const previous = prepared[i - 1]!;
    const point = prepared[i]!;
    const dt = Math.max(0.001, (point.t - previous.t) / 1000);
    point.rate = angleDelta(previous.h, point.h) / dt;
  }

  return prepared;
}

function findTurnWindows(
  points: PreparedPoint[],
  options: ManeuverDetectionOptions,
): TurnWindow[] {
  const windows: TurnWindow[] = [];
  let activeStart: number | null = null;
  let quietSince: number | null = null;
  let apexIndex = 0;
  let apexRate = 0;

  const closeWindow = (endIndex: number) => {
    if (activeStart == null) return;
    const startIndex = activeStart;
    const duration = points[endIndex]!.t - points[startIndex]!.t;
    activeStart = null;
    quietSince = null;
    if (duration < options.minTurnDurationMs) return;
    windows.push({ startIndex, endIndex, apexIndex });
  };

  for (let i = 1; i < points.length; i++) {
    const point = points[i]!;
    const absRate = Math.abs(point.rate);
    const moving = point.s >= options.minSpeedKnots;

    if (activeStart == null) {
      if (moving && absRate >= options.turnRateStartDegPerSec) {
        activeStart = Math.max(0, i - 1);
        quietSince = null;
        apexIndex = i;
        apexRate = absRate;
      }
      continue;
    }

    if (absRate > apexRate) {
      apexRate = absRate;
      apexIndex = i;
    }

    const duration = point.t - points[activeStart]!.t;
    if (duration >= options.maxTurnDurationMs) {
      closeWindow(i);
      continue;
    }

    if (absRate <= options.turnRateEndDegPerSec || !moving) {
      quietSince ??= point.t;
      if (point.t - quietSince >= options.eventEndQuietMs) {
        closeWindow(i);
      }
    } else {
      quietSince = null;
    }
  }

  if (activeStart != null) closeWindow(points.length - 1);

  return windows;
}

function pointsInTimeRange(
  points: PreparedPoint[],
  startMs: number,
  endMs: number,
): PreparedPoint[] {
  return points.filter((point) => point.t >= startMs && point.t <= endMs);
}

function nearestMarkForWindow(
  points: PreparedPoint[],
  marks: ManeuverMark[] | undefined,
): EventFeatures['nearestMark'] {
  if (!marks || marks.length === 0 || points.length === 0) return undefined;

  let best: EventFeatures['nearestMark'] | undefined;
  for (const mark of marks) {
    for (const point of points) {
      const distanceMeters = haversineMeters(point, mark);
      if (!best || distanceMeters < best.distanceMeters) {
        best = { mark, distanceMeters };
      }
    }
  }
  return best;
}

function extractFeatures(
  points: PreparedPoint[],
  window: TurnWindow,
  marks: ManeuverMark[] | undefined,
  options: ManeuverDetectionOptions,
): EventFeatures {
  const eventPoints = points.slice(window.startIndex, window.endIndex + 1);
  const start = points[window.startIndex]!;
  const end = points[window.endIndex]!;
  const apex = points[window.apexIndex] ?? start;
  const prePoints = pointsInTimeRange(
    points,
    start.t - options.prePostWindowMs,
    Math.max(start.t, start.t - 1),
  );
  const postPoints = pointsInTimeRange(
    points,
    Math.min(end.t, end.t + 1),
    end.t + options.prePostWindowMs,
  );

  const preHeading = angularMean(prePoints.map((point) => point.h));
  const postHeading = angularMean(postPoints.map((point) => point.h));
  const deltaHeading =
    preHeading != null && postHeading != null
      ? angleDelta(preHeading, postHeading)
      : angleDelta(start.h, end.h);

  let cumulativeTurn = 0;
  let positiveTurn = 0;
  let negativeTurn = 0;
  for (let i = window.startIndex + 1; i <= window.endIndex; i++) {
    const delta = angleDelta(points[i - 1]!.h, points[i]!.h);
    cumulativeTurn += delta;
    if (delta >= 0) positiveTurn += Math.abs(delta);
    else negativeTurn += Math.abs(delta);
  }

  const totalAbsTurn = positiveTurn + negativeTurn;
  const turnDirectionConsistency =
    totalAbsTurn > 0 ? Math.max(positiveTurn, negativeTurn) / totalAbsTurn : 0;

  const preTwas = prePoints.map(signedTwa).filter((value): value is number => value != null);
  const postTwas = postPoints.map(signedTwa).filter((value): value is number => value != null);
  const eventTwas = eventPoints
    .map(signedTwa)
    .filter((value): value is number => value != null);
  const absTwas = eventTwas.map(Math.abs);
  const preSpeeds = prePoints.map((point) => point.s).filter(Number.isFinite);
  const lossWindowEnd = Math.min(end.t, apex.t + 4000);
  const lossWindowPoints = eventPoints.filter(
    (point) => point.t >= start.t && point.t <= lossWindowEnd,
  );
  const lossWindowSpeeds = lossWindowPoints.map((point) => point.s).filter(Number.isFinite);
  const speedBefore = percentile(preSpeeds, 0.5);
  const minSpeed = percentile(lossWindowSpeeds, 0.1);

  return {
    startTime: start.t,
    endTime: end.t,
    apexTime: apex.t,
    durationMs: Math.max(0, end.t - start.t),
    preHeading,
    postHeading,
    deltaHeading,
    cumulativeTurn,
    turnDirectionConsistency,
    preTwa: signedMean(preTwas),
    postTwa: signedMean(postTwas),
    minAbsTwa: absTwas.length > 0 ? Math.min(...absTwas) : undefined,
    maxAbsTwa: absTwas.length > 0 ? Math.max(...absTwas) : undefined,
    speedBefore,
    minSpeed,
    speedLoss:
      speedBefore != null && minSpeed != null ? Math.max(0, speedBefore - minSpeed) : undefined,
    nearestMark: nearestMarkForWindow(eventPoints, marks),
  };
}

function hasSideChange(a: number | undefined, b: number | undefined): boolean {
  return a != null && b != null && a !== 0 && b !== 0 && Math.sign(a) !== Math.sign(b);
}

function between(value: number | undefined, min: number, max: number): boolean {
  return value != null && value >= min && value <= max;
}

function scoreTack(features: EventFeatures): { confidence: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  if (hasSideChange(features.preTwa, features.postTwa)) {
    score += 0.3;
    reasons.push('twa_side_changed');
  }
  if (features.minAbsTwa != null && features.minAbsTwa < 45) {
    score += 0.25;
    reasons.push('crossed_no_go_zone');
  }
  if (between(absAngle(features.preTwa), 25, 80) && between(absAngle(features.postTwa), 25, 80)) {
    score += 0.2;
    reasons.push('upwind_entry_exit');
  }
  if (between(Math.abs(features.deltaHeading), 50, 150)) {
    score += 0.15;
    reasons.push('heading_change_reasonable');
  }
  if (between(features.durationMs, 3000, 30000)) {
    score += 0.05;
    reasons.push('duration_reasonable');
  }
  if ((features.speedLoss ?? 0) >= 0.2) {
    score += 0.05;
    reasons.push('speed_loss_detected');
  }
  return { confidence: clamp(score, 0, 1), reasons };
}

function scoreGybe(features: EventFeatures): { confidence: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  if (hasSideChange(features.preTwa, features.postTwa)) {
    score += 0.3;
    reasons.push('twa_side_changed');
  }
  if (features.maxAbsTwa != null && features.maxAbsTwa > 150) {
    score += 0.25;
    reasons.push('crossed_downwind');
  }
  if (between(absAngle(features.preTwa), 110, 180) && between(absAngle(features.postTwa), 110, 180)) {
    score += 0.2;
    reasons.push('downwind_entry_exit');
  }
  if (between(Math.abs(features.deltaHeading), 30, 140)) {
    score += 0.15;
    reasons.push('heading_change_reasonable');
  }
  if (between(features.durationMs, 3000, 30000)) {
    score += 0.1;
    reasons.push('duration_reasonable');
  }
  return { confidence: clamp(score, 0, 1), reasons };
}

function scorePenalty(features: EventFeatures): {
  type: ManeuverEventType | null;
  confidence: number;
  reasons: string[];
} {
  const turn = Math.abs(features.cumulativeTurn);
  const reasons: string[] = [];
  const consistent = features.turnDirectionConsistency >= 0.75;

  if (turn >= 650 && turn <= 820 && features.durationMs <= 180000 && consistent) {
    reasons.push('full_720_turn', 'turn_direction_consistent');
    return { type: 'penalty_720', confidence: 0.88, reasons };
  }

  if (turn >= 300 && turn <= 430 && features.durationMs <= 90000 && consistent) {
    reasons.push('full_360_turn', 'turn_direction_consistent');
    return { type: 'penalty_360', confidence: 0.84, reasons };
  }

  return { type: null, confidence: 0, reasons };
}

function scoreMarkRounding(
  features: EventFeatures,
  options: ManeuverDetectionOptions,
): { confidence: number; reasons: string[]; linkedMarkId?: string } {
  const nearest = features.nearestMark;
  if (!nearest || nearest.distanceMeters > options.markRadiusMeters) {
    return { confidence: 0, reasons: [] };
  }

  const reasons = ['near_mark'];
  let score = 0.45;
  if (Math.abs(features.cumulativeTurn) >= 45) {
    score += 0.25;
    reasons.push('large_turn_near_mark');
  }
  if (features.durationMs <= 90000) {
    score += 0.15;
    reasons.push('rounding_duration_reasonable');
  }
  if ((features.speedLoss ?? 0) >= 0.1) {
    score += 0.05;
    reasons.push('speed_change_near_mark');
  }
  score += 0.1;

  return {
    confidence: clamp(score, 0, 1),
    reasons,
    linkedMarkId: nearest.mark.id,
  };
}

function scoreOtherTurn(features: EventFeatures, options: ManeuverDetectionOptions) {
  const reasons: string[] = [];
  let score = 0;
  if (Math.abs(features.deltaHeading) >= options.minHeadingChangeDeg) {
    score += 0.35;
    reasons.push('heading_change_detected');
  }
  if (Math.abs(features.cumulativeTurn) >= options.minHeadingChangeDeg) {
    score += 0.25;
    reasons.push('cumulative_turn_detected');
  }
  if (between(features.durationMs, options.minTurnDurationMs, 45000)) {
    score += 0.2;
    reasons.push('duration_reasonable');
  }
  if (features.turnDirectionConsistency >= 0.65) {
    score += 0.1;
    reasons.push('turn_direction_consistent');
  }
  if ((features.minSpeed ?? 0) >= options.minSpeedKnots) {
    score += 0.1;
    reasons.push('moving_during_turn');
  }
  return { confidence: clamp(score, 0, 1), reasons };
}

function buildMetrics(features: EventFeatures): ManeuverMetrics {
  return {
    duration: round(features.durationMs / 1000, 1),
    headingChange: round(features.deltaHeading),
    cumulativeTurn: round(features.cumulativeTurn),
    entryTwa: round(features.preTwa),
    exitTwa: round(features.postTwa),
    minAbsTwa: round(features.minAbsTwa),
    maxAbsTwa: round(features.maxAbsTwa),
    speedBefore: round(features.speedBefore),
    minSpeed: round(features.minSpeed),
    speedLoss: round(features.speedLoss),
    nearestMarkId: features.nearestMark?.mark.id,
    nearestMarkDistance: round(features.nearestMark?.distanceMeters, 0),
  };
}

function formatType(type: ManeuverEventType): string {
  switch (type) {
    case 'penalty_360':
      return 'penalty 360';
    case 'penalty_720':
      return 'penalty 720';
    case 'mark_rounding':
      return 'mark rounding';
    case 'other_turn':
      return 'turn';
    default:
      return type;
  }
}

function buildNote(type: ManeuverEventType, confidence: number, metrics: ManeuverMetrics): string {
  const parts = [
    `Auto ${formatType(type)}`,
    `${Math.round(confidence * 100)}%`,
  ];
  if (metrics.duration != null) parts.push(`${metrics.duration.toFixed(1)}s`);
  if (metrics.speedLoss != null && metrics.speedLoss > 0) {
    parts.push(`loss ${metrics.speedLoss.toFixed(1)} kts`);
  }
  return parts.join(' · ');
}

function classifyEvent(
  features: EventFeatures,
  options: ManeuverDetectionOptions,
): {
  type: ManeuverEventType;
  confidence: number;
  reasons: string[];
  linkedMarkId?: string;
} {
  const penalty = scorePenalty(features);
  if (penalty.type) {
    return {
      type: penalty.type,
      confidence: penalty.confidence,
      reasons: penalty.reasons,
    };
  }

  const rounding = scoreMarkRounding(features, options);
  if (rounding.confidence >= 0.75 && rounding.linkedMarkId) {
    return {
      type: 'mark_rounding',
      confidence: rounding.confidence,
      reasons: rounding.reasons,
      linkedMarkId: rounding.linkedMarkId,
    };
  }

  const tack = scoreTack(features);
  const gybe = scoreGybe(features);
  if (tack.confidence >= gybe.confidence && tack.confidence >= options.minConfidence) {
    return { type: 'tack', confidence: tack.confidence, reasons: tack.reasons };
  }
  if (gybe.confidence >= options.minConfidence) {
    return { type: 'gybe', confidence: gybe.confidence, reasons: gybe.reasons };
  }

  const other = scoreOtherTurn(features, options);
  return {
    type: 'other_turn',
    confidence: other.confidence,
    reasons: other.reasons,
  };
}

function overlapsExisting(
  candidate: DetectedManeuver,
  events: DetectedManeuver[],
): boolean {
  return events.some(
    (event) =>
      event.trackId === candidate.trackId &&
      event.type === candidate.type &&
      Math.abs(event.timestamp - candidate.timestamp) < 15000,
  );
}

export function detectManeuvers(input: DetectManeuversInput): DetectedManeuver[] {
  const options = { ...DEFAULT_OPTIONS, ...input.options };
  const points = preparePoints(input.points);
  if (points.length < 4) return [];

  const windows = findTurnWindows(points, options);
  const detected: DetectedManeuver[] = [];

  for (const window of windows) {
    const features = extractFeatures(points, window, input.marks, options);
    if (features.durationMs < options.minTurnDurationMs) continue;

    const classification = classifyEvent(features, options);
    const minConfidence =
      classification.type === 'other_turn' ? Math.max(0.72, options.minConfidence) : options.minConfidence;
    if (classification.confidence < minConfidence) continue;

    const metrics = buildMetrics(features);
    const maneuver: DetectedManeuver = {
      type: classification.type,
      trackId: input.trackId,
      timestamp: features.apexTime,
      startTime: features.startTime,
      endTime: features.endTime,
      confidence: round(classification.confidence, 2) ?? classification.confidence,
      note: buildNote(classification.type, classification.confidence, metrics),
      linkedMarkId: classification.linkedMarkId,
      metrics,
      reasonCodes: classification.reasons,
    };

    if (!overlapsExisting(maneuver, detected)) {
      detected.push(maneuver);
    }
  }

  return detected.sort((a, b) => a.timestamp - b.timestamp);
}
