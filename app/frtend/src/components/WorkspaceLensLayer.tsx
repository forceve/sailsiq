import type { ReactNode } from 'react';
import { Clock3, Flag, MapPin, Radar, TimerReset } from 'lucide-react';
import { formatTimestamp } from '@/utils/formatters';
import type { Mark, SessionEvent, TrackPoint } from '@/types/models';
import type { WorkspaceRangeSelection } from '@/types/workspace';

interface WorkspaceLensLayerProps {
  selectedEvent?: SessionEvent | null;
  selectedMark?: Mark | null;
  selectedRange?: WorkspaceRangeSelection | null;
  currentPoint?: TrackPoint;
  currentTimeMs?: number;
  windDir?: number;
  windSpeed?: number;
  className?: string;
  compact?: boolean;
}

function LensCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-w-[180px] max-w-[260px] rounded-2xl border border-white/15 bg-black/45 px-3 py-2 text-white shadow-lg backdrop-blur-md">
      <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-white/55">
        {icon}
        <span>{title}</span>
      </div>
      {children}
    </div>
  );
}

export default function WorkspaceLensLayer({
  selectedEvent,
  selectedMark,
  selectedRange,
  currentPoint,
  currentTimeMs,
  windDir,
  windSpeed,
  className = '',
  compact = false,
}: WorkspaceLensLayerProps) {
  const speedValue = currentPoint?.s != null ? `${currentPoint.s.toFixed(1)} kts` : '--';
  const headingValue = currentPoint?.h != null ? `${Math.round(currentPoint.h)} deg` : '--';
  const selectedEventMetrics = selectedEvent?.metrics;
  const selectedEventDetail = [
    selectedEvent?.confidence != null
      ? `${Math.round(selectedEvent.confidence * 100)}% confidence`
      : null,
    selectedEvent?.startTime != null && selectedEvent.endTime != null
      ? `${formatTimestamp(selectedEvent.startTime)} to ${formatTimestamp(selectedEvent.endTime)}`
      : selectedEvent
        ? `at ${formatTimestamp(selectedEvent.timestamp)}`
        : null,
    selectedEventMetrics?.headingChange != null
      ? `HDG ${Math.round(selectedEventMetrics.headingChange)} deg`
      : null,
    selectedEventMetrics?.speedLoss != null
      ? `Loss ${selectedEventMetrics.speedLoss.toFixed(1)} kts`
      : null,
    selectedEventMetrics?.entryTwa != null && selectedEventMetrics.exitTwa != null
      ? `TWA ${Math.round(selectedEventMetrics.entryTwa)} to ${Math.round(selectedEventMetrics.exitTwa)}`
      : null,
  ].filter((value): value is string => Boolean(value));

  return (
    <div className={`pointer-events-none absolute inset-0 z-[980] flex flex-col justify-between p-3 sm:p-4 ${className}`}>
      <div className="flex justify-end">
        <div className="flex flex-col items-end gap-2">
          {selectedEvent ? (
            <LensCard title="Event Lens" icon={<Flag className="h-3.5 w-3.5" />}>
              <div className="text-sm font-semibold">{selectedEvent.note}</div>
              <div className="mt-1 text-xs text-white/70">{selectedEvent.type}</div>
              {selectedEventDetail.length > 0 ? (
                <div className="mt-1 flex flex-col gap-0.5 text-xs text-white/70">
                  {selectedEventDetail.map((detail) => (
                    <span key={detail}>{detail}</span>
                  ))}
                </div>
              ) : null}
            </LensCard>
          ) : null}

          {selectedMark ? (
            <LensCard title="Mark Focus" icon={<MapPin className="h-3.5 w-3.5" />}>
              <div className="text-sm font-semibold">{selectedMark.name ?? selectedMark.type}</div>
              <div className="mt-1 text-xs text-white/70">
                {selectedMark.lat.toFixed(4)}, {selectedMark.lon.toFixed(4)}
              </div>
            </LensCard>
          ) : null}

          {selectedRange ? (
            <LensCard title="Range Lens" icon={<TimerReset className="h-3.5 w-3.5" />}>
              <div className="text-sm font-semibold">
                {formatTimestamp(selectedRange.startMs)} to {formatTimestamp(selectedRange.endMs)}
              </div>
              <div className="mt-1 text-xs text-white/70">
                Source: {selectedRange.source}
              </div>
            </LensCard>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <LensCard title="Live Metric" icon={<Radar className="h-3.5 w-3.5" />}>
          <div className={`${compact ? 'text-sm' : 'text-base'} font-semibold`}>
            SOG {speedValue} / HDG {headingValue}
          </div>
          {windDir != null && windSpeed != null ? (
            <div className="mt-1 text-xs text-white/70">
              Wind {Math.round(windDir)} deg / {windSpeed.toFixed(1)} kts
            </div>
          ) : null}
        </LensCard>

        <LensCard title="Timeline" icon={<Clock3 className="h-3.5 w-3.5" />}>
          <div className={`${compact ? 'text-sm' : 'text-base'} font-semibold`}>
            {currentTimeMs != null ? formatTimestamp(currentTimeMs) : '--:--:--'}
          </div>
          <div className="mt-1 text-xs text-white/70">
            Linked lens follows the global playhead
          </div>
        </LensCard>
      </div>
    </div>
  );
}
