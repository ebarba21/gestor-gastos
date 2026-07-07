import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ProfileProvider } from './context/ProfileContext';
import { ToastProvider } from './context/ToastContext';
import { registerServiceWorker } from './pwa/registerSW';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('No se encontro el elemento raiz #root en el DOM.');
}

createRoot(rootElement).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <ProfileProvider>
          <App />
        </ProfileProvider>
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
);

registerServiceWorker();
