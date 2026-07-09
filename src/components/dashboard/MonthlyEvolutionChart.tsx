// Evolucion mensual: lineas de ingresos, gasto neto y ahorro neto a lo largo de la ventana
// de meses. Tres series -> leyenda siempre presente (la identidad no es solo color). Un unico
// eje Y (nunca dos escalas). Superficie/rejilla recesivas sobre el fondo oscuro.
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { MonthPoint } from '../../services/statsService';
import { CHART_COLORS, formatCompactEuros, shortMonthLabel } from './chartTheme';
import { MoneyTooltip } from './MoneyTooltip';

interface MonthlyEvolutionChartProps {
  monthly: MonthPoint[];
}

interface Datum {
  month: string;
  Ingresos: number;
  Gastos: number;
  Ahorro: number;
}

export function MonthlyEvolutionChart({ monthly }: MonthlyEvolutionChartProps) {
  const data: Datum[] = monthly.map((m) => ({
    month: m.month,
    Ingresos: m.incomeCents,
    Gastos: m.expenseNetCents,
    Ahorro: m.netSavingsCents,
  }));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 8 }}>
        <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
        <XAxis
          dataKey="month"
          tickFormatter={shortMonthLabel}
          tick={{ fontSize: 11, fill: CHART_COLORS.axis }}
          axisLine={{ stroke: CHART_COLORS.grid }}
          tickLine={false}
          minTickGap={16}
        />
        <YAxis
          tickFormatter={formatCompactEuros}
          tick={{ fontSize: 11, fill: CHART_COLORS.axis }}
          axisLine={false}
          tickLine={false}
          width={44}
        />
        <Tooltip content={<MoneyTooltip labelFormatter={shortMonthLabel} />} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line type="monotone" dataKey="Ingresos" stroke={CHART_COLORS.income} strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="Gastos" stroke={CHART_COLORS.expense} strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="Ahorro" stroke={CHART_COLORS.savings} strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
