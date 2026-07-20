import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db';
import {
  categoryService,
  seedDefaultCategories,
  DEFAULT_CATEGORIES,
  normalizeCategoryName,
} from './categoryService';
import { profileService } from './profileService';
import { categoriesRepo } from '../db/categoriesRepo';
import { transactionsRepo } from '../db/transactionsRepo';
import type { NewTransaction } from '../db/transactionsRepo';
import { ValidationError } from '../lib/validation';

const A = 'perfil-a';
const B = 'perfil-b';

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  localStorage.clear();
});

function txInput(overrides: Partial<NewTransaction> = {}): NewTransaction {
  return {
    date: '2026-01-15',
    amountCents: -1000,
    type: 'expense',
    concept: 'Compra',
    notes: null,
    accountId: 'acc-1',
    categoryId: null,
    subcategoryId: null,
    tagIds: [],
    status: 'cleared',
    categorizedBy: 'none',
    ruleId: null,
    transferGroupId: null,
    parentId: null,
    isSplitParent: false,
    refundOfId: null,
    excludedFromStats: false,
    importBatchId: null,
    dedupeHash: 'h',
    rawConcept: 'Compra',
    normalizedConcept: 'compra',
    normalizationVersion: 1,
    merchantId: null,
    merchantMatchSource: 'none',
    merchantMatchConfidence: 0,
    bankTransactionId: null,
    bookingDate: null,
    valueDate: null,
    pending: false,
    currency: 'EUR',
    balanceAfterCents: null,
    bankReference: null,
    operationType: null,
    sourceRowHash: 'row-hash',
    exactFingerprint: 'exact-fp',
    normalizedFingerprint: 'norm-fp',
    fingerprintVersion: 1,
    sourceFileHash: null,
    sourceFileSize: null,
    duplicateStatus: 'unique',
    duplicateConfidence: 0,
    duplicateReasonCodes: [],
    duplicateCandidateIds: [],
    pendingReplacementId: null,
    ...overrides,
  };
}

describe('normalizeCategoryName', () => {
  it('recorta, colapsa y exige contenido y longitud', () => {
    expect(normalizeCategoryName('  Hogar  ')).toBe('Hogar');
    expect(() => normalizeCategoryName('  ')).toThrow(ValidationError);
    expect(() => normalizeCategoryName('x'.repeat(41))).toThrow(ValidationError);
  });
});

describe('createCategory y arbol', () => {
  it('crea raiz y subcategoria (un solo nivel) con sortOrder incremental', async () => {
    const hogar = await categoryService.createCategory(A, { name: 'Hogar', kind: 'expense' });
    const ocio = await categoryService.createCategory(A, { name: 'Ocio', kind: 'expense' });
    expect(hogar.sortOrder).toBe(0);
    expect(ocio.sortOrder).toBe(1);

    const luz = await categoryService.createCategory(A, {
      name: 'Luz',
      kind: 'expense',
      parentId: hogar.id,
    });
    expect(luz.parentId).toBe(hogar.id);

    const tree = await categoryService.listTree(A);
    expect(tree).toHaveLength(2);
    const hogarNode = tree.find((n) => n.category.id === hogar.id);
    expect(hogarNode?.children).toHaveLength(1);
    expect(hogarNode?.children[0]?.name).toBe('Luz');
  });

  it('rechaza subcategoria colgando de otra subcategoria (via repo)', async () => {
    const root = await categoryService.createCategory(A, { name: 'Hogar', kind: 'expense' });
    const sub = await categoryService.createCategory(A, {
      name: 'Luz',
      kind: 'expense',
      parentId: root.id,
    });
    await expect(
      categoryService.createCategory(A, { name: 'Nieta', kind: 'expense', parentId: sub.id }),
    ).rejects.toThrow(ValidationError);
  });
});

describe('getUsage y borrado con integridad', () => {
  it('bloquea el borrado de una categoria con subcategorias', async () => {
    const root = await categoryService.createCategory(A, { name: 'Hogar', kind: 'expense' });
    await categoryService.createCategory(A, { name: 'Luz', kind: 'expense', parentId: root.id });

    const usage = await categoryService.getUsage(A, root.id);
    expect(usage.children).toBe(1);
    await expect(categoryService.deleteCategory(A, root.id)).rejects.toThrow(ValidationError);
  });

  it('bloquea el borrado de una categoria en uso por movimientos (categoryId)', async () => {
    const cat = await categoryService.createCategory(A, { name: 'Ocio', kind: 'expense' });
    await transactionsRepo.create(A, txInput({ categoryId: cat.id }));

    const usage = await categoryService.getUsage(A, cat.id);
    expect(usage.transactions).toBe(1);
    await expect(categoryService.deleteCategory(A, cat.id)).rejects.toThrow(ValidationError);
  });

  it('cuenta el uso de una subcategoria referenciada en subcategoryId', async () => {
    const root = await categoryService.createCategory(A, { name: 'Hogar', kind: 'expense' });
    const sub = await categoryService.createCategory(A, {
      name: 'Luz',
      kind: 'expense',
      parentId: root.id,
    });
    await transactionsRepo.create(A, txInput({ categoryId: root.id, subcategoryId: sub.id }));

    const usage = await categoryService.getUsage(A, sub.id);
    expect(usage.transactions).toBe(1);
    await expect(categoryService.deleteCategory(A, sub.id)).rejects.toThrow(ValidationError);
  });

  it('permite borrar una categoria hoja sin uso', async () => {
    const cat = await categoryService.createCategory(A, { name: 'Temporal', kind: 'expense' });
    await categoryService.deleteCategory(A, cat.id);
    expect(await categoriesRepo.getById(A, cat.id)).toBeUndefined();
  });

  it('archiva y restaura', async () => {
    const cat = await categoryService.createCategory(A, { name: 'Ocio', kind: 'expense' });
    const archived = await categoryService.archiveCategory(A, cat.id);
    expect(archived.archivedAt).not.toBeNull();
    // Por defecto listTree no muestra archivadas.
    expect(await categoryService.listTree(A)).toHaveLength(0);
    expect(await categoryService.listTree(A, { includeArchived: true })).toHaveLength(1);
    const restored = await categoryService.unarchiveCategory(A, cat.id);
    expect(restored.archivedAt).toBeNull();
  });
});

describe('set de categorias por defecto', () => {
  it('seedDefaultCategories crea raices y subcategorias esperadas', async () => {
    await seedDefaultCategories(A);
    const tree = await categoryService.listTree(A);
    expect(tree).toHaveLength(DEFAULT_CATEGORIES.length);

    const expectedChildren = DEFAULT_CATEGORIES.reduce(
      (acc, d) => acc + (d.children?.length ?? 0),
      0,
    );
    const actualChildren = tree.reduce((acc, n) => acc + n.children.length, 0);
    expect(actualChildren).toBe(expectedChildren);
  });

  it('createProfile deja el perfil con las categorias por defecto', async () => {
    const profile = await profileService.createProfile({ name: 'Personal' });
    const tree = await categoryService.listTree(profile.id);
    expect(tree.length).toBe(DEFAULT_CATEGORIES.length);
  });
});

describe('aislamiento por perfil', () => {
  it('las categorias de un perfil no aparecen en el otro', async () => {
    await categoryService.createCategory(A, { name: 'Solo A', kind: 'expense' });
    await categoryService.createCategory(B, { name: 'Solo B', kind: 'income' });

    const treeA = await categoryService.listTree(A);
    const treeB = await categoryService.listTree(B);
    expect(treeA).toHaveLength(1);
    expect(treeB).toHaveLength(1);
    expect(treeA[0]?.category.name).toBe('Solo A');
    expect(treeB[0]?.category.name).toBe('Solo B');
  });

  it('getUsage no cuenta movimientos de otro perfil aunque compartan estructura', async () => {
    // Dos perfiles con la misma estructura de nombres.
    const rootA = await categoryService.createCategory(A, { name: 'Hogar', kind: 'expense' });
    const subA = await categoryService.createCategory(A, {
      name: 'Luz',
      kind: 'expense',
      parentId: rootA.id,
    });
    const rootB = await categoryService.createCategory(B, { name: 'Hogar', kind: 'expense' });
    const subB = await categoryService.createCategory(B, {
      name: 'Luz',
      kind: 'expense',
      parentId: rootB.id,
    });
    // Movimiento solo en B que referencia la subcategoria de B.
    await transactionsRepo.create(B, txInput({ categoryId: rootB.id, subcategoryId: subB.id }));

    // El uso de la subcategoria de A es 0: no ve el movimiento de B.
    const usageA = await categoryService.getUsage(A, subA.id);
    expect(usageA.transactions).toBe(0);
    // Y por tanto la subcategoria de A se puede borrar sin bloqueo.
    await categoryService.deleteCategory(A, subA.id);
    expect(await categoriesRepo.getById(A, subA.id)).toBeUndefined();
    // El uso de la subcategoria de B si es 1.
    expect((await categoryService.getUsage(B, subB.id)).transactions).toBe(1);
  });
});
