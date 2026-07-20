// Detalle de una deuda: calendario de amortizacion, simulador de amortizacion anticipada,
// registro de pagos y candidatos de vinculacion con movimientos. Ampliacion, fase 8. No es
// asesoramiento financiero personalizado: solo calculo determinista sobre datos registrados.
import { useEffect, useState } from 'react';
import type { Debt } from '../../db/schema';
import type { ExtraPaymentMode, ScheduleResult, ExtraPaymentSimResult, ExtraPaymentComparison } from '../../services/debtAmortizationEngine';
import { debtsService, type RecordPaymentInput, type PaymentCandidate } from '../../services/debtsService';
import { formatCents, eurosToCents } from '../../lib/money';
import { writeXlsx } from '../../lib/csvXlsx';
import { downloadXlsx, timestampedFileName } from '../../lib/download';
import { exportService } from '../../services/exportService';
import { useToast } from '../../context/ToastContext';

interface DebtDetailPanelProps {
  profileId: string;
  debt: Debt;
  onPaymentRecorded: () => Promise<void>;
}

const inputClass =
  'mt-1 block w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100';
const labelClass = 'block text-xs font-medium text-slate-400';

export function DebtDetailPanel({ profileId, debt, onPaymentRecorded }: DebtDetailPanelProps) {
  const { showToast } = useToast();
  const [schedule, setSchedule] = useState<ScheduleResult | null>(null);
  const [scheduleError, setScheduleError] = useState<string | null>(null);

  const [recurringExtraEuros, setRecurringExtraEuros] = useState('0');
  const [oneTimeEuros, setOneTimeEuros] = useState('0');
  const [oneTimePeriod, setOneTimePeriod] = useState('1');
  const [mode, setMode] = useState<ExtraPaymentMode>('reduceTerm');
  const [simResult, setSimResult] = useState<{ withExtras: ExtraPaymentSimResult; comparison: ExtraPaymentComparison } | null>(null);
  const [simError, setSimError] = useState<string | null>(null);

  const [candidates, setCandidates] = useState<PaymentCandidate[]>([]);
  const [candidatesError, setCandidatesError] = useState<string | null>(null);
  const [paymentDate, setPaymentDate] = useState(debt.nextPaymentDate ?? '');
  const [paymentTotalEuros, setPaymentTotalEuros] = useState('');
  const [paymentInterestEuros, setPaymentInterestEuros] = useState('');
  const [paymentFeesEuros, setPaymentFeesEuros] = useState('0');
  const [paymentTransactionId, setPaymentTransactionId] = useState('');
  const [recordingPayment, setRecordingPayment] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSchedule(null);
    setScheduleError(null);
    setSimResult(null);
    void debtsService
      .getSchedule(profileId, debt.id)
      .then((r) => {
        if (!cancelled) setSchedule(r);
      })
      .catch((e) => {
        if (!cancelled) setScheduleError(e instanceof Error ? e.message : 'No se pudo generar el calendario.');
      });
    setCandidates([]);
    setCandidatesError(null);
    void debtsService
      .proposePaymentCandidates(profileId, debt.id)
      .then((c) => {
        if (!cancelled) setCandidates(c);
      })
      .catch((e) => {
        // No bloquea el registro manual de pagos: sin candidatos sugeridos, la persona sigue
        // pudiendo introducir el pago a mano. Sin errores silenciosos (CLAUDE.md): se muestra
        // el fallo en vez de fingir que no hay candidatos.
        if (!cancelled) {
          setCandidatesError(e instanceof Error ? e.message : 'No se pudieron calcular los candidatos de pago.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [profileId, debt.id, debt.outstandingPrincipalCents, debt.annualRatePpm, debt.minimumPaymentCents, debt.remainingTermMonths]);

  async function runSimulation() {
    setSimError(null);
    try {
      const result = await debtsService.simulateDebtExtraPayments(profileId, debt.id, {
        recurringExtraCents: eurosToCents(Number(recurringExtraEuros || '0')),
        oneTimePayments:
          Number(oneTimeEuros || '0') > 0
            ? [{ period: Number(oneTimePeriod || '1'), amountCents: eurosToCents(Number(oneTimeEuros)) }]
            : [],
        mode,
      });
      setSimResult({ withExtras: result.withExtras, comparison: result.comparison });
    } catch (e) {
      setSimError(e instanceof Error ? e.message : 'No se pudo simular la amortizacion anticipada.');
    }
  }

  async function downloadSchedule() {
    if (!schedule) return;
    const sheet = exportService.buildAmortizationScheduleSheet(schedule.rows, `Calendario ${debt.name}`);
    const bytes = await writeXlsx([sheet]);
    downloadXlsx(bytes, timestampedFileName(`gestor-calendario-${debt.name}`, 'xlsx'));
  }

  async function handleRecordPayment() {
    setRecordingPayment(true);
    setPaymentError(null);
    try {
      const totalCents = eurosToCents(Number(paymentTotalEuros || '0'));
      const interestCents = eurosToCents(Number(paymentInterestEuros || '0'));
      const feesCents = eurosToCents(Number(paymentFeesEuros || '0'));
      const principalCents = totalCents - interestCents - feesCents;
      const input: RecordPaymentInput = {
        date: paymentDate,
        totalCents,
        principalCents,
        interestCents,
        feesCents,
        extraPrincipalCents: 0,
        transactionId: paymentTransactionId.length > 0 ? paymentTransactionId : null,
      };
      await debtsService.recordPayment(profileId, debt.id, input);
      await onPaymentRecorded();
      showToast('Pago registrado.', 'success');
      setPaymentTotalEuros('');
      setPaymentInterestEuros('');
      setPaymentFeesEuros('0');
      setPaymentTransactionId('');
    } catch (e) {
      setPaymentError(e instanceof Error ? e.message : 'No se pudo registrar el pago.');
    } finally {
      setRecordingPayment(false);
    }
  }

  return (
    <div className="space-y-6">
      {debt.type === 'card' && (
        <p className="rounded-lg border border-amber-900/50 bg-amber-950/10 px-4 py-3 text-sm text-amber-300">
          Las tarjetas (revolving) no tienen calendario de amortizacion ni entran en Snowball/Avalanche en
          esta fase: solo se registra la deuda y sus pagos.
        </p>
      )}

      {scheduleError && <p className="text-sm text-amber-300">{scheduleError}</p>}

      {schedule && schedule.degenerate && (
        <p className="rounded-lg border border-red-900/50 bg-red-950/10 px-4 py-3 text-sm text-red-300">
          {schedule.degenerate === 'insufficientPayment' &&
            'La cuota registrada es menor que el interes del primer periodo: el saldo crecería (amortizacion negativa). Revisa la cuota o el tipo.'}
          {schedule.degenerate === 'criticalPayment' &&
            'La cuota registrada es exactamente igual al interes del primer periodo: el principal nunca se reduciría.'}
          {(schedule.degenerate === 'incompatibleData' || schedule.degenerate === 'extremeTerm' || schedule.degenerate === 'nonConvergence') &&
            'Los datos de la deuda no permiten generar un calendario valido.'}
        </p>
      )}

      {schedule && !schedule.degenerate && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Calendario de amortizacion</h3>
            <button
              type="button"
              onClick={() => void downloadSchedule()}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800"
            >
              Descargar tabla (XLSX)
            </button>
          </div>
          <p className="text-sm text-slate-400">
            Cuota {formatCents(schedule.installmentCents)} · Intereses totales {formatCents(schedule.totalInterestCents)} ·
            Fin previsto {schedule.payoffDate}
          </p>
          {/* La tabla es mas ancha que una pantalla estrecha: aviso de desplazamiento solo en
              movil (en PC ya se ve entera, el aviso sobraria). */}
          <p className="text-xs text-slate-500 sm:hidden" aria-hidden>
            Desliza la tabla hacia la derecha para ver principal y saldo →
          </p>
          <div className="max-h-72 overflow-auto rounded-lg border border-slate-800">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead className="sticky top-0 bg-slate-900 text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th scope="col" className="px-3 py-2">Periodo</th>
                  <th scope="col" className="px-3 py-2">Fecha</th>
                  <th scope="col" className="px-3 py-2">Cuota</th>
                  <th scope="col" className="px-3 py-2">Interes</th>
                  <th scope="col" className="px-3 py-2">Principal</th>
                  <th scope="col" className="px-3 py-2">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {schedule.rows.map((r) => (
                  <tr key={r.period} className="border-t border-slate-800">
                    <td className="px-3 py-1.5">{r.period}</td>
                    <td className="px-3 py-1.5">{r.date}</td>
                    <td className="px-3 py-1.5">{formatCents(r.paymentCents)}</td>
                    <td className="px-3 py-1.5">{formatCents(r.interestCents)}</td>
                    <td className="px-3 py-1.5">{formatCents(r.principalCents)}</td>
                    <td className="px-3 py-1.5">{formatCents(r.balanceCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {schedule && !schedule.degenerate && (
        <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Simulador de amortizacion anticipada
          </h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className={labelClass}>
              Extra mensual (EUR)
              <input type="number" min="0" step="0.01" value={recurringExtraEuros} onChange={(e) => setRecurringExtraEuros(e.target.value)} className={inputClass} />
            </label>
            <label className={labelClass}>
              Extra puntual (EUR)
              <input type="number" min="0" step="0.01" value={oneTimeEuros} onChange={(e) => setOneTimeEuros(e.target.value)} className={inputClass} />
            </label>
            <label className={labelClass}>
              Periodo del extra puntual
              <input type="number" min="1" step="1" value={oneTimePeriod} onChange={(e) => setOneTimePeriod(e.target.value)} className={inputClass} />
            </label>
            <label className={labelClass}>
              Modo
              <select value={mode} onChange={(e) => setMode(e.target.value as ExtraPaymentMode)} className={inputClass}>
                <option value="reduceTerm">Reducir plazo (mantener cuota)</option>
                <option value="reducePayment">Reducir cuota (mantener plazo)</option>
              </select>
            </label>
          </div>
          <button
            type="button"
            onClick={() => void runSimulation()}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
          >
            Simular
          </button>
          {simError && <p className="text-sm text-red-400">{simError}</p>}
          {simResult && (
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <Stat label="Meses ahorrados" value={String(simResult.comparison.monthsSaved)} />
              <Stat label="Intereses ahorrados" value={formatCents(simResult.comparison.interestSavedCents)} />
              <Stat label="Cuota nueva" value={formatCents(simResult.comparison.newInstallmentCents)} />
              <Stat label="Coste total nuevo" value={formatCents(simResult.comparison.newTotalCostCents)} />
            </div>
          )}
        </section>
      )}

      <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Registrar pago</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className={labelClass}>
            Fecha
            <input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} className={inputClass} />
          </label>
          <label className={labelClass}>
            Total (EUR)
            <input type="number" min="0" step="0.01" value={paymentTotalEuros} onChange={(e) => setPaymentTotalEuros(e.target.value)} className={inputClass} />
          </label>
          <label className={labelClass}>
            Interes (EUR)
            <input type="number" min="0" step="0.01" value={paymentInterestEuros} onChange={(e) => setPaymentInterestEuros(e.target.value)} className={inputClass} />
          </label>
          <label className={labelClass}>
            Comisiones (EUR)
            <input type="number" min="0" step="0.01" value={paymentFeesEuros} onChange={(e) => setPaymentFeesEuros(e.target.value)} className={inputClass} />
          </label>
        </div>
        {candidatesError && <p className="text-xs text-amber-300">{candidatesError}</p>}
        {candidates.length > 0 && (
          <div>
            <p className="mb-1 text-xs text-slate-400">Movimientos candidatos (sin vincular automaticamente):</p>
            <div className="flex flex-wrap gap-2">
              {candidates.map((c) => (
                <button
                  key={c.transactionId}
                  type="button"
                  onClick={() => setPaymentTransactionId(c.transactionId)}
                  className={`rounded-lg border px-3 py-1.5 text-xs ${
                    paymentTransactionId === c.transactionId
                      ? 'border-indigo-500 bg-indigo-950/40 text-indigo-200'
                      : 'border-slate-700 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  {c.date} · {formatCents(Math.abs(c.amountCents))} · confianza {Math.round(c.confidencePerMille / 10)}%
                </button>
              ))}
            </div>
          </div>
        )}
        {paymentError && <p className="text-sm text-red-400">{paymentError}</p>}
        <button
          type="button"
          disabled={recordingPayment}
          onClick={() => void handleRecordPayment()}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {recordingPayment ? 'Guardando...' : 'Registrar pago'}
        </button>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-0.5 font-medium text-slate-100">{value}</p>
    </div>
  );
}
