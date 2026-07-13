// Gate de bloqueo. Envuelve TODA la app (por fuera de ProfileGate, ver App.tsx): mientras el PIN
// esta activo y la app bloqueada, solo se renderiza LockScreen, sin datos ni cifras detras.
// Usa useLockOptional (no useLock) para poder montarse en tests/paginas parciales sin
// SecurityProvider, igual que useSyncOptional en SyncBadge: sin provider, no bloquea nada.
//
// No se condiciona a `lock.loading`: el estado de bloqueo inicial ya se fija en main.tsx ANTES
// de montar React (hydrateSecurityAtBoot + setLockStatus), asi que `lock.status` es correcto
// desde el primer render. Esperar a `loading` aqui abriria una ventana, aunque breve, en la que
// se renderizarian los hijos (datos) antes de saber si debian bloquearse.
import { useEffect, type ReactNode } from 'react';
import { useLockOptional } from '../../security/LockContext';
import { useToastOptional } from '../../context/ToastContext';
import { LockScreen } from './LockScreen';

export function LockGate({ children }: { children: ReactNode }) {
  const lock = useLockOptional();
  const toast = useToastOptional();

  // Un PIN correcto puede desbloquear la app aunque la sesion de cuenta guardada no se pudiera
  // descifrar (dato corrupto): CLOUD_SYNC_SECURITY seccion 10 exige tratarlo explicitamente, no
  // degradarlo en silencio. Se informa en cuanto hay donde mostrarlo (ToastProvider).
  useEffect(() => {
    if (lock?.decryptFailure && toast) {
      toast.showToast(
        'No se pudo leer tu sesion de cuenta guardada en este dispositivo. Inicia sesion de nuevo si quieres sincronizar; tus datos locales estan intactos.',
        'error',
      );
      lock.clearDecryptFailure();
    }
  }, [lock, toast]);

  if (lock?.status === 'locked') return <LockScreen />;

  return <>{children}</>;
}
