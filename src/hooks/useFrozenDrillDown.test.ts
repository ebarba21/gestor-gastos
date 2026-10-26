// El panel "Gastos del periodo" conserva el orden de apertura tras editar movimientos.
import { renderHook } from '@testing-library/react';
import type { DrillDown, DrillDownItem, DrillDownKind } from '../services/statsService';
import { useFrozenDrillDown } from './useFrozenDrillDown';

function item(id: string, contributionCents: number, categoryId = 'cat-a'): DrillDownItem {
  return { id, date: '2026-10-10', concept: `Mov ${id}`, accountId: 'acc-1', categoryId, role: 'expense', contributionCents };
}

function data(expense: DrillDownItem[], income: DrillDownItem[] = []): Record<DrillDownKind, DrillDown> {
  const sum = (xs: DrillDownItem[]) => xs.reduce((acc, x) => acc + x.contributionCents, 0);
  return {
    expense: { items: expense, totalCents: sum(expense) },
    income: { items: income, totalCents: sum(income) },
  };
}

type Props = { kind: DrillDownKind | null; dd: Record<DrillDownKind, DrillDown> | null };

describe('useFrozenDrillDown', () => {
  it('tras editar un movimiento lo mantiene en su sitio con los datos nuevos', () => {
    const initial = data([item('a', 100), item('b', 200), item('c', 300)]);
    const { result, rerender } = renderHook(({ kind, dd }: Props) => useFrozenDrillDown(kind, dd), {
      initialProps: { kind: 'expense', dd: initial } as Props,
    });
    expect(result.current?.items.map((i) => i.id)).toEqual(['a', 'b', 'c']);

    // Recarga tras guardar "c": el recalculo lo pone arriba.
    rerender({ kind: 'expense', dd: data([item('c', 350, 'cat-b'), item('a', 100), item('b', 200)]) });
    expect(result.current?.items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(result.current?.items[2]).toMatchObject({ contributionCents: 350, categoryId: 'cat-b' });
    expect(result.current?.totalCents).toBe(650);
  });

  it('conserva el orden aunque los datos pasen por null durante la recarga', () => {
    const { result, rerender } = renderHook(({ kind, dd }: Props) => useFrozenDrillDown(kind, dd), {
      initialProps: { kind: 'expense', dd: data([item('a', 1), item('b', 2)]) } as Props,
    });
    rerender({ kind: 'expense', dd: null });
    expect(result.current).toBeNull();
    rerender({ kind: 'expense', dd: data([item('b', 5), item('a', 1)]) });
    expect(result.current?.items.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('al cerrar y reabrir el panel toma el orden actualizado', () => {
    const { result, rerender } = renderHook(({ kind, dd }: Props) => useFrozenDrillDown(kind, dd), {
      initialProps: { kind: 'expense', dd: data([item('a', 1), item('b', 2)]) } as Props,
    });
    const reordered = data([item('b', 5), item('a', 1)]);
    rerender({ kind: null, dd: reordered });
    expect(result.current).toBeNull();
    rerender({ kind: 'expense', dd: reordered });
    expect(result.current?.items.map((i) => i.id)).toEqual(['b', 'a']);
  });

  it('cambiar de desglose congela el orden del nuevo', () => {
    const dd = data([item('a', 1), item('b', 2)], [item('n1', 1000), item('n2', 2000)]);
    const { result, rerender } = renderHook(({ kind, dd: d }: Props) => useFrozenDrillDown(kind, d), {
      initialProps: { kind: 'expense', dd } as Props,
    });
    rerender({ kind: 'income', dd });
    expect(result.current?.items.map((i) => i.id)).toEqual(['n1', 'n2']);
    rerender({ kind: 'income', dd: data([item('a', 1), item('b', 2)], [item('n2', 2000), item('n1', 1000)]) });
    expect(result.current?.items.map((i) => i.id)).toEqual(['n1', 'n2']);
  });
});
