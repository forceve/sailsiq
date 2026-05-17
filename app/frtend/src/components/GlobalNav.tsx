import { PlusCircle } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useTheme } from '@/theme/ThemeContext';

type GlobalNavItem = {
  id: 'sessions' | 'settings';
  label: string;
  to: string;
};

const GLOBAL_NAV_ITEMS: GlobalNavItem[] = [
  {
    id: 'sessions',
    label: 'Sessions',
    to: '/',
  },
  {
    id: 'settings',
    label: 'Settings',
    to: '/settings',
  },
];

function isItemActive(itemId: GlobalNavItem['id'], pathname: string): boolean {
  switch (itemId) {
    case 'sessions':
      return pathname === '/';
    case 'settings':
      return pathname === '/settings';
    default:
      return false;
  }
}

export default function GlobalNav() {
  const { s, themeId } = useTheme();
  const location = useLocation();

  const isRound =
    themeId === 'nordic' || themeId === 'frost' || themeId === 'neumorph';
  const itemRadius =
    isRound ? 'rounded-xl' : themeId === 'glass' ? 'rounded-lg' : 'rounded-sm';

  return (
    <div className="flex w-full flex-col gap-3 lg:w-auto lg:flex-row lg:items-center lg:justify-end">
      <nav
        className={`flex items-center gap-1 overflow-x-auto p-1 ${s.panel}`}
        aria-label="Global navigation"
      >
        {GLOBAL_NAV_ITEMS.map((item) => {
          const active = isItemActive(item.id, location.pathname);

          return (
            <Link
              key={item.id}
              to={item.to}
              className={`px-3 py-1.5 text-sm whitespace-nowrap no-underline transition-all ${
                active ? `${s.accentBg} shadow-sm` : `hover:opacity-70 ${s.textSecondary}`
              } ${itemRadius}`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <Link
        to="/new"
        className={`inline-flex items-center justify-center gap-2 px-4 py-2 text-sm no-underline ${s.buttonPrimary}`}
      >
        <PlusCircle className="h-4 w-4" />
        New Session
      </Link>
    </div>
  );
}
