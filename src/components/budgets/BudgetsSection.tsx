// Seccion Presupuestos y metas: navegacion por periodo, lista de presupuestos evaluados
// con su barra de progreso, y CRUD (crear, editar, eliminar). La logica de calculo vive en
// budgetService (reutilizando statsService); aqui solo hay presentacion e interaccion.
import { useMemo, useState } from 'react';
import type { Budget, BudgetKind } from '../../db/schema';
import { useBudgets } from '../../hooks/useBudgets';
import { budgetService } from '../../services/budgetService';
import { formatCents } from '../../lib/money';
import { EmptyState, ConfirmDialog, type DialogButton } from '../common';
import { useToast } from '../../context/ToastContext';
import { BudgetCard } from './BudgetCard';
import { BudgetFormModal } from './BudgetFormModal';

// Etiqueta del periodo de referencia (mes y ano) a partir del YYYY-MM-DD.
function referenceLabel(referenceISO: string): string {
  const [y, m] = referenceISO.split('-');
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, 1));
  const label = date.toLocaleDateString('es-ES', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function BudgetsSection() {
  const {
    profileId,
    referenceISO,
    setReferenceMonths,
    resetReference,
    evaluations,
    flexPlan,
    categoryTree,
    accounts,
    categoryNames,
    accountNames,
    loading,
    error,
    reload,
  } = useBudgets();
  const { showToast } = useToast();
  const [createKind, setCreateKind] = useState<BudgetKind | null>(null);
  const createOpen = createKind !== null;
  const setCreateOpen = (open: boolean) => setCreateKind(open ? 'limit' : null);
  const hasFlex = evaluations.some((e) => e.kind === 'flex');
  const groups = useMemo(
    () => [
      { title: 'Gasto flexible y limites', items: evaluations.filter((e) => e.kind === 'flex' || e.kind === 'limit') },
      { title: 'Objetivos de ahorro', items: evaluations.filter((e) => e.kind === 'goal') },
      { title: 'Fondos para gastos no mensuales', items: evaluations.filter((e) => e.kind === 'fund') },
    ],
    [evaluations],
  );
  const [editing, setEditing] = useState<Budget | null>(null);
  const [deleting, setDeleting] = useState<Budget | null>(null);

  // Resumen agregado: cuantos superados y cuantos objetivos alcanzados.
  const summary = useMemo(() => {
    let exceeded = 0;
    let met = 0;
    for (const ev of evaluations) {
      if (ev.status === 'exceeded') exceeded += 1;
      if (ev.status === 'met') met += 1;
    }
    return { exceeded, met, total: evaluations.length };
  }, [evaluations]);

  const deleteButtons: DialogButton[] = deleting
    ? [
        { label: 'Cancelar', variant: 'ghost' },
        {
          label: 'Eliminar',
          variant: 'danger',
          onClick: async () => {
            await budgetService.remove(profileId, deleting.id);
            showToast('Presupuesto eliminado.', 'success');
            await reload();
          },
        },
      ]
    : [];

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-semibold text-slate-100">Presupuestos, objetivos y fondos</h2>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
        >
          Nuevo
        </button>
      </div>

      {flexPlan && flexPlan.typicalIncomeCents !== null && (
        <div className="mb-4 rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h3 className="text-sm font-semibold text-slate-100">Tu plan del mes</h3>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-slate-500">Ingreso habitual</dt>
              <dd className="tabular-nums text-slate-200">{formatCents(flexPlan.typicalIncomeCents)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Recibos fijos</dt>
              <dd className="tabular-nums text-slate-200">-{formatCents(flexPlan.fixedMonthlyCents)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Fondos</dt>
              <dd className="tabular-nums text-slate-200">-{formatCents(flexPlan.fundsMonthlyCents)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Objetivos</dt>
              <dd className="tabular-nums text-slate-200">-{formatCents(flexPlan.goalsMonthlyCents)}</dd>
            </div>
          </dl>
          <p className="mt-3 text-sm text-slate-300">
            Para tu gasto variable quedan unos{' '}
            <strong className="text-slate-100">{formatCents(flexPlan.suggestedFlexCents ?? 0)}</strong> al mes.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {!hasFlex && (
              <button
                type="button"
                onClick={() => setCreateKind('flex')}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
              >
                Crear presupuesto flexible
              </button>
            )}
            <button
              type="button"
              onClick={() => setCreateKind('goal')}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
            >
              Nuevo objetivo
            </button>
            <button
              type="button"
              onClick={() => setCreateKind('fund')}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
            >
              Nuevo fondo
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Ingreso habitual: mediana de tus nominas de los ultimos 6 meses. Recibos fijos: recurrencias confirmadas
            (las anuales, divididas entre 12).
          </p>
        </div>
      )}

      {/* Navegador de periodo de referencia */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setReferenceMonths(-1)}
          className="rounded-lg border border-slate-700 px-2.5 py-1 text-sm text-slate-300 hover:bg-slate-800"
          aria-label="Mes anterior"
        >
          ‹
        </button>
        <span className="min-w-[10rem] text-center text-sm font-medium text-slate-200">
          {referenceLabel(referenceISO)}
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
        <p className="ml-auto text-xs text-slate-500">
          Los periodos mensuales, trimestrales y anuales se calculan respecto a este mes. Los
          personalizados usan sus fechas fijas.
        </p>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {loading ? (
        <p className="text-sm text-slate-500">Cargando...</p>
      ) : evaluations.length === 0 ? (
        <EmptyState
          icon="🎯"
          title="Sin presupuestos, objetivos ni fondos"
          description="Empieza por un presupuesto flexible para tu gasto variable; anade objetivos con fecha y fondos para los gastos que no son mensuales."
          action={
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
            >
              Crear primer presupuesto
            </button>
          }
        />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-4 text-xs text-slate-400">
            <span>
              <strong className="text-slate-200">{summary.total}</strong> presupuestos
            </span>
            {summary.exceeded > 0 && (
              <span className="text-red-400">
                <strong>{summary.exceeded}</strong> superados
              </span>
            )}
            {summary.met > 0 && (
              <span className="text-emerald-400">
                <strong>{summary.met}</strong> objetivos alcanzados
              </span>
            )}
          </div>
          {groups
            .filter((g) => g.items.length > 0)
            .map((g) => (
              <div key={g.title} className="mb-5">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{g.title}</h3>
                <div className="grid gap-3 md:grid-cols-2">
                  {g.items.map((ev) => (
                    <BudgetCard
                      key={ev.budget.id}
                      evaluation={ev}
                      categoryNames={categoryNames}
                      accountNames={accountNames}
                      onEdit={() => setEditing(ev.budget)}
                      onDelete={() => setDeleting(ev.budget)}
                    />
                  ))}
                </div>
              </div>
            ))}
        </>
      )}

      <BudgetFormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        profileId={profileId}
        onSaved={reload}
        categoryTree={categoryTree}
        accounts={accounts}
        initialKind={createKind ?? 'limit'}
        suggestedFlexCents={flexPlan?.suggestedFlexCents ?? null}
      />
      <BudgetFormModal
        open={editing !== null}
        onClose={() => setEditing(null)}
        profileId={profileId}
        onSaved={reload}
        budget={editing}
        categoryTree={categoryTree}
        accounts={accounts}
        suggestedFlexCents={flexPlan?.suggestedFlexCents ?? null}
      />
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Eliminar"
        message={
          deleting ? (
            <span>
              Vas a eliminar el presupuesto{' '}
              <strong className="text-slate-100">{deleting.name}</strong>. Esta accion no borra
              ningun movimiento; solo el presupuesto ({formatCents(deleting.limitCents)}).
            </span>
          ) : null
        }
        buttons={deleteButtons}
      />
    </section>
  );
}
