// Cascada del mes: de los ingresos al ahorro neto restando fijos y variables, y el reparto del
// ahorro neto (apartado a ahorro, invertido, queda en cuentas). Barras flotantes sobre una base
// invisible; el importe va escrito en cada paso.
import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { WaterfallStep } from '../../services/insightsService';
import { formatCents } from '../../lib/money';
import { formatCompactEuros, useChartColors } from '../dashboard/chartTheme';

interface WaterfallCardProps {
  steps: WaterfallStep[];
}

interface Datum {
  label: string;
  base: number;
  value: number;
  signed: number;
  color: string;
}

// Parte una etiqueta de eje por el espacio mas centrado para que quepa en dos lineas.
function TwoLineTick({ x, y, label, fill }: { x: number; y: number; label: string; fill: string }) {
  const words = label.split(' ');
  let lines = [label];
  if (words.length > 1) {
    let best = 1;
    for (let i = 1; i < words.length; i++) {
      const a = words.slice(0, i).join(' ').length;
      const b = words.slice(i).join(' ').length;
      const bestA = words.slice(0, best).join(' ').length;
      const bestB = words.slice(best).join(' ').length;
      if (Math.max(a, b) < Math.max(bestA, bestB)) best = i;
    }
    lines = [words.slice(0, best).join(' '), words.slice(best).join(' ')];
  }
  return (
    <text x={x} y={y + 12} textAnchor="middle" fontSize={10} fill={fill}>
      {lines.map((l, i) => (
        <tspan key={i} x={x} dy={i === 0 ? 0 : 12}>
          {l}
        </tspan>
      ))}
    </text>
  );
}

export function WaterfallCard({ steps }: WaterfallCardProps) {
  const colors = useChartColors();
  const income = steps.find((s) => s.key === 'income')?.cents ?? 0;
  const anyMovement = steps.some((s) => s.cents !== 0);
  if (!anyMovement) {
    return <p className="py-6 text-center text-sm text-slate-500">Sin ingresos ni gastos este mes.</p>;
  }
  const data: Datum[] = [];
  let running = 0;
  let partsStart = 0;
  for (const s of steps) {
    if (s.kind === 'start') {
      running = s.cents;
      data.push({ label: s.label, base: Math.min(0, s.cents), value: Math.abs(s.cents), signed: s.cents, color: colors.income });
    } else if (s.kind === 'delta') {
      const next = running + s.cents;
      data.push({ label: s.label, base: Math.min(running, next), value: Math.abs(s.cents), signed: s.cents, color: colors.expense });
      running = next;
    } else if (s.kind === 'total') {
      data.push({ label: s.label, base: Math.min(0, s.cents), value: Math.abs(s.cents), signed: s.cents, color: colors.savings });
      partsStart = 0;
    } else {
      if (s.cents === 0) continue;
      const next = partsStart + s.cents;
      const color = s.key === 'savings' ? colors.saved : s.key === 'investment' ? colors.invested : colors.axis;
      data.push({ label: s.label, base: Math.min(partsStart, next), value: Math.abs(s.cents), signed: s.cents, color });
      partsStart = next;
    }
  }
  return (
    <div>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ top: 20, right: 8, bottom: 4, left: 0 }}>
          <XAxis
            dataKey="label"
            interval={0}
            // Etiqueta completa en dos lineas ("Gasto / variable") en lugar de recortarla.
            tick={(props: { x: number; y: number; payload: { value: string } }) => (
              <TwoLineTick x={props.x} y={props.y} label={props.payload.value} fill={colors.axis} />
            )}
            axisLine={{ stroke: colors.grid }}
            tickLine={false}
            height={44}
          />
          <YAxis tickFormatter={formatCompactEuros} tick={{ fontSize: 11, fill: colors.axis }} axisLine={false} tickLine={false} width={44} />
          <Tooltip
            cursor={{ fill: colors.grid, opacity: 0.3 }}
            content={({ active, payload }) => {
              const d = active && payload && payload[0] ? (payload[0].payload as Datum) : null;
              if (!d) return null;
              return (
                <div className="rounded-lg border px-3 py-2 text-xs" style={{ backgroundColor: colors.tooltipBg, borderColor: colors.tooltipBorder }}>
                  <span className="text-slate-400">{d.label}: </span>
                  <span className="font-medium text-slate-100">{formatCents(d.signed)}</span>
                </div>
              );
            }}
          />
          <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} />
          <Bar dataKey="value" stackId="w" radius={[3, 3, 3, 3]} maxBarSize={36} isAnimationActive={false}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.color} />
            ))}
            <LabelList
              dataKey="signed"
              position="top"
              formatter={(v: number) => formatCompactEuros(v)}
              style={{ fontSize: 10, fill: colors.axis }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      {income === 0 && <p className="text-xs text-slate-500">Aún no hay ingresos (nómina o paro) este mes.</p>}
    </div>
  );
}
