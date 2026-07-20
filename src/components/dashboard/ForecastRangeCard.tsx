// Forecast compuesto por rango (ampliacion, fase 7). Ver FINANCIAL_ALGORITHMS seccion 7.3.
// Sustituye la extrapolacion lineal anterior: muestra el desglose (realizado, recurrentes
// pendientes, gasto variable estimado), el rango inferior/superior (derivado del historico real,
// no de un porcentaje fijo) y la metodologia. Solo presentacion: recibe el resultado ya
// calculado por forecastService via useForecastRange.
import { useState } from 'react';
import type { ForecastRangeResult } from '../../services/forecastService';
import { formatCents } from '../../lib/money';

interface ForecastRangeCardProps {
  forecast: ForecastRangeResult | null;
  loading: boolean;
  error: string | null;
}

export function ForecastRangeCard({ forecast, loading, error }: ForecastRangeCardProps) {
  const [showMethodology, setShowMethodology] = useState(false);

  if (error) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Forecast del periodo</p>
        <p className="mt-2 text-sm text-red-400">{error}</p>
      </div>
    );
  }
  if (loading || !forecast) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Forecast del periodo</p>
        <p className="mt-2 text-sm text-slate-500">Calculando...</p>
      </div>
    );
  }

  const { central, centralTotalCents, lowerTotalCents, upperTotalCents } = forecast;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-center gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Forecast del periodo</p>
        <span className="rounded bg-amber-900/40 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
          Estimacion
        </span>
      </div>
      <p className="mt-1 text-xl font-semibold tabular-nums text-orange-300">
        {formatCents(centralTotalCents)}
      </p>
      <p className="mt-0.5 text-xs text-slate-500">
        Rango {formatCents(lowerTotalCents)} - {formatCents(upperTotalCents)}
        {forecast.insufficientHistory && ' · con poco historico para el gasto variable'}
      </p>

      <dl className="mt-3 space-y-1 text-xs">
        <div className="flex justify-between">
          <dt className="text-slate-400">Gasto realizado</dt>
          <dd className="tabular-nums text-slate-200">{formatCents(central.realizedCents)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-slate-400">Recurrentes pendientes</dt>
          <dd className="tabular-nums text-slate-200">{formatCents(central.recurringPendingCents)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-slate-400">Gasto variable restante</dt>
          <dd className="tabular-nums text-slate-200">{formatCents(central.variableRemainingCents)}</dd>
        </div>
      </dl>

      <button
        type="button"
        onClick={() => setShowMethodology((v) => !v)}
        className="mt-2 text-[11px] font-medium text-indigo-300 hover:text-indigo-200"
      >
        {showMethodology ? 'Ocultar metodologia' : 'Ver metodologia'}
      </button>
      {showMethodology && (
        <ul className="mt-2 space-y-1 border-t border-slate-800 pt-2 text-[11px] text-slate-500">
          {forecast.methodology.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
