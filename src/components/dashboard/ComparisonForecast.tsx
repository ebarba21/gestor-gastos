// Dos tarjetas contextuales del mes de referencia:
//  - Comparativa: gasto del mes frente al promedio de los meses anteriores con actividad.
//  - Forecast: proyeccion lineal del gasto a fin de mes, ETIQUETADA como estimacion. Solo se
//    muestra cuando el mes analizado es el mes en curso (en un mes pasado no se extrapola).
// Solo presentacion: recibe las metricas ya calculadas por statsService.
import type { Comparison, Forecast } from '../../services/statsService';
import { formatCents } from '../../lib/money';

interface ComparisonForecastProps {
  comparison: Comparison;
  forecast: Forecast;
}

function deltaLabel(perMille: number | null): string {
  if (perMille === null) return 'sin referencia';
  const pct = (perMille / 10).toFixed(1);
  const sign = perMille > 0 ? '+' : '';
  return `${sign}${pct}%`;
}

export function ComparisonForecast({ comparison, forecast }: ComparisonForecastProps) {
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
    <div className="grid gap-3 sm:grid-cols-2">
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
              ? `A estas alturas del mes (dia ${comparison.daysElapsed} de ${comparison.daysInMonth}) sueles llevar ${formatCents(
                  comparison.averageComparedCents,
                )}. Media mensual completa ${formatCents(comparison.averageExpenseNetCents)} de ${
                  comparison.monthsCompared
                } ${comparison.monthsCompared === 1 ? 'mes' : 'meses'}.`
              : `Promedio ${formatCents(comparison.averageExpenseNetCents)} de ${comparison.monthsCompared} ${
                  comparison.monthsCompared === 1 ? 'mes anterior' : 'meses anteriores'
                }`}
        </p>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
        <div className="flex items-center gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Cierre de mes
          </p>
          {forecast.applicable && (
            <span className="rounded bg-amber-900/40 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
              Estimacion
            </span>
          )}
        </div>
        {forecast.applicable ? (
          <>
            <p className="mt-1 text-xl font-semibold tabular-nums text-orange-300">
              {formatCents(forecast.projectedExpenseCents)}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              Llevas {formatCents(forecast.spentSoFarCents)} en {forecast.daysElapsed} de{' '}
              {forecast.daysInMonth} dias. Proyeccion al ritmo actual.
            </p>
          </>
        ) : (
          <>
            <p className="mt-1 text-xl font-semibold tabular-nums text-slate-300">
              {formatCents(forecast.spentSoFarCents)}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              Gasto total del mes. La proyeccion solo aplica al mes en curso.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
