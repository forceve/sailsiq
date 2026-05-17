import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { MapContainer, Marker, Pane, Polyline, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import L, { type DivIcon, type LatLngExpression } from 'leaflet';
import {
  ChevronLeft,
  Grid,
  Map as MapIcon,
  MapPin,
  MousePointer2,
  Move,
  Pencil,
  Save,
  Settings,
  Trash2,
  Undo2,
  Wind,
} from 'lucide-react';
import { useWorkspaceContext } from '@/context/WorkspaceContext';
import { useTheme } from '@/theme/ThemeContext';
import SessionTabs from '@/components/SessionTabs';
import {
  ZoomControls,
  WindWidget,
  BaseTileLayer,
  createMarkIcon,
  ResizeSync,
  type MapBaselayerKind,
} from '@/components/MapControls';
import { markApi, sessionApi, trackApi } from '@/services/api';
import {
  getLocalCanvasMarks,
  getLocalCanvasSession,
  getLocalCanvasTrack,
  saveLocalCanvasSession,
} from '@/services/workspace/localCanvasSession';
import type { Mark, MarkType, Session, TrackPoint } from '@/types/models';

type CanvasType = 'worldmap' | 'blank';
type DrawTool = 'path' | 'mark' | 'select';

interface LocalMark {
  id: string;
  type: MarkType;
  name: string;
  lat: number;
  lon: number;
}

const MARK_TYPES: Array<{ type: MarkType; label: string }> = [
  { type: 'start_pin', label: 'Start Pin' },
  { type: 'start_boat', label: 'Start Boat' },
  { type: 'mark', label: 'Mark' },
  { type: 'gate', label: 'Gate' },
  { type: 'finish', label: 'Finish' },
];
const WAYPOINT_CANVAS_PANE = 'waypoint-canvas-pane';
const WAYPOINT_LABEL_LIMIT = 180;

function createWaypointIcon(index: number, color: string): DivIcon {
  return L.divIcon({
    className: 'sailsiq-waypoint-icon',
    html: `<div style="width:11px;height:11px;border-radius:50%;background:${color};border:1px solid rgba(255,255,255,0.9);display:flex;align-items:center;justify-content:center;font-size:6px;font-weight:700;color:white;line-height:1">${index + 1}</div>`,
    iconSize: [11, 11],
    iconAnchor: [5.5, 5.5],
  });
}


function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return r * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const lat1R = (lat1 * Math.PI) / 180;
  const lat2R = (lat2 * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(lat2R);
  const x = Math.cos(lat1R) * Math.sin(lat2R) - Math.sin(lat1R) * Math.cos(lat2R) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function countTurns(points: TrackPoint[]): number {
  let count = 0;
  let accumulated = 0;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!.h;
    const next = points[i]!.h;
    if (prev == null || next == null) continue;
    let delta = next - prev;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    accumulated += Math.abs(delta);
    if (accumulated >= 70) {
      count += 1;
      accumulated = 0;
    }
  }
  return count;
}

function clonePathPoints(points: [number, number][]): [number, number][] {
  return points.map((point) => [point[0], point[1]] as [number, number]);
}

function interpolatePoint(
  start: [number, number],
  end: [number, number],
  t: number,
): [number, number] {
  return [
    start[0] + (end[0] - start[0]) * t,
    start[1] + (end[1] - start[1]) * t,
  ];
}

function planarDistance(start: [number, number], end: [number, number]): number {
  return Math.hypot(end[0] - start[0], end[1] - start[1]);
}

function redistributePathPoints(
  points: [number, number][],
  targetCount: number,
): [number, number][] {
  if (points.length <= 1) return clonePathPoints(points);

  const safeTarget = Math.max(2, Math.round(targetCount));
  if (safeTarget === points.length) return clonePathPoints(points);
  if (safeTarget === 2) {
    return [
      [points[0]![0], points[0]![1]],
      [points[points.length - 1]![0], points[points.length - 1]![1]],
    ];
  }

  const segmentLengths: number[] = [];
  let totalLength = 0;
  for (let index = 1; index < points.length; index++) {
    const length = planarDistance(points[index - 1]!, points[index]!);
    segmentLengths.push(length);
    totalLength += length;
  }

  if (totalLength <= 1e-9) {
    const step = (points.length - 1) / (safeTarget - 1);
    const fallback: [number, number][] = [[points[0]![0], points[0]![1]]];
    for (let index = 1; index < safeTarget - 1; index++) {
      const sourceIndex = index * step;
      const lowerIndex = Math.floor(sourceIndex);
      const upperIndex = Math.min(points.length - 1, Math.ceil(sourceIndex));
      const lower = points[lowerIndex]!;
      const upper = points[upperIndex]!;
      const span = Math.max(1, upperIndex - lowerIndex);
      const t = (sourceIndex - lowerIndex) / span;
      fallback.push(interpolatePoint(lower, upper, t));
    }
    fallback.push([
      points[points.length - 1]![0],
      points[points.length - 1]![1],
    ]);
    return fallback;
  }

  const result: [number, number][] = [[points[0]![0], points[0]![1]]];
  let traversedLength = 0;
  let segmentIndex = 0;

  for (let index = 1; index < safeTarget - 1; index++) {
    const targetDistance = (totalLength * index) / (safeTarget - 1);
    while (
      segmentIndex < segmentLengths.length - 1 &&
      traversedLength + segmentLengths[segmentIndex]! < targetDistance
    ) {
      traversedLength += segmentLengths[segmentIndex]!;
      segmentIndex += 1;
    }

    const start = points[segmentIndex]!;
    const end = points[segmentIndex + 1]!;
    const segmentLength = segmentLengths[segmentIndex]!;
    if (segmentLength <= 1e-9) {
      result.push([start[0], start[1]]);
      continue;
    }

    const t = Math.min(
      1,
      Math.max(0, (targetDistance - traversedLength) / segmentLength),
    );
    result.push(interpolatePoint(start, end, t));
  }

  result.push([
    points[points.length - 1]![0],
    points[points.length - 1]![1],
  ]);
  return result;
}


function findNearestWaypointIndex(
  map: L.Map,
  pathPoints: [number, number][],
  containerPoint: L.Point,
  maxDistancePx = 12,
): number | null {
  let hitIndex: number | null = null;
  let bestDistanceSq = maxDistancePx * maxDistancePx;

  for (let index = 0; index < pathPoints.length; index++) {
    const point = pathPoints[index]!;
    const pixelPoint = map.latLngToContainerPoint([point[0], point[1]]);
    const dx = pixelPoint.x - containerPoint.x;
    const dy = pixelPoint.y - containerPoint.y;
    const distanceSq = dx * dx + dy * dy;
    if (distanceSq <= bestDistanceSq) {
      bestDistanceSq = distanceSq;
      hitIndex = index;
    }
  }

  return hitIndex;
}

function MapClickHandler({
  drawTool,
  pathPoints,
  onAddPoint,
  onAddMark,
  onSelectWaypoint,
}: {
  drawTool: DrawTool;
  pathPoints: [number, number][];
  onAddPoint: (lat: number, lon: number) => void;
  onAddMark: (lat: number, lon: number) => void;
  onSelectWaypoint: (index: number | null) => void;
}) {
  const map = useMapEvents({
    click(event) {
      if (drawTool === 'path') onAddPoint(event.latlng.lat, event.latlng.lng);
      if (drawTool === 'mark') onAddMark(event.latlng.lat, event.latlng.lng);
      if (drawTool === 'select') {
        onSelectWaypoint(findNearestWaypointIndex(map, pathPoints, event.containerPoint));
      }
    },
  });
  return null;
}

/** With Select tool + a selected waypoint, wheel cycles prev/next index instead of zooming. */
function SelectWheelWaypointCycle({
  active,
  pathLength,
  onStep,
}: {
  active: boolean;
  pathLength: number;
  onStep: (direction: 1 | -1) => void;
}) {
  const map = useMap();
  const onStepRef = useRef(onStep);
  onStepRef.current = onStep;

  useEffect(() => {
    if (active && pathLength > 0) {
      map.scrollWheelZoom.disable();
    } else {
      map.scrollWheelZoom.enable();
    }
    return () => {
      map.scrollWheelZoom.enable();
    };
  }, [map, active, pathLength]);

  useEffect(() => {
    if (!active || pathLength === 0) return;

    const el = map.getContainer();
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY === 0) return;
      e.preventDefault();
      e.stopPropagation();
      onStepRef.current(e.deltaY > 0 ? 1 : -1);
    };
    el.addEventListener('wheel', onWheel, { passive: false, capture: true });
    return () => {
      el.removeEventListener('wheel', onWheel, { capture: true });
    };
  }, [map, active, pathLength]);

  return null;
}

function FitToContent({
  pathPoints,
  localMarks,
  fitVersion,
}: {
  pathPoints: [number, number][];
  localMarks: LocalMark[];
  fitVersion: number;
}) {
  const map = useMap();
  useEffect(() => {
    if (fitVersion === 0) return;
    const points: LatLngExpression[] = [
      ...pathPoints.map((point) => [point[0], point[1]] as LatLngExpression),
      ...localMarks.map((mark) => [mark.lat, mark.lon] as LatLngExpression),
    ];
    if (points.length === 0) return;
    const bounds = L.latLngBounds(points);
    if (bounds.isValid()) {
      map.fitBounds(bounds.pad(0.15), { animate: false });
    }
  }, [fitVersion, map]);
  return null;
}

function WaypointCanvasLayer({
  pathPoints,
  selectedWaypoint,
  color,
}: {
  pathPoints: [number, number][];
  selectedWaypoint: number | null;
  color: string;
}) {
  const map = useMap();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<number | null>(null);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const pane = map.getPane(WAYPOINT_CANVAS_PANE);
    if (!canvas || !pane) return;

    const size = map.getSize();
    const pixelRatio = window.devicePixelRatio || 1;
    const targetWidth = Math.max(1, Math.round(size.x * pixelRatio));
    const targetHeight = Math.max(1, Math.round(size.y * pixelRatio));

    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      canvas.style.width = `${size.x}px`;
      canvas.style.height = `${size.y}px`;
    }

    const topLeft = map.containerPointToLayerPoint([0, 0]);
    L.DomUtil.setPosition(canvas, topLeft);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

    const zoom = map.getZoom();
    const bucketSize =
      pathPoints.length > 5000 ? 12 : pathPoints.length > 2000 ? 9 : pathPoints.length > 800 ? 7 : 0;
    const visiblePoints: Array<{
      x: number;
      y: number;
      index: number;
      worldX: number;
      worldY: number;
    }> = [];
    const bucketedPoints = new Map<
      string,
      { x: number; y: number; index: number; worldX: number; worldY: number }
    >();
    const viewportPadding = 18;
    let lastVisiblePoint: {
      x: number;
      y: number;
      index: number;
      worldX: number;
      worldY: number;
    } | null = null;

    for (let index = 0; index < pathPoints.length; index++) {
      if (index === selectedWaypoint) continue;

      const point = pathPoints[index]!;
      const layerPoint = map.latLngToLayerPoint([point[0], point[1]]);
      const worldPoint = map.project([point[0], point[1]], zoom);
      const pixelPoint = layerPoint.subtract(topLeft);
      if (
        pixelPoint.x < -viewportPadding ||
        pixelPoint.y < -viewportPadding ||
        pixelPoint.x > size.x + viewportPadding ||
        pixelPoint.y > size.y + viewportPadding
      ) {
        continue;
      }

      const renderPoint = {
        x: pixelPoint.x,
        y: pixelPoint.y,
        index,
        worldX: worldPoint.x,
        worldY: worldPoint.y,
      };
      lastVisiblePoint = renderPoint;
      if (bucketSize > 0) {
        const bucketX = Math.floor(worldPoint.x / bucketSize);
        const bucketY = Math.floor(worldPoint.y / bucketSize);
        const bucketCenterX = (bucketX + 0.5) * bucketSize;
        const bucketCenterY = (bucketY + 0.5) * bucketSize;
        const key = `${bucketX}:${bucketY}`;
        const existingPoint = bucketedPoints.get(key);
        const candidateDistanceSq =
          (renderPoint.worldX - bucketCenterX) ** 2 +
          (renderPoint.worldY - bucketCenterY) ** 2;
        const existingDistanceSq = existingPoint
          ? (existingPoint.worldX - bucketCenterX) ** 2 +
            (existingPoint.worldY - bucketCenterY) ** 2
          : Number.POSITIVE_INFINITY;
        if (
          !existingPoint ||
          candidateDistanceSq < existingDistanceSq ||
          (candidateDistanceSq === existingDistanceSq &&
            renderPoint.index < existingPoint.index)
        ) {
          bucketedPoints.set(key, renderPoint);
        }
      } else {
        visiblePoints.push(renderPoint);
      }
    }

    if (bucketSize > 0) {
      visiblePoints.push(...bucketedPoints.values());
    }

    if (lastVisiblePoint && !visiblePoints.some((item) => item.index === lastVisiblePoint.index)) {
      visiblePoints.push(lastVisiblePoint);
    }

    if (visiblePoints.length === 0) return;

    visiblePoints.sort((left, right) => left.index - right.index);
    // When zoomed in, the viewport holds fewer distinct samples — never hide points behind
    // "very dense" mode (that mode is for overview / zoomed-out clutter only).
    const showLabels =
      pathPoints.length <= WAYPOINT_LABEL_LIMIT && visiblePoints.length <= WAYPOINT_LABEL_LIMIT;
    const isDense = visiblePoints.length > 300 && zoom < 16;
    const isVeryDense = visiblePoints.length > 800 && zoom < 15;

    // If it's extremely dense (overview only), skip per-point drawing; polyline carries the shape.
    if (isVeryDense) {
      if (lastVisiblePoint) {
        ctx.beginPath();
        ctx.arc(lastVisiblePoint.x, lastVisiblePoint.y, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 0.75;
        ctx.stroke();
      }
      return;
    }

    const pointRadius = showLabels ? 4 : isDense ? 1 : 1.75;

    ctx.fillStyle = showLabels ? color : '#ffffff';

    if (showLabels) {
      ctx.font = '700 8px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
    }

    for (const point of visiblePoints) {
      ctx.beginPath();
      ctx.arc(point.x, point.y, pointRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = showLabels ? 'rgba(255,255,255,0.88)' : color;
      ctx.lineWidth = 0.75;
      ctx.stroke();

      if (showLabels) {
        ctx.fillStyle = '#ffffff';
        ctx.fillText(`${point.index + 1}`, point.x, point.y + 0.5);
        ctx.fillStyle = color;
      }
    }

    if (lastVisiblePoint && !isVeryDense) {
      ctx.beginPath();
      ctx.arc(lastVisiblePoint.x, lastVisiblePoint.y, pointRadius + 1, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(245,158,11,0.95)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }, [color, map, pathPoints, selectedWaypoint]);

  const scheduleRedraw = useCallback(() => {
    if (frameRef.current != null) {
      window.cancelAnimationFrame(frameRef.current);
    }
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      redraw();
    });
  }, [redraw]);

  useEffect(() => {
    const pane = map.getPane(WAYPOINT_CANVAS_PANE);
    if (!pane) return;

    const canvas = L.DomUtil.create('canvas', 'sailsiq-waypoint-canvas', pane) as HTMLCanvasElement;
    canvas.style.position = 'absolute';
    canvas.style.left = '0';
    canvas.style.top = '0';
    canvas.style.pointerEvents = 'none';
    canvasRef.current = canvas;

    return () => {
      if (frameRef.current != null) {
        window.cancelAnimationFrame(frameRef.current);
      }
      canvas.remove();
      canvasRef.current = null;
    };
  }, [map]);

  useEffect(() => {
    map.on('zoomend', scheduleRedraw);
    map.on('moveend', scheduleRedraw);
    map.on('resize', scheduleRedraw);
    map.on('viewreset', scheduleRedraw);

    return () => {
      map.off('zoomend', scheduleRedraw);
      map.off('moveend', scheduleRedraw);
      map.off('resize', scheduleRedraw);
      map.off('viewreset', scheduleRedraw);
    };
  }, [map, scheduleRedraw]);

  useEffect(() => {
    scheduleRedraw();
  }, [scheduleRedraw]);

  return null;
}

function SelectedWaypointLayer({
  pathPoints,
  selectedWaypoint,
  drawTool,
  onMoveWaypoint,
}: {
  pathPoints: [number, number][];
  selectedWaypoint: number | null;
  drawTool: DrawTool;
  onMoveWaypoint: (index: number, lat: number, lon: number) => void;
}) {
  if (selectedWaypoint == null) return null;

  const point = pathPoints[selectedWaypoint];
  if (!point) return null;

  return (
    <Pane name="selected-waypoint-pane" style={{ zIndex: 435 }}>
      <Marker
        position={[point[0], point[1]]}
        icon={createWaypointIcon(selectedWaypoint, '#ef4444')}
        draggable={drawTool === 'select'}
        eventHandlers={{
          dragend(event) {
            const latLng = event.target.getLatLng();
            onMoveWaypoint(selectedWaypoint, latLng.lat, latLng.lng);
          },
        }}
      >
        <Tooltip permanent direction="top">
          Waypoint {selectedWaypoint + 1}
        </Tooltip>
      </Marker>
    </Pane>
  );
}

export default function CanvasWorkspacePage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { s } = useTheme();
  const { currentWorkspace } = useWorkspaceContext();
  const [session, setSession] = useState<Session | null>(null);
  const [canvasType, setCanvasType] = useState<CanvasType>('worldmap');
  const [mapLayer, setMapLayer] = useState<MapBaselayerKind>('vector');
  const [drawTool, setDrawTool] = useState<DrawTool>('select');
  const [markType, setMarkType] = useState<MarkType>('mark');
  const [pathPoints, setPathPoints] = useState<[number, number][]>([]);
  const [localMarks, setLocalMarks] = useState<LocalMark[]>([]);
  const [selectedWaypoint, setSelectedWaypoint] = useState<number | null>(null);
  const [selectedMarkId, setSelectedMarkId] = useState<string | null>(null);
  const [windDir, setWindDir] = useState(0);
  const [windSpeed, setWindSpeed] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fitVersion, setFitVersion] = useState(0);
  const [nodeCountInput, setNodeCountInput] = useState('');
  const [pathBeforeNodeAdjust, setPathBeforeNodeAdjust] = useState<[number, number][] | null>(null);
  const initialMarkIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!sessionId) return;
    const load = async () => {
      if (currentWorkspace) {
        const localSession = await getLocalCanvasSession(currentWorkspace.id, sessionId);
        if (localSession) {
          const [track, marks] = await Promise.all([
            getLocalCanvasTrack(currentWorkspace.id, sessionId),
            getLocalCanvasMarks(currentWorkspace.id, sessionId),
          ]);
          return { nextSession: localSession, track, marks, local: true as const };
        }
      }

      const [nextSession, track, marks] = await Promise.all([
        sessionApi.get(sessionId),
        trackApi.get(sessionId),
        markApi.list(sessionId),
      ]);
      return { nextSession, track, marks, local: false as const };
    };

    void load()
      .then(({ nextSession, track, marks, local: _local }) => {
        setSession(nextSession);
        setCanvasType(nextSession.canvasType ?? 'worldmap');
        setPathPoints(track.map((point) => [point.lat, point.lon] as [number, number]));
        setPathBeforeNodeAdjust(null);
        setLocalMarks(
          marks.map((mark) => ({
            id: mark.id,
            type: mark.type,
            name: mark.name ?? MARK_TYPES.find((item) => item.type === mark.type)?.label ?? mark.type,
            lat: mark.lat,
            lon: mark.lon,
          })),
        );
        initialMarkIdsRef.current = new Set(marks.map((mark) => mark.id));
        if (track[0]?.w_d != null) setWindDir(Math.round(track[0].w_d));
        if (track[0]?.w_s != null) setWindSpeed(track[0].w_s);
        setFitVersion((version) => version + 1);
      })
      .catch(() => {});
  }, [currentWorkspace, sessionId]);

  useEffect(() => {
    setNodeCountInput(pathPoints.length > 0 ? String(pathPoints.length) : '');
    setSelectedWaypoint((prev) => {
      if (prev == null) return prev;
      if (pathPoints.length === 0) return null;
      return Math.min(prev, pathPoints.length - 1);
    });
  }, [pathPoints.length]);

  const selectedMark = localMarks.find((mark) => mark.id === selectedMarkId) ?? null;
  const positions = pathPoints as LatLngExpression[];
  const parsedNodeCountInput = Number(nodeCountInput);
  const hasValidNodeCountInput = Number.isFinite(parsedNodeCountInput);
  const minAdjustableWaypointCount = pathPoints.length > 1 ? 2 : 1;
  const roundedNodeCountInput = hasValidNodeCountInput ? Math.round(parsedNodeCountInput) : pathPoints.length;
  const maxAdjustableWaypointCount = Math.max(
    minAdjustableWaypointCount,
    pathPoints.length * 2,
    hasValidNodeCountInput ? roundedNodeCountInput : 0,
  );
  const canApplyNodeCount =
    pathPoints.length >= 2 &&
    hasValidNodeCountInput &&
    roundedNodeCountInput >= minAdjustableWaypointCount &&
    roundedNodeCountInput !== pathPoints.length;

  const handleAddPoint = useCallback((lat: number, lon: number) => {
    setPathBeforeNodeAdjust(null);
    setPathPoints((prev) => [...prev, [lat, lon]]);
    setSelectedWaypoint(null);
    setSelectedMarkId(null);
  }, []);

  const handleAddMark = useCallback((lat: number, lon: number) => {
    const label = MARK_TYPES.find((item) => item.type === markType)?.label ?? markType;
    setLocalMarks((prev) => [
      ...prev,
      { id: `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, type: markType, name: label, lat, lon },
    ]);
    setSelectedWaypoint(null);
    setSelectedMarkId(null);
  }, [markType]);

  const handleMoveWaypoint = useCallback((index: number, lat: number, lon: number) => {
    setPathBeforeNodeAdjust(null);
    setPathPoints((prev) =>
      prev.map((item, itemIndex) => (itemIndex === index ? [lat, lon] : item)),
    );
  }, []);

  const handleWaypointWheelStep = useCallback((direction: 1 | -1) => {
    setSelectedMarkId(null);
    setSelectedWaypoint((prev) => {
      if (prev == null) return prev;
      const next = prev + direction;
      return Math.max(0, Math.min(pathPoints.length - 1, next));
    });
  }, [pathPoints.length]);

  const handleApplyNodeCount = useCallback(() => {
    if (!canApplyNodeCount) return;
    setPathBeforeNodeAdjust(clonePathPoints(pathPoints));
    setPathPoints(redistributePathPoints(pathPoints, roundedNodeCountInput));
    setSelectedWaypoint(null);
    setSelectedMarkId(null);
  }, [canApplyNodeCount, pathPoints, roundedNodeCountInput]);

  const handleRestoreNodeAdjust = useCallback(() => {
    if (!pathBeforeNodeAdjust) return;
    setPathPoints(clonePathPoints(pathBeforeNodeAdjust));
    setPathBeforeNodeAdjust(null);
    setSelectedWaypoint(null);
    setSelectedMarkId(null);
  }, [pathBeforeNodeAdjust]);

  const handleSave = useCallback(async () => {
    if (!sessionId) return;
    setSaving(true);
    setSaveError(null);
    try {
      const intervalMs = 5000;
      const trackPoints: TrackPoint[] = pathPoints.map((point, index) => {
        const prev = pathPoints[index - 1];
        const next = pathPoints[index + 1];
        const target = next ?? prev ?? point;
        const source = next ? point : prev ?? point;
        const heading = source === target ? 0 : calculateBearing(source[0], source[1], target[0], target[1]);
        const distance = source === target ? 0 : haversineDistance(source[0], source[1], target[0], target[1]);
        return {
          t: index * intervalMs,
          lat: point[0],
          lon: point[1],
          h: Math.round(heading),
          s: Math.round((distance / (intervalMs / 1000)) * 1.94384 * 10) / 10,
          ...(windDir > 0 ? { w_d: windDir } : {}),
          ...(windSpeed > 0 ? { w_s: windSpeed } : {}),
        };
      });

      let totalDistance = 0;
      const speeds: number[] = [];
      for (let i = 1; i < trackPoints.length; i++) {
        totalDistance += haversineDistance(
          trackPoints[i - 1]!.lat,
          trackPoints[i - 1]!.lon,
          trackPoints[i]!.lat,
          trackPoints[i]!.lon,
        );
        if (trackPoints[i]!.s != null) speeds.push(trackPoints[i]!.s!);
      }

      const nextStats = {
        duration: trackPoints.length > 1 ? (trackPoints.length - 1) * (intervalMs / 1000) : 0,
        distance: Math.round(totalDistance),
        avgSpeed: speeds.length > 0 ? Math.round((speeds.reduce((a, b) => a + b, 0) / speeds.length) * 10) / 10 : 0,
        maxSpeed: speeds.length > 0 ? Math.max(...speeds) : 0,
        turnCount: countTurns(trackPoints),
      };
      const nextMarks: Mark[] = localMarks.map((mark, index) => ({
        id: mark.id,
        sessionId,
        type: mark.type,
        name: mark.name,
        lat: mark.lat,
        lon: mark.lon,
        order: index,
      }));

      if (currentWorkspace && session) {
        const nextSession: Session = {
          ...session,
          stats: nextStats,
          canvasType,
          updatedAt: new Date().toISOString(),
        };
        await saveLocalCanvasSession(currentWorkspace.id, sessionId, {
          session: nextSession,
          track: trackPoints,
          marks: nextMarks,
        });
        setSession(nextSession);
        initialMarkIdsRef.current = new Set(nextMarks.map((mark) => mark.id));
        navigate('/');
        return;
      }

      await sessionApi.update(sessionId, {
        stats: nextStats,
      });
      await trackApi.upload(sessionId, trackPoints);

      const currentIds = new Set(localMarks.map((mark) => mark.id));
      for (const mark of localMarks) {
        if (initialMarkIdsRef.current.has(mark.id)) {
          await markApi.update(sessionId, mark.id, { type: mark.type, name: mark.name, lat: mark.lat, lon: mark.lon });
        } else {
          await markApi.create(sessionId, { type: mark.type, name: mark.name, lat: mark.lat, lon: mark.lon });
        }
      }
      for (const markId of initialMarkIdsRef.current) {
        if (!currentIds.has(markId)) await markApi.delete(sessionId, markId);
      }

      navigate(`/session/${sessionId}/replay`);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Failed to save canvas session.');
    } finally {
      setSaving(false);
    }
  }, [canvasType, currentWorkspace, localMarks, navigate, pathPoints, session, sessionId, windDir, windSpeed]);

  const blankBgStyle =
    canvasType === 'blank'
      ? {
          backgroundImage:
            'linear-gradient(rgba(100,116,139,0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(100,116,139,0.12) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
          backgroundColor: '#f0f4f8',
        }
      : {};

  return (
    <div className={`h-screen w-full flex flex-col overflow-hidden ${s.wrapper}`}>
      <header className={`border-b ${s.divider} ${s.panel}`}>
        <div className="flex flex-wrap items-center gap-2 px-3 py-2">
          <Link to="/" className={`flex h-8 w-8 items-center justify-center ${s.buttonSecondary}`}>
            <ChevronLeft className="w-4 h-4" />
          </Link>
          <div className="min-w-0 mr-2">
            <div className={`text-[10px] uppercase tracking-widest ${s.textSecondary}`}>Canvas Mode</div>
            <div className={`max-w-[180px] truncate text-sm font-semibold ${s.textPrimary}`}>{session?.name ?? '...'}</div>
          </div>
          <div className="w-full md:ml-auto md:w-auto">
            <SessionTabs sessionId={sessionId} compact className="max-w-full" />
          </div>
          <Link
            to="/settings"
            className={`flex h-8 w-8 items-center justify-center ${s.buttonSecondary}`}
            title="Settings"
          >
            <Settings className="w-4 h-4" />
          </Link>
        </div>

        <div className={`flex flex-wrap items-center gap-3 border-t ${s.divider} px-4 py-2.5 shadow-sm`}>
          <div className={`flex items-center rounded-md p-0.5 ${s.panel} border ${s.divider}`}>
            <button type="button" onClick={() => setDrawTool('select')} className={`px-3 py-1.5 text-xs rounded-sm transition-colors ${drawTool === 'select' ? s.accentBg : 'hover:bg-black/5 dark:hover:bg-white/5'}`}><Move className="w-3.5 h-3.5 inline mr-1.5" />Select</button>
            <button type="button" onClick={() => setDrawTool('path')} className={`px-3 py-1.5 text-xs rounded-sm transition-colors ${drawTool === 'path' ? s.accentBg : 'hover:bg-black/5 dark:hover:bg-white/5'}`}><Pencil className="w-3.5 h-3.5 inline mr-1.5" />Path</button>
            <button type="button" onClick={() => setDrawTool('mark')} className={`px-3 py-1.5 text-xs rounded-sm transition-colors ${drawTool === 'mark' ? s.accentBg : 'hover:bg-black/5 dark:hover:bg-white/5'}`}><MapPin className="w-3.5 h-3.5 inline mr-1.5" />Mark</button>
          </div>
          
          <div className="h-4 w-px bg-slate-300 dark:bg-slate-700" />
          
          <select value={markType} onChange={(e) => setMarkType(e.target.value as MarkType)} className={`px-3 py-1.5 text-xs rounded-md border ${s.divider} bg-transparent focus:outline-none focus:ring-1 focus:ring-amber-500`}>
            {MARK_TYPES.map((item) => <option key={item.type} value={item.type}>{item.label}</option>)}
          </select>
          
          <div className="h-4 w-px bg-slate-300 dark:bg-slate-700" />

          <button
            type="button"
            onClick={() =>
              setMapLayer((layer) => (layer === 'vector' ? 'satellite' : layer === 'satellite' ? 'gray' : 'vector'))
            }
            className={`px-3 py-1.5 text-xs rounded-md border ${s.divider} hover:bg-black/5 dark:hover:bg-white/5 transition-colors`}
          >
            {canvasType === 'worldmap' ? <MapIcon className="w-3.5 h-3.5 inline mr-1.5" /> : <Grid className="w-3.5 h-3.5 inline mr-1.5" />}
            {mapLayer === 'vector' ? 'Satellite' : mapLayer === 'satellite' ? 'Solid gray' : 'Vector'}
          </button>
          
          <div className="h-4 w-px bg-slate-300 dark:bg-slate-700" />

          <button type="button" onClick={() => { setPathBeforeNodeAdjust(null); setPathPoints((prev) => prev.slice(0, -1)); }} className={`px-3 py-1.5 text-xs rounded-md border ${s.divider} hover:bg-black/5 dark:hover:bg-white/5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed`} disabled={pathPoints.length === 0}><Undo2 className="w-3.5 h-3.5 inline mr-1.5" />Undo</button>
          <button type="button" onClick={() => { setPathBeforeNodeAdjust(null); setPathPoints([]); }} className={`px-3 py-1.5 text-xs rounded-md border ${s.divider} hover:bg-black/5 dark:hover:bg-white/5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-red-600 dark:text-red-400`} disabled={pathPoints.length === 0}><Trash2 className="w-3.5 h-3.5 inline mr-1.5" />Clear</button>
          
          <div className="flex-1" />
          
          <button type="button" onClick={handleSave} disabled={saving || (pathPoints.length === 0 && localMarks.length === 0)} className={`px-4 py-2 text-sm font-medium rounded-md shadow-sm transition-all ${s.buttonPrimary} ${saving ? 'opacity-40 cursor-not-allowed' : 'hover:shadow-md active:scale-95'}`}>
            <Save className="w-4 h-4 inline mr-1.5" />
            {saving ? 'Saving...' : currentWorkspace ? 'Save to Workspace' : 'Save & Replay'}
          </button>
        </div>
      </header>

      <div className="flex-1 min-h-0 grid grid-cols-[minmax(0,1fr)_280px]" style={blankBgStyle}>
        <div className="relative min-h-0">
          <div className={`absolute top-4 left-4 z-[1000] px-3 py-2 text-xs ${s.panel}`}>
            <div className={s.textSecondary}>{pathPoints.length} waypoints | {localMarks.length} marks</div>
          </div>
          <WindWidget
            windDir={windDir}
            windSpeed={windSpeed}
            onWindChange={(dir, speed) => {
              setWindDir(dir);
              setWindSpeed(speed);
            }}
          />
          <MapContainer center={canvasType === 'blank' ? [0, 0] : [25, 0]} zoom={canvasType === 'blank' ? 14 : 3} className="w-full h-full" preferCanvas zoomControl={false} zoomAnimation={false}>
            <ResizeSync />
            <ZoomControls />
            <FitToContent pathPoints={pathPoints} localMarks={localMarks} fitVersion={fitVersion} />
            <MapClickHandler
              drawTool={drawTool}
              pathPoints={pathPoints}
              onAddPoint={handleAddPoint}
              onAddMark={handleAddMark}
              onSelectWaypoint={(index) => {
                setSelectedWaypoint(index);
                setSelectedMarkId(null);
              }}
            />
            <SelectWheelWaypointCycle
              active={drawTool === 'select' && selectedWaypoint != null && pathPoints.length > 0}
              pathLength={pathPoints.length}
              onStep={handleWaypointWheelStep}
            />
            {canvasType === 'worldmap' && (
              <BaseTileLayer mapLayer={mapLayer} />
            )}
            {positions.length >= 2 && (
              <>
                <Pane name="route-base" style={{ zIndex: 420 }}>
                  <Polyline
                    positions={positions}
                    pathOptions={{
                      color: s.routeColor,
                      opacity: 0.22,
                      weight: 0.6,
                      lineCap: 'round',
                      lineJoin: 'round',
                    }}
                  />
                </Pane>
                <Pane name="route-progress" style={{ zIndex: 430 }}>
                  <Polyline
                    positions={positions}
                    pathOptions={{
                      color: s.routeColor,
                      opacity: 0.95,
                      weight: 0.75,
                      lineCap: 'round',
                      lineJoin: 'round',
                    }}
                  />
                </Pane>
              </>
            )}
            <Pane name={WAYPOINT_CANVAS_PANE} style={{ zIndex: 425, pointerEvents: 'none' }}>
              <WaypointCanvasLayer
                pathPoints={pathPoints}
                selectedWaypoint={selectedWaypoint}
                color={s.routeColor}
              />
            </Pane>
            <SelectedWaypointLayer
              pathPoints={pathPoints}
              selectedWaypoint={selectedWaypoint}
              drawTool={drawTool}
              onMoveWaypoint={handleMoveWaypoint}
            />
            <Pane name="mark-pane" style={{ zIndex: 440 }}>
              {localMarks.map((mark) => (
                <Marker
                  key={mark.id}
                  position={[mark.lat, mark.lon]}
                  icon={createMarkIcon(mark.type, selectedMarkId === mark.id ? '#ef4444' : '#ef4444')}
                  draggable={drawTool === 'select'}
                  eventHandlers={{
                    click() {
                      setSelectedMarkId(mark.id);
                      setSelectedWaypoint(null);
                    },
                    dragend(event) {
                      const latLng = event.target.getLatLng();
                      setLocalMarks((prev) => prev.map((item) => (item.id === mark.id ? { ...item, lat: latLng.lat, lon: latLng.lng } : item)));
                    },
                  }}
                >
                  <Tooltip permanent direction="top">{mark.name}</Tooltip>
                </Marker>
              ))}
            </Pane>
          </MapContainer>
        </div>

        <aside className={`border-l ${s.divider} ${s.panel} p-5 overflow-y-auto flex flex-col gap-6 shadow-[-4px_0_15px_rgba(0,0,0,0.03)] z-10`}>
          <div>
            <div className={`text-[10px] font-bold uppercase tracking-widest ${s.textSecondary} mb-1`}>Canvas Detail</div>
            <div className={`text-sm font-medium ${s.textPrimary} flex items-center gap-2`}>
              {canvasType === 'worldmap' ? <MapIcon className="w-4 h-4 text-blue-500" /> : <Grid className="w-4 h-4 text-slate-500" />}
              {canvasType === 'worldmap' ? 'World Map' : 'Blank Canvas'}
            </div>
          </div>

          {pathPoints.length >= 2 && (
            <div className={`p-4 rounded-xl border ${s.divider} bg-black/5 dark:bg-white/5 space-y-4`}>
              <div className="flex items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-700 pb-3">
                <div>
                  <div className={`text-sm font-semibold ${s.textPrimary}`}>Waypoint Count</div>
                  <div className={`text-[10px] uppercase tracking-wider ${s.textSecondary}`}>
                    Rebuild the line with a new node count.
                  </div>
                </div>
                <div className={`text-xs font-mono ${s.textSecondary}`}>{pathPoints.length} current</div>
              </div>

              <input
                type="range"
                min={minAdjustableWaypointCount}
                max={maxAdjustableWaypointCount}
                step={1}
                value={Math.min(
                  maxAdjustableWaypointCount,
                  Math.max(
                    minAdjustableWaypointCount,
                    hasValidNodeCountInput ? roundedNodeCountInput : pathPoints.length,
                  ),
                )}
                onChange={(e) => setNodeCountInput(e.target.value)}
                className="w-full"
              />

              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={minAdjustableWaypointCount}
                  max={maxAdjustableWaypointCount}
                  step={1}
                  value={nodeCountInput}
                  onChange={(e) => setNodeCountInput(e.target.value)}
                  className={`w-full px-3 py-2 text-sm rounded-md border ${s.divider} bg-white dark:bg-black/40 focus:outline-none focus:ring-2 focus:ring-amber-500/50 transition-shadow`}
                />
                <button
                  type="button"
                  onClick={() => setNodeCountInput(String(Math.max(2, Math.round(pathPoints.length * 0.75))))}
                  className={`px-3 py-2 text-xs rounded-md border ${s.divider} hover:bg-black/5 dark:hover:bg-white/5 transition-colors`}
                >
                  75%
                </button>
                <button
                  type="button"
                  onClick={() => setNodeCountInput(String(Math.max(2, Math.round(pathPoints.length * 1.25))))}
                  className={`px-3 py-2 text-xs rounded-md border ${s.divider} hover:bg-black/5 dark:hover:bg-white/5 transition-colors`}
                >
                  125%
                </button>
              </div>

              <div className={`text-[11px] leading-5 ${s.textSecondary}`}>
                Start and end stay fixed. Intermediate waypoints are redistributed along the current polyline.
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleApplyNodeCount}
                  disabled={!canApplyNodeCount}
                  className={`flex-1 px-3 py-2 text-sm rounded-md border ${s.divider} transition-colors ${
                    canApplyNodeCount
                      ? 'hover:bg-black/5 dark:hover:bg-white/5'
                      : 'opacity-40 cursor-not-allowed'
                  }`}
                >
                  Apply
                </button>
                <button
                  type="button"
                  onClick={handleRestoreNodeAdjust}
                  disabled={!pathBeforeNodeAdjust}
                  className={`px-3 py-2 text-sm rounded-md border ${s.divider} transition-colors ${
                    pathBeforeNodeAdjust
                      ? 'hover:bg-black/5 dark:hover:bg-white/5'
                      : 'opacity-40 cursor-not-allowed'
                  }`}
                >
                  Restore
                </button>
              </div>
            </div>
          )}
          
          {selectedWaypoint != null && pathPoints[selectedWaypoint] && (
            <div className={`p-4 rounded-xl border ${s.divider} bg-black/5 dark:bg-white/5 space-y-4`}>
              <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-700 pb-3">
                <div className="w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center text-xs font-bold shadow-sm">{selectedWaypoint + 1}</div>
                <div className={`text-sm font-semibold ${s.textPrimary}`}>Waypoint</div>
              </div>
              
              <div className="space-y-1">
                <div className={`text-[10px] uppercase tracking-wider ${s.textSecondary}`}>Coordinates</div>
                <div className={`text-xs font-mono bg-white dark:bg-black/40 p-2 rounded border ${s.divider} ${s.textPrimary}`}>
                  {pathPoints[selectedWaypoint]![0].toFixed(5)}, {pathPoints[selectedWaypoint]![1].toFixed(5)}
                </div>
              </div>
              
              <button type="button" onClick={() => { setPathBeforeNodeAdjust(null); setPathPoints((prev) => prev.filter((_, index) => index !== selectedWaypoint)); setSelectedWaypoint(null); }} className={`w-full px-3 py-2 text-sm rounded-md border border-red-200 dark:border-red-900/50 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors flex items-center justify-center gap-2`}>
                <Trash2 className="w-4 h-4" />
                Delete Waypoint
              </button>
            </div>
          )}
          
          {selectedMark && (
            <div className={`p-4 rounded-xl border ${s.divider} bg-black/5 dark:bg-white/5 space-y-4`}>
              <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-700 pb-3">
                <MapPin className="w-5 h-5 text-red-500" />
                <div className={`text-sm font-semibold ${s.textPrimary}`}>Course Mark</div>
              </div>
              
              <div className="space-y-3">
                <div className="space-y-1">
                  <div className={`text-[10px] uppercase tracking-wider ${s.textSecondary}`}>Name</div>
                  <input type="text" value={selectedMark.name} onChange={(e) => setLocalMarks((prev) => prev.map((mark) => (mark.id === selectedMark.id ? { ...mark, name: e.target.value } : mark)))} className={`w-full px-3 py-2 text-sm rounded-md border ${s.divider} bg-white dark:bg-black/40 focus:outline-none focus:ring-2 focus:ring-amber-500/50 transition-shadow`} />
                </div>
                
                <div className="space-y-1">
                  <div className={`text-[10px] uppercase tracking-wider ${s.textSecondary}`}>Type</div>
                  <select value={selectedMark.type} onChange={(e) => setLocalMarks((prev) => prev.map((mark) => (mark.id === selectedMark.id ? { ...mark, type: e.target.value as MarkType } : mark)))} className={`w-full px-3 py-2 text-sm rounded-md border ${s.divider} bg-white dark:bg-black/40 focus:outline-none focus:ring-2 focus:ring-amber-500/50 transition-shadow`}>
                    {MARK_TYPES.map((item) => <option key={item.type} value={item.type}>{item.label}</option>)}
                  </select>
                </div>
                
                <div className="space-y-1">
                  <div className={`text-[10px] uppercase tracking-wider ${s.textSecondary}`}>Coordinates</div>
                  <div className={`text-xs font-mono bg-white dark:bg-black/40 p-2 rounded border ${s.divider} ${s.textPrimary}`}>
                    {selectedMark.lat.toFixed(5)}, {selectedMark.lon.toFixed(5)}
                  </div>
                </div>
              </div>
              
              <button type="button" onClick={() => { setLocalMarks((prev) => prev.filter((mark) => mark.id !== selectedMark.id)); setSelectedMarkId(null); }} className={`w-full px-3 py-2 text-sm rounded-md border border-red-200 dark:border-red-900/50 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors flex items-center justify-center gap-2`}>
                <Trash2 className="w-4 h-4" />
                Delete Mark
              </button>
            </div>
          )}
          
          {selectedWaypoint == null && !selectedMark && (
            <div className={`mt-2 p-4 rounded-xl border border-dashed ${s.divider} bg-transparent flex flex-col items-center justify-center text-center gap-3`}>
              <MousePointer2 className={`w-8 h-8 ${s.textSecondary} opacity-50`} />
              <div className={`text-sm ${s.textSecondary}`}>
                Select a waypoint or mark to edit it.<br/><br/>
                Existing track and marks are loaded when you reopen a canvas session.
              </div>
            </div>
          )}
          
          {saveError ? (
            <div className="mt-auto p-3 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/50 text-sm text-red-600 dark:text-red-400">
              {saveError}
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
