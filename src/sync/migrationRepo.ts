// Estado de la migracion inicial de perfiles locales a la cuenta (device-local, fase 2).
// Idempotente y reanudable (DATA_MODEL seccion 13.2).
import { db, newId, now } from '../db/index';
import type { MigrationStatus, ProfileMigration } from '../db/schema';

export async function getMigration(
  userId: string,
  profileId: string,
): Promise<ProfileMigration | undefined> {
  return db.profileMigrations
    .where('[userId+profileId]')
    .equals([userId, profileId])
    .first();
}

// Crea o recupera el registro de migracion de un perfil (no duplica al reanudar).
export async function ensureMigration(
  userId: string,
  profileId: string,
  counts: Record<string, number>,
): Promise<ProfileMigration> {
  const existing = await getMigration(userId, profileId);
  if (existing) return existing;
  const record: ProfileMigration = {
    id: newId(),
    profileId,
    userId,
    status: 'pending',
    counts,
    uploadedCounts: {},
    startedAt: null,
    finishedAt: null,
    lastError: null,
  };
  await db.profileMigrations.add(record);
  return record;
}

export async function updateMigration(
  id: string,
  patch: Partial<Omit<ProfileMigration, 'id'>>,
): Promise<void> {
  await db.profileMigrations.update(id, patch);
}

export async function setMigrationStatus(
  id: string,
  status: MigrationStatus,
  extra: Partial<ProfileMigration> = {},
): Promise<void> {
  const patch: Partial<ProfileMigration> = { status, ...extra };
  if (status === 'inProgress' && extra.startedAt === undefined) patch.startedAt = now();
  if ((status === 'verified' || status === 'failed') && extra.finishedAt === undefined) {
    patch.finishedAt = now();
  }
  await db.profileMigrations.update(id, patch);
}

export async function listMigrations(userId: string): Promise<ProfileMigration[]> {
  return db.profileMigrations.where('[userId+profileId]').between([userId, ''], [userId, '￿']).toArray();
}
