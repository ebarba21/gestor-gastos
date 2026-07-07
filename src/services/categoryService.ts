// Logica de negocio de categorias y subcategorias (ver DATA_MODEL 2.4). Una subcategoria
// es una Category con parentId (un unico nivel de anidamiento en el MVP). Orquesta
// categoriesRepo y consulta transactionsRepo para las reglas de integridad al borrar.
import type { Category, CategoryKind } from '../db/schema';
import { categoriesRepo } from '../db/categoriesRepo';
import { transactionsRepo } from '../db/transactionsRepo';
import { pickAccentColor } from '../lib/colors';
import { ValidationError, assert } from '../lib/validation';

export const MAX_CATEGORY_NAME_LENGTH = 40;

export interface CategoryInput {
  name: string;
  kind: CategoryKind;
  color?: string | null;
  icon?: string | null;
  // Si viene parentId, se crea como subcategoria de esa raiz.
  parentId?: string | null;
}

// Categoria raiz con sus subcategorias, para pintar el arbol en la UI.
export interface CategoryNode {
  category: Category;
  children: Category[];
}

// Uso de una categoria: cuantos movimientos la referencian y cuantas subcategorias tiene.
export interface CategoryUsage {
  transactions: number;
  children: number;
}

export function normalizeCategoryName(name: string): string {
  const trimmed = (name ?? '').trim().replace(/\s+/g, ' ');
  if (trimmed.length === 0) {
    throw new ValidationError('El nombre de la categoria no puede estar vacio.');
  }
  if (trimmed.length > MAX_CATEGORY_NAME_LENGTH) {
    throw new ValidationError(
      `El nombre de la categoria no puede superar ${MAX_CATEGORY_NAME_LENGTH} caracteres.`,
    );
  }
  return trimmed;
}

export const categoryService = {
  listAll(profileId: string): Promise<Category[]> {
    return categoriesRepo.list(profileId);
  },

  // Arbol de categorias (raices con sus hijas). Por defecto excluye archivadas.
  async listTree(
    profileId: string,
    opts: { includeArchived?: boolean } = {},
  ): Promise<CategoryNode[]> {
    const all = await categoriesRepo.list(profileId);
    const visible = opts.includeArchived ? all : all.filter((c) => c.archivedAt === null);
    const roots = visible
      .filter((c) => c.parentId === null)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    return roots.map((root) => ({
      category: root,
      children: visible
        .filter((c) => c.parentId === root.id)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    }));
  },

  async createCategory(profileId: string, input: CategoryInput): Promise<Category> {
    const name = normalizeCategoryName(input.name);
    const siblings = await categoriesRepo.list(profileId);
    const sameLevel = siblings.filter((c) => c.parentId === (input.parentId ?? null));
    const sortOrder = sameLevel.length;
    const color = input.color ?? pickAccentColor(sameLevel.length);
    return categoriesRepo.create(profileId, {
      name,
      parentId: input.parentId ?? null,
      kind: input.kind,
      color,
      icon: input.icon ?? null,
      archivedAt: null,
      sortOrder,
    });
  },

  async updateCategory(
    profileId: string,
    id: string,
    patch: Partial<Pick<Category, 'name' | 'kind' | 'color' | 'icon' | 'sortOrder'>>,
  ): Promise<Category> {
    const clean = { ...patch };
    if (patch.name !== undefined) clean.name = normalizeCategoryName(patch.name);
    return categoriesRepo.update(profileId, id, clean);
  },

  // Cuenta el uso de una categoria (por movimientos) y sus subcategorias.
  async getUsage(profileId: string, id: string): Promise<CategoryUsage> {
    const [asCategory, asSubcategory, children] = await Promise.all([
      transactionsRepo.countByCategory(profileId, id),
      transactionsRepo.countBySubcategory(profileId, id),
      categoriesRepo.listChildren(profileId, id),
    ]);
    return { transactions: asCategory + asSubcategory, children: children.length };
  },

  // Borrado con reglas de integridad:
  //  - una categoria raiz con subcategorias no se puede borrar (hay que resolverlas antes),
  //  - una categoria referenciada por movimientos no se puede borrar; se ofrece archivar.
  // Solo se borra si no esta en uso ni tiene hijas.
  async deleteCategory(profileId: string, id: string): Promise<void> {
    const usage = await categoryService.getUsage(profileId, id);
    assert(
      usage.children === 0,
      'La categoria tiene subcategorias. Borra o mueve primero sus subcategorias, o archivala.',
    );
    assert(
      usage.transactions === 0,
      'La categoria esta en uso por movimientos. Archivala en su lugar para conservar el historico.',
    );
    await categoriesRepo.remove(profileId, id);
  },

  archiveCategory(profileId: string, id: string): Promise<Category> {
    return categoriesRepo.update(profileId, id, { archivedAt: Date.now() });
  },

  unarchiveCategory(profileId: string, id: string): Promise<Category> {
    return categoriesRepo.update(profileId, id, { archivedAt: null });
  },
};

// --- Set de categorias por defecto al crear un perfil (editable y borrable) ---

interface DefaultCategory {
  name: string;
  kind: CategoryKind;
  icon: string;
  children?: { name: string; icon?: string }[];
}

export const DEFAULT_CATEGORIES: readonly DefaultCategory[] = [
  {
    name: 'Vivienda',
    kind: 'expense',
    icon: '🏠',
    children: [{ name: 'Alquiler o hipoteca' }, { name: 'Suministros' }, { name: 'Comunidad' }],
  },
  {
    name: 'Alimentacion',
    kind: 'expense',
    icon: '🍽️',
    children: [{ name: 'Supermercado' }, { name: 'Restaurantes' }],
  },
  {
    name: 'Transporte',
    kind: 'expense',
    icon: '🚗',
    children: [{ name: 'Combustible' }, { name: 'Transporte publico' }, { name: 'Parking' }],
  },
  { name: 'Salud', kind: 'expense', icon: '🩺' },
  { name: 'Ocio', kind: 'expense', icon: '🎬' },
  { name: 'Compras', kind: 'expense', icon: '🛍️' },
  { name: 'Educacion', kind: 'expense', icon: '🎓' },
  {
    name: 'Servicios',
    kind: 'expense',
    icon: '📱',
    children: [{ name: 'Telefono e internet' }, { name: 'Suscripciones' }],
  },
  { name: 'Nomina', kind: 'income', icon: '💼' },
  { name: 'Otros ingresos', kind: 'income', icon: '💰' },
];

// Crea el set por defecto para un perfil recien creado. Secuencial: crea cada raiz y
// luego sus subcategorias. Si algo falla, el rollback del perfil (profileService) barre
// todo en cascada, por lo que no quedan datos a medias.
export async function seedDefaultCategories(profileId: string): Promise<void> {
  for (const def of DEFAULT_CATEGORIES) {
    const root = await categoryService.createCategory(profileId, {
      name: def.name,
      kind: def.kind,
      icon: def.icon,
    });
    for (const child of def.children ?? []) {
      await categoryService.createCategory(profileId, {
        name: child.name,
        kind: def.kind,
        icon: child.icon ?? null,
        parentId: root.id,
      });
    }
  }
}
