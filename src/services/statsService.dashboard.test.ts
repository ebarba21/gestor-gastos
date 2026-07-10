import { describe, it, expect, beforeEach } from 'vitest';
import type { Category, Transaction } from '../db/schema';
import { db } from '../db';
import { transactionsRepo } from '../db/transactionsRepo';
import type { NewTransaction } from '../db/transactionsRepo';
import { accountService } from './accountService';
import {
  aggregatePeriod,
  buildStatsContext,
  computeComparison,
  computeConsumption,
  computeDashboard,
  computeForecast,
  computeMonthlyEvolution,
  computeRecurringExpenses,
  computeSavingsCategoryIds,
  computeSavingsInvestment,
  computeTopExpenses,
  isInvestmentMovement,
  isSavingsMovement,
  monthKey,
  monthKeysEndingAt,
  rootCategoryIdOf,
  savingsRatePerMille,
  statsService,
} from './statsService';

// --- Factoria de movimientos puros (sin base de datos) ---
function tx(overrides: Partial<Transaction> = {}): Transaction {
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
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

// Alimentacion (raiz) -> Supermercado (sub). Ocio (raiz) suelta. Ahorros (raiz) -> Fondo (sub).
const CATEGORIES: Category[] = [
  { id: 'cat-food', profileId: 'perfil-a', name: 'Alimentacion', parentId: null, kind: 'expense', color: null, icon: null, archivedAt: null, sortOrder: 0, createdAt: 0, updatedAt: 0 },
  { id: 'sub-super', profileId: 'perfil-a', name: 'Supermercado', parentId: 'cat-food', kind: 'expense', color: null, icon: null, archivedAt: null, sortOrder: 0, createdAt: 0, updatedAt: 0 },
  { id: 'cat-ocio', profileId: 'perfil-a', name: 'Ocio', parentId: null, kind: 'expense', color: null, icon: null, archivedAt: null, sortOrder: 1, createdAt: 0, updatedAt: 0 },
  { id: 'cat-ahorro', profileId: 'perfil-a', name: 'Ahorros', parentId: null, kind: 'expense', color: null, icon: null, archivedAt: null, sortOrder: 2, createdAt: 0, updatedAt: 0 },
  { id: 'sub-fondo', profileId: 'perfil-a', name: 'Fondo de emergencia', parentId: 'cat-ahorro', kind: 'expense', color: null, icon: null, archivedAt: null, sortOrder: 0, createdAt: 0, updatedAt: 0 },
  { id: 'cat-invers', profileId: 'perfil-a', name: 'Inversiones', parentId: null, kind: 'expense', color: null, icon: null, archivedAt: null, sortOrder: 3, createdAt: 0, updatedAt: 0 },
  { id: 'sub-indexado', profileId: 'perfil-a', name: 'Fondos indexados', parentId: 'cat-invers', kind: 'expense', color: null, icon: null, archivedAt: null, sortOrder: 0, createdAt: 0, updatedAt: 0 },
];

function ctxFor(txs: Transaction[]) {
  return buildStatsContext(CATEGORIES, txs);
}

describe('rootCategoryIdOf', () => {
  const parentOf = ctxFor([]).parentOf;
  it('sin categoria devuelve null', () => {
    expect(rootCategoryIdOf(null, null, parentOf)).toBeNull();
  });
  it('una categoria raiz se atribuye a si misma', () => {
    expect(rootCategoryIdOf('cat-food', null, parentOf)).toBe('cat-food');
  });
  it('una subcategoria sube a su raiz (por subcategoryId o por categoryId)', () => {
    expect(rootCategoryIdOf('cat-food', 'sub-super', parentOf)).toBe('cat-food');
    expect(rootCategoryIdOf('sub-super', null, parentOf)).toBe('cat-food');
  });
  it('una categoria inexistente (borrada) se atribuye a si misma, no se pierde', () => {
    expect(rootCategoryIdOf('cat-borrada', null, parentOf)).toBe('cat-borrada');
  });
});

describe('savingsRatePerMille (division por cero)', () => {
  it('null cuando no hay ingresos (no divide por cero)', () => {
    expect(savingsRatePerMille(0, -500)).toBeNull();
    expect(savingsRatePerMille(-100, 50)).toBeNull();
  });
  it('tanto por mil entero cuando hay ingresos', () => {
    expect(savingsRatePerMille(100000, 35000)).toBe(350); // 35,0%
    expect(savingsRatePerMille(100000, -20000)).toBe(-200); // ahorro negativo
  });
});

describe('aggregatePeriod - resumen', () => {
  it('periodo vacio: todo a cero y tasa de ahorro null', () => {
    const { summary, byCategory } = aggregatePeriod([], ctxFor([]));
    expect(summary).toEqual({
      incomeCents: 0,
      expenseGrossCents: 0,
      refundCents: 0,
      expenseNetCents: 0,
      netSavingsCents: 0,
      savingsContribCents: 0,
      investmentContribCents: 0,
      savingsRatePerMille: null,
    });
    expect(byCategory).toEqual([]);
  });

  it('respeta exclusiones, transferencias y splits; reembolso reduce gasto y no es ingreso', () => {
    const original = tx({ id: 'g', type: 'expense', amountCents: -5000, categoryId: 'cat-food' });
    const txs = [
      tx({ type: 'income', amountCents: 200000 }), // nomina
      tx({ type: 'income', amountCents: 800, refundOfId: 'g', categoryId: null }), // reembolso
      original,
      tx({ type: 'expense', amountCents: -1500, categoryId: 'cat-ocio' }),
      tx({ type: 'transfer', amountCents: -3000, excludedFromStats: true, statsFlag: 1 }), // transferencia
      tx({ type: 'expense', amountCents: -9999, excludedFromStats: true, statsFlag: 1 }), // excluido manual
      // Split: padre excluido (no cuenta), hijas cuentan.
      tx({ id: 'p', type: 'expense', amountCents: -2000, isSplitParent: true, excludedFromStats: true, statsFlag: 1, categoryId: 'cat-ocio' }),
      tx({ type: 'expense', amountCents: -1200, parentId: 'p', categoryId: 'cat-food' }),
      tx({ type: 'expense', amountCents: -800, parentId: 'p', categoryId: 'cat-ocio' }),
    ];
    const { summary } = aggregatePeriod(txs, ctxFor(txs));
    // Gasto bruto: 5000 + 1500 + 1200 + 800 = 8500 (sin transferencia ni excluidos ni padre)
    expect(summary.expenseGrossCents).toBe(8500);
    expect(summary.refundCents).toBe(800);
    expect(summary.expenseNetCents).toBe(8500 - 800);
    expect(summary.incomeCents).toBe(200000); // sin el reembolso
    expect(summary.netSavingsCents).toBe(200000 - 7700);
    expect(summary.savingsRatePerMille).toBe(Math.round((192300 / 200000) * 1000));
  });

  it('coincide con computeConsumption (misma semantica que presupuestos)', () => {
    const original = tx({ id: 'g', type: 'expense', amountCents: -5000, categoryId: 'sub-super' });
    const txs = [
      tx({ type: 'income', amountCents: 150000 }),
      original,
      tx({ type: 'income', amountCents: 2000, refundOfId: 'g', categoryId: null }),
      tx({ type: 'expense', amountCents: -1000, categoryId: 'cat-ocio' }),
    ];
    const ctx = ctxFor(txs);
    const { summary } = aggregatePeriod(txs, ctx);
    expect(summary.expenseNetCents).toBe(
      computeConsumption(txs, 'overall', null, 'expense', ctx).consumedCents,
    );
    expect(summary.incomeCents).toBe(
      computeConsumption(txs, 'overall', null, 'income', ctx).consumedCents,
    );
  });
});

describe('aggregatePeriod - desglose por categoria', () => {
  it('agrupa por raiz, atribuye el reembolso al gasto original y ordena por neto', () => {
    const txs = [
      tx({ id: 'g', type: 'expense', amountCents: -2000, categoryId: 'cat-food' }),
      tx({ type: 'expense', amountCents: -1000, categoryId: 'cat-food', subcategoryId: 'sub-super' }),
      tx({ type: 'expense', amountCents: -500, categoryId: 'cat-ocio' }),
      tx({ type: 'expense', amountCents: -300, categoryId: null }), // sin categoria
      tx({ type: 'income', amountCents: 800, refundOfId: 'g', categoryId: null }), // reduce cat-food
    ];
    const { byCategory } = aggregatePeriod(txs, ctxFor(txs));
    // cat-food: bruto 3000 (raiz + sub) - reembolso 800 = 2200
    expect(byCategory).toEqual([
      { categoryId: 'cat-food', grossCents: 3000, refundCents: 800, netCents: 2200 },
      { categoryId: 'cat-ocio', grossCents: 500, refundCents: 0, netCents: 500 },
      { categoryId: null, grossCents: 300, refundCents: 0, netCents: 300 },
    ]);
  });

  it('el bucket sin categoria queda al final ante empate de neto', () => {
    const txs = [
      tx({ type: 'expense', amountCents: -1000, categoryId: 'cat-ocio' }),
      tx({ type: 'expense', amountCents: -1000, categoryId: null }),
    ];
    const { byCategory } = aggregatePeriod(txs, ctxFor(txs));
    expect(byCategory.map((c) => c.categoryId)).toEqual(['cat-ocio', null]);
  });
});

describe('monthKey / monthKeysEndingAt (cambio de ano)', () => {
  it('monthKey extrae YYYY-MM', () => {
    expect(monthKey('2026-07-10')).toBe('2026-07');
  });
  it('la ventana cruza el cambio de ano hacia atras', () => {
    expect(monthKeysEndingAt('2026-01-15', 3)).toEqual(['2025-11', '2025-12', '2026-01']);
  });
});

describe('computeMonthlyEvolution', () => {
  it('rellena la rejilla de meses sin huecos y respeta la ventana', () => {
    const txs = [
      tx({ date: '2025-12-05', type: 'expense', amountCents: -3000 }),
      tx({ date: '2026-01-20', type: 'income', amountCents: 250000 }),
      tx({ date: '2026-01-22', type: 'expense', amountCents: -1000 }),
      tx({ date: '2025-06-01', type: 'expense', amountCents: -9999 }), // fuera de ventana
    ];
    const series = computeMonthlyEvolution(txs, '2026-01-15', 3);
    expect(series).toEqual([
      { month: '2025-11', incomeCents: 0, expenseNetCents: 0, netSavingsCents: 0 },
      { month: '2025-12', incomeCents: 0, expenseNetCents: 3000, netSavingsCents: -3000 },
      { month: '2026-01', incomeCents: 250000, expenseNetCents: 1000, netSavingsCents: 249000 },
    ]);
  });

  it('el reembolso reduce el gasto neto del mes en que ocurre', () => {
    const txs = [
      tx({ id: 'g', date: '2026-07-02', type: 'expense', amountCents: -5000, categoryId: 'cat-food' }),
      tx({ date: '2026-07-20', type: 'income', amountCents: 1500, refundOfId: 'g', categoryId: null }),
    ];
    const series = computeMonthlyEvolution(txs, '2026-07-15', 1);
    expect(series).toEqual([
      { month: '2026-07', incomeCents: 0, expenseNetCents: 3500, netSavingsCents: -3500 },
    ]);
  });
});

describe('computeComparison', () => {
  it('promedia solo meses previos con actividad y calcula la variacion', () => {
    const txs = [
      tx({ date: '2025-11-10', type: 'expense', amountCents: -1000 }),
      tx({ date: '2025-12-10', type: 'expense', amountCents: -3000 }),
      // 2025-10 sin actividad: no debe entrar en la media
      tx({ date: '2026-01-10', type: 'expense', amountCents: -2500 }),
    ];
    // `today` en otro mes: 2026-01 es un mes cerrado, sin prorrateo (mes completo vs media).
    const cmp = computeComparison(txs, '2026-01-15', 3, undefined, '2026-07-10');
    expect(cmp.currentExpenseNetCents).toBe(2500);
    expect(cmp.monthsCompared).toBe(2); // 11 y 12; no el 10 vacio
    expect(cmp.averageExpenseNetCents).toBe(2000);
    expect(cmp.prorated).toBe(false);
    expect(cmp.averageComparedCents).toBe(2000);
    expect(cmp.deltaCents).toBe(500);
    expect(cmp.deltaPerMille).toBe(250);
  });

  it('sin historial previo con actividad: media 0 y variacion null (no divide por cero)', () => {
    const txs = [tx({ date: '2026-01-10', type: 'expense', amountCents: -2500 })];
    const cmp = computeComparison(txs, '2026-01-15', 3, undefined, '2026-07-10');
    expect(cmp.monthsCompared).toBe(0);
    expect(cmp.averageExpenseNetCents).toBe(0);
    expect(cmp.averageComparedCents).toBe(0);
    expect(cmp.deltaPerMille).toBeNull();
  });

  it('regla de 3: en el mes en curso prorratea la media a los dias transcurridos', () => {
    const txs = [
      // Dos meses previos completos con gasto neto 3000 cada uno -> media 3000.
      tx({ date: '2026-05-10', type: 'expense', amountCents: -3000 }),
      tx({ date: '2026-06-10', type: 'expense', amountCents: -3000 }),
      // Mes en curso (julio), gasto parcial hasta hoy.
      tx({ date: '2026-07-05', type: 'expense', amountCents: -1200 }),
    ];
    // Hoy es 15 de julio: han pasado 15 de 31 dias.
    const cmp = computeComparison(txs, '2026-07-15', 2, undefined, '2026-07-15');
    expect(cmp.prorated).toBe(true);
    expect(cmp.daysElapsed).toBe(15);
    expect(cmp.daysInMonth).toBe(31);
    expect(cmp.averageExpenseNetCents).toBe(3000); // media mensual completa
    expect(cmp.averageComparedCents).toBe(Math.round((3000 * 15) / 31)); // 1452, prorrateada
    expect(cmp.currentExpenseNetCents).toBe(1200);
    expect(cmp.deltaCents).toBe(1200 - Math.round((3000 * 15) / 31));
  });

  it('acota el gasto actual a hoy: un gasto con fecha futura del mes no infla el parcial', () => {
    const txs = [
      tx({ date: '2026-06-10', type: 'expense', amountCents: -3000 }),
      tx({ date: '2026-07-05', type: 'expense', amountCents: -1000 }), // hasta hoy
      tx({ date: '2026-07-25', type: 'expense', amountCents: -9000 }), // futuro, ya registrado
    ];
    // Con ctx, el actual se acota a hoy (dia 15): solo cuenta el gasto del dia 5.
    const cmp = computeComparison(txs, '2026-07-15', 1, ctxFor(txs), '2026-07-15');
    expect(cmp.currentExpenseNetCents).toBe(1000); // no incluye el gasto del dia 25
    expect(cmp.prorated).toBe(true);
    expect(cmp.daysElapsed).toBe(15);
  });

  it('el ultimo dia del mes en curso ya no prorratea (mes completo)', () => {
    const txs = [
      tx({ date: '2026-06-10', type: 'expense', amountCents: -3000 }),
      tx({ date: '2026-07-10', type: 'expense', amountCents: -2000 }),
    ];
    const cmp = computeComparison(txs, '2026-07-31', 1, undefined, '2026-07-31');
    expect(cmp.prorated).toBe(false);
    expect(cmp.daysElapsed).toBe(31);
    expect(cmp.averageComparedCents).toBe(3000);
  });
});

describe('computeForecast', () => {
  it('extrapola el ritmo del mes en curso (estimacion) sin contar dias futuros', () => {
    const txs = [
      tx({ date: '2026-07-05', type: 'expense', amountCents: -600 }),
      tx({ date: '2026-07-10', type: 'expense', amountCents: -400 }),
      tx({ date: '2026-07-20', type: 'expense', amountCents: -5000 }), // aun no ha ocurrido "hoy"
    ];
    const f = computeForecast(txs, '2026-07-01', ctxFor(txs), '2026-07-10');
    expect(f.applicable).toBe(true);
    expect(f.spentSoFarCents).toBe(1000); // solo hasta el dia 10
    expect(f.daysElapsed).toBe(10);
    expect(f.daysInMonth).toBe(31);
    expect(f.projectedExpenseCents).toBe(Math.round((1000 * 31) / 10)); // 3100
  });

  it('no aplica en un mes que no es el actual', () => {
    const txs = [tx({ date: '2026-05-15', type: 'expense', amountCents: -2000 })];
    const f = computeForecast(txs, '2026-05-10', ctxFor(txs), '2026-07-10');
    expect(f.applicable).toBe(false);
    expect(f.spentSoFarCents).toBe(2000);
    expect(f.projectedExpenseCents).toBe(2000); // sin extrapolar
    expect(f.daysElapsed).toBe(f.daysInMonth);
  });
});

describe('computeTopExpenses', () => {
  it('mayores gastos individuales; excluye ingresos, transferencias, excluidos y padre de split', () => {
    const txs = [
      tx({ id: 't1', type: 'expense', amountCents: -500, concept: 'A' }),
      tx({ id: 't2', type: 'expense', amountCents: -3000, concept: 'B' }),
      tx({ id: 't3', type: 'expense', amountCents: -1000, concept: 'C', categoryId: 'cat-food' }),
      tx({ type: 'income', amountCents: 9999 }),
      tx({ type: 'expense', amountCents: -8000, excludedFromStats: true, statsFlag: 1 }),
      tx({ id: 'p', type: 'expense', amountCents: -2500, isSplitParent: true, excludedFromStats: true, statsFlag: 1 }),
    ];
    const top = computeTopExpenses(txs, ctxFor(txs), 2);
    expect(top.map((t) => t.id)).toEqual(['t2', 't3']);
    expect(top[0]).toMatchObject({ id: 't2', amountCents: 3000, concept: 'B' });
    expect(top[1]).toMatchObject({ id: 't3', amountCents: 1000, categoryId: 'cat-food' });
  });
});

describe('computeRecurringExpenses', () => {
  it('detecta conceptos repetidos en varios meses (normalizados) y descarta los que no', () => {
    const txs = [
      tx({ date: '2026-01-03', concept: 'Netflix', amountCents: -1000 }),
      tx({ date: '2026-02-03', concept: 'NETFLIX', amountCents: -1000 }),
      tx({ date: '2026-03-03', concept: 'netflix ', amountCents: -1200 }),
      tx({ date: '2026-01-15', concept: 'Cafe', amountCents: -300 }), // un solo mes
      tx({ date: '2026-01-16', concept: 'Cafe', amountCents: -300 }), // mismo mes, no cuenta como 2 meses
      tx({ date: '2026-06-30', concept: '', amountCents: -500 }), // sin concepto: se ignora
    ];
    const rec = computeRecurringExpenses(txs, '2026-06-15', 6, 3, 8);
    expect(rec).toHaveLength(1);
    expect(rec[0]).toMatchObject({
      label: 'netflix ',
      occurrences: 3,
      months: 3,
      totalCents: 3200,
      averageCents: Math.round(3200 / 3),
      lastDate: '2026-03-03',
    });
  });

  it('ignora movimientos fuera de la ventana temporal', () => {
    const txs = [
      tx({ date: '2024-01-03', concept: 'Netflix', amountCents: -1000 }),
      tx({ date: '2024-02-03', concept: 'Netflix', amountCents: -1000 }),
      tx({ date: '2024-03-03', concept: 'Netflix', amountCents: -1000 }),
    ];
    // Ventana ancla 2026: los de 2024 quedan fuera.
    expect(computeRecurringExpenses(txs, '2026-06-15', 6, 3, 8)).toEqual([]);
  });
});

describe('reembolsos entre periodos y no resolubles', () => {
  it('atribuye un reembolso al gasto original aunque este fuera del periodo (via txById)', () => {
    const original = tx({ id: 'g', date: '2026-06-10', type: 'expense', amountCents: -5000, categoryId: 'cat-food' });
    const refund = tx({ date: '2026-07-15', type: 'income', amountCents: 2000, refundOfId: 'g', categoryId: null });
    const all = [original, refund];
    const data = computeDashboard(all, CATEGORIES, {
      range: { from: '2026-07-01', to: '2026-07-31' },
      anchorISO: '2026-07-15',
      today: '2026-07-15',
    });
    // El gasto original cae en junio; solo el reembolso esta en julio, pero se atribuye
    // a la categoria del original (cat-food), no al bucket "sin categoria".
    expect(data.summary.expenseGrossCents).toBe(0);
    expect(data.summary.refundCents).toBe(2000);
    expect(data.summary.expenseNetCents).toBe(-2000);
    expect(data.summary.incomeCents).toBe(0); // el reembolso no es ingreso
    expect(data.byCategory).toEqual([
      { categoryId: 'cat-food', grossCents: 0, refundCents: 2000, netCents: -2000 },
    ]);
  });

  it('un reembolso no resoluble cae en su propia categoria (o sin categoria)', () => {
    const refund = tx({ date: '2026-07-15', type: 'income', amountCents: 1500, refundOfId: 'inexistente', categoryId: null });
    const { summary, byCategory } = aggregatePeriod([refund], ctxFor([refund]));
    expect(summary.refundCents).toBe(1500);
    expect(summary.incomeCents).toBe(0);
    expect(byCategory).toEqual([{ categoryId: null, grossCents: 0, refundCents: 1500, netCents: -1500 }]);
  });

  it('ordena por neto aunque una categoria quede negativa por reembolsos', () => {
    const original = tx({ id: 'g', type: 'expense', amountCents: -1000, categoryId: 'cat-food' });
    const txs = [
      original,
      tx({ type: 'income', amountCents: 3000, refundOfId: 'g', categoryId: null }), // reembolso > gasto
      tx({ type: 'expense', amountCents: -500, categoryId: 'cat-ocio' }),
    ];
    const { byCategory } = aggregatePeriod(txs, ctxFor(txs));
    // cat-food neto = 1000 - 3000 = -2000; cat-ocio = 500. Orden por neto desc.
    expect(byCategory.map((c) => c.categoryId)).toEqual(['cat-ocio', 'cat-food']);
    expect(byCategory.find((c) => c.categoryId === 'cat-food')!.netCents).toBe(-2000);
  });
});

describe('computeComparison - mes previo neutralizado por reembolso', () => {
  it('un mes con gasto y reembolso que se anulan (neto 0) no cuenta como activo', () => {
    const txs = [
      tx({ date: '2026-01-10', type: 'expense', amountCents: -1000 }),
      // Febrero: gasto y reembolso se anulan -> neto 0, ingreso 0 -> mes inactivo
      tx({ id: 'gf', date: '2026-02-10', type: 'expense', amountCents: -1000 }),
      tx({ date: '2026-02-20', type: 'income', amountCents: 1000, refundOfId: 'gf' }),
      tx({ date: '2026-03-10', type: 'expense', amountCents: -500 }),
    ];
    const cmp = computeComparison(txs, '2026-03-15', 2, undefined, '2026-07-10');
    // Solo enero cuenta como mes anterior con actividad.
    expect(cmp.monthsCompared).toBe(1);
    expect(cmp.averageExpenseNetCents).toBe(1000);
  });
});

describe('computeForecast - meses cortos y neto negativo', () => {
  it('extrapola correctamente en febrero bisiesto (29 dias)', () => {
    const txs = [tx({ date: '2024-02-05', type: 'expense', amountCents: -1000 })];
    const f = computeForecast(txs, '2024-02-01', ctxFor(txs), '2024-02-10');
    expect(f.daysInMonth).toBe(29);
    expect(f.daysElapsed).toBe(10);
    expect(f.projectedExpenseCents).toBe(Math.round((1000 * 29) / 10)); // 2900
  });

  it('proyecta un gasto neto negativo si se ha reembolsado mas de lo gastado', () => {
    const original = tx({ id: 'g', date: '2024-02-03', type: 'expense', amountCents: -500, categoryId: 'cat-food' });
    const refund = tx({ date: '2024-02-08', type: 'income', amountCents: 1500, refundOfId: 'g', categoryId: null });
    const f = computeForecast([original, refund], '2024-02-01', ctxFor([original, refund]), '2024-02-10');
    expect(f.spentSoFarCents).toBe(-1000); // 500 - 1500
    expect(f.projectedExpenseCents).toBe(Math.round((-1000 * 29) / 10)); // -2900
  });
});

describe('monthKeysEndingAt - bordes', () => {
  it('con count 1 devuelve solo el mes ancla', () => {
    expect(monthKeysEndingAt('2026-07-15', 1)).toEqual(['2026-07']);
  });
  it('cruza varios anos hacia atras en ventanas largas', () => {
    const keys = monthKeysEndingAt('2026-02-15', 15);
    expect(keys).toHaveLength(15);
    expect(keys[0]).toBe('2024-12');
    expect(keys[keys.length - 1]).toBe('2026-02');
  });
});

describe('computeDashboard (orquestador puro)', () => {
  it('marca hasData=false en un periodo sin movimientos que cuenten', () => {
    const txs = [tx({ date: '2026-07-10', type: 'transfer', amountCents: -1000, excludedFromStats: true, statsFlag: 1 })];
    const data = computeDashboard(txs, CATEGORIES, {
      range: { from: '2026-07-01', to: '2026-07-31' },
      anchorISO: '2026-07-15',
      today: '2026-07-15',
    });
    expect(data.hasData).toBe(false);
    expect(data.summary.expenseGrossCents).toBe(0);
    expect(data.anchorMonth).toBe('2026-07');
  });

  it('solo agrega los movimientos dentro del rango del periodo seleccionado', () => {
    const txs = [
      tx({ date: '2026-07-10', type: 'expense', amountCents: -1000 }),
      tx({ date: '2026-08-10', type: 'expense', amountCents: -5000 }), // fuera del periodo
    ];
    const data = computeDashboard(txs, CATEGORIES, {
      range: { from: '2026-07-01', to: '2026-07-31' },
      anchorISO: '2026-07-15',
      today: '2026-07-15',
    });
    expect(data.hasData).toBe(true);
    expect(data.summary.expenseGrossCents).toBe(1000);
  });
});

// --- Reclasificacion de movimientos de ahorro (categoria "Ahorros") ---
describe('categorias de ahorro', () => {
  it('computeSavingsCategoryIds detecta la raiz por nombre y arrastra sus subcategorias', () => {
    const ids = computeSavingsCategoryIds(CATEGORIES);
    expect(ids.has('cat-ahorro')).toBe(true); // "Ahorros" por nombre
    expect(ids.has('sub-fondo')).toBe(true); // subcategoria de una de ahorro
    expect(ids.has('cat-food')).toBe(false);
    expect(ids.has('cat-ocio')).toBe(false);
  });

  it('reconoce el nombre sin distinguir mayusculas ni acentos, en singular o plural', () => {
    const cats: Category[] = [
      { ...CATEGORIES[0]!, id: 'a', name: 'AHÓRRO' },
      { ...CATEGORIES[0]!, id: 'b', name: 'ahorros' },
      { ...CATEGORIES[0]!, id: 'c', name: 'Ahorro para el coche' }, // NO coincide (no es exactamente ahorro/ahorros)
    ];
    const ids = computeSavingsCategoryIds(cats);
    expect(ids.has('a')).toBe(true);
    expect(ids.has('b')).toBe(true);
    expect(ids.has('c')).toBe(false);
  });

  it('isSavingsMovement solo marca gastos de una categoria de ahorro', () => {
    const ctx = ctxFor([]);
    expect(isSavingsMovement(tx({ type: 'expense', categoryId: 'cat-ahorro' }), ctx)).toBe(true);
    expect(isSavingsMovement(tx({ type: 'expense', subcategoryId: 'sub-fondo' }), ctx)).toBe(true);
    expect(isSavingsMovement(tx({ type: 'expense', categoryId: 'cat-food' }), ctx)).toBe(false);
    // Un ingreso a una categoria de ahorro sigue siendo ingreso normal.
    expect(isSavingsMovement(tx({ type: 'income', amountCents: 1000, categoryId: 'cat-ahorro' }), ctx)).toBe(false);
  });

  it('un gasto a Ahorros no cuenta como gasto: sube el ahorro neto y se contabiliza aparte', () => {
    const txs = [
      tx({ type: 'income', amountCents: 200000 }),
      tx({ type: 'expense', amountCents: -3000, categoryId: 'cat-food' }),
      tx({ type: 'expense', amountCents: -50000, categoryId: 'cat-ahorro' }), // aportacion a ahorro
      tx({ type: 'expense', amountCents: -2000, subcategoryId: 'sub-fondo' }), // sub de ahorro
    ];
    const { summary, byCategory } = aggregatePeriod(txs, ctxFor(txs));
    // Solo el gasto de alimentacion cuenta como gasto.
    expect(summary.expenseGrossCents).toBe(3000);
    expect(summary.expenseNetCents).toBe(3000);
    expect(summary.savingsContribCents).toBe(52000); // 50000 + 2000
    // Ahorro neto = ingresos - gasto neto = 200000 - 3000 (el ahorro no resta).
    expect(summary.netSavingsCents).toBe(197000);
    // El desglose por categoria no incluye las de ahorro.
    expect(byCategory.map((c) => c.categoryId)).toEqual(['cat-food']);
  });

  it('isInvestmentMovement solo marca gastos de una categoria de inversion', () => {
    const ctx = ctxFor([]);
    expect(isInvestmentMovement(tx({ type: 'expense', categoryId: 'cat-invers' }), ctx)).toBe(true);
    expect(isInvestmentMovement(tx({ type: 'expense', subcategoryId: 'sub-indexado' }), ctx)).toBe(true);
    expect(isInvestmentMovement(tx({ type: 'expense', categoryId: 'cat-ahorro' }), ctx)).toBe(false);
    expect(isInvestmentMovement(tx({ type: 'expense', categoryId: 'cat-food' }), ctx)).toBe(false);
    // Un ingreso a una categoria de inversion sigue siendo ingreso normal.
    expect(isInvestmentMovement(tx({ type: 'income', amountCents: 1000, categoryId: 'cat-invers' }), ctx)).toBe(false);
  });

  it('un gasto a Inversiones no cuenta como gasto: sube el ahorro neto y se contabiliza en su metrica separada', () => {
    const txs = [
      tx({ type: 'income', amountCents: 200000 }),
      tx({ type: 'expense', amountCents: -3000, categoryId: 'cat-food' }),
      tx({ type: 'expense', amountCents: -50000, categoryId: 'cat-ahorro' }), // ahorro
      tx({ type: 'expense', amountCents: -40000, categoryId: 'cat-invers' }), // inversion
      tx({ type: 'expense', amountCents: -1000, subcategoryId: 'sub-indexado' }), // sub de inversion
    ];
    const { summary, byCategory } = aggregatePeriod(txs, ctxFor(txs));
    // Ni ahorro ni inversion cuentan como gasto.
    expect(summary.expenseGrossCents).toBe(3000);
    expect(summary.expenseNetCents).toBe(3000);
    // Ahorro e inversion viven en metricas distintas.
    expect(summary.savingsContribCents).toBe(50000);
    expect(summary.investmentContribCents).toBe(41000); // 40000 + 1000
    // El dinero invertido tampoco resta del ahorro neto (no es consumo).
    expect(summary.netSavingsCents).toBe(197000);
    // El desglose por categoria no incluye ahorro ni inversion.
    expect(byCategory.map((c) => c.categoryId)).toEqual(['cat-food']);
  });

  it('la retirada (reembolso) de una aportacion a inversion no toca gasto ni ingreso y deja investmentContrib negativo', () => {
    const original = tx({ id: 'inv', type: 'expense', amountCents: -40000, categoryId: 'cat-invers' });
    const withdrawal = tx({ type: 'income', amountCents: 15000, refundOfId: 'inv', categoryId: null });
    const ctx = buildStatsContext(CATEGORIES, [original, withdrawal]);
    const { summary } = aggregatePeriod([withdrawal], ctx);
    expect(summary.expenseNetCents).toBe(0); // no reduce gasto
    expect(summary.incomeCents).toBe(0); // no es ingreso
    expect(summary.refundCents).toBe(0); // no es un reembolso de gasto
    expect(summary.investmentContribCents).toBe(-15000); // retirada neta de inversion
    expect(summary.savingsContribCents).toBe(0); // el ahorro no se ve afectado
  });

  it('la retirada (reembolso) de una aportacion a ahorro no toca gasto ni ingreso y deja savingsContrib negativo', () => {
    const original = tx({ id: 'ap', type: 'expense', amountCents: -50000, categoryId: 'cat-ahorro' });
    // Solo la retirada cae en el periodo (la aportacion es de otro mes, resoluble via txById).
    const withdrawal = tx({ type: 'income', amountCents: 20000, refundOfId: 'ap', categoryId: null });
    const ctx = buildStatsContext(CATEGORIES, [original, withdrawal]);
    const { summary } = aggregatePeriod([withdrawal], ctx);
    expect(summary.expenseNetCents).toBe(0); // no reduce gasto
    expect(summary.incomeCents).toBe(0); // no es ingreso
    expect(summary.refundCents).toBe(0); // no es un reembolso de gasto
    expect(summary.savingsContribCents).toBe(-20000); // retirada neta de ahorro
  });

  it('no aparece en top gastos, recurrentes ni evolucion mensual', () => {
    const txs = [
      tx({ date: '2026-07-03', type: 'expense', amountCents: -50000, concept: 'Traspaso ahorro', categoryId: 'cat-ahorro' }),
      tx({ date: '2026-08-03', type: 'expense', amountCents: -50000, concept: 'Traspaso ahorro', categoryId: 'cat-ahorro' }),
      tx({ date: '2026-09-03', type: 'expense', amountCents: -50000, concept: 'Traspaso ahorro', categoryId: 'cat-ahorro' }),
      tx({ date: '2026-09-04', type: 'expense', amountCents: -1000, concept: 'Cafe', categoryId: 'cat-food' }),
    ];
    const ctx = ctxFor(txs);
    const top = computeTopExpenses(txs.filter((t) => t.date.startsWith('2026-09')), ctx, 5);
    expect(top.map((t) => t.categoryId)).toEqual(['cat-food']); // el ahorro no esta
    const rec = computeRecurringExpenses(txs, '2026-09-15', 6, 3, 8, ctx);
    expect(rec).toEqual([]); // el traspaso mensual a ahorro no es un gasto recurrente
    const series = computeMonthlyEvolution(txs, '2026-09-15', 1, ctx);
    expect(series[0]!.expenseNetCents).toBe(1000); // solo el cafe, no la aportacion a ahorro
  });
});

// --- Analitica de ahorro e inversion ---
describe('computeSavingsInvestment', () => {
  it('ventana vacia: rejilla completa a cero, sin mejores meses ni rachas', () => {
    const a = computeSavingsInvestment([], '2026-07-15', 3, ctxFor([]));
    expect(a.months.map((m) => m.month)).toEqual(['2026-05', '2026-06', '2026-07']);
    expect(a.months.every((m) => m.savingsContribCents === 0 && m.netSavingsCents === 0)).toBe(true);
    expect(a.totalNetSavingsCents).toBe(0);
    expect(a.overallSavingsRatePerMille).toBeNull(); // sin ingresos: no divide por cero
    expect(a.activeMonths).toBe(0);
    expect(a.avgNetSavingsCents).toBe(0);
    expect(a.bestNetSavingsMonth).toBeNull();
    expect(a.bestInvestmentMonth).toBeNull();
    expect(a.bestSavingsRateMonth).toBeNull();
    expect(a.currentStreakMonths).toBe(0);
    expect(a.longestStreakMonths).toBe(0);
    expect(a.hasAnyContrib).toBe(false);
  });

  it('rechaza una ventana de menos de 1 mes (contrato explicito)', () => {
    expect(() => computeSavingsInvestment([], '2026-07-15', 0, ctxFor([]))).toThrow();
    expect(() => computeSavingsInvestment([], '2026-07-15', -3, ctxFor([]))).toThrow();
  });

  it('serie mensual con aportaciones, acumulados y acumulado historico fuera de ventana', () => {
    const txs = [
      // Fuera de la ventana (enero): solo cuenta en el acumulado historico.
      tx({ date: '2026-01-10', type: 'expense', amountCents: -10000, categoryId: 'cat-ahorro' }),
      // Junio: nomina, gasto, aportacion a ahorro y a inversion.
      tx({ date: '2026-06-01', type: 'income', amountCents: 200000 }),
      tx({ date: '2026-06-05', type: 'expense', amountCents: -50000, categoryId: 'cat-food' }),
      tx({ date: '2026-06-10', type: 'expense', amountCents: -30000, categoryId: 'cat-ahorro' }),
      tx({ date: '2026-06-15', type: 'expense', amountCents: -20000, categoryId: 'cat-invers' }),
      // Julio: solo inversion (sub de inversion).
      tx({ date: '2026-07-03', type: 'expense', amountCents: -15000, subcategoryId: 'sub-indexado' }),
    ];
    const a = computeSavingsInvestment(txs, '2026-07-15', 2, ctxFor(txs));
    expect(a.months).toHaveLength(2);
    const [jun, jul] = a.months;
    expect(jun).toMatchObject({
      month: '2026-06',
      incomeCents: 200000,
      netSavingsCents: 150000, // 200000 - 50000 (ahorro e inversion no son gasto)
      savingsContribCents: 30000,
      investmentContribCents: 20000,
      cumulativeSavingsContribCents: 30000,
      cumulativeInvestmentContribCents: 20000,
      savingsRatePerMille: 750,
    });
    expect(jul).toMatchObject({
      month: '2026-07',
      incomeCents: 0,
      netSavingsCents: 0,
      savingsContribCents: 0,
      investmentContribCents: 15000,
      cumulativeSavingsContribCents: 30000, // acumulado de la ventana, no incluye enero
      cumulativeInvestmentContribCents: 35000,
      savingsRatePerMille: null,
    });
    // Totales de la ventana.
    expect(a.totalIncomeCents).toBe(200000);
    expect(a.totalNetSavingsCents).toBe(150000);
    expect(a.totalSavingsContribCents).toBe(30000);
    expect(a.totalInvestmentContribCents).toBe(35000);
    expect(a.overallSavingsRatePerMille).toBe(750);
    // Acumulado historico: SI incluye la aportacion de enero.
    expect(a.allTimeSavingsContribCents).toBe(40000);
    expect(a.allTimeInvestmentContribCents).toBe(35000);
    expect(a.hasAnyContrib).toBe(true);
    // Mejores meses.
    expect(a.bestNetSavingsMonth).toEqual({ month: '2026-06', cents: 150000 });
    expect(a.bestInvestmentMonth).toEqual({ month: '2026-06', cents: 20000 });
    expect(a.bestSavingsRateMonth).toEqual({ month: '2026-06', perMille: 750 });
    // Medias sobre meses activos (junio y julio: julio tiene aportacion, es activo).
    expect(a.activeMonths).toBe(2);
    expect(a.avgNetSavingsCents).toBe(75000);
    expect(a.avgInvestmentContribCents).toBe(Math.round(35000 / 2));
  });

  it('una retirada (reembolso de aportacion) deja el mes y los acumulados en negativo', () => {
    const original = tx({ id: 'ap', date: '2026-05-10', type: 'expense', amountCents: -10000, categoryId: 'cat-ahorro' });
    const withdrawal = tx({ date: '2026-06-10', type: 'income', amountCents: 25000, refundOfId: 'ap', categoryId: null });
    const txs = [original, withdrawal];
    const a = computeSavingsInvestment(txs, '2026-06-15', 2, ctxFor(txs));
    const [may, jun] = a.months;
    expect(may!.savingsContribCents).toBe(10000);
    expect(jun!.savingsContribCents).toBe(-25000); // retirada neta del mes
    expect(jun!.cumulativeSavingsContribCents).toBe(-15000);
    expect(jun!.incomeCents).toBe(0); // la retirada no es ingreso
    expect(a.allTimeSavingsContribCents).toBe(-15000);
    expect(a.hasAnyContrib).toBe(true); // hubo movimiento de ahorro, aunque el neto sea negativo
  });

  it('rachas: consecutivos con ahorro neto positivo; el ultimo mes sin actividad no rompe la racha actual', () => {
    const txs = [
      tx({ date: '2026-02-10', type: 'income', amountCents: 1000 }), // feb +
      tx({ date: '2026-03-10', type: 'income', amountCents: 1000 }), // mar +
      tx({ date: '2026-04-10', type: 'expense', amountCents: -500 }), // abr - (rompe)
      tx({ date: '2026-05-10', type: 'income', amountCents: 1000 }), // may +
      tx({ date: '2026-06-10', type: 'income', amountCents: 1000 }), // jun +
      // jul: sin actividad (mes recien empezado)
    ];
    const a = computeSavingsInvestment(txs, '2026-07-15', 6, ctxFor(txs));
    expect(a.longestStreakMonths).toBe(2);
    expect(a.currentStreakMonths).toBe(2); // may+jun; jul vacio no la rompe
  });

  it('un ultimo mes ACTIVO con ahorro negativo si rompe la racha actual', () => {
    const txs = [
      tx({ date: '2026-05-10', type: 'income', amountCents: 1000 }),
      tx({ date: '2026-06-10', type: 'income', amountCents: 1000 }),
      tx({ date: '2026-07-05', type: 'expense', amountCents: -500 }), // julio activo y negativo
    ];
    const a = computeSavingsInvestment(txs, '2026-07-15', 6, ctxFor(txs));
    expect(a.currentStreakMonths).toBe(0);
    expect(a.longestStreakMonths).toBe(2);
  });

  it('ignora movimientos excluidos y transferencias (no cuentan como aportacion)', () => {
    const txs = [
      tx({ date: '2026-07-05', type: 'transfer', amountCents: -30000, excludedFromStats: true, statsFlag: 1 }),
      tx({ date: '2026-07-06', type: 'expense', amountCents: -9999, categoryId: 'cat-ahorro', excludedFromStats: true, statsFlag: 1 }),
    ];
    const a = computeSavingsInvestment(txs, '2026-07-15', 1, ctxFor(txs));
    expect(a.totalSavingsContribCents).toBe(0);
    expect(a.allTimeSavingsContribCents).toBe(0);
    expect(a.hasAnyContrib).toBe(false);
    expect(a.activeMonths).toBe(0);
  });

  it('computeDashboard incluye la analitica SIN filtro cruzado (no se queda a cero al filtrar)', () => {
    const txs = [
      tx({ date: '2026-07-05', type: 'expense', amountCents: -3000, categoryId: 'cat-food' }),
      tx({ date: '2026-07-10', type: 'expense', amountCents: -20000, categoryId: 'cat-ahorro' }),
      tx({ date: '2026-07-11', type: 'income', amountCents: 100000 }),
    ];
    const data = computeDashboard(txs, CATEGORIES, {
      range: { from: '2026-07-01', to: '2026-07-31' },
      anchorISO: '2026-07-15',
      today: '2026-07-15',
      filter: { categoryId: 'cat-food' }, // filtro cruzado activo
    });
    // La analitica de ahorro ignora el filtro: sigue viendo la aportacion y los ingresos.
    expect(data.savingsInvestment.totalSavingsContribCents).toBe(20000);
    expect(data.savingsInvestment.totalIncomeCents).toBe(100000);
  });
});

// --- Filtro cruzado por categoria ---
describe('computeDashboard - filtro cruzado por categoria', () => {
  const txs = [
    tx({ date: '2026-07-05', type: 'expense', amountCents: -3000, categoryId: 'cat-food' }),
    tx({ date: '2026-07-06', type: 'expense', amountCents: -1000, categoryId: 'cat-food', subcategoryId: 'sub-super' }),
    tx({ date: '2026-07-07', type: 'expense', amountCents: -2500, categoryId: 'cat-ocio' }),
    tx({ date: '2026-07-08', type: 'income', amountCents: 100000, categoryId: null }),
  ];
  const base = { range: { from: '2026-07-01', to: '2026-07-31' }, anchorISO: '2026-07-15', today: '2026-07-15' };

  it('sin filtro agrega todo el periodo', () => {
    const data = computeDashboard(txs, CATEGORIES, base);
    expect(data.filter).toBeNull();
    expect(data.summary.expenseNetCents).toBe(6500); // 3000 + 1000 + 2500
    expect(data.summary.incomeCents).toBe(100000);
  });

  it('con filtro de categoria acota el resumen y el top pero deja el desglose completo', () => {
    const data = computeDashboard(txs, CATEGORIES, { ...base, filter: { categoryId: 'cat-food' } });
    expect(data.filter).toEqual({ categoryId: 'cat-food' });
    // Resumen filtrado: solo Alimentacion (raiz + sub) = 4000; ingresos 0 (el ingreso no es de esa categoria).
    expect(data.summary.expenseNetCents).toBe(4000);
    expect(data.summary.incomeCents).toBe(0);
    expect(data.topExpenses.every((t) => t.categoryId === 'cat-food')).toBe(true);
    // El desglose por categoria sigue completo (es el control del filtro).
    expect(data.byCategory.map((c) => c.categoryId).sort()).toEqual(['cat-food', 'cat-ocio']);
    // hasData mira el periodo completo, no el filtro.
    expect(data.hasData).toBe(true);
  });
});

// --- Aislamiento por perfil (integracion con la base de datos) ---
describe('statsService.computeDashboard - aislamiento por perfil', () => {
  const A = 'perfil-a';
  const B = 'perfil-b';

  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
  });

  function txInput(overrides: Partial<NewTransaction> = {}): NewTransaction {
    return {
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
      importBatchId: null,
      dedupeHash: `h-${crypto.randomUUID()}`,
      ...overrides,
    };
  }

  it('el dashboard de un perfil no incluye datos de otro', async () => {
    // Cada perfil necesita su propia cuenta/categoria (aislamiento del modelo).
    const accA = await accountService.createAccount(A, { name: 'Banco', kind: 'bank', openingBalanceCents: 0 });
    const accB = await accountService.createAccount(B, { name: 'Banco', kind: 'bank', openingBalanceCents: 0 });
    await transactionsRepo.create(A, txInput({ accountId: accA.id, amountCents: -1000, type: 'expense' }));
    await transactionsRepo.create(A, txInput({ accountId: accA.id, amountCents: 300000, type: 'income' }));
    await transactionsRepo.create(B, txInput({ accountId: accB.id, amountCents: -5000, type: 'expense' }));

    const params = {
      range: { from: '2026-07-01', to: '2026-07-31' },
      anchorISO: '2026-07-15',
      today: '2026-07-15',
    };
    const dataA = await statsService.computeDashboard(A, params);
    const dataB = await statsService.computeDashboard(B, params);

    expect(dataA.summary.expenseGrossCents).toBe(1000); // no ve el gasto de B (5000)
    expect(dataA.summary.incomeCents).toBe(300000);
    expect(dataB.summary.expenseGrossCents).toBe(5000);
    expect(dataB.summary.incomeCents).toBe(0);
  });

  it('exige profileId (barrera de aislamiento)', async () => {
    await expect(
      statsService.computeDashboard('', {
        range: { from: '2026-07-01', to: '2026-07-31' },
        anchorISO: '2026-07-15',
      }),
    ).rejects.toThrow();
  });
});
