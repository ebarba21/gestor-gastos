// Orden congelado del desglose de Gastos/Ingresos: editar un movimiento con el panel abierto
// no debe moverlo de sitio. Los datos (importes, categorias, total) son siempre los nuevos.
import { applyFrozenDrillDownOrder, type DrillDown, type DrillDownItem } from './statsService';

function item(id: string, date: string, contributionCents: number, categoryId: string | null = 'cat-a'): DrillDownItem {
  return { id, date, concept: `Mov ${id}`, accountId: 'acc-1', categoryId, role: 'expense', contributionCents };
}

describe('applyFrozenDrillDownOrder', () => {
  const frozen = ['a', 'b', 'c', 'd'];

  it('mantiene el orden de apertura aunque el recalculo mueva el editado arriba', () => {
    // Tras editar "c", el recalculo lo coloca primero.
    const live: DrillDown = {
      items: [item('c', '2026-10-20', 900, 'cat-b'), item('a', '2026-10-20', 100), item('b', '2026-10-15', 200), item('d', '2026-10-01', 400)],
      totalCents: 1600,
    };
    const out = applyFrozenDrillDownOrder(live, frozen);
    expect(out.items.map((i) => i.id)).toEqual(['a', 'b', 'c', 'd']);
    // Pero con los datos nuevos del editado.
    expect(out.items[2]).toMatchObject({ contributionCents: 900, categoryId: 'cat-b', date: '2026-10-20' });
    expect(out.totalCents).toBe(1600);
  });

  it('quita los que ya no cuentan en el KPI y conserva el orden del resto', () => {
    const live: DrillDown = {
      items: [item('d', '2026-10-01', 400), item('a', '2026-10-20', 100), item('c', '2026-10-10', 300)],
      totalCents: 800,
    };
    const out = applyFrozenDrillDownOrder(live, frozen);
    expect(out.items.map((i) => i.id)).toEqual(['a', 'c', 'd']);
    expect(out.totalCents).toBe(800);
  });

  it('anade al final los que entran nuevos, en su orden natural', () => {
    const live: DrillDown = {
      items: [item('x', '2026-10-25', 50), item('b', '2026-10-15', 200), item('y', '2026-10-02', 70), item('a', '2026-10-20', 100)],
      totalCents: 420,
    };
    const out = applyFrozenDrillDownOrder(live, ['a', 'b']);
    expect(out.items.map((i) => i.id)).toEqual(['a', 'b', 'x', 'y']);
  });

  it('con orden congelado vacio devuelve el orden natural', () => {
    const live: DrillDown = { items: [item('a', '2026-10-20', 100), item('b', '2026-10-15', 200)], totalCents: 300 };
    expect(applyFrozenDrillDownOrder(live, []).items.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('no muta el desglose de entrada', () => {
    const live: DrillDown = { items: [item('b', '2026-10-15', 200), item('a', '2026-10-20', 100)], totalCents: 300 };
    applyFrozenDrillDownOrder(live, ['a', 'b']);
    expect(live.items.map((i) => i.id)).toEqual(['b', 'a']);
  });
});
