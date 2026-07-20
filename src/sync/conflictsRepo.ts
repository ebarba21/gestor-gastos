// Conflictos de sincronizacion (device-local, fase 2). Un conflicto NUNCA se resuelve en
// silencio para entidades financieras (invariante 11): lo materializa el push y lo resuelve la
// persona desde la UI de sincronizacion.
import { db, newId, now } from '../db/index';
import type {
  Conflict,
  ConflictResolution,
  SyncEntityType,
} from '../db/schema';
import { generateFromConflict } from '../services/reviewService';
import { reviewItemsRepo } from '../db/reviewItemsRepo';

export async function createConflict(params: {
  userId: string;
  profileId: string;
  entityType: SyncEntityType;
  entityId: string;
  localPayload: Record<string, unknown>;
  remotePayload: Record<string, unknown>;
  baseRevision: number;
  remoteRevision: number;
}): Promise<Conflict> {
  // Idempotencia: no se crean dos conflictos abiertos para la misma entidad.
  const open = await db.conflicts
    .where('entityId')
    .equals(params.entityId)
    .filter((c) => c.status === 'open')
    .first();
  if (open) {
    await db.conflicts.update(open.id, {
      localPayload: params.localPayload,
      remotePayload: params.remotePayload,
      baseRevision: params.baseRevision,
      remoteRevision: params.remoteRevision,
    });
    const updated = { ...open, ...params, status: 'open' } as Conflict;
    // Genera/actualiza la tarea de la bandeja de revision (ampliacion, fase 6). Idempotente:
    // como mucho una tarea abierta por conflicto (ver reviewService.upsertOpenReviewItem).
    await generateFromConflict(updated);
    return updated;
  }
  const conflict: Conflict = {
    id: newId(),
    userId: params.userId,
    profileId: params.profileId,
    entityType: params.entityType,
    entityId: params.entityId,
    localPayload: params.localPayload,
    remotePayload: params.remotePayload,
    baseRevision: params.baseRevision,
    remoteRevision: params.remoteRevision,
    status: 'open',
    resolution: null,
    createdAt: now(),
    resolvedAt: null,
  };
  await db.conflicts.add(conflict);
  await generateFromConflict(conflict);
  return conflict;
}

export async function listOpen(profileId: string): Promise<Conflict[]> {
  return db.conflicts
    .where('[profileId+status]')
    .equals([profileId, 'open'])
    .toArray();
}

export async function countOpen(userId: string): Promise<number> {
  return db.conflicts.where('[userId+status]').equals([userId, 'open']).count();
}

export async function listOpenByUser(userId: string): Promise<Conflict[]> {
  return db.conflicts.where('[userId+status]').equals([userId, 'open']).toArray();
}

export async function getConflict(id: string): Promise<Conflict | undefined> {
  return db.conflicts.get(id);
}

export async function markResolved(id: string, resolution: ConflictResolution): Promise<void> {
  await db.conflicts.update(id, { status: 'resolved', resolution, resolvedAt: now() });
  // Resuelve tambien la tarea de la bandeja de revision asociada (ampliacion, fase 6): la
  // persona ya tomo la decision sobre el conflicto, la tarea no debe seguir abierta.
  const conflict = await db.conflicts.get(id);
  if (!conflict) return;
  const item = await reviewItemsRepo.findOpenByTypeAndEntity(conflict.profileId, 'syncConflict', id);
  if (item) {
    await reviewItemsRepo.update(conflict.profileId, item.id, {
      status: 'resolved',
      resolution: `conflict:${resolution}`,
      resolvedAt: now(),
    });
  }
}
