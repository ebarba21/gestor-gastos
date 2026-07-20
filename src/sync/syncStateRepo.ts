// Cursores de descarga (PULL) por (profileId, entityType): ultimo updated_at remoto ya traido.
// Device-local (fase 2). Evita descargar todo en cada sincronizacion.
import { db, now } from '../db/index';
import type { SyncEntityType, SyncState } from '../db/schema';

export async function getCursor(
  profileId: string,
  entityType: SyncEntityType,
): Promise<SyncState | undefined> {
  return db.syncState.get([profileId, entityType]);
}

export async function setCursor(
  profileId: string,
  entityType: SyncEntityType,
  lastPulledUpdatedAt: string | null,
): Promise<void> {
  const state: SyncState = {
    profileId,
    entityType,
    lastPulledUpdatedAt,
    lastPulledAt: now(),
  };
  await db.syncState.put(state);
}

// Borra los cursores de un perfil (p. ej. al desvincularlo o reconstruirlo desde cero).
export async function clearCursors(profileId: string): Promise<void> {
  await db.syncState.where('profileId').equals(profileId).delete();
}
