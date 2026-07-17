// Seccion de deudas (ampliacion, fase 8): resumen, alta/edicion, detalle (calendario +
// simulador + pagos) y comparador de estrategias. Ver DATA_MODEL seccion 19 y
// FINANCIAL_ALGORITHMS secciones 8-9. No es asesoramiento financiero personalizado.
import { useState } from 'react';
import { useDebts } from '../../hooks/useDebts';
import { useAccounts } from '../../hooks/useAccounts';
import { useCategories } from '../../hooks/useCategories';
import type { Debt } from '../../db/schema';
import { EmptyState, ConfirmDialog, type DialogButton } from '../common';
import { formatCents } from '../../lib/money';
import { DebtForm } from './DebtForm';
import { DebtDetailPanel } from './DebtDetailPanel';
import { DebtComparator } from './DebtComparator';
import { useToast } from '../../context/ToastContext';

const TYPE_LABELS: Record<Debt['type'], string> = {
  personalLoan: 'Prestamo personal',
  mortgageFixed: 'Hipoteca fija',
  card: 'Tarjeta',
  other: 'Otra',
};

const STATUS_LABELS: Record<Debt['status'], string> = {
  active: 'Activa',
  paidOff: 'Liquidada',
  archived: 'Archivada',
};

const cardClass = 'rounded-2xl border border-slate-800 bg-slate-900 p-4';
const btnClass = 'rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800';

export function DebtsSection() {
  const {
    profileId,
    debts,
    active,
    paidOff,
    archived,
    scenarios,
    summary,
    loading,
    error,
    reload,
    createDebt,
    updateDebt,
    archiveDebt,
    removeDebt,
  } = useDebts();
  const { accounts } = useAccounts();
  const { tree } = useCategories();
  const { showToast } = useToast();
  const categories = tree.flatMap((n) => [n.category, ...n.children]);

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Debt | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<Debt | null>(null);
  const [tab, setTab] = useState<'debts' | 'comparator'>('debts');

  async function handleCreateOrUpdate(input: Parameters<typeof createDebt>[0]) {
    if (editing) {
      await updateDebt(editing.id, input);
      showToast('Deuda actualizada.', 'success');
    } else {
      await createDebt(input);
      showToast('Deuda creada.', 'success');
    }
    setShowForm(false);
    setEditing(null);
  }

  const deleteButtons: DialogButton[] = toDelete
    ? [
        { label: 'Cancelar', variant: 'ghost' },
        {
          label: 'Archivar (recomendado)',
          variant: 'primary',
          onClick: async () => {
            await archiveDebt(toDelete.id);
            showToast('Deuda archivada.', 'success');
          },
        },
        {
          label: 'Borrar definitivamente',
          variant: 'danger',
          onClick: async () => {
            await removeDebt(toDelete.id);
            if (selectedId === toDelete.id) setSelectedId(null);
            showToast('Deuda borrada.', 'success');
          },
        },
      ]
    : [];

  return (
    <section className="mx-auto max-w-5xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-100">Deudas</h2>
        <p className="mt-1 text-sm text-slate-400">
          Calculadora y planificador de deudas: calendario de amortizacion, amortizacion
          anticipada y comparador Snowball/Avalanche. Esto no es asesoramiento financiero
          personalizado: es un calculo determinista sobre los datos que registras.
        </p>
      </div>

      {error && <p className="text-sm text-red-400" role="alert">{error}</p>}

      {summary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className={cardClass}>
            <p className="text-xs text-slate-500">Saldo pendiente</p>
            <p className="mt-1 text-lg font-semibold text-slate-100">{formatCents(summary.totalOutstandingCents)}</p>
          </div>
          <div className={cardClass}>
            <p className="text-xs text-slate-500">Cuota mensual total</p>
            <p className="mt-1 text-lg font-semibold text-slate-100">{formatCents(summary.totalMinimumPaymentCents)}</p>
          </div>
          <div className={cardClass}>
            <p className="text-xs text-slate-500">Interes medio ponderado</p>
            <p className="mt-1 text-lg font-semibold text-slate-100">{(summary.weightedAverageRatePpm / 10000).toFixed(2)}%</p>
          </div>
          <div className={cardClass}>
            <p className="text-xs text-slate-500">Proximo pago</p>
            <p className="mt-1 text-lg font-semibold text-slate-100">{summary.earliestNextPaymentDate ?? '-'}</p>
          </div>
        </div>
      )}

      <div className="flex gap-1 border-b border-slate-800" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'debts'}
          onClick={() => setTab('debts')}
          className={`px-3 py-2 text-sm font-medium ${tab === 'debts' ? 'border-b-2 border-indigo-500 text-slate-100' : 'text-slate-400'}`}
        >
          Deudas
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'comparator'}
          onClick={() => setTab('comparator')}
          className={`px-3 py-2 text-sm font-medium ${tab === 'comparator' ? 'border-b-2 border-indigo-500 text-slate-100' : 'text-slate-400'}`}
        >
          Comparador y escenarios
        </button>
      </div>

      {tab === 'debts' && (
        <div className="space-y-6">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => {
                setEditing(null);
                setShowForm(true);
              }}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
            >
              Anadir deuda
            </button>
          </div>

          {showForm && (
            <DebtForm
              initial={editing}
              accounts={accounts}
              categories={categories}
              onSubmit={handleCreateOrUpdate}
              onCancel={() => {
                setShowForm(false);
                setEditing(null);
              }}
            />
          )}

          {!loading && debts.length === 0 && !showForm && (
            <EmptyState
              icon="💳"
              title="Aun no has registrado ninguna deuda"
              description="Anade un prestamo, hipoteca u otra deuda para ver su calendario de amortizacion."
              action={
                <button type="button" onClick={() => setShowForm(true)} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">
                  Anadir deuda
                </button>
              }
            />
          )}

          {[...active, ...paidOff, ...archived].length > 0 && (
            <ul className="space-y-2">
              {[...active, ...paidOff, ...archived].map((d) => (
                <li key={d.id} className={cardClass}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedId(selectedId === d.id ? null : d.id)}
                      className="text-left"
                    >
                      <p className="font-medium text-slate-100">{d.name}</p>
                      <p className="text-xs text-slate-500">
                        {TYPE_LABELS[d.type]} · {formatCents(d.outstandingPrincipalCents)} pendiente ·{' '}
                        {STATUS_LABELS[d.status]}
                      </p>
                    </button>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(d);
                          setShowForm(true);
                        }}
                        className={btnClass}
                      >
                        Editar
                      </button>
                      {d.status !== 'archived' && (
                        <button type="button" onClick={() => setToDelete(d)} className={btnClass}>
                          Archivar / borrar
                        </button>
                      )}
                    </div>
                  </div>
                  {selectedId === d.id && (
                    <div className="mt-4 border-t border-slate-800 pt-4">
                      <DebtDetailPanel profileId={profileId} debt={d} onPaymentRecorded={reload} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'comparator' && (
        <DebtComparator profileId={profileId} scenarios={scenarios} onScenariosChanged={reload} />
      )}

      <ConfirmDialog
        open={toDelete !== null}
        onClose={() => setToDelete(null)}
        title="Archivar o borrar deuda"
        message={
          toDelete ? (
            <p>
              <strong className="text-slate-100">{toDelete.name}</strong>. Archivar conserva el
              historial de pagos y la saca de los listados activos. Borrar la elimina por
              completo (los pagos registrados quedan sin la deuda a la que pertenecian). Esta
              accion no se puede deshacer.
            </p>
          ) : null
        }
        buttons={deleteButtons}
      />
    </section>
  );
}
