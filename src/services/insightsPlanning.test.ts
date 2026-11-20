// Insights de noviembre 2026: variacion frente al mes anterior, proyeccion de cierre,
// recordatorio de importacion, prioridad, avisos de planificacion y opiniones sobre avisos.
import { describe, it, expect } from 'vitest';
import { makeAccount, makeCategory, makeTx } from '../test/txFixtures';
import { alertPriority, computeInsights, sortAlertsByPriority, type InsightAlert, type InsightsInput } from './insightsService';
import { computeBalanceForecast, planningAlerts, type PlanningResult } from './planningService';
import { DEFAULT_PLANNING_SETTINGS } from './planningSettings';
import { visibleAlerts } from './insightFeedbackService';
import type { InsightFeedback } from '../db/schema';

const categories = [
  makeCategory({ id: 'rest', name: 'Restaurantes' }),
  makeCategory({ id: 'viajes', name: 'Viajes' }),
  makeCategory({ id: 'super', name: 'Supermercado' }),
];

function input(txs: ReturnType<typeof makeTx>[], overrides: Partial<InsightsInput> = {}): InsightsInput {
  return {
    transactions: txs,
    categories,
    accounts: [makeAccount({ id: 'acc-1', name: 'Ibercaja' })],
    fixedTransactionIds: new Set(),
    hasFixedSeries: false,
    openReviewCounts: {},
    lastImportAt: null,
    latestReconciliationByAccount: new Map(),
    anchorISO: '2026-11-15',
    today: '2026-11-15',
    ...overrides,
  };
}

function monthlyHistory(): ReturnType<typeof makeTx>[] {
  const txs = [];
  for (const m of ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']) {
    txs.push(makeTx({ date: `${m}-05`, amountCents: -10000, categoryId: 'rest' }));
    txs.push(makeTx({ date: `${m}-20`, amountCents: -10000, categoryId: 'rest' }));
    txs.push(makeTx({ date: `${m}-08`, amountCents: -30000, categoryId: 'super' }));
  }
  return txs;
}

describe('variacion frente al mes anterior', () => {
  it('explica la diferencia por categoria a la misma altura del mes', () => {
    const txs = [
      ...monthlyHistory(),
      makeTx({ date: '2026-11-03', amountCents: -12000, categoryId: 'viajes' }),
      makeTx({ date: '2026-11-06', amountCents: -17400, categoryId: 'rest' }),
      makeTx({ date: '2026-11-08', amountCents: -27500, categoryId: 'super' }),
      makeTx({ date: '2026-11-14', amountCents: -100, categoryId: 'rest' }),
    ];
    const v = computeInsights(input(txs)).variance!;
    expect(v.previousMonth).toBe('2026-10');
    // A dia 15 de octubre: 100 restaurantes + 300 super = 400.
    expect(v.previousCents).toBe(40000);
    expect(v.currentCents).toBe(57000);
    expect(v.deltaCents).toBe(17000);
    expect(v.items).toEqual([
      { categoryId: 'viajes', deltaCents: 12000 },
      { categoryId: 'rest', deltaCents: 7500 },
      { categoryId: 'super', deltaCents: -2500 },
    ]);
    expect(v.restCents).toBe(0);
  });
});

describe('proyeccion de cierre', () => {
  it('una categoria por encima avisa de como cerrara el mes', () => {
    const txs = [...monthlyHistory(), makeTx({ date: '2026-11-04', amountCents: -25000, categoryId: 'rest' })];
    const ins = computeInsights(input(txs));
    const alert = ins.alerts.find((a) => a.id === 'category-over-rest')!;
    // Llevas 250 (media a estas alturas 100) + lo que sueles gastar el resto del mes (100) = 350.
    expect(alert.detail).toContain('cerraras el mes en unos 350,00');
    expect(alert.impactCents).toBe(15000);
    expect(ins.pace.projectedEndCents).not.toBeNull();
  });
});

describe('recordatorio de importacion', () => {
  it('avisa cuando una cuenta lleva demasiados dias sin movimientos', () => {
    const txs = [...monthlyHistory()];
    const ins = computeInsights(input(txs, { anchorISO: '2026-11-25', today: '2026-11-25' }));
    const alert = ins.alerts.find((a) => a.id === 'import-stale');
    expect(alert?.title).toBe('Hace 36 dias que no importas Ibercaja');
    expect(alert?.route).toBe('/importar');
  });
});

describe('prioridad de avisos', () => {
  it('ordena por gravedad, dinero en juego y urgencia', () => {
    const alerts: InsightAlert[] = [
      { id: 'info', severity: 'info', title: '', detail: '' },
      { id: 'cat', severity: 'action', title: '', detail: '', impactCents: 2000, categoryId: 'rest' },
      { id: 'big', severity: 'action', title: '', detail: '', impactCents: 50000, dueDate: '2026-11-17', route: '/x' },
      { id: 'neg', severity: 'critical', title: '', detail: '', impactCents: 4200, dueDate: '2026-11-27' },
    ];
    expect(sortAlertsByPriority(alerts, '2026-11-15').map((a) => a.id)).toEqual(['neg', 'big', 'cat', 'info']);
    expect(alertPriority({ id: 'x', severity: 'critical', title: '', detail: '', impactCents: 10_000_000 }, '2026-11-15')).toBeLessThanOrEqual(100);
  });
});

describe('avisos de planificacion', () => {
  it('avisa del primer dia en negativo y del cargo que lo provoca', () => {
    const forecast = computeBalanceForecast({
      asOf: '2026-11-15',
      startCents: 10000,
      series: [
        {
          id: 'a',
          profileId: 'perfil-a',
          merchantId: null,
          accountId: null,
          name: 'Endesa',
          direction: 'expense',
          frequency: 'monthly',
          interval: 1,
          expectedAmountCents: 11800,
          amountToleranceCents: 0,
          amountTolerancePpm: 0,
          expectedDayOfWeek: null,
          expectedDayOfMonth: 26,
          dateToleranceDays: 3,
          nextExpectedDate: null,
          status: 'active',
          confidence: 900,
          detectionVersion: 1,
          createdAt: 0,
          updatedAt: 0,
        },
      ],
      occurrences: [
        { id: 'o', profileId: 'perfil-a', seriesId: 'a', transactionId: null, expectedDate: '2026-11-26', expectedAmountCents: -11800, status: 'expected', createdAt: 0, updatedAt: 0 },
      ],
      planning: { ...DEFAULT_PLANNING_SETTINGS },
      typicalIncome: null,
      variableMonths: [],
      funds: [],
      buffer: 0,
    });
    const result = {
      forecast,
      safe: { incomeOverdue: false, nextIncomeSource: 'monthStart' },
      extraPay: { detected: false, excessCents: 0, cycleFrom: '' },
      kpis: { reimbursablePendingCents: 0, reimbursablePendingCount: 0 },
    } as unknown as PlanningResult;
    const [alert] = planningAlerts(result);
    expect(alert!.severity).toBe('critical');
    expect(alert!.title).toContain('-18,00');
    expect(alert!.title).toContain('26 nov');
    expect(alert!.detail).toContain('Endesa (118,00');
  });
});

describe('opiniones sobre avisos', () => {
  const now = Date.UTC(2026, 10, 15);
  const fb = (alertId: string, snoozedUntil: number | null): InsightFeedback => ({
    id: `p:${alertId}`,
    profileId: 'p',
    alertId,
    useful: null,
    snoozedUntil,
    updatedAt: now,
  });

  it('oculta los pospuestos hasta su fecha', () => {
    const alerts = [
      { id: 'a', severity: 'action' },
      { id: 'b', severity: 'info' },
    ];
    expect(visibleAlerts(alerts, [fb('a', now + 1000)], now).map((a) => a.id)).toEqual(['b']);
    expect(visibleAlerts(alerts, [fb('a', now - 1)], now).map((a) => a.id)).toEqual(['a', 'b']);
  });

  it('un aviso critico solo se silencia un dia', () => {
    const alerts = [{ id: 'neg', severity: 'critical' }];
    const week = now + 7 * 86_400_000;
    expect(visibleAlerts(alerts, [fb('neg', week)], now + 3600_000)).toHaveLength(0);
    expect(visibleAlerts(alerts, [fb('neg', week)], now + 2 * 86_400_000)).toHaveLength(1);
  });
});
