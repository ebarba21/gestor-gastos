// Repositorio de categorias (Category). Exige profileId. Ver DATA_MODEL 2.4.
// Subcategoria = Category con parentId. Se restringe a un unico nivel en el MVP.
import type { Category } from './schema';
import { db } from './index';
import { createProfileRepo, isAlive } from './baseRepo';
import type { CreateInput } from './baseRepo';
import { assert, requireProfileId } from '../lib/validation';

const base = createProfileRepo<Category>(db.categories, 'Category', 'category');

// Valida que, si es subcategoria, su padre existe en el mismo perfil y es raiz
// (un solo nivel de anidamiento).
async function assertValidParent(profileId: string, parentId: string | null): Promise<void> {
  if (parentId === null) return;
  const parent = await db.categories.get(parentId);
  assert(
    parent !== undefined && parent.profileId === profileId && isAlive(parent),
    `La categoria padre ${parentId} no existe en el perfil.`,
  );
  assert(
    parent!.parentId === null,
    'Una subcategoria no puede colgar de otra subcategoria (un unico nivel en el MVP).',
  );
}

export const categoriesRepo = {
  ...base,

  async create(profileId: string, input: CreateInput<Category>): Promise<Category> {
    requireProfileId(profileId);
    await assertValidParent(profileId, input.parentId);
    return base.create(profileId, input);
  },

  // Categorias raiz del perfil (parentId === null). Dexie no indexa null en indices
  // compuestos, por eso se filtra en memoria sobre el conjunto del perfil.
  async listRoots(profileId: string): Promise<Category[]> {
    requireProfileId(profileId);
    const all = await db.categories.where('profileId').equals(profileId).filter(isAlive).toArray();
    return all.filter((c) => c.parentId === null);
  },

  // Subcategorias de una categoria raiz dada.
  async listChildren(profileId: string, parentId: string): Promise<Category[]> {
    requireProfileId(profileId);
    return db.categories
      .where('[profileId+parentId]')
      .equals([profileId, parentId])
      .filter(isAlive)
      .toArray();
  },
};
