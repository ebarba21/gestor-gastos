import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db/index';
import { accountsRepo } from '../db/accountsRepo';
import { transactionsRepo, type NewTransaction } from '../db/transactionsRepo';
import { reconciliationsRepo } from '../db/reconciliationsRepo';
import { reconciliationService } from './reconciliationService';

const PROFILE_A = 'profile-a';

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

async function makeAccount(openingBalanceCents = 0) {
  return accountsRepo.create(PROFILE_A, {
    name: 'Cuenta',
    kind: 'bank',
    currency: 'EUR',
    color: null,
    openingBalanceCents,
    archivedAt: null,
  });
}

describe('reconciliationService.computeBalance', () => {
  it('suma opening balance + movimientos confirmados con date <= statementDate', async () => {
    const account = await makeAccount(10000);
    await transactionsRepo.create(
      PROFILE_A,
      txInput({ accountId: account.id, amountCents: -2000, date: '2026-01-10' }),
    );
    await transactionsRepo.create(
      PROFILE_A,
      txInput({ accountId: account.id, amountCents: -500, date: '2026-01-20' }), // fuera de rango
    );
    const { computedBalanceCents } = await reconciliationService.computeBalance(
      PROFILE_A,
      account.id,
      '2026-01-15',
    );
    expect(computedBalanceCents).toBe(10000 - 2000);
  });

  it('el limite de fecha es INCLUSIVO', async () => {
    const account = await makeAccount(0);
    await transactionsRepo.create(
      PROFILE_A,
      txInput({ accountId: account.id, amountCents: -1000, date: '2026-01-15' }),
    );
    const { computedBalanceCents } = await reconciliationService.computeBalance(
      PROFILE_A,
      account.id,
      '2026-01-15',
    );
    expect(computedBalanceCents).toBe(-1000);
  });

  it('el saldo INCLUYE transferencias y movimientos excludedFromStats (a diferencia de las stats)', async () => {
    const account = await makeAccount(0);
    await transactionsRepo.create(
      PROFILE_A,
      txInput({
        accountId: account.id,
        amountCents: -3000,
        type: 'transfer',
        transferGroupId: 'grp-1',
        excludedFromStats: true,
        date: '2026-01-10',
      }),
    );
    const { computedBalanceCents } = await reconciliationService.computeBalance(
      PROFILE_A,
      account.id,
      '2026-01-15',
    );
    // La transferencia SI cuenta en el saldo, aunque nunca contaria en las estadisticas.
    expect(computedBalanceCents).toBe(-3000);
  });

  it('cuenta el cargo de un split una sola vez (padre), no padre + hijas', async () => {
    const account = await makeAccount(0);
    // Padre del split: conserva el importe completo del cargo, excluido de stats.
    const parent = await transactionsRepo.create(
      PROFILE_A,
      txInput({
        accountId: account.id,
        amountCents: -10000,
        isSplitParent: true,
        excludedFromStats: true,
        date: '2026-01-10',
      }),
    );
    // Lineas hijas en la MISMA cuenta cuya suma es el importe del padre.
    await transactionsRepo.create(
      PROFILE_A,
      txInput({ accountId: account.id, amountCents: -6000, parentId: parent.id, date: '2026-01-10' }),
    );
    await transactionsRepo.create(
      PROFILE_A,
      txInput({ accountId: account.id, amountCents: -4000, parentId: parent.id, date: '2026-01-10' }),
    );
    const { computedBalanceCents } = await reconciliationService.computeBalance(
      PROFILE_A,
      account.id,
      '2026-01-15',
    );
    // El cargo real es -10000 (el del padre), no -20000 (padre + hijas).
    expect(computedBalanceCents).toBe(-10000);
  });

  it('excluye por defecto los movimientos pending, y los lista aparte', async () => {
    const account = await makeAccount(0);
    const pendingTx = await transactionsRepo.create(
      PROFILE_A,
      txInput({ accountId: account.id, amountCents: -1000, pending: true, date: '2026-01-10' }),
    );
    const { computedBalanceCents, excludedPendingIds } = await reconciliationService.computeBalance(
      PROFILE_A,
      account.id,
      '2026-01-15',
    );
    expect(computedBalanceCents).toBe(0);
    expect(excludedPendingIds).toContain(pendingTx.id);
  });

  it('permite incluir explicitamente un pendiente concreto', async () => {
    const account = await makeAccount(0);
    const pendingTx = await transactionsRepo.create(
      PROFILE_A,
      txInput({ accountId: account.id, amountCents: -1000, pending: true, date: '2026-01-10' }),
    );
    const { computedBalanceCents, excludedPendingIds } = await reconciliationService.computeBalance(
      PROFILE_A,
      account.id,
      '2026-01-15',
      [pendingTx.id],
    );
    expect(computedBalanceCents).toBe(-1000);
    expect(excludedPendingIds).toHaveLength(0);
  });
});

describe('reconciliationService.reconcile', () => {
  it('caso que cuadra: differenceCents = 0, status balanced', async () => {
    const account = await makeAccount(5000);
    const { reconciliation } = await reconciliationService.reconcile(PROFILE_A, {
      accountId: account.id,
      statementDate: '2026-01-15',
      statementBalanceCents: 5000,
    });
    expect(reconciliation.differenceCents).toBe(0);
    expect(reconciliation.status).toBe('balanced');
  });

  it('caso con diferencia: status discrepancy, differenceCents = extracto - calculado', async () => {
    const account = await makeAccount(5000);
    const { reconciliation } = await reconciliationService.reconcile(PROFILE_A, {
      accountId: account.id,
      statementDate: '2026-01-15',
      statementBalanceCents: 5200,
    });
    expect(reconciliation.differenceCents).toBe(200);
    expect(reconciliation.status).toBe('discrepancy');
  });

  it('acceptWithDifference deja constancia sin ocultar la diferencia', async () => {
    const account = await makeAccount(5000);
    const { reconciliation } = await reconciliationService.reconcile(PROFILE_A, {
      accountId: account.id,
      statementDate: '2026-01-15',
      statementBalanceCents: 5200,
      acceptWithDifference: true,
    });
    expect(reconciliation.status).toBe('acceptedWithDifference');
    expect(reconciliation.differenceCents).toBe(200);
  });

  it('nunca fuerza balanced cuando hay diferencia, aunque se pida aceptar', async () => {
    const account = await makeAccount(0);
    const { reconciliation } = await reconciliationService.reconcile(PROFILE_A, {
      accountId: account.id,
      statementDate: '2026-01-15',
      statementBalanceCents: 100,
      acceptWithDifference: true,
    });
    expect(reconciliation.status).not.toBe('balanced');
  });

  it('guarda historial consultable por cuenta', async () => {
    const account = await makeAccount(0);
    await reconciliationService.reconcile(PROFILE_A, {
      accountId: account.id,
      statementDate: '2026-01-15',
      statementBalanceCents: 0,
    });
    await reconciliationService.reconcile(PROFILE_A, {
      accountId: account.id,
      statementDate: '2026-02-15',
      statementBalanceCents: 0,
    });
    const history = await reconciliationService.history(PROFILE_A, account.id);
    expect(history).toHaveLength(2);
  });

  it('no altera el saldo ni las estadisticas dos veces (idempotencia de la lectura)', async () => {
    const account = await makeAccount(1000);
    await transactionsRepo.create(
      PROFILE_A,
      txInput({ accountId: account.id, amountCents: -300, date: '2026-01-10' }),
    );
    const first = await reconciliationService.computeBalance(PROFILE_A, account.id, '2026-01-15');
    const second = await reconciliationService.computeBalance(PROFILE_A, account.id, '2026-01-15');
    expect(first.computedBalanceCents).toBe(second.computedBalanceCents);
    // Repetir la conciliacion no muta ningun movimiento existente.
    await reconciliationService.reconcile(PROFILE_A, {
      accountId: account.id,
      statementDate: '2026-01-15',
      statementBalanceCents: 700,
    });
    await reconciliationService.reconcile(PROFILE_A, {
      accountId: account.id,
      statementDate: '2026-01-15',
      statementBalanceCents: 700,
    });
    const all = await reconciliationsRepo.listByAccount(PROFILE_A, account.id);
    expect(all).toHaveLength(2); // dos conciliaciones distintas guardadas, ninguna fusionada en silencio
    expect(all.every((r) => r.differenceCents === 0)).toBe(true);
  });
});

describe('reconciliationService: aislamiento por perfil', () => {
  it('no calcula saldo de una cuenta de otro perfil', async () => {
    const account = await makeAccount(1000);
    await expect(
      reconciliationService.computeBalance('otro-perfil', account.id, '2026-01-15'),
    ).rejects.toThrow();
  });
});
