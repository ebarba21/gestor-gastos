// "Por que has gastado mas (o menos) que el mes pasado": diferencia frente al mes anterior a la
// misma altura del mes, explicada por categoria. Mas accionable que un "+12 %".
import type { MonthVariance, VarianceDriver, YearAgoComparison } from '../../services/insightsService';
import { formatCents } from '../../lib/money';

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// Nombre legible del comercio que explica una variacion (o su concepto si no tiene comercio).
function driverLabel(d: VarianceDriver, merchantNames?: Map<string, string>): string {
  if (d.merchantId !== null) return merchantNames?.get(d.merchantId) ?? d.concept;
  return d.concept;
}

export function VarianceCard({
  variance,
  catName,
  onSelectCategory,
  merchantNames,
  yearAgo,
}: {
  variance: MonthVariance;
  catName: (id: string | null) => string;
  onSelectCategory?: (id: string | null) => void;
  merchantNames?: Map<string, string>;
  yearAgo?: YearAgoComparison | null;
}) {
  const prevName = MONTHS[Number(variance.previousMonth.slice(5, 7)) - 1] ?? variance.previousMonth;
  const d = variance.deltaCents;
  return (
    <div>
      <p className="text-sm text-slate-200">
        {d === 0
          ? `Llevas lo mismo que en ${prevName} a estas alturas.`
          : `Llevas ${formatCents(Math.abs(d))} ${d > 0 ? 'más' : 'menos'} que en ${prevName} a estas alturas`}
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
              {i.driver && (
                <p className="pl-3 text-xs text-slate-500">
                  {i.driver.sharePerMille >= 1000
                    ? `Todo viene de ${driverLabel(i.driver, merchantNames)}`
                    : `El ${Math.round(i.driver.sharePerMille / 10)} % viene de ${driverLabel(i.driver, merchantNames)}`}{' '}
                  ({i.driver.deltaCents > 0 ? '+' : ''}
                  {formatCents(i.driver.deltaCents)})
                </p>
              )}
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
      {yearAgo && (
        <p className="mt-3 border-t border-slate-800 pt-2 text-xs text-slate-400">
          Frente a {MONTHS[Number(yearAgo.month.slice(5, 7)) - 1]} de {yearAgo.month.slice(0, 4)} a estas alturas:{' '}
          <span className="tabular-nums text-slate-300">
            {yearAgo.deltaCents === 0
              ? 'lo mismo'
              : `${formatCents(Math.abs(yearAgo.deltaCents))} ${yearAgo.deltaCents > 0 ? 'más' : 'menos'}`}
          </span>{' '}
          ({formatCents(yearAgo.currentCents)} frente a {formatCents(yearAgo.previousCents)}).
        </p>
      )}
    </div>
  );
}
