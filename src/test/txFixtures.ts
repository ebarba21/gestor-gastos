// Factorias puras (sin base de datos) para los tests de patrimonio e insights.
import type { Account, Category, Transaction } from '../db/schema';

export function makeTx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    profileId: 'perfil-a',
    date: '2026-07-10',
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
    statsFlag: 0,
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
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

export function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    profileId: 'perfil-a',
    name: 'Cuenta',
    kind: 'bank',
    currency: 'EUR',
    color: null,
    openingBalanceCents: 0,
    archivedAt: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

export function makeCategory(overrides: Partial<Category> & { id: string; name: string }): Category {
  return {
    profileId: 'perfil-a',
    parentId: null,
    kind: 'expense',
    color: null,
    icon: null,
    archivedAt: null,
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}
