import {
  parseImportBytes,
  type ParsedImportTrack as SharedParsedImportTrack,
} from '../../../shared/trackImport';
import type { ParseResult, SessionStats, TrackPoint } from '@/types/models';

export interface ParsedGpsTrack {
  points: TrackPoint[];
  preview: ParseResult;
  stats: SessionStats;
}

function toParsedGpsTrack(track: SharedParsedImportTrack): ParsedGpsTrack {
  return {
    points: track.points,
    preview: track.preview,
    stats: track.stats,
  };
}

export async function parseGpsFile(file: File): Promise<ParsedGpsTrack> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return toParsedGpsTrack(parseImportBytes(file.name, bytes));
}

export function parseGpxText(xml: string): ParsedGpsTrack {
  return toParsedGpsTrack(
    parseImportBytes(
      'import.gpx',
      new TextEncoder().encode(xml),
    ),
  );
}
