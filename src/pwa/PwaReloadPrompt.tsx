// Registro y ciclo de vida del service worker de la PWA (sustituye a registerSW.ts).
// Precache de assets propios unicamente (invariante 3: sin red hacia terceros).
// Sin autorefresh silencioso (registerType: 'prompt'): cuando hay una version nueva se
// ofrece actualizar; cuando el precache esta listo se avisa de que la app ya es offline.
import { useEffect } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useToast } from '../context/ToastContext';

export function PwaReloadPrompt() {
  const { showToast } = useToast();
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(error: unknown) {
      // Sin errores silenciosos: si el SW no se registra, la app sigue funcionando
      // con conexion, pero se avisa de que el modo offline no esta disponible.
      const detail = error instanceof Error ? ` (${error.message})` : '';
      showToast(`No se pudo activar el modo sin conexion${detail}.`, 'error');
    },
  });

  useEffect(() => {
    if (!offlineReady) return;
    showToast('App lista para funcionar sin conexion.', 'success');
    setOfflineReady(false);
  }, [offlineReady, setOfflineReady, showToast]);

  if (!needRefresh) return null;

  return (
    <div
      role="alertdialog"
      aria-label="Nueva version disponible"
      className="fixed inset-x-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-50 mx-auto md:bottom-4 max-w-md rounded-xl border border-slate-700 bg-slate-900 p-4 shadow-2xl sm:inset-x-auto sm:right-4"
    >
      <p className="text-sm text-slate-200">
        Hay una nueva version de la app. Actualiza para aplicarla.
      </p>
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setNeedRefresh(false)}
          className="rounded-lg px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
        >
          Ahora no
        </button>
        <button
          type="button"
          onClick={() => void updateServiceWorker(true)}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
        >
          Actualizar
        </button>
      </div>
    </div>
  );
}
