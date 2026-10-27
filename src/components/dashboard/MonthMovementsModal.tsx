// Desglose de un mes de la evolucion mensual: los movimientos que componen sus Ingresos y su
// Gasto neto, con los tres totales del grafico (ingresos, gastos y ahorro neto). Solo
// presentacion: todo sale de statsService y cuadra con el punto pulsado. No toca el periodo
// ni los filtros del dashboard.
import type { DrillDown, DrillDownItem, DrillDownKind, DrillDownRole } from '../../services/statsService';
import { formatCents } from '../../lib/money';
import { Modal } from '../common';

interface MonthMovementsModalProps {
  open: boolean;
  onClose: () => void;
  monthLabel: string;
  drillDown: Record<DrillDownKind, DrillDown> | null;
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

function MovementList({
  kind,
  items,
  categoryNames,
  accountNames,
  onSelectMovement,
}: {
  kind: DrillDownKind;
  items: DrillDownItem[];
  categoryNames: Map<string, string>;
  accountNames: Map<string, string>;
  onSelectMovement: (id: string) => void;
}) {
  if (items.length === 0) {
    return (
      <p className="py-3 text-sm text-slate-500">
        {kind === 'expense' ? 'Sin gastos este mes.' : 'Sin ingresos este mes.'}
      </p>
    );
  }
  return (
    <ul className="divide-y divide-slate-800">
      {items.map((it) => {
        const badge = ROLE_BADGE[it.role];
        // En Gastos lo que suma va en naranja y lo que resta (reembolsos, gastos positivos)
        // en verde con signo menos. En Ingresos todo suma.
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
  );
}

export function MonthMovementsModal({
  open,
  onClose,
  monthLabel,
  drillDown,
  filterName,
  categoryNames,
  accountNames,
  onSelectMovement,
}: MonthMovementsModalProps) {
  const income = drillDown?.income ?? { items: [], totalCents: 0 };
  const expense = drillDown?.expense ?? { items: [], totalCents: 0 };
  const net = income.totalCents - expense.totalCents;

  return (
    <Modal open={open} onClose={onClose} title={`Movimientos de ${monthLabel}`}>
      <div className="grid grid-cols-3 gap-2 border-b border-slate-800 pb-3">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-slate-500">Ingresos</p>
          <p className="text-sm font-semibold tabular-nums text-emerald-400">{formatCents(income.totalCents)}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-slate-500">Gastos</p>
          <p className="text-sm font-semibold tabular-nums text-orange-400">{formatCents(expense.totalCents)}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-slate-500">Ahorro neto</p>
          <p className={`text-sm font-semibold tabular-nums ${net >= 0 ? 'text-indigo-300' : 'text-red-400'}`}>
            {formatCents(net)}
          </p>
        </div>
      </div>
      {filterName !== null && <p className="mt-2 text-xs text-slate-500">Filtrando por {filterName}</p>}

      <h4 className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">
        Ingresos · {income.items.length}
      </h4>
      <MovementList
        kind="income"
        items={income.items}
        categoryNames={categoryNames}
        accountNames={accountNames}
        onSelectMovement={onSelectMovement}
      />

      <h4 className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">
        Gastos · {expense.items.length}
      </h4>
      <MovementList
        kind="expense"
        items={expense.items}
        categoryNames={categoryNames}
        accountNames={accountNames}
        onSelectMovement={onSelectMovement}
      />

      <p className="mt-3 text-[11px] text-slate-500">
        Los traspasos a Ahorro e Inversión no son gasto: se ven en los gráficos de ese apartado.
        Pulsa un movimiento para ver y editar sus detalles.
      </p>
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
