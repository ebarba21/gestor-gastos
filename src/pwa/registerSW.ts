import { registerSW } from 'virtual:pwa-register';

/**
 * Registra el service worker de la PWA.
 * Precache de assets propios unicamente (invariante 3: sin red hacia terceros).
 * Sin autorefresh silencioso: la actualizacion se ofrecera al usuario (fase 7).
 */
export function registerServiceWorker(): void {
  registerSW({
    immediate: false,
    onNeedRefresh() {
      // TODO fase 7: ofrecer al usuario recargar para aplicar la nueva version.
    },
    onOfflineReady() {
      // TODO fase 7: avisar de que la app esta lista para funcionar offline.
    },
  });
}
