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
      <p className={`mt-1 text-lg font-semibold tabular-nums sm:text-xl ${valueClass}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

// Tarjeta destacada para "Ahorrado" e "Invertido": mismo lenguaje visual que Tile pero con
// acento de color e icono, para darles la importancia que pide el usuario (dinero que no se
// consume, no un gasto mas). Se muestran juntas como par.
function EmphasisTile({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value: string;
  icon: string;
  accent: 'savings' | 'investment';
}) {
  const styles =
    accent === 'savings'
      ? 'border-emerald-500/40 bg-emerald-500/5'
      : 'border-sky-500/40 bg-sky-500/5';
  const valueClass = accent === 'savings' ? 'text-emerald-300' : 'text-sky-300';
  return (
    <div className={`rounded-xl border p-4 ${styles}`}>
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
        <span aria-hidden>{icon}</span>
        {label}
      </p>
      <p className={`mt-1 text-xl font-bold tabular-nums sm:text-2xl ${valueClass}`}>{value}</p>
    </div>
  );
}

// Tasa de ahorro (tanto por mil entero) a porcentaje con un decimal.
function savingsRateLabel(perMille: number | null): string {
  if (perMille === null) return 'Sin ingresos';
  return `${(perMille / 10).toFixed(1)}%`;
}

// Hint de "Ahorro neto": desglosa cuanto del ahorro neto es dinero apartado a Ahorros y
// cuanto invertido (ambos ya incluidos en el neto por no contar como gasto). Cuando no hay
// ninguno, explica la formula base.
function netSavingsHint(savingsCents: number, investmentCents: number): string {
  const parts: string[] = [];
  if (savingsCents > 0) parts.push(`${formatCents(savingsCents)} a Ahorros`);
  if (investmentCents > 0) parts.push(`${formatCents(investmentCents)} invertido`);
  return parts.length > 0 ? `Incluye ${parts.join(' y ')}` : 'Ingresos menos gasto neto';
}

export function StatTiles({ summary }: StatTilesProps) {
  const savingsPositive = summary.netSavingsCents >= 0;
  // El par Ahorrado/Invertido se muestra cuando hay actividad de alguno de los dos: da
  // visibilidad al dinero que estas apartando o invirtiendo (no es gasto).
  const showApart = summary.savingsContribCents > 0 || summary.investmentContribCents > 0;
  return (
    <div className="space-y-3">
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
          hint={netSavingsHint(summary.savingsContribCents, summary.investmentContribCents)}
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
      {showApart && (
        <div className="grid grid-cols-2 gap-3">
          {summary.savingsContribCents > 0 && (
            <EmphasisTile
              label="Ahorrado"
              value={formatCents(summary.savingsContribCents)}
              icon="🐷"
              accent="savings"
            />
          )}
          {summary.investmentContribCents > 0 && (
            <EmphasisTile
              label="Invertido"
              value={formatCents(summary.investmentContribCents)}
              icon="📈"
              accent="investment"
            />
          )}
        </div>
      )}
    </div>
  );
}
