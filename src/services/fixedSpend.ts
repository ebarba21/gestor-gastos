// Gasto fijo: movimientos vinculados a recurrencias de gasto confirmadas (noviembre 2026).
// Fuente unica compartida por la portada (ritmo, cascada), el presupuesto flexible y la
// planificacion, para que "fijo" y "variable" signifiquen lo mismo en toda la app.
import type { RecurringOccurrence, RecurringSeries, Transaction } from '../db/schema';

// Series que cuentan como recibo fijo: de gasto, ya no candidatas y no semanales (la compra de
// cada sabado no es un recibo fijo: se queda en variable).
export function isFixedSeries(s: RecurringSeries): boolean {
  return s.direction === 'expense' && s.status !== 'candidate' && s.frequency !== 'weekly';
}

// Ids de los movimientos cobrados por una serie fija.
export function fixedTransactionIdsFrom(
  series: readonly RecurringSeries[],
  matchedOccurrences: readonly RecurringOccurrence[],
): Set<string> {
  const fixed = new Set(series.filter(isFixedSeries).map((s) => s.id));
  const ids = new Set<string>();
  for (const o of matchedOccurrences) {
    if (o.status === 'matched' && o.transactionId !== null && fixed.has(o.seriesId)) ids.add(o.transactionId);
  }
  return ids;
}

// Movimiento de gasto fijo: vinculado a una recurrencia, linea de un split vinculado, o
// reembolso de uno vinculado.
export function isFixedTransaction(t: Transaction, fixedIds: ReadonlySet<string>): boolean {
  return (
    fixedIds.has(t.id) ||
    (t.parentId !== null && fixedIds.has(t.parentId)) ||
    (t.refundOfId !== null && fixedIds.has(t.refundOfId))
  );
}

// Importe mensual equivalente (centimos, redondeo half-up una vez) de una serie: semanal x 52/12,
// mensual / intervalo, trimestral / (3 x intervalo), anual / (12 x intervalo).
export function monthlyEquivalentCents(s: Pick<RecurringSeries, 'expectedAmountCents' | 'frequency' | 'interval'>): number {
  const interval = Math.max(1, s.interval);
  const amount = Math.abs(s.expectedAmountCents);
  switch (s.frequency) {
    case 'weekly':
      return Math.round((amount * 52) / (12 * interval));
    case 'monthly':
      return Math.round(amount / interval);
    case 'quarterly':
      return Math.round(amount / (3 * interval));
    case 'yearly':
      return Math.round(amount / (12 * interval));
  }
}
