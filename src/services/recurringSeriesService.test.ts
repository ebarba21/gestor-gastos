import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db/index';
import { accountsRepo } from '../db/accountsRepo';
import { merchantsRepo } from '../db/merchantsRepo';
import { transactionsRepo, type NewTransaction } from '../db/transactionsRepo';
import { recurringSeriesRepo } from '../db/recurringSeriesRepo';
import { recurringOccurrencesRepo } from '../db/recurringOccurrencesRepo';
import { reviewItemsRepo } from '../db/reviewItemsRepo';
import { recurringSeriesService } from './recurringSeriesService';

const PROFILE_A = 'profile-a';
const PROFILE_B = 'profile-b';

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

function txInput(overrides: Partial<NewTransaction> = {}): NewTransaction {
  return {
    date: '2026-01-05',
    amountCents: -1500,
    type: 'expense',
    concept: 'Netflix',
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
    rawConcept: 'Netflix',
    normalizedConcept: 'netflix',
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

async function makeAccount(profileId = PROFILE_A) {
  return accountsRepo.create(profileId, {
    name: 'Cuenta',
    kind: 'bank',
    currency: 'EUR',
    color: null,
    openingBalanceCents: 100_000,
    archivedAt: null,
  });
}

async function makeMerchant(profileId = PROFILE_A) {
  return merchantsRepo.create(profileId, {
    canonicalName: 'Netflix',
    normalizedName: 'netflix',
    defaultCategoryId: null,
    defaultSubcategoryId: null,
    defaultTagIds: [],
    notes: null,
    archivedAt: null,
  });
}

// Crea 3 movimientos mensuales del dia 5, mismo importe, para que el motor detecte una serie.
async function seedMonthlySeries(profileId: string, accountId: string, merchantId: string) {
  for (const date of ['2026-01-05', '2026-02-05', '2026-03-05']) {
    await transactionsRepo.create(profileId, txInput({ accountId, merchantId, date }));
  }
}

describe('recurringSeriesService.runDetection', () => {
  it('crea una serie candidata a partir del historico y no la confirma sola', async () => {
    const account = await makeAccount();
    const merchant = await makeMerchant();
    await seedMonthlySeries(PROFILE_A, account.id, merchant.id);

    const { created } = await recurringSeriesService.runDetection(PROFILE_A);
    expect(created).toBe(1);

    const series = await recurringSeriesRepo.list(PROFILE_A);
    expect(series).toHaveLength(1);
    expect(series[0]!.status).toBe('candidate');
    expect(series[0]!.expectedAmountCents).toBe(1500);
  });

  it('es idempotente: ejecutar la deteccion dos veces no duplica la serie', async () => {
    const account = await makeAccount();
    const merchant = await makeMerchant();
    await seedMonthlySeries(PROFILE_A, account.id, merchant.id);

    await recurringSeriesService.runDetection(PROFILE_A);
    const second = await recurringSeriesService.runDetection(PROFILE_A);
    expect(second.created).toBe(0);
    expect(second.updated).toBe(1);
    const series = await recurringSeriesRepo.list(PROFILE_A);
    expect(series).toHaveLength(1);
  });

  it('aisla la deteccion por perfil', async () => {
    const accountA = await makeAccount(PROFILE_A);
    const merchantA = await makeMerchant(PROFILE_A);
    await seedMonthlySeries(PROFILE_A, accountA.id, merchantA.id);

    await recurringSeriesService.runDetection(PROFILE_A);
    await recurringSeriesService.runDetection(PROFILE_B);

    expect(await recurringSeriesRepo.list(PROFILE_A)).toHaveLength(1);
    expect(await recurringSeriesRepo.list(PROFILE_B)).toHaveLength(0);
  });
});

describe('recurringSeriesService.confirm + syncSeries', () => {
  it('confirmar activa la serie y vincula el proximo cobro real como matched', async () => {
    const account = await makeAccount();
    const merchant = await makeMerchant();
    await seedMonthlySeries(PROFILE_A, account.id, merchant.id);
    await recurringSeriesService.runDetection(PROFILE_A);
    const [candidate] = await recurringSeriesRepo.list(PROFILE_A);

    // Movimiento de abril, el "proximo" tras la deteccion (nextExpectedDate = 2026-04-05).
    await transactionsRepo.create(PROFILE_A, txInput({ accountId: account.id, merchantId: merchant.id, date: '2026-04-06', amountCents: -1500 }));

    await recurringSeriesService.confirm(PROFILE_A, candidate!.id, { today: '2026-04-10' });

    const active = await recurringSeriesRepo.getById(PROFILE_A, candidate!.id);
    expect(active!.status).toBe('active');

    const occurrences = await recurringOccurrencesRepo.listBySeries(PROFILE_A, candidate!.id);
    const april = occurrences.find((o) => o.expectedDate === '2026-04-05');
    expect(april?.status).toBe('matched');
  });

  it('no duplica el conteo: el movimiento vinculado a una ocurrencia no resuelve otra serie', async () => {
    const account = await makeAccount();
    const merchant = await makeMerchant();
    await seedMonthlySeries(PROFILE_A, account.id, merchant.id);
    await recurringSeriesService.runDetection(PROFILE_A);
    const [series] = await recurringSeriesRepo.list(PROFILE_A);
    await recurringSeriesService.confirm(PROFILE_A, series!.id);

    // Re-sincronizar no debe volver a "consumir" los mismos movimientos historicos dos veces.
    await recurringSeriesService.syncSeries(PROFILE_A, series!.id);
    const occurrences = await recurringOccurrencesRepo.listBySeries(PROFILE_A, series!.id);
    const matchedTxIds = occurrences.filter((o) => o.transactionId !== null).map((o) => o.transactionId);
    expect(new Set(matchedTxIds).size).toBe(matchedTxIds.length); // sin duplicados
  });
});

describe('recurringSeriesService - ausencias y posible cancelacion', () => {
  it('marca una ocurrencia como missing y, tras dos ausencias, la serie como possiblyCancelled', async () => {
    const account = await makeAccount();
    const merchant = await makeMerchant();
    await seedMonthlySeries(PROFILE_A, account.id, merchant.id);
    await recurringSeriesService.runDetection(PROFILE_A);
    const [series] = await recurringSeriesRepo.list(PROFILE_A);
    await recurringSeriesService.confirm(PROFILE_A, series!.id);

    // Sin nuevos movimientos: en junio ya deberian faltar abril y mayo (ausencias).
    await recurringSeriesService.syncSeries(PROFILE_A, series!.id, { today: '2026-06-20' });

    const updated = await recurringSeriesRepo.getById(PROFILE_A, series!.id);
    expect(updated!.status).toBe('possiblyCancelled');

    const openReview = await reviewItemsRepo.findOpenByTypeAndEntity(PROFILE_A, 'recurringAnomaly', series!.id);
    expect(openReview).toBeDefined();
    expect(openReview!.reasonCodes).toContain('missingExpected');
    expect(openReview!.reasonCodes).toContain('possiblyCancelled');
  });
});

describe('recurringSeriesService - dividir y fusionar', () => {
  it('splitSeries mueve las ocurrencias futuras a una serie nueva y cancela la original', async () => {
    const account = await makeAccount();
    const merchant = await makeMerchant();
    await seedMonthlySeries(PROFILE_A, account.id, merchant.id);
    await recurringSeriesService.runDetection(PROFILE_A);
    const [series] = await recurringSeriesRepo.list(PROFILE_A);

    const { original, created } = await recurringSeriesService.splitSeries(PROFILE_A, series!.id, '2026-03-05', 'Netflix Premium');
    expect(original.status).toBe('cancelled');
    expect(created.name).toBe('Netflix Premium');

    const originalOccurrences = await recurringOccurrencesRepo.listBySeries(PROFILE_A, series!.id);
    const newOccurrences = await recurringOccurrencesRepo.listBySeries(PROFILE_A, created.id);
    expect(originalOccurrences.every((o) => o.expectedDate < '2026-03-05')).toBe(true);
    expect(newOccurrences.some((o) => o.expectedDate === '2026-03-05')).toBe(true);
  });

  it('mergeSeries traslada las ocurrencias y borra la serie absorbida', async () => {
    const account = await makeAccount();
    const merchant = await makeMerchant();
    await seedMonthlySeries(PROFILE_A, account.id, merchant.id);
    await recurringSeriesService.runDetection(PROFILE_A);
    const [seriesA] = await recurringSeriesRepo.list(PROFILE_A);

    const seriesB = await recurringSeriesRepo.create(PROFILE_A, {
      merchantId: merchant.id,
      accountId: account.id,
      name: 'Netflix (duplicado)',
      direction: 'expense',
      frequency: 'monthly',
      interval: 1,
      expectedAmountCents: 1500,
      amountToleranceCents: 50,
      amountTolerancePpm: 0,
      expectedDayOfWeek: null,
      expectedDayOfMonth: 5,
      dateToleranceDays: 3,
      nextExpectedDate: '2026-04-05',
      status: 'candidate',
      confidence: 500,
      detectionVersion: 1,
    });

    const merged = await recurringSeriesService.mergeSeries(PROFILE_A, seriesA!.id, seriesB.id);
    expect(merged.id).toBe(seriesA!.id);
    expect(await recurringSeriesRepo.getById(PROFILE_A, seriesB.id)).toBeUndefined();
  });
});

describe('recurringSeriesService - omitir y excluir ocurrencias', () => {
  it('skipOccurrence marca la ocurrencia como omitida sin generar ausencia', async () => {
    const account = await makeAccount();
    const merchant = await makeMerchant();
    await seedMonthlySeries(PROFILE_A, account.id, merchant.id);
    await recurringSeriesService.runDetection(PROFILE_A);
    const [series] = await recurringSeriesRepo.list(PROFILE_A);
    await recurringSeriesService.confirm(PROFILE_A, series!.id);
    const [occurrence] = await recurringOccurrencesRepo.listBySeries(PROFILE_A, series!.id);

    const skipped = await recurringSeriesService.skipOccurrence(PROFILE_A, occurrence!.id);
    expect(skipped.status).toBe('skipped');
  });
});

describe('recurringSeriesService - validaciones (createManual/edit)', () => {
  const validInput = {
    name: 'Gimnasio',
    merchantId: null,
    accountId: null,
    direction: 'expense' as const,
    frequency: 'monthly' as const,
    interval: 1,
    expectedAmountCents: 3000,
    amountToleranceCents: 100,
    amountTolerancePpm: 0,
    expectedDayOfWeek: null,
    expectedDayOfMonth: 1,
    dateToleranceDays: 3,
    nextExpectedDate: '2026-05-01',
  };

  it('rechaza interval menor que 1', async () => {
    await expect(
      recurringSeriesService.createManual(PROFILE_A, { ...validInput, interval: 0 }),
    ).rejects.toThrow(/intervalo/);
  });

  it('rechaza amountToleranceCents negativo', async () => {
    await expect(
      recurringSeriesService.createManual(PROFILE_A, { ...validInput, amountToleranceCents: -1 }),
    ).rejects.toThrow(/amountToleranceCents/);
  });

  it('rechaza expectedDayOfWeek fuera de 0..6', async () => {
    await expect(
      recurringSeriesService.createManual(PROFILE_A, { ...validInput, expectedDayOfWeek: 7 }),
    ).rejects.toThrow(/expectedDayOfWeek/);
  });

  it('rechaza expectedDayOfMonth fuera de 1..31', async () => {
    await expect(
      recurringSeriesService.createManual(PROFILE_A, { ...validInput, expectedDayOfMonth: 32 }),
    ).rejects.toThrow(/expectedDayOfMonth/);
  });

  it('rechaza un nombre vacio al editar', async () => {
    const created = await recurringSeriesService.createManual(PROFILE_A, validInput);
    await expect(recurringSeriesService.edit(PROFILE_A, created.id, { name: '  ' })).rejects.toThrow(/nombre/);
  });

  it('acepta una entrada valida', async () => {
    const created = await recurringSeriesService.createManual(PROFILE_A, validInput);
    expect(created.status).toBe('active');
    expect(created.expectedAmountCents).toBe(3000);
  });
});
