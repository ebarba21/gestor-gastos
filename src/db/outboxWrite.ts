// Cola de salida: cara de ESCRITURA (fase 2). Vive en src/db para que los repositorios locales
// puedan encolar una mutacion en la MISMA transaccion Dexie que la fila, sin depender del motor de
// sincronizacion (src/sync). Asi nunca queda una fila escrita sin su mutacion (atomicidad) y el
// modo local puro (sin cuenta) sigue funcionando exactamente igual que antes.
//
// Reglas (DATA_MODEL seccion 11, CLOUD_SYNC_SECURITY 6):
//   - Solo se encola si el perfil esta VINCULADO a una cuenta (ownerUserId != null). En modo local
//     puro no hay outbox y la fila conserva syncStatus 'local'.
//   - Idempotencia: mutationId unico; el entityId reutiliza el UUID local. Reenviar no duplica.
//   - Coalescing: si ya hay una mutacion pendiente (queued/failed) para la misma entidad, se
//     actualiza su payload en vez de anadir otra (a lo sumo una pendiente por entidad cuando no hay
//     un envio en curso). Reduce el trafico de ediciones repetidas sin perder correccion.
import { db, newId, now } from './index';
import type { MutationOperation, OutboxMutation, SyncEntityType } from './schema';

// Mapa nombre de store Dexie -> entidad sincronizable. Lo usa el borrado en cascada de un perfil
// vinculado para encolar la baja logica de cada tabla hija con su entityType correcto.
export const STORE_TO_ENTITY: Record<string, SyncEntityType> = {
  settings: 'setting',
  accounts: 'account',
  categories: 'category',
  tags: 'tag',
  transactions: 'transaction',
  rules: 'rule',
  budgets: 'budget',
  importTemplates: 'importTemplate',
  importBatches: 'importBatch',
};

// Propietario (auth.users.id) del perfil, o null si el perfil es solo local (sin cuenta). Debe
// leerse dentro de la transaccion de escritura para decidir si se encola.
export async function ownerOfProfile(profileId: string): Promise<string | null> {
  const profile = await db.profiles.get(profileId);
  return profile?.ownerUserId ?? null;
}

// Snapshot local (camelCase) de la entidad para el payload de la mutacion. Se guarda la fila
// completa tras la escritura: el motor de push la mapea a la fila remota. Nunca contiene PIN,
// tokens ni secretos (esas estructuras no viven en las tablas sincronizables).
function snapshot(entity: Record<string, unknown>): Record<string, unknown> {
  return { ...entity };
}

// Encola (o coalesce) una mutacion. Debe llamarse DENTRO de una transaccion rw que incluya
// db.outbox. `userId` no nulo (el llamante ya comprobo que el perfil esta vinculado).
export async function enqueueMutation(params: {
  userId: string;
  profileId: string;
  entityType: SyncEntityType;
  entityId: string;
  operation: MutationOperation;
  entity: Record<string, unknown>;
  baseRevision: number;
}): Promise<void> {
  const { userId, profileId, entityType, entityId, operation, entity, baseRevision } = params;
  const payload = snapshot(entity);

  // Busca una mutacion pendiente (no en vuelo, no resuelta) para esta entidad y la actualiza.
  const existing = await db.outbox
    .where('[entityType+entityId]')
    .equals([entityType, entityId])
    .filter((m) => m.status === 'queued' || m.status === 'failed')
    .first();

  if (existing) {
    // Una vez creada la fila remota, sigue siendo un insert aunque despues se edite/borre: el push
    // hace upsert por PK. Solo un insert seguido de borrado se queda como insert con deletedAt
    // (tombstone remoto), nunca se pierde la baja.
    const nextOperation: MutationOperation =
      existing.operation === 'insert' ? 'insert' : operation;
    await db.outbox.update(existing.mutationId, {
      operation: nextOperation,
      payload,
      status: 'queued',
      attempts: 0,
      lastError: null,
      lastAttemptAt: null,
    });
    return;
  }

  const mutation: OutboxMutation = {
    mutationId: newId(),
    userId,
    profileId,
    entityType,
    entityId,
    operation,
    payload,
    baseRevision,
    createdAt: now(),
    attempts: 0,
    lastAttemptAt: null,
    lastError: null,
    status: 'queued',
  };
  await db.outbox.add(mutation);
}
