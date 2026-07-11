import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ProfileProvider } from './context/ProfileContext';
import { ToastProvider } from './context/ToastContext';
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider } from './auth';
import { PwaReloadPrompt } from './pwa/PwaReloadPrompt';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('No se encontro el elemento raiz #root en el DOM.');
}

createRoot(rootElement).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <ToastProvider>
          {/* AuthProvider envuelve la app: la cuenta es OPCIONAL y nunca bloquea el modo
              local. Va por fuera del gate de perfil para que la pantalla de cuenta y el
              estado de sesion esten disponibles con o sin perfil activo. */}
          <AuthProvider>
            <ProfileProvider>
              <App />
            </ProfileProvider>
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
