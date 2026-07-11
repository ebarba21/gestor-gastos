// Guard de rutas privadas (que requieren cuenta autenticada). La app es local-first: las
// secciones locales NUNCA se protegen con esto (funcionan sin cuenta). Se reserva para las
// futuras rutas de sincronizacion (fase 2). Redireccion segura: envia a /cuenta conservando
// el destino original para volver tras iniciar sesion.
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../auth';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-slate-400">
        Comprobando sesion...
      </div>
    );
  }

  // Sin cuenta configurada o sin sesion: no se puede acceder a una ruta privada.
  if (status !== 'signed-in') {
    return <Navigate to="/cuenta" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
