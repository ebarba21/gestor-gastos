// Repositorio generico para entidades que pertenecen a un perfil.
// Materializa el aislamiento por perfil (DATA_MODEL seccion 4):
//   - profileId es el primer parametro obligatorio de cada metodo.
//   - toda lectura/escritura verifica que el registro pertenece al perfil.
//   - profileId lo fija el repositorio, nunca se toma del payload del componente.
//
// Ampliacion fase 2 (sincronizacion local-first): las escrituras son OPTIMISTAS y, si el perfil
// esta vinculado a una cuenta, encolan una mutacion en la MISMA transaccion Dexie (atomicidad: no
// hay fila escrita sin su mutacion). El borrado pasa a ser LOGICO (deletedAt) para propagarse sin
// resucitar; en modo local puro sigue siendo fisico. Las lecturas filtran los tombstones.
import type { Table } from 'dexie';
import { db, newId, now, syncDefaults } from './index';
import type { SyncEntityType, SyncMeta } from './schema';
import { enqueueMutation, ownerOfProfile } from './outboxWrite';
import { NotFoundError, requireId, requireProfileId } from '../lib/validation';

// Toda entidad de datos comparte estos campos gestionados por el repositorio. Incluye los
// campos de sincronizacion (SyncMeta, DATA_MODEL seccion 9), que tambien fija el repositorio.
export interface ProfileOwned extends SyncMeta {
  id: string;
  profileId: string;
  createdAt: number;
  updatedAt: number;
}

// La entrada del llamante nunca incluye campos gestionados por el repositorio: ni id,
// profileId y timestamps, ni los campos de sincronizacion (los pone syncDefaults()).
export type CreateInput<T extends ProfileOwned> = Omit<
  T,
  'id' | 'profileId' | 'createdAt' | 'updatedAt' | keyof SyncMeta
>;
export type UpdateInput<T extends ProfileOwned> = Partial<CreateInput<T>>;

export interface ProfileRepo<T extends ProfileOwned> {
  create(profileId: string, input: CreateInput<T>): Promise<T>;
  getById(profileId: string, id: string): Promise<T | undefined>;
  list(profileId: string): Promise<T[]>;
  update(profileId: string, id: string, patch: UpdateInput<T>): Promise<T>;
  remove(profileId: string, id: string): Promise<void>;
  count(profileId: string): Promise<number>;
}

// Predicado: una fila esta viva (no tombstone). En modo local puro deletedAt es siempre null, asi
// que este filtro es un no-op; con cuenta filtra las bajas logicas de las lecturas.
export function isAlive(row: SyncMeta): boolean {
  return (row.deletedAt ?? null) === null;
}

export function createProfileRepo<T extends ProfileOwned>(
  table: Table<T, string>,
  entityName: string,
  entityType: SyncEntityType,
): ProfileRepo<T> {
  async function requireOwned(profileId: string, id: string): Promise<T> {
    const row = await table.get(id);
    if (!row || row.profileId !== profileId) {
      throw new NotFoundError(`${entityName} ${id} no existe en el perfil ${profileId}.`);
    }
    return row;
  }

  return {
    async create(profileId, input) {
      requireProfileId(profileId);
      const ts = now();
      const entity = {
        ...input,
        ...syncDefaults(),
        id: newId(),
        profileId,
        createdAt: ts,
        updatedAt: ts,
      } as unknown as T;
      await db.transaction('rw', [table, db.profiles, db.outbox], async () => {
        const userId = await ownerOfProfile(profileId);
        if (userId) {
          entity.syncStatus = 'pending';
          await table.add(entity);
          await enqueueMutation({
            userId,
            profileId,
            entityType,
            entityId: entity.id,
            operation: 'insert',
            entity: entity as Record<string, unknown>,
            baseRevision: entity.revision ?? 0,
          });
        } else {
          await table.add(entity);
        }
      });
      return entity;
    },

    async getById(profileId, id) {
      requireProfileId(profileId);
      requireId(id);
      const row = await table.get(id);
      // Aislamiento: un id de otro perfil se comporta como inexistente. Tombstone => inexistente.
      if (!row || row.profileId !== profileId || !isAlive(row)) return undefined;
      return row;
    },

    async list(profileId) {
      requireProfileId(profileId);
      return table.where('profileId').equals(profileId).filter(isAlive).toArray();
    },

    async update(profileId, id, patch) {
      requireProfileId(profileId);
      requireId(id);
      // La pertenencia se valida ANTES de abrir la transaccion para que el error de aislamiento
      // propague limpio (Dexie reenvuelve los errores lanzados dentro de una transaccion).
      const existing = await requireOwned(profileId, id);
      let updated!: T;
      await db.transaction('rw', [table, db.profiles, db.outbox], async () => {
        // Nunca se permite cambiar id ni profileId por patch (barrera en runtime; UpdateInput ya
        // los excluye en compilacion). Defensa en profundidad del aislamiento por perfil.
        updated = {
          ...existing,
          ...patch,
          id: existing.id,
          profileId: existing.profileId,
          updatedAt: now(),
        } as unknown as T;
        const userId = await ownerOfProfile(profileId);
        if (userId) {
          updated.syncStatus = 'pending';
          await table.put(updated);
          await enqueueMutation({
            userId,
            profileId,
            entityType,
            entityId: id,
            operation: 'update',
            entity: updated as Record<string, unknown>,
            baseRevision: existing.revision ?? 0,
          });
        } else {
          await table.put(updated);
        }
      });
      return updated;
    },

    async remove(profileId, id) {
      requireProfileId(profileId);
      requireId(id);
      // Pertenencia validada antes de la transaccion (error de aislamiento limpio).
      const existing = await requireOwned(profileId, id);
      await db.transaction('rw', [table, db.profiles, db.outbox], async () => {
        const userId = await ownerOfProfile(profileId);
        if (userId) {
          // Borrado LOGICO: se conserva la fila como tombstone para propagar la baja.
          const tombstoned = {
            ...existing,
            deletedAt: now(),
            updatedAt: now(),
            syncStatus: 'pending',
          } as unknown as T;
          await table.put(tombstoned);
          await enqueueMutation({
            userId,
            profileId,
            entityType,
            entityId: id,
            operation: 'delete',
            entity: tombstoned as Record<string, unknown>,
            baseRevision: existing.revision ?? 0,
          });
        } else {
          // Modo local puro: borrado fisico (comportamiento historico, sin outbox).
          await table.delete(id);
        }
      });
    },

    async count(profileId) {
      requireProfileId(profileId);
      return table.where('profileId').equals(profileId).filter(isAlive).count();
    },
  };
}
