import { Link, matchPath, useLocation } from 'react-router-dom';
import { useTheme } from '@/theme/ThemeContext';

type SessionTabId = 'replay' | 'canvas' | 'export';

type SessionTab = {
  id: SessionTabId;
  label: string;
  to: string;
  active: boolean;
};

interface SessionTabsProps {
  sessionId?: string;
  compact?: boolean;
  className?: string;
}

function isTabActive(tabId: SessionTabId, pathname: string): boolean {
  switch (tabId) {
    case 'replay':
      return matchPath('/session/:sessionId/replay', pathname) != null;
    case 'canvas':
      return matchPath('/session/:sessionId/canvas', pathname) != null;
    case 'export':
      return matchPath('/session/:sessionId/export', pathname) != null;
    default:
      return false;
  }
}

export default function SessionTabs({
  sessionId,
  compact = false,
  className = '',
}: SessionTabsProps) {
  const { s, themeId } = useTheme();
  const location = useLocation();

  if (!sessionId) return null;

  const isRound =
    themeId === 'nordic' || themeId === 'frost' || themeId === 'neumorph';
  const itemRadius =
    isRound ? 'rounded-xl' : themeId === 'glass' ? 'rounded-lg' : 'rounded-sm';

  const tabs: SessionTab[] = [
    {
      id: 'replay',
      label: 'Replay',
      to: `/session/${sessionId}/replay`,
      active: isTabActive('replay', location.pathname),
    },
    {
      id: 'canvas',
      label: 'Canvas',
      to: `/session/${sessionId}/canvas`,
      active: isTabActive('canvas', location.pathname),
    },
    {
      id: 'export',
      label: 'Export',
      to: `/session/${sessionId}/export`,
      active: isTabActive('export', location.pathname),
    },
  ];

  return (
    <nav
      className={`${className} flex min-w-0 items-center gap-1 overflow-x-auto p-1 ${s.panel}`}
      aria-label="Session navigation"
    >
      {tabs.map((tab) => (
        <Link
          key={tab.id}
          to={tab.to}
          className={`px-3 py-1.5 whitespace-nowrap no-underline transition-all ${
            compact ? 'text-xs' : 'text-sm'
          } ${
            tab.active ? `${s.accentBg} shadow-sm` : `hover:opacity-70 ${s.textSecondary}`
          } ${itemRadius}`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
