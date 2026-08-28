import { memo, useState, useEffect } from 'react';
import { useMap, TileLayer } from 'react-leaflet';
import { Plus, Minus, Wind } from 'lucide-react';
import 'maplibre-gl/dist/maplibre-gl.css';
import '@maplibre/maplibre-gl-leaflet';
import { useTheme } from '@/theme/ThemeContext';
import { WindDirectionDial } from '@/components/WindDirectionDial';
import { MAP_CONTROL_LAYER_CLASS } from '@/components/workspaceLayers';
import L, { type DivIcon } from 'leaflet';
import type { Mark as CourseMark } from '@/types/models';

export function createMarkIcon(type: CourseMark['type'], color: string): DivIcon {
  const size = type === 'finish' || type === 'start_pin' || type === 'start_boat' ? 18 : 14;
  const inner = type === 'gate' ? 'border-radius:4px;' : 'border-radius:999px;';
  return L.divIcon({
    className: 'sailsiq-mark-icon',
    html: `<div draggable="false" style="width:${size}px;height:${size}px;background:${color};border:2px solid rgba(255,255,255,0.85);box-shadow:0 2px 6px rgba(0,0,0,0.22);${inner}"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

export const TILE_SOURCES = {
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri',
  },
} as const;

export type MapBaselayerKind = keyof typeof TILE_SOURCES | 'vector' | 'gray';

const OPENFREEMAP_DARK_STYLE_URL = 'https://tiles.openfreemap.org/styles/dark';

/** Solid deep gray (no remote tiles) for vector-style overlays without map detail. */
export const MAP_SOLID_GRAY_FILL = '#2a2b2f';

const MAP_MAX_ZOOM = 20;

const SolidGrayGridLayer = L.GridLayer.extend({
  createTile(this: L.GridLayer) {
    const tile = L.DomUtil.create('div', 'leaflet-tile');
    const size = this.getTileSize();
    tile.style.width = `${size.x}px`;
    tile.style.height = `${size.y}px`;
    tile.style.backgroundColor = MAP_SOLID_GRAY_FILL;
    return tile;
  },
});

const SolidGrayBaseLayer = memo(function SolidGrayBaseLayer() {
  const map = useMap();

  useEffect(() => {
    const layer = new SolidGrayGridLayer();
    layer.addTo(map);
    return () => {
      map.removeLayer(layer);
    };
  }, [map]);

  return null;
});

const OpenFreeMapVectorLayer = memo(function OpenFreeMapVectorLayer() {
  const map = useMap();

  useEffect(() => {
    const layer = L.maplibreGL({
      style: OPENFREEMAP_DARK_STYLE_URL,
      interactive: false,
    });
    layer.addTo(map);

    const maplibreMap = layer.getMaplibreMap();
    const emptyImage = {
      width: 1,
      height: 1,
      data: new Uint8Array([0, 0, 0, 0]),
    };
    const handleMissingImage = (event: { id: string }) => {
      if (!maplibreMap.hasImage(event.id)) {
        maplibreMap.addImage(event.id, emptyImage);
      }
    };
    maplibreMap.on('styleimagemissing', handleMissingImage);

    return () => {
      maplibreMap.off('styleimagemissing', handleMissingImage);
      map.removeLayer(layer);
    };
  }, [map]);

  return null;
});

export const BaseTileLayer = memo(function BaseTileLayer({
  mapLayer,
}: {
  mapLayer: MapBaselayerKind;
}) {
  if (mapLayer === 'vector') {
    return <OpenFreeMapVectorLayer />;
  }
  if (mapLayer === 'gray') {
    return <SolidGrayBaseLayer />;
  }
  const source = TILE_SOURCES[mapLayer];
  return (
    <TileLayer
      url={source.url}
      attribution={source.attribution}
      maxZoom={MAP_MAX_ZOOM}
    />
  );
});

export const ResizeSync = memo(function ResizeSync({
  viewportKey = 'default',
}: {
  viewportKey?: string;
}) {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();
    let frame = 0;

    const invalidate = () => {
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
      frame = window.requestAnimationFrame(() => {
        map.invalidateSize({ animate: false, pan: false, debounceMoveend: true });
      });
    };

    invalidate();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => {
        invalidate();
      });
      observer.observe(container);
      return () => {
        if (frame) {
          window.cancelAnimationFrame(frame);
        }
        observer.disconnect();
      };
    }

    window.addEventListener('resize', invalidate);
    return () => {
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
      window.removeEventListener('resize', invalidate);
    };
  }, [map, viewportKey]);

  return null;
});

export const ZoomControls = memo(function ZoomControls() {
  const map = useMap();
  const { s } = useTheme();

  return (
    <div className={`absolute right-4 top-20 ${MAP_CONTROL_LAYER_CLASS} pointer-events-auto flex flex-col gap-2`}>
      <button
        type="button"
        onClick={() => map.zoomIn()}
        className={`p-2 backdrop-blur-md hover:opacity-80 ${s.buttonSecondary}`}
        title="Zoom in"
      >
        <Plus className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={() => map.zoomOut()}
        className={`p-2 backdrop-blur-md hover:opacity-80 ${s.buttonSecondary}`}
        title="Zoom out"
      >
        <Minus className="w-4 h-4" />
      </button>
    </div>
  );
});

export const WindWidget = memo(function WindWidget({
  windDir,
  windSpeed,
  onWindChange,
  onWindPreviewChange,
  toolbarClass,
}: {
  windDir: number;
  windSpeed: number;
  onWindChange?: (dir: number, speed: number) => void;
  onWindPreviewChange?: (dir: number, speed: number, active: boolean) => void;
  toolbarClass?: string;
}) {
  const { s } = useTheme();
  const [localWindDir, setLocalWindDir] = useState(windDir);
  const [localWindSpeed, setLocalWindSpeed] = useState(windSpeed);
  const [windInputOpen, setWindInputOpen] = useState(false);

  useEffect(() => {
    setLocalWindDir(windDir);
  }, [windDir]);

  useEffect(() => {
    setLocalWindSpeed(windSpeed);
  }, [windSpeed]);

  const displayWindDir = windInputOpen ? localWindDir : windDir;
  const displayWindSpeed = windInputOpen ? localWindSpeed : windSpeed;

  useEffect(() => {
    onWindPreviewChange?.(localWindDir, localWindSpeed, windInputOpen);
  }, [localWindDir, localWindSpeed, onWindPreviewChange, windInputOpen]);

  useEffect(() => {
    return () => {
      onWindPreviewChange?.(windDir, windSpeed, false);
    };
  }, [onWindPreviewChange, windDir, windSpeed]);

  return (
    <div className={`absolute top-4 right-4 ${MAP_CONTROL_LAYER_CLASS} pointer-events-none`}>
      <div
        className={`pointer-events-auto flex items-center gap-2 px-4 py-2 backdrop-blur-md rounded-full shadow-lg ${toolbarClass || s.panel}`}
      >
        <button
          type="button"
          onClick={() => setWindInputOpen((open) => !open)}
          className="flex items-center gap-2"
        >
          <Wind className={`w-5 h-5 ${s.accent}`} />
          <div className="flex flex-col text-left">
            <span className={`text-[10px] leading-tight ${s.textSecondary}`}>TWD</span>
            <span className={`text-sm leading-tight font-bold ${s.textPrimary}`}>
              {Math.round(displayWindDir)}° / {displayWindSpeed.toFixed(0)}kts
            </span>
          </div>
        </button>
      </div>
      {windInputOpen && onWindChange && (
        <div
          className={`absolute top-full right-0 mt-2 p-3 ${s.panel} rounded-xl flex flex-col gap-3 min-w-[200px] pointer-events-auto shadow-xl`}
        >
          <div className="flex flex-col items-center gap-1">
            <span className={`text-xs ${s.textSecondary}`}>Direction (TWD)</span>
            <WindDirectionDial value={localWindDir} onChange={setLocalWindDir} size={140} />
          </div>
          <label className={`text-xs ${s.textSecondary}`}>
            Degrees (0–360)
            <input
              type="number"
              min={0}
              max={360}
              value={localWindDir}
              onChange={(e) => setLocalWindDir(Math.max(0, Math.min(360, Number(e.target.value))))}
              className={`w-full mt-1 px-2 py-1 text-sm ${s.input}`}
            />
          </label>
          <label className={`text-xs ${s.textSecondary}`}>
            Speed (kts)
            <input
              type="number"
              min={0}
              step={0.5}
              value={localWindSpeed}
              onChange={(e) => setLocalWindSpeed(Math.max(0, Number(e.target.value)))}
              className={`w-full mt-1 px-2 py-1 text-sm ${s.input}`}
            />
          </label>
          <button
            type="button"
            onClick={() => {
              onWindChange(localWindDir, localWindSpeed);
              setWindInputOpen(false);
            }}
            className={`text-xs py-1.5 rounded-md font-medium ${s.buttonPrimary}`}
          >
            Apply
          </button>
        </div>
      )}
    </div>
  );
});
