// Desglose de una tarjeta del dashboard (Gastos o Ingresos): lista los movimientos que la
// componen en el periodo y filtro activos, con su aportacion con signo y el total (que cuadra
// con la tarjeta porque ambos salen de statsService). Solo presentacion: al pulsar un
// movimiento avisa al padre, que abre su ficha de detalle y edicion.
import type { DrillDown, DrillDownKind, DrillDownRole } from '../../services/statsService';
import { formatCents } from '../../lib/money';
import { Modal } from '../common';

interface MovementsDrillDownModalProps {
  open: boolean;
  onClose: () => void;
  kind: DrillDownKind;
  drillDown: DrillDown | null;
  // Nombre de la categoria del filtro cruzado activo (null si no hay filtro).
  filterName: string | null;
  categoryNames: Map<string, string>;
  accountNames: Map<string, string>;
  onSelectMovement: (id: string) => void;
}

const ROLE_BADGE: Partial<Record<DrillDownRole, string>> = {
  refund: 'Reembolso',
  positive: 'Gasto positivo',
};

export function MovementsDrillDownModal({
  open,
  onClose,
  kind,
  drillDown,
  filterName,
  categoryNames,
  accountNames,
  onSelectMovement,
}: MovementsDrillDownModalProps) {
  const title = kind === 'expense' ? 'Gastos del periodo' : 'Ingresos del periodo';
  const items = drillDown?.items ?? [];
  const totalClass = kind === 'expense' ? 'text-orange-400' : 'text-emerald-400';

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="flex items-baseline justify-between gap-3 border-b border-slate-800 pb-3">
        <p className="text-xs text-slate-500">
          {items.length} movimiento(s)
          {filterName !== null && <> · {filterName}</>}
        </p>
        <p className={`text-lg font-semibold tabular-nums ${totalClass}`}>
          {formatCents(drillDown?.totalCents ?? 0)}
        </p>
      </div>

      {items.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">
          {kind === 'expense' ? 'Sin gastos en este periodo.' : 'Sin ingresos en este periodo.'}
        </p>
      ) : (
        <ul className="divide-y divide-slate-800">
          {items.map((it) => {
            const badge = ROLE_BADGE[it.role];
            // En Gastos, lo que suma se ve en naranja y lo que resta (reembolsos, gastos
            // positivos) en verde con signo menos. En Ingresos todo suma.
            const reduces = it.contributionCents < 0;
            const amountClass =
              kind === 'income' ? 'text-emerald-300' : reduces ? 'text-emerald-300' : 'text-orange-300';
            return (
              <li key={it.id}>
                <button
                  type="button"
                  onClick={() => onSelectMovement(it.id)}
                  className="-mx-2 flex w-[calc(100%+1rem)] items-center justify-between gap-3 rounded px-2 py-2 text-left transition-colors hover:bg-slate-800/50"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-slate-200">{it.concept}</p>
                    <p className="truncate text-xs text-slate-500">
                      {it.categoryId ? categoryNames.get(it.categoryId) ?? 'Desconocida' : 'Sin categoria'}
                      {' · '}
                      {accountNames.get(it.accountId) ?? 'Cuenta'}
                      {' · '}
                      {it.date}
                    </p>
                    {badge && (
                      <span className="mt-0.5 inline-block rounded bg-emerald-900/40 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
                        {badge}
                      </span>
                    )}
                  </div>
                  <span className={`shrink-0 text-sm font-medium tabular-nums ${amountClass}`}>
                    {formatCents(it.contributionCents)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-3 text-[11px] text-slate-500">Pulsa un movimiento para ver y editar sus detalles.</p>
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
        >
          Cerrar
        </button>
      </div>
    </Modal>
  );
}
