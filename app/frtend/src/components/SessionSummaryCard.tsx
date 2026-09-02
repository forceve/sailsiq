import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, MapPin, Sailboat, Users, X } from 'lucide-react';
import { useTheme } from '@/theme/ThemeContext';
import MapCanvas from '@/components/MapCanvas';
import type { Mark, Session, TrackPoint } from '@/types/models';
import { formatDate, formatDuration } from '@/utils/formatters';

interface SummaryMetric {
  key: keyof SessionSummaryDraft;
  label: string;
  value: string;
  unit?: string;
}

interface SessionSummaryDraft {
  sessionName: string;
  date: string;
  location: string;
  boat: string;
  team: string;
  distance: string;
  distanceUnit: string;
  duration: string;
  avgSog: string;
  maxSog: string;
  turnCount: string;
  events: string;
  wind: string;
  avgHeartRate: string;
  maxHeartRate: string;
  calories: string;
  trainingLoad: string;
}

interface SessionSummaryCardProps {
  session: Session;
  telemetry: TrackPoint[];
  marks?: Mark[];
  eventCount: number;
  windLabel: string;
  onClose: () => void;
}

function formatDistanceNm(meters: number): string {
  return (meters / 1852).toFixed(1);
}

function createDefaultDraft(
  session: Session,
  eventCount: number,
  windLabel: string,
): SessionSummaryDraft {
  return {
    sessionName: session.name,
    date: formatDate(session.date),
    location: session.location || 'No location',
    boat: session.boatType || 'No boat',
    team: session.teamName || 'No team',
    distance: formatDistanceNm(session.stats.distance),
    distanceUnit: 'NM',
    duration: formatDuration(session.stats.duration),
    avgSog: session.stats.avgSpeed.toFixed(1),
    maxSog: session.stats.maxSpeed.toFixed(1),
    turnCount: String(session.stats.turnCount),
    events: String(eventCount),
    wind: windLabel,
    avgHeartRate: '--',
    maxHeartRate: '--',
    calories: '--',
    trainingLoad: '--',
  };
}

function EditableValue({
  value,
  onChange,
  className,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  ariaLabel: string;
}) {
  const { s } = useTheme();
  return (
    <input
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={`min-w-0 ${s.input} ${className ?? ''}`}
    />
  );
}

function MetricCell({
  metric,
  editable,
  onChange,
}: {
  metric: SummaryMetric;
  editable: boolean;
  onChange: (key: keyof SessionSummaryDraft, value: string) => void;
}) {
  const { s } = useTheme();
  return (
    <div className={`min-w-0 border ${s.divider} px-3 py-3`}>
      <div className={`truncate text-[10px] uppercase tracking-[0.16em] ${s.textSecondary}`}>
        {metric.label}
      </div>
      <div className={`mt-1 flex min-w-0 items-baseline gap-1 ${s.textPrimary}`}>
        {editable ? (
          <EditableValue
            value={metric.value}
            onChange={(value) => onChange(metric.key, value)}
            ariaLabel={metric.label}
            className="h-8 px-2 text-lg font-semibold"
          />
        ) : (
          <span className="truncate text-xl font-semibold leading-none">{metric.value}</span>
        )}
        {metric.unit ? (
          <span className={`shrink-0 text-xs font-medium ${s.textSecondary}`}>
            {metric.unit}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export default function SessionSummaryCard({
  session,
  telemetry,
  marks = [],
  eventCount,
  windLabel,
  onClose,
}: SessionSummaryCardProps) {
  const { s, themeId } = useTheme();
  const defaultDraft = useMemo(
    () => createDefaultDraft(session, eventCount, windLabel),
    [eventCount, session, windLabel],
  );
  const [draft, setDraft] = useState(defaultDraft);
  const [editing, setEditing] = useState(false);
  const isRound = themeId === 'nordic' || themeId === 'frost' || themeId === 'neumorph';

  const updateDraft = (key: keyof SessionSummaryDraft, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const resetDraft = () => {
    setDraft(defaultDraft);
  };

  const metaItems = [
    { key: 'date' as const, icon: CalendarDays, label: draft.date },
    { key: 'location' as const, icon: MapPin, label: draft.location },
    { key: 'boat' as const, icon: Sailboat, label: draft.boat },
    { key: 'team' as const, icon: Users, label: draft.team },
  ];
  const metrics: SummaryMetric[] = [
    { key: 'duration', label: 'Duration', value: draft.duration },
    { key: 'avgSog', label: 'Avg SOG', value: draft.avgSog, unit: 'kts' },
    { key: 'maxSog', label: 'Max SOG', value: draft.maxSog, unit: 'kts' },
    { key: 'turnCount', label: 'Turn Count', value: draft.turnCount },
    { key: 'events', label: 'Events', value: draft.events },
    { key: 'wind', label: 'Wind', value: draft.wind },
    { key: 'avgHeartRate', label: 'Avg Heart Rate', value: draft.avgHeartRate, unit: 'bpm' },
    { key: 'maxHeartRate', label: 'Max Heart Rate', value: draft.maxHeartRate, unit: 'bpm' },
    { key: 'calories', label: 'Calories', value: draft.calories, unit: 'kcal' },
    { key: 'trainingLoad', label: 'Training Load', value: draft.trainingLoad, unit: 'TL' },
  ];

  return (
    <div className={`${s.panel} flex max-h-[calc(100vh-32px)] w-full max-w-2xl flex-col overflow-hidden`}>
      <div className={`flex items-start justify-between gap-3 border-b px-5 py-4 ${s.divider}`}>
        <div className="min-w-0">
          <div className={`text-[10px] uppercase tracking-[0.18em] ${s.textSecondary}`}>
            Session summary
          </div>
          {editing ? (
            <EditableValue
              value={draft.sessionName}
              onChange={(value) => updateDraft('sessionName', value)}
              ariaLabel="Session name"
              className="mt-1 h-9 px-2 text-lg font-semibold"
            />
          ) : (
            <h2 className={`mt-1 truncate text-lg font-semibold ${s.textPrimary}`}>
              {draft.sessionName}
            </h2>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {editing ? (
            <button
              type="button"
              onClick={resetDraft}
              className={`px-3 py-2 text-xs ${s.buttonSecondary}`}
            >
              Reset
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setEditing((current) => !current)}
            className={`px-3 py-2 text-xs ${editing ? s.buttonPrimary : s.buttonSecondary}`}
          >
            {editing ? 'Done' : 'Customize'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className={`p-2 ${s.buttonSecondary}`}
            aria-label="Close session summary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="min-h-0 overflow-y-auto p-5">
        <div className={`relative h-48 overflow-hidden ${s.mapBg} ${isRound ? 'rounded-2xl' : 'rounded-sm'}`}>
          <MapCanvas
            telemetry={telemetry}
            marks={marks}
            playheadIndex={Math.max(0, telemetry.length - 1)}
            mapLayer="vector"
            viewportKey={`session-summary-${session.id}`}
            presentation
          />
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
          {metaItems.map((item) => (
            <div key={item.key} className={`flex min-w-0 items-center gap-2 border ${s.divider} px-3 py-2`}>
              <item.icon className={`h-4 w-4 shrink-0 ${s.accent}`} />
              {editing ? (
                <EditableValue
                  value={item.label}
                  onChange={(value) => updateDraft(item.key, value)}
                  ariaLabel={item.key}
                  className="h-8 px-2 text-sm"
                />
              ) : (
                <span className={`min-w-0 truncate ${s.textSecondary}`}>{item.label}</span>
              )}
            </div>
          ))}
        </div>

        <div className="mt-5">
          <div className={`text-[10px] uppercase tracking-[0.18em] ${s.textSecondary}`}>
            Distance
          </div>
          <div className={`mt-1 flex items-baseline gap-2 ${s.textPrimary}`}>
            {editing ? (
              <>
                <EditableValue
                  value={draft.distance}
                  onChange={(value) => updateDraft('distance', value)}
                  ariaLabel="Distance"
                  className="h-16 max-w-[210px] px-3 text-5xl font-semibold"
                />
                <EditableValue
                  value={draft.distanceUnit}
                  onChange={(value) => updateDraft('distanceUnit', value)}
                  ariaLabel="Distance unit"
                  className="h-10 max-w-[80px] px-2 text-lg font-medium"
                />
              </>
            ) : (
              <>
                <span className="text-6xl font-semibold leading-none">{draft.distance}</span>
                <span className={`text-lg font-medium ${s.textSecondary}`}>
                  {draft.distanceUnit}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-px md:grid-cols-3">
          {metrics.map((metric) => (
            <MetricCell
              key={metric.label}
              metric={metric}
              editable={editing}
              onChange={updateDraft}
            />
          ))}
        </div>
      </div>

      <div className={`flex flex-col gap-2 border-t px-5 py-4 sm:flex-row sm:justify-end ${s.divider}`}>
        <Link
          to={`/session/${session.id}/export`}
          className={`inline-flex items-center justify-center px-4 py-2 text-sm no-underline ${s.buttonPrimary}`}
          onClick={onClose}
        >
          Open share view
        </Link>
        <button
          type="button"
          onClick={onClose}
          className={`inline-flex items-center justify-center px-4 py-2 text-sm ${s.buttonSecondary}`}
        >
          Close
        </button>
      </div>
    </div>
  );
}
