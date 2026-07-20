// Fila de una tarea en la bandeja de revision. Presentacion pura: seleccion, tipo, motivos,
// confianza y fecha. La accion (ver/resolver) la maneja el contenedor.
import type { ReviewItem } from '../../db/schema';
import { REVIEW_TYPE_LABELS } from '../../services/reviewService';

interface ReviewItemRowProps {
  item: ReviewItem;
  selected: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
}

const LOCALE = 'es-ES';

const TYPE_BADGE_CLASS: Record<ReviewItem['type'], string> = {
  uncategorized: 'bg-slate-700 text-slate-200',
  lowConfidenceRule: 'bg-amber-900 text-amber-200',
  possibleDuplicate: 'bg-orange-900 text-orange-200',
  transferCandidate: 'bg-sky-900 text-sky-200',
  refundCandidate: 'bg-emerald-900 text-emerald-200',
  stalePending: 'bg-purple-900 text-purple-200',
  newMerchant: 'bg-teal-900 text-teal-200',
  importError: 'bg-red-900 text-red-200',
  syncConflict: 'bg-rose-900 text-rose-200',
  recurringAnomaly: 'bg-fuchsia-900 text-fuchsia-200',
};

export function ReviewItemRow({ item, selected, onToggleSelect, onOpen }: ReviewItemRowProps) {
  return (
    <li
      className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2.5 hover:border-slate-700"
      data-testid="review-item-row"
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggleSelect}
        aria-label={`Seleccionar tarea: ${REVIEW_TYPE_LABELS[item.type]}`}
        className="h-4 w-4 rounded border-slate-600 bg-slate-800"
      />
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-left"
      >
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_BADGE_CLASS[item.type]}`}
        >
          {REVIEW_TYPE_LABELS[item.type]}
        </span>
        {item.confidence > 0 && (
          <span className="text-xs text-slate-500">{Math.round(item.confidence / 10)}%</span>
        )}
        {item.reasonCodes.length > 0 && (
          <span className="truncate text-xs text-slate-500">{item.reasonCodes.join(', ')}</span>
        )}
        <span className="ml-auto shrink-0 text-xs text-slate-500">
          {new Date(item.createdAt).toLocaleDateString(LOCALE)}
        </span>
      </button>
    </li>
  );
}
