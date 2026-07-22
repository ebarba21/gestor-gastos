// Grafico de gasto NETO por categoria (barras horizontales, magnitud). Cada barra usa el
// color propio de su categoria (la identidad la porta el nombre del eje, no solo el color);
// las categorias sin color caen a la paleta de acento. Solo se pintan categorias con gasto
// neto positivo. Serie unica: sin leyenda (el titulo la nombra).
//
// Es el CONTROL del filtro cruzado: pulsar una barra filtra el resto de visuales por esa
// categoria (y vuelve a pulsar para quitarlo). Cuando hay un filtro activo, la barra
// seleccionada se resalta y las demas se atenuan.
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { CategorySpend } from '../../services/statsService';
import { pickAccentColor } from '../../lib/colors';
import { formatCompactEuros, useChartColors } from './chartTheme';
import { MoneyTooltip } from './MoneyTooltip';

interface CategorySpendChartProps {
  byCategory: CategorySpend[];
  categoryNames: Map<string, string>;
  categoryColors: Map<string, string>;
  limit?: number;
  // Categoria del filtro cruzado activo (undefined = sin filtro). null = bucket "sin categoria".
  activeCategoryId?: string | null;
  // Alterna el filtro por la categoria de la barra pulsada.
  onSelectCategory?: (categoryId: string | null) => void;
}

interface Datum {
  categoryId: string | null;
  name: string;
  value: number;
  color: string;
}

export function CategorySpendChart({
  byCategory,
  categoryNames,
  categoryColors,
  limit = 10,
  activeCategoryId,
  onSelectCategory,
}: CategorySpendChartProps) {
  const colors = useChartColors();
  // Solo gasto neto positivo (un neto <= 0 por reembolsos no aporta a un grafico de gasto).
  const positive = byCategory.filter((c) => c.netCents > 0);
  const data: Datum[] = positive.slice(0, limit).map((c, i) => ({
    categoryId: c.categoryId,
    name: c.categoryId === null ? 'Sin categoría' : categoryNames.get(c.categoryId) ?? 'Desconocida',
    value: c.netCents,
    color:
      c.categoryId !== null && categoryColors.has(c.categoryId)
        ? categoryColors.get(c.categoryId)!
        : c.categoryId === null
          ? colors.axis
          : pickAccentColor(i),
  }));

  if (data.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-500">Sin gasto por categoría en este periodo.</p>;
  }

  // Altura proporcional al numero de barras para que no se aplasten en movil.
  const height = Math.max(160, data.length * 40 + 20);
  const hasFilter = activeCategoryId !== undefined;
  const clickable = onSelectCategory !== undefined;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
        <XAxis
          type="number"
          tickFormatter={formatCompactEuros}
          tick={{ fontSize: 11, fill: colors.axis }}
          axisLine={{ stroke: colors.grid }}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="name"
          width={110}
          tick={{ fontSize: 11, fill: colors.axis }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip cursor={{ fill: colors.grid, opacity: 0.4 }} content={<MoneyTooltip />} />
        <Bar
          dataKey="value"
          name="Gasto neto"
          radius={[0, 4, 4, 0]}
          maxBarSize={22}
          cursor={clickable ? 'pointer' : undefined}
          onClick={(d: unknown) => {
            if (!onSelectCategory) return;
            const datum = d as { payload?: Datum };
            if (datum.payload) onSelectCategory(datum.payload.categoryId);
          }}
        >
          {data.map((d, i) => {
            // Con filtro activo, la barra seleccionada mantiene color pleno; el resto se atenua.
            const dimmed = hasFilter && d.categoryId !== activeCategoryId;
            return <Cell key={i} fill={d.color} fillOpacity={dimmed ? 0.3 : 1} />;
          })}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
