// Modo privado: oculta los importes en toda la app (por ejemplo en el metro o enseñando la
// pantalla). Preferencia del DISPOSITIVO, como el tema: se guarda en localStorage y se recuerda
// al volver a abrir la app. No sale del dispositivo ni se sincroniza.
//
// formatCents lee una bandera de modulo (lib/money.ts). Al cambiarla, la app vuelve a montar el
// layout (App.tsx usa `revision` en su key) para que TODAS las cifras, tambien las ya calculadas
// en textos de avisos y resumenes, se pinten de nuevo con o sin mascara.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { setAmountsMasked } from '../lib/money';

export const PRIVACY_STORAGE_KEY = 'gg-hide-amounts';

interface PrivacyContextValue {
  hidden: boolean;
  revision: number;
  toggle: () => void;
  setHidden: (hidden: boolean) => void;
}

const PrivacyContext = createContext<PrivacyContextValue | null>(null);

export function readInitialHidden(): boolean {
  try {
    return localStorage.getItem(PRIVACY_STORAGE_KEY) === '1';
  } catch {
    return false; // localStorage no disponible: importes visibles
  }
}

function persist(hidden: boolean): void {
  try {
    localStorage.setItem(PRIVACY_STORAGE_KEY, hidden ? '1' : '0');
  } catch {
    // Sin persistencia: el modo sigue activo en esta sesion.
  }
}

export function PrivacyProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(() => {
    const hidden = readInitialHidden();
    // Se aplica antes del primer render de los hijos: ninguna cifra se pinta sin mascara.
    setAmountsMasked(hidden);
    return { hidden, revision: 0 };
  });

  const setHidden = useCallback((hidden: boolean) => {
    setAmountsMasked(hidden);
    persist(hidden);
    setState((prev) => (prev.hidden === hidden ? prev : { hidden, revision: prev.revision + 1 }));
  }, []);

  const toggle = useCallback(() => {
    setState((prev) => {
      const hidden = !prev.hidden;
      setAmountsMasked(hidden);
      persist(hidden);
      return { hidden, revision: prev.revision + 1 };
    });
  }, []);

  const value = useMemo(
    () => ({ hidden: state.hidden, revision: state.revision, toggle, setHidden }),
    [state, toggle, setHidden],
  );
  return <PrivacyContext.Provider value={value}>{children}</PrivacyContext.Provider>;
}

// Fuera del proveedor (tests de componentes aislados) se comporta como "importes visibles".
export function usePrivacy(): PrivacyContextValue {
  const ctx = useContext(PrivacyContext);
  return ctx ?? { hidden: false, revision: 0, toggle: () => {}, setHidden: () => {} };
}
