// Etiqueta legible de la categoria de un movimiento ("Coche / Gasolina"). Pura y sin acceso a
// datos: recibe las categorias del perfil ya cargadas, indexadas por id.
import type { Category } from '../db/schema';

export const DELETED_CATEGORY_LABEL = 'Categoria eliminada';

// Devuelve "Raiz / Subcategoria", "Raiz" o null si el movimiento no tiene categoria.
// Tolera datos incoherentes: si categoryId apunta a una subcategoria se usa su padre como raiz,
// y si una categoria referenciada ya no existe se indica explicitamente en vez de ocultarlo.
export function categoryPathLabel(
  byId: ReadonlyMap<string, Category>,
  categoryId: string | null,
  subcategoryId: string | null,
): string | null {
  if (!categoryId && !subcategoryId) return null;

  let root = categoryId ? byId.get(categoryId) : undefined;
  let leaf = subcategoryId ? byId.get(subcategoryId) : undefined;

  if (root && root.parentId !== null) {
    leaf = leaf ?? root;
    root = byId.get(root.parentId);
  }
  if (!root && leaf && leaf.parentId !== null) {
    root = byId.get(leaf.parentId);
  }

  if (!root && !leaf) return DELETED_CATEGORY_LABEL;
  if (!root) return leaf!.name;
  if (!leaf || leaf.id === root.id) return root.name;
  return `${root.name} / ${leaf.name}`;
}
