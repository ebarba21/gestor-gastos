// Tooltip monetario reutilizable para los graficos Recharts. Formatea cada serie en euros
// (desde centimos enteros) y muestra su color y nombre. El texto usa tokens de tinta
// (slate), nunca el color de la serie: el punto de color junto al valor porta la identidad.
import type { TooltipProps } from 'recharts';
import { formatCents } from '../../lib/money';
import { CHART_COLORS } from './chartTheme';

interface MoneyTooltipProps extends TooltipProps<number, string> {
  // Etiqueta a mostrar como titulo (por defecto la label del eje X).
  labelFormatter?: (label: string) => string;
}

export function MoneyTooltip({ active, payload, label, labelFormatter }: MoneyTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const title = labelFormatter ? labelFormatter(String(label ?? '')) : String(label ?? '');
  return (
    <div
      className="rounded-lg border px-3 py-2 text-xs shadow-lg"
      style={{ backgroundColor: CHART_COLORS.tooltipBg, borderColor: CHART_COLORS.tooltipBorder }}
    >
      {title && <p className="mb-1 font-medium text-slate-200">{title}</p>}
      <ul className="space-y-0.5">
        {payload.map((entry, i) => (
          <li key={`${entry.name}-${i}`} className="flex items-center gap-2">
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: entry.color ?? CHART_COLORS.axis }}
              aria-hidden
            />
            <span className="text-slate-400">{entry.name}</span>
            <span className="ml-auto font-medium text-slate-100">
              {typeof entry.value === 'number' ? formatCents(entry.value) : '-'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
