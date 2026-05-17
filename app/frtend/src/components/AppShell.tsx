import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Navigation } from 'lucide-react';
import { useTheme } from '@/theme/ThemeContext';
import GlobalNav from '@/components/GlobalNav';

interface AppShellProps {
  children: ReactNode;
}

export default function AppShell({ children }: AppShellProps) {
  const { s } = useTheme();

  return (
    <div
      className={`min-h-screen w-full flex flex-col relative transition-colors duration-500 ${s.wrapper}`}
    >
      {s.bgEffect && <div className={s.bgEffect} />}

      <header className="relative z-10 flex flex-col gap-4 px-4 pt-4 md:px-6 md:pt-6 lg:flex-row lg:items-start lg:justify-between lg:px-8">
        <Link to="/" className="flex items-center gap-3 no-underline">
          <div
            className={`flex items-center justify-center rounded-xl p-2 ${s.accentBg}`}
          >
            <Navigation className="w-6 h-6" />
          </div>
          <div>
            <h1 className={`text-2xl font-bold ${s.textPrimary}`}>SailSIQ</h1>
            <p className={`text-xs ${s.textSecondary}`}>
              Sailing Intelligence Platform
            </p>
          </div>
        </Link>

        <GlobalNav />
      </header>

      <main className="relative z-10 flex-1 px-4 py-6 md:px-6 lg:px-8">
        {children}
      </main>
    </div>
  );
}
