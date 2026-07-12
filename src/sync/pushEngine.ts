// Motor de PUSH (fase 2): envia las mutaciones de la cola de salida a Supabase de forma
// idempotente, detecta conflictos y confirma las filas locales.
//
// Idempotencia y conflictos (decision confirmada): insert = upsert por PK (reenviar no duplica);
// update/delete = guardado por revision. Si el guardado afecta 0 filas, se relee la fila remota:
//   - si su last_mutation_id coincide con la mutacion -> fue nuestra reejecucion (exito);
//   - si no -> conflicto (o, para entidades no financieras, last-write-wins documentado).
// Ningun conflicto financiero se resuelve en silencio (invariante 11).
import { toRemoteError } from '../remote';
import type { AppSupabaseClient } from '../lib/supabase/client';
import type { OutboxMutation } from '../db/schema';
import { toRow, fromRow } from './mapper';
import { ENTITY_REGISTRY } from './entityRegistry';
import { remoteRepoFor } from './remoteRepos';
import * as outbox from './outboxRepo';
import { createConflict } from './conflictsRepo';
import { confirmSynced, markConflictLocal, overwriteLocal } from './localApply';

export interface PushProgress {
  total: number;
  done: number;
}

export interface PushResult {
  pushed: number;
  conflicts: number;
  failed: number;
  // true si se detuvo antes de terminar (cancelacion o corte de sesion/red).
  stopped: boolean;
}

export interface PushOptions {
  signal?: AbortSignal;
  onProgress?: (progress: PushProgress) => void;
}

type Outcome = 'applied' | 'conflict';

export async function runPush(
  client: AppSupabaseClient,
  userId: string,
  options: PushOptions = {},
): Promise<PushResult> {
  const pending = await outbox.listPending(userId);
  const total = pending.length;
  let pushed = 0;
  let conflicts = 0;
  let failed = 0;
  let stopped = false;
  let done = 0;

  for (const mutation of pending) {
    if (options.signal?.aborted) {
      stopped = true;
      break;
    }
    await outbox.markInflight(mutation.mutationId);
    try {
      const outcome = await pushOne(client, userId, mutation);
      if (outcome === 'applied') pushed += 1;
      else conflicts += 1;
    } catch (error) {
      const remoteError = toRemoteError(error);
      await outbox.markFailed(mutation.mutationId, remoteError.message);
      failed += 1;
      // Sin sesion o sin red: detener el push (se reanuda al recuperar). Otros errores (p. ej. una
      // FK cuyo padre aun no se ha subido) se reintentan mas tarde sin bloquear el resto.
      if (remoteError.code === 'REMOTE_AUTH' || remoteError.code === 'REMOTE_UNAVAILABLE') {
        stopped = true;
        break;
      }
    }
    done += 1;
    options.onProgress?.({ total, done });
  }

  return { pushed, conflicts, failed, stopped };
}

async function pushOne(
  client: AppSupabaseClient,
  userId: string,
  mutation: OutboxMutation,
): Promise<Outcome> {
  const remote = remoteRepoFor(client, userId, mutation.entityType);
  const row = toRow(mutation.entityType, mutation.payload);
  const mid = mutation.mutationId;

  const finalizeApplied = async (remoteRow: Record<string, unknown>): Promise<void> => {
    const revision = Number(remoteRow.revision ?? 0);
    await outbox.markDone(mid);
    await outbox.rebaseQueued(mutation.entityType, mutation.entityId, revision, mid);
    const more = await outbox.hasPendingSibling(mutation.entityType, mutation.entityId, mid);
    await confirmSynced(mutation.entityType, mutation.entityId, revision, more);
  };

  if (mutation.operation === 'insert') {
    let applied = (await remote.upsertInsert(mutation.profileId, row, mid)) as
      | Record<string, unknown>
      | null;
    if (!applied) {
      // Reejecucion de un insert ya aplicado: releer para conocer la revision.
      applied = (await remote.getById(mutation.profileId, mutation.entityId)) as
        | Record<string, unknown>
        | null;
    }
    if (applied) {
      await finalizeApplied(applied);
      return 'applied';
    }
    // El insert se ignoro por duplicado pero la fila no existe: fue borrada en remoto -> conflicto.
    return handleConflict(mutation, null);
  }

  // update o delete (el delete lleva deleted_at en la fila): guardado por revision.
  const applied = (await remote.guardedUpdate(
    mutation.profileId,
    mutation.entityId,
    row,
    mutation.baseRevision,
    mid,
  )) as Record<string, unknown> | null;
  if (applied) {
    await finalizeApplied(applied);
    return 'applied';
  }

  // 0 filas: conflicto o reejecucion ya aplicada. Desambiguar con last_mutation_id.
  const current = (await remote.getById(mutation.profileId, mutation.entityId)) as
    | Record<string, unknown>
    | null;
  if (current && current.last_mutation_id === mid) {
    await finalizeApplied(current);
    return 'applied';
  }
  return handleConflict(mutation, current);
}

async function handleConflict(
  mutation: OutboxMutation,
  currentRemote: Record<string, unknown> | null,
): Promise<Outcome> {
  const info = ENTITY_REGISTRY[mutation.entityType];
  const remoteLocalForm = currentRemote ? fromRow(mutation.entityType, currentRemote) : {};
  const remoteRevision = currentRemote
    ? Number(currentRemote.revision ?? 0)
    : mutation.baseRevision;

  // Entidad NO financiera (setting): last-write-wins documentado, sin conflicto visible.
  if (!info.financial && currentRemote) {
    const localUpdatedAt = Number(mutation.payload.updatedAt ?? 0);
    const remoteUpdatedAt = Number(remoteLocalForm.updatedAt ?? 0);
    if (localUpdatedAt >= remoteUpdatedAt) {
      // Gana el local: reencolar sobre la revision remota vigente para que se aplique.
      await outbox.requeue(mutation.mutationId, remoteRevision);
    } else {
      // Gana el remoto: sobrescribir local y descartar la mutacion.
      await overwriteLocal(mutation.entityType, remoteLocalForm);
      await outbox.removeMutation(mutation.mutationId);
    }
    return 'applied';
  }

  // Entidad financiera: conflicto EXPLICITO. Nunca merge automatico de importes (invariante 11).
  await createConflict({
    userId: mutation.userId,
    profileId: mutation.profileId,
    entityType: mutation.entityType,
    entityId: mutation.entityId,
    localPayload: mutation.payload,
    remotePayload: remoteLocalForm,
    baseRevision: mutation.baseRevision,
    remoteRevision,
  });
  await outbox.markConflict(mutation.mutationId, 'La revision remota cambio; resolucion manual.');
  await markConflictLocal(mutation.entityType, mutation.entityId);
  return 'conflict';
}
