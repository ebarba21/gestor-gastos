// Repositorio de etiquetas (Tag). Exige profileId. Ver DATA_MODEL 2.5.
// Nombre unico por perfil (normalizado).
import type { Tag } from './schema';
import { db } from './index';
import { createProfileRepo } from './baseRepo';
import type { CreateInput } from './baseRepo';
import { assert, requireProfileId } from '../lib/validation';

const base = createProfileRepo<Tag>(db.tags, 'Tag');

// Normaliza para comparar unicidad: minusculas, trim, espacios colapsados.
export function normalizeTagName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

async function findByNormalizedName(profileId: string, name: string): Promise<Tag | undefined> {
  const target = normalizeTagName(name);
  const all = await db.tags.where('profileId').equals(profileId).toArray();
  return all.find((t) => normalizeTagName(t.name) === target);
}

export const tagsRepo = {
  ...base,

  async create(profileId: string, input: CreateInput<Tag>): Promise<Tag> {
    requireProfileId(profileId);
    const existing = await findByNormalizedName(profileId, input.name);
    assert(existing === undefined, `Ya existe una etiqueta con el nombre "${input.name}" en el perfil.`);
    return base.create(profileId, input);
  },

  findByName(profileId: string, name: string): Promise<Tag | undefined> {
    requireProfileId(profileId);
    return findByNormalizedName(profileId, name);
  },
};
