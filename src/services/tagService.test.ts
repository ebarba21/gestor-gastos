import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db';
import { tagService, normalizeTagDisplayName } from './tagService';
import { transactionsRepo } from '../db/transactionsRepo';
import type { NewTransaction } from '../db/transactionsRepo';
import { tagsRepo } from '../db/tagsRepo';
import { ValidationError } from '../lib/validation';

const A = 'perfil-a';
const B = 'perfil-b';

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
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

describe('normalizeTagDisplayName', () => {
  it('valida contenido y longitud', () => {
    expect(normalizeTagDisplayName('  Viajes  ')).toBe('Viajes');
    expect(() => normalizeTagDisplayName('')).toThrow(ValidationError);
    expect(() => normalizeTagDisplayName('x'.repeat(31))).toThrow(ValidationError);
  });
});

describe('createTag / unicidad', () => {
  it('rechaza nombres duplicados normalizados en el mismo perfil', async () => {
    await tagService.createTag(A, { name: 'Viajes' });
    await expect(tagService.createTag(A, { name: '  viajes ' })).rejects.toThrow(ValidationError);
    // El mismo nombre en otro perfil si se permite (aislamiento).
    const b = await tagService.createTag(B, { name: 'Viajes' });
    expect(b.name).toBe('Viajes');
  });

  it('updateTag rechaza renombrar a un nombre ya existente', async () => {
    await tagService.createTag(A, { name: 'Viajes' });
    const trabajo = await tagService.createTag(A, { name: 'Trabajo' });
    await expect(tagService.updateTag(A, trabajo.id, { name: 'viajes' })).rejects.toThrow(
      ValidationError,
    );
    // Renombrar al mismo nombre (mismo id) no colisiona consigo mismo.
    const same = await tagService.updateTag(A, trabajo.id, { name: 'Trabajo' });
    expect(same.name).toBe('Trabajo');
  });
});

describe('deleteTag con desvinculacion en cascada', () => {
  it('quita la etiqueta de los movimientos y devuelve cuantos afecto', async () => {
    const viajes = await tagService.createTag(A, { name: 'Viajes' });
    const otra = await tagService.createTag(A, { name: 'Otra' });
    await transactionsRepo.create(A, txInput({ tagIds: [viajes.id, otra.id], dedupeHash: 'h1' }));
    await transactionsRepo.create(A, txInput({ tagIds: [viajes.id], dedupeHash: 'h2' }));
    await transactionsRepo.create(A, txInput({ tagIds: [otra.id], dedupeHash: 'h3' }));

    expect(await tagService.countUsage(A, viajes.id)).toBe(2);

    const detached = await tagService.deleteTag(A, viajes.id);
    expect(detached).toBe(2);
    // La etiqueta ya no existe.
    expect(await tagsRepo.getById(A, viajes.id)).toBeUndefined();
    // Ningun movimiento conserva su id; la otra etiqueta permanece.
    const all = await transactionsRepo.list(A);
    expect(all.every((t) => !t.tagIds.includes(viajes.id))).toBe(true);
    expect(all.filter((t) => t.tagIds.includes(otra.id))).toHaveLength(2);
  });

  it('borrar una etiqueta sin uso devuelve 0', async () => {
    const t = await tagService.createTag(A, { name: 'SinUso' });
    expect(await tagService.deleteTag(A, t.id)).toBe(0);
  });
});

describe('aislamiento por perfil', () => {
  it('deleteTag solo desvincula movimientos del perfil indicado', async () => {
    const tagA = await tagService.createTag(A, { name: 'Comun' });
    const tagB = await tagService.createTag(B, { name: 'Comun' });
    await transactionsRepo.create(A, txInput({ tagIds: [tagA.id], dedupeHash: 'ha' }));
    await transactionsRepo.create(B, txInput({ tagIds: [tagB.id], dedupeHash: 'hb' }));

    await tagService.deleteTag(A, tagA.id);

    // El movimiento de B conserva su etiqueta intacta.
    const bTx = await transactionsRepo.list(B);
    expect(bTx[0]?.tagIds).toEqual([tagB.id]);
    expect(await tagsRepo.getById(B, tagB.id)).toBeDefined();
  });
});
