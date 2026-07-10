// Acumulado de lo aportado a ahorro e inversion dentro de la ventana analizada: areas
// apiladas (la altura total es todo lo apartado hasta ese mes). Mismo lenguaje visual que
// la evolucion mensual (degradado bajo cada area, rejilla recesiva, un unico eje Y).
// Puede descender si un mes hay retirada neta. Pulsar un mes lo fija como periodo.
import {
  Area,
  AreaChart,
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

interface SavingsCumulativeChartProps {
  months: SavingsInvestmentMonthPoint[];
  onSelectMonth?: (monthKey: string) => void;
}

interface Datum {
  month: string;
  Ahorro: number;
  Inversion: number;
}

export function SavingsCumulativeChart({ months, onSelectMonth }: SavingsCumulativeChartProps) {
  const colors = useChartColors();
  const data: Datum[] = months.map((m) => ({
    month: m.month,
    Ahorro: m.cumulativeSavingsContribCents,
    Inversion: m.cumulativeInvestmentContribCents,
  }));

  const handleClick = (state: CategoricalChartState) => {
    const label = state?.activeLabel;
    if (onSelectMonth && typeof label === 'string') onSelectMonth(label);
  };

  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart
        data={data}
        margin={{ top: 8, right: 16, bottom: 4, left: 8 }}
        onClick={onSelectMonth ? handleClick : undefined}
        style={onSelectMonth ? { cursor: 'pointer' } : undefined}
      >
        <defs>
          <linearGradient id="gsi-saved" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colors.saved} stopOpacity={0.35} />
            <stop offset="100%" stopColor={colors.saved} stopOpacity={0.04} />
          </linearGradient>
          <linearGradient id="gsi-invested" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colors.invested} stopOpacity={0.35} />
            <stop offset="100%" stopColor={colors.invested} stopOpacity={0.04} />
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
        <Area
          type="monotone"
          dataKey="Ahorro"
          stackId="cum"
          stroke={colors.saved}
          strokeWidth={2}
          fill="url(#gsi-saved)"
          dot={false}
          activeDot={{ r: 3 }}
        />
        <Area
          type="monotone"
          dataKey="Inversion"
          name="Inversión"
          stackId="cum"
          stroke={colors.invested}
          strokeWidth={2}
          fill="url(#gsi-invested)"
          dot={false}
          activeDot={{ r: 3 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
