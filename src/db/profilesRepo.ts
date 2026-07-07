// Repositorio de perfiles (Profile). Raiz del aislamiento: no tiene profileId propio.
// Ver DATA_MODEL 2.1 y seccion 4 (borrado en cascada). Unico acceso a Dexie para perfiles.
import type { Profile } from './schema';
import { childTables, db, newId, now } from './index';
import { NotFoundError, requireId } from '../lib/validation';

export type ProfileInput = Omit<Profile, 'id' | 'createdAt' | 'updatedAt' | 'archivedAt'> &
  Partial<Pick<Profile, 'archivedAt'>>;
export type ProfilePatch = Partial<Omit<Profile, 'id' | 'createdAt' | 'updatedAt'>>;

export const profilesRepo = {
  async create(input: ProfileInput): Promise<Profile> {
    const ts = now();
    const entity: Profile = {
      id: newId(),
      name: input.name,
      color: input.color,
      avatarEmoji: input.avatarEmoji,
      archivedAt: input.archivedAt ?? null,
      createdAt: ts,
      updatedAt: ts,
    };
    await db.profiles.add(entity);
    return entity;
  },

  getById(id: string): Promise<Profile | undefined> {
    requireId(id);
    return db.profiles.get(id);
  },

  list(): Promise<Profile[]> {
    return db.profiles.toArray();
  },

  // Perfiles no archivados.
  async listActive(): Promise<Profile[]> {
    const all = await db.profiles.toArray();
    return all.filter((p) => p.archivedAt === null);
  },

  async update(id: string, patch: ProfilePatch): Promise<Profile> {
    requireId(id);
    const existing = await db.profiles.get(id);
    if (!existing) throw new NotFoundError(`Profile ${id} no existe.`);
    const updated: Profile = { ...existing, ...patch, id: existing.id, updatedAt: now() };
    await db.profiles.put(updated);
    return updated;
  },

  // Archiva sin borrar (accion no destructiva).
  archive(id: string): Promise<Profile> {
    return profilesRepo.update(id, { archivedAt: now() });
  },

  unarchive(id: string): Promise<Profile> {
    return profilesRepo.update(id, { archivedAt: null });
  },

  // Borrado en cascada: barre todas las tablas hijas por profileId y borra el perfil,
  // todo en una unica transaccion Dexie. Accion destructiva e irreversible.
  async removeCascade(id: string): Promise<void> {
    requireId(id);
    const tables = [db.profiles, ...childTables];
    await db.transaction('rw', tables, async () => {
      const existing = await db.profiles.get(id);
      if (!existing) throw new NotFoundError(`Profile ${id} no existe.`);
      for (const table of childTables) {
        await table.where('profileId').equals(id).delete();
      }
      await db.profiles.delete(id);
    });
  },
};
