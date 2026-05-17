import type { ReactNode } from 'react';
import { useTheme } from '@/theme/ThemeContext';

interface PanelProps {
  children: ReactNode;
  className?: string;
  padding?: boolean;
}

export default function Panel({ children, className = '', padding = true }: PanelProps) {
  const { s } = useTheme();
  return (
    <div className={`${s.panel} ${padding ? 'p-4' : ''} ${className}`}>
      {children}
    </div>
  );
}
