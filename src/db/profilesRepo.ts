// Repositorio de perfiles (Profile). Raiz del aislamiento: no tiene profileId propio.
// Ver DATA_MODEL 2.1 y seccion 4 (borrado en cascada). Unico acceso a Dexie para perfiles.
import type { Profile, SyncMeta } from './schema';
import { childTables, db, newId, now, syncDefaults } from './index';
import { NotFoundError, requireId } from '../lib/validation';

// La entrada del llamante solo aporta los campos visibles del perfil. ownerUserId, archivedAt
// y los campos de sincronizacion los gestiona el repositorio (ownerUserId por defecto null:
// perfil local sin cuenta; DATA_MODEL 2.1). ownerUserId es opcional para permitir vincular un
// perfil a una cuenta en la fase 2.
export type ProfileInput = Pick<Profile, 'name' | 'color' | 'avatarEmoji'> &
  Partial<Pick<Profile, 'archivedAt' | 'ownerUserId'>>;
// El patch nunca cambia id ni timestamps ni los campos de sincronizacion (los gestiona el
// motor de sync). Si permite cambiar ownerUserId (vinculacion de cuenta, fase 2).
export type ProfilePatch = Partial<
  Omit<Profile, 'id' | 'createdAt' | 'updatedAt' | keyof SyncMeta>
>;

export const profilesRepo = {
  async create(input: ProfileInput): Promise<Profile> {
    const ts = now();
    const entity: Profile = {
      ...syncDefaults(),
      id: newId(),
      ownerUserId: input.ownerUserId ?? null,
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
