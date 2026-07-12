// Ingresos vs gastos del periodo seleccionado: dos barras comparables en el mismo eje.
// Colores coherentes con el resto del dashboard (ingresos emerald, gastos orange). Cada
// barra lleva su etiqueta de valor directa, asi la lectura no depende solo del color.
import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { IncomeExpenseSummary } from '../../services/statsService';
import { formatCents } from '../../lib/money';
import { formatCompactEuros, useChartColors } from './chartTheme';
import { MoneyTooltip } from './MoneyTooltip';

interface IncomeExpenseChartProps {
  summary: IncomeExpenseSummary;
}

export function IncomeExpenseChart({ summary }: IncomeExpenseChartProps) {
  const colors = useChartColors();
  const data = [
    { name: 'Ingresos', value: summary.incomeCents, color: colors.income },
    { name: 'Gastos', value: summary.expenseNetCents, color: colors.expense },
  ];

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 20, right: 12, bottom: 4, left: 8 }}>
        <XAxis
          dataKey="name"
          tick={{ fontSize: 12, fill: colors.axis }}
          axisLine={{ stroke: colors.grid }}
          tickLine={false}
        />
        <YAxis
          tickFormatter={formatCompactEuros}
          tick={{ fontSize: 11, fill: colors.axis }}
          axisLine={false}
          tickLine={false}
          width={44}
        />
        <Tooltip cursor={{ fill: colors.grid, opacity: 0.4 }} content={<MoneyTooltip />} />
        <Bar dataKey="value" name="Importe" radius={[4, 4, 0, 0]} maxBarSize={90}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.color} />
          ))}
          <LabelList
            dataKey="value"
            position="top"
            formatter={(v: number) => formatCents(v)}
            style={{ fontSize: 11, fill: colors.axis }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
