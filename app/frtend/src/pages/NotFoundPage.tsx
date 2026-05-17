import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { useTheme } from '@/theme/ThemeContext';

export default function NotFoundPage() {
  const { s } = useTheme();

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
      <Compass className={`w-20 h-20 ${s.textSecondary} opacity-30`} />
      <h2 className={`text-3xl font-bold ${s.textPrimary}`}>404</h2>
      <p className={`text-sm ${s.textSecondary}`}>
        This page seems to have drifted off course.
      </p>
      <Link
        to="/"
        className={`px-5 py-2 text-sm ${s.buttonPrimary} no-underline mt-2`}
      >
        Back to Home
      </Link>
    </div>
  );
}
