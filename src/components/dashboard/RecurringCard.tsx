// Gastos recurrentes detectados: conceptos que se repiten en varios meses de la ventana de
// analisis. Deteccion basica (repeticion mensual por concepto), etiquetada como tal. Solo
// presentacion: recibe la lista ya calculada por statsService.
import type { RecurringExpense } from '../../services/statsService';
import { formatCents } from '../../lib/money';

interface RecurringCardProps {
  recurring: RecurringExpense[];
}

export function RecurringCard({ recurring }: RecurringCardProps) {
  if (recurring.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-slate-500">
        No se han detectado gastos recurrentes en los ultimos meses.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-slate-800">
      {recurring.map((r) => (
        <li key={r.key} className="flex items-center justify-between gap-3 py-2">
          <div className="min-w-0">
            <p className="truncate text-sm text-slate-200">{r.label}</p>
            <p className="text-xs text-slate-500">
              {r.months} meses · {r.occurrences} movimientos · media {formatCents(r.averageCents)}
            </p>
          </div>
          <span className="shrink-0 text-sm font-medium tabular-nums text-slate-300">
            {formatCents(r.totalCents)}
          </span>
        </li>
      ))}
    </ul>
  );
}
