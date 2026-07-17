import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db/index';
import { accountsRepo } from '../db/accountsRepo';
import { transactionsRepo, type NewTransaction } from '../db/transactionsRepo';
import { debtsRepo } from '../db/debtsRepo';
import { debtsService, type CreateDebtInput } from './debtsService';
import { ValidationError } from '../lib/validation';

const PROFILE_A = 'profile-a';
const PROFILE_B = 'profile-b';

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

function debtInput(overrides: Partial<CreateDebtInput> = {}): CreateDebtInput {
  return {
    name: 'Prestamo coche',
    type: 'personalLoan',
    currency: 'EUR',
    originalPrincipalCents: 1_000_000,
    outstandingPrincipalCents: 1_000_000,
    annualRatePpm: 50000,
    minimumPaymentCents: 85607,
    paymentFrequency: 'monthly',
    nextPaymentDate: '2026-02-01',
    remainingTermMonths: 12,
    linkedAccountId: null,
    linkedCategoryId: null,
    status: 'active',
    ...overrides,
  };
}

function txInput(overrides: Partial<NewTransaction> = {}): NewTransaction {
  return {
    date: '2026-02-01',
    amountCents: -85607,
    type: 'expense',
    concept: 'Cuota prestamo',
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
    dedupeHash: `hash-${Math.random()}`,
    rawConcept: 'Cuota prestamo',
    normalizedConcept: 'cuota prestamo',
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
    sourceRowHash: `row-${Math.random()}`,
    exactFingerprint: `exact-${Math.random()}`,
    normalizedFingerprint: `norm-${Math.random()}`,
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

describe('debtsService.createDebt / updateDebt: validacion', () => {
  it('crea una deuda valida', async () => {
    const debt = await debtsService.createDebt(PROFILE_A, debtInput());
    expect(debt.profileId).toBe(PROFILE_A);
    expect(debt.outstandingPrincipalCents).toBe(1_000_000);
  });

  it('rechaza un tipo invalido', async () => {
    await expect(
      debtsService.createDebt(PROFILE_A, debtInput({ type: 'mortgage' as never })),
    ).rejects.toThrow(ValidationError);
  });

  it('rechaza un nombre vacio', async () => {
    await expect(debtsService.createDebt(PROFILE_A, debtInput({ name: '' }))).rejects.toThrow(ValidationError);
  });

  it('rechaza importes negativos', async () => {
    await expect(
      debtsService.createDebt(PROFILE_A, debtInput({ outstandingPrincipalCents: -100 })),
    ).rejects.toThrow(ValidationError);
  });
});

describe('debtsService.getSchedule: usa la cuota registrada, no la recalcula', () => {
  it('genera el calendario fijo del fixture (P=1.000.000, 5%, 12 meses)', async () => {
    const debt = await debtsService.createDebt(PROFILE_A, debtInput());
    const schedule = await debtsService.getSchedule(PROFILE_A, debt.id);
    expect(schedule.degenerate).toBeNull();
    expect(schedule.installmentCents).toBe(85607);
    expect(schedule.totalInterestCents).toBe(27289);
    expect(schedule.rows).toHaveLength(12);
  });

  it('tarjeta (card) no genera calendario en esta fase', async () => {
    const debt = await debtsService.createDebt(PROFILE_A, debtInput({ type: 'card' }));
    await expect(debtsService.getSchedule(PROFILE_A, debt.id)).rejects.toThrow(ValidationError);
  });

  it('sin plazo restante no genera calendario', async () => {
    const debt = await debtsService.createDebt(PROFILE_A, debtInput({ remainingTermMonths: null }));
    await expect(debtsService.getSchedule(PROFILE_A, debt.id)).rejects.toThrow(ValidationError);
  });
});

describe('debtsService.recordPayment: reduce el pasivo, evita doble conteo', () => {
  it('reduce outstandingPrincipalCents y avanza nextPaymentDate/remainingTermMonths', async () => {
    const debt = await debtsService.createDebt(PROFILE_A, debtInput());
    const payment = await debtsService.recordPayment(PROFILE_A, debt.id, {
      date: '2026-02-01',
      totalCents: 85607,
      principalCents: 81440,
      interestCents: 4167,
      feesCents: 0,
      extraPrincipalCents: 0,
      transactionId: null,
    });
    expect(payment.totalCents).toBe(85607);

    const updated = await debtsRepo.getById(PROFILE_A, debt.id);
    expect(updated?.outstandingPrincipalCents).toBe(1_000_000 - 81440);
    expect(updated?.remainingTermMonths).toBe(11);
    expect(updated?.nextPaymentDate).toBe('2026-03-01');
    expect(updated?.status).toBe('active');
  });

  it('rechaza un pago que no cuadra (total != principal+interes+comisiones)', async () => {
    const debt = await debtsService.createDebt(PROFILE_A, debtInput());
    await expect(
      debtsService.recordPayment(PROFILE_A, debt.id, {
        date: '2026-02-01',
        totalCents: 85607,
        principalCents: 81440,
        interestCents: 4166, // no cuadra con 85607
        feesCents: 0,
        extraPrincipalCents: 0,
        transactionId: null,
      }),
    ).rejects.toThrow(ValidationError);
  });

  it('marca la deuda paidOff cuando el saldo llega a 0', async () => {
    const debt = await debtsService.createDebt(PROFILE_A, debtInput({ outstandingPrincipalCents: 50000 }));
    await debtsService.recordPayment(PROFILE_A, debt.id, {
      date: '2026-02-01',
      totalCents: 50000,
      principalCents: 50000,
      interestCents: 0,
      feesCents: 0,
      extraPrincipalCents: 0,
      transactionId: null,
    });
    const updated = await debtsRepo.getById(PROFILE_A, debt.id);
    expect(updated?.status).toBe('paidOff');
    expect(updated?.outstandingPrincipalCents).toBe(0);
  });

  it('no permite vincular el mismo movimiento a dos pagos (evita doble conteo)', async () => {
    const account = await accountsRepo.create(PROFILE_A, {
      name: 'Cuenta',
      kind: 'bank',
      currency: 'EUR',
      color: null,
      openingBalanceCents: 0,
      archivedAt: null,
    });
    const tx = await transactionsRepo.create(PROFILE_A, txInput({ accountId: account.id }));
    const debt = await debtsService.createDebt(PROFILE_A, debtInput());
    await debtsService.recordPayment(PROFILE_A, debt.id, {
      date: '2026-02-01',
      totalCents: 85607,
      principalCents: 81440,
      interestCents: 4167,
      feesCents: 0,
      extraPrincipalCents: 0,
      transactionId: tx.id,
    });
    await expect(
      debtsService.recordPayment(PROFILE_A, debt.id, {
        date: '2026-03-01',
        totalCents: 85607,
        principalCents: 81780,
        interestCents: 3827,
        feesCents: 0,
        extraPrincipalCents: 0,
        transactionId: tx.id,
      }),
    ).rejects.toThrow(ValidationError);
  });
});

describe('debtsService.recordPayment: al vincular un movimiento, el principal deja de contar como gasto (DATA_MODEL 19.2)', () => {
  async function makeAccountAndTx(amountCents: number) {
    const account = await accountsRepo.create(PROFILE_A, {
      name: 'Cuenta',
      kind: 'bank',
      currency: 'EUR',
      color: null,
      openingBalanceCents: 0,
      archivedAt: null,
    });
    const tx = await transactionsRepo.create(PROFILE_A, txInput({ accountId: account.id, amountCents }));
    return { account, tx };
  }

  it('principal > 0 e interes > 0: divide el movimiento (principal excluido, interes cuenta)', async () => {
    const { tx } = await makeAccountAndTx(-85607);
    const debt = await debtsService.createDebt(PROFILE_A, debtInput());
    await debtsService.recordPayment(PROFILE_A, debt.id, {
      date: '2026-02-01',
      totalCents: 85607,
      principalCents: 81440,
      interestCents: 4167,
      feesCents: 0,
      extraPrincipalCents: 0,
      transactionId: tx.id,
    });
    const parent = await transactionsRepo.getById(PROFILE_A, tx.id);
    expect(parent?.isSplitParent).toBe(true);
    expect(parent?.excludedFromStats).toBe(true);
    const children = await transactionsRepo.listChildren(PROFILE_A, tx.id);
    expect(children).toHaveLength(2);
    const principalLine = children.find((c) => c.amountCents === -81440)!;
    const interestLine = children.find((c) => c.amountCents === -4167)!;
    expect(principalLine.excludedFromStats).toBe(true);
    expect(interestLine.excludedFromStats).toBe(false);
    // Cuadre: la suma de las hijas sigue siendo el importe original del movimiento.
    expect(principalLine.amountCents + interestLine.amountCents).toBe(-85607);
  });

  it('principal = 0 (pago solo de intereses): el movimiento no se toca, sigue contando entero', async () => {
    const { tx } = await makeAccountAndTx(-4167);
    const debt = await debtsService.createDebt(PROFILE_A, debtInput({ outstandingPrincipalCents: 0 }));
    await debtsService.recordPayment(PROFILE_A, debt.id, {
      date: '2026-02-01',
      totalCents: 4167,
      principalCents: 0,
      interestCents: 4167,
      feesCents: 0,
      extraPrincipalCents: 0,
      transactionId: tx.id,
    });
    const after = await transactionsRepo.getById(PROFILE_A, tx.id);
    expect(after?.isSplitParent).toBe(false);
    expect(after?.excludedFromStats).toBe(false);
  });

  it('interes+comisiones = 0 (deuda a tipo 0 sin comisiones): el movimiento se excluye entero', async () => {
    const { tx } = await makeAccountAndTx(-10000);
    const debt = await debtsService.createDebt(PROFILE_A, debtInput({ annualRatePpm: 0, minimumPaymentCents: 10000 }));
    await debtsService.recordPayment(PROFILE_A, debt.id, {
      date: '2026-02-01',
      totalCents: 10000,
      principalCents: 10000,
      interestCents: 0,
      feesCents: 0,
      extraPrincipalCents: 0,
      transactionId: tx.id,
    });
    const after = await transactionsRepo.getById(PROFILE_A, tx.id);
    expect(after?.isSplitParent).toBe(false);
    expect(after?.excludedFromStats).toBe(true);
  });

  it('rechaza el vinculo si el importe del movimiento no coincide con el total del pago', async () => {
    const { tx } = await makeAccountAndTx(-90000); // no coincide con 85607
    const debt = await debtsService.createDebt(PROFILE_A, debtInput());
    await expect(
      debtsService.recordPayment(PROFILE_A, debt.id, {
        date: '2026-02-01',
        totalCents: 85607,
        principalCents: 81440,
        interestCents: 4167,
        feesCents: 0,
        extraPrincipalCents: 0,
        transactionId: tx.id,
      }),
    ).rejects.toThrow(ValidationError);
    // No debe quedar un pago huerfano si el vinculo se rechaza.
    const after = await transactionsRepo.getById(PROFILE_A, tx.id);
    expect(after?.isSplitParent).toBe(false);
  });

  it('desvincular revierte el split: el movimiento vuelve a contar entero', async () => {
    const { tx } = await makeAccountAndTx(-85607);
    const debt = await debtsService.createDebt(PROFILE_A, debtInput());
    const payment = await debtsService.recordPayment(PROFILE_A, debt.id, {
      date: '2026-02-01',
      totalCents: 85607,
      principalCents: 81440,
      interestCents: 4167,
      feesCents: 0,
      extraPrincipalCents: 0,
      transactionId: tx.id,
    });
    await debtsService.unlinkPaymentTransaction(PROFILE_A, payment.id);
    const after = await transactionsRepo.getById(PROFILE_A, tx.id);
    expect(after?.isSplitParent).toBe(false);
    expect(after?.excludedFromStats).toBe(false);
    expect(after?.amountCents).toBe(-85607);
  });
});

describe('debtsService.proposePaymentCandidates: nunca vincula, solo sugiere', () => {
  it('propone un movimiento de la cuenta vinculada cercano en importe y fecha', async () => {
    const account = await accountsRepo.create(PROFILE_A, {
      name: 'Cuenta',
      kind: 'bank',
      currency: 'EUR',
      color: null,
      openingBalanceCents: 0,
      archivedAt: null,
    });
    const tx = await transactionsRepo.create(PROFILE_A, txInput({ accountId: account.id, date: '2026-02-01', amountCents: -85607 }));
    const debt = await debtsService.createDebt(
      PROFILE_A,
      debtInput({ linkedAccountId: account.id, nextPaymentDate: '2026-02-02' }),
    );
    const candidates = await debtsService.proposePaymentCandidates(PROFILE_A, debt.id);
    expect(candidates.map((c) => c.transactionId)).toContain(tx.id);
  });

  it('excluye movimientos ya vinculados a un pago existente', async () => {
    const account = await accountsRepo.create(PROFILE_A, {
      name: 'Cuenta',
      kind: 'bank',
      currency: 'EUR',
      color: null,
      openingBalanceCents: 0,
      archivedAt: null,
    });
    const tx = await transactionsRepo.create(PROFILE_A, txInput({ accountId: account.id, date: '2026-02-01', amountCents: -85607 }));
    const debt = await debtsService.createDebt(
      PROFILE_A,
      debtInput({ linkedAccountId: account.id, nextPaymentDate: '2026-02-01' }),
    );
    await debtsService.recordPayment(PROFILE_A, debt.id, {
      date: '2026-02-01',
      totalCents: 85607,
      principalCents: 81440,
      interestCents: 4167,
      feesCents: 0,
      extraPrincipalCents: 0,
      transactionId: tx.id,
    });
    const candidates = await debtsService.proposePaymentCandidates(PROFILE_A, debt.id);
    expect(candidates.map((c) => c.transactionId)).not.toContain(tx.id);
  });
});

describe('debtsService.compareDebtStrategies: excluye tarjetas, respeta aislamiento', () => {
  it('excluye deudas type=card del comparador', async () => {
    const loan = await debtsService.createDebt(PROFILE_A, debtInput());
    const card = await debtsService.createDebt(
      PROFILE_A,
      debtInput({ name: 'Tarjeta', type: 'card', outstandingPrincipalCents: 200000, remainingTermMonths: null }),
    );
    const result = await debtsService.compareDebtStrategies(PROFILE_A, { recurringExtraCents: 10000 });
    expect(result.excludedCardDebtIds).toEqual([card.id]);
    expect(Object.keys(result.debtNames)).toEqual([loan.id]);
  });

  it('no mezcla deudas de perfiles distintos', async () => {
    await debtsService.createDebt(PROFILE_A, debtInput({ name: 'Deuda A' }));
    await debtsService.createDebt(PROFILE_B, debtInput({ name: 'Deuda B' }));
    const resultA = await debtsService.compareDebtStrategies(PROFILE_A, { recurringExtraCents: 0 });
    expect(Object.values(resultA.debtNames)).toEqual(['Deuda A']);
  });

  it('el desempate Snowball respeta el orden de creacion, no el orden de iteracion del repositorio', async () => {
    // Dos deudas con saldo identico (empate de Snowball): la creada PRIMERO debe ganar el
    // desempate (FINANCIAL_ALGORITHMS 9, "menor id/orden de creacion"), sin importar en que
    // orden las devuelva Dexie.
    const first = await debtsService.createDebt(
      PROFILE_A,
      debtInput({ name: 'Primera', outstandingPrincipalCents: 100000, annualRatePpm: 0, minimumPaymentCents: 10000, remainingTermMonths: 10 }),
    );
    const second = await debtsService.createDebt(
      PROFILE_A,
      debtInput({ name: 'Segunda', outstandingPrincipalCents: 100000, annualRatePpm: 0, minimumPaymentCents: 10000, remainingTermMonths: 10 }),
    );
    const result = await debtsService.compareDebtStrategies(PROFILE_A, { recurringExtraCents: 50000 });
    const snowball = result.results.find((r) => r.strategy === 'snowball')!;
    const firstPayoff = snowball.payoffOrder.find((p) => p.debtId === first.id)!.payoffMonth;
    const secondPayoff = snowball.payoffOrder.find((p) => p.debtId === second.id)!.payoffMonth;
    expect(firstPayoff).toBeLessThanOrEqual(secondPayoff);
  });
});

describe('debtsService: escenarios (nunca modifican datos reales)', () => {
  it('crear, duplicar y borrar un escenario no modifica las deudas reales', async () => {
    const debt = await debtsService.createDebt(PROFILE_A, debtInput());
    const scenario = await debtsService.createScenario(PROFILE_A, {
      name: 'Snowball',
      strategy: 'snowball',
      recurringExtraCents: 20000,
      oneTimeExtraPayments: [],
    });
    const duplicated = await debtsService.duplicateScenario(PROFILE_A, scenario.id, 'Snowball (copia)');
    expect(duplicated.id).not.toBe(scenario.id);
    expect(duplicated.recurringExtraCents).toBe(20000);

    const untouchedDebt = await debtsRepo.getById(PROFILE_A, debt.id);
    expect(untouchedDebt?.outstandingPrincipalCents).toBe(1_000_000);

    await debtsService.deleteScenario(PROFILE_A, scenario.id);
    const afterDelete = await debtsService.compareDebtStrategies(PROFILE_A, { recurringExtraCents: 0 });
    expect(afterDelete).toBeDefined(); // el borrado del escenario no rompe el comparador
  });

  it('un escenario se marca desactualizado cuando cambia una deuda incluida', async () => {
    const debt = await debtsService.createDebt(PROFILE_A, debtInput());
    const scenario = await debtsService.createScenario(PROFILE_A, {
      name: 'Avalanche',
      strategy: 'avalanche',
      recurringExtraCents: 10000,
      oneTimeExtraPayments: [],
    });
    expect(await debtsService.isScenarioStale(PROFILE_A, scenario)).toBe(false);

    await debtsService.recordPayment(PROFILE_A, debt.id, {
      date: '2026-02-01',
      totalCents: 85607,
      principalCents: 81440,
      interestCents: 4167,
      feesCents: 0,
      extraPrincipalCents: 0,
      transactionId: null,
    });

    expect(await debtsService.isScenarioStale(PROFILE_A, scenario)).toBe(true);
    const refreshed = await debtsService.refreshScenario(PROFILE_A, scenario.id);
    expect(await debtsService.isScenarioStale(PROFILE_A, refreshed)).toBe(false);
  });
});

describe('debtsService.getSummary: agregado por perfil', () => {
  it('calcula saldo total, cuota total y tipo ponderado solo de deudas activas', async () => {
    await debtsService.createDebt(PROFILE_A, debtInput({ outstandingPrincipalCents: 500000, annualRatePpm: 40000, minimumPaymentCents: 40000 }));
    await debtsService.createDebt(PROFILE_A, debtInput({ outstandingPrincipalCents: 500000, annualRatePpm: 80000, minimumPaymentCents: 40000 }));
    await debtsService.createDebt(PROFILE_A, debtInput({ status: 'archived' }));
    const summary = await debtsService.getSummary(PROFILE_A);
    expect(summary.activeCount).toBe(2);
    expect(summary.totalOutstandingCents).toBe(1_000_000);
    expect(summary.totalMinimumPaymentCents).toBe(80000);
    expect(summary.weightedAverageRatePpm).toBe(60000); // media ponderada por saldo, saldos iguales -> media simple
  });
});
