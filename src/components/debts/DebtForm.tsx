// Formulario de alta/edicion de deuda (ampliacion, fase 8). Los importes se editan en euros y
// se convierten a centimos al guardar; el tipo de interes se edita en porcentaje y se convierte
// a micro-fraccion 1e-6 (ppm). No es asesoramiento financiero: solo recoge los datos que la
// persona ya conoce de su deuda.
import { useState, type FormEvent } from 'react';
import type { Account, Category, Debt, DebtType } from '../../db/schema';
import type { CreateDebtInput } from '../../services/debtsService';
import { eurosToCents, centsToEuros } from '../../lib/money';

const TYPE_OPTIONS: { value: DebtType; label: string }[] = [
  { value: 'personalLoan', label: 'Prestamo personal' },
  { value: 'mortgageFixed', label: 'Hipoteca fija' },
  { value: 'card', label: 'Tarjeta (sin calendario en esta fase)' },
  { value: 'other', label: 'Otra deuda amortizable' },
];

interface DebtFormProps {
  initial?: Debt | null;
  accounts: Account[];
  categories: Category[];
  onSubmit: (input: CreateDebtInput) => Promise<void>;
  onCancel: () => void;
}

const inputClass =
  'mt-1 block w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100';
const labelClass = 'block text-xs font-medium text-slate-400';

export function DebtForm({ initial = null, accounts, categories, onSubmit, onCancel }: DebtFormProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [type, setType] = useState<DebtType>(initial?.type ?? 'personalLoan');
  const [originalEuros, setOriginalEuros] = useState(
    initial ? String(centsToEuros(initial.originalPrincipalCents)) : '',
  );
  const [outstandingEuros, setOutstandingEuros] = useState(
    initial ? String(centsToEuros(initial.outstandingPrincipalCents)) : '',
  );
  const [ratePercent, setRatePercent] = useState(initial ? String(initial.annualRatePpm / 10000) : '0');
  const [minPaymentEuros, setMinPaymentEuros] = useState(
    initial ? String(centsToEuros(initial.minimumPaymentCents)) : '',
  );
  const [nextPaymentDate, setNextPaymentDate] = useState(initial?.nextPaymentDate ?? '');
  const [remainingTermMonths, setRemainingTermMonths] = useState(
    initial?.remainingTermMonths !== null && initial?.remainingTermMonths !== undefined
      ? String(initial.remainingTermMonths)
      : '',
  );
  const [linkedAccountId, setLinkedAccountId] = useState(initial?.linkedAccountId ?? '');
  const [linkedCategoryId, setLinkedCategoryId] = useState(initial?.linkedCategoryId ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const input: CreateDebtInput = {
        name,
        type,
        currency: 'EUR',
        originalPrincipalCents: eurosToCents(Number(originalEuros)),
        outstandingPrincipalCents: eurosToCents(Number(outstandingEuros)),
        annualRatePpm: Math.round(Number(ratePercent) * 10000),
        minimumPaymentCents: eurosToCents(Number(minPaymentEuros)),
        paymentFrequency: 'monthly',
        nextPaymentDate: nextPaymentDate.length > 0 ? nextPaymentDate : null,
        remainingTermMonths: remainingTermMonths.length > 0 ? Number(remainingTermMonths) : null,
        linkedAccountId: linkedAccountId.length > 0 ? linkedAccountId : null,
        linkedCategoryId: linkedCategoryId.length > 0 ? linkedCategoryId : null,
        status: initial?.status ?? 'active',
      };
      await onSubmit(input);
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'No se pudo guardar la deuda.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className={labelClass}>
          Nombre
          <input required value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </label>
        <label className={labelClass}>
          Tipo
          <select value={type} onChange={(e) => setType(e.target.value as DebtType)} className={inputClass}>
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          Principal original (EUR)
          <input
            required
            type="number"
            step="0.01"
            min="0"
            value={originalEuros}
            onChange={(e) => setOriginalEuros(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          Principal pendiente (EUR)
          <input
            required
            type="number"
            step="0.01"
            min="0"
            value={outstandingEuros}
            onChange={(e) => setOutstandingEuros(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          Tipo de interes anual (%)
          <input
            required
            type="number"
            step="0.0001"
            min="0"
            value={ratePercent}
            onChange={(e) => setRatePercent(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          Cuota / pago mínimo (EUR)
          <input
            required
            type="number"
            step="0.01"
            min="0"
            value={minPaymentEuros}
            onChange={(e) => setMinPaymentEuros(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          Proxima fecha de pago
          <input
            type="date"
            value={nextPaymentDate}
            onChange={(e) => setNextPaymentDate(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          Plazo restante (meses)
          <input
            type="number"
            min="0"
            step="1"
            value={remainingTermMonths}
            onChange={(e) => setRemainingTermMonths(e.target.value)}
            className={inputClass}
            placeholder="Sin plazo conocido"
          />
        </label>
        <label className={labelClass}>
          Cuenta vinculada
          <select value={linkedAccountId} onChange={(e) => setLinkedAccountId(e.target.value)} className={inputClass}>
            <option value="">Sin vincular</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          Categoría vinculada
          <select value={linkedCategoryId} onChange={(e) => setLinkedCategoryId(e.target.value)} className={inputClass}>
            <option value="">Sin vincular</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <p className="text-sm text-red-400" role="alert">{error}</p>}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-lg px-4 py-2 text-sm text-slate-300 hover:bg-slate-800">
          Cancelar
        </button>
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {saving ? 'Guardando...' : initial ? 'Guardar cambios' : 'Crear deuda'}
        </button>
      </div>
    </form>
  );
}
