import { useEffect, useState } from 'react';

// Devuelve si la media query se cumple y se actualiza al cambiar (rotar el movil, redimensionar
// la ventana). Sin matchMedia (p. ej. entornos de test) devuelve `fallback`.
export function useMediaQuery(query: string, fallback = false): boolean {
  const get = (): boolean => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return fallback;
    return window.matchMedia(query).matches;
  };
  const [matches, setMatches] = useState<boolean>(get);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const onChange = (): void => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

// Movil = por debajo del breakpoint `md` de Tailwind (768px), el mismo que usa el layout.
export const MOBILE_QUERY = '(max-width: 767.98px)';
