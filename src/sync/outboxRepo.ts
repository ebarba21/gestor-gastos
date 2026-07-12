// Cola de salida: cara de LECTURA/GESTION (fase 2), usada por el motor de push. La cara de
// escritura (encolar) vive en src/db/outboxWrite para poder encolar en la misma transaccion Dexie
// que la fila. Aqui: listar pendientes por usuario, marcar estados y rebasar la revision base.
import { db, now } from '../db/index';
import type { OutboxMutation, SyncEntityType } from '../db/schema';

// Mutaciones pendientes de un usuario (queued o failed), en orden de creacion (respeta
// dependencias). La cola nunca mezcla usuarios: se filtra por userId.
export async function listPending(userId: string): Promise<OutboxMutation[]> {
  const rows = await db.outbox
    .where('[userId+status]')
    .anyOf([
      [userId, 'queued'],
      [userId, 'failed'],
    ])
    .toArray();
  return rows.sort((a, b) => a.createdAt - b.createdAt);
}

export async function countPending(userId: string): Promise<number> {
  return db.outbox
    .where('[userId+status]')
    .anyOf([
      [userId, 'queued'],
      [userId, 'failed'],
    ])
    .count();
}

export async function markInflight(mutationId: string): Promise<void> {
  await db.outbox.update(mutationId, { status: 'inflight', lastAttemptAt: now() });
}

export async function markDone(mutationId: string): Promise<void> {
  await db.outbox.update(mutationId, { status: 'done' });
}

export async function markFailed(mutationId: string, message: string): Promise<void> {
  const m = await db.outbox.get(mutationId);
  await db.outbox.update(mutationId, {
    status: 'failed',
    attempts: (m?.attempts ?? 0) + 1,
    lastAttemptAt: now(),
    lastError: message.slice(0, 300),
  });
}

export async function markConflict(mutationId: string, message: string): Promise<void> {
  await db.outbox.update(mutationId, {
    status: 'conflict',
    lastAttemptAt: now(),
    lastError: message.slice(0, 300),
  });
}

// Tras aplicar una mutacion de una entidad, actualiza la baseRevision de las OTRAS mutaciones
// pendientes de la misma entidad a la nueva revision, para que ediciones encoladas del mismo
// dispositivo no se tomen por conflicto (edicion secuencial offline).
export async function rebaseQueued(
  entityType: SyncEntityType,
  entityId: string,
  newRevision: number,
  exceptMutationId: string,
): Promise<void> {
  const siblings = await db.outbox
    .where('[entityType+entityId]')
    .equals([entityType, entityId])
    .filter(
      (m) =>
        m.mutationId !== exceptMutationId &&
        (m.status === 'queued' || m.status === 'failed' || m.status === 'conflict'),
    )
    .toArray();
  for (const m of siblings) {
    await db.outbox.update(m.mutationId, { baseRevision: newRevision });
  }
}

// Reactiva una mutacion en conflicto tras resolverlo (keepLocal), con la revision remota vigente.
// ¿Quedan otras mutaciones pendientes (queued/failed) de la misma entidad? Determina si una fila
// puede pasar a 'synced' o debe seguir 'pending' (edicion secuencial offline).
export async function hasPendingSibling(
  entityType: SyncEntityType,
  entityId: string,
  exceptMutationId: string,
): Promise<boolean> {
  const count = await db.outbox
    .where('[entityType+entityId]')
    .equals([entityType, entityId])
    .filter(
      (m) =>
        m.mutationId !== exceptMutationId && (m.status === 'queued' || m.status === 'failed'),
    )
    .count();
  return count > 0;
}

export async function requeue(mutationId: string, baseRevision: number): Promise<void> {
  await db.outbox.update(mutationId, {
    status: 'queued',
    baseRevision,
    attempts: 0,
    lastError: null,
    lastAttemptAt: null,
  });
}

export async function removeMutation(mutationId: string): Promise<void> {
  await db.outbox.delete(mutationId);
}

// Todas las mutaciones de una entidad (cualquier estado). Para resolver conflictos.
export async function allByEntity(
  entityType: SyncEntityType,
  entityId: string,
): Promise<OutboxMutation[]> {
  return db.outbox.where('[entityType+entityId]').equals([entityType, entityId]).toArray();
}

// Primera mutacion no completada de una entidad (queued/failed/inflight/conflict).
export async function findActiveByEntity(
  entityType: SyncEntityType,
  entityId: string,
): Promise<OutboxMutation | undefined> {
  return db.outbox
    .where('[entityType+entityId]')
    .equals([entityType, entityId])
    .filter((m) => m.status !== 'done')
    .first();
}

// Para la UI: mutaciones (no completadas) de un perfil.
export async function listByProfile(profileId: string): Promise<OutboxMutation[]> {
  const rows = await db.outbox.where('[profileId+entityType]').between(
    [profileId, ''],
    [profileId, '￿'],
  ).toArray();
  return rows.filter((m) => m.status !== 'done').sort((a, b) => a.createdAt - b.createdAt);
}
