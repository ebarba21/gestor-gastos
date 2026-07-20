import { describe, it, expect, beforeEach } from 'vitest';
import { computeForecastRange, forecastService } from './forecastService';
import type { Category, RecurringOccurrence, RecurringSeries, Transaction } from '../db/schema';
import { db } from '../db/index';
import { accountsRepo } from '../db/accountsRepo';
import { merchantsRepo } from '../db/merchantsRepo';
import { transactionsRepo, type NewTransaction } from '../db/transactionsRepo';
import { recurringSeriesService } from './recurringSeriesService';
import { recurringSeriesRepo } from '../db/recurringSeriesRepo';

const CATEGORIES: Category[] = [
  { id: 'cat-food', profileId: 'p', name: 'Comida', parentId: null, kind: 'expense', color: null, icon: null, archivedAt: null, sortOrder: 0, createdAt: 0, updatedAt: 0 },
  { id: 'cat-ahorro', profileId: 'p', name: 'Ahorros', parentId: null, kind: 'expense', color: null, icon: null, archivedAt: null, sortOrder: 1, createdAt: 0, updatedAt: 0 },
];

let seq = 0;
function tx(overrides: Partial<Transaction> = {}): Transaction {
  seq++;
  return {
    id: `tx-${seq}`,
    profileId: 'p',
    date: '2026-05-10',
    amountCents: -1000,
    type: 'expense',
    concept: 'Compra',
    notes: null,
    accountId: 'acc-1',
    categoryId: 'cat-food',
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
    dedupeHash: `h-${seq}`,
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
    sourceRowHash: `r-${seq}`,
    exactFingerprint: `e-${seq}`,
    normalizedFingerprint: `n-${seq}`,
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

function series(overrides: Partial<RecurringSeries> = {}): RecurringSeries {
  return {
    id: 'series-1',
    profileId: 'p',
    merchantId: null,
    accountId: 'acc-1',
    name: 'Netflix',
    direction: 'expense',
    frequency: 'monthly',
    interval: 1,
    expectedAmountCents: 1500,
    amountToleranceCents: 100,
    amountTolerancePpm: 0,
    expectedDayOfWeek: null,
    expectedDayOfMonth: 5,
    dateToleranceDays: 3,
    nextExpectedDate: '2026-06-05',
    status: 'active',
    confidence: 900,
    detectionVersion: 1,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function occurrence(overrides: Partial<RecurringOccurrence> = {}): RecurringOccurrence {
  return {
    id: `occ-${Math.random()}`,
    profileId: 'p',
    seriesId: 'series-1',
    transactionId: null,
    expectedDate: '2026-06-05',
    expectedAmountCents: 1500,
    status: 'expected',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe('computeForecastRange - gasto realizado y componentes separados', () => {
  it('con el rango totalmente en el pasado, todo es gasto realizado y no hay pendiente/variable', () => {
    const txs = [tx({ date: '2026-05-05', amountCents: -2000 }), tx({ date: '2026-05-20', amountCents: -3000 })];
    const result = computeForecastRange({
      allTransactions: txs,
      categories: CATEGORIES,
      recurringSeries: [],
      recurringOccurrences: [],
      range: { from: '2026-05-01', to: '2026-05-31' },
      today: '2026-06-15',
    });
    expect(result.central.realizedCents).toBe(5000);
    expect(result.central.recurringPendingCents).toBe(0);
    expect(result.central.variableRemainingCents).toBe(0);
    expect(result.remainingDays).toBe(0);
    expect(result.centralTotalCents).toBe(5000);
  });

  it('no cuenta dos veces un cobro recurrente ya cobrado (esta en realizado, no en pendiente)', () => {
    const matchedTx = tx({ id: 'tx-netflix', date: '2026-06-05', amountCents: -1500 });
    const result = computeForecastRange({
      allTransactions: [matchedTx],
      categories: CATEGORIES,
      recurringSeries: [series()],
      recurringOccurrences: [
        occurrence({ status: 'matched', transactionId: 'tx-netflix', expectedDate: '2026-06-05' }),
      ],
      range: { from: '2026-06-01', to: '2026-06-30' },
      today: '2026-06-20',
    });
    expect(result.central.realizedCents).toBe(1500);
    expect(result.central.recurringPendingCents).toBe(0); // ya cobrada: no aparece como pendiente
  });

  it('suma una ocurrencia pendiente (expected) dentro del rango como recurrente pendiente', () => {
    const result = computeForecastRange({
      allTransactions: [],
      categories: CATEGORIES,
      recurringSeries: [series()],
      recurringOccurrences: [occurrence({ status: 'expected', expectedDate: '2026-06-05' })],
      range: { from: '2026-06-01', to: '2026-06-30' },
      today: '2026-06-01',
    });
    expect(result.central.recurringPendingCents).toBe(1500);
    expect(result.pendingCharges).toHaveLength(1);
    expect(result.lowerTotalCents).toBeLessThanOrEqual(result.centralTotalCents);
    expect(result.upperTotalCents).toBeGreaterThanOrEqual(result.centralTotalCents);
  });

  it('excluye series pausadas/canceladas/posiblemente-canceladas y de ingreso del componente de recurrentes pendientes', () => {
    const result = computeForecastRange({
      allTransactions: [],
      categories: CATEGORIES,
      recurringSeries: [
        series({ id: 's-paused', status: 'paused' }),
        series({ id: 's-income', direction: 'income' }),
        series({ id: 's-possibly-cancelled', status: 'possiblyCancelled' }),
      ],
      recurringOccurrences: [
        occurrence({ seriesId: 's-paused' }),
        occurrence({ seriesId: 's-income' }),
        occurrence({ seriesId: 's-possibly-cancelled' }),
      ],
      range: { from: '2026-06-01', to: '2026-06-30' },
      today: '2026-06-01',
    });
    expect(result.central.recurringPendingCents).toBe(0);
  });

  it('un cobro recurrente adelantado (fecha real fuera del rango) no se pierde ni se duplica: se explica', () => {
    // El recibo se carga el 29 de mayo (3 dias antes) pero la ocurrencia esperada es el 1 de
    // junio (dateToleranceDays cubre el desfase). El importe SI cuenta como gasto realizado de
    // MAYO (misma fecha real que statsService usaria); en el forecast de JUNIO no debe sumarse
    // otra vez (evita doble conteo) pero tampoco debe desaparecer sin explicacion.
    const rentTx = tx({ id: 'rent-may', date: '2026-05-29', amountCents: -90000 });
    const rentSeries = series({ id: 's-rent', expectedAmountCents: 90000, expectedDayOfMonth: 1 });
    const matchedOccurrence = occurrence({
      seriesId: 's-rent',
      status: 'matched',
      transactionId: 'rent-may',
      expectedDate: '2026-06-01',
      expectedAmountCents: 90000,
    });

    const june = computeForecastRange({
      allTransactions: [rentTx],
      categories: CATEGORIES,
      recurringSeries: [rentSeries],
      recurringOccurrences: [matchedOccurrence],
      range: { from: '2026-06-01', to: '2026-06-30' },
      today: '2026-06-15',
    });
    // No se duplica: no aparece en recurrentes pendientes de junio (ya esta matched).
    expect(june.central.recurringPendingCents).toBe(0);
    // No se pierde en silencio: aparece explicada en settledOutsideRange y en la metodologia.
    expect(june.settledOutsideRange).toHaveLength(1);
    expect(june.settledOutsideRange[0]).toMatchObject({ expectedAmountCents: 90000, expectedDate: '2026-06-01' });
    expect(june.methodology.some((m) => m.includes('fecha real fuera de el'))).toBe(true);

    const may = computeForecastRange({
      allTransactions: [rentTx],
      categories: CATEGORIES,
      recurringSeries: [rentSeries],
      recurringOccurrences: [matchedOccurrence],
      range: { from: '2026-05-01', to: '2026-05-31' },
      today: '2026-06-15',
    });
    // El importe cuenta UNA vez: en el gasto realizado de mayo (su fecha real).
    expect(may.central.realizedCents).toBe(90000);
    expect(may.settledOutsideRange).toHaveLength(0);
  });
});

describe('computeForecastRange - exclusiones (transferencias, splits, reembolsos)', () => {
  it('excluye transferencias del gasto realizado', () => {
    const result = computeForecastRange({
      allTransactions: [
        tx({ date: '2026-06-05', amountCents: -500, type: 'transfer', excludedFromStats: true, statsFlag: 1 }),
        tx({ date: '2026-06-06', amountCents: -1000 }),
      ],
      categories: CATEGORIES,
      recurringSeries: [],
      recurringOccurrences: [],
      range: { from: '2026-06-01', to: '2026-06-30' },
      today: '2026-06-10',
    });
    expect(result.central.realizedCents).toBe(1000);
  });

  it('excluye el padre de un split y cuenta las lineas hijas', () => {
    const parent = tx({ id: 'p1', date: '2026-06-05', amountCents: -3000, isSplitParent: true, excludedFromStats: true, statsFlag: 1 });
    const child1 = tx({ id: 'c1', date: '2026-06-05', amountCents: -1000, parentId: 'p1' });
    const child2 = tx({ id: 'c2', date: '2026-06-05', amountCents: -2000, parentId: 'p1' });
    const result = computeForecastRange({
      allTransactions: [parent, child1, child2],
      categories: CATEGORIES,
      recurringSeries: [],
      recurringOccurrences: [],
      range: { from: '2026-06-01', to: '2026-06-30' },
      today: '2026-06-10',
    });
    expect(result.central.realizedCents).toBe(3000); // solo las hijas, sin duplicar con el padre
  });

  it('un reembolso reduce el gasto realizado, no se suma como componente aparte ni como ingreso', () => {
    const original = tx({ id: 'g1', date: '2026-06-02', amountCents: -5000 });
    const refund = tx({ id: 'r1', date: '2026-06-10', amountCents: 2000, type: 'income', refundOfId: 'g1' });
    const result = computeForecastRange({
      allTransactions: [original, refund],
      categories: CATEGORIES,
      recurringSeries: [],
      recurringOccurrences: [],
      range: { from: '2026-06-01', to: '2026-06-30' },
      today: '2026-06-15',
    });
    expect(result.central.realizedCents).toBe(3000); // 5000 - 2000, no 5000+2000 ni 5000 solo
  });

  it('excluye aportaciones a categorias de ahorro del gasto realizado', () => {
    const result = computeForecastRange({
      allTransactions: [tx({ date: '2026-06-05', amountCents: -10000, categoryId: 'cat-ahorro' })],
      categories: CATEGORIES,
      recurringSeries: [],
      recurringOccurrences: [],
      range: { from: '2026-06-01', to: '2026-06-30' },
      today: '2026-06-10',
    });
    expect(result.central.realizedCents).toBe(0);
  });
});

describe('computeForecastRange - gasto variable: historico, outlier y poco historico', () => {
  it('con poco historico (sin meses completos previos) explica en vez de inventar precision', () => {
    const result = computeForecastRange({
      allTransactions: [],
      categories: CATEGORIES,
      recurringSeries: [],
      recurringOccurrences: [],
      range: { from: '2026-06-01', to: '2026-06-30' },
      today: '2026-06-01',
      historyMonths: 3,
    });
    expect(result.insufficientHistory).toBe(true);
    expect(result.central.variableRemainingCents).toBe(0);
    expect(result.methodology.some((m) => m.toLowerCase().includes('sin historico'))).toBe(true);
  });

  it('usa el historico de meses previos completos para estimar el gasto variable restante', () => {
    // 3 meses previos con ~1000 cents/dia de gasto variable cada uno.
    const historyTx: Transaction[] = [];
    for (const month of ['2026-03', '2026-04', '2026-05']) {
      historyTx.push(tx({ date: `${month}-10`, amountCents: -15000 })); // ~500/dia en meses de 30 dias approx
    }
    const result = computeForecastRange({
      allTransactions: historyTx,
      categories: CATEGORIES,
      recurringSeries: [],
      recurringOccurrences: [],
      range: { from: '2026-06-01', to: '2026-06-30' },
      today: '2026-06-01',
      historyMonths: 3,
    });
    expect(result.insufficientHistory).toBe(false);
    expect(result.historyMonthsUsed).toBe(3);
    expect(result.central.variableRemainingCents).toBeGreaterThan(0);
  });

  it('un mes outlier no arrastra la estimacion de gasto variable de forma desmedida', () => {
    const historyTx: Transaction[] = [
      tx({ date: '2026-03-10', amountCents: -10000 }),
      tx({ date: '2026-04-10', amountCents: -10000 }),
      tx({ date: '2026-05-10', amountCents: -500000 }), // outlier (compra excepcional)
    ];
    const result = computeForecastRange({
      allTransactions: historyTx,
      categories: CATEGORIES,
      recurringSeries: [],
      recurringOccurrences: [],
      range: { from: '2026-06-01', to: '2026-06-30' },
      today: '2026-06-01',
      historyMonths: 3,
    });
    // Sin reduccion de outliers, el mes de mayo (500000/30 ~ 16666/dia) dispararia la
    // estimacion muy por encima de los otros dos meses (~333/dia); con reduccion, se acerca a
    // los meses normales.
    const dailyEstimate = result.central.variableRemainingCents / result.remainingDays;
    expect(dailyEstimate).toBeLessThan(5000);
  });

  it('excluye los movimientos ya vinculados a una recurrencia del calculo de gasto variable', () => {
    const recurringTx = tx({ id: 'rec-1', date: '2026-05-05', amountCents: -1500 });
    const result = computeForecastRange({
      allTransactions: [recurringTx],
      categories: CATEGORIES,
      recurringSeries: [series({ nextExpectedDate: '2026-07-05' })],
      recurringOccurrences: [
        occurrence({ status: 'matched', transactionId: 'rec-1', expectedDate: '2026-05-05' }),
      ],
      range: { from: '2026-06-01', to: '2026-06-30' },
      today: '2026-06-01',
      historyMonths: 3,
    });
    // El unico movimiento de mayo esta vinculado a la recurrencia: no debe contarse como
    // variable, asi que la estimacion variable queda a 0 (no hay gasto variable historico).
    expect(result.central.variableRemainingCents).toBe(0);
  });
});

describe('computeForecastRange - principio y fin de mes, meses distintos', () => {
  it('calcula correctamente un rango que empieza a fin de mes y termina a principio del siguiente', () => {
    const result = computeForecastRange({
      allTransactions: [tx({ date: '2026-01-31', amountCents: -1000 }), tx({ date: '2026-02-02', amountCents: -500 })],
      categories: CATEGORIES,
      recurringSeries: [],
      recurringOccurrences: [],
      range: { from: '2026-01-31', to: '2026-02-02' },
      today: '2026-02-05',
    });
    expect(result.totalDaysInRange).toBe(3);
    expect(result.central.realizedCents).toBe(1500);
  });

  it('funciona igual para un rango en un mes distinto al mes de deteccion original', () => {
    const result = computeForecastRange({
      allTransactions: [tx({ date: '2026-12-15', amountCents: -1000 })],
      categories: CATEGORIES,
      recurringSeries: [],
      recurringOccurrences: [],
      range: { from: '2026-12-01', to: '2026-12-31' },
      today: '2026-12-20',
    });
    expect(result.central.realizedCents).toBe(1000);
  });
});

describe('forecastService.computeForRange - orquestador (Dexie, sincronizacion, aislamiento)', () => {
  const PROFILE_A = 'profile-forecast-a';
  const PROFILE_B = 'profile-forecast-b';

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

  it('sincroniza las series activas y calcula el forecast del perfil, aislado de otros perfiles', async () => {
    const account = await accountsRepo.create(PROFILE_A, {
      name: 'Cuenta',
      kind: 'bank',
      currency: 'EUR',
      color: null,
      openingBalanceCents: 0,
      archivedAt: null,
    });
    const merchant = await merchantsRepo.create(PROFILE_A, {
      canonicalName: 'Netflix',
      normalizedName: 'netflix',
      defaultCategoryId: null,
      defaultSubcategoryId: null,
      defaultTagIds: [],
      notes: null,
      archivedAt: null,
    });
    for (const date of ['2026-01-05', '2026-02-05', '2026-03-05']) {
      await transactionsRepo.create(PROFILE_A, txInput({ accountId: account.id, merchantId: merchant.id, date }));
    }
    await recurringSeriesService.runDetection(PROFILE_A);
    const [series] = await recurringSeriesRepo.list(PROFILE_A);
    await recurringSeriesService.confirm(PROFILE_A, series!.id, { today: '2026-03-10' });

    const result = await forecastService.computeForRange(
      PROFILE_A,
      { from: '2026-04-01', to: '2026-04-30' },
      { today: '2026-04-01' },
    );
    // La serie confirmada genera un placeholder 'expected' para abril dentro del rango.
    expect(result.central.recurringPendingCents).toBe(1500);

    const resultB = await forecastService.computeForRange(
      PROFILE_B,
      { from: '2026-04-01', to: '2026-04-30' },
      { today: '2026-04-01' },
    );
    expect(resultB.central.recurringPendingCents).toBe(0);
    expect(resultB.central.realizedCents).toBe(0);
  });
});
