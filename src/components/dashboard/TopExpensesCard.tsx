// Top gastos individuales del periodo: lista compacta con concepto, categoria, fecha e
// importe. Solo presentacion: recibe la lista ya calculada y ordenada por statsService.
// Cada fila es pulsable: filtra el dashboard por la categoria de ese gasto (y de nuevo lo
// quita), coherente con el filtro cruzado del grafico de categorias.
import type { TopExpense } from '../../services/statsService';
import { formatCents } from '../../lib/money';

interface TopExpensesCardProps {
  topExpenses: TopExpense[];
  categoryNames: Map<string, string>;
  accountNames: Map<string, string>;
  // Categoria del filtro cruzado activo (undefined = sin filtro). null = "sin categoria".
  activeCategoryId?: string | null;
  onSelectCategory?: (categoryId: string | null) => void;
}

export function TopExpensesCard({
  topExpenses,
  categoryNames,
  accountNames,
  activeCategoryId,
  onSelectCategory,
}: TopExpensesCardProps) {
  if (topExpenses.length === 0) {
    return <p className="py-6 text-center text-sm text-slate-500">Sin gastos en este periodo.</p>;
  }
  return (
    <ul className="divide-y divide-slate-800">
      {topExpenses.map((t) => {
        const active = activeCategoryId !== undefined && t.categoryId === activeCategoryId;
        return (
          <li key={t.id}>
            <button
              type="button"
              onClick={() => onSelectCategory?.(t.categoryId)}
              disabled={!onSelectCategory}
              className={[
                'flex w-full items-center justify-between gap-3 py-2 text-left transition-colors',
                onSelectCategory ? 'cursor-pointer hover:bg-slate-800/40' : '',
                active ? 'bg-indigo-600/10' : '',
                '-mx-2 rounded px-2',
              ].join(' ')}
            >
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
            </button>
          </li>
        );
      })}
    </ul>
  );
}
