// Selector de periodo del dashboard: modo "mes" (con navegacion entre meses y boton "Hoy")
// o "rango personalizado" (dos fechas). Solo presentacion e interaccion; el hook decide el
// rango efectivo. Responsive: se apila en movil y se alinea en fila en pantallas anchas.
import type { DashboardPeriodMode } from '../../hooks/useDashboard';

interface PeriodSelectorProps {
  mode: DashboardPeriodMode;
  setMode: (mode: DashboardPeriodMode) => void;
  referenceISO: string;
  setReferenceMonths: (delta: number) => void;
  resetReference: () => void;
  customFrom: string;
  customTo: string;
  setCustomFrom: (iso: string) => void;
  setCustomTo: (iso: string) => void;
}

// Etiqueta del mes de referencia (p. ej. "Julio 2026") a partir del YYYY-MM-DD.
function monthLabel(referenceISO: string): string {
  const [y, m] = referenceISO.split('-');
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, 1));
  const label = date.toLocaleDateString('es-ES', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function modeButtonClass(active: boolean): string {
  return [
    'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
    active ? 'bg-slate-800 text-white' : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200',
  ].join(' ');
}

export function PeriodSelector({
  mode,
  setMode,
  referenceISO,
  setReferenceMonths,
  resetReference,
  customFrom,
  customTo,
  setCustomFrom,
  setCustomTo,
}: PeriodSelectorProps) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3 sm:flex-row sm:items-center sm:justify-between">
      {/* Conmutador de modo */}
      <div className="inline-flex rounded-lg bg-slate-950 p-0.5">
        <button type="button" className={modeButtonClass(mode === 'month')} onClick={() => setMode('month')}>
          Por mes
        </button>
        <button type="button" className={modeButtonClass(mode === 'custom')} onClick={() => setMode('custom')}>
          Rango
        </button>
      </div>

      {mode === 'month' ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setReferenceMonths(-1)}
            className="rounded-lg border border-slate-700 px-2.5 py-1 text-sm text-slate-300 hover:bg-slate-800"
            aria-label="Mes anterior"
          >
            ‹
          </button>
          <span className="min-w-[9rem] text-center text-sm font-medium text-slate-200">
            {monthLabel(referenceISO)}
          </span>
          <button
            type="button"
            onClick={() => setReferenceMonths(1)}
            className="rounded-lg border border-slate-700 px-2.5 py-1 text-sm text-slate-300 hover:bg-slate-800"
            aria-label="Mes siguiente"
          >
            ›
          </button>
          <button
            type="button"
            onClick={resetReference}
            className="rounded-lg px-2 py-1 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200"
          >
            Hoy
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-1.5 text-slate-400">
            Desde
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-slate-200"
            />
          </label>
          <label className="flex items-center gap-1.5 text-slate-400">
            Hasta
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-slate-200"
            />
          </label>
        </div>
      )}
    </div>
  );
}
