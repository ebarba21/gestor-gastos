// Presupuestos de noviembre 2026: rollover aplicado, flexible sin fijos, objetivos con fecha,
// fondos anuales y ciclo de nomina. Funciones puras (sin base de datos).
import { describe, it, expect } from 'vitest';
import type { Budget } from '../db/schema';
import { makeAccount, makeCategory, makeTx } from '../test/txFixtures';
import { buildStatsContext } from './statsService';
import {
  evaluateBudget,
  fundCycle,
  resolveBudgetRange,
  type BudgetEvalEnv,
} from './budgetService';
import { DEFAULT_PLANNING_SETTINGS, type PlanningSettings } from './planningSettings';
import { nextPayDate, payCycleRange } from '../lib/dates';

const cats = [
  makeCategory({ id: 'super', name: 'Supermercado' }),
  makeCategory({ id: 'ocio', name: 'Ocio' }),
  makeCategory({ id: 'ahorro', name: 'Ahorro' }),
  makeCategory({ id: 'seguros', name: 'Seguros' }),
  makeCategory({ id: 'nomina', name: 'Nomina', kind: 'income' }),
];

function env(txs: ReturnType<typeof makeTx>[], opts: { fixedIds?: string[]; planning?: Partial<PlanningSettings> } = {}): BudgetEvalEnv {
  return {
    allTx: txs,
    ctx: buildStatsContext(cats, txs),
    fixedIds: new Set(opts.fixedIds ?? []),
    accounts: [makeAccount({ id: 'acc-1' }), makeAccount({ id: 'hucha', openingBalanceCents: 0 })],
    planning: { ...DEFAULT_PLANNING_SETTINGS, ...opts.planning },
  };
}

function budget(overrides: Partial<Budget>): Budget {
  return {
    id: 'b1',
    profileId: 'perfil-a',
    name: 'Presupuesto',
    scope: 'category',
    scopeId: 'super',
    direction: 'expense',
    limitCents: 30000,
    period: 'monthly',
    customStart: null,
    customEnd: null,
    rollover: false,
    kind: 'limit',
    archivedAt: null,
    createdAt: Date.UTC(2026, 7, 1, 12), // 1 ago 2026
    updatedAt: 0,
    ...overrides,
  };
}

describe('ciclo de nomina', () => {
  it('va del dia de cobro al dia anterior del siguiente cobro', () => {
    expect(payCycleRange('2026-11-20', 25)).toEqual({ from: '2026-10-25', to: '2026-11-24' });
    expect(payCycleRange('2026-11-25', 25)).toEqual({ from: '2026-11-25', to: '2026-12-24' });
    expect(nextPayDate('2026-11-20', 25)).toBe('2026-11-25');
  });

  it('ajusta el dia 31 al ultimo dia de meses mas cortos', () => {
    expect(payCycleRange('2026-02-15', 31)).toEqual({ from: '2026-01-31', to: '2026-02-27' });
    expect(nextPayDate('2026-02-15', 31)).toBe('2026-02-28');
  });

  it('los presupuestos mensuales usan el ciclo de nomina si esta activo', () => {
    const b = budget({});
    expect(resolveBudgetRange(b, '2026-11-20', { budgetCycle: 'payday', payDay: 25 })).toEqual({
      from: '2026-10-25',
      to: '2026-11-24',
    });
    expect(resolveBudgetRange(b, '2026-11-20', { budgetCycle: 'calendar', payDay: 25 })).toEqual({
      from: '2026-11-01',
      to: '2026-11-30',
    });
  });
});

describe('rollover', () => {
  it('suma lo que sobro y resta lo que se excedio en periodos anteriores', () => {
    const txs = [
      makeTx({ date: '2026-08-10', amountCents: -20000, categoryId: 'super' }), // sobran 100
      makeTx({ date: '2026-09-10', amountCents: -35000, categoryId: 'super' }), // faltan 50
      makeTx({ date: '2026-10-10', amountCents: -30000, categoryId: 'super' }), // 0
      makeTx({ date: '2026-11-05', amountCents: -5000, categoryId: 'super' }),
    ];
    const ev = evaluateBudget(budget({ rollover: true }), env(txs), '2026-11-20');
    expect(ev.carryCents).toBe(5000);
    expect(ev.effectiveLimitCents).toBe(35000);
    expect(ev.remainingCents).toBe(30000);
  });

  it('no arrastra periodos anteriores a la creacion del presupuesto', () => {
    const txs = [makeTx({ date: '2026-07-10', amountCents: -1000, categoryId: 'super' })];
    const ev = evaluateBudget(budget({ rollover: true }), env(txs), '2026-08-20');
    expect(ev.carryCents).toBe(0);
  });

  it('sin rollover no hay arrastre', () => {
    const txs = [makeTx({ date: '2026-08-10', amountCents: -1000, categoryId: 'super' })];
    expect(evaluateBudget(budget({}), env(txs), '2026-09-20').carryCents).toBe(0);
  });
});

describe('presupuesto flexible', () => {
  it('cuenta solo el gasto variable (sin recibos fijos ni ahorro)', () => {
    const txs = [
      makeTx({ id: 'alquiler', date: '2026-11-01', amountCents: -80000, categoryId: 'ocio' }),
      makeTx({ date: '2026-11-03', amountCents: -4000, categoryId: 'super' }),
      makeTx({ date: '2026-11-04', amountCents: -10000, categoryId: 'ahorro' }),
    ];
    const ev = evaluateBudget(
      budget({ kind: 'flex', scope: 'overall', scopeId: null, limitCents: 50000 }),
      env(txs, { fixedIds: ['alquiler'] }),
      '2026-11-20',
    );
    expect(ev.consumedCents).toBe(4000);
    expect(ev.remainingCents).toBe(46000);
  });
});

describe('objetivos de ahorro', () => {
  const goal = budget({
    kind: 'goal',
    direction: 'income',
    scope: 'category',
    scopeId: 'ahorro',
    limitCents: 300000,
    period: 'custom',
    customStart: '2026-09-01',
    customEnd: '2027-06-30',
  });

  it('calcula ahorrado, aportacion necesaria y fecha estimada', () => {
    const txs = [
      makeTx({ date: '2026-09-05', amountCents: -30000, categoryId: 'ahorro' }),
      makeTx({ date: '2026-10-05', amountCents: -30000, categoryId: 'ahorro' }),
      makeTx({ date: '2026-11-05', amountCents: -30000, categoryId: 'ahorro' }),
    ];
    const g = evaluateBudget(goal, env(txs), '2026-11-20').goal!;
    expect(g.savedCents).toBe(90000);
    expect(g.remainingCents).toBe(210000);
    expect(g.monthsLeft).toBe(8); // nov..jun
    expect(g.requiredMonthlyCents).toBe(26250);
    expect(g.paceMonthlyCents).toBe(30000);
    expect(g.etaISO).toBe('2027-06-20'); // 7 meses mas a 300 €/mes
    expect(g.status).toBe('onTrack');
    // Ya aporto 300 € este mes, mas que los 262,50 necesarios.
    expect(g.pendingThisMonthCents).toBe(0);
  });

  it('sin aportaciones no hay ritmo; si vence sin completarse, esta vencido', () => {
    expect(evaluateBudget(goal, env([]), '2026-11-20').goal!.status).toBe('noPace');
    expect(evaluateBudget(goal, env([]), '2026-11-20').goal!.pendingThisMonthCents).toBe(37500);
    expect(evaluateBudget(goal, env([]), '2027-07-01').goal!.status).toBe('overdue');
  });

  it('un objetivo por cuenta usa su saldo', () => {
    const g = evaluateBudget(
      { ...goal, scope: 'account', scopeId: 'hucha', limitCents: 100000 },
      env([makeTx({ accountId: 'hucha', date: '2026-10-01', amountCents: 100000, type: 'transfer' })]),
      '2026-11-20',
    ).goal!;
    expect(g.savedCents).toBe(100000);
    expect(g.status).toBe('met');
  });
});

describe('fondos para gastos no mensuales', () => {
  const fund = budget({
    kind: 'fund',
    scope: 'category',
    scopeId: 'seguros',
    limitCents: 60000,
    period: 'custom',
    customStart: '2026-11-01',
    customEnd: '2027-03-15',
  });

  it('aparta una cuota mensual y descuenta lo gastado', () => {
    const f = evaluateBudget(fund, env([]), '2026-12-10').fund!;
    expect(f.monthsInCycle).toBe(5);
    expect(f.monthlyProvisionCents).toBe(12000);
    expect(f.provisionedCents).toBe(24000);
    expect(f.earmarkedCents).toBe(24000);
  });

  it('se repite cada ano en la misma fecha', () => {
    expect(fundCycle('2026-11-01', '2027-03-15', '2027-04-01')).toEqual({ from: '2027-03-16', to: '2028-03-15' });
    const txs = [makeTx({ date: '2027-03-10', amountCents: -60000, categoryId: 'seguros' })];
    const f = evaluateBudget(fund, env(txs), '2027-03-12').fund!;
    expect(f.spentCents).toBe(60000);
    expect(f.earmarkedCents).toBe(0);
  });
});
