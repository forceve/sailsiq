import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Wind,
  Map as MapIcon,
  MapPin,
  Camera,
  Flag,
  LocateFixed,
  Layers3,
  Square,
  Plus,
  Minus,
  Maximize,
  Route,
  MousePointer2,
  Ruler,
  Crosshair,
} from 'lucide-react';
import { MapContainer, Marker, Pane, Polyline, Tooltip, useMap } from 'react-leaflet';
import L, { type DivIcon, type LatLngExpression } from 'leaflet';
import { useTheme } from '@/theme/ThemeContext';
import {
  ZoomControls,
  WindWidget,
  BaseTileLayer,
  createMarkIcon,
  ResizeSync,
  type MapBaselayerKind,
} from '@/components/MapControls';
import { MAP_CONTROL_LAYER_CLASS } from '@/components/workspaceLayers';
import { getHeading } from '@/utils/trackPoint';
import type { TrackPoint, Mark as CourseMark } from '@/types/models';

interface MapCanvasProps {
  telemetry: TrackPoint[];
  marks: CourseMark[];
  playheadIndex: number;
  windDir?: number;
  windSpeed?: number;
  mapLayer?: MapBaselayerKind;
  onMapLayerChange?: (layer: MapBaselayerKind) => void;
  onSnapshot?: () => void;
  onAddEvent?: () => void;
  onAddMark?: () => void;
  onWindChange?: (dir: number, speed: number) => void;
  onMarkMove?: (markId: string, lat: number, lon: number) => void;
  viewportKey?: string;
  highlightRange?: {
    startIndex: number;
    endIndex: number;
  } | null;
  /** When set, base + progress routes only render this index span (hide the rest of the track). */
  routeClipRange?: {
    startIndex: number;
    endIndex: number;
  } | null;
  focusedMarkId?: string | null;
  overlay?: ReactNode;
  presentation?: boolean;
}

type MapViewMode = 'overview' | 'follow' | 'lead';

interface LayerVisibility {
  showRoute: boolean;
  showMarks: boolean;
  showScale: boolean;
  showCoords: boolean;
}

const ROUTE_CHUNK_SIZE = 512;

interface RouteRenderData {
  positions: LatLngExpression[];
  chunks: LatLngExpression[][];
}

const fullRouteRenderDataCache = new WeakMap<TrackPoint[], RouteRenderData>();
const telemetryBoundsCache = new WeakMap<TrackPoint[], L.LatLngBounds>();

function chunkPositions(positions: LatLngExpression[], chunkSize: number): LatLngExpression[][] {
  if (positions.length < 2) return [];

  const chunks: LatLngExpression[][] = [];
  for (let start = 0; start < positions.length - 1; start += chunkSize) {
    const end = Math.min(positions.length, start + chunkSize + 1);
    chunks.push(positions.slice(start, end));
  }

  return chunks;
}

function buildRouteRenderData(telemetry: TrackPoint[]): RouteRenderData {
  const cached = fullRouteRenderDataCache.get(telemetry);
  if (cached) return cached;

  const positions = telemetry.map((point) => [point.lat, point.lon] as LatLngExpression);
  const data = {
    positions,
    chunks: chunkPositions(positions, ROUTE_CHUNK_SIZE),
  };
  fullRouteRenderDataCache.set(telemetry, data);
  return data;
}

function buildTelemetryBounds(telemetry: TrackPoint[]): L.LatLngBounds | null {
  if (telemetry.length === 0) return null;
  const cached = telemetryBoundsCache.get(telemetry);
  if (cached) return cached;

  const bounds = L.latLngBounds(
    telemetry.map((point) => [point.lat, point.lon] as LatLngExpression),
  );
  if (bounds.isValid()) {
    telemetryBoundsCache.set(telemetry, bounds);
    return bounds;
  }
  return null;
}

function getViewportBounds(
  telemetry: TrackPoint[],
  marks: CourseMark[],
): L.LatLngBounds | null {
  const trackBounds = buildTelemetryBounds(telemetry);
  const bounds = trackBounds ? L.latLngBounds(trackBounds.getSouthWest(), trackBounds.getNorthEast()) : null;

  for (const mark of marks) {
    if (bounds) {
      bounds.extend([mark.lat, mark.lon]);
    }
  }

  if (bounds) return bounds.isValid() ? bounds : null;
  if (marks.length === 0) return null;
  const markBounds = L.latLngBounds(marks.map((mark) => [mark.lat, mark.lon] as LatLngExpression));
  return markBounds.isValid() ? markBounds : null;
}


function createBoatIcon(color: string, heading: number): DivIcon {
  return L.divIcon({
    className: 'sailsiq-boat-icon',
    html: `<div draggable="false" style="width:20px;height:20px;transform:rotate(${heading}deg);display:flex;align-items:center;justify-content:center;"><div draggable="false" style="width:0;height:0;border-left:8px solid transparent;border-right:8px solid transparent;border-bottom:18px solid ${color};filter:drop-shadow(0 2px 3px rgba(0,0,0,0.28));"></div></div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}




const InitialViewport = memo(function InitialViewport({
  telemetry,
  marks,
  mapViewMode,
  viewportKey,
}: {
  telemetry: TrackPoint[];
  marks: CourseMark[];
  mapViewMode: MapViewMode;
  viewportKey: string;
}) {
  const map = useMap();

  useEffect(() => {
    if (mapViewMode !== 'overview') return;

    const bounds = getViewportBounds(telemetry, marks);
    if (bounds?.isValid()) {
      map.fitBounds(bounds.pad(0.15), { animate: false });
    }
  }, [map, mapViewMode, viewportKey, telemetry, marks]);

  return null;
});

const FollowViewport = memo(function FollowViewport({
  mapViewMode,
  point,
}: {
  mapViewMode: MapViewMode;
  point?: TrackPoint;
}) {
  const map = useMap();

  useEffect(() => {
    if (mapViewMode === 'overview' || !point) return;

    const centerPoint =
      mapViewMode === 'lead'
        ? (() => {
            const zoom = map.getZoom();
            const pointPx = map.project([point.lat, point.lon], zoom);
            const heading = getHeading(point) * (Math.PI / 180);
            const lookaheadDistance = Math.max(80, map.getSize().y * 0.18);
            const centerPx = L.point(
              pointPx.x + Math.sin(heading) * lookaheadDistance,
              pointPx.y - Math.cos(heading) * lookaheadDistance,
            );
            return map.unproject(centerPx, zoom);
          })()
        : L.latLng(point.lat, point.lon);

    map.setView(centerPoint, map.getZoom(), { animate: false });
  }, [map, mapViewMode, point]);

  useEffect(() => {
    if (mapViewMode === 'overview' || !point) return;

    const recenter = () => {
      const zoom = map.getZoom();
      if (mapViewMode === 'lead') {
        const pointPx = map.project([point.lat, point.lon], zoom);
        const heading = getHeading(point) * (Math.PI / 180);
        const lookaheadDistance = Math.max(80, map.getSize().y * 0.18);
        const centerPx = L.point(
          pointPx.x + Math.sin(heading) * lookaheadDistance,
          pointPx.y - Math.cos(heading) * lookaheadDistance,
        );
        map.setView(map.unproject(centerPx, zoom), zoom, { animate: false });
        return;
      }

      map.setView([point.lat, point.lon], zoom, { animate: false });
    };

    map.on('zoomend', recenter);
    map.on('resize', recenter);
    return () => {
      map.off('zoomend', recenter);
      map.off('resize', recenter);
    };
  }, [map, mapViewMode, point]);

  return null;
});

const ScaleControl = memo(function ScaleControl({
  enabled,
}: {
  enabled: boolean;
}) {
  const map = useMap();
  const { s } = useTheme();

  useEffect(() => {
    if (!enabled) return;

    const control = L.control.scale({ imperial: false, position: 'bottomleft' });
    control.addTo(map);
    const container = control.getContainer();
    if (container) {
      container.className = `${container.className} ${s.textPrimary}`;
      container.querySelectorAll<HTMLElement>('.leaflet-control-scale-line').forEach((line) => {
        line.className = `${line.className} ${s.panel} ${s.textPrimary}`;
        line.style.background = 'transparent';
        line.style.borderTop = 'none';
      });
    }
    return () => {
      control.remove();
    };
  }, [enabled, map, s.panel, s.textPrimary]);

  return null;
});

function formatCoordinate(lat: number, lon: number) {
  const latPrefix = lat >= 0 ? 'N' : 'S';
  const lonPrefix = lon >= 0 ? 'E' : 'W';
  return `${latPrefix}${Math.abs(lat).toFixed(5)} ${lonPrefix}${Math.abs(lon).toFixed(5)}`;
}

const CoordinatesControl = memo(function CoordinatesControl({
  enabled,
  point,
}: {
  enabled: boolean;
  point?: TrackPoint;
}) {
  const map = useMap();
  const { s } = useTheme();

  useEffect(() => {
    if (!enabled) return;

    const control = new L.Control({ position: 'bottomleft' });
    const initialText = point ? formatCoordinate(point.lat, point.lon) : 'Move pointer';

    control.onAdd = () => {
      const container = L.DomUtil.create('div', 'leaflet-bar');
      container.style.padding = '4px 8px';
      container.style.fontSize = '11px';
      container.style.lineHeight = '1.4';
      container.style.minWidth = '148px';
      container.className = `leaflet-bar ${s.panel} ${s.textPrimary}`;
      container.textContent = initialText;
      L.DomEvent.disableClickPropagation(container);
      return container;
    };

    control.addTo(map);

    const updateText = (text: string) => {
      const container = control.getContainer();
      if (container) {
        container.textContent = text;
      }
    };

    const handleMove = (event: L.LeafletMouseEvent) => {
      updateText(formatCoordinate(event.latlng.lat, event.latlng.lng));
    };

    const handleLeave = () => {
      updateText(point ? formatCoordinate(point.lat, point.lon) : 'Move pointer');
    };

    map.on('mousemove', handleMove);
    map.on('mouseout', handleLeave);

    return () => {
      map.off('mousemove', handleMove);
      map.off('mouseout', handleLeave);
      control.remove();
    };
  }, [enabled, map, point, s.panel, s.textPrimary]);

  return null;
});

const WindReferenceOverlay = memo(function WindReferenceOverlay({
  windDir,
  colorClass,
}: {
  windDir?: number | null;
  colorClass: string;
}) {
  if (windDir == null || !Number.isFinite(windDir)) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-[900] overflow-hidden">
      <div
        className={`absolute left-1/2 top-1/2 h-[160vmax] w-px origin-center -translate-x-1/2 -translate-y-1/2 ${colorClass}`}
        style={{
          transform: `translate(-50%, -50%) rotate(${windDir}deg)`,
          backgroundImage: 'repeating-linear-gradient(to bottom, currentColor 0 8px, transparent 8px 16px)',
          opacity: 0.86,
        }}
      />
    </div>
  );
});


const RouteBaseLayer = memo(function RouteBaseLayer({
  chunks,
  color,
}: {
  chunks: LatLngExpression[][];
  color: string;
}) {
  if (chunks.length === 0) return null;

  return (
    <Pane name="route-base" style={{ zIndex: 420 }}>
      {chunks.map((positions, index) => (
        <Polyline
          key={index}
          positions={positions}
          pathOptions={{
            color,
            opacity: 0.22,
            weight: 0.6,
            lineCap: 'round',
            lineJoin: 'round',
          }}
        />
      ))}
    </Pane>
  );
});

const RouteProgressLayer = memo(function RouteProgressLayer({
  chunks,
  playheadIndex,
  color,
}: {
  chunks: LatLngExpression[][];
  playheadIndex: number;
  color: string;
}) {
  const visibleChunkCount = Math.max(0, Math.floor(playheadIndex / ROUTE_CHUNK_SIZE));
  const activeChunkIndex = visibleChunkCount;
  const activeChunkPointCount = (playheadIndex % ROUTE_CHUNK_SIZE) + 1;
  const activeChunk = chunks[activeChunkIndex];
  const activePositions = useMemo(
    () => (activeChunk ? activeChunk.slice(0, activeChunkPointCount + 1) : []),
    [activeChunk, activeChunkPointCount],
  );

  if (chunks.length === 0) return null;

  return (
    <Pane name="route-progress" style={{ zIndex: 430 }}>
      {chunks.slice(0, visibleChunkCount).map((positions, index) => (
        <Polyline
          key={index}
          positions={positions}
          pathOptions={{
            color,
            opacity: 0.95,
            weight: 0.75,
            lineCap: 'round',
            lineJoin: 'round',
          }}
        />
      ))}
      {activePositions.length >= 2 ? (
        <Polyline
          positions={activePositions}
          pathOptions={{
            color,
            opacity: 0.95,
            weight: 0.75,
            lineCap: 'round',
            lineJoin: 'round',
          }}
        />
      ) : null}
    </Pane>
  );
});

function buildHighlightPositions(
  telemetry: TrackPoint[],
  range: { startIndex: number; endIndex: number } | null | undefined,
): LatLngExpression[] {
  if (!range) return [];
  const start = Math.max(0, Math.min(range.startIndex, range.endIndex));
  const end = Math.min(telemetry.length - 1, Math.max(range.startIndex, range.endIndex));
  if (end - start < 1) return [];
  return telemetry.slice(start, end + 1).map((point) => [point.lat, point.lon]);
}

const RouteHighlightLayer = memo(function RouteHighlightLayer({
  telemetry,
  range,
  color,
  paneName,
  zIndex,
}: {
  telemetry: TrackPoint[];
  range?: {
    startIndex: number;
    endIndex: number;
  } | null;
  color: string;
  paneName: string;
  zIndex: number;
}) {
  const positions = useMemo<LatLngExpression[]>(
    () => buildHighlightPositions(telemetry, range),
    [range, telemetry],
  );

  if (positions.length < 2) return null;

  return (
    <Pane name={paneName} style={{ zIndex }}>
      <Polyline
        positions={positions}
        pathOptions={{
          color,
          opacity: 0.92,
          weight: 3.2,
          lineCap: 'round',
          lineJoin: 'round',
        }}
      />
    </Pane>
  );
});

const MarksLayer = memo(function MarksLayer({
  marks,
  color,
  onMarkMove,
  focusedMarkId,
}: {
  marks: CourseMark[];
  color: string;
  onMarkMove?: (markId: string, lat: number, lon: number) => void;
  focusedMarkId?: string | null;
}) {
  const iconCache = useMemo(() => {
    const cache = new Map<CourseMark['type'], DivIcon>();
    for (const mark of marks) {
      if (!cache.has(mark.type)) {
        cache.set(mark.type, createMarkIcon(mark.type, color));
      }
    }
    return cache;
  }, [marks, color]);

  return (
    <Pane name="marks-pane" style={{ zIndex: 440 }}>
      {marks.map((mark) => (
        <Marker
          key={mark.id}
          position={[mark.lat, mark.lon]}
          icon={
            mark.id === focusedMarkId
              ? createMarkIcon(mark.type, '#f59e0b')
              : iconCache.get(mark.type) ?? createMarkIcon(mark.type, color)
          }
          draggable={Boolean(onMarkMove)}
          eventHandlers={
            onMarkMove
              ? {
                  dragend: (event) => {
                    const latLng = event.target.getLatLng();
                    onMarkMove(mark.id, latLng.lat, latLng.lng);
                  },
                }
              : undefined
          }
        >
          <Tooltip permanent direction="top" offset={[0, -8]} interactive={false}>
            {mark.name ?? mark.type}
          </Tooltip>
        </Marker>
      ))}
    </Pane>
  );
});

const BoatLayer = memo(function BoatLayer({
  point,
  color,
}: {
  point?: TrackPoint;
  color: string;
}) {
  const icon = useMemo(
    () => createBoatIcon(color, point ? getHeading(point) : 0),
    [color, point],
  );

  if (!point) return null;

  return (
    <Pane name="boat-pane" style={{ zIndex: 450 }}>
      <Marker position={[point.lat, point.lon]} icon={icon} interactive={false} />
    </Pane>
  );
});

export default function MapCanvas({
  telemetry,
  marks,
  playheadIndex,
  windDir,
  windSpeed,
  mapLayer = 'vector',
  onMapLayerChange,
  onSnapshot,
  onAddEvent,
  onAddMark,
  onWindChange,
  onMarkMove,
  viewportKey = 'default',
  highlightRange,
  routeClipRange,
  focusedMarkId,
  overlay,
  presentation = false,
}: MapCanvasProps) {
  const { s, themeId } = useTheme();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [localWindDir, setLocalWindDir] = useState(windDir ?? 0);
  const [localWindSpeed, setLocalWindSpeed] = useState(windSpeed ?? 0);
  const [windInputOpen, setWindInputOpen] = useState(false);
  const [windReferenceDir, setWindReferenceDir] = useState<number | null>(null);
  const [mapViewMode, setMapViewMode] = useState<MapViewMode>('overview');
  const [layerPanelOpen, setLayerPanelOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [layers, setLayers] = useState<LayerVisibility>({
    showRoute: true,
    showMarks: true,
    showScale: true,
    showCoords: true,
  });

  useEffect(() => {
    if (windDir != null) setLocalWindDir(windDir);
  }, [windDir]);

  useEffect(() => {
    if (windSpeed != null) setLocalWindSpeed(windSpeed);
  }, [windSpeed]);

  const currentPoint =
    telemetry.length > 0
      ? telemetry[Math.max(0, Math.min(playheadIndex, telemetry.length - 1))]
      : undefined;

  const normalizedClip = useMemo(() => {
    if (!routeClipRange || telemetry.length < 2) return null;
    const a = Math.max(
      0,
      Math.min(routeClipRange.startIndex, routeClipRange.endIndex, telemetry.length - 1),
    );
    const b = Math.min(
      telemetry.length - 1,
      Math.max(routeClipRange.startIndex, routeClipRange.endIndex, 0),
    );
    if (b <= a) return null;
    return { startIndex: a, endIndex: b };
  }, [routeClipRange, telemetry.length]);

  const routeTelemetry = useMemo(() => {
    if (!normalizedClip) return telemetry;
    return telemetry.slice(normalizedClip.startIndex, normalizedClip.endIndex + 1);
  }, [normalizedClip, telemetry]);

  const routeRenderData = useMemo(
    () =>
      normalizedClip
        ? (() => {
            const positions = routeTelemetry.map(
              (point) => [point.lat, point.lon] as LatLngExpression,
            );
            return {
              positions,
              chunks: chunkPositions(positions, ROUTE_CHUNK_SIZE),
            };
          })()
        : buildRouteRenderData(routeTelemetry),
    [normalizedClip, routeTelemetry],
  );

  const routePlayheadIndex = useMemo(() => {
    if (!normalizedClip || routeTelemetry.length === 0) return playheadIndex;
    const clamped = Math.max(
      normalizedClip.startIndex,
      Math.min(playheadIndex, normalizedClip.endIndex),
    );
    return clamped - normalizedClip.startIndex;
  }, [normalizedClip, playheadIndex, routeTelemetry.length]);

  const highlightRangeClipped = useMemo(() => {
    if (!highlightRange) return null;
    if (!normalizedClip) return highlightRange;
    const c1 = normalizedClip.startIndex;
    const c2 = normalizedClip.endIndex;
    const h1 = Math.min(highlightRange.startIndex, highlightRange.endIndex);
    const h2 = Math.max(highlightRange.startIndex, highlightRange.endIndex);
    const i1 = Math.max(c1, h1);
    const i2 = Math.min(c2, h2);
    if (i2 - i1 < 1) return null;
    return { startIndex: i1, endIndex: i2 };
  }, [highlightRange, normalizedClip]);

  const displayWindDir = windDir ?? localWindDir;
  const displayWindSpeed = windSpeed ?? localWindSpeed;
  const handleWindPreviewChange = useCallback((dir: number, _speed: number, active: boolean) => {
    setWindReferenceDir(active ? dir : null);
  }, []);

  const isDark = themeId === 'glass' || themeId === 'cyber';
  const toolbarClass = `${s.panel} ${s.textPrimary}`;
  const mapToolButtonClass = `p-2 transition-opacity hover:opacity-70 ${s.textPrimary}`;
  const boatColor = isDark ? '#ffffff' : '#1c1917';
  const viewModeLabel =
    mapViewMode === 'overview' ? 'Overview' : mapViewMode === 'follow' ? 'Follow' : 'Lead';

  useEffect(() => {
    const handleFullscreen = () => {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    };

    document.addEventListener('fullscreenchange', handleFullscreen);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreen);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={`flex h-full min-h-0 w-full flex-1 flex-col ${s.mapBg} relative overflow-hidden rounded-none border-0 shadow-none`}
    >
      {!presentation ? (
      <div
        className={`absolute top-4 left-4 ${MAP_CONTROL_LAYER_CLASS} pointer-events-auto flex flex-col gap-2 p-2 backdrop-blur-md ${toolbarClass}`}
      >
        {onMapLayerChange && (
          <button
            onClick={() =>
              onMapLayerChange(mapLayer === 'vector' ? 'satellite' : mapLayer === 'satellite' ? 'gray' : 'vector')
            }
            className={mapToolButtonClass}
            title={
              mapLayer === 'vector'
                ? 'Switch to satellite'
                : mapLayer === 'satellite'
                  ? 'Switch to solid gray base'
                  : 'Switch to vector map'
            }
          >
            {mapLayer === 'gray' ? <Square className="w-5 h-5" /> : <MapIcon className="w-5 h-5" />}
          </button>
        )}
        {onAddMark && (
          <button
            onClick={onAddMark}
            className={mapToolButtonClass}
            title="Add Mark"
          >
            <MapPin className="w-5 h-5" />
          </button>
        )}
        {onSnapshot && (
          <button
            onClick={onSnapshot}
            className={mapToolButtonClass}
            title="Snapshot"
          >
            <Camera className="w-5 h-5" />
          </button>
        )}
        {onAddEvent && (
          <button
            onClick={onAddEvent}
            className={mapToolButtonClass}
            title="Add Event"
          >
            <Flag className="w-5 h-5" />
          </button>
        )}
        <button
          type="button"
          onClick={() =>
            setMapViewMode((mode) =>
              mode === 'overview' ? 'follow' : mode === 'follow' ? 'lead' : 'overview',
            )
          }
          className={`p-2 transition-opacity ${mapViewMode !== 'overview' ? s.accent : s.textPrimary} hover:opacity-70`}
          title={`Switch camera mode (${viewModeLabel})`}
        >
          <LocateFixed className="w-5 h-5" />
        </button>
        <button
          type="button"
          onClick={() => setLayerPanelOpen((open) => !open)}
          className={`p-2 transition-opacity ${layerPanelOpen ? s.accent : s.textPrimary} hover:opacity-70`}
          title="Layers"
        >
          <Layers3 className="w-5 h-5" />
        </button>
        <button
          type="button"
          onClick={() => {
            if (!containerRef.current) return;
            if (document.fullscreenElement === containerRef.current) {
              void document.exitFullscreen();
              return;
            }
            void containerRef.current.requestFullscreen();
          }}
          className={`p-2 transition-opacity ${isFullscreen ? s.accent : s.textPrimary} hover:opacity-70`}
          title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        >
          <Maximize className="w-5 h-5" />
        </button>
      </div>
      ) : null}

      {layerPanelOpen && !presentation && (
        <div className={`absolute top-4 left-20 ${MAP_CONTROL_LAYER_CLASS} min-w-[220px] p-3 backdrop-blur-md ${toolbarClass}`}>
          <div className={`text-xs font-semibold uppercase tracking-[0.18em] ${s.textSecondary}`}>Layers</div>
          <div className="mt-3 flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => onMapLayerChange?.('vector')}
                className={`flex items-center justify-between px-2 py-1.5 text-sm ${mapLayer === 'vector' ? s.buttonPrimary : s.buttonSecondary}`}
              >
                <span>Vector</span>
                <MapIcon className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => onMapLayerChange?.('satellite')}
                className={`flex items-center justify-between px-2 py-1.5 text-sm ${mapLayer === 'satellite' ? s.buttonPrimary : s.buttonSecondary}`}
              >
                <span>Satellite</span>
                <Layers3 className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => onMapLayerChange?.('gray')}
                className={`flex items-center justify-between px-2 py-1.5 text-sm ${mapLayer === 'gray' ? s.buttonPrimary : s.buttonSecondary}`}
              >
                <span>Solid gray</span>
                <Square className="w-4 h-4" />
              </button>
            </div>

            {(
              [
                ['showRoute', 'Show route', Route],
                ['showMarks', 'Show marks', MapPin],
                ['showScale', 'Show scale', Ruler],
                ['showCoords', 'Show coordinates', MousePointer2],
              ] as const
            ).map(([key, label, Icon]) => (
              <label key={key} className={`flex items-center justify-between gap-3 text-sm ${s.textPrimary}`}>
                <span className="flex items-center gap-2">
                  <Icon className="w-4 h-4" />
                  {label}
                </span>
                <input
                  type="checkbox"
                  checked={layers[key]}
                  onChange={(event) =>
                    setLayers((prev) => ({
                      ...prev,
                      [key]: event.target.checked,
                    }))
                  }
                />
              </label>
            ))}

            <div className={`pt-1 text-xs ${s.textSecondary}`}>
              Camera: <span className={s.textPrimary}>{viewModeLabel}</span>
            </div>
            <div className={`text-xs ${s.textSecondary}`}>
              `Follow` keeps the boat centered, `Lead` looks ahead on course.
            </div>
          </div>
        </div>
      )}

      {!presentation ? (
        <WindWidget
          windDir={displayWindDir}
          windSpeed={displayWindSpeed}
          onWindChange={onWindChange}
          onWindPreviewChange={handleWindPreviewChange}
          toolbarClass={toolbarClass}
        />
      ) : null}

      <div className={`relative flex-1 w-full h-full overflow-hidden rounded-none ${presentation ? 'min-h-0' : 'min-h-[420px] lg:min-h-0'}`}>
        <MapContainer
          center={[0, 0]}
          zoom={2}
          className="w-full h-full"
          preferCanvas
          zoomControl={false}
          zoomAnimation={false}
          dragging={!presentation}
          scrollWheelZoom={!presentation}
          doubleClickZoom={!presentation}
          touchZoom={!presentation}
          boxZoom={!presentation}
          keyboard={!presentation}
          attributionControl={!presentation}
        >
          <ResizeSync viewportKey={viewportKey} />
          {!presentation ? <ZoomControls /> : null}
          <InitialViewport
            telemetry={telemetry}
            marks={marks}
            mapViewMode={mapViewMode}
            viewportKey={viewportKey}
          />
          <FollowViewport mapViewMode={mapViewMode} point={currentPoint} />
          <ScaleControl enabled={!presentation && layers.showScale} />
          <CoordinatesControl enabled={!presentation && layers.showCoords} point={currentPoint} />
          <BaseTileLayer mapLayer={mapLayer} />
          {layers.showRoute && <RouteBaseLayer chunks={routeRenderData.chunks} color={s.routeColor} />}
          {layers.showRoute && (
            <RouteHighlightLayer
              telemetry={telemetry}
              range={highlightRangeClipped}
              color="#f59e0b"
              paneName="route-selection-highlight"
              zIndex={436}
            />
          )}
          {layers.showRoute && (
            <RouteProgressLayer
              chunks={routeRenderData.chunks}
              playheadIndex={routePlayheadIndex}
              color={s.routeColor}
            />
          )}
          {layers.showMarks && (
            <MarksLayer
              marks={marks}
              color={s.routeColor}
              onMarkMove={onMarkMove}
              focusedMarkId={focusedMarkId}
            />
          )}
          <BoatLayer point={currentPoint} color={boatColor} />
          {mapViewMode === 'lead' && currentPoint && (
            <Pane name="lead-indicator" style={{ zIndex: 460 }}>
              <Marker
                position={[currentPoint.lat, currentPoint.lon]}
                icon={L.divIcon({
                  className: 'sailsiq-lead-indicator',
                  html: `<div style="width:28px;height:28px;border:1px solid ${isDark ? 'rgba(255,255,255,0.8)' : 'rgba(15,23,42,0.35)'};border-radius:999px;display:flex;align-items:center;justify-content:center;background:${isDark ? 'rgba(15,23,42,0.3)' : 'rgba(255,255,255,0.72)'};"><div style="transform:rotate(${getHeading(currentPoint)}deg);color:${isDark ? '#fff' : '#0f172a'};">▲</div></div>`,
                  iconSize: [28, 28],
                  iconAnchor: [14, 14],
                })}
                interactive={false}
              >
                <Tooltip direction="top" offset={[0, -10]} interactive={false}>
                  <span className="inline-flex items-center gap-1">
                    <Crosshair className="w-3 h-3" />
                    Lead view
                  </span>
                </Tooltip>
              </Marker>
            </Pane>
          )}
        </MapContainer>
        <WindReferenceOverlay
          windDir={windReferenceDir}
          colorClass={s.accent}
        />
      </div>
      {overlay}
    </div>
  );
}
