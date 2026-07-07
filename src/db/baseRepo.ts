// Repositorio generico para entidades que pertenecen a un perfil.
// Materializa el aislamiento por perfil (DATA_MODEL seccion 4):
//   - profileId es el primer parametro obligatorio de cada metodo.
//   - toda lectura/escritura verifica que el registro pertenece al perfil.
//   - profileId lo fija el repositorio, nunca se toma del payload del componente.
import type { Table } from 'dexie';
import { newId, now } from './index';
import { NotFoundError, requireId, requireProfileId } from '../lib/validation';

// Toda entidad de datos comparte estos campos gestionados por el repositorio.
export interface ProfileOwned {
  id: string;
  profileId: string;
  createdAt: number;
  updatedAt: number;
}

export type CreateInput<T extends ProfileOwned> = Omit<
  T,
  'id' | 'profileId' | 'createdAt' | 'updatedAt'
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

export function createProfileRepo<T extends ProfileOwned>(
  table: Table<T, string>,
  entityName: string,
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
      // input contiene todos los campos de T salvo los gestionados aqui.
      const entity = {
        ...input,
        id: newId(),
        profileId,
        createdAt: ts,
        updatedAt: ts,
      } as unknown as T;
      await table.add(entity);
      return entity;
    },

    async getById(profileId, id) {
      requireProfileId(profileId);
      requireId(id);
      const row = await table.get(id);
      // Aislamiento: un id de otro perfil se comporta como inexistente.
      if (!row || row.profileId !== profileId) return undefined;
      return row;
    },

    async list(profileId) {
      requireProfileId(profileId);
      return table.where('profileId').equals(profileId).toArray();
    },

    async update(profileId, id, patch) {
      requireProfileId(profileId);
      requireId(id);
      const existing = await requireOwned(profileId, id);
      // Nunca se permite cambiar id ni profileId por patch. El tipo UpdateInput ya los
      // excluye en compilacion; se re-fijan tras el spread como barrera en runtime
      // (defensa en profundidad del aislamiento por perfil).
      const updated = {
        ...existing,
        ...patch,
        id: existing.id,
        profileId: existing.profileId,
        updatedAt: now(),
      } as unknown as T;
      await table.put(updated);
      return updated;
    },

    async remove(profileId, id) {
      requireProfileId(profileId);
      requireId(id);
      await requireOwned(profileId, id);
      await table.delete(id);
    },

    async count(profileId) {
      requireProfileId(profileId);
      return table.where('profileId').equals(profileId).count();
    },
  };
}
