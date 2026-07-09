// Tarjetas de metrica principales (KPIs) del periodo: ingresos, gasto neto, ahorro neto y
// tasa de ahorro. Solo presentacion: reciben el resumen ya calculado por statsService.
// Los importes se formatean desde centimos enteros; la tasa de ahorro gestiona el caso "sin
// ingresos" (no hay division por cero: se muestra "Sin ingresos").
import type { IncomeExpenseSummary } from '../../services/statsService';
import { formatCents } from '../../lib/money';

interface StatTilesProps {
  summary: IncomeExpenseSummary;
}

function Tile({
  label,
  value,
  hint,
  valueClass = 'text-slate-100',
}: {
  label: string;
  value: string;
  hint?: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${valueClass}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

// Tasa de ahorro (tanto por mil entero) a porcentaje con un decimal.
function savingsRateLabel(perMille: number | null): string {
  if (perMille === null) return 'Sin ingresos';
  return `${(perMille / 10).toFixed(1)}%`;
}

export function StatTiles({ summary }: StatTilesProps) {
  const savingsPositive = summary.netSavingsCents >= 0;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Tile label="Ingresos" value={formatCents(summary.incomeCents)} valueClass="text-emerald-400" />
      <Tile
        label="Gastos"
        value={formatCents(summary.expenseNetCents)}
        valueClass="text-orange-400"
        hint={
          summary.refundCents > 0
            ? `Bruto ${formatCents(summary.expenseGrossCents)} · reembolsos ${formatCents(summary.refundCents)}`
            : undefined
        }
      />
      <Tile
        label="Ahorro neto"
        value={formatCents(summary.netSavingsCents)}
        valueClass={savingsPositive ? 'text-indigo-300' : 'text-red-400'}
        hint="Ingresos menos gasto neto"
      />
      <Tile
        label="Tasa de ahorro"
        value={savingsRateLabel(summary.savingsRatePerMille)}
        valueClass={
          summary.savingsRatePerMille === null
            ? 'text-slate-400'
            : summary.savingsRatePerMille >= 0
              ? 'text-indigo-300'
              : 'text-red-400'
        }
        hint="Ahorro sobre ingresos"
      />
    </div>
  );
}
