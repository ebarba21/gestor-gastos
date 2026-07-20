// Seccion Conciliacion: elegir cuenta y fecha de extracto, comparar saldo del extracto contra
// el saldo calculado, ver la diferencia, revisar pendientes excluidos, guardar dejando
// constancia (cuadre o diferencia aceptada) e historial por cuenta (FINANCIAL_ALGORITHMS
// seccion 6, DATA_MODEL seccion 17).
import { useState } from 'react';
import { useReconciliation } from '../../hooks/useReconciliation';
import { reconciliationService, type ComputedBalanceResult } from '../../services/reconciliationService';
import { transactionsRepo } from '../../db/transactionsRepo';
import { EmptyState } from '../common';
import { useToast } from '../../context/ToastContext';
import { formatCents, eurosToCents } from '../../lib/money';
import type { ReconciliationStatus } from '../../db/schema';

const LOCALE = 'es-ES';
const CURRENCY = 'EUR';

const inputClass =
  'rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-sm text-slate-100 outline-none focus:border-slate-500';

const STATUS_LABELS: Record<ReconciliationStatus, string> = {
  balanced: 'Cuadra',
  discrepancy: 'Con diferencia',
  acceptedWithDifference: 'Diferencia aceptada',
};

const STATUS_CLASS: Record<ReconciliationStatus, string> = {
  balanced: 'text-emerald-400',
  discrepancy: 'text-amber-400',
  acceptedWithDifference: 'text-amber-400',
};

export function ReconciliationSection() {
  const { profileId, accounts, history, loading, error, reload } = useReconciliation();
  const { showToast } = useToast();

  const [accountId, setAccountId] = useState('');
  const [statementDate, setStatementDate] = useState('');
  const [statementBalanceText, setStatementBalanceText] = useState('');
  const [preview, setPreview] = useState<ComputedBalanceResult | null>(null);
  const [includePendingIds, setIncludePendingIds] = useState<Set<string>>(new Set());
  const [pendingConcepts, setPendingConcepts] = useState<Map<string, string>>(new Map());
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const accountHistory = accountId ? history.filter((r) => r.accountId === accountId) : history;

  async function handleComputePreview() {
    if (!accountId || !statementDate) return;
    setBusy(true);
    setLocalError(null);
    try {
      const result = await reconciliationService.computeBalance(
        profileId,
        accountId,
        statementDate,
        [...includePendingIds],
      );
      setPreview(result);
      const concepts = new Map<string, string>();
      for (const id of result.excludedPendingIds) {
        const tx = await transactionsRepo.getById(profileId, id);
        if (tx) concepts.set(id, `${tx.date} · ${tx.concept} · ${formatCents(tx.amountCents, LOCALE, CURRENCY)}`);
      }
      setPendingConcepts(concepts);
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : 'No se pudo calcular el saldo.');
    } finally {
      setBusy(false);
    }
  }

  function togglePending(id: string) {
    setIncludePendingIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setPreview(null);
  }

  const statementBalanceCents = (() => {
    const n = Number(statementBalanceText.replace(',', '.'));
    return Number.isFinite(n) ? eurosToCents(n) : null;
  })();

  const differencePreview =
    preview && statementBalanceCents !== null ? statementBalanceCents - preview.computedBalanceCents : null;

  async function handleSave(acceptWithDifference: boolean) {
    if (!accountId || !statementDate || statementBalanceCents === null || busy) return;
    setBusy(true);
    setLocalError(null);
    try {
      const { reconciliation } = await reconciliationService.reconcile(profileId, {
        accountId,
        statementDate,
        statementBalanceCents,
        includePendingIds: [...includePendingIds],
        notes: notes.trim() || null,
        acceptWithDifference,
      });
      showToast(
        reconciliation.status === 'balanced'
          ? 'Conciliacion guardada: cuadra.'
          : `Conciliacion guardada con diferencia de ${formatCents(reconciliation.differenceCents, LOCALE, CURRENCY)}.`,
        reconciliation.status === 'balanced' ? 'success' : 'info',
      );
      setStatementBalanceText('');
      setPreview(null);
      setNotes('');
      await reload();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'No se pudo guardar la conciliacion.', 'error');
    } finally {
      setBusy(false);
    }
  }

  if (!loading && accounts.length === 0) {
    return (
      <EmptyState
        icon="🏦"
        title="Necesitas una cuenta"
        description="Crea al menos una cuenta antes de conciliar un extracto."
      />
    );
  }

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-100">Conciliacion bancaria</h2>
        <p className="mt-1 text-sm text-slate-400">
          Compara el saldo de tu extracto con el saldo calculado por la app para esa fecha.
        </p>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="grid gap-3 rounded-2xl border border-slate-800 bg-slate-900/40 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="block text-xs text-slate-400" htmlFor="reconciliation-account">
            Cuenta
          </label>
          <select
            id="reconciliation-account"
            value={accountId}
            onChange={(e) => {
              setAccountId(e.target.value);
              setPreview(null);
            }}
            className={`${inputClass} mt-1 w-full`}
          >
            <option value="">Elegir cuenta...</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400" htmlFor="reconciliation-date">
            Fecha del extracto
          </label>
          <input
            id="reconciliation-date"
            type="date"
            value={statementDate}
            onChange={(e) => {
              setStatementDate(e.target.value);
              setPreview(null);
            }}
            className={`${inputClass} mt-1 w-full`}
          />
        </div>
        <div>
          <label className="block text-xs text-slate-400" htmlFor="reconciliation-balance">
            Saldo del extracto (EUR)
          </label>
          <input
            id="reconciliation-balance"
            type="text"
            inputMode="decimal"
            placeholder="0,00"
            value={statementBalanceText}
            onChange={(e) => setStatementBalanceText(e.target.value)}
            className={`${inputClass} mt-1 w-full`}
          />
        </div>
        <div className="flex items-end">
          <button
            type="button"
            disabled={!accountId || !statementDate || busy}
            onClick={() => void handleComputePreview()}
            className="w-full rounded-lg border border-slate-700 px-3 py-1.5 text-sm font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50"
          >
            Calcular saldo
          </button>
        </div>
      </div>

      {localError && <p className="text-sm text-red-400">{localError}</p>}

      {preview && (
        <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Saldo calculado</p>
              <p className="text-base font-semibold text-slate-100">
                {formatCents(preview.computedBalanceCents, LOCALE, CURRENCY)}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Saldo del extracto</p>
              <p className="text-base font-semibold text-slate-100">
                {statementBalanceCents !== null
                  ? formatCents(statementBalanceCents, LOCALE, CURRENCY)
                  : '-'}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Diferencia</p>
              <p
                className={`text-base font-semibold ${
                  differencePreview === 0 ? 'text-emerald-400' : 'text-amber-400'
                }`}
              >
                {differencePreview !== null ? formatCents(differencePreview, LOCALE, CURRENCY) : '-'}
              </p>
            </div>
          </div>

          {preview.excludedPendingIds.length > 0 && (
            <div>
              <p className="text-xs text-slate-400">
                {preview.excludedPendingIds.length} movimiento(s) pendiente(s) excluido(s) por defecto.
                Marca los que quieras incluir en el calculo:
              </p>
              <ul className="mt-1 space-y-1">
                {preview.excludedPendingIds.map((id) => (
                  <li key={id} className="flex items-center gap-2 text-xs text-slate-300">
                    <input
                      type="checkbox"
                      checked={includePendingIds.has(id)}
                      onChange={() => togglePending(id)}
                      className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-800"
                    />
                    {pendingConcepts.get(id) ?? id}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <label className="block text-xs text-slate-400" htmlFor="reconciliation-notes">
              Notas (opcional)
            </label>
            <input
              id="reconciliation-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className={`${inputClass} mt-1 w-full`}
            />
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            {differencePreview !== 0 && (
              <button
                type="button"
                disabled={busy || statementBalanceCents === null}
                onClick={() => void handleSave(true)}
                className="rounded-lg border border-amber-700 px-3 py-1.5 text-sm font-medium text-amber-300 hover:bg-amber-950"
              >
                Continuar sin cuadrar (dejar constancia)
              </button>
            )}
            <button
              type="button"
              disabled={busy || statementBalanceCents === null}
              onClick={() => void handleSave(false)}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              Guardar conciliacion
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-300">Historial de conciliaciones</h3>
        {!loading && accountHistory.length === 0 ? (
          <EmptyState
            icon="🧾"
            title="Sin conciliaciones todavia"
            description="Cuando guardes una conciliacion aparecera aqui, por cuenta y fecha."
          />
        ) : (
          <div className="divide-y divide-slate-800 rounded-xl border border-slate-800">
            {accountHistory.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <div>
                  <p className="text-slate-200">
                    {accounts.find((a) => a.id === r.accountId)?.name ?? r.accountId} · {r.statementDate}
                  </p>
                  <p className="text-xs text-slate-500">
                    Extracto {formatCents(r.statementBalanceCents, LOCALE, CURRENCY)} · Calculado{' '}
                    {formatCents(r.computedBalanceCents, LOCALE, CURRENCY)}
                  </p>
                </div>
                <span className={`text-xs font-medium ${STATUS_CLASS[r.status]}`}>
                  {STATUS_LABELS[r.status]}
                  {r.differenceCents !== 0 ? ` (${formatCents(r.differenceCents, LOCALE, CURRENCY)})` : ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
