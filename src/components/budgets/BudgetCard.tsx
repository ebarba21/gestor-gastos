// Tarjeta de un presupuesto evaluado: cabecera (nombre, ambito, periodo), barra de
// progreso con color segun estado e importes (consumido, limite, restante). Solo
// presentacion: recibe la evaluacion ya calculada por budgetService.
import type { BudgetEvaluation, BudgetStatus } from '../../services/budgetService';
import {
  BUDGET_KIND_LABELS,
  BUDGET_PERIOD_LABELS,
  BUDGET_SCOPE_LABELS,
  paceTargetCents,
  periodElapsedPerMille,
  type GoalStatus,
} from '../../services/budgetService';
import { formatCents } from '../../lib/money';
import { todayISO } from '../../lib/dates';

interface BudgetCardProps {
  evaluation: BudgetEvaluation;
  categoryNames: Map<string, string>;
  accountNames: Map<string, string>;
  onEdit: () => void;
  onDelete: () => void;
  today?: string; // inyectable en tests; por defecto hoy
}

// Estilos de la barra y de la insignia de estado.
const STATUS_STYLES: Record<BudgetStatus, { bar: string; badge: string; label: string }> = {
  ok: { bar: 'bg-emerald-500', badge: 'bg-emerald-900/40 text-emerald-300', label: 'En curso' },
  warning: { bar: 'bg-amber-500', badge: 'bg-amber-900/40 text-amber-300', label: 'Cerca del límite' },
  exceeded: { bar: 'bg-red-500', badge: 'bg-red-900/50 text-red-300', label: 'Superado' },
  met: { bar: 'bg-emerald-500', badge: 'bg-emerald-900/40 text-emerald-300', label: 'Objetivo alcanzado' },
};

const GOAL_STATUS: Record<GoalStatus, { label: string; badge: string }> = {
  met: { label: 'Conseguido', badge: 'bg-emerald-900/40 text-emerald-300' },
  onTrack: { label: 'Vas a tiempo', badge: 'bg-emerald-900/40 text-emerald-300' },
  behind: { label: 'Vas con retraso', badge: 'bg-amber-900/40 text-amber-300' },
  noPace: { label: 'Sin aportaciones aún', badge: 'bg-slate-800 text-slate-300' },
  overdue: { label: 'Fecha pasada', badge: 'bg-amber-900/40 text-amber-300' },
};

// Fecha YYYY-MM-DD como "marzo de 2027".
function monthYear(iso: string): string {
  const [y, m] = iso.split('-');
  return new Date(Date.UTC(Number(y), Number(m) - 1, 1)).toLocaleDateString('es-ES', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function Bar({ percent, className, label }: { percent: number; className: string; label: string }) {
  const p = Math.max(0, Math.min(100, percent));
  return (
    <div
      className="h-2.5 w-full overflow-hidden rounded-full bg-slate-800"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={p}
      aria-label={label}
    >
      <div className={`h-full rounded-full ${className}`} style={{ width: `${p}%` }} />
    </div>
  );
}

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
  today = todayISO(),
}: BudgetCardProps) {
  const { budget, consumedCents, limitCents, remainingCents, percent, refundCents, status, range } =
    evaluation;
  const styles = STATUS_STYLES[status];
  const isExpense = budget.direction === 'expense';
  const actions = (
    <div className="flex shrink-0 gap-1 text-xs">
      <button
        type="button"
        onClick={onEdit}
        className="rounded px-2 py-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
      >
        Editar
      </button>
      <button type="button" onClick={onDelete} className="rounded px-2 py-1 text-slate-400 hover:bg-slate-800">
        Eliminar
      </button>
    </div>
  );

  if (evaluation.goal) {
    const g = evaluation.goal;
    const gs = GOAL_STATUS[g.status];
    const pct = g.targetCents > 0 ? Math.round((g.savedCents * 100) / g.targetCents) : 0;
    return (
      <div className="min-w-0 rounded-xl border border-slate-800 bg-slate-900 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-sm font-semibold text-slate-100">{budget.name}</h3>
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${gs.badge}`}>{gs.label}</span>
            </div>
            <p className="mt-0.5 truncate text-xs text-slate-500">
              {BUDGET_KIND_LABELS.goal} · {describeScope(evaluation, categoryNames, accountNames)} · hasta{' '}
              {g.targetDate}
            </p>
          </div>
          {actions}
        </div>
        <div className="mt-3">
          <Bar percent={pct} className="bg-indigo-500" label={`Progreso de ${budget.name}`} />
          <div className="mt-1.5 flex items-baseline justify-between text-xs">
            <span className="text-slate-300">
              <strong className="text-slate-100">{formatCents(g.savedCents)}</strong>
              <span className="text-slate-500"> / {formatCents(g.targetCents)}</span>
            </span>
            <span className="font-medium text-slate-400">{pct}%</span>
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-300">
          {g.status === 'met'
            ? 'Objetivo conseguido.'
            : g.status === 'overdue'
              ? `La fecha ya pasó; faltan ${formatCents(g.remainingCents)}.`
              : g.etaISO !== null
                ? `A tu ritmo (${formatCents(g.paceMonthlyCents ?? 0)}/mes) llegarás en ${monthYear(g.etaISO)}${
                    g.status === 'onTrack' ? ', a tiempo.' : ', después de la fecha objetivo.'
                  }`
                : 'Aún no hay aportaciones desde el inicio.'}
        </p>
        {g.status !== 'met' && g.status !== 'overdue' && (
          <p className="mt-1 text-xs text-slate-500">
            Para llegar a tiempo: {formatCents(g.requiredMonthlyCents)} al mes durante {g.monthsLeft}{' '}
            {g.monthsLeft === 1 ? 'mes' : 'meses'}.
            {g.pendingThisMonthCents > 0 ? ` Este mes faltan ${formatCents(g.pendingThisMonthCents)}.` : ''}
          </p>
        )}
      </div>
    );
  }

  if (evaluation.fund) {
    const f = evaluation.fund;
    const pct = budget.limitCents > 0 ? Math.round((f.provisionedCents * 100) / budget.limitCents) : 0;
    return (
      <div className="min-w-0 rounded-xl border border-slate-800 bg-slate-900 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-slate-100">{budget.name}</h3>
            <p className="mt-0.5 truncate text-xs text-slate-500">
              {BUDGET_KIND_LABELS.fund} · {describeScope(evaluation, categoryNames, accountNames)} · vence el {f.dueDate}
            </p>
          </div>
          {actions}
        </div>
        <div className="mt-3">
          <Bar percent={pct} className="bg-sky-500" label={`Apartado para ${budget.name}`} />
          <div className="mt-1.5 flex items-baseline justify-between text-xs">
            <span className="text-slate-300">
              Apartado <strong className="text-slate-100">{formatCents(f.provisionedCents)}</strong>
              <span className="text-slate-500"> / {formatCents(budget.limitCents)}</span>
            </span>
            <span className="text-slate-400">{formatCents(f.monthlyProvisionCents)}/mes</span>
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          {f.spentCents > 0 ? `Ya gastado este ciclo: ${formatCents(f.spentCents)}. ` : ''}
          Reservado y sin gastar: {formatCents(f.earmarkedCents)} (no cuenta en tu disponible).
        </p>
      </div>
    );
  }
  // La barra se recorta a [0, 100] para presentacion; el porcentaje real puede excederlo.
  const barPercent = Math.max(0, Math.min(100, percent));
  // Marca de ritmo: lo que llevarias gastado a ritmo constante hoy. Solo en limites de gasto del
  // periodo en curso con limite positivo.
  const elapsed = isExpense && evaluation.effectiveLimitCents > 0 ? periodElapsedPerMille(range, today) : null;
  const paceCents = elapsed !== null ? paceTargetCents(evaluation.effectiveLimitCents, elapsed) : null;
  const vsPace = paceCents !== null ? consumedCents - paceCents : null;

  return (
    <div className="min-w-0 rounded-xl border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-slate-100">{budget.name}</h3>
            <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${styles.badge}`}>
              {styles.label}
            </span>
          </div>
          <p className="mt-0.5 truncate text-xs text-slate-500">
            {evaluation.kind === 'flex'
              ? 'Gasto variable (sin recibos fijos)'
              : `${describeScope(evaluation, categoryNames, accountNames)} · ${isExpense ? 'Límite de gasto' : 'Objetivo de ingreso'}`}{' '}
            · {BUDGET_PERIOD_LABELS[budget.period]}
            {budget.rollover ? ' · acumula' : ''}
          </p>
        </div>
        {actions}
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
        {elapsed !== null && (
          <div className="relative h-0" aria-hidden="true">
            {/* Raya del ritmo de hoy, encima de la barra. */}
            <span
              className="absolute -top-3.5 h-4 w-0.5 rounded bg-slate-200"
              style={{ left: `calc(${Math.min(100, elapsed / 10)}% - 1px)` }}
            />
          </div>
        )}
        <div className="mt-1.5 flex items-baseline justify-between text-xs">
          <span className="text-slate-300">
            <strong className="text-slate-100">{formatCents(consumedCents)}</strong>
            <span className="text-slate-500"> / {formatCents(evaluation.effectiveLimitCents)}</span>
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
        {refundCents > 0 && <span title="Reembolsos y gastos positivos descontados del gasto">↩ {formatCents(refundCents)}</span>}
      </div>
      {paceCents !== null && vsPace !== null && (
        <p className="mt-1 text-xs text-slate-400">
          <span aria-hidden="true">▏</span>Ritmo de hoy: {formatCents(paceCents)} ({Math.round(elapsed! / 10)} % del periodo).{' '}
          {Math.abs(vsPace) < 100
            ? 'Vas justo al ritmo.'
            : vsPace > 0
              ? `Vas ${formatCents(vsPace)} por encima del ritmo.`
              : `Vas ${formatCents(-vsPace)} por debajo del ritmo.`}
        </p>
      )}
      {evaluation.carryCents !== 0 && (
        <p className="mt-1 text-xs text-slate-500">
          {evaluation.carryCents > 0
            ? `Incluye ${formatCents(evaluation.carryCents)} que sobraron de periodos anteriores (límite base ${formatCents(limitCents)}).`
            : `Se descuentan ${formatCents(-evaluation.carryCents)} que te pasaste en periodos anteriores (límite base ${formatCents(limitCents)}).`}
        </p>
      )}
      <p className="mt-1 text-[11px] text-slate-600">
        {range.from} a {range.to}
      </p>
    </div>
  );
}
