// Calendario de gasto diario: cada dia del mes coloreado segun su gasto neto frente a tu media
// diaria de los 3 meses anteriores (una sola gama de color, de menos a mas). Los dias sin gasto
// quedan vacios y los futuros, sin pintar. El importe se lee al pasar o pulsar el dia.
import type { Heatmap } from '../../services/insightsService';
import { formatCents } from '../../lib/money';

interface HeatmapCardProps {
  heatmap: Heatmap;
}

const WEEKDAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const LEVEL_CLASS: Record<number, string> = {
  0: 'bg-slate-800/60 text-slate-500',
  1: 'bg-indigo-500/20 text-slate-200',
  2: 'bg-indigo-500/40 text-slate-100',
  3: 'bg-indigo-500/65 text-white',
  4: 'bg-indigo-500 text-white',
};
const LEVEL_LABEL: Record<number, string> = {
  0: 'sin gasto',
  1: 'menos de la mitad de tu media',
  2: 'por debajo de tu media',
  3: 'hasta el doble de tu media',
  4: 'más del doble de tu media',
};

export function HeatmapCard({ heatmap }: HeatmapCardProps) {
  const first = heatmap.days[0];
  const offset = first ? first.weekday : 0;
  return (
    <div className="max-w-sm">
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-slate-500">
        {WEEKDAYS.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {Array.from({ length: offset }, (_, i) => (
          <span key={`pad-${i}`} />
        ))}
        {heatmap.days.map((d) => {
          const cls = d.level === null ? 'border border-dashed border-slate-800 text-slate-600' : LEVEL_CLASS[d.level];
          const title =
            d.netCents === null
              ? `${d.day}: aún no ha llegado`
              : `${d.day}: ${formatCents(Math.max(0, d.netCents))} (${LEVEL_LABEL[d.level ?? 0]})`;
          return (
            <span
              key={d.date}
              title={title}
              aria-label={title}
              className={`flex aspect-square items-center justify-center rounded-md text-[11px] tabular-nums ${cls}`}
            >
              {d.day}
            </span>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span>Menos</span>
        {[0, 1, 2, 3, 4].map((l) => (
          <span key={l} className={`h-3 w-3 rounded-sm ${LEVEL_CLASS[l]!.split(' ')[0]}`} aria-hidden />
        ))}
        <span>Más</span>
        {heatmap.averageDailyCents !== null && <span>· media diaria {formatCents(heatmap.averageDailyCents)}</span>}
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {heatmap.zeroSpendDays} {heatmap.zeroSpendDays === 1 ? 'día' : 'días'} sin gasto
        {heatmap.biggestDay &&
          ` · día de más gasto: ${Number(heatmap.biggestDay.date.slice(8))} (${formatCents(heatmap.biggestDay.netCents)})`}
      </p>
    </div>
  );
}
