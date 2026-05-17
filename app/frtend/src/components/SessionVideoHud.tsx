import type { ReactNode } from 'react';
import { Gauge, Compass, Wind, Clock3, Film } from 'lucide-react';
import { formatHeading, formatTimestamp } from '@/utils/formatters';
import { getHeading, getSpeed } from '@/utils/trackPoint';
import type { SessionEvent, TrackPoint, WorkspaceMode } from '@/types/models';

interface SessionVideoHudProps {
  sessionName: string;
  mode: WorkspaceMode;
  currentTime: number;
  currentPoint?: TrackPoint;
  windDir?: number;
  windSpeed?: number;
  nearestEvent?: SessionEvent | null;
  mediaLabel?: string;
  completionNotice?: string | null;
}

function Metric({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-[108px] rounded-2xl border border-white/15 bg-black/40 px-3 py-2 text-white shadow-lg backdrop-blur-md">
      <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-white/55">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  );
}

export default function SessionVideoHud({
  sessionName,
  mode,
  currentTime,
  currentPoint,
  windDir,
  windSpeed,
  nearestEvent,
  mediaLabel,
  completionNotice,
}: SessionVideoHudProps) {
  const speedValue = currentPoint ? `${getSpeed(currentPoint).toFixed(1)} kts` : '--';
  const headingValue = currentPoint ? formatHeading(getHeading(currentPoint)) : '--';
  const windValue =
    windDir != null && windSpeed != null
      ? `${formatHeading(windDir)} / ${windSpeed.toFixed(1)} kts`
      : 'No data';

  return (
    <div className="flex h-full flex-col justify-between p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-[28rem] rounded-3xl border border-white/15 bg-black/45 px-4 py-3 text-white shadow-lg backdrop-blur-md">
          <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-[0.24em] text-white/55">
            <Film className="h-3.5 w-3.5" />
            <span>{mode === 'overlay' ? 'Overlay Mode' : 'Split Video'}</span>
          </div>
          <div className="text-lg font-semibold leading-tight">{sessionName}</div>
          {mediaLabel ? <div className="mt-1 text-sm text-white/70">{mediaLabel}</div> : null}
        </div>

        <Metric
          icon={<Clock3 className="h-3.5 w-3.5" />}
          label="Session Time"
          value={formatTimestamp(currentTime)}
        />
      </div>

      <div className="flex flex-col gap-3">
        {completionNotice ? (
          <div className="max-w-xs rounded-3xl border border-amber-300/30 bg-amber-500/18 px-4 py-3 text-white shadow-lg backdrop-blur-md">
            <div className="text-[10px] uppercase tracking-[0.22em] text-amber-100/75">
              Playback Status
            </div>
            <div className="mt-1 text-base font-semibold">{completionNotice}</div>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <Metric
            icon={<Gauge className="h-3.5 w-3.5" />}
            label="Speed"
            value={speedValue}
          />
          <Metric
            icon={<Compass className="h-3.5 w-3.5" />}
            label="Heading"
            value={headingValue}
          />
          <Metric
            icon={<Wind className="h-3.5 w-3.5" />}
            label="Wind"
            value={windValue}
          />
        </div>

        {nearestEvent ? (
          <div className="max-w-xl rounded-3xl border border-cyan-300/20 bg-cyan-500/10 px-4 py-3 text-white shadow-lg backdrop-blur-md">
            <div className="mb-1 text-[10px] uppercase tracking-[0.22em] text-cyan-100/70">
              Active Event
            </div>
            <div className="text-base font-semibold">{nearestEvent.note}</div>
            <div className="mt-1 text-sm text-cyan-50/75">
              {nearestEvent.type} at {formatTimestamp(nearestEvent.timestamp)}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
