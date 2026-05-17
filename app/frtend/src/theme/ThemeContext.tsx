import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import { themes, THEME_IDS, type ThemeId } from './themeCatalog';
import type { ThemeStyles } from './themeTypes';

interface ThemeContextValue {
  themeId: ThemeId;
  s: ThemeStyles;
  setTheme: (id: ThemeId) => void;
  allThemes: { id: ThemeId; label: string }[];
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = 'sailsiq_theme';

function loadSavedTheme(): ThemeId {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && saved in themes) return saved as ThemeId;
  } catch {
    /* noop */
  }
  return THEME_IDS.GLASS;
}

const allThemes = Object.values(themes).map((t) => ({
  id: t.id as ThemeId,
  label: t.label,
}));

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeId, setThemeId] = useState<ThemeId>(loadSavedTheme);

  const setTheme = useCallback((id: ThemeId) => {
    setThemeId(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* noop */
    }
  }, []);

  const value: ThemeContextValue = {
    themeId,
    s: themes[themeId],
    setTheme,
    allThemes,
  };

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
