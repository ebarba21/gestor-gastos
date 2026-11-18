// Categorias del mes frente a su media: barra con lo gastado y una raya con lo que solias llevar
// gastado a estas alturas del mes (bullet chart ligero; en un mes cerrado, la media mensual). Barra,
// raya, color y porcentaje usan la misma referencia. Las que van mas de un 15 % por encima de su
// media a estas alturas se pintan en naranja Y llevan el porcentaje escrito. Pulsar una filtra
// el dashboard por ella.
import type { CategoryBullet } from '../../services/insightsService';
import { formatCents } from '../../lib/money';
import { useChartColors } from '../dashboard/chartTheme';

interface CategoryBulletsCardProps {
  bullets: CategoryBullet[];
  categoryNames: Map<string, string>;
  activeCategoryId?: string | null;
  onSelectCategory?: (categoryId: string | null) => void;
}

function statusText(b: CategoryBullet): string | null {
  if (b.status === 'new') return 'nueva';
  if (b.deltaPerMille === null || b.status === 'normal') return null;
  const p = Math.round(Math.abs(b.deltaPerMille) / 10);
  return b.status === 'over' ? `+${p} %` : `-${p} %`;
}

export function CategoryBulletsCard({ bullets, categoryNames, activeCategoryId, onSelectCategory }: CategoryBulletsCardProps) {
  const colors = useChartColors();
  if (bullets.length === 0) {
    return <p className="py-6 text-center text-sm text-slate-500">Sin gasto por categoría este mes.</p>;
  }
  const max = Math.max(...bullets.map((b) => Math.max(b.currentCents, b.averageToDateCents)), 1);
  return (
    <ul className="space-y-2.5">
      {bullets.map((b) => {
        const name = b.categoryId === null ? 'Sin categoría' : categoryNames.get(b.categoryId) ?? 'Categoría';
        const width = Math.max(0, (b.currentCents / max) * 100);
        const mark = (b.averageToDateCents / max) * 100;
        const over = b.status === 'over';
        const text = statusText(b);
        const dimmed = activeCategoryId !== undefined && activeCategoryId !== b.categoryId;
        return (
          <li key={b.categoryId ?? 'none'} className={dimmed ? 'opacity-40' : undefined}>
            <button
              type="button"
              onClick={onSelectCategory ? () => onSelectCategory(b.categoryId) : undefined}
              className="grid w-full grid-cols-[6.5rem_1fr_auto] items-center gap-3 text-left"
              aria-label={`${name}: ${formatCents(b.currentCents)}, a estas alturas sueles llevar ${formatCents(
                b.averageToDateCents,
              )}, media mensual ${formatCents(b.averageCents)}`}
              title={`Media mensual completa: ${formatCents(b.averageCents)}`}
            >
              <span className="truncate text-sm text-slate-200">{name}</span>
              <span className="relative block h-3">
                <span
                  className="absolute left-0 top-0.5 h-2 rounded-r"
                  style={{ width: `${width}%`, backgroundColor: over ? colors.expense : colors.savings }}
                />
                {b.averageToDateCents > 0 && (
                  <span
                    className="absolute -top-0.5 h-4 w-0.5 bg-slate-200"
                    style={{ left: `calc(${mark}% - 1px)` }}
                    aria-hidden
                  />
                )}
              </span>
              <span className="text-right text-xs tabular-nums">
                <span className={over ? 'font-semibold text-slate-100' : 'text-slate-300'}>{formatCents(b.currentCents)}</span>
                {text && <span className={`ml-1.5 ${over ? 'text-orange-400' : 'text-slate-500'}`}>{text}</span>}
              </span>
            </button>
          </li>
        );
      })}
      <li className="pt-1 text-xs text-slate-500">
        Barra = este mes · raya = lo que sueles llevar a estas alturas · naranja = más de un 15 % por encima
      </li>
    </ul>
  );
}
