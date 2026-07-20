// Resolucion de conflictos de sincronizacion (fase 2). La decide la persona desde la UI. Cada
// resolucion es idempotente y queda registrada (invariante 11). El envio efectivo lo hara la
// siguiente sincronizacion (el resolver solo actualiza Dexie y la cola).
import { now } from '../db/index';
import { enqueueMutation } from '../db/outboxWrite';
import type { ConflictResolution } from '../db/schema';
import { getConflict, markResolved } from './conflictsRepo';
import * as outbox from './outboxRepo';
import { localGet, overwriteLocal, setLocalSyncStatus, tombstoneLocalSynced } from './localApply';

// Mantener la version LOCAL: se reenvia el cambio local sobre la revision remota vigente (para que
// se aplique) y la fila vuelve a 'pending'.
export async function resolveKeepLocal(conflictId: string): Promise<void> {
  const conflict = await getConflict(conflictId);
  if (!conflict || conflict.status === 'resolved') return;

  const active = await outbox.findActiveByEntity(conflict.entityType, conflict.entityId);
  if (active) {
    await outbox.requeue(active.mutationId, conflict.remoteRevision);
  } else {
    // Sin mutacion viva (p. ej. conflicto detectado en pull): se crea una nueva desde la fila local.
    const local = await localGet(conflict.entityType, conflict.entityId);
    if (local) {
      await enqueueMutation({
        userId: conflict.userId,
        profileId: conflict.profileId,
        entityType: conflict.entityType,
        entityId: conflict.entityId,
        operation: 'update',
        entity: local,
        baseRevision: conflict.remoteRevision,
      });
    }
  }
  await setLocalSyncStatus(conflict.entityType, conflict.entityId, 'pending');
  await markResolved(conflictId, 'keepLocal');
}

// Mantener la version REMOTA: se sobrescribe la fila local con la remota (ya en forma local) y se
// descartan las mutaciones pendientes de esa entidad.
export async function resolveKeepRemote(conflictId: string): Promise<void> {
  const conflict = await getConflict(conflictId);
  if (!conflict || conflict.status === 'resolved') return;

  for (const m of await outbox.allByEntity(conflict.entityType, conflict.entityId)) {
    await outbox.removeMutation(m.mutationId);
  }

  const remote = conflict.remotePayload;
  if (!remote || Object.keys(remote).length === 0) {
    // El remoto ya no tiene la fila: borrado logico local sincronizado.
    await tombstoneLocalSynced(conflict.entityType, conflict.entityId, conflict.remoteRevision);
  } else {
    await overwriteLocal(conflict.entityType, {
      ...remote,
      revision: conflict.remoteRevision,
      syncStatus: 'synced',
      lastSyncedAt: now(),
    });
  }
  await markResolved(conflictId, 'keepRemote');
}

// Combinar SOLO campos seguros no monetarios (p. ej. notas, etiquetas). Nunca importes. Toma la
// version remota como base, aplica los campos indicados desde la local y reenvia sobre la revision
// remota. La UI restringe `safeFields` a campos no monetarios.
const NON_MONETARY_WHITELIST: Record<string, readonly string[]> = {
  transaction: ['notes', 'tagIds', 'concept'],
  account: ['name', 'color'],
  category: ['name', 'color', 'icon'],
  tag: ['name', 'color'],
  budget: ['name'],
  rule: ['name'],
  importTemplate: ['name'],
  importBatch: [],
  profile: ['name', 'color', 'avatarEmoji'],
};

export async function resolveMerged(
  conflictId: string,
  safeFields: string[],
): Promise<void> {
  const conflict = await getConflict(conflictId);
  if (!conflict || conflict.status === 'resolved') return;

  const allowed = new Set(NON_MONETARY_WHITELIST[conflict.entityType] ?? []);
  const base: Record<string, unknown> = { ...conflict.remotePayload };
  for (const field of safeFields) {
    // Barrera dura: nunca se combinan campos fuera de la lista blanca (nunca importes).
    if (allowed.has(field)) {
      base[field] = conflict.localPayload[field];
    }
  }
  base.revision = conflict.remoteRevision;
  base.syncStatus = 'pending';
  base.lastSyncedAt = now();
  await overwriteLocal(conflict.entityType, base);

  await enqueueMutation({
    userId: conflict.userId,
    profileId: conflict.profileId,
    entityType: conflict.entityType,
    entityId: conflict.entityId,
    operation: 'update',
    entity: base,
    baseRevision: conflict.remoteRevision,
  });
  await markResolved(conflictId, 'merged');
}

export type { ConflictResolution };
