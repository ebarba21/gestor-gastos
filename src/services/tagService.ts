// Logica de negocio de etiquetas (Tag). Ver DATA_MODEL 2.5. Nombre unico por perfil
// (lo garantiza tagsRepo). Las etiquetas no tienen estado de archivado: al borrar una
// etiqueta en uso se desvincula de los movimientos que la llevan (no se pierde ningun
// dato financiero, solo la marca transversal).
import type { Tag } from '../db/schema';
import { tagsRepo } from '../db/tagsRepo';
import { transactionsRepo } from '../db/transactionsRepo';
import { pickAccentColor } from '../lib/colors';
import { ValidationError } from '../lib/validation';

export const MAX_TAG_NAME_LENGTH = 30;

export interface TagInput {
  name: string;
  color?: string | null;
}

export function normalizeTagDisplayName(name: string): string {
  const trimmed = (name ?? '').trim().replace(/\s+/g, ' ');
  if (trimmed.length === 0) {
    throw new ValidationError('El nombre de la etiqueta no puede estar vacio.');
  }
  if (trimmed.length > MAX_TAG_NAME_LENGTH) {
    throw new ValidationError(
      `El nombre de la etiqueta no puede superar ${MAX_TAG_NAME_LENGTH} caracteres.`,
    );
  }
  return trimmed;
}

export const tagService = {
  async listTags(profileId: string): Promise<Tag[]> {
    const tags = await tagsRepo.list(profileId);
    return tags.sort((a, b) => a.name.localeCompare(b.name));
  },

  async createTag(profileId: string, input: TagInput): Promise<Tag> {
    const name = normalizeTagDisplayName(input.name);
    const existing = await tagsRepo.list(profileId);
    const color = input.color ?? pickAccentColor(existing.length);
    // tagsRepo.create rechaza nombres duplicados (normalizados) en el perfil.
    return tagsRepo.create(profileId, { name, color });
  },

  updateTag(
    profileId: string,
    id: string,
    patch: Partial<Pick<Tag, 'name' | 'color'>>,
  ): Promise<Tag> {
    const clean = { ...patch };
    if (patch.name !== undefined) clean.name = normalizeTagDisplayName(patch.name);
    // Si cambia el nombre a uno ya existente, tagsRepo no lo comprueba en update; se
    // valida aqui para no romper la unicidad por perfil.
    return tagService.assertNameFreeThenUpdate(profileId, id, clean);
  },

  async assertNameFreeThenUpdate(
    profileId: string,
    id: string,
    clean: Partial<Pick<Tag, 'name' | 'color'>>,
  ): Promise<Tag> {
    if (clean.name !== undefined) {
      const collision = await tagsRepo.findByName(profileId, clean.name);
      if (collision && collision.id !== id) {
        throw new ValidationError(`Ya existe una etiqueta con el nombre "${clean.name}".`);
      }
    }
    return tagsRepo.update(profileId, id, clean);
  },

  countUsage(profileId: string, id: string): Promise<number> {
    return transactionsRepo.countByTag(profileId, id);
  },

  // Borra la etiqueta y la desvincula de todos los movimientos que la llevan.
  // Devuelve cuantos movimientos quedaron sin esa etiqueta (para el mensaje de la UI).
  async deleteTag(profileId: string, id: string): Promise<number> {
    const detached = await transactionsRepo.detachTagFromAll(profileId, id);
    await tagsRepo.remove(profileId, id);
    return detached;
  },
};
