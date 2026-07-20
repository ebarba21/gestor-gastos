// Proximos cobros/ingresos de series recurrentes CONFIRMADAS (ampliacion, fase 7). Sustituye la
// deteccion basica de RecurringCard (repeticion de concepto) por series confirmables reales. Solo
// presentacion: recibe la lista ya calculada por recurringSeriesService via useRecurringSeries.
import type { UpcomingCharge } from '../../services/recurringSeriesService';
import { formatCents } from '../../lib/money';

interface UpcomingChargesCardProps {
  charges: UpcomingCharge[];
  loading: boolean;
}

export function UpcomingChargesCard({ charges, loading }: UpcomingChargesCardProps) {
  if (loading && charges.length === 0) {
    return <p className="py-6 text-center text-sm text-slate-500">Cargando...</p>;
  }
  if (charges.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-slate-500">
        Sin cobros previstos. Confirma recurrencias en la seccion Recurrencias para verlas aqui.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-slate-800">
      {charges.slice(0, 6).map((c) => (
        <li key={c.occurrenceId} className="flex items-center justify-between gap-3 py-2">
          <div className="min-w-0">
            <p className="truncate text-sm text-slate-200">{c.seriesName}</p>
            <p className="text-xs text-slate-500">{c.expectedDate}</p>
          </div>
          <span className="shrink-0 text-sm font-medium tabular-nums text-slate-300">
            {formatCents(c.expectedAmountCents)}
          </span>
        </li>
      ))}
    </ul>
  );
}
