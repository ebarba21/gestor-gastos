// Store minimo NO-React del estado de bloqueo. Permite que modulos que no son componentes
// (p. ej. src/sync/syncEngine.ts) consulten "esta bloqueada la app" sin depender de React ni
// crear un ciclo de importacion hacia LockContext.tsx. LockContext es el UNICO escritor; todo lo
// demas solo lee o se suscribe. Ver CLOUD_SYNC_SECURITY seccion 6 y ARCHITECTURE seccion 13:
// mientras la app esta bloqueada por PIN no se sincroniza en segundo plano.

// 'no-pin'  : no hay PIN activo en este dispositivo, no hay nada que bloquear.
// 'locked'  : PIN activo y sin clave de sesion en memoria (pantalla bloqueada).
// 'unlocked': PIN activo y desbloqueada (clave de sesion en memoria).
export type LockStatus = 'no-pin' | 'locked' | 'unlocked';

let status: LockStatus = 'no-pin';
const listeners = new Set<(status: LockStatus) => void>();

export function getLockStatus(): LockStatus {
  return status;
}

export function isLocked(): boolean {
  return status === 'locked';
}

export function setLockStatus(next: LockStatus): void {
  if (status === next) return;
  status = next;
  listeners.forEach((listener) => listener(next));
}

export function subscribeLockStatus(listener: (status: LockStatus) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function __resetLockStateForTests(): void {
  status = 'no-pin';
  listeners.clear();
}
