// "Por que has gastado mas (o menos) que el mes pasado": diferencia frente al mes anterior a la
// misma altura del mes, explicada por categoria. Mas accionable que un "+12 %".
import type { MonthVariance } from '../../services/insightsService';
import { formatCents } from '../../lib/money';

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export function VarianceCard({
  variance,
  catName,
  onSelectCategory,
}: {
  variance: MonthVariance;
  catName: (id: string | null) => string;
  onSelectCategory?: (id: string | null) => void;
}) {
  const prevName = MONTHS[Number(variance.previousMonth.slice(5, 7)) - 1] ?? variance.previousMonth;
  const d = variance.deltaCents;
  return (
    <div>
      <p className="text-sm text-slate-200">
        {d === 0
          ? `Llevas lo mismo que en ${prevName} a estas alturas.`
          : `Llevas ${formatCents(Math.abs(d))} ${d > 0 ? 'mas' : 'menos'} que en ${prevName} a estas alturas`}
        {d !== 0 && <span className="text-slate-500"> ({formatCents(variance.currentCents)} frente a {formatCents(variance.previousCents)})</span>}
      </p>
      {variance.items.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm">
          {variance.items.map((i) => (
            <li key={i.categoryId ?? 'none'}>
              <button
                type="button"
                onClick={onSelectCategory ? () => onSelectCategory(i.categoryId) : undefined}
                disabled={!onSelectCategory}
                className="flex w-full justify-between gap-3 text-left hover:underline disabled:no-underline"
              >
                <span className="text-slate-300">{catName(i.categoryId)}</span>
                <span className={`tabular-nums ${i.deltaCents > 0 ? 'text-amber-300' : 'text-emerald-400'}`}>
                  {i.deltaCents > 0 ? '▲ +' : '▼ '}
                  {formatCents(i.deltaCents)}
                </span>
              </button>
            </li>
          ))}
          {variance.restCents !== 0 && (
            <li className="flex justify-between gap-3 text-slate-500">
              <span>Resto</span>
              <span className="tabular-nums">
                {variance.restCents > 0 ? '+' : ''}
                {formatCents(variance.restCents)}
              </span>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
