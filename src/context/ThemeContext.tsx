// Tema visual de la app (oscuro / claro). Preferencia a nivel de DISPOSITIVO, no de perfil:
// se guarda en localStorage (coste 0, sin red) y se aplica al elemento raiz via
// data-theme, que index.css usa para reasignar los tokens de color. El script inline de
// index.html fija data-theme antes del primer render para evitar el parpadeo inicial.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'gg-theme';
// Color de la barra del navegador/PWA por tema (slate-950 oscuro / slate-50 claro).
const THEME_COLOR: Record<Theme, string> = { dark: '#020617', light: '#f8fafc' };

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

// Lee el tema inicial: primero el que ya fijo el script inline en el DOM (fuente de verdad
// para no parpadear), y si no, localStorage o la preferencia del sistema. Por defecto oscuro.
function readInitialTheme(): Theme {
  if (typeof document !== 'undefined') {
    const attr = document.documentElement.dataset.theme;
    if (attr === 'light' || attr === 'dark') return attr;
  }
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches) {
      return 'light';
    }
  } catch {
    // localStorage no disponible (modo privado): se cae al valor por defecto.
  }
  return 'dark';
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLOR[theme]);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readInitialTheme);

  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Sin persistencia si localStorage falla; el tema sigue activo en la sesion.
    }
  }, [theme]);

  const setTheme = useCallback((next: Theme) => setThemeState(next), []);
  const toggleTheme = useCallback(
    () => setThemeState((prev) => (prev === 'dark' ? 'light' : 'dark')),
    [],
  );

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme debe usarse dentro de <ThemeProvider>.');
  return ctx;
}
