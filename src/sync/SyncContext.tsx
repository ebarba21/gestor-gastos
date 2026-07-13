// Contexto de sincronizacion (fase 2). Expone a la UI el estado de sync (sincronizado, cambios
// pendientes, sincronizando, sin conexion, conflicto, error), los recuentos y las acciones
// (sincronizar ahora, refrescar). Instala los disparadores: login, recuperar conexion, volver a
// primer plano y un sondeo ligero. Con la sesion cerrada o sin configuracion, queda deshabilitado
// (modo local puro): no sincroniza nada.
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
import { useAuth } from '../auth/AuthContext';
import { getSupabaseClient } from '../lib/supabase/client';
import type { AppSupabaseClient } from '../lib/supabase/client';
import { countPending } from './outboxRepo';
import { countOpenConflicts } from './index';
import { runSync } from './syncEngine';
import { isLocked } from '../security/lockState';

export type SyncStatusUi =
  | 'disabled' // sin cuenta o sin configuracion: modo local puro.
  | 'offline'
  | 'syncing'
  | 'conflict'
  | 'error'
  | 'pending'
  | 'synced';

export interface SyncContextValue {
  enabled: boolean;
  status: SyncStatusUi;
  pendingCount: number;
  conflictCount: number;
  lastSyncedAt: number | null;
  lastError: string | null;
  online: boolean;
  userId: string | null;
  client: AppSupabaseClient | null;
  syncNow: () => Promise<void>;
  refresh: () => Promise<void>;
}

const SyncContext = createContext<SyncContextValue | null>(null);

const LAST_SYNC_KEY = 'gestor-gastos:last-sync';

function readLastSynced(userId: string): number | null {
  try {
    const raw = localStorage.getItem(`${LAST_SYNC_KEY}:${userId}`);
    return raw ? Number(raw) : null;
  } catch {
    return null;
  }
}

function writeLastSynced(userId: string, ts: number): void {
  try {
    localStorage.setItem(`${LAST_SYNC_KEY}:${userId}`, String(ts));
  } catch {
    // localStorage no disponible (modo privado): se ignora, no es critico.
  }
}

export function SyncProvider({ children }: { children: ReactNode }): React.ReactElement {
  const auth = useAuth();
  const userId = auth.status === 'signed-in' ? auth.user?.id ?? null : null;
  const client = useMemo(() => (userId ? getSupabaseClient() : null), [userId]);
  const enabled = userId != null && client != null;

  const [syncing, setSyncing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [conflictCount, setConflictCount] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);
  const [online, setOnline] = useState<boolean>(
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  // Evita solapar ejecuciones desde disparadores concurrentes (ademas de la guarda del motor).
  const runningRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!userId) {
      setPendingCount(0);
      setConflictCount(0);
      return;
    }
    setPendingCount(await countPending(userId));
    setConflictCount(await countOpenConflicts(userId));
  }, [userId]);

  const syncNow = useCallback(async () => {
    // Barrera principal: mientras la app esta bloqueada por PIN no se sincroniza en segundo
    // plano (CLOUD_SYNC_SECURITY seccion 6). syncEngine.runSync repite la comprobacion como
    // segunda barrera defensiva.
    if (!enabled || !userId || !client || runningRef.current || isLocked()) return;
    runningRef.current = true;
    setSyncing(true);
    setLastError(null);
    try {
      await runSync(client, userId);
      const ts = Date.now();
      setLastSyncedAt(ts);
      writeLastSynced(userId, ts);
    } catch (error) {
      setLastError(error instanceof Error ? error.message : 'Error de sincronizacion.');
    } finally {
      setSyncing(false);
      runningRef.current = false;
      await refresh();
    }
  }, [enabled, userId, client, refresh]);

  // Al iniciar sesion (o cargar con sesion): cargar ultimo sync y sincronizar.
  useEffect(() => {
    if (!enabled || !userId) return;
    setLastSyncedAt(readLastSynced(userId));
    void syncNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, userId]);

  // Disparadores: recuperar conexion, volver a primer plano; y estado online/offline.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onOnline = (): void => {
      setOnline(true);
      void syncNow();
    };
    const onOffline = (): void => setOnline(false);
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void syncNow();
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [syncNow]);

  // Sondeo ligero de recuentos (refleja cambios pendientes tras escrituras locales) y sync si hay
  // pendientes y conexion. Barato: son dos counts sobre Dexie.
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => {
      void (async () => {
        await refresh();
        if (online && !runningRef.current && (await countPending(userId as string)) > 0) {
          void syncNow();
        }
      })();
    }, 12000);
    return () => clearInterval(id);
  }, [enabled, online, userId, refresh, syncNow]);

  const status: SyncStatusUi = !enabled
    ? 'disabled'
    : syncing
      ? 'syncing'
      : !online
        ? 'offline'
        : conflictCount > 0
          ? 'conflict'
          : lastError
            ? 'error'
            : pendingCount > 0
              ? 'pending'
              : 'synced';

  const value: SyncContextValue = {
    enabled,
    status,
    pendingCount,
    conflictCount,
    lastSyncedAt,
    lastError,
    online,
    userId,
    client,
    syncNow,
    refresh,
  };

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error('useSync debe usarse dentro de SyncProvider.');
  return ctx;
}

// Variante tolerante: devuelve null si no hay SyncProvider (p. ej. en tests que montan solo una
// parte del arbol). La usa la insignia para no romper esos montajes parciales.
export function useSyncOptional(): SyncContextValue | null {
  return useContext(SyncContext);
}
