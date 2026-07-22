// Comparativa: gasto del mes frente al promedio de los meses anteriores con actividad. El
// cierre de mes/forecast se movio a ForecastRangeCard (forecast compuesto por rango, fase 7:
// FINANCIAL_ALGORITHMS seccion 7.3), que sustituye la extrapolacion lineal anterior.
// Solo presentacion: recibe las metricas ya calculadas por statsService.
import type { Comparison } from '../../services/statsService';
import { formatCents } from '../../lib/money';

interface ComparisonForecastProps {
  comparison: Comparison;
}

function deltaLabel(perMille: number | null): string {
  if (perMille === null) return 'sin referencia';
  const pct = (perMille / 10).toFixed(1);
  const sign = perMille > 0 ? '+' : '';
  return `${sign}${pct}%`;
}

export function ComparisonForecast({ comparison }: ComparisonForecastProps) {
  // Gastar mas que el promedio se resalta como negativo (rojo); menos, como positivo (verde).
  const worse = comparison.deltaCents > 0;
  const deltaColor =
    comparison.deltaPerMille === null
      ? 'text-slate-400'
      : worse
        ? 'text-red-400'
        : 'text-emerald-400';
  const arrow = comparison.deltaPerMille === null ? '' : worse ? '▲' : '▼';

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        Gasto del mes vs promedio
      </p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-slate-100">
        {formatCents(comparison.currentExpenseNetCents)}
      </p>
      <p className={`mt-0.5 text-sm font-medium ${deltaColor}`}>
        {arrow} {deltaLabel(comparison.deltaPerMille)}
      </p>
      <p className="mt-1 text-xs text-slate-500">
        {comparison.monthsCompared === 0
          ? 'Aun no hay meses anteriores con actividad para comparar'
          : comparison.prorated
            ? `A estas alturas del mes (día ${comparison.daysElapsed} de ${comparison.daysInMonth}) sueles llevar ${formatCents(
                comparison.averageComparedCents,
              )}. Media mensual completa ${formatCents(comparison.averageExpenseNetCents)} de ${
                comparison.monthsCompared
              } ${comparison.monthsCompared === 1 ? 'mes' : 'meses'}.`
            : `Promedio ${formatCents(comparison.averageExpenseNetCents)} de ${comparison.monthsCompared} ${
                comparison.monthsCompared === 1 ? 'mes anterior' : 'meses anteriores'
              }`}
      </p>
    </div>
  );
}
