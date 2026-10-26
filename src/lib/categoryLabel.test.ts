import { describe, it, expect } from 'vitest';
import type { Category } from '../db/schema';
import { categoryPathLabel, DELETED_CATEGORY_LABEL } from './categoryLabel';

function cat(id: string, name: string, parentId: string | null = null): Category {
  return {
    id,
    profileId: 'profile-a',
    name,
    parentId,
    kind: 'expense',
    color: null,
    icon: null,
    archivedAt: null,
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
  };
}

const byId = new Map<string, Category>(
  [cat('coche', 'Coche'), cat('gasolina', 'Gasolina', 'coche'), cat('ocio', 'Ocio')].map(
    (c) => [c.id, c] as const,
  ),
);

describe('categoryPathLabel', () => {
  it('devuelve null si el movimiento no tiene categoria', () => {
    expect(categoryPathLabel(byId, null, null)).toBeNull();
  });

  it('muestra solo la raiz cuando no hay subcategoria', () => {
    expect(categoryPathLabel(byId, 'ocio', null)).toBe('Ocio');
  });

  it('muestra raiz y subcategoria', () => {
    expect(categoryPathLabel(byId, 'coche', 'gasolina')).toBe('Coche / Gasolina');
  });

  it('si categoryId apunta a una subcategoria, antepone su padre', () => {
    expect(categoryPathLabel(byId, 'gasolina', null)).toBe('Coche / Gasolina');
  });

  it('con solo subcategoria, resuelve la raiz por su padre', () => {
    expect(categoryPathLabel(byId, null, 'gasolina')).toBe('Coche / Gasolina');
  });

  it('indica explicitamente una categoria que ya no existe', () => {
    expect(categoryPathLabel(byId, 'borrada', null)).toBe(DELETED_CATEGORY_LABEL);
  });

  it('si la subcategoria ya no existe, muestra al menos la raiz', () => {
    expect(categoryPathLabel(byId, 'coche', 'borrada')).toBe('Coche');
  });
});
