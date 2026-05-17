import type { Session, SessionEvent, Mark } from '../../frtend/src/types/models';

const defaultStats = {
  duration: 0,
  distance: 0,
  maxSpeed: 0,
  avgSpeed: 0,
  turnCount: 0,
};

export const mockSessions: Session[] = [
  {
    id: 'session-001',
    name: 'Morning Practice – Upwind Drills',
    date: '2026-03-01',
    location: 'Richardson Bay',
    source: 'imported',
    boatType: 'J/70',
    projectId: 'proj-spring',
    stats: {
      duration: 2400,
      distance: 6200,
      avgSpeed: 5.2,
      maxSpeed: 11.8,
      turnCount: 18,
    },
    trackTimeOriginUnixMs: Date.parse('2026-03-01T18:30:00Z'),
    eventCount: 5,
    createdAt: '2026-03-01T18:30:00Z',
    updatedAt: '2026-03-01T19:00:00Z',
  },
  {
    id: 'session-002',
    name: 'Fleet Race #3 – SFYC Series',
    date: '2026-02-22',
    location: 'San Francisco Bay',
    source: 'imported',
    boatType: 'J/70',
    projectId: 'proj-spring',
    stats: {
      duration: 3600,
      distance: 11200,
      avgSpeed: 6.0,
      maxSpeed: 13.2,
      turnCount: 24,
    },
    trackTimeOriginUnixMs: Date.parse('2026-02-22T20:00:00Z'),
    eventCount: 8,
    createdAt: '2026-02-22T20:00:00Z',
    updatedAt: '2026-02-23T10:00:00Z',
  },
  {
    id: 'session-003',
    name: 'Light Wind Tactics',
    date: '2026-02-15',
    location: 'Richardson Bay',
    source: 'manual',
    boatType: 'Laser',
    stats: {
      duration: 1800,
      distance: 3500,
      avgSpeed: 3.8,
      maxSpeed: 6.2,
      turnCount: 12,
    },
    eventCount: 3,
    createdAt: '2026-02-15T17:00:00Z',
    updatedAt: '2026-02-15T17:30:00Z',
  },
];

export const mockEvents: Record<string, SessionEvent[]> = {
  'session-001': [
    { id: 'ev-001', sessionId: 'session-001', timestamp: 180000, type: 'tack', note: 'Clean tack, minimal speed loss' },
    { id: 'ev-002', sessionId: 'session-001', timestamp: 420000, type: 'general', note: 'Wind Shift Left – 10° left shift detected' },
    { id: 'ev-003', sessionId: 'session-001', timestamp: 720000, type: 'mark_rounding', note: 'Windward rounding – Inside rounding, good position' },
    { id: 'ev-004', sessionId: 'session-001', timestamp: 1200000, type: 'gybe', note: 'Downwind gybe at gate' },
    { id: 'ev-005', sessionId: 'session-001', timestamp: 2100000, type: 'finish', note: 'Crossed finish line' },
  ],
  'session-002': [
    { id: 'ev-101', sessionId: 'session-002', timestamp: 0, type: 'start', note: 'Good start, pin end' },
    { id: 'ev-102', sessionId: 'session-002', timestamp: 180000, type: 'tack', note: 'First tack' },
    { id: 'ev-103', sessionId: 'session-002', timestamp: 600000, type: 'general', note: 'Strong puff from left' },
    { id: 'ev-104', sessionId: 'session-002', timestamp: 900000, type: 'mark_rounding', note: 'Windward mark rounding' },
    { id: 'ev-105', sessionId: 'session-002', timestamp: 1500000, type: 'gybe', note: 'Gybe at gate' },
    { id: 'ev-106', sessionId: 'session-002', timestamp: 2100000, type: 'mark_rounding', note: 'Leeward mark' },
    { id: 'ev-107', sessionId: 'session-002', timestamp: 3000000, type: 'general', note: 'Wind dropped to 5kts' },
    { id: 'ev-108', sessionId: 'session-002', timestamp: 3480000, type: 'finish', note: '3rd place finish' },
  ],
  'session-003': [
    { id: 'ev-201', sessionId: 'session-003', timestamp: 120000, type: 'general', note: 'Wind below 5kts' },
    { id: 'ev-202', sessionId: 'session-003', timestamp: 480000, type: 'tack', note: 'Roll tack in light air' },
    { id: 'ev-203', sessionId: 'session-003', timestamp: 900000, type: 'general', note: 'Moved crew weight forward' },
  ],
};

// 旧金山湾场地赛布标：风摆上风-下风航线（Start / RC / 上风标 / 下风门 / 终点）
export const mockMarks: Record<string, Mark[]> = {
  'session-001': [
    { id: 'mk-001', sessionId: 'session-001', name: 'RC', lat: 37.872, lon: -122.481422, type: 'start_pin', order: 0 },
    { id: 'mk-002', sessionId: 'session-001', name: 'Pin', lat: 37.874, lon: -122.481422, type: 'start_boat', order: 1 },
    { id: 'mk-003', sessionId: 'session-001', name: 'Windward', lat: 37.872, lon: -122.472977, type: 'mark', order: 2 },
    { id: 'mk-004', sessionId: 'session-001', name: 'Gate L', lat: 37.871667, lon: -122.489868, type: 'gate', order: 3 },
    { id: 'mk-005', sessionId: 'session-001', name: 'Gate R', lat: 37.872333, lon: -122.489868, type: 'gate', order: 4 },
    { id: 'mk-006', sessionId: 'session-001', name: 'Finish', lat: 37.872, lon: -122.473399, type: 'finish', order: 5 },
  ],
  'session-002': [
    { id: 'mk-101', sessionId: 'session-002', name: 'RC', lat: 37.805086, lon: -122.415408, type: 'start_pin', order: 0 },
    { id: 'mk-102', sessionId: 'session-002', name: 'Pin', lat: 37.807501, lon: -122.414589, type: 'start_boat', order: 1 },
    { id: 'mk-103', sessionId: 'session-002', name: 'Windward', lat: 37.802929, lon: -122.40522, type: 'mark', order: 2 },
    { id: 'mk-104', sessionId: 'session-002', name: 'Gate L', lat: 37.806841, lon: -122.425732, type: 'gate', order: 3 },
    { id: 'mk-105', sessionId: 'session-002', name: 'Gate R', lat: 37.807646, lon: -122.425459, type: 'gate', order: 4 },
    { id: 'mk-106', sessionId: 'session-002', name: 'Finish', lat: 37.803037, lon: -122.405729, type: 'finish', order: 5 },
  ],
  'session-003': [
    { id: 'mk-201', sessionId: 'session-003', name: 'RC', lat: 37.871942, lon: -122.478416, type: 'start_pin', order: 0 },
    { id: 'mk-202', sessionId: 'session-003', name: 'Windward', lat: 37.872955, lon: -122.471138, type: 'mark', order: 1 },
    { id: 'mk-203', sessionId: 'session-003', name: 'Gate L', lat: 37.870642, lon: -122.485629, type: 'gate', order: 2 },
    { id: 'mk-204', sessionId: 'session-003', name: 'Gate R', lat: 37.871216, lon: -122.485757, type: 'gate', order: 3 },
    { id: 'mk-205', sessionId: 'session-003', name: 'Finish', lat: 37.872904, lon: -122.471502, type: 'finish', order: 4 },
  ],
};;
