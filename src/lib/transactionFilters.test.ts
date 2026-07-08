import { describe, it, expect } from 'vitest';
import { filterTransactions, sortTransactions } from './transactionFilters';
import type { Transaction } from '../db/schema';

// Fabrica un movimiento completo con valores por defecto sobrescribibles.
function tx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    profileId: 'A',
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
    statsFlag: 0,
    importBatchId: null,
    dedupeHash: 'h',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('filterTransactions', () => {
  it('busca en concepto y notas sin acentos ni mayusculas', () => {
    const list = [
      tx({ concept: 'MERCADÓNA centro' }),
      tx({ concept: 'Gasolinera', notes: 'pago con tarjeta' }),
      tx({ concept: 'Farmacia' }),
    ];
    expect(filterTransactions(list, { search: 'mercadona' })).toHaveLength(1);
    expect(filterTransactions(list, { search: 'TARJETA' })).toHaveLength(1);
    expect(filterTransactions(list, { search: 'zzz' })).toHaveLength(0);
  });

  it('filtra por cuenta, tipo, estado y categoria', () => {
    const list = [
      tx({ accountId: 'a1', type: 'expense', status: 'cleared', categoryId: 'c1' }),
      tx({ accountId: 'a2', type: 'income', status: 'pending', categoryId: 'c2' }),
    ];
    expect(filterTransactions(list, { accountIds: ['a1'] })).toHaveLength(1);
    expect(filterTransactions(list, { types: ['income'] })).toHaveLength(1);
    expect(filterTransactions(list, { statuses: ['pending'] })).toHaveLength(1);
    expect(filterTransactions(list, { categoryIds: ['c1'] })).toHaveLength(1);
    expect(filterTransactions(list, { categoryIds: ['c1', 'c2'] })).toHaveLength(2);
  });

  it('filtra por etiquetas (alguna coincide)', () => {
    const list = [tx({ tagIds: ['t1', 't2'] }), tx({ tagIds: ['t3'] }), tx({ tagIds: [] })];
    expect(filterTransactions(list, { tagIds: ['t2'] })).toHaveLength(1);
    expect(filterTransactions(list, { tagIds: ['t1', 't3'] })).toHaveLength(2);
  });

  it('filtra por rango de fechas (inclusive) y de importe con signo', () => {
    const list = [
      tx({ date: '2026-01-01', amountCents: -500 }),
      tx({ date: '2026-01-15', amountCents: -1500 }),
      tx({ date: '2026-02-01', amountCents: 2000 }),
    ];
    expect(
      filterTransactions(list, { dateFrom: '2026-01-01', dateTo: '2026-01-31' }),
    ).toHaveLength(2);
    // importes entre -1000 y +100000 (excluye el -1500)
    expect(filterTransactions(list, { amountMinCents: -1000 })).toHaveLength(2);
    expect(filterTransactions(list, { amountMaxCents: -1000 })).toHaveLength(1);
  });

  it('filtra por exclusion de estadisticas y por sin categoria', () => {
    const list = [
      tx({ excludedFromStats: true, categoryId: 'c1' }),
      tx({ excludedFromStats: false, categoryId: null }),
    ];
    expect(filterTransactions(list, { excluded: 'only' })).toHaveLength(1);
    expect(filterTransactions(list, { excluded: 'exclude' })).toHaveLength(1);
    expect(filterTransactions(list, { onlyUncategorized: true })).toHaveLength(1);
  });

  it('oculta lineas hijas de split cuando se pide', () => {
    const list = [tx({ id: 'p', isSplitParent: true }), tx({ id: 'c', parentId: 'p' })];
    expect(filterTransactions(list, { hideSplitChildren: true })).toHaveLength(1);
    expect(filterTransactions(list, { hideSplitChildren: true })[0]?.id).toBe('p');
  });

  it('combina varios criterios (AND entre campos)', () => {
    const list = [
      tx({ accountId: 'a1', type: 'expense', concept: 'Bar Pepe' }),
      tx({ accountId: 'a1', type: 'income', concept: 'Bar Pepe' }),
      tx({ accountId: 'a2', type: 'expense', concept: 'Bar Pepe' }),
    ];
    const res = filterTransactions(list, {
      accountIds: ['a1'],
      types: ['expense'],
      search: 'pepe',
    });
    expect(res).toHaveLength(1);
  });
});

describe('sortTransactions', () => {
  it('ordena por importe asc y desc', () => {
    const list = [tx({ amountCents: -100 }), tx({ amountCents: -3000 }), tx({ amountCents: 500 })];
    const asc = sortTransactions(list, { field: 'amount', dir: 'asc' }).map((t) => t.amountCents);
    expect(asc).toEqual([-3000, -100, 500]);
    const desc = sortTransactions(list, { field: 'amount', dir: 'desc' }).map(
      (t) => t.amountCents,
    );
    expect(desc).toEqual([500, -100, -3000]);
  });

  it('ordena por fecha y por concepto', () => {
    const list = [
      tx({ date: '2026-03-01', concept: 'Zeta' }),
      tx({ date: '2026-01-01', concept: 'Alfa' }),
    ];
    expect(sortTransactions(list, { field: 'date', dir: 'asc' })[0]?.date).toBe('2026-01-01');
    expect(sortTransactions(list, { field: 'concept', dir: 'asc' })[0]?.concept).toBe('Alfa');
  });

  it('ordena por nombre de cuenta usando el mapa de nombres', () => {
    const list = [tx({ accountId: 'a1' }), tx({ accountId: 'a2' })];
    const accountNames = new Map([
      ['a1', 'Zenit'],
      ['a2', 'Ahorro'],
    ]);
    const sorted = sortTransactions(list, { field: 'account', dir: 'asc' }, { accountNames });
    expect(sorted[0]?.accountId).toBe('a2'); // Ahorro antes que Zenit
  });

  it('no muta el array de entrada', () => {
    const list = [tx({ amountCents: 2 }), tx({ amountCents: 1 })];
    const copy = [...list];
    sortTransactions(list, { field: 'amount', dir: 'asc' });
    expect(list).toEqual(copy);
  });
});
