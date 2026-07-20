// Motor de PULL (fase 2): descarga cambios remotos por entidad con un cursor por updated_at y los
// aplica en Dexie por upsert idempotente (por id). Nunca una consulta remota por render: solo el
// motor descarga, en segundo plano y por lotes.
//
// Cursor: se descargan filas con updated_at >= cursor, ordenadas ascendente, e incluyendo
// tombstones (deleted_at) para propagar bajas. Se asume que no hay mas de PAGE filas con el MISMO
// updated_at al milisegundo (cierto en uso personal); si el cursor no avanzara con una pagina
// llena, se empuja 1 ms para garantizar progreso.
import type { AppSupabaseClient } from '../lib/supabase/client';
import type { SyncEntityType } from '../db/schema';
import { CHILD_PUSH_ORDER, ENTITY_REGISTRY } from './entityRegistry';
import { remoteRepoFor } from './remoteRepos';
import { getCursor, setCursor } from './syncStateRepo';
import { applyRemote, localGet, markConflictLocal } from './localApply';
import { createConflict } from './conflictsRepo';
import { fromRow } from './mapper';

const PAGE = 1000;

export interface PullResult {
  pulled: number;
  conflicts: number;
}

export interface PullOptions {
  signal?: AbortSignal;
}

// Descarga los PERFILES del usuario (nivel cuenta; la raiz no tiene profile_id). Crea/actualiza las
// filas de profiles locales con su ownerUserId. Cursor bajo (userId, 'profile').
export async function pullProfiles(
  client: AppSupabaseClient,
  userId: string,
  options: PullOptions = {},
): Promise<PullResult> {
  return pullEntity(client, userId, userId, 'profile', userId, options);
}

// Descarga todas las entidades hijas de un perfil en orden de dependencias.
export async function pullProfile(
  client: AppSupabaseClient,
  userId: string,
  profileId: string,
  options: PullOptions = {},
): Promise<PullResult> {
  let pulled = 0;
  let conflicts = 0;
  for (const entityType of CHILD_PUSH_ORDER) {
    if (options.signal?.aborted) break;
    const result = await pullEntity(client, userId, profileId, entityType, profileId, options);
    pulled += result.pulled;
    conflicts += result.conflicts;
  }
  return { pulled, conflicts };
}

// remoteScopeProfileId: perfil que se pasa al repositorio remoto (ignorado para la raiz).
// cursorProfileId: clave del cursor en syncState (userId para la raiz; profileId para hijas).
async function pullEntity(
  client: AppSupabaseClient,
  userId: string,
  remoteScopeProfileId: string,
  entityType: SyncEntityType,
  cursorProfileId: string,
  options: PullOptions,
): Promise<PullResult> {
  const remote = remoteRepoFor(client, userId, entityType);
  let cursor = (await getCursor(cursorProfileId, entityType))?.lastPulledUpdatedAt ?? null;
  let pulled = 0;
  let conflicts = 0;

  for (;;) {
    if (options.signal?.aborted) break;
    const rows = (await remote.pullSince(remoteScopeProfileId, cursor, PAGE)) as Record<
      string,
      unknown
    >[];
    if (rows.length === 0) break;

    for (const row of rows) {
      const outcome = await applyPulledRow(entityType, row);
      if (outcome === 'conflict') conflicts += 1;
      else pulled += 1;
    }

    const maxUpdated = rows[rows.length - 1].updated_at as string;
    // Garantiza progreso si una pagina llena comparte el mismo updated_at (colision improbable).
    if (rows.length === PAGE && maxUpdated === cursor) {
      cursor = new Date(new Date(maxUpdated).getTime() + 1).toISOString();
    } else {
      cursor = maxUpdated;
    }
    await setCursor(cursorProfileId, entityType, cursor);
    if (rows.length < PAGE) break;
  }

  return { pulled, conflicts };
}

type PullOutcome = 'pulled' | 'conflict';

async function applyPulledRow(
  entityType: SyncEntityType,
  remoteRow: Record<string, unknown>,
): Promise<PullOutcome> {
  const id = remoteRow.id as string;
  const existing = await localGet(entityType, id);

  if (!existing) {
    // No existe localmente: crear (incluye tombstones, que quedan filtrados en lectura).
    await applyRemote(entityType, remoteRow);
    return 'pulled';
  }

  const localRevision = Number(existing.revision ?? 0);
  const remoteRevision = Number(remoteRow.revision ?? 0);
  const status = existing.syncStatus;

  if (status === 'pending' || status === 'conflict') {
    // Hay cambios locales sin confirmar. Si el remoto avanzo sobre nuestra base, es conflicto; si
    // no, se ignora (nuestro push lo llevara).
    if (remoteRevision > localRevision) {
      return handlePullConflict(entityType, existing, remoteRow, localRevision, remoteRevision);
    }
    return 'pulled';
  }

  // Fila local sincronizada o solo-local: aplicar si el remoto no es mas viejo.
  if (remoteRevision >= localRevision) {
    await applyRemote(entityType, remoteRow);
  }
  return 'pulled';
}

async function handlePullConflict(
  entityType: SyncEntityType,
  existing: Record<string, unknown>,
  remoteRow: Record<string, unknown>,
  localRevision: number,
  remoteRevision: number,
): Promise<PullOutcome> {
  const info = ENTITY_REGISTRY[entityType];
  const id = remoteRow.id as string;
  const userId = remoteRow.owner_user_id as string;
  const profileId = (info.hasProfileId ? remoteRow.profile_id : remoteRow.id) as string;
  const remoteLocalForm = fromRow(entityType, remoteRow);

  // No financiera (setting): last-write-wins documentado, sin conflicto visible.
  if (!info.financial) {
    const localUpdatedAt = Number(existing.updatedAt ?? 0);
    const remoteUpdatedAt = Number(remoteLocalForm.updatedAt ?? 0);
    if (remoteUpdatedAt > localUpdatedAt) {
      await applyRemote(entityType, remoteRow);
    }
    return 'pulled';
  }

  // Financiera: conflicto explicito (idempotente). Nunca merge silencioso.
  await createConflict({
    userId,
    profileId,
    entityType,
    entityId: id,
    localPayload: existing,
    remotePayload: remoteLocalForm,
    baseRevision: localRevision,
    remoteRevision,
  });
  await markConflictLocal(entityType, id);
  return 'conflict';
}
