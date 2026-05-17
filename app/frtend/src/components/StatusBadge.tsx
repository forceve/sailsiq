import { useTheme } from '@/theme/ThemeContext';

interface StatusBadgeProps {
  label: string;
  variant?: 'default' | 'success' | 'warning' | 'error';
}

export default function StatusBadge({ label, variant = 'default' }: StatusBadgeProps) {
  const { s } = useTheme();

  const variantClasses: Record<string, string> = {
    default: s.badge,
    success: `${s.badge} !text-green-500 !border-green-500/40`,
    warning: `${s.badge} !text-yellow-500 !border-yellow-500/40`,
    error: `${s.badge} !text-red-500 !border-red-500/40`,
  };

  return (
    <span className={variantClasses[variant] ?? s.badge}>
      {label}
    </span>
  );
}
