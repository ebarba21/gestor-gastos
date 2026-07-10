// Aportaciones mensuales a ahorro e inversion: barras apiladas por mes (dos series ->
// leyenda siempre presente; la identidad nunca es solo color). Un unico eje Y. Una
// aportacion negativa (retirada neta del mes) se apila hacia abajo y se lee tal cual.
// Actua de control del periodo: pulsar un mes lo fija como periodo del dashboard.
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { CategoricalChartState } from 'recharts/types/chart/types';
import type { SavingsInvestmentMonthPoint } from '../../services/statsService';
import { formatCompactEuros, shortMonthLabel, useChartColors } from './chartTheme';
import { MoneyTooltip } from './MoneyTooltip';

interface SavingsContributionsChartProps {
  months: SavingsInvestmentMonthPoint[];
  onSelectMonth?: (monthKey: string) => void;
}

interface Datum {
  month: string;
  Ahorro: number;
  Inversion: number;
}

export function SavingsContributionsChart({ months, onSelectMonth }: SavingsContributionsChartProps) {
  const colors = useChartColors();
  const data: Datum[] = months.map((m) => ({
    month: m.month,
    Ahorro: m.savingsContribCents,
    Inversion: m.investmentContribCents,
  }));

  const handleClick = (state: CategoricalChartState) => {
    const label = state?.activeLabel;
    if (onSelectMonth && typeof label === 'string') onSelectMonth(label);
  };

  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart
        data={data}
        margin={{ top: 8, right: 16, bottom: 4, left: 8 }}
        onClick={onSelectMonth ? handleClick : undefined}
        style={onSelectMonth ? { cursor: 'pointer' } : undefined}
      >
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
        <Tooltip content={<MoneyTooltip labelFormatter={shortMonthLabel} />} cursor={{ fill: colors.grid, opacity: 0.4 }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {/* Separador de 2px entre segmentos apilados: trazo del color de superficie. */}
        <Bar dataKey="Ahorro" stackId="contrib" fill={colors.saved} stroke={colors.tooltipBg} strokeWidth={1} maxBarSize={28} />
        <Bar dataKey="Inversion" name="Inversión" stackId="contrib" fill={colors.invested} stroke={colors.tooltipBg} strokeWidth={1} maxBarSize={28} />
      </BarChart>
    </ResponsiveContainer>
  );
}
