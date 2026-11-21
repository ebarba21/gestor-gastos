// Planificacion: disponible seguro, prevision de saldo, KPIs y plan flexible. Funciones puras.
import { describe, it, expect } from 'vitest';
import type { Budget, RecurringOccurrence, RecurringSeries } from '../db/schema';
import { makeAccount, makeCategory, makeTx } from '../test/txFixtures';
import { computeBalanceForecast, computePlanning, resolveNextIncome, type PlanningInput } from './planningService';
import { DEFAULT_PLANNING_SETTINGS } from './planningSettings';

const TODAY = '2026-11-20';

const categories = [
  makeCategory({ id: 'nomina', name: 'Nomina', kind: 'income' }),
  makeCategory({ id: 'vivienda', name: 'Vivienda' }),
  makeCategory({ id: 'super', name: 'Supermercado' }),
  makeCategory({ id: 'subs', name: 'Suscripciones' }),
  makeCategory({ id: 'ahorro', name: 'Ahorro' }),
  makeCategory({ id: 'seguros', name: 'Seguros' }),
  makeCategory({ id: 'restaurantes', name: 'Restaurantes' }),
];

function series(overrides: Partial<RecurringSeries> & { id: string; name: string }): RecurringSeries {
  return {
    profileId: 'perfil-a',
    merchantId: null,
    accountId: 'acc-1',
    direction: 'expense',
    frequency: 'monthly',
    interval: 1,
    expectedAmountCents: 0,
    amountToleranceCents: 0,
    amountTolerancePpm: 0,
    expectedDayOfWeek: null,
    expectedDayOfMonth: 1,
    dateToleranceDays: 3,
    nextExpectedDate: null,
    status: 'active',
    confidence: 900,
    detectionVersion: 1,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function occ(seriesId: string, expectedDate: string, amount: number, status: RecurringOccurrence['status'] = 'expected', transactionId: string | null = null): RecurringOccurrence {
  return {
    id: `${seriesId}-${expectedDate}`,
    profileId: 'perfil-a',
    seriesId,
    transactionId,
    expectedDate,
    expectedAmountCents: amount,
    status,
    createdAt: 0,
    updatedAt: 0,
  };
}

// Historico: nomina de 2.000 EUR el 25, alquiler de 700 EUR el 1 (recurrencia), 600 EUR de
// supermercado y 100 EUR a ahorro cada mes, de mayo a octubre; en noviembre ya han pasado el
// alquiler y 200 EUR de supermercado.
function baseInput(): PlanningInput {
  const txs = [];
  const occurrences: RecurringOccurrence[] = [];
  const months = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
  for (const m of months) {
    txs.push(makeTx({ id: `nom-${m}`, date: `${m}-25`, amountCents: 200000, type: 'income', categoryId: 'nomina' }));
    txs.push(makeTx({ id: `alq-${m}`, date: `${m}-01`, amountCents: -70000, categoryId: 'vivienda' }));
    txs.push(makeTx({ date: `${m}-10`, amountCents: -60000, categoryId: 'super' }));
    txs.push(makeTx({ date: `${m}-26`, amountCents: -10000, categoryId: 'ahorro' }));
    occurrences.push(occ('alquiler', `${m}-01`, -70000, 'matched', `alq-${m}`));
    occurrences.push(occ('nomina', `${m}-25`, 200000, 'matched', `nom-${m}`));
  }
  txs.push(makeTx({ id: 'alq-2026-11', date: '2026-11-01', amountCents: -70000, categoryId: 'vivienda' }));
  occurrences.push(occ('alquiler', '2026-11-01', -70000, 'matched', 'alq-2026-11'));
  txs.push(makeTx({ date: '2026-11-15', amountCents: -20000, categoryId: 'super' }));
  // Futuro
  occurrences.push(occ('netflix', '2026-11-22', -1799));
  occurrences.push(occ('nomina', '2026-11-25', 200000));
  occurrences.push(occ('alquiler', '2026-12-01', -70000));
  occurrences.push(occ('netflix', '2026-12-22', -1799));
  occurrences.push(occ('nomina', '2026-12-25', 200000));
  occurrences.push(occ('alquiler', '2027-01-01', -70000));
  return {
    transactions: txs,
    categories,
    accounts: [makeAccount({ id: 'acc-1', openingBalanceCents: 50000 })],
    series: [
      series({ id: 'alquiler', name: 'Alquiler', expectedAmountCents: 70000 }),
      series({ id: 'netflix', name: 'Netflix', expectedAmountCents: 1799, amountToleranceCents: 200, expectedDayOfMonth: 22 }),
      series({ id: 'nomina', name: 'Nomina', direction: 'income', expectedAmountCents: 200000, expectedDayOfMonth: 25 }),
    ],
    occurrences,
    budgets: [],
    planning: { ...DEFAULT_PLANNING_SETTINGS },
    today: TODAY,
  };
}

// Saldo: 500 + 6 x (2000 - 700 - 600 - 100) - 700 - 200 = 3.200 EUR.
const LIQUID = 320000;

describe('disponible seguro', () => {
  it('descuenta los recibos antes de la nomina y se muestra en rango', () => {
    const { safe } = computePlanning(baseInput());
    expect(safe.asOf).toBe('2026-11-15');
    expect(safe.dataAgeDays).toBe(5);
    expect(safe.liquidCents).toBe(LIQUID);
    expect(safe.nextIncomeDate).toBe('2026-11-25');
    expect(safe.nextIncomeSource).toBe('series');
    expect(safe.commitments.map((c) => c.name)).toEqual(['Netflix']); // el alquiler llega despues
    expect(safe.safeCents).toBe(LIQUID - 1799);
    expect(safe.rangeHighCents).toBe(318000);
    expect(safe.rangeLowCents).toBeLessThan(safe.rangeHighCents);
    expect(safe.rangeHighCents - safe.rangeLowCents).toBeGreaterThanOrEqual(1000);
    expect(safe.daysLeft).toBe(5);
    expect(safe.perDayHighCents).toBe(Math.floor(318000 / 5));
  });

  it('aparta colchon, fondos y la aportacion pendiente de los objetivos', () => {
    const input = baseInput();
    input.planning = { ...input.planning, safetyBufferCents: 20000 };
    const goal: Budget = {
      id: 'g',
      profileId: 'perfil-a',
      name: 'Japon',
      scope: 'category',
      scopeId: 'ahorro',
      direction: 'income',
      limitCents: 300000,
      period: 'custom',
      customStart: '2026-11-01',
      customEnd: '2027-04-30',
      rollover: false,
      kind: 'goal',
      archivedAt: null,
      createdAt: 0,
      updatedAt: 0,
    };
    const fund: Budget = {
      ...goal,
      id: 'f',
      name: 'Seguro coche',
      scopeId: 'seguros',
      direction: 'expense',
      limitCents: 60000,
      customEnd: '2027-04-30',
      kind: 'fund',
    };
    input.budgets = [goal, fund];
    const { safe, flex } = computePlanning(input);
    expect(safe.goalsPendingCents).toBe(50000); // 3000 / 6 meses
    expect(safe.fundsEarmarkedCents).toBe(10000); // 600 / 6 meses, 1 mes
    expect(safe.safeCents).toBe(LIQUID - 1799 - 20000 - 50000 - 10000);
    expect(flex.fundsMonthlyCents).toBe(10000);
    expect(flex.goalsMonthlyCents).toBe(50000);
  });

  it('una paga extra se aparta hasta el siguiente cobro', () => {
    const input = baseInput();
    input.transactions.push(
      makeTx({ date: '2026-11-12', amountCents: 200000, type: 'income', categoryId: 'nomina' }),
    );
    const { safe, extraPay } = computePlanning(input);
    expect(extraPay.detected).toBe(true);
    expect(safe.extraPayReservedCents).toBe(200000);
    input.planning = { ...input.planning, reserveExtraPay: false };
    expect(computePlanning(input).safe.extraPayReservedCents).toBe(0);
  });

  it('sin nomina recurrente usa el dia de cobro y, si no, el inicio de mes', () => {
    const base = { ...DEFAULT_PLANNING_SETTINGS };
    expect(resolveNextIncome('2026-11-15', [], [], { ...base, payDay: 28 }).date).toBe('2026-11-28');
    expect(resolveNextIncome('2026-11-15', [], [], base)).toEqual({
      date: '2026-12-01',
      source: 'monthStart',
      name: null,
    });
  });
});

describe('prevision de saldo', () => {
  it('suma ingresos y recibos y descuenta el gasto habitual', () => {
    const { forecast } = computePlanning(baseInput());
    expect(forecast.incomeAssumed).toBe('series');
    expect(forecast.variableMonthlyCents).toBe(70000); // 600 supermercado + 100 ahorro
    // Tras la nomina del 25 el saldo sube y el minimo es justo antes de cobrar.
    expect(forecast.min!.date).toBe('2026-11-24');
    expect(forecast.risk).toBe('none');
    const day25 = forecast.days.find((d) => d.date === '2026-11-25')!;
    const day24 = forecast.days.find((d) => d.date === '2026-11-24')!;
    expect(day25.centralCents - day24.centralCents).toBeGreaterThan(190000);
    for (const d of forecast.days) expect(d.lowCents).toBeLessThanOrEqual(d.highCents);
  });

  it('avisa de saldo negativo y marca el primer dia', () => {
    const f = computeBalanceForecast({
      asOf: '2026-11-15',
      startCents: 10000,
      series: [series({ id: 'a', name: 'Alquiler', expectedAmountCents: 70000 })],
      occurrences: [occ('a', '2026-12-01', -70000)],
      planning: { ...DEFAULT_PLANNING_SETTINGS },
      typicalIncome: null,
      variableMonths: [],
      funds: [],
      buffer: 0,
      horizonDays: 30,
    });
    expect(f.risk).toBe('negative');
    expect(f.firstNegativeDate).toBe('2026-12-01');
    expect(f.min!.centralCents).toBe(-60000);
  });

  it('sin nomina recurrente estima el ingreso en el dia de cobro y anade pagas extra', () => {
    const f = computeBalanceForecast({
      asOf: '2026-11-15',
      startCents: 0,
      series: [],
      occurrences: [],
      planning: { ...DEFAULT_PLANNING_SETTINGS, payDay: 28, extraPayMonths: [12] },
      typicalIncome: 150000,
      variableMonths: [],
      funds: [],
      buffer: 0,
      horizonDays: 60,
    });
    expect(f.incomeAssumed).toBe('payDay');
    expect(f.events.map((e) => [e.date, e.kind])).toEqual([
      ['2026-11-28', 'income'],
      ['2026-12-28', 'income'],
      ['2026-12-28', 'extraPay'],
    ]);
  });
});

describe('KPIs y plan flexible', () => {
  it('calcula colchon, recurrentes, peso de fijos y tasas de ahorro', () => {
    const { kpis, flex } = computePlanning(baseInput());
    expect(kpis.typicalIncomeCents).toBe(200000);
    expect(kpis.typicalMonthlySpendCents).toBe(130000); // 700 + 600
    expect(kpis.runwayMonthsX10).toBe(24); // 3200 / 1300 = 2,46
    expect(kpis.recurringMonthlyCents).toBe(71799);
    expect(kpis.recurringCount).toBe(2);
    expect(kpis.fixedShareOfIncomePerMille).toBe(359);
    expect(kpis.savingsRate3mPerMille).toBe(350); // (2000 - 1300) / 2000
    expect(kpis.savingsRateMonthsUsed).toEqual({ short: 3, long: 6 });
    expect(flex.suggestedFlexCents).toBe(128000); // 2000 - 717,99, redondeado a 10 EUR
  });

  it('suma lo pendiente de recuperar de gastos compartidos', () => {
    const input = baseInput();
    input.transactions.push(
      makeTx({ id: 'cena', date: '2026-11-08', amountCents: -7200, categoryId: 'restaurantes', reimbursableCents: 4800 }),
      makeTx({ date: '2026-11-09', amountCents: 3600, refundOfId: 'cena', categoryId: 'restaurantes' }),
    );
    const { kpis } = computePlanning(input);
    expect(kpis.reimbursablePendingCents).toBe(1200);
    expect(kpis.reimbursablePendingCount).toBe(1);
  });
});

describe('variabilidad y concentracion del gasto (noviembre 2026)', () => {
  it('variabilidad: desviacion tipica sobre la media del gasto variable mensual', async () => {
    const { computeSpendVariability } = await import('./planningService');
    const { buildStatsContext } = await import('./statsService');
    const cats = [makeCategory({ id: 'super', name: 'Supermercado' })];
    // Tres meses de 200, 400 y 600 EUR: media 400, desviacion poblacional 163,30 -> 408 por mil.
    const txs = [
      makeTx({ date: '2026-08-10', amountCents: -20000, categoryId: 'super' }),
      makeTx({ date: '2026-09-10', amountCents: -40000, categoryId: 'super' }),
      makeTx({ date: '2026-10-10', amountCents: -60000, categoryId: 'super' }),
    ];
    const months = [
      { from: '2026-08-01', to: '2026-08-31' },
      { from: '2026-09-01', to: '2026-09-30' },
      { from: '2026-10-01', to: '2026-10-31' },
    ];
    const v = computeSpendVariability(txs, buildStatsContext(cats, txs), new Set(), months)!;
    expect(v.monthsUsed).toBe(3);
    expect(v.meanCents).toBe(40000);
    expect(v.stdDevCents).toBe(16330);
    expect(v.coefficientPerMille).toBe(408);
    // Con menos de 3 meses con actividad no hay dato.
    expect(computeSpendVariability(txs.slice(0, 2), buildStatsContext(cats, txs), new Set(), months)).toBeNull();
  });

  it('concentracion: peso de los 3 comercios principales sobre el gasto variable', async () => {
    const { computeSpendConcentration } = await import('./planningService');
    const { buildStatsContext } = await import('./statsService');
    const cats = [makeCategory({ id: 'super', name: 'Supermercado' })];
    const txs = [
      makeTx({ date: '2026-10-01', amountCents: -40000, categoryId: 'super', merchantId: 'm-merc', concept: 'Mercadona' }),
      makeTx({ date: '2026-10-02', amountCents: -20000, categoryId: 'super', merchantId: 'm-amz', concept: 'Amazon' }),
      makeTx({ date: '2026-10-03', amountCents: -10000, categoryId: 'super', merchantId: 'm-glovo', concept: 'Glovo' }),
      makeTx({ date: '2026-10-04', amountCents: -30000, categoryId: 'super', merchantId: 'm-alq', concept: 'Alquiler' }), // fijo
      makeTx({ date: '2026-10-05', amountCents: -5000, categoryId: 'super', concept: 'Tienda', normalizedConcept: 'tienda' }),
      makeTx({ date: '2026-10-06', amountCents: -5000, categoryId: 'super', concept: 'Kiosko', normalizedConcept: 'kiosko' }),
    ];
    const fixed = new Set([txs[3]!.id]);
    const c = computeSpendConcentration(txs, buildStatsContext(cats, txs), fixed, { from: '2026-10-01', to: '2026-10-31' })!;
    expect(c.totalVariableCents).toBe(80000);
    expect(c.top.map((t) => t.merchantId)).toEqual(['m-merc', 'm-amz', 'm-glovo']);
    expect(c.topSharePerMille).toBe(875); // 700 / 800
  });

  it('computePlanning expone ambos indicadores en los KPIs', () => {
    const out = computePlanning(baseInput());
    expect(out.kpis).toHaveProperty('variability');
    expect(out.kpis).toHaveProperty('concentration');
  });
});
