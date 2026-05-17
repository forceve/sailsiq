export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function formatTimestamp(ms: number): string {
  return formatDuration(ms / 1000);
}

export function formatSpeed(knots: number, unit: 'knots' | 'kmh' | 'ms' = 'knots'): string {
  switch (unit) {
    case 'kmh':
      return `${(knots * 1.852).toFixed(1)} km/h`;
    case 'ms':
      return `${(knots * 0.5144).toFixed(2)} m/s`;
    default:
      return `${knots.toFixed(1)} kts`;
  }
}

export function formatDistance(nm: number, unit: 'nm' | 'km' | 'm' = 'nm'): string {
  switch (unit) {
    case 'km':
      return `${(nm * 1.852).toFixed(2)} km`;
    case 'm':
      return `${(nm * 1852).toFixed(0)} m`;
    default:
      return `${nm.toFixed(1)} NM`;
  }
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatHeading(deg: number): string {
  return `${Math.round(deg)}°`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
