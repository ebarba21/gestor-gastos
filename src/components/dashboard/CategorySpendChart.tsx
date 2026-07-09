// Grafico de gasto NETO por categoria (barras horizontales, magnitud). Cada barra usa el
// color propio de su categoria (la identidad la porta el nombre del eje, no solo el color);
// las categorias sin color caen a la paleta de acento. Solo se pintan categorias con gasto
// neto positivo. Serie unica: sin leyenda (el titulo la nombra).
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { CategorySpend } from '../../services/statsService';
import { pickAccentColor } from '../../lib/colors';
import { CHART_COLORS, formatCompactEuros } from './chartTheme';
import { MoneyTooltip } from './MoneyTooltip';

interface CategorySpendChartProps {
  byCategory: CategorySpend[];
  categoryNames: Map<string, string>;
  categoryColors: Map<string, string>;
  limit?: number;
}

interface Datum {
  name: string;
  value: number;
  color: string;
}

export function CategorySpendChart({
  byCategory,
  categoryNames,
  categoryColors,
  limit = 10,
}: CategorySpendChartProps) {
  // Solo gasto neto positivo (un neto <= 0 por reembolsos no aporta a un grafico de gasto).
  const positive = byCategory.filter((c) => c.netCents > 0);
  const data: Datum[] = positive.slice(0, limit).map((c, i) => ({
    name: c.categoryId === null ? 'Sin categoria' : categoryNames.get(c.categoryId) ?? 'Desconocida',
    value: c.netCents,
    color:
      c.categoryId !== null && categoryColors.has(c.categoryId)
        ? categoryColors.get(c.categoryId)!
        : c.categoryId === null
          ? CHART_COLORS.axis
          : pickAccentColor(i),
  }));

  if (data.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-500">Sin gasto por categoria en este periodo.</p>;
  }

  // Altura proporcional al numero de barras para que no se aplasten en movil.
  const height = Math.max(160, data.length * 40 + 20);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
        <XAxis
          type="number"
          tickFormatter={formatCompactEuros}
          tick={{ fontSize: 11, fill: CHART_COLORS.axis }}
          axisLine={{ stroke: CHART_COLORS.grid }}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="name"
          width={110}
          tick={{ fontSize: 11, fill: CHART_COLORS.axis }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          cursor={{ fill: CHART_COLORS.grid, opacity: 0.4 }}
          content={<MoneyTooltip />}
        />
        <Bar dataKey="value" name="Gasto neto" radius={[0, 4, 4, 0]} maxBarSize={22}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
