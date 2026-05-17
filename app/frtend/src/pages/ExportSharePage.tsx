import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  FileText,
  Link2,
  Film,
  Check,
  Download,
  Loader2,
  ChevronLeft,
} from 'lucide-react';
import { useTheme } from '@/theme/ThemeContext';
import Panel from '@/components/Panel';
import SessionTabs from '@/components/SessionTabs';
import { exportApi } from '@/services/api';
import type { ExportResult } from '@/types/models';

type ExportFormat = 'pdf' | 'link' | 'video';

const FORMAT_OPTIONS: { id: ExportFormat; label: string; desc: string; icon: typeof FileText }[] = [
  {
    id: 'pdf',
    label: 'PDF Report',
    desc: 'Track map, statistics, events list and screenshots',
    icon: FileText,
  },
  {
    id: 'link',
    label: 'Share Link',
    desc: 'Generate a read-only web link for sharing',
    icon: Link2,
  },
  {
    id: 'video',
    label: 'Video Overlay',
    desc: 'Export transparent dashboard video components (MP4/WebM) for video editing',
    icon: Film,
  },
];

export default function ExportSharePage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { s, themeId } = useTheme();

  const [format, setFormat] = useState<ExportFormat>('pdf');
  const [includeEvents, setIncludeEvents] = useState(true);
  const [includeScreenshots, setIncludeScreenshots] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ExportResult | null>(null);

  const isRound =
    themeId === 'nordic' || themeId === 'frost' || themeId === 'neumorph';

  const handleExport = async () => {
    if (!sessionId) return;
    setExporting(true);
    setProgress(0);
    setResult(null);

    const timer = setInterval(() => {
      setProgress((p) => Math.min(p + 15, 90));
    }, 300);

    try {
      let res: ExportResult;
      if (format === 'pdf') {
        res = await exportApi.exportPdf(sessionId, {
          includeEvents,
          includeScreenshots,
        });
      } else if (format === 'link') {
        res = await exportApi.share(sessionId);
      } else {
        res = await exportApi.exportVideoAssets(sessionId, {
          format: 'mp4',
          components: ['track', 'speed', 'heading'],
        });
      }
      setProgress(100);
      setResult(res);
    } finally {
      clearInterval(timer);
      setExporting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <Link
            to={sessionId ? `/session/${sessionId}/replay` : '/'}
            className={`p-2 ${s.panel} hover:opacity-80`}
          >
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <h2 className={`text-xl font-bold ${s.textPrimary}`}>Export & Share</h2>
        </div>
        <SessionTabs sessionId={sessionId} />
      </div>

      {/* Format selection */}
      <div className="grid gap-3">
        {FORMAT_OPTIONS.map((opt) => {
          const Icon = opt.icon;
          const active = format === opt.id;
          return (
            <button
              key={opt.id}
              onClick={() => {
                setFormat(opt.id);
                setResult(null);
              }}
              className={`${s.panel} p-4 flex items-center gap-4 text-left transition-all ${
                active ? s.accentBg : s.cardHover
              }`}
            >
              <Icon className={`w-6 h-6 shrink-0 ${active ? s.accent : s.textSecondary}`} />
              <div className="flex-1">
                <div className={`font-medium ${s.textPrimary}`}>{opt.label}</div>
                <div className={`text-sm ${s.textSecondary}`}>{opt.desc}</div>
              </div>
              {active && <Check className={`w-5 h-5 ${s.accent}`} />}
            </button>
          );
        })}
      </div>

      {/* Options */}
      <Panel>
        <h3 className={`font-bold mb-4 ${s.textPrimary}`}>Options</h3>
        <div className="flex flex-col gap-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={includeEvents}
              onChange={(e) => setIncludeEvents(e.target.checked)}
              className="w-4 h-4 accent-current"
            />
            <span className={`text-sm ${s.textPrimary}`}>Include events & annotations</span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={includeScreenshots}
              onChange={(e) => setIncludeScreenshots(e.target.checked)}
              className="w-4 h-4 accent-current"
            />
            <span className={`text-sm ${s.textPrimary}`}>Include map screenshots</span>
          </label>
        </div>
      </Panel>

      {/* Preview area */}
      <Panel>
        <h3 className={`font-bold mb-4 ${s.textPrimary}`}>Preview</h3>
        <div
          className={`h-40 flex items-center justify-center ${s.mapBg} ${
            isRound ? 'rounded-2xl' : 'rounded-sm'
          }`}
        >
          {format === 'pdf' && (
            <div className="text-center">
              <FileText className={`w-10 h-10 mx-auto ${s.textSecondary} opacity-40`} />
              <p className={`text-xs mt-2 ${s.textSecondary}`}>
                PDF preview with track map & stats
              </p>
            </div>
          )}
          {format === 'link' && (
            <div className="text-center">
              <Link2 className={`w-10 h-10 mx-auto ${s.textSecondary} opacity-40`} />
              <p className={`text-xs mt-2 ${s.textSecondary}`}>
                Shareable web link
              </p>
            </div>
          )}
          {format === 'video' && (
            <div className="text-center">
              <Film className={`w-10 h-10 mx-auto ${s.textSecondary} opacity-40`} />
              <p className={`text-xs mt-2 ${s.textSecondary}`}>
                Transparent overlay for video editing
              </p>
            </div>
          )}
        </div>
      </Panel>

      {/* Progress / Result */}
      {(exporting || result) && (
        <Panel>
          {exporting && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Loader2 className={`w-4 h-4 animate-spin ${s.accent}`} />
                <span className={`text-sm ${s.textPrimary}`}>
                  Exporting… {progress}%
                </span>
              </div>
              <div className={`h-2 ${s.progressTrack}`}>
                <div
                  className={`h-full transition-all ${s.progressFill}`}
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {result && !exporting && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Check className="w-5 h-5 text-green-500" />
                <span className={`text-sm font-medium ${s.textPrimary}`}>
                  Export complete!
                </span>
              </div>
              {format === 'link' && (
                <p className={`text-xs ${s.textSecondary}`}>
                  Share link is read-only. Recipients can view the session without editing.
                </p>
              )}
              <a
                href={result.url}
                target="_blank"
                rel="noopener noreferrer"
                className={`flex items-center gap-2 px-4 py-2 text-sm w-fit ${s.buttonPrimary} no-underline`}
              >
                <Download className="w-4 h-4" />
                {format === 'link' ? 'Open Link' : 'Download'}
              </a>
              {format === 'link' && (
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={result.url}
                    className={`flex-1 px-3 py-2 text-xs ${s.input}`}
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                  />
                </div>
              )}
            </div>
          )}
        </Panel>
      )}

      {/* Export button */}
      <div className="flex justify-end">
        <button
          onClick={handleExport}
          disabled={exporting}
          className={`flex items-center gap-2 px-6 py-2 text-sm ${s.buttonPrimary} ${
            exporting ? 'opacity-40 cursor-not-allowed' : ''
          }`}
        >
          {exporting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Download className="w-4 h-4" />
          )}
          {exporting ? 'Exporting…' : 'Export'}
        </button>
      </div>
    </div>
  );
}
