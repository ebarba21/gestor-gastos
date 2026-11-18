import { describe, it, expect } from 'vitest';
import type { Transaction } from '../db/schema';
import { buildMoneyFlow, computeInsights, daysBetween, typicalSpendShare, type InsightsInput } from './insightsService';
import { aggregatePeriod, buildStatsContext, netExpenseContribution } from './statsService';
import { makeAccount, makeCategory, makeTx } from '../test/txFixtures';

const CATS = [
  makeCategory({ id: 'nomina', name: 'Nomina', kind: 'income' }),
  makeCategory({ id: 'super', name: 'Supermercado' }),
  makeCategory({ id: 'ocio', name: 'Ocio' }),
  makeCategory({ id: 'subs', name: 'Suscripciones' }),
  makeCategory({ id: 'ahorro', name: 'Ahorro' }),
  makeCategory({ id: 'invers', name: 'Inversiones' }),
];
const ACC = makeAccount({ id: 'acc-1', name: 'Ibercaja' });
const TODAY = '2026-11-15';

function expense(date: string, euros: number, categoryId: string, extra: Partial<Transaction> = {}): Transaction {
  return makeTx({ date, amountCents: -Math.round(euros * 100), type: 'expense', categoryId, ...extra });
}
function income(date: string, euros: number, categoryId: string | null = 'nomina', extra: Partial<Transaction> = {}): Transaction {
  return makeTx({ date, amountCents: Math.round(euros * 100), type: 'income', categoryId, ...extra });
}

// Seis meses previos (mayo a octubre) con 300 EUR de super y 100 de ocio cada uno, 10 de
// suscripcion fija y 2.000 de nomina. Noviembre (mes en curso, dia 15) va con ocio disparado.
function history(): { txs: Transaction[]; fixedIds: Set<string> } {
  const txs: Transaction[] = [];
  const fixedIds = new Set<string>();
  for (const m of ['05', '06', '07', '08', '09', '10']) {
    txs.push(income(`2026-${m}-01`, 2000));
    txs.push(expense(`2026-${m}-05`, 150, 'super'));
    txs.push(expense(`2026-${m}-20`, 150, 'super'));
    txs.push(expense(`2026-${m}-12`, 100, 'ocio'));
    const sub = expense(`2026-${m}-03`, 10, 'subs');
    fixedIds.add(sub.id);
    txs.push(sub);
  }
  return { txs, fixedIds };
}

function input(txs: Transaction[], fixedIds: Set<string>, overrides: Partial<InsightsInput> = {}): InsightsInput {
  return {
    transactions: txs,
    categories: CATS,
    accounts: [ACC],
    fixedTransactionIds: fixedIds,
    hasFixedSeries: fixedIds.size > 0,
    openReviewCounts: {},
    lastImportAt: null,
    latestReconciliationByAccount: new Map(),
    anchorISO: TODAY,
    today: TODAY,
    ...overrides,
  };
}

describe('netExpenseContribution', () => {
  it('suma exactamente el gasto neto de aggregatePeriod', () => {
    const original = expense('2026-11-02', 50, 'super');
    const txs = [
      income('2026-11-01', 2000),
      original,
      expense('2026-11-03', 30, 'ocio'),
      income('2026-11-04', 20, 'ocio'), // Bizum recibido: gasto positivo
      makeTx({ date: '2026-11-05', amountCents: 1000, type: 'income', refundOfId: original.id }),
      expense('2026-11-06', 200, 'ahorro'), // aportacion: no es gasto
      expense('2026-11-07', 99, 'ocio', { excludedFromStats: true }),
    ];
    const ctx = buildStatsContext(CATS, txs);
    const sum = txs.reduce((s, t) => s + (netExpenseContribution(t, ctx)?.cents ?? 0), 0);
    expect(sum).toBe(aggregatePeriod(txs, ctx).summary.expenseNetCents);
    expect(sum).toBe(5000);
  });
});

describe('computeInsights: ritmo', () => {
  it('toma como referencia la mediana del gasto variable y deja fuera los fijos', () => {
    const { txs, fixedIds } = history();
    const sub = expense('2026-11-03', 10, 'subs');
    fixedIds.add(sub.id);
    txs.push(sub, expense('2026-11-05', 100, 'super'), expense('2026-11-10', 50, 'ocio'));
    const r = computeInsights(input(txs, fixedIds));
    expect(r.pace.baselineCents).toBe(40000);
    expect(r.pace.baselineMonths).toBe(6);
    expect(r.pace.variableSpentCents).toBe(15000);
    expect(r.pace.fixedSpentCents).toBe(1000);
    expect(r.pace.remainingCents).toBe(25000);
    // Quedan 16 dias contando hoy (15 a 30).
    expect(r.pace.daysLeft).toBe(16);
    expect(r.pace.perDayCents).toBe(1562);
    // Curva habitual: a dia 15 sueles llevar 150 (super dia 5) + 100 (ocio dia 12) = 250 de
    // 400. Gastado 150 => 100 por debajo del ritmo.
    expect(r.pace.days[14]!.idealCents).toBe(25000);
    expect(r.pace.vsPaceCents).toBe(-10000);
    expect(r.pace.days).toHaveLength(30);
    expect(r.pace.days[14]!.actualCents).toBe(15000);
    expect(r.pace.days[15]!.actualCents).toBeNull();
    expect(r.pace.days[29]!.idealCents).toBe(40000);
  });

  it('sin historial no inventa referencia', () => {
    const r = computeInsights(input([expense('2026-11-02', 20, 'ocio')], new Set()));
    expect(r.pace.baselineCents).toBeNull();
    expect(r.pace.remainingCents).toBeNull();
    expect(r.pace.perDayCents).toBeNull();
    expect(r.pace.days[0]!.idealCents).toBeNull();
  });

  it('el reembolso de un gasto fijo cuenta como fijo', () => {
    const sub = expense('2026-11-03', 10, 'subs');
    const refund = makeTx({ date: '2026-11-04', amountCents: 1000, type: 'income', refundOfId: sub.id });
    const r = computeInsights(input([sub, refund], new Set([sub.id])));
    expect(r.pace.fixedSpentCents).toBe(0);
    expect(r.pace.variableSpentCents).toBe(0);
  });

  it('en un mes cerrado no hay dias pendientes ni gasto diario', () => {
    const { txs, fixedIds } = history();
    const r = computeInsights(input(txs, fixedIds, { anchorISO: '2026-10-10' }));
    expect(r.pace.isCurrentMonth).toBe(false);
    expect(r.pace.daysLeft).toBe(0);
    expect(r.pace.perDayCents).toBeNull();
    expect(r.pace.days.every((d) => d.actualCents !== null)).toBe(true);
  });
});

describe('computeInsights: categorias y alertas', () => {
  it('marca la categoria disparada, crea su alerta con cifras y ordena por gravedad', () => {
    const { txs, fixedIds } = history();
    txs.push(expense('2026-11-08', 150, 'ocio'), expense('2026-11-06', 140, 'super'));
    const r = computeInsights(
      input(txs, fixedIds, { openReviewCounts: { possibleDuplicate: 2, uncategorized: 1 } }),
    );
    const ocio = r.categories.find((c) => c.categoryId === 'ocio')!;
    expect(ocio.averageCents).toBe(10000);
    // A dia 15 sueles llevar los 100 de ocio (se cargan el 12).
    expect(ocio.averageToDateCents).toBe(10000);
    expect(ocio.status).toBe('over');
    expect(ocio.deltaPerMille).toBe(500);
    const superBullet = r.categories.find((c) => c.categoryId === 'super')!;
    expect(superBullet.status).toBe('normal');
    expect(r.alerts[0]!.id).toBe('review-duplicates');
    expect(r.alerts[0]!.severity).toBe('critical');
    const over = r.alerts.find((a) => a.id === 'category-over-ocio')!;
    expect(over.title).toContain('Ocio');
    expect(over.title).toContain('50 %');
    expect(over.detail).toContain('150,00');
    expect(r.alerts.some((a) => a.id === 'review-categorize')).toBe(true);
  });

  it('detecta un gasto inusual frente a la mediana de su categoria', () => {
    const { txs, fixedIds } = history();
    const big = expense('2026-11-09', 600, 'ocio', { concept: 'Concierto' });
    txs.push(big);
    const r = computeInsights(input(txs, fixedIds));
    const alert = r.alerts.find((a) => a.id === `unusual-${big.id}`)!;
    expect(alert.title).toContain('Concierto');
    expect(alert.detail).toContain('6 veces');
    expect(alert.transactionId).toBe(big.id);
  });

  it('una categoria sin historial con gasto es nueva, no "por encima"', () => {
    const { txs, fixedIds } = history();
    const cats = [...CATS, makeCategory({ id: 'viajes', name: 'Vacaciones' })];
    txs.push(expense('2026-11-02', 300, 'viajes'));
    const r = computeInsights({ ...input(txs, fixedIds), categories: cats });
    expect(r.categories.find((c) => c.categoryId === 'viajes')!.status).toBe('new');
  });
});

describe('computeInsights: cascada, calendario y flujo', () => {
  it('la cascada cuadra: ingresos - fijos - variables = ahorro neto = sus partes', () => {
    const { txs, fixedIds } = history();
    const sub = expense('2026-11-03', 10, 'subs');
    fixedIds.add(sub.id);
    txs.push(income('2026-11-01', 2000), sub, expense('2026-11-05', 100, 'super'), expense('2026-11-06', 300, 'ahorro'), expense('2026-11-07', 200, 'invers'));
    const r = computeInsights(input(txs, fixedIds));
    const by = Object.fromEntries(r.waterfall.map((s) => [s.key, s.cents]));
    expect(by.income! + by.fixed! + by.variable!).toBe(by.netSavings);
    expect(by.netSavings).toBe(r.summary.netSavingsCents);
    expect(by.savings! + by.investment! + by.free!).toBe(by.netSavings);
    expect(-(by.fixed! + by.variable!)).toBe(r.summary.expenseNetCents);
  });

  it('el calendario compara cada dia con la media diaria y no pinta el futuro', () => {
    const { txs, fixedIds } = history();
    txs.push(expense('2026-11-02', 100, 'ocio'), expense('2026-11-04', 2, 'ocio'));
    const r = computeInsights(input(txs, fixedIds));
    // Media diaria de ago-oct: (410 * 3) / 92 dias = 13,37 EUR
    expect(r.heatmap.averageDailyCents).toBe(1337);
    const day = (d: number) => r.heatmap.days[d - 1]!;
    expect(day(2).level).toBe(4);
    expect(day(4).level).toBe(1);
    expect(day(1).level).toBe(0);
    expect(day(16).level).toBeNull();
    expect(r.heatmap.zeroSpendDays).toBe(13);
    expect(r.heatmap.biggestDay).toEqual({ date: '2026-11-02', netCents: 10000 });
    // 2 de noviembre de 2026 es lunes.
    expect(day(2).weekday).toBe(0);
  });

  it('el flujo del dinero cuadra entradas y salidas, con origen de ahorros si se gasta de mas', () => {
    const summary = {
      incomeCents: 100000,
      expenseGrossCents: 130000,
      refundCents: 0,
      positiveExpenseCents: 0,
      expenseNetCents: 130000,
      netSavingsCents: -30000,
      savingsContribCents: 0,
      investmentContribCents: 0,
      savingsRatePerMille: -300,
    };
    const flow = buildMoneyFlow(
      summary,
      [
        { categoryId: 'super', netCents: 80000 },
        { categoryId: 'ocio', netCents: 50000 },
      ],
      (id) => id ?? 'Sin categoria',
    );
    expect(flow.nodes.map((n) => n.name)).toEqual(['Ingresos', 'De tus ahorros', 'Dinero del mes', 'super', 'ocio']);
    const into = (i: number) => flow.links.filter((l) => l.target === i).reduce((s, l) => s + l.value, 0);
    const outOf = (i: number) => flow.links.filter((l) => l.source === i).reduce((s, l) => s + l.value, 0);
    expect(into(2)).toBe(outOf(2));
    expect(into(2)).toBe(130000);
  });

  it('con un solo origen enlaza directamente y lo no gastado va a "Sin gastar"', () => {
    const { txs, fixedIds } = history();
    txs.push(income('2026-11-01', 2000), expense('2026-11-05', 100, 'super'));
    const r = computeInsights(input(txs, fixedIds));
    expect(r.flow.nodes[0]!.name).toBe('Ingresos');
    expect(r.flow.nodes.some((n) => n.kind === 'hub')).toBe(false);
    const free = r.flow.nodes.findIndex((n) => n.kind === 'free');
    expect(r.flow.links.find((l) => l.target === free)!.value).toBe(190000);
  });
});

describe('computeInsights: resumen y salud del dato', () => {
  it('redacta el resumen con el mes, el gasto y el ahorro', () => {
    const { txs, fixedIds } = history();
    txs.push(income('2026-11-01', 2000), expense('2026-11-05', 50, 'super'));
    const r = computeInsights(input(txs, fixedIds));
    expect(r.narrative[0]).toMatch(/^En noviembre llevas 50,00\s€ de gasto neto\.$/);
    expect(r.narrative[1]).toBe('Tu gasto variable va un 80 % por debajo de lo habitual a estas alturas.');
    expect(r.narrative.some((l) => l.startsWith('Has ingresado 2000,00') || l.startsWith('Has ingresado 2.000,00'))).toBe(true);
  });

  it('un mes vacio lo dice sin inventar cifras', () => {
    const r = computeInsights(input([], new Set()));
    expect(r.narrative).toEqual(['Aún no hay movimientos en noviembre.']);
  });

  it('avisa de cuentas sin movimientos recientes y cuenta los sin categoria', () => {
    const revolut = makeAccount({ id: 'rev', name: 'Revolut' });
    const txs = [
      expense('2026-11-14', 10, 'super', { categorizedBy: 'rule' }),
      expense('2026-11-13', 10, 'super', { categorizedBy: 'manual' }),
      makeTx({ date: '2026-11-12', amountCents: -500, type: 'expense', categoryId: null }),
      makeTx({ date: '2026-09-01', amountCents: -500, type: 'expense', accountId: 'rev', categoryId: 'super', categorizedBy: 'rule' }),
    ];
    const r = computeInsights({ ...input(txs, new Set()), accounts: [ACC, revolut] });
    expect(r.health.status).toBe('stale');
    expect(r.health.headline).toBe('1 cuenta sin movimientos desde hace 75 días');
    expect(r.health.accounts[0]!.accountId).toBe('rev');
    expect(r.health.uncategorizedCount).toBe(1);
    expect(r.health.recentMovements).toBe(4);
    expect(r.health.byRulePerMille).toBe(500);
  });

  it('con todo al dia lo dice en la cabecera', () => {
    const r = computeInsights(input([expense('2026-11-14', 10, 'super')], new Set()));
    expect(r.health.status).toBe('ok');
    expect(r.health.headline).toBe('Datos al día · último movimiento ayer');
  });
});

describe('comparaciones "a estas alturas"', () => {
  it('un cargo de principio de mes no se marca por encima de la media', () => {
    const { txs, fixedIds } = history();
    const cats = [...CATS, makeCategory({ id: 'movil', name: 'Movil' })];
    for (const m of ['05', '06', '07', '08', '09', '10', '11']) txs.push(expense(`2026-${m}-05`, 78, 'movil'));
    const r = computeInsights({ ...input(txs, fixedIds), categories: cats });
    const movil = r.categories.find((c) => c.categoryId === 'movil')!;
    expect(movil.averageToDateCents).toBe(7800);
    expect(movil.status).toBe('normal');
    expect(r.alerts.some((a) => a.categoryId === 'movil')).toBe(false);
  });

  it('si todo el gasto historico es fijo no hay referencia (nunca 0 EUR)', () => {
    const txs: Transaction[] = [];
    const fixedIds = new Set<string>();
    for (const m of ['08', '09', '10']) {
      const t = expense(`2026-${m}-03`, 50, 'subs');
      fixedIds.add(t.id);
      txs.push(t);
    }
    const r = computeInsights(input(txs, fixedIds));
    expect(r.pace.baselineCents).toBeNull();
    expect(r.pace.baselineMonths).toBe(0);
  });

  it('typicalSpendShare sigue la curva real, es monotona y termina en 1', () => {
    const byDay = new Array<number>(32).fill(0);
    byDay[2] = 300;
    byDay[20] = 100;
    const share = typicalSpendShare([{ variableByDay: byDay, days: 30 }], 30);
    expect(share[1]).toBe(0);
    expect(share[2]).toBe(0.75);
    expect(share[19]).toBe(0.75);
    expect(share[30]).toBe(1);
    const linear = typicalSpendShare([], 30);
    expect(linear[15]).toBe(0.5);
  });
});

describe('daysBetween', () => {
  it('cuenta dias naturales sin zona horaria, cruzando meses y anos', () => {
    expect(daysBetween('2026-12-30', '2027-01-02')).toBe(3);
    expect(daysBetween('2026-03-01', '2026-02-28')).toBe(-1);
  });
});
