// Paso final del asistente de importacion: resumen de resultados y navegacion segun el
// flujo posterior a importar (ARCHITECTURE seccion 17): Importar -> Revisar excepciones
// (bandeja) -> Conciliar -> Ver resultados. Si el lote no genero tareas, se puede ir directo a
// conciliacion; el enlace al listado de movimientos llega ya filtrado por este lote.
import { Link } from 'react-router-dom';
import type { ReviewItemType } from '../../db/schema';
import { REVIEW_TYPE_LABELS } from '../../services/reviewService';
import { formatCents } from '../../lib/money';

export interface ImportSummaryData {
  batchId: string;
  fileName: string;
  rowsTotal: number;
  imported: number;
  linked: number;
  skippedDuplicate: number;
  errors: number;
  categorized: number;
  merchantsMatched: number;
  netEffectCents: number;
  reviewTotal: number;
  reviewByType: Partial<Record<ReviewItemType, number>>;
}

interface ImportSummaryStepProps {
  summary: ImportSummaryData;
  locale: string;
  currency: string;
  onImportAnother: () => void;
}

export function ImportSummaryStep({
  summary,
  locale,
  currency,
  onImportAnother,
}: ImportSummaryStepProps) {
  const reviewEntries = Object.entries(summary.reviewByType) as [ReviewItemType, number][];

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
        <h3 className="text-lg font-semibold text-slate-100">Resumen de la importación</h3>
        <p className="mt-1 text-sm text-slate-400">{summary.fileName}</p>

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
          <SummaryStat label="Filas leidas" value={summary.rowsTotal} />
          <SummaryStat label="Importados" value={summary.imported} />
          <SummaryStat label="Vinculados" value={summary.linked} />
          <SummaryStat label="Duplicados omitidos" value={summary.skippedDuplicate} />
          <SummaryStat label="Errores de fila" value={summary.errors} />
          <SummaryStat label="Categorizados" value={summary.categorized} />
          <SummaryStat label="Con comercio asociado" value={summary.merchantsMatched} />
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Efecto en saldo</dt>
            <dd
              className={
                summary.netEffectCents >= 0 ? 'text-base font-semibold text-emerald-400' : 'text-base font-semibold text-red-400'
              }
            >
              {formatCents(summary.netEffectCents, locale, currency)}
            </dd>
          </div>
        </dl>
      </div>

      {summary.reviewTotal > 0 ? (
        <div className="rounded-2xl border border-amber-800 bg-amber-950/30 p-6">
          <h3 className="text-lg font-semibold text-amber-200">
            {summary.reviewTotal} tarea(s) para revisar
          </h3>
          <ul className="mt-2 space-y-1 text-sm text-amber-100">
            {reviewEntries.map(([type, count]) => (
              <li key={type}>
                {REVIEW_TYPE_LABELS[type]}: <strong>{count}</strong>
              </li>
            ))}
          </ul>
          <Link
            to="/bandeja"
            className="mt-4 inline-block rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-amber-950 hover:bg-amber-400"
          >
            Revisar excepciones ahora
          </Link>
        </div>
      ) : (
        <div className="rounded-2xl border border-emerald-800 bg-emerald-950/30 p-6">
          <h3 className="text-lg font-semibold text-emerald-200">
            Sin excepciones pendientes de revisar
          </h3>
          <p className="mt-1 text-sm text-emerald-100">
            Puedes continuar directamente a conciliar la cuenta o ver los movimientos importados.
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <Link
          to="/conciliacion"
          className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800"
        >
          Ir a conciliación
        </Link>
        <Link
          to={`/movimientos?importBatchId=${summary.batchId}`}
          className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800"
        >
          Ver movimientos importados
        </Link>
        <button
          type="button"
          onClick={onImportAnother}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
        >
          Importar otro fichero
        </button>
      </div>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="text-base font-semibold text-slate-100">{value}</dd>
    </div>
  );
}
