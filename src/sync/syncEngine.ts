// Orquestador de sincronizacion (fase 2): PUSH (subir mutaciones) y luego PULL (descargar cambios
// remotos y aplicarlos). Guarda de concurrencia: nunca dos ejecuciones a la vez. Respeta la
// cancelacion (AbortSignal) y el cierre de sesion (el llamante no invoca sin sesion valida).
import type { AppSupabaseClient } from '../lib/supabase/client';
import { db } from '../db/index';
import { runPush, type PushResult } from './pushEngine';
import { pullProfile, pullProfiles, type PullResult } from './pullEngine';
import { isLocked } from '../security/lockState';

export interface SyncSummary {
  push: PushResult;
  pull: PullResult;
  // true si otra sincronizacion ya estaba en curso y esta se omitio.
  skipped: boolean;
}

export interface SyncPhaseProgress {
  phase: 'push' | 'pull';
  total?: number;
  done?: number;
}

export interface SyncOptions {
  signal?: AbortSignal;
  onProgress?: (progress: SyncPhaseProgress) => void;
}

let running = false;

export function isSyncRunning(): boolean {
  return running;
}

const EMPTY_PUSH: PushResult = { pushed: 0, conflicts: 0, failed: 0, stopped: false };
const EMPTY_PULL: PullResult = { pulled: 0, conflicts: 0 };

export async function runSync(
  client: AppSupabaseClient,
  userId: string,
  options: SyncOptions = {},
): Promise<SyncSummary> {
  // Segunda barrera defensiva (la primera esta en SyncContext.syncNow): mientras la app esta
  // bloqueada por PIN no se sincroniza en segundo plano (CLOUD_SYNC_SECURITY seccion 6,
  // ARCHITECTURE seccion 13). Ninguna capa confia solo en la de arriba.
  if (running || isLocked()) {
    return { push: EMPTY_PUSH, pull: EMPTY_PULL, skipped: true };
  }
  running = true;
  try {
    const push = await runPush(client, userId, {
      signal: options.signal,
      onProgress: (p) => options.onProgress?.({ phase: 'push', total: p.total, done: p.done }),
    });

    // PULL: primero los perfiles del usuario (nivel cuenta), luego cada perfil propio.
    const pull: PullResult = { pulled: 0, conflicts: 0 };
    options.onProgress?.({ phase: 'pull' });
    const profilesResult = await pullProfiles(client, userId, { signal: options.signal });
    pull.pulled += profilesResult.pulled;
    pull.conflicts += profilesResult.conflicts;

    const profiles = await db.profiles.where('ownerUserId').equals(userId).toArray();
    for (const profile of profiles) {
      if (options.signal?.aborted) break;
      if (profile.deletedAt != null) continue;
      const result = await pullProfile(client, userId, profile.id, { signal: options.signal });
      pull.pulled += result.pulled;
      pull.conflicts += result.conflicts;
    }

    return { push, pull, skipped: false };
  } finally {
    running = false;
  }
}
