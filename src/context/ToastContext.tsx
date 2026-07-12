// Contexto de avisos ligeros (toasts) para feedback de acciones: crear, renombrar,
// borrar perfil, etc. Sin errores silenciosos: los fallos se muestran como toast de
// error. Ver ARCHITECTURE.md seccion 8. Solo presentacion, sin logica de negocio.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export type ToastKind = 'success' | 'error' | 'info';

interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
}

interface ToastContextValue {
  showToast: (message: string, kind?: ToastKind) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_DURATION_MS = 4000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Guardamos los timers para poder limpiarlos si el componente se desmonta.
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const showToast = useCallback(
    (message: string, kind: ToastKind = 'info') => {
      const id = crypto.randomUUID();
      setToasts((current) => [...current, { id, kind, message }]);
      const timer = setTimeout(() => dismiss(id), DEFAULT_DURATION_MS);
      timers.current.set(id, timer);
    },
    [dismiss],
  );

  // Al desmontar el provider, cancela cualquier temporizador pendiente para no dejar
  // timers vivos ni provocar actualizaciones de estado sobre un componente desmontado.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((timer) => clearTimeout(timer));
      pending.clear();
    };
  }, []);

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4"
      >
        {toasts.map((toast) => (
          <button
            key={toast.id}
            type="button"
            onClick={() => dismiss(toast.id)}
            className={[
              'pointer-events-auto max-w-md rounded-lg px-4 py-2 text-sm font-medium shadow-lg',
              toast.kind === 'success' && 'bg-emerald-600 text-white',
              toast.kind === 'error' && 'bg-red-600 text-white',
              toast.kind === 'info' && 'bg-slate-700 text-slate-50',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {toast.message}
          </button>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast debe usarse dentro de <ToastProvider>.');
  }
  return ctx;
}
