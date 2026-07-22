// Evolucion mensual: areas de ingresos, gasto neto y ahorro neto a lo largo de la ventana de
// meses. Areas sombreadas (degradado bajo cada linea) para leer de un vistazo el volumen y el
// signo; tres series -> leyenda siempre presente (la identidad no es solo color). Un unico eje
// Y (nunca dos escalas). Superficie/rejilla recesivas.
//
// Actua de control del periodo: pulsar un mes fija ese mes como periodo del dashboard. El mes
// activo (el del periodo) se marca con una linea de referencia.
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { CategoricalChartState } from 'recharts/types/chart/types';
import type { MonthPoint } from '../../services/statsService';
import { formatCompactEuros, shortMonthLabel, useChartColors } from './chartTheme';
import { MoneyTooltip } from './MoneyTooltip';

interface MonthlyEvolutionChartProps {
  monthly: MonthPoint[];
  // Mes del periodo activo (YYYY-MM), resaltado con una linea de referencia.
  activeMonth?: string;
  // Pulsar un mes lo fija como periodo del dashboard.
  onSelectMonth?: (monthKey: string) => void;
}

interface Datum {
  month: string;
  Ingresos: number;
  Gastos: number;
  Ahorro: number;
}

export function MonthlyEvolutionChart({ monthly, activeMonth, onSelectMonth }: MonthlyEvolutionChartProps) {
  const colors = useChartColors();
  const data: Datum[] = monthly.map((m) => ({
    month: m.month,
    Ingresos: m.incomeCents,
    Gastos: m.expenseNetCents,
    Ahorro: m.netSavingsCents,
  }));

  const handleClick = (state: CategoricalChartState) => {
    const label = state?.activeLabel;
    if (onSelectMonth && typeof label === 'string') onSelectMonth(label);
  };

  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart
        data={data}
        margin={{ top: 8, right: 16, bottom: 4, left: 8 }}
        onClick={onSelectMonth ? handleClick : undefined}
        style={onSelectMonth ? { cursor: 'pointer' } : undefined}
      >
        <defs>
          {/* Degradado bajo cada area: opaco arriba, transparente abajo. */}
          <linearGradient id="ge-income" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colors.income} stopOpacity={0.35} />
            <stop offset="100%" stopColor={colors.income} stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="ge-expense" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colors.expense} stopOpacity={0.35} />
            <stop offset="100%" stopColor={colors.expense} stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="ge-savings" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colors.savings} stopOpacity={0.3} />
            <stop offset="100%" stopColor={colors.savings} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={colors.grid} vertical={false} />
        <XAxis
          dataKey="month"
          tickFormatter={shortMonthLabel}
          tick={{ fontSize: 11, fill: colors.axis }}
          axisLine={{ stroke: colors.grid }}
          tickLine={false}
          minTickGap={16}
        />
        <YAxis
          tickFormatter={formatCompactEuros}
          tick={{ fontSize: 11, fill: colors.axis }}
          axisLine={false}
          tickLine={false}
          width={44}
        />
        <Tooltip content={<MoneyTooltip labelFormatter={shortMonthLabel} />} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {activeMonth && (
          <ReferenceLine x={activeMonth} stroke={colors.axis} strokeDasharray="3 3" />
        )}
        {/* Ahorro al fondo (relleno más tenue), luego gasto e ingresos por encima. */}
        <Area
          type="monotone"
          dataKey="Ahorro"
          stroke={colors.savings}
          strokeWidth={2}
          fill="url(#ge-savings)"
          dot={false}
          activeDot={{ r: 3 }}
        />
        <Area
          type="monotone"
          dataKey="Gastos"
          stroke={colors.expense}
          strokeWidth={2}
          fill="url(#ge-expense)"
          dot={false}
          activeDot={{ r: 3 }}
        />
        <Area
          type="monotone"
          dataKey="Ingresos"
          stroke={colors.income}
          strokeWidth={2}
          fill="url(#ge-income)"
          dot={false}
          activeDot={{ r: 3 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
