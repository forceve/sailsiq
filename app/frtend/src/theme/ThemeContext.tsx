import {
  createContext,
  useEffect,
  useContext,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';
import {
  themes,
  themeVariants,
  THEME_IDS,
  type ThemeColorMode,
  type ThemeColorScheme,
  type ThemeId,
} from './themeCatalog';
import type { ThemeStyles } from './themeTypes';

interface ThemeContextValue {
  themeId: ThemeId;
  colorMode: ThemeColorMode;
  effectiveColorScheme: ThemeColorScheme;
  s: ThemeStyles;
  setTheme: (id: ThemeId) => void;
  setColorMode: (mode: ThemeColorMode) => void;
  allThemes: { id: ThemeId; label: string }[];
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = 'sailsiq_theme';
const COLOR_MODE_STORAGE_KEY = 'sailsiq_theme_color_mode';
const COLOR_SCHEME_QUERY = '(prefers-color-scheme: dark)';

function loadSavedTheme(): ThemeId {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && saved in themes) return saved as ThemeId;
  } catch {
    /* noop */
  }
  return THEME_IDS.GLASS;
}

function loadSavedColorMode(): ThemeColorMode {
  try {
    const saved = localStorage.getItem(COLOR_MODE_STORAGE_KEY);
    if (saved === 'light' || saved === 'dark' || saved === 'browser') return saved;
  } catch {
    /* noop */
  }
  return 'browser';
}

function getBrowserColorScheme(): ThemeColorScheme {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia(COLOR_SCHEME_QUERY).matches ? 'dark' : 'light';
}

const allThemes = Object.values(themes).map((t) => ({
  id: t.id as ThemeId,
  label: t.label,
}));

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeId, setThemeId] = useState<ThemeId>(loadSavedTheme);
  const [colorMode, setColorModeState] = useState<ThemeColorMode>(loadSavedColorMode);
  const [browserColorScheme, setBrowserColorScheme] =
    useState<ThemeColorScheme>(getBrowserColorScheme);

  const setTheme = useCallback((id: ThemeId) => {
    setThemeId(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* noop */
    }
  }, []);

  const setColorMode = useCallback((mode: ThemeColorMode) => {
    setColorModeState(mode);
    try {
      localStorage.setItem(COLOR_MODE_STORAGE_KEY, mode);
    } catch {
      /* noop */
    }
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia(COLOR_SCHEME_QUERY);
    const handleChange = () => {
      setBrowserColorScheme(mediaQuery.matches ? 'dark' : 'light');
    };

    handleChange();
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  const effectiveColorScheme =
    colorMode === 'browser' ? browserColorScheme : colorMode;

  useEffect(() => {
    document.documentElement.classList.toggle('dark', effectiveColorScheme === 'dark');
    document.documentElement.dataset.theme = themeId;
    document.documentElement.dataset.colorScheme = effectiveColorScheme;
  }, [effectiveColorScheme, themeId]);

  const s = useMemo(
    () => themeVariants[themeId][effectiveColorScheme],
    [effectiveColorScheme, themeId],
  );

  const value: ThemeContextValue = {
    themeId,
    colorMode,
    effectiveColorScheme,
    s,
    setTheme,
    setColorMode,
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
