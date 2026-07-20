import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db/index';
import { transactionsRepo, type NewTransaction } from '../db/transactionsRepo';
import { reviewItemsRepo } from '../db/reviewItemsRepo';
import { rulesRepo } from '../db/rulesRepo';
import { reviewService } from './reviewService';

const PROFILE_A = 'profile-a';
const PROFILE_B = 'profile-b';

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
    dedupeHash: 'hash-1',
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

describe('reviewService.generateFromImportBatch: idempotencia', () => {
  it('no crea dos tareas abiertas para el mismo (type, entityId) al llamarse dos veces', async () => {
    const tx = await transactionsRepo.create(PROFILE_A, txInput({ categoryId: null }));
    await reviewService.generateFromImportBatch(PROFILE_A, 'batch-1', [tx]);
    await reviewService.generateFromImportBatch(PROFILE_A, 'batch-1', [tx]);
    const open = await reviewItemsRepo.listOpen(PROFILE_A);
    expect(open.filter((r) => r.type === 'uncategorized' && r.entityId === tx.id)).toHaveLength(1);
  });

  it('genera una tarea "uncategorized" para un movimiento sin categoria', async () => {
    const tx = await transactionsRepo.create(PROFILE_A, txInput({ categoryId: null }));
    await reviewService.generateFromImportBatch(PROFILE_A, 'batch-1', [tx]);
    const open = await reviewItemsRepo.listOpen(PROFILE_A);
    expect(open.some((r) => r.type === 'uncategorized' && r.entityId === tx.id)).toBe(true);
  });

  it('NO genera "uncategorized" si el movimiento ya tiene categoria', async () => {
    const tx = await transactionsRepo.create(PROFILE_A, txInput({ categoryId: 'cat-1' }));
    await reviewService.generateFromImportBatch(PROFILE_A, 'batch-1', [tx]);
    const open = await reviewItemsRepo.listOpen(PROFILE_A);
    expect(open.some((r) => r.type === 'uncategorized')).toBe(false);
  });

  it('genera "possibleDuplicate" a partir de duplicateStatus ya calculado', async () => {
    const tx = await transactionsRepo.create(
      PROFILE_A,
      txInput({
        duplicateStatus: 'possible',
        duplicateConfidence: 500,
        duplicateReasonCodes: ['sameAccountAmountCurrency'],
        duplicateCandidateIds: ['other-tx'],
      }),
    );
    await reviewService.generateFromImportBatch(PROFILE_A, 'batch-1', [tx]);
    const open = await reviewItemsRepo.listOpen(PROFILE_A);
    const item = open.find((r) => r.type === 'possibleDuplicate');
    expect(item).toBeDefined();
    expect(item?.confidence).toBe(500);
    expect(item?.metadata).toEqual({ candidateIds: ['other-tx'] });
  });

  it('agrupa movimientos sin comercio por concepto normalizado en UNA tarea "newMerchant"', async () => {
    const tx1 = await transactionsRepo.create(
      PROFILE_A,
      txInput({ normalizedConcept: 'amazon', merchantId: null }),
    );
    const tx2 = await transactionsRepo.create(
      PROFILE_A,
      txInput({ normalizedConcept: 'amazon', merchantId: null }),
    );
    await reviewService.generateFromImportBatch(PROFILE_A, 'batch-1', [tx1, tx2]);
    const open = await reviewItemsRepo.listOpen(PROFILE_A);
    const merchantTasks = open.filter((r) => r.type === 'newMerchant');
    expect(merchantTasks).toHaveLength(1);
    expect(merchantTasks[0].metadata.sampleTransactionIds).toHaveLength(1);
  });

  it('agrega todos los errores de fila en UNA tarea "importError" por lote', async () => {
    await reviewService.generateFromImportBatch(PROFILE_A, 'batch-1', [], [
      { row: 1, field: 'fila', value: 'x', reason: 'Fecha invalida.' },
      { row: 2, field: 'fila', value: 'y', reason: 'Importe invalido.' },
    ]);
    const open = await reviewItemsRepo.listOpen(PROFILE_A);
    const errorTasks = open.filter((r) => r.type === 'importError');
    expect(errorTasks).toHaveLength(1);
    expect(errorTasks[0].entityId).toBe('batch-1');
    expect(errorTasks[0].metadata.errors).toHaveLength(2);
  });
});

describe('reviewService: aislamiento por perfil', () => {
  it('las tareas de un perfil no aparecen en otro', async () => {
    const txA = await transactionsRepo.create(PROFILE_A, txInput());
    const txB = await transactionsRepo.create(PROFILE_B, txInput());
    await reviewService.generateFromImportBatch(PROFILE_A, 'batch-a', [txA]);
    await reviewService.generateFromImportBatch(PROFILE_B, 'batch-b', [txB]);
    const openA = await reviewItemsRepo.listOpen(PROFILE_A);
    const openB = await reviewItemsRepo.listOpen(PROFILE_B);
    expect(openA.every((r) => r.entityId !== txB.id)).toBe(true);
    expect(openB.every((r) => r.entityId !== txA.id)).toBe(true);
  });
});

describe('reviewService: acciones (resolver, reabrir, deshacer, masivas)', () => {
  async function makeOpenItem() {
    const tx = await transactionsRepo.create(PROFILE_A, txInput({ categoryId: null }));
    await reviewService.generateFromImportBatch(PROFILE_A, 'batch-1', [tx]);
    const item = await reviewItemsRepo.findOpenByTypeAndEntity(PROFILE_A, 'uncategorized', tx.id);
    if (!item) throw new Error('tarea no generada');
    return item;
  }

  it('resolve() marca la tarea como resuelta con resolucion y fecha', async () => {
    const item = await makeOpenItem();
    const resolved = await reviewService.resolve(PROFILE_A, item.id, 'categorized');
    expect(resolved.status).toBe('resolved');
    expect(resolved.resolution).toBe('categorized');
    expect(resolved.resolvedAt).not.toBeNull();
  });

  it('dismiss() marca la tarea como descartada', async () => {
    const item = await makeOpenItem();
    const dismissed = await reviewService.dismiss(PROFILE_A, item.id, 'no aplica');
    expect(dismissed.status).toBe('dismissed');
    expect(dismissed.resolution).toBe('no aplica');
  });

  it('reopen()/undo() revierte una tarea resuelta a abierta, sin resolucion', async () => {
    const item = await makeOpenItem();
    await reviewService.resolve(PROFILE_A, item.id, 'categorized');
    const reopened = await reviewService.undo(PROFILE_A, item.id);
    expect(reopened.status).toBe('open');
    expect(reopened.resolution).toBeNull();
    expect(reopened.resolvedAt).toBeNull();
  });

  it('bulkResolve() resuelve varias tareas en una sola operacion', async () => {
    const tx1 = await transactionsRepo.create(PROFILE_A, txInput({ categoryId: null }));
    const tx2 = await transactionsRepo.create(
      PROFILE_A,
      txInput({ accountId: 'acc-2', categoryId: null }),
    );
    await reviewService.generateFromImportBatch(PROFILE_A, 'batch-1', [tx1, tx2]);
    const open = await reviewItemsRepo.listOpen(PROFILE_A);
    const ids = open.map((r) => r.id);
    const resolved = await reviewService.bulkResolve(PROFILE_A, ids, 'categorized');
    expect(resolved).toHaveLength(ids.length);
    expect(resolved.every((r) => r.status === 'resolved')).toBe(true);
    const stillOpen = await reviewItemsRepo.listOpen(PROFILE_A);
    expect(stillOpen).toHaveLength(0);
  });

  it('la regeneracion NO reabre una tarea ya resuelta si nada relevante cambio', async () => {
    const tx = await transactionsRepo.create(
      PROFILE_A,
      txInput({ duplicateStatus: 'possible', duplicateConfidence: 500, duplicateReasonCodes: [] }),
    );
    await reviewService.generateFromImportBatch(PROFILE_A, 'batch-1', [tx]);
    const item = await reviewItemsRepo.findOpenByTypeAndEntity(PROFILE_A, 'possibleDuplicate', tx.id);
    await reviewService.dismiss(PROFILE_A, item!.id, 'no es un duplicado');
    // Se vuelve a generar (p. ej. una nueva pasada de escaneo) con los MISMOS datos.
    await reviewService.generatePossibleDuplicates(PROFILE_A);
    const stillOpen = await reviewItemsRepo.findOpenByTypeAndEntity(PROFILE_A, 'possibleDuplicate', tx.id);
    expect(stillOpen).toBeUndefined();
  });
});

describe('reviewService: transferencia candidata', () => {
  it('detecta un par sin vincular y crea UNA sola tarea para la pareja', async () => {
    const out = await transactionsRepo.create(
      PROFILE_A,
      txInput({ accountId: 'acc-1', amountCents: -5000, date: '2026-01-15', type: 'expense' }),
    );
    const inTx = await transactionsRepo.create(
      PROFILE_A,
      txInput({ accountId: 'acc-2', amountCents: 5000, date: '2026-01-15', type: 'income' }),
    );
    await reviewService.generateTransferCandidates(PROFILE_A);
    const open = await reviewItemsRepo.listOpen(PROFILE_A);
    const transferTasks = open.filter((r) => r.type === 'transferCandidate');
    expect(transferTasks).toHaveLength(1);
    expect([out.id, inTx.id]).toContain(transferTasks[0].entityId);
  });

  it('no genera tarea si ya estan vinculados a un grupo de transferencia', async () => {
    await transactionsRepo.create(
      PROFILE_A,
      txInput({
        accountId: 'acc-1',
        amountCents: -5000,
        type: 'transfer',
        transferGroupId: 'grp-1',
      }),
    );
    await transactionsRepo.create(
      PROFILE_A,
      txInput({
        accountId: 'acc-2',
        amountCents: 5000,
        type: 'transfer',
        transferGroupId: 'grp-1',
      }),
    );
    await reviewService.generateTransferCandidates(PROFILE_A);
    const open = await reviewItemsRepo.listOpen(PROFILE_A);
    expect(open.filter((r) => r.type === 'transferCandidate')).toHaveLength(0);
  });
});

describe('reviewService: reembolso candidato', () => {
  it('detecta un ingreso posterior con mismo comercio y crea una tarea', async () => {
    await transactionsRepo.create(
      PROFILE_A,
      txInput({
        amountCents: -10000,
        date: '2026-01-01',
        merchantId: 'merch-1',
        normalizedConcept: 'zara',
      }),
    );
    const refund = await transactionsRepo.create(
      PROFILE_A,
      txInput({
        amountCents: 4000,
        type: 'income',
        date: '2026-01-10',
        merchantId: 'merch-1',
        normalizedConcept: 'zara',
      }),
    );
    await reviewService.generateRefundCandidates(PROFILE_A);
    const open = await reviewItemsRepo.listOpen(PROFILE_A);
    const refundTasks = open.filter((r) => r.type === 'refundCandidate');
    expect(refundTasks).toHaveLength(1);
    expect(refundTasks[0].entityId).toBe(refund.id);
  });
});

describe('reviewService: pendiente antiguo', () => {
  it('marca como pendiente antiguo un movimiento pending con fecha mas alla del umbral', async () => {
    const oldDate = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const tx = await transactionsRepo.create(PROFILE_A, txInput({ pending: true, date: oldDate }));
    await reviewService.generateStalePending(PROFILE_A);
    const item = await reviewItemsRepo.findOpenByTypeAndEntity(PROFILE_A, 'stalePending', tx.id);
    expect(item).toBeDefined();
  });

  it('no marca un pendiente reciente', async () => {
    const recentDate = new Date().toISOString().slice(0, 10);
    const tx = await transactionsRepo.create(PROFILE_A, txInput({ pending: true, date: recentDate }));
    await reviewService.generateStalePending(PROFILE_A);
    const item = await reviewItemsRepo.findOpenByTypeAndEntity(PROFILE_A, 'stalePending', tx.id);
    expect(item).toBeUndefined();
  });
});

describe('reviewService: regla de baja confianza', () => {
  it('genera lowConfidenceRule cuando la regla que categorizo tiene poca senal', async () => {
    const rule = await rulesRepo.create(PROFILE_A, {
      name: 'Regla debil',
      enabled: true,
      priority: 0,
      matchMode: 'any',
      conditions: [
        { field: 'concept', operator: 'contains', value: 'a', value2: null, caseSensitive: false },
        { field: 'concept', operator: 'contains', value: 'b', value2: null, caseSensitive: false },
        { field: 'concept', operator: 'contains', value: 'c', value2: null, caseSensitive: false },
      ],
      action: { setCategoryId: 'cat-1', setSubcategoryId: null, addTagIds: [], setExcludedFromStats: null },
      stopOnMatch: false,
    });
    const tx = await transactionsRepo.create(
      PROFILE_A,
      txInput({ concept: 'a', categoryId: 'cat-1', categorizedBy: 'rule', ruleId: rule.id }),
    );
    await reviewService.generateFromRuleMatches(PROFILE_A, [tx], [rule]);
    const item = await reviewItemsRepo.findOpenByTypeAndEntity(PROFILE_A, 'lowConfidenceRule', tx.id);
    expect(item).toBeDefined();
    expect(item?.confidence).toBeLessThan(400);
  });

  it('no genera tarea cuando la regla tiene senal fuerte', async () => {
    const rule = await rulesRepo.create(PROFILE_A, {
      name: 'Regla fuerte',
      enabled: true,
      priority: 0,
      matchMode: 'all',
      conditions: [
        { field: 'account', operator: 'equals', value: 'acc-1', value2: null, caseSensitive: false },
        { field: 'amount', operator: 'eq', value: -1000, value2: null, caseSensitive: false },
      ],
      action: { setCategoryId: 'cat-1', setSubcategoryId: null, addTagIds: [], setExcludedFromStats: null },
      stopOnMatch: false,
    });
    const tx = await transactionsRepo.create(
      PROFILE_A,
      txInput({ categoryId: 'cat-1', categorizedBy: 'rule', ruleId: rule.id }),
    );
    await reviewService.generateFromRuleMatches(PROFILE_A, [tx], [rule]);
    const item = await reviewItemsRepo.findOpenByTypeAndEntity(PROFILE_A, 'lowConfidenceRule', tx.id);
    expect(item).toBeUndefined();
  });
});

describe('reviewService: offline y sincronizacion', () => {
  it('en modo local (sin cuenta) no encola ninguna mutacion en la outbox', async () => {
    const tx = await transactionsRepo.create(PROFILE_A, txInput({ categoryId: null }));
    await reviewService.generateFromImportBatch(PROFILE_A, 'batch-1', [tx]);
    const outboxCount = await db.outbox.count();
    expect(outboxCount).toBe(0);
    const item = await reviewItemsRepo.findOpenByTypeAndEntity(PROFILE_A, 'uncategorized', tx.id);
    expect(item?.syncStatus).toBe('local');
  });

  it('con un perfil vinculado a una cuenta, crear una tarea encola una mutacion insert', async () => {
    // Perfil vinculado a una cuenta: se crea directamente con ownerUserId para no depender del
    // flujo completo de autenticacion en este test.
    await db.profiles.add({
      id: PROFILE_A,
      ownerUserId: 'user-1',
      name: 'Perfil A',
      color: '#000',
      avatarEmoji: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      archivedAt: null,
      deletedAt: null,
      revision: 0,
      syncStatus: 'synced',
      lastSyncedAt: Date.now(),
    });
    const tx = await transactionsRepo.create(PROFILE_A, txInput({ categoryId: null }));
    await reviewService.generateFromImportBatch(PROFILE_A, 'batch-1', [tx]);
    const mutations = await db.outbox.where('entityType').equals('reviewItem').toArray();
    expect(mutations.length).toBeGreaterThan(0);
    expect(mutations[0].operation).toBe('insert');
    const item = await reviewItemsRepo.findOpenByTypeAndEntity(PROFILE_A, 'uncategorized', tx.id);
    expect(item?.syncStatus).toBe('pending');
  });
});
