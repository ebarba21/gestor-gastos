// Tarjeta de un presupuesto evaluado: cabecera (nombre, ambito, periodo), barra de
// progreso con color segun estado e importes (consumido, limite, restante). Solo
// presentacion: recibe la evaluacion ya calculada por budgetService.
import type { BudgetEvaluation, BudgetStatus } from '../../services/budgetService';
import {
  BUDGET_PERIOD_LABELS,
  BUDGET_SCOPE_LABELS,
} from '../../services/budgetService';
import { formatCents } from '../../lib/money';

interface BudgetCardProps {
  evaluation: BudgetEvaluation;
  categoryNames: Map<string, string>;
  accountNames: Map<string, string>;
  onEdit: () => void;
  onDelete: () => void;
}

// Estilos de la barra y de la insignia de estado.
const STATUS_STYLES: Record<BudgetStatus, { bar: string; badge: string; label: string }> = {
  ok: { bar: 'bg-emerald-500', badge: 'bg-emerald-900/40 text-emerald-300', label: 'En curso' },
  warning: { bar: 'bg-amber-500', badge: 'bg-amber-900/40 text-amber-300', label: 'Cerca del límite' },
  exceeded: { bar: 'bg-red-500', badge: 'bg-red-900/50 text-red-300', label: 'Superado' },
  met: { bar: 'bg-emerald-500', badge: 'bg-emerald-900/40 text-emerald-300', label: 'Objetivo alcanzado' },
};

function describeScope(
  evaluation: BudgetEvaluation,
  categoryNames: Map<string, string>,
  accountNames: Map<string, string>,
): string {
  const { scope, scopeId } = evaluation.budget;
  if (scope === 'overall') return BUDGET_SCOPE_LABELS.overall;
  if (scopeId === null) return BUDGET_SCOPE_LABELS[scope];
  if (scope === 'account') {
    return `${BUDGET_SCOPE_LABELS.account}: ${accountNames.get(scopeId) ?? 'desconocida'}`;
  }
  return `${BUDGET_SCOPE_LABELS[scope]}: ${categoryNames.get(scopeId) ?? 'desconocida'}`;
}

export function BudgetCard({
  evaluation,
  categoryNames,
  accountNames,
  onEdit,
  onDelete,
}: BudgetCardProps) {
  const { budget, consumedCents, limitCents, remainingCents, percent, refundCents, status, range } =
    evaluation;
  const styles = STATUS_STYLES[status];
  const isExpense = budget.direction === 'expense';
  // La barra se recorta a [0, 100] para presentacion; el porcentaje real puede excederlo.
  const barPercent = Math.max(0, Math.min(100, percent));

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-slate-100">{budget.name}</h3>
            <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${styles.badge}`}>
              {styles.label}
            </span>
          </div>
          <p className="mt-0.5 truncate text-xs text-slate-500">
            {describeScope(evaluation, categoryNames, accountNames)} ·{' '}
            {isExpense ? 'Límite de gasto' : 'Objetivo de ingreso'} ·{' '}
            {BUDGET_PERIOD_LABELS[budget.period]}
          </p>
        </div>
        <div className="flex shrink-0 gap-1 text-xs">
          <button
            type="button"
            onClick={onEdit}
            className="rounded px-2 py-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
          >
            Editar
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="rounded px-2 py-1 text-red-400 hover:bg-red-950/60"
          >
            Eliminar
          </button>
        </div>
      </div>

      {/* Barra de progreso */}
      <div className="mt-3">
        <div
          className="h-2.5 w-full overflow-hidden rounded-full bg-slate-800"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={barPercent}
          aria-label={`Progreso de ${budget.name}`}
        >
          <div className={`h-full rounded-full ${styles.bar}`} style={{ width: `${barPercent}%` }} />
        </div>
        <div className="mt-1.5 flex items-baseline justify-between text-xs">
          <span className="text-slate-300">
            <strong className="text-slate-100">{formatCents(consumedCents)}</strong>
            <span className="text-slate-500"> / {formatCents(limitCents)}</span>
          </span>
          <span className="font-medium text-slate-400">{percent}%</span>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
        <span>
          {isExpense
            ? remainingCents >= 0
              ? `Quedan ${formatCents(remainingCents)}`
              : `Excedido en ${formatCents(-remainingCents)}`
            : remainingCents > 0
              ? `Faltan ${formatCents(remainingCents)}`
              : `Objetivo alcanzado (+${formatCents(-remainingCents)})`}
        </span>
        {refundCents > 0 && <span title="Reembolsos descontados del gasto">↩ {formatCents(refundCents)}</span>}
      </div>
      <p className="mt-1 text-[11px] text-slate-600">
        {range.from} a {range.to}
      </p>
    </div>
  );
}
