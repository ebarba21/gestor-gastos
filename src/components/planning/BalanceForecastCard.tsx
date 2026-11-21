// Prevision de saldo a 30 o 90 dias: linea central con banda de incertidumbre (escenarios con
// mas y menos gasto variable), linea de cero y del colchon, y el punto minimo marcado. La
// prevision nunca se mezcla visualmente con el saldo real: es una linea discontinua.
import { useMemo, useState } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { BalanceForecast } from '../../services/planningService';
import { formatCents } from '../../lib/money';
import { formatCompactEuros, useChartColors } from '../dashboard/chartTheme';
import { shortDate } from './format';

interface Point {
  date: string;
  label: string;
  central: number;
  band: [number, number];
}

function ForecastTooltip({ active, payload }: { active?: boolean; payload?: { payload: Point }[] }) {
  const colors = useChartColors();
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0]!.payload;
  return (
    <div
      className="rounded-lg border px-3 py-2 text-xs shadow-lg"
      style={{ backgroundColor: colors.tooltipBg, borderColor: colors.tooltipBorder }}
    >
      <p className="font-medium text-slate-200">{p.label}</p>
      <p className="text-slate-300">Saldo previsto: {formatCents(p.central)}</p>
      <p className="text-slate-500">
        Entre {formatCents(p.band[0])} y {formatCents(p.band[1])}
      </p>
    </div>
  );
}

export function BalanceForecastCard({ forecast, bufferCents }: { forecast: BalanceForecast; bufferCents: number }) {
  const colors = useChartColors();
  const [horizon, setHorizon] = useState<30 | 90>(30);
  const data = useMemo<Point[]>(
    () =>
      forecast.days.slice(0, horizon).map((d) => ({
        date: d.date,
        label: shortDate(d.date),
        central: d.centralCents,
        band: [d.lowCents, d.highCents],
      })),
    [forecast, horizon],
  );
  const min = data.reduce<Point | null>((m, p) => (m === null || p.central < m.central ? p : m), null);
  const end = data[data.length - 1];

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm text-slate-300">
          {min !== null && (
            <>
              Saldo mínimo previsto:{' '}
              <strong className={min.central < 0 ? 'text-red-400' : min.central < bufferCents ? 'text-amber-300' : 'text-slate-100'}>
                {formatCents(min.central)}
              </strong>{' '}
              el {min.label}
            </>
          )}
        </p>
        <div className="flex shrink-0 rounded-lg border border-slate-700 text-xs" role="group" aria-label="Horizonte">
          {([30, 90] as const).map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => setHorizon(h)}
              aria-pressed={horizon === h}
              className={`px-2.5 py-1 ${horizon === h ? 'bg-slate-700 text-slate-100' : 'text-slate-400'}`}
            >
              {h} días
            </button>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={180}>
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={colors.grid} vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: colors.axis }}
            axisLine={{ stroke: colors.grid }}
            tickLine={false}
            interval={horizon === 30 ? 6 : 14}
          />
          <YAxis
            tickFormatter={formatCompactEuros}
            tick={{ fontSize: 11, fill: colors.axis }}
            axisLine={false}
            tickLine={false}
            width={44}
          />
          <Tooltip content={<ForecastTooltip />} />
          <Area
            type="monotone"
            dataKey="band"
            name="Margen"
            stroke="none"
            fill={colors.savings}
            fillOpacity={0.15}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="central"
            name="Saldo previsto"
            stroke={colors.savings}
            strokeWidth={2}
            strokeDasharray="5 3"
            dot={false}
            isAnimationActive={false}
          />
          <ReferenceLine y={0} stroke={colors.axis} />
          {bufferCents > 0 && (
            <ReferenceLine y={bufferCents} stroke={colors.expense} strokeDasharray="2 4" label={{ value: 'Colchón', fill: colors.axis, fontSize: 10, position: 'insideTopLeft' }} />
          )}
          {min !== null && <ReferenceDot x={min.label} y={min.central} r={4} fill={colors.expense} stroke="none" />}
        </ComposedChart>
      </ResponsiveContainer>
      <p className="mt-1 text-xs text-slate-500">
        Desde tu saldo a {shortDate(forecast.asOf)}: recibos e ingresos recurrentes
        {forecast.incomeAssumed === 'payDay' ? ', nómina estimada en tu día de cobro' : ''}
        {forecast.variableMonthlyCents !== null
          ? ` y tu gasto variable y ahorro habituales (${formatCents(forecast.variableMonthlyCents)}/mes)`
          : ''}
        . La banda va de tu mes más caro al más barato de los últimos 3.
        {end ? ` En ${horizon} días: ${formatCents(end.central)}.` : ''}
        {forecast.incomeAssumed === 'none' ? ' Sin nómina confirmada: confírmala en Recurrencias o indica tu día de cobro en Ajustes.' : ''}
      </p>
    </div>
  );
}
