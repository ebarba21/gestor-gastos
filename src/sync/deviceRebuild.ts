// Reconstruccion de un dispositivo nuevo (fase 2, CLOUD_SYNC_SECURITY 8): al iniciar sesion sin
// datos locales, descarga los perfiles remotos y todas sus entidades y reconstruye IndexedDB. Deja
// la app operativa offline. La UI muestra progreso y una puerta de carga (no un dashboard vacio).
import { db } from '../db/index';
import type { AppSupabaseClient } from '../lib/supabase/client';
import { pullProfile, pullProfiles } from './pullEngine';

export interface RebuildProgress {
  // Perfil que se esta descargando (1-indexado) y total de perfiles.
  profileIndex: number;
  profileCount: number;
  profileName: string;
  rows: number;
}

export interface RebuildResult {
  profiles: number;
  rows: number;
}

// ¿Hay ya datos locales (perfiles)? Determina si toca migracion (hay datos sin vincular) o
// reconstruccion (dispositivo vacio).
export async function hasLocalProfiles(): Promise<boolean> {
  return (await db.profiles.count()) > 0;
}

export async function rebuildDevice(
  client: AppSupabaseClient,
  userId: string,
  options: { onProgress?: (p: RebuildProgress) => void; signal?: AbortSignal } = {},
): Promise<RebuildResult> {
  // 1) Descargar los perfiles del usuario (crea las filas de profiles locales con ownerUserId).
  const profilesResult = await pullProfiles(client, userId, { signal: options.signal });
  let rows = profilesResult.pulled;

  // 2) Descargar todas las entidades de cada perfil, en orden de dependencias.
  const profiles = (await db.profiles.where('ownerUserId').equals(userId).toArray()).filter(
    (p) => p.deletedAt == null,
  );
  for (let i = 0; i < profiles.length; i += 1) {
    if (options.signal?.aborted) break;
    const profile = profiles[i];
    const result = await pullProfile(client, userId, profile.id, { signal: options.signal });
    rows += result.pulled;
    options.onProgress?.({
      profileIndex: i + 1,
      profileCount: profiles.length,
      profileName: profile.name,
      rows,
    });
  }

  return { profiles: profiles.length, rows };
}
