// Repositorio de perfiles (Profile). Raiz del aislamiento: no tiene profileId propio.
// Ver DATA_MODEL 2.1 y seccion 4 (borrado en cascada). Unico acceso a Dexie para perfiles.
import type { Profile, SyncMeta } from './schema';
import { childTables, db, newId, now, syncDefaults } from './index';
import { isAlive } from './baseRepo';
import { STORE_TO_ENTITY, enqueueMutation } from './outboxWrite';
import { NotFoundError, requireId } from '../lib/validation';

// Fila hija generica (con los campos de sincronizacion) para el borrado en cascada logico.
type ChildRow = Record<string, unknown> & {
  id: string;
  profileId: string;
  revision?: number;
  deletedAt?: number | null;
};

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
    // Un perfil creado ya vinculado (raro: normalmente se vincula al migrar) genera un insert.
    if (entity.ownerUserId) {
      entity.syncStatus = 'pending';
      await db.transaction('rw', [db.profiles, db.outbox], async () => {
        await db.profiles.add(entity);
        await enqueueMutation({
          userId: entity.ownerUserId as string,
          profileId: entity.id,
          entityType: 'profile',
          entityId: entity.id,
          operation: 'insert',
          entity: entity as unknown as Record<string, unknown>,
          baseRevision: 0,
        });
      });
    } else {
      await db.profiles.add(entity);
    }
    return entity;
  },

  async getById(id: string): Promise<Profile | undefined> {
    requireId(id);
    const row = await db.profiles.get(id);
    if (!row || !isAlive(row)) return undefined;
    return row;
  },

  async list(): Promise<Profile[]> {
    return (await db.profiles.toArray()).filter(isAlive);
  },

  // Perfiles no archivados (ni tombstones). Aislamiento por propietario (invariante 4): con una
  // cuenta activa (`ownerUserId` no vacio) solo se devuelven los perfiles de esa cuenta mas los
  // locales aun sin vincular (`ownerUserId === null`); nunca los de otra cuenta que compartiera
  // este navegador. En modo local puro (sin `ownerUserId`) se devuelven todos, como siempre.
  async listActive(ownerUserId?: string | null): Promise<Profile[]> {
    const all = await db.profiles.toArray();
    return all.filter(
      (p) =>
        isAlive(p) &&
        p.archivedAt === null &&
        (!ownerUserId || p.ownerUserId === ownerUserId || p.ownerUserId === null),
    );
  },

  async update(id: string, patch: ProfilePatch): Promise<Profile> {
    requireId(id);
    let updated!: Profile;
    await db.transaction('rw', [db.profiles, db.outbox], async () => {
      const existing = await db.profiles.get(id);
      if (!existing) throw new NotFoundError(`Profile ${id} no existe.`);
      updated = { ...existing, ...patch, id: existing.id, updatedAt: now() };
      // Solo se encola si el perfil YA estaba vinculado. La vinculacion inicial (null -> userId) la
      // gestiona la migracion, que encola el insert del perfil por su cuenta.
      if (existing.ownerUserId) {
        updated.syncStatus = 'pending';
        await db.profiles.put(updated);
        await enqueueMutation({
          userId: existing.ownerUserId,
          profileId: id,
          entityType: 'profile',
          entityId: id,
          operation: 'update',
          entity: updated as unknown as Record<string, unknown>,
          baseRevision: existing.revision ?? 0,
        });
      } else {
        await db.profiles.put(updated);
      }
    });
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
    const tables = [db.profiles, ...childTables, db.outbox];
    await db.transaction('rw', tables, async () => {
      const existing = await db.profiles.get(id);
      if (!existing) throw new NotFoundError(`Profile ${id} no existe.`);
      const userId = existing.ownerUserId;
      if (userId) {
        // Perfil VINCULADO: borrado LOGICO en cascada (tombstone + mutacion) para propagar la baja
        // sin resucitar en otro dispositivo. Se barre cada tabla hija y luego el propio perfil.
        const ts = now();
        for (const table of childTables) {
          const entityType = STORE_TO_ENTITY[table.name];
          const rows = (await table.where('profileId').equals(id).toArray()) as ChildRow[];
          for (const row of rows) {
            if ((row.deletedAt ?? null) !== null) continue;
            const tomb = { ...row, deletedAt: ts, updatedAt: ts, syncStatus: 'pending' };
            await table.put(tomb);
            await enqueueMutation({
              userId,
              profileId: id,
              entityType,
              entityId: row.id,
              operation: 'delete',
              entity: tomb,
              baseRevision: row.revision ?? 0,
            });
          }
        }
        const profileTomb: Profile = {
          ...existing,
          deletedAt: ts,
          updatedAt: ts,
          syncStatus: 'pending',
        };
        await db.profiles.put(profileTomb);
        await enqueueMutation({
          userId,
          profileId: id,
          entityType: 'profile',
          entityId: id,
          operation: 'delete',
          entity: profileTomb as unknown as Record<string, unknown>,
          baseRevision: existing.revision ?? 0,
        });
      } else {
        // Modo local puro: borrado fisico en cascada (comportamiento historico, irreversible).
        for (const table of childTables) {
          await table.where('profileId').equals(id).delete();
        }
        await db.profiles.delete(id);
      }
    });
  },
};
