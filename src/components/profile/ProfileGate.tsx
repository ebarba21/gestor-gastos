// Guard de perfil activo. Garantiza el aislamiento a nivel de UI: hasta que no hay un
// perfil activo, la app no renderiza ninguna seccion de datos, solo el selector de
// perfil. Ver ARCHITECTURE.md seccion 4 y 9.
import type { ReactNode } from 'react';
import { useProfiles } from '../../hooks/useProfiles';
import { ProfileSelectScreen } from './ProfileSelectScreen';

export function ProfileGate({ children }: { children: ReactNode }) {
  const { status, activeProfile } = useProfiles();

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-400">
        <p className="text-sm">Cargando...</p>
      </div>
    );
  }

  // Sin perfil activo (no hay ninguno, o el usuario fue al selector): pantalla de
  // seleccion/creacion. Ninguna seccion de datos es accesible aqui.
  if (!activeProfile) {
    return <ProfileSelectScreen />;
  }

  return <>{children}</>;
}
