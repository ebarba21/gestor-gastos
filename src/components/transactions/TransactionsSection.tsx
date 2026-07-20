// Seccion Movimientos: listado virtualizado con filtros, busqueda, orden, seleccion
// multiple, edicion/borrado masivo (con confirmacion y recuento) y acciones de movimientos
// especiales. Toda la logica vive en transactionService/transactionFilters; aqui solo
// orquestacion de UI y estado local de la pagina.
import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Transaction } from '../../db/schema';
import { useTransactions } from '../../hooks/useTransactions';
import {
  filterTransactions,
  sortTransactions,
  type TxFilter,
  type TxSort,
  type SortField,
} from '../../lib/transactionFilters';
import { transactionService } from '../../services/transactionService';
import { EmptyState, ConfirmDialog, VirtualList, type DialogButton } from '../common';
import { useToast } from '../../context/ToastContext';
import { TransactionRow, ROW_HEIGHT } from './TransactionRow';
import { TransactionFilters } from './TransactionFilters';
import { TransactionFormModal } from './TransactionFormModal';
import { BulkEditModal } from './BulkEditModal';
import { SplitModal } from './SplitModal';
import { TransferModal } from './TransferModal';
import { RefundModal } from './RefundModal';
import { RowActionsModal } from './RowActionsModal';

const LOCALE = 'es-ES';
const CURRENCY = 'EUR';
const LIST_HEIGHT = 600;

const SORT_FIELDS: { field: SortField; label: string }[] = [
  { field: 'date', label: 'Fecha' },
  { field: 'concept', label: 'Concepto' },
  { field: 'amount', label: 'Importe' },
  { field: 'category', label: 'Categoria' },
  { field: 'account', label: 'Cuenta' },
  { field: 'type', label: 'Tipo' },
  { field: 'status', label: 'Estado' },
];

export function TransactionsSection() {
  const {
    profileId,
    transactions,
    accounts,
    categories,
    tags,
    merchants,
    loading,
    error,
    reload,
    accountNames,
    categoryNames,
    merchantNames,
  } = useTransactions();
  const { showToast } = useToast();

  // Filtro inicial: si se llega desde el resumen de importacion (?importBatchId=...), la lista
  // arranca ya filtrada por ese lote (ampliacion fase 6, "enlace a dashboard filtrado").
  const [searchParams] = useSearchParams();
  const initialImportBatchId = searchParams.get('importBatchId') ?? undefined;
  const [filter, setFilter] = useState<TxFilter>({
    hideSplitChildren: true,
    importBatchId: initialImportBatchId,
  });
  const [sort, setSort] = useState<TxSort>({ field: 'date', dir: 'desc' });
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Modales / dialogos.
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [actionsFor, setActionsFor] = useState<Transaction | null>(null);
  const [splitFor, setSplitFor] = useState<Transaction | null>(null);
  const [refundFor, setRefundFor] = useState<Transaction | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ ids: string[]; count: number } | null>(null);

  // Lista filtrada y ordenada (memoizada). El aislamiento ya lo garantiza el hook.
  const visible = useMemo(() => {
    const filtered = filterTransactions(transactions, filter);
    return sortTransactions(filtered, sort, { accountNames, categoryNames });
  }, [transactions, filter, sort, accountNames, categoryNames]);

  const visibleIds = useMemo(() => visible.map((t) => t.id), [visible]);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));

  const selectedCount = selected.size;

  const toggleSelect = useCallback((id: string) => {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  function toggleSelectAllVisible() {
    setSelected((cur) => {
      const next = new Set(cur);
      if (allVisibleSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
  }

  function setSortField(field: SortField) {
    setSort((cur) =>
      cur.field === field ? { field, dir: cur.dir === 'asc' ? 'desc' : 'asc' } : { field, dir: 'asc' },
    );
  }

  async function afterMutation() {
    clearSelection();
    await reload();
  }

  // Abre la confirmacion de borrado calculando el recuento real (arrastra patas de
  // transferencia y lineas de split enlazadas).
  async function openDelete(ids: string[]) {
    try {
      const effective = await transactionService.collectDeletionIds(profileId, ids);
      setDeleteTarget({ ids, count: effective.length });
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'No se pudo preparar el borrado.', 'error');
    }
  }

  const deleteButtons: DialogButton[] = deleteTarget
    ? [
        { label: 'Cancelar', variant: 'ghost' },
        {
          label: `Eliminar ${deleteTarget.count}`,
          variant: 'danger',
          onClick: async () => {
            const n = await transactionService.removeMany(profileId, deleteTarget.ids);
            showToast(`${n} movimiento(s) eliminados.`, 'success');
            await afterMutation();
          },
        },
      ]
    : [];

  const selectedIds = useMemo(() => [...selected], [selected]);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold text-slate-100">Movimientos</h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setTransferOpen(true)}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm font-medium text-slate-200 hover:bg-slate-800"
          >
            Transferencia
          </button>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
          >
            Nuevo movimiento
          </button>
        </div>
      </div>

      {filter.importBatchId && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-indigo-800 bg-indigo-950/40 px-3 py-2 text-sm text-indigo-200">
          <span>Mostrando solo los movimientos de una importacion.</span>
          <button
            type="button"
            onClick={() => setFilter((f) => ({ ...f, importBatchId: undefined }))}
            className="rounded-lg border border-indigo-700 px-2.5 py-1 text-xs font-medium hover:bg-indigo-900"
          >
            Quitar filtro
          </button>
        </div>
      )}

      <TransactionFilters
        filter={filter}
        onChange={(next) => setFilter({ ...next, hideSplitChildren: true })}
        accounts={accounts}
        categories={categories}
        tags={tags}
      />

      {/* Orden */}
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
        <span className="mr-1">Ordenar:</span>
        {SORT_FIELDS.map((s) => (
          <button
            key={s.field}
            type="button"
            onClick={() => setSortField(s.field)}
            aria-pressed={sort.field === s.field}
            className={[
              'rounded-lg border px-2 py-1',
              sort.field === s.field
                ? 'border-indigo-500 bg-indigo-600/20 text-indigo-200'
                : 'border-slate-700 hover:bg-slate-800',
            ].join(' ')}
          >
            {s.label}
            {sort.field === s.field ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {loading ? (
        <p className="text-sm text-slate-500">Cargando movimientos...</p>
      ) : transactions.length === 0 ? (
        <EmptyState
          icon="💸"
          title="Sin movimientos"
          description="Crea tu primer movimiento o importa un extracto para empezar."
        />
      ) : (
        <div className="rounded-xl border border-slate-800">
          {/* Cabecera con seleccionar todo y recuento */}
          <div className="flex items-center gap-3 border-b border-slate-800 bg-slate-900/60 px-3 py-2 text-xs text-slate-400">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={toggleSelectAllVisible}
              aria-label="Seleccionar todos los visibles"
              className="h-4 w-4"
            />
            <span>
              {visible.length} movimiento(s)
              {selectedCount > 0 ? ` · ${selectedCount} seleccionados` : ''}
            </span>
          </div>

          {visible.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-slate-500">
              Ningun movimiento coincide con los filtros.
            </p>
          ) : (
            <VirtualList
              items={visible}
              rowHeight={ROW_HEIGHT}
              height={LIST_HEIGHT}
              keyFor={(t) => t.id}
              renderRow={(t) => (
                <TransactionRow
                  tx={t}
                  selected={selected.has(t.id)}
                  onToggleSelect={(id, ev) => {
                    ev.stopPropagation();
                    toggleSelect(id);
                  }}
                  onEdit={setEditing}
                  onActions={setActionsFor}
                  accountNames={accountNames}
                  categoryNames={categoryNames}
                  merchantNames={merchantNames}
                  locale={LOCALE}
                  currency={CURRENCY}
                />
              )}
            />
          )}
        </div>
      )}

      {/* Barra de acciones masivas */}
      {selectedCount > 0 && (
        <div className="sticky bottom-4 z-20 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-indigo-700/50 bg-slate-900 px-4 py-3 shadow-lg">
          <span className="text-sm text-slate-200">{selectedCount} seleccionados</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={clearSelection}
              className="rounded-lg px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
            >
              Limpiar
            </button>
            <button
              type="button"
              onClick={() => setBulkEditOpen(true)}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
            >
              Editar
            </button>
            <button
              type="button"
              onClick={() => void openDelete(selectedIds)}
              className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500"
            >
              Eliminar
            </button>
          </div>
        </div>
      )}

      {/* Modales */}
      <TransactionFormModal
        open={creating}
        onClose={() => setCreating(false)}
        profileId={profileId}
        accounts={accounts}
        categories={categories}
        tags={tags}
        onSaved={reload}
      />
      <TransactionFormModal
        open={editing !== null}
        onClose={() => setEditing(null)}
        profileId={profileId}
        accounts={accounts}
        categories={categories}
        tags={tags}
        onSaved={reload}
        tx={editing}
      />
      <TransferModal
        open={transferOpen}
        onClose={() => setTransferOpen(false)}
        profileId={profileId}
        accounts={accounts}
        onSaved={reload}
      />
      <BulkEditModal
        open={bulkEditOpen}
        onClose={() => setBulkEditOpen(false)}
        profileId={profileId}
        ids={selectedIds}
        accounts={accounts}
        categories={categories}
        tags={tags}
        onSaved={afterMutation}
      />
      <SplitModal
        open={splitFor !== null}
        onClose={() => setSplitFor(null)}
        profileId={profileId}
        tx={splitFor}
        categories={categories}
        locale={LOCALE}
        currency={CURRENCY}
        onSaved={reload}
      />
      <RefundModal
        open={refundFor !== null}
        onClose={() => setRefundFor(null)}
        profileId={profileId}
        tx={refundFor}
        transactions={transactions}
        locale={LOCALE}
        currency={CURRENCY}
        onSaved={reload}
      />
      <RowActionsModal
        open={actionsFor !== null}
        onClose={() => setActionsFor(null)}
        profileId={profileId}
        tx={actionsFor}
        accounts={accounts}
        merchants={merchants}
        merchantNames={merchantNames}
        onEdit={(t) => {
          setActionsFor(null);
          setEditing(t);
        }}
        onSplit={(t) => {
          setActionsFor(null);
          setSplitFor(t);
        }}
        onMarkRefund={(t) => {
          setActionsFor(null);
          setRefundFor(t);
        }}
        onDelete={(t) => {
          setActionsFor(null);
          void openDelete([t.id]);
        }}
        onChanged={reload}
      />
      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Eliminar movimientos"
        message={
          deleteTarget ? (
            <span>
              Vas a eliminar <strong className="text-slate-100">{deleteTarget.count}</strong>{' '}
              movimiento(s).
              {deleteTarget.count > deleteTarget.ids.length && (
                <>
                  {' '}
                  Se incluyen patas de transferencia y lineas de split enlazadas a la seleccion.
                </>
              )}{' '}
              Esta accion no se puede deshacer.
            </span>
          ) : null
        }
        buttons={deleteButtons}
      />
    </section>
  );
}
