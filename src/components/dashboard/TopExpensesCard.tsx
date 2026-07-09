// Top gastos individuales del periodo: lista compacta con concepto, categoria, fecha e
// importe. Solo presentacion: recibe la lista ya calculada y ordenada por statsService.
import type { TopExpense } from '../../services/statsService';
import { formatCents } from '../../lib/money';

interface TopExpensesCardProps {
  topExpenses: TopExpense[];
  categoryNames: Map<string, string>;
  accountNames: Map<string, string>;
}

export function TopExpensesCard({ topExpenses, categoryNames, accountNames }: TopExpensesCardProps) {
  if (topExpenses.length === 0) {
    return <p className="py-6 text-center text-sm text-slate-500">Sin gastos en este periodo.</p>;
  }
  return (
    <ul className="divide-y divide-slate-800">
      {topExpenses.map((t) => (
        <li key={t.id} className="flex items-center justify-between gap-3 py-2">
          <div className="min-w-0">
            <p className="truncate text-sm text-slate-200">{t.concept}</p>
            <p className="truncate text-xs text-slate-500">
              {t.categoryId ? categoryNames.get(t.categoryId) ?? 'Desconocida' : 'Sin categoria'}
              {' · '}
              {accountNames.get(t.accountId) ?? 'Cuenta'}
              {' · '}
              {t.date}
            </p>
          </div>
          <span className="shrink-0 text-sm font-medium tabular-nums text-orange-300">
            {formatCents(t.amountCents)}
          </span>
        </li>
      ))}
    </ul>
  );
}
