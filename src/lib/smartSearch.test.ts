import { describe, expect, it } from 'vitest';
import { mergeSmartFilter, parseSmartSearch, type SmartSearchContext } from './smartSearch';
import { filterTransactions } from './transactionFilters';
import { makeTx } from '../test/txFixtures';

const ctx: SmartSearchContext = {
  categories: [
    { id: 'rest', name: 'Restaurantes', parentId: null, archivedAt: null },
    { id: 'super', name: 'Supermercado', parentId: null, archivedAt: null },
    { id: 'vac', name: 'Vacaciones', parentId: null, archivedAt: null },
    { id: 'vac-comida', name: 'Comida', parentId: 'vac', archivedAt: null },
  ],
  accounts: [
    { id: 'acc-rev', name: 'Revolut', archivedAt: null },
    { id: 'acc-iber', name: 'Ibercaja', archivedAt: null },
  ],
  tags: [{ id: 'tag-lis', name: 'Viaje Lisboa' }],
  today: '2026-11-21',
};

describe('busqueda con sintaxis', () => {
  it('texto libre + mes: el mes mas reciente con ese nombre', () => {
    const r = parseSmartSearch('mercadona octubre', ctx);
    expect(r.filter).toMatchObject({ search: 'mercadona', dateFrom: '2026-10-01', dateTo: '2026-10-31' });
    expect(r.chips).toEqual(['Texto: "mercadona"', 'Octubre 2026']);
    // Diciembre aun no ha llegado este ano: es el del ano pasado.
    expect(parseSmartSearch('diciembre', ctx).filter).toMatchObject({ dateFrom: '2025-12-01', dateTo: '2025-12-31' });
    expect(parseSmartSearch('octubre 2024', ctx).filter).toMatchObject({ dateFrom: '2024-10-01' });
  });

  it('importe y categoria por prefijo', () => {
    const r = parseSmartSearch('>100 restaurante', ctx);
    expect(r.filter).toEqual({ absAmountMinCents: 10001, categoryIds: ['rest'] });
    expect(r.chips).toEqual(['Importe > 100 €', 'Categoría: Restaurantes']);
    expect(parseSmartSearch('<=20,5', ctx).filter).toEqual({ absAmountMaxCents: 2050 });
  });

  it('sin categoria, etiqueta con varias palabras, cuenta, ano y tipo', () => {
    expect(parseSmartSearch('sin categoría', ctx).filter).toEqual({ onlyUncategorized: true });
    expect(parseSmartSearch('#viaje lisboa', ctx).filter).toEqual({ tagIds: ['tag-lis'] });
    expect(parseSmartSearch('revolut 2025 gastos', ctx).filter).toEqual({
      accountIds: ['acc-rev'],
      types: ['expense'],
      dateFrom: '2025-01-01',
      dateTo: '2025-12-31',
    });
    expect(parseSmartSearch('comida', ctx).filter).toEqual({ subcategoryIds: ['vac-comida'] });
  });

  it('palabras cortas o desconocidas siguen siendo texto', () => {
    expect(parseSmartSearch('bar', ctx).filter).toEqual({ search: 'bar' });
    expect(parseSmartSearch('glovo', ctx).filter).toEqual({ search: 'glovo' });
  });

  it('aplicado a movimientos: ">50 super" filtra por magnitud y categoria', () => {
    const txs = [
      makeTx({ date: '2026-11-02', amountCents: -6000, categoryId: 'super' }),
      makeTx({ date: '2026-11-03', amountCents: -4000, categoryId: 'super' }),
      makeTx({ date: '2026-11-04', amountCents: -9000, categoryId: 'rest' }),
    ];
    const { filter } = parseSmartSearch('>50 super', ctx);
    expect(filterTransactions(txs, mergeSmartFilter({}, filter)).map((t) => t.amountCents)).toEqual([-6000]);
  });

  it('lo escrito afina los filtros de los paneles, nunca los amplia', () => {
    const merged = mergeSmartFilter({ accountIds: ['acc-iber'] }, { accountIds: ['acc-rev'] });
    const txs = [makeTx({ accountId: 'acc-iber' }), makeTx({ accountId: 'acc-rev' })];
    expect(filterTransactions(txs, merged)).toHaveLength(0);
    expect(mergeSmartFilter({ dateFrom: '2026-01-01' }, { dateFrom: '2026-10-01' }).dateFrom).toBe('2026-10-01');
  });
});
