import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db';
import { accountService, normalizeAccountName } from './accountService';
import { accountsRepo } from '../db/accountsRepo';
import { transactionsRepo } from '../db/transactionsRepo';
import type { NewTransaction } from '../db/transactionsRepo';
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

describe('normalizeAccountName', () => {
  it('recorta, colapsa y valida contenido y longitud', () => {
    expect(normalizeAccountName('  Banco   Principal ')).toBe('Banco Principal');
    expect(() => normalizeAccountName('   ')).toThrow(ValidationError);
    expect(() => normalizeAccountName('x'.repeat(41))).toThrow(ValidationError);
  });
});

describe('createAccount', () => {
  it('crea con valores por defecto (EUR) y guarda centimos enteros', async () => {
    const acc = await accountService.createAccount(A, {
      name: '  Banco Principal ',
      kind: 'bank',
      openingBalanceCents: 10000,
    });
    expect(acc.name).toBe('Banco Principal');
    expect(acc.currency).toBe('EUR');
    expect(acc.openingBalanceCents).toBe(10000);
    expect(acc.archivedAt).toBeNull();
  });

  it('rechaza nombre vacio y saldo no entero', async () => {
    await expect(
      accountService.createAccount(A, { name: '  ', kind: 'cash', openingBalanceCents: 0 }),
    ).rejects.toThrow(ValidationError);
    await expect(
      accountService.createAccount(A, { name: 'X', kind: 'cash', openingBalanceCents: 100.5 }),
    ).rejects.toThrow(ValidationError);
  });
});

describe('borrado con integridad', () => {
  it('bloquea el borrado de una cuenta con movimientos', async () => {
    const acc = await accountService.createAccount(A, {
      name: 'Banco',
      kind: 'bank',
      openingBalanceCents: 0,
    });
    await transactionsRepo.create(A, txInput({ accountId: acc.id }));

    expect(await accountService.countUsage(A, acc.id)).toBe(1);
    await expect(accountService.deleteAccount(A, acc.id)).rejects.toThrow(ValidationError);
    // Sigue existiendo (no se borro).
    expect(await accountsRepo.getById(A, acc.id)).toBeDefined();
  });

  it('permite borrar una cuenta sin movimientos', async () => {
    const acc = await accountService.createAccount(A, {
      name: 'Temporal',
      kind: 'cash',
      openingBalanceCents: 0,
    });
    await accountService.deleteAccount(A, acc.id);
    expect(await accountsRepo.getById(A, acc.id)).toBeUndefined();
  });

  it('archiva y restaura como alternativa al borrado', async () => {
    const acc = await accountService.createAccount(A, {
      name: 'Banco',
      kind: 'bank',
      openingBalanceCents: 0,
    });
    const archived = await accountService.archiveAccount(A, acc.id);
    expect(archived.archivedAt).not.toBeNull();
    const restored = await accountService.unarchiveAccount(A, acc.id);
    expect(restored.archivedAt).toBeNull();
  });
});

describe('listSorted', () => {
  it('ordena activas antes que archivadas y alfabeticamente', async () => {
    const a = await accountService.createAccount(A, {
      name: 'Zeta',
      kind: 'bank',
      openingBalanceCents: 0,
    });
    await accountService.createAccount(A, { name: 'Alfa', kind: 'cash', openingBalanceCents: 0 });
    await accountService.archiveAccount(A, a.id);

    const sorted = await accountService.listSorted(A);
    expect(sorted.map((x) => x.name)).toEqual(['Alfa', 'Zeta']);
    expect(sorted[1]?.archivedAt).not.toBeNull();
  });
});

describe('aislamiento por perfil', () => {
  it('las cuentas de un perfil no aparecen en el otro', async () => {
    await accountService.createAccount(A, { name: 'A', kind: 'bank', openingBalanceCents: 0 });
    await accountService.createAccount(B, { name: 'B', kind: 'bank', openingBalanceCents: 0 });
    expect(await accountService.listAll(A)).toHaveLength(1);
    expect(await accountService.listAll(B)).toHaveLength(1);
    expect((await accountService.listAll(A))[0]?.name).toBe('A');
  });
});
