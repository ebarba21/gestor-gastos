// Migracion inicial de un perfil LOCAL a la cuenta (fase 2). Idempotente y reanudable
// (DATA_MODEL 13.2, CLOUD_SYNC_SECURITY 8). Conserva los UUID, asigna ownerUserId, sube por lotes
// respetando dependencias, valida recuentos y solo marca 'verified' tras la validacion. NUNCA
// borra datos locales; si falla, deja el modo local intacto.
import type { Table } from 'dexie';
import { db, now } from '../db/index';
import { enqueueMutation } from '../db/outboxWrite';
import type { Profile, ProfileMigration, SyncEntityType } from '../db/schema';
import { isAlive } from '../db/baseRepo';
import type { AppSupabaseClient } from '../lib/supabase/client';
import { CHILD_PUSH_ORDER, ENTITY_REGISTRY } from './entityRegistry';
import { remoteRepoFor } from './remoteRepos';
import { runPush, type PushProgress } from './pushEngine';
import {
  ensureMigration,
  getMigration,
  setMigrationStatus,
  updateMigration,
} from './migrationRepo';

type Row = Record<string, unknown> & { id: string; revision?: number; deletedAt?: number | null };

function tableFor(entityType: SyncEntityType): Table<Row, string> {
  return db.table(ENTITY_REGISTRY[entityType].localTable) as unknown as Table<Row, string>;
}

// Recuento de filas VIVAS por entidad de un perfil (para validar tras subir).
export async function computeLocalCounts(
  profileId: string,
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const entityType of CHILD_PUSH_ORDER) {
    counts[entityType] = await tableFor(entityType)
      .where('profileId')
      .equals(profileId)
      .filter(isAlive)
      .count();
  }
  return counts;
}

export interface MigratableProfile {
  profile: Profile;
  counts: Record<string, number>;
}

// Perfiles LOCALES sin vincular (ownerUserId == null) que se pueden migrar, con sus recuentos.
export async function listMigratableProfiles(): Promise<MigratableProfile[]> {
  const profiles = (await db.profiles.toArray()).filter(
    (p) => isAlive(p) && p.ownerUserId == null,
  );
  const result: MigratableProfile[] = [];
  for (const profile of profiles) {
    result.push({ profile, counts: await computeLocalCounts(profile.id) });
  }
  return result;
}

export interface MigrationProgress {
  phase: 'enqueue' | 'push' | 'verify';
  push?: PushProgress;
}

// Migra un perfil local a la cuenta. Reanudable: reejecutar continua sin duplicar (upsert por UUID
// + coalescing de la cola). Devuelve el registro de migracion final.
export async function migrateProfile(
  client: AppSupabaseClient,
  userId: string,
  profileId: string,
  options: { onProgress?: (p: MigrationProgress) => void; signal?: AbortSignal } = {},
): Promise<ProfileMigration> {
  const counts = await computeLocalCounts(profileId);
  const record = await ensureMigration(userId, profileId, counts);
  await setMigrationStatus(record.id, 'inProgress', { startedAt: now(), lastError: null });

  try {
    // 1) Vincular el perfil y encolar inserts de TODAS sus filas (perfil + hijas en orden de
    //    dependencias), conservando los UUID. Todo en una transaccion Dexie (atomico).
    options.onProgress?.({ phase: 'enqueue' });
    const childTablesInOrder = CHILD_PUSH_ORDER.map((t) => tableFor(t));
    await db.transaction('rw', [db.profiles, ...childTablesInOrder, db.outbox], async () => {
      const profile = await db.profiles.get(profileId);
      if (!profile) throw new Error(`El perfil ${profileId} no existe.`);
      // Vincular: ownerUserId pasa a la cuenta; el perfil queda pendiente de subir.
      const linked: Profile = {
        ...profile,
        ownerUserId: userId,
        updatedAt: now(),
        syncStatus: 'pending',
      };
      await db.profiles.put(linked);
      await enqueueMutation({
        userId,
        profileId,
        entityType: 'profile',
        entityId: profileId,
        operation: 'insert',
        entity: linked as unknown as Record<string, unknown>,
        baseRevision: 0,
      });
      for (const entityType of CHILD_PUSH_ORDER) {
        const rows = await tableFor(entityType).where('profileId').equals(profileId).toArray();
        for (const row of rows) {
          if (!isAlive(row)) continue;
          const pending = { ...row, syncStatus: 'pending' };
          await tableFor(entityType).put(pending);
          await enqueueMutation({
            userId,
            profileId,
            entityType,
            entityId: row.id,
            operation: 'insert',
            entity: pending,
            baseRevision: row.revision ?? 0,
          });
        }
      }
    });

    // 2) Subir por lotes (idempotente).
    await runPush(client, userId, {
      signal: options.signal,
      onProgress: (p) => options.onProgress?.({ phase: 'push', push: p }),
    });

    // 3) Validar recuentos remotos por entidad (el perfil ademas debe existir en remoto).
    options.onProgress?.({ phase: 'verify' });
    const uploadedCounts: Record<string, number> = {};
    const profileRemote = remoteRepoFor(client, userId, 'profile');
    const remoteProfile = await profileRemote.getById(profileId, profileId);
    const profileOk = remoteProfile != null && (remoteProfile as Row).deleted_at == null;
    let allOk = profileOk;
    for (const entityType of CHILD_PUSH_ORDER) {
      const remote = remoteRepoFor(client, userId, entityType);
      const remoteCount = await remote.count(profileId);
      uploadedCounts[entityType] = remoteCount;
      if (remoteCount !== counts[entityType]) allOk = false;
    }

    if (allOk) {
      await updateMigration(record.id, { uploadedCounts });
      await setMigrationStatus(record.id, 'verified', { finishedAt: now() });
    } else {
      await updateMigration(record.id, { uploadedCounts });
      await setMigrationStatus(record.id, 'failed', {
        finishedAt: now(),
        lastError: 'Los recuentos remotos no coinciden; reintenta la migracion.',
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error de migracion.';
    await setMigrationStatus(record.id, 'failed', { finishedAt: now(), lastError: message });
  }

  return (await getMigration(userId, profileId)) as ProfileMigration;
}
