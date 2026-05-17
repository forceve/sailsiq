import type { ReactNode } from 'react';
import MapCanvas from '@/components/MapCanvas';
import type { MapBaselayerKind } from '@/components/MapControls';
import WorkspaceLensLayer from '@/components/WorkspaceLensLayer';
import type { Mark, SessionEvent, TrackPoint } from '@/types/models';
import type { WorkspaceRangeSelection } from '@/types/workspace';

interface WorkspaceMapStageProps {
  telemetry: TrackPoint[];
  marks: Mark[];
  playheadIndex: number;
  currentPoint?: TrackPoint;
  currentTimeMs: number;
  windDir?: number;
  windSpeed?: number;
  mapLayer: MapBaselayerKind;
  onMapLayerChange: (layer: MapBaselayerKind) => void;
  viewportKey: string;
  selectedEvent?: SessionEvent | null;
  selectedMark?: Mark | null;
  selectedRange?: WorkspaceRangeSelection | null;
  highlightRange?: { startIndex: number; endIndex: number } | null;
  routeClipRange?: { startIndex: number; endIndex: number } | null;
  onSnapshot?: () => void;
  onAddEvent?: () => void;
  onAddMark?: () => void;
  onWindChange?: (dir: number, speed: number) => void;
  onMarkMove?: (markId: string, lat: number, lon: number) => void;
  lensClassName?: string;
  overlayExtra?: ReactNode;
}

export default function WorkspaceMapStage({
  telemetry,
  marks,
  playheadIndex,
  currentPoint,
  currentTimeMs,
  windDir,
  windSpeed,
  mapLayer,
  onMapLayerChange,
  viewportKey,
  selectedEvent,
  selectedMark,
  selectedRange,
  highlightRange,
  routeClipRange,
  onSnapshot,
  onAddEvent,
  onAddMark,
  onWindChange,
  onMarkMove,
  lensClassName,
  overlayExtra,
}: WorkspaceMapStageProps) {
  return (
    <div className="relative flex min-h-0 flex-1">
      <MapCanvas
        telemetry={telemetry}
        marks={marks}
        playheadIndex={playheadIndex}
        windDir={windDir}
        windSpeed={windSpeed}
        mapLayer={mapLayer}
        onMapLayerChange={onMapLayerChange}
        onSnapshot={onSnapshot}
        onAddEvent={onAddEvent}
        onAddMark={onAddMark}
        onWindChange={onWindChange}
        onMarkMove={onMarkMove}
        viewportKey={viewportKey}
        highlightRange={highlightRange}
        routeClipRange={routeClipRange}
        focusedMarkId={selectedMark?.id ?? null}
        overlay={
          <>
            <WorkspaceLensLayer
              selectedEvent={selectedEvent ?? null}
              selectedMark={selectedMark ?? null}
              selectedRange={selectedRange ?? null}
              currentPoint={currentPoint}
              currentTimeMs={currentTimeMs}
              windDir={windDir}
              windSpeed={windSpeed}
              compact
              className={lensClassName}
            />
            {overlayExtra}
          </>
        }
      />
    </div>
  );
}
