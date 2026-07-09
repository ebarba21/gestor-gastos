import { describe, it, expect } from 'vitest';
import type { Category, Transaction } from '../db/schema';
import {
  buildStatsContext,
  computeConsumption,
  countsInStats,
  expenseMagnitude,
  inScope,
  isRefund,
} from './statsService';

// Factoria de movimientos para tests puros (sin base de datos). Valores por defecto de un
// gasto normal que cuenta en estadisticas.
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

// Jerarquia: Alimentacion (raiz) -> Supermercado (sub). Ocio (raiz) suelta.
const CATEGORIES: Category[] = [
  {
    id: 'cat-food',
    profileId: 'perfil-a',
    name: 'Alimentacion',
    parentId: null,
    kind: 'expense',
    color: null,
    icon: null,
    archivedAt: null,
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'sub-super',
    profileId: 'perfil-a',
    name: 'Supermercado',
    parentId: 'cat-food',
    kind: 'expense',
    color: null,
    icon: null,
    archivedAt: null,
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'cat-ocio',
    profileId: 'perfil-a',
    name: 'Ocio',
    parentId: null,
    kind: 'expense',
    color: null,
    icon: null,
    archivedAt: null,
    sortOrder: 1,
    createdAt: 0,
    updatedAt: 0,
  },
];

function ctxFor(txs: Transaction[]) {
  return buildStatsContext(CATEGORIES, txs);
}

describe('predicados base', () => {
  it('countsInStats sigue a excludedFromStats', () => {
    expect(countsInStats(tx({ excludedFromStats: false }))).toBe(true);
    expect(countsInStats(tx({ excludedFromStats: true }))).toBe(false);
  });

  it('isRefund solo para movimientos con refundOfId que no sean gasto', () => {
    expect(isRefund(tx({ type: 'income', amountCents: 500, refundOfId: 'x' }))).toBe(true);
    expect(isRefund(tx({ refundOfId: null }))).toBe(false);
    // Un gasto con refundOfId no se interpreta como reduccion (se cuenta como gasto).
    expect(isRefund(tx({ type: 'expense', refundOfId: 'x' }))).toBe(false);
  });

  it('expenseMagnitude devuelve magnitud positiva solo para gastos', () => {
    expect(expenseMagnitude(tx({ type: 'expense', amountCents: -1500 }))).toBe(1500);
    expect(expenseMagnitude(tx({ type: 'income', amountCents: 1500 }))).toBe(0);
  });
});

describe('computeConsumption - direccion gasto (overall)', () => {
  it('suma gastos y excluye ingresos, transferencias y excluidos', () => {
    const txs = [
      tx({ type: 'expense', amountCents: -1000 }),
      tx({ type: 'expense', amountCents: -2500 }),
      tx({ type: 'income', amountCents: 5000 }), // no cuenta en gasto
      tx({ type: 'transfer', amountCents: -3000, excludedFromStats: true }), // excluida
      tx({ type: 'expense', amountCents: -9999, excludedFromStats: true }), // excluido manual
    ];
    const c = computeConsumption(txs, 'overall', null, 'expense', ctxFor(txs));
    expect(c.grossCents).toBe(3500);
    expect(c.refundCents).toBe(0);
    expect(c.consumedCents).toBe(3500);
  });

  it('sin datos, consumo cero', () => {
    const c = computeConsumption([], 'overall', null, 'expense', ctxFor([]));
    expect(c).toEqual({ grossCents: 0, refundCents: 0, consumedCents: 0 });
  });
});

describe('computeConsumption - splits', () => {
  it('cuenta las lineas hijas y no el padre (excluido)', () => {
    const parent = tx({
      id: 'p',
      type: 'expense',
      amountCents: -3000,
      isSplitParent: true,
      excludedFromStats: true,
      categoryId: 'cat-ocio',
    });
    const child1 = tx({
      type: 'expense',
      amountCents: -2000,
      parentId: 'p',
      categoryId: 'cat-food',
    });
    const child2 = tx({
      type: 'expense',
      amountCents: -1000,
      parentId: 'p',
      categoryId: 'cat-ocio',
    });
    const txs = [parent, child1, child2];
    const ctx = ctxFor(txs);

    // Overall: 3000 (solo hijas; el padre esta excluido).
    expect(computeConsumption(txs, 'overall', null, 'expense', ctx).consumedCents).toBe(3000);
    // Categoria Alimentacion: solo la hija 1.
    expect(computeConsumption(txs, 'category', 'cat-food', 'expense', ctx).consumedCents).toBe(2000);
    // Categoria Ocio: solo la hija 2 (el padre excluido no cuenta pese a tener categoria Ocio).
    expect(computeConsumption(txs, 'category', 'cat-ocio', 'expense', ctx).consumedCents).toBe(1000);
  });
});

describe('computeConsumption - reembolsos', () => {
  it('reduce el gasto neto de la categoria del gasto original', () => {
    const original = tx({
      id: 'gasto-super',
      type: 'expense',
      amountCents: -5000,
      categoryId: 'sub-super',
    });
    // Reembolso enlazado, SIN categoria propia: debe atribuirse a la del original (sub-super).
    const refund = tx({
      type: 'income',
      amountCents: 2000,
      refundOfId: 'gasto-super',
      categoryId: null,
    });
    const txs = [original, refund];
    const ctx = ctxFor(txs);

    // Subcategoria Supermercado: 5000 - 2000 = 3000.
    const sub = computeConsumption(txs, 'subcategory', 'sub-super', 'expense', ctx);
    expect(sub.grossCents).toBe(5000);
    expect(sub.refundCents).toBe(2000);
    expect(sub.consumedCents).toBe(3000);

    // Categoria raiz Alimentacion: acumula la subcategoria. Tambien 3000.
    expect(computeConsumption(txs, 'category', 'cat-food', 'expense', ctx).consumedCents).toBe(3000);

    // Overall: 5000 - 2000 = 3000.
    expect(computeConsumption(txs, 'overall', null, 'expense', ctx).consumedCents).toBe(3000);
  });

  it('no atribuye el reembolso a una categoria distinta de la del original', () => {
    const original = tx({ id: 'g', type: 'expense', amountCents: -5000, categoryId: 'cat-ocio' });
    const refund = tx({ type: 'income', amountCents: 2000, refundOfId: 'g', categoryId: null });
    const txs = [original, refund];
    const ctx = ctxFor(txs);
    // Alimentacion no se ve afectada por un reembolso de Ocio.
    expect(computeConsumption(txs, 'category', 'cat-food', 'expense', ctx).consumedCents).toBe(0);
    // Ocio: 5000 - 2000.
    expect(computeConsumption(txs, 'category', 'cat-ocio', 'expense', ctx).consumedCents).toBe(3000);
  });

  it('el reembolso NO se cuenta como ingreso', () => {
    const salary = tx({ type: 'income', amountCents: 200000, categoryId: null });
    const refund = tx({ type: 'income', amountCents: 2000, refundOfId: 'g', categoryId: null });
    const txs = [salary, refund];
    const ctx = ctxFor(txs);
    // Ingreso global: solo la nomina, no el reembolso.
    expect(computeConsumption(txs, 'overall', null, 'income', ctx).consumedCents).toBe(200000);
  });

  it('cae a la categoria propia del reembolso si el original no es resoluble', () => {
    // refundOfId apunta a un id inexistente en el conjunto: se usa la categoria propia.
    const refund = tx({
      type: 'income',
      amountCents: 2000,
      refundOfId: 'inexistente',
      categoryId: 'cat-ocio',
    });
    const txs = [refund];
    const ctx = ctxFor(txs);
    expect(computeConsumption(txs, 'category', 'cat-ocio', 'expense', ctx).refundCents).toBe(2000);
  });
});

describe('computeConsumption - direccion ingreso', () => {
  it('suma ingresos del ambito y excluye gastos y reembolsos', () => {
    const txs = [
      tx({ type: 'income', amountCents: 150000, accountId: 'acc-1' }),
      tx({ type: 'income', amountCents: 50000, accountId: 'acc-2' }),
      tx({ type: 'expense', amountCents: -3000, accountId: 'acc-1' }),
      tx({ type: 'income', amountCents: 999, refundOfId: 'g', accountId: 'acc-1' }), // reembolso
    ];
    const ctx = ctxFor(txs);
    // Objetivo de ingreso en la cuenta acc-1: solo la nomina de acc-1.
    expect(computeConsumption(txs, 'account', 'acc-1', 'income', ctx).consumedCents).toBe(150000);
    // Objetivo global de ingreso: ambas nominas, sin reembolso.
    expect(computeConsumption(txs, 'overall', null, 'income', ctx).consumedCents).toBe(200000);
  });
});

describe('inScope - ambito de cuenta usa la cuenta fisica', () => {
  it('coincide por accountId', () => {
    const t = tx({ accountId: 'acc-9' });
    const ctx = ctxFor([t]);
    expect(inScope(t, 'account', 'acc-9', ctx, false)).toBe(true);
    expect(inScope(t, 'account', 'acc-1', ctx, false)).toBe(false);
  });
});
