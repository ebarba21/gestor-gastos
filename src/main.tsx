import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ProfileProvider } from './context/ProfileContext';
import { ToastProvider } from './context/ToastContext';
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider } from './auth';
import { SyncProvider } from './sync/SyncContext';
import { SecurityProvider } from './security/LockContext';
import { hydrateSecurityAtBoot } from './security/pinService';
import { setLockStatus } from './security/lockState';
import { PwaReloadPrompt } from './pwa/PwaReloadPrompt';
import { requestPersistentStorage } from './pwa/persistentStorage';
import './index.css';

const rootElementOrNull = document.getElementById('root');
if (!rootElementOrNull) {
  throw new Error('No se encontro el elemento raiz #root en el DOM.');
}
const rootElement = rootElementOrNull;

// Ruta base del router: coincide con la `base` de Vite (p. ej. '/gestor-gastos/' en GitHub
// Pages). React Router la espera sin barra final; en la raiz del dominio queda en '/'.
const routerBasename = import.meta.env.BASE_URL.replace(/\/+$/, '') || '/';

function renderApp(): void {
  createRoot(rootElement).render(
    <StrictMode>
      <BrowserRouter basename={routerBasename}>
        <ThemeProvider>
          <ToastProvider>
            {/* AuthProvider envuelve la app: la cuenta es OPCIONAL y nunca bloquea el modo
                local. Va por fuera del gate de perfil para que la pantalla de cuenta y el
                estado de sesion esten disponibles con o sin perfil activo. */}
            <AuthProvider>
              {/* SecurityProvider (PIN, bloqueo automatico, passkeys) va dentro de Auth (la
                  recuperacion de PIN reautentica con la cuenta) y por FUERA de Profile/Sync:
                  el LockGate de App.tsx bloquea todo lo de dentro, incluida la seleccion de
                  perfil, sin mostrar datos detras. */}
              <SecurityProvider>
                <ProfileProvider>
                  {/* SyncProvider dentro de Auth (necesita el usuario) y de Profile; envuelve la
                      app para que el estado de sincronizacion este disponible en toda la UI. La
                      cuenta es opcional: sin sesion, el proveedor queda deshabilitado (modo
                      local puro). */}
                  <SyncProvider>
                    <App />
                  </SyncProvider>
                </ProfileProvider>
              </SecurityProvider>
            </AuthProvider>
            {/* Registro del SW + avisos de nueva version y de offline listo. Dentro del
                ToastProvider porque usa toasts; fuera del gate de perfil para avisar
                tambien en la pantalla de seleccion de perfil. */}
            <PwaReloadPrompt />
          </ToastProvider>
        </ThemeProvider>
      </BrowserRouter>
    </StrictMode>,
  );
}

function renderBootError(): void {
  createRoot(rootElement).render(
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#020617', color: '#f1f5f9', padding: '1.5rem', textAlign: 'center', fontFamily: 'sans-serif' }}>
      <div style={{ maxWidth: '28rem' }}>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 700 }}>No se pudo iniciar la aplicacion</h1>
        <p style={{ marginTop: '0.75rem', fontSize: '0.875rem', color: '#94a3b8' }}>
          El almacenamiento local (IndexedDB) no esta disponible en este navegador o esta bloqueado
          (por ejemplo, en algunos modos de navegacion privada). Prueba a recargar la pagina, salir
          del modo privado, o usar otro navegador.
        </p>
      </div>
    </div>,
  );
}

// Sincroniza el modo del storage de sesion (plano/cifrado) y el estado de bloqueo inicial ANTES
// de montar React: si esto se retrasara a un efecto de componente, AuthProvider podria intentar
// restaurar la sesion de Supabase antes de saber si hay que descifrarla (ver
// src/security/encryptedSessionStorage.ts, pinService.hydrateSecurityAtBoot y lockState.ts).
// Sin errores silenciosos: si el arranque falla (p. ej. IndexedDB no disponible), se informa en
// vez de dejar una pagina en blanco sin explicacion.
hydrateSecurityAtBoot()
  .then((security) => {
    setLockStatus(security.pinEnabled ? 'locked' : 'no-pin');
    renderApp();
    // En segundo plano: pide almacenamiento persistente para que el navegador no borre los
    // datos locales (ver src/pwa/persistentStorage.ts). No bloquea el arranque.
    void requestPersistentStorage();
  })
  .catch((error: unknown) => {
    // Solo el mensaje corto, nunca el objeto de error completo (podria arrastrar detalles
    // internos innecesarios a la consola de produccion).
    console.error(
      'No se pudo iniciar la aplicacion (hydrateSecurityAtBoot):',
      error instanceof Error ? error.message : 'error desconocido',
    );
    renderBootError();
  });
