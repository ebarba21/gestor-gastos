// Seccion Recurrencias: candidatas detectadas, series activas/pausadas/posiblemente
// canceladas/canceladas, proximos cobros (agrupados por mes: "calendario" en forma de agenda) y
// detalle/historial por serie (ver DATA_MODEL seccion 18, FINANCIAL_ALGORITHMS seccion 7,
// alcance seccion 3-4-10 del prompt de fase).
import { useState } from 'react';
import { useRecurringSeries } from '../../hooks/useRecurringSeries';
import { useAccounts } from '../../hooks/useAccounts';
import { useMerchants } from '../../hooks/useMerchants';
import { EmptyState } from '../common';
import { useToast } from '../../context/ToastContext';
import { formatCents, eurosToCents, centsToEuros } from '../../lib/money';
import { todayISO } from '../../lib/dates';
import type { RecurringDirection, RecurringFrequency, RecurringOccurrence, RecurringSeries } from '../../db/schema';

const FREQUENCY_LABELS: Record<RecurringFrequency, string> = {
  weekly: 'semanal',
  monthly: 'mensual',
  quarterly: 'trimestral',
  yearly: 'anual',
};

const OCCURRENCE_STATUS_LABELS: Record<RecurringOccurrence['status'], string> = {
  expected: 'Prevista',
  matched: 'Cobrada',
  missing: 'Ausente',
  skipped: 'Omitida',
  manuallyCompleted: 'Completada a mano',
};

const OCCURRENCE_STATUS_CLASS: Record<RecurringOccurrence['status'], string> = {
  expected: 'text-slate-400',
  matched: 'text-emerald-400',
  missing: 'text-red-400',
  skipped: 'text-slate-500',
  manuallyCompleted: 'text-indigo-300',
};

function frequencyLabel(s: Pick<RecurringSeries, 'frequency' | 'interval'>): string {
  const base = FREQUENCY_LABELS[s.frequency];
  return s.interval === 1 ? base : `${base} (cada ${s.interval})`;
}

const btnClass =
  'rounded-lg border border-slate-700 px-2.5 py-1 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50';
const btnPrimaryClass =
  'rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50';
const btnDangerClass =
  'rounded-lg border border-red-800 px-2.5 py-1 text-xs font-medium text-red-300 hover:bg-red-950 disabled:opacity-50';

export function RecurringSeriesSection() {
  const {
    candidates,
    active,
    paused,
    possiblyCancelled,
    cancelled,
    upcomingCharges,
    loading,
    detecting,
    error,
    runDetection,
    confirm,
    pause,
    resume,
    cancel,
    excludeCandidate,
    edit,
    createManual,
    skipOccurrence,
    completeOccurrenceManually,
    unlinkOccurrenceTransaction,
    splitSeries,
    mergeSeries,
    occurrencesOf,
  } = useRecurringSeries();
  const { accounts } = useAccounts();
  const { categoryNames, merchantNames } = useMerchants();
  const { showToast } = useToast();

  const accountNames = new Map(accounts.map((a) => [a.id, a.name]));
  const [expandedSeriesId, setExpandedSeriesId] = useState<string | null>(null);
  const [expandedOccurrences, setExpandedOccurrences] = useState<RecurringOccurrence[]>([]);
  const [mergeTargetBySeries, setMergeTargetBySeries] = useState<Map<string, string>>(new Map());
  const [splitDateBySeries, setSplitDateBySeries] = useState<Map<string, string>>(new Map());
  const [editingSeriesId, setEditingSeriesId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ name: string; amountEuros: string; toleranceEuros: string; dateToleranceDays: string }>({
    name: '',
    amountEuros: '',
    toleranceEuros: '',
    dateToleranceDays: '',
  });
  const [showAddForm, setShowAddForm] = useState(false);
  const [addDraft, setAddDraft] = useState({
    name: '',
    accountId: '',
    direction: 'expense' as RecurringDirection,
    frequency: 'monthly' as RecurringFrequency,
    interval: '1',
    amountEuros: '',
    toleranceEuros: '',
    dateToleranceDays: '3',
    nextExpectedDate: todayISO(),
  });

  async function toggleDetail(seriesId: string) {
    if (expandedSeriesId === seriesId) {
      setExpandedSeriesId(null);
      return;
    }
    const occ = await occurrencesOf(seriesId);
    setExpandedOccurrences(occ);
    setExpandedSeriesId(seriesId);
  }

  function subjectLabel(s: RecurringSeries): string {
    return s.merchantId !== null ? (merchantNames.get(s.merchantId) ?? s.name) : s.name;
  }

  async function withToast(action: () => Promise<void>, okMessage: string) {
    await action();
    showToast(okMessage, 'success');
  }

  if (loading && candidates.length + active.length + paused.length === 0) {
    return <p className="text-sm text-slate-500">Cargando recurrencias...</p>;
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-100">Recurrencias</h2>
          <p className="mt-1 text-sm text-slate-400">
            Series confirmables detectadas por comercio/concepto, dirección y cuenta. Ninguna
            sugerencia se confirma sola.
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" className={btnClass} onClick={() => setShowAddForm((v) => !v)}>
            {showAddForm ? 'Cancelar' : 'Añadir manualmente'}
          </button>
          <button type="button" disabled={detecting} onClick={() => void runDetection()} className={btnPrimaryClass}>
            {detecting ? 'Buscando...' : 'Buscar recurrencias'}
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {showAddForm && (
        <div className="grid gap-2 rounded-xl border border-slate-800 bg-slate-900/60 p-3 sm:grid-cols-3 lg:grid-cols-4">
          <input
            aria-label="Nombre de la recurrencia"
            placeholder="Nombre"
            value={addDraft.name}
            onChange={(e) => setAddDraft((d) => ({ ...d, name: e.target.value }))}
            className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-100"
          />
          <select
            aria-label="Cuenta"
            value={addDraft.accountId}
            onChange={(e) => setAddDraft((d) => ({ ...d, accountId: e.target.value }))}
            className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-100"
          >
            <option value="">Sin cuenta</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Dirección (gasto o ingreso)"
            value={addDraft.direction}
            onChange={(e) => setAddDraft((d) => ({ ...d, direction: e.target.value as RecurringDirection }))}
            className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-100"
          >
            <option value="expense">Gasto</option>
            <option value="income">Ingreso</option>
          </select>
          <select
            aria-label="Frecuencia"
            value={addDraft.frequency}
            onChange={(e) => setAddDraft((d) => ({ ...d, frequency: e.target.value as RecurringFrequency }))}
            className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-100"
          >
            <option value="weekly">Semanal</option>
            <option value="monthly">Mensual</option>
            <option value="quarterly">Trimestral</option>
            <option value="yearly">Anual</option>
          </select>
          <input
            aria-label="Cada cuantos periodos"
            type="number"
            min={1}
            placeholder="Cada N"
            value={addDraft.interval}
            onChange={(e) => setAddDraft((d) => ({ ...d, interval: e.target.value }))}
            className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-100"
          />
          <input
            aria-label="Importe esperado en euros"
            type="text"
            inputMode="decimal"
            placeholder="Importe (EUR)"
            value={addDraft.amountEuros}
            onChange={(e) => setAddDraft((d) => ({ ...d, amountEuros: e.target.value }))}
            className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-100"
          />
          <input
            aria-label="Tolerancia de importe en euros"
            type="text"
            inputMode="decimal"
            placeholder="Tolerancia (EUR)"
            value={addDraft.toleranceEuros}
            onChange={(e) => setAddDraft((d) => ({ ...d, toleranceEuros: e.target.value }))}
            className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-100"
          />
          <input
            aria-label="Tolerancia de fecha en días"
            type="number"
            min={0}
            placeholder="Tolerancia días"
            value={addDraft.dateToleranceDays}
            onChange={(e) => setAddDraft((d) => ({ ...d, dateToleranceDays: e.target.value }))}
            className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-100"
          />
          <input
            aria-label="Próxima fecha esperada"
            type="date"
            value={addDraft.nextExpectedDate}
            onChange={(e) => setAddDraft((d) => ({ ...d, nextExpectedDate: e.target.value }))}
            className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-100"
          />
          <button
            type="button"
            className={btnPrimaryClass}
            onClick={() =>
              void (async () => {
                try {
                  await createManual({
                    name: addDraft.name.trim(),
                    merchantId: null,
                    accountId: addDraft.accountId || null,
                    direction: addDraft.direction,
                    frequency: addDraft.frequency,
                    interval: Number(addDraft.interval) || 1,
                    expectedAmountCents: eurosToCents(Number(addDraft.amountEuros.replace(',', '.')) || 0),
                    amountToleranceCents: eurosToCents(Number(addDraft.toleranceEuros.replace(',', '.')) || 0),
                    amountTolerancePpm: 0,
                    expectedDayOfWeek: null,
                    expectedDayOfMonth: null,
                    dateToleranceDays: Number(addDraft.dateToleranceDays) || 0,
                    nextExpectedDate: addDraft.nextExpectedDate,
                  });
                  showToast('Recurrencia añadida.', 'success');
                  setShowAddForm(false);
                } catch (e) {
                  showToast(e instanceof Error ? e.message : 'No se pudo añadir la recurrencia.', 'error');
                }
              })()
            }
          >
            Guardar
          </button>
        </div>
      )}

      {/* Candidatas: sugerencias sin confirmar. */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-300">Candidatas ({candidates.length})</h3>
        {candidates.length === 0 ? (
          <p className="text-xs text-slate-500">No hay sugerencias pendientes de revisar.</p>
        ) : (
          <ul className="divide-y divide-slate-800 rounded-xl border border-slate-800">
            {candidates.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="truncate text-slate-200">{subjectLabel(s)}</p>
                  <p className="text-xs text-slate-500">
                    {frequencyLabel(s)} · {formatCents(s.expectedAmountCents)} · confianza{' '}
                    {(s.confidence / 10).toFixed(0)}%
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className={btnPrimaryClass}
                    onClick={() => void withToast(() => confirm(s.id), 'Serie confirmada.')}
                  >
                    Confirmar
                  </button>
                  <button
                    type="button"
                    className={btnClass}
                    onClick={() => void withToast(() => excludeCandidate(s.id), 'Sugerencia excluida.')}
                  >
                    Excluir
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Posiblemente canceladas: alerta, requiere decisión explicita. */}
      {possiblyCancelled.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-amber-300">
            Posiblemente canceladas ({possiblyCancelled.length})
          </h3>
          <ul className="divide-y divide-amber-900/40 rounded-xl border border-amber-900/40 bg-amber-950/20">
            {possiblyCancelled.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="truncate text-slate-200">{subjectLabel(s)}</p>
                  <p className="text-xs text-amber-400">
                    Varias ausencias seguidas. {frequencyLabel(s)} · {formatCents(s.expectedAmountCents)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className={btnPrimaryClass}
                    title="Marcar que esta recurrencia sigue cobrandose con normalidad"
                    onClick={() => void withToast(() => resume(s.id), 'Serie reactivada.')}
                  >
                    No, sigue activa
                  </button>
                  <button
                    type="button"
                    className={btnDangerClass}
                    title="Confirmar que esta recurrencia ha terminado"
                    onClick={() => void withToast(() => cancel(s.id), 'Serie cancelada.')}
                  >
                    Si, cancelar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Activas: detalle expandible con historial y acciones de dividir/fusionar. */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-300">Activas ({active.length})</h3>
        {active.length === 0 ? (
          <EmptyState
            icon="🔁"
            title="Sin recurrencias activas"
            description="Confirma una candidata detectada o añade una recurrencia manualmente."
          />
        ) : (
          <ul className="divide-y divide-slate-800 rounded-xl border border-slate-800">
            {active.map((s) => (
              <li key={s.id} className="px-4 py-2.5 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button type="button" className="min-w-0 text-left" onClick={() => void toggleDetail(s.id)}>
                    <p className="truncate text-slate-200">
                      {expandedSeriesId === s.id ? '▾' : '▸'} {subjectLabel(s)}
                    </p>
                    <p className="text-xs text-slate-500">
                      {frequencyLabel(s)} · {formatCents(s.expectedAmountCents)} (±{formatCents(s.amountToleranceCents)}) ·
                      próximo {s.nextExpectedDate ?? 'sin fecha'}
                      {s.accountId && ` · ${accountNames.get(s.accountId) ?? ''}`}
                    </p>
                  </button>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className={btnClass}
                      onClick={() => {
                        if (editingSeriesId === s.id) {
                          setEditingSeriesId(null);
                          return;
                        }
                        setEditDraft({
                          name: s.name,
                          amountEuros: String(centsToEuros(s.expectedAmountCents)),
                          toleranceEuros: String(centsToEuros(s.amountToleranceCents)),
                          dateToleranceDays: String(s.dateToleranceDays),
                        });
                        setEditingSeriesId(s.id);
                      }}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      className={btnClass}
                      onClick={() => void withToast(() => pause(s.id), 'Serie pausada.')}
                    >
                      Pausar
                    </button>
                    <button
                      type="button"
                      className={btnDangerClass}
                      onClick={() => void withToast(() => cancel(s.id), 'Serie cancelada.')}
                    >
                      Cancelar
                    </button>
                  </div>
                </div>

                {editingSeriesId === s.id && (
                  <div className="mt-3 grid gap-2 rounded-lg border border-slate-800 bg-slate-900/60 p-3 sm:grid-cols-4">
                    <input
                      aria-label="Nombre de la recurrencia"
                      value={editDraft.name}
                      onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))}
                      placeholder="Nombre"
                      className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-100"
                    />
                    <input
                      aria-label="Importe esperado en euros"
                      type="text"
                      inputMode="decimal"
                      value={editDraft.amountEuros}
                      onChange={(e) => setEditDraft((d) => ({ ...d, amountEuros: e.target.value }))}
                      placeholder="Importe (EUR)"
                      className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-100"
                    />
                    <input
                      aria-label="Tolerancia de importe en euros"
                      type="text"
                      inputMode="decimal"
                      value={editDraft.toleranceEuros}
                      onChange={(e) => setEditDraft((d) => ({ ...d, toleranceEuros: e.target.value }))}
                      placeholder="Tolerancia (EUR)"
                      className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-100"
                    />
                    <input
                      aria-label="Tolerancia de fecha en días"
                      type="number"
                      min={0}
                      value={editDraft.dateToleranceDays}
                      onChange={(e) => setEditDraft((d) => ({ ...d, dateToleranceDays: e.target.value }))}
                      placeholder="Tolerancia días"
                      className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-100"
                    />
                    <button
                      type="button"
                      className={btnPrimaryClass}
                      onClick={() =>
                        void (async () => {
                          try {
                            await edit(s.id, {
                              name: editDraft.name.trim(),
                              expectedAmountCents: eurosToCents(Number(editDraft.amountEuros.replace(',', '.')) || 0),
                              amountToleranceCents: eurosToCents(
                                Number(editDraft.toleranceEuros.replace(',', '.')) || 0,
                              ),
                              dateToleranceDays: Number(editDraft.dateToleranceDays) || 0,
                            });
                            showToast('Serie actualizada.', 'success');
                            setEditingSeriesId(null);
                          } catch (e) {
                            showToast(e instanceof Error ? e.message : 'No se pudo guardar.', 'error');
                          }
                        })()
                      }
                    >
                      Guardar
                    </button>
                  </div>
                )}

                {expandedSeriesId === s.id && (
                  <div className="mt-3 space-y-3 rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                    <div>
                      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">
                        Historial de ocurrencias
                      </p>
                      {expandedOccurrences.length === 0 ? (
                        <p className="text-xs text-slate-500">Sin ocurrencias todavia.</p>
                      ) : (
                        <ul className="space-y-1">
                          {expandedOccurrences.map((o) => (
                            <li key={o.id} className="flex items-center justify-between gap-2 text-xs">
                              <span className="text-slate-300">
                                {o.expectedDate} · {formatCents(o.expectedAmountCents)}
                              </span>
                              <span className={OCCURRENCE_STATUS_CLASS[o.status]}>
                                {OCCURRENCE_STATUS_LABELS[o.status]}
                              </span>
                              <span className="flex gap-1">
                                {o.status === 'expected' && (
                                  <button
                                    type="button"
                                    className={btnClass}
                                    onClick={() =>
                                      void withToast(
                                        () => skipOccurrence(o.id).then(() => toggleReopen(s.id)),
                                        'Ocurrencia omitida.',
                                      )
                                    }
                                  >
                                    Omitir
                                  </button>
                                )}
                                {o.status === 'expected' && (
                                  <button
                                    type="button"
                                    className={btnClass}
                                    onClick={() =>
                                      void withToast(
                                        () => completeOccurrenceManually(o.id).then(() => toggleReopen(s.id)),
                                        'Marcada como completada.',
                                      )
                                    }
                                  >
                                    Completar a mano
                                  </button>
                                )}
                                {o.transactionId !== null && (
                                  <button
                                    type="button"
                                    className={btnClass}
                                    onClick={() =>
                                      void withToast(
                                        () => unlinkOccurrenceTransaction(o.id).then(() => toggleReopen(s.id)),
                                        'Movimiento desvinculado.',
                                      )
                                    }
                                  >
                                    Excluir movimiento
                                  </button>
                                )}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div className="flex flex-wrap items-end gap-2 border-t border-slate-800 pt-2">
                      <div>
                        <label className="block text-[10px] text-slate-500" htmlFor={`split-${s.id}`}>
                          Dividir desde
                        </label>
                        <input
                          id={`split-${s.id}`}
                          type="date"
                          value={splitDateBySeries.get(s.id) ?? ''}
                          onChange={(e) =>
                            setSplitDateBySeries((prev) => new Map(prev).set(s.id, e.target.value))
                          }
                          className="rounded border border-slate-700 bg-slate-800 px-1.5 py-1 text-xs text-slate-100"
                        />
                      </div>
                      <button
                        type="button"
                        className={btnClass}
                        disabled={!splitDateBySeries.get(s.id)}
                        onClick={() =>
                          void withToast(
                            () => splitSeries(s.id, splitDateBySeries.get(s.id)!),
                            'Serie dividida.',
                          )
                        }
                      >
                        Dividir
                      </button>
                      <div>
                        <label className="block text-[10px] text-slate-500" htmlFor={`merge-${s.id}`}>
                          Fusionar con
                        </label>
                        <select
                          id={`merge-${s.id}`}
                          value={mergeTargetBySeries.get(s.id) ?? ''}
                          onChange={(e) =>
                            setMergeTargetBySeries((prev) => new Map(prev).set(s.id, e.target.value))
                          }
                          className="rounded border border-slate-700 bg-slate-800 px-1.5 py-1 text-xs text-slate-100"
                        >
                          <option value="">Elegir serie...</option>
                          {active.filter((o) => o.id !== s.id).map((o) => (
                            <option key={o.id} value={o.id}>
                              {subjectLabel(o)}
                            </option>
                          ))}
                        </select>
                      </div>
                      <button
                        type="button"
                        className={btnClass}
                        disabled={!mergeTargetBySeries.get(s.id)}
                        onClick={() =>
                          void withToast(
                            () => mergeSeries(s.id, mergeTargetBySeries.get(s.id)!),
                            'Series fusionadas.',
                          )
                        }
                      >
                        Fusionar (esta absorbe)
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Pausadas y canceladas: listas compactas. */}
      {(paused.length > 0 || cancelled.length > 0) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {paused.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-slate-300">Pausadas ({paused.length})</h3>
              <ul className="divide-y divide-slate-800 rounded-xl border border-slate-800">
                {paused.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
                    <span className="truncate text-slate-300">{subjectLabel(s)}</span>
                    <button
                      type="button"
                      className={btnClass}
                      onClick={() => void withToast(() => resume(s.id), 'Serie reactivada.')}
                    >
                      Reanudar
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {cancelled.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-slate-500">Canceladas ({cancelled.length})</h3>
              <ul className="divide-y divide-slate-800 rounded-xl border border-slate-800 opacity-70">
                {cancelled.map((s) => (
                  <li key={s.id} className="px-4 py-2 text-sm text-slate-400">
                    {subjectLabel(s)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Próximos cobros, agrupados por mes (agenda/calendario). */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-300">Próximos cobros e ingresos</h3>
        {upcomingCharges.length === 0 ? (
          <p className="text-xs text-slate-500">No hay cobros previstos en los próximos meses.</p>
        ) : (
          <UpcomingChargesCalendar charges={upcomingCharges} accountNames={accountNames} categoryNames={categoryNames} />
        )}
      </div>
    </section>
  );

  // Recarga el historial expandido tras una accion sobre una ocurrencia (sin cerrar el panel).
  async function toggleReopen(seriesId: string): Promise<void> {
    const occ = await occurrencesOf(seriesId);
    setExpandedOccurrences(occ);
  }
}

function UpcomingChargesCalendar({
  charges,
  accountNames,
  categoryNames,
}: {
  charges: ReturnType<typeof useRecurringSeries>['upcomingCharges'];
  accountNames: Map<string, string>;
  categoryNames: Map<string, string>;
}) {
  const byMonth = new Map<string, typeof charges>();
  for (const c of charges) {
    const month = c.expectedDate.slice(0, 7);
    const list = byMonth.get(month) ?? [];
    list.push(c);
    byMonth.set(month, list);
  }
  return (
    <div className="space-y-4">
      {[...byMonth.entries()].map(([month, list]) => (
        <div key={month}>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">{month}</p>
          <ul className="divide-y divide-slate-800 rounded-xl border border-slate-800">
            {list.map((c) => (
              <li key={c.occurrenceId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate text-slate-200">{c.seriesName}</p>
                  <p className="text-xs text-slate-500">
                    {c.expectedDate} · margen {formatCents(c.marginLowCents)} - {formatCents(c.marginHighCents)}
                    {c.accountId && ` · ${accountNames.get(c.accountId) ?? ''}`}
                    {c.categoryId && ` · ${categoryNames.get(c.categoryId) ?? ''}`}
                  </p>
                  {c.lastAmountCents !== null && (
                    <p className="text-xs text-slate-500">
                      Último {formatCents(c.lastAmountCents)}
                      {c.variationCents !== null && c.variationCents !== 0 && (
                        <span className={c.variationCents > 0 ? 'text-amber-400' : 'text-emerald-400'}>
                          {' '}
                          ({c.variationCents > 0 ? '+' : ''}
                          {formatCents(c.variationCents)})
                        </span>
                      )}
                    </p>
                  )}
                </div>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-200">
                  {formatCents(c.expectedAmountCents)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
