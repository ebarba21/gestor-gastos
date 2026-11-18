// "Cuanto puedo gastar": la decision del mes en un numero. Gasto variable que queda frente a tu
// referencia (mediana de los ultimos meses), a cuanto por dia y la curva acumulada frente a la
// linea de ritmo ideal. Los gastos fijos (recurrencias confirmadas) quedan fuera. Arriba, el
// estado de los datos: un numero sobre datos viejos no sirve para decidir.
import { Link } from 'react-router-dom';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { DataHealth, Pace } from '../../services/insightsService';
import { formatCents } from '../../lib/money';
import { formatCompactEuros, useChartColors } from '../dashboard/chartTheme';
import { MoneyTooltip } from '../dashboard/MoneyTooltip';

interface PaceCardProps {
  pace: Pace;
  health: DataHealth;
  onOpenWaterfall?: () => void;
}

export function HealthLine({ health }: { health: DataHealth }) {
  const ok = health.status === 'ok';
  const cls = ok ? 'text-emerald-400' : health.status === 'stale' ? 'text-orange-400' : 'text-slate-400';
  return (
    <p className={`flex items-center gap-1.5 text-xs ${cls}`}>
      <span aria-hidden>{ok ? '✓' : '!'}</span>
      <span>{health.headline}</span>
      {health.openReviewCount > 0 && (
        <Link to="/bandeja" className="ml-1 text-slate-400 underline-offset-2 hover:underline">
          · {health.openReviewCount} en la bandeja
        </Link>
      )}
    </p>
  );
}

export function PaceCard({ pace, health, onOpenWaterfall }: PaceCardProps) {
  const colors = useChartColors();
  const hasBaseline = pace.baselineCents !== null && pace.remainingCents !== null;
  const remaining = pace.remainingCents ?? 0;
  const over = hasBaseline && remaining < 0;

  let status: string;
  if (!hasBaseline) status = 'Necesitas al menos un mes previo con movimientos para calcular tu ritmo.';
  else if (pace.vsPaceCents === null || !pace.isCurrentMonth) {
    status = over
      ? `Te pasaste ${formatCents(-remaining)} de tu referencia de ${formatCents(pace.baselineCents!)}.`
      : `Quedaron ${formatCents(remaining)} de tu referencia de ${formatCents(pace.baselineCents!)}.`;
  } else if (pace.vsPaceCents <= 0) status = `${formatCents(-pace.vsPaceCents)} por debajo del ritmo`;
  else status = `${formatCents(pace.vsPaceCents)} por encima del ritmo`;

  const label = !hasBaseline
    ? pace.isCurrentMonth
      ? `Gasto variable del mes · día ${pace.daysElapsed} de ${pace.daysInMonth}`
      : 'Gasto variable del mes'
    : pace.isCurrentMonth
      ? `Gasto variable restante · día ${pace.daysElapsed} de ${pace.daysInMonth}`
      : 'Gasto variable del mes frente a tu referencia';
  const data = pace.days.map((d) => ({ day: d.day, Real: d.actualCents, Ritmo: d.idealCents }));

  return (
    <div className="min-w-0 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <HealthLine health={health} />
      <p className="mt-3 text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      {hasBaseline ? (
        <button
          type="button"
          onClick={onOpenWaterfall}
          disabled={!onOpenWaterfall}
          className="mt-1 block text-left"
          aria-label="Ver cómo se calcula"
        >
          <span className={`text-4xl font-semibold tabular-nums ${over ? 'text-orange-400' : 'text-slate-100'}`}>
            {over ? `-${formatCents(-remaining)}` : formatCents(remaining)}
          </span>
        </button>
      ) : (
        <p className="mt-1 text-4xl font-semibold tabular-nums text-slate-100">{formatCents(pace.variableSpentCents)}</p>
      )}
      <p className="mt-1 text-sm text-slate-300">
        {pace.perDayCents !== null && (
          <>
            <span className="font-medium tabular-nums">{formatCents(pace.perDayCents)}/día</span>
            <span className="text-slate-500"> · </span>
          </>
        )}
        <span className={pace.vsPaceCents !== null && pace.vsPaceCents > 0 ? 'text-orange-400' : ''}>
          {pace.vsPaceCents !== null && pace.isCurrentMonth && (pace.vsPaceCents <= 0 ? '▼ ' : '▲ ')}
          {status}
        </span>
      </p>

      {hasBaseline && (
        <div className="mt-3">
          <ResponsiveContainer width="100%" height={150}>
            <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={colors.grid} vertical={false} />
              <XAxis
                dataKey="day"
                tick={{ fontSize: 11, fill: colors.axis }}
                axisLine={{ stroke: colors.grid }}
                tickLine={false}
                ticks={[1, 10, 20, pace.daysInMonth]}
              />
              <YAxis
                tickFormatter={formatCompactEuros}
                tick={{ fontSize: 11, fill: colors.axis }}
                axisLine={false}
                tickLine={false}
                width={40}
              />
              <Tooltip content={<MoneyTooltip labelFormatter={(d) => `Día ${d}`} />} />
              <Line
                type="linear"
                dataKey="Ritmo"
                name="Ritmo ideal"
                stroke={colors.axis}
                strokeDasharray="4 4"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="Real"
                name="Gasto variable"
                stroke={colors.savings}
                strokeWidth={2}
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
          <p className="mt-1 text-xs text-slate-500">
            Referencia: {formatCents(pace.baselineCents!)} (mediana de {pace.baselineMonths}{' '}
            {pace.baselineMonths === 1 ? 'mes' : 'meses'}).{' '}
            {pace.hasFixedSeries ? (
              <>Sin gastos fijos: {formatCents(pace.fixedSpentCents)} este mes.</>
            ) : (
              <>
                Confirma tus recibos en <Link to="/recurrencias" className="text-indigo-400 hover:underline">Recurrencias</Link>{' '}
                para separar los gastos fijos.
              </>
            )}
          </p>
        </div>
      )}
    </div>
  );
}
