// Ajustes de planificacion (noviembre 2026): dia de cobro, colchon minimo, periodo de los
// presupuestos mensuales y pagas extra. Alimentan el disponible, la prevision de saldo y los
// presupuestos. Se guardan en la configuracion del perfil (se sincroniza si hay cuenta).
import { useEffect, useState, type FormEvent } from 'react';
import { useActiveProfileId } from '../../hooks/useProfiles';
import { planningSettingsService, type PlanningSettings } from '../../services/planningSettings';
import { centsToEuros, eurosToCents } from '../../lib/money';
import { useToast } from '../../context/ToastContext';

const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const inputClass =
  'mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-slate-500';

export function PlanningSettingsSection() {
  const profileId = useActiveProfileId();
  const { showToast } = useToast();
  const [settings, setSettings] = useState<PlanningSettings | null>(null);
  const [payDay, setPayDay] = useState('');
  const [buffer, setBuffer] = useState('0');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSettings(null);
    planningSettingsService
      .get(profileId)
      .then((s) => {
        if (cancelled) return;
        setSettings(s);
        setPayDay(s.payDay === null ? '' : String(s.payDay));
        setBuffer(String(centsToEuros(s.safetyBufferCents)));
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'No se pudo cargar la configuración.'));
    return () => {
      cancelled = true;
    };
  }, [profileId]);

  if (!settings) return null;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!settings || saving) return;
    setError(null);
    setSaving(true);
    try {
      const bufferEuros = buffer.trim() === '' ? 0 : Number(buffer.replace(',', '.'));
      if (!Number.isFinite(bufferEuros) || bufferEuros < 0) throw new Error('El colchón debe ser un importe válido.');
      const updated = await planningSettingsService.update(profileId, {
        payDay: payDay === '' ? null : Number(payDay),
        safetyBufferCents: eurosToCents(bufferEuros),
        budgetCycle: settings.budgetCycle,
        extraPayMonths: settings.extraPayMonths,
        reserveExtraPay: settings.reserveExtraPay,
      });
      setSettings(updated);
      showToast('Planificación guardada.', 'success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar.');
    } finally {
      setSaving(false);
    }
  }

  function toggleMonth(m: number) {
    setSettings((s) =>
      s
        ? {
            ...s,
            extraPayMonths: s.extraPayMonths.includes(m)
              ? s.extraPayMonths.filter((x) => x !== m)
              : [...s.extraPayMonths, m].sort((a, b) => a - b),
          }
        : s,
    );
  }

  return (
    <form onSubmit={save} className="mt-6 rounded-2xl border border-slate-800 bg-slate-900 p-5">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Planificación</h3>
      <p className="mt-2 text-sm text-slate-400">
        Con tu día de cobro y tu colchón, la portada calcula cuánto puedes gastar hasta la siguiente nómina.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="plan-payday" className="block text-sm font-medium text-slate-300">
            Día de cobro
          </label>
          <select id="plan-payday" value={payDay} onChange={(e) => setPayDay(e.target.value)} className={inputClass}>
            <option value="">Automático (por tu nómina)</option>
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                Día {d}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="plan-buffer" className="block text-sm font-medium text-slate-300">
            Colchón mínimo (EUR)
          </label>
          <input
            id="plan-buffer"
            type="text"
            inputMode="decimal"
            value={buffer}
            onChange={(e) => setBuffer(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        El colchón es lo que nunca se cuenta como disponible: la portada te avisa si la previsión baja de ahí.
      </p>

      <fieldset className="mt-4">
        <legend className="text-sm font-medium text-slate-300">Presupuestos mensuales</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {(['calendar', 'payday'] as const).map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={settings.budgetCycle === c}
              onClick={() => setSettings({ ...settings, budgetCycle: c })}
              className={[
                'rounded-lg border px-3 py-1.5 text-sm',
                settings.budgetCycle === c
                  ? 'border-indigo-500 bg-indigo-600/20 text-indigo-200'
                  : 'border-slate-700 text-slate-300',
              ].join(' ')}
            >
              {c === 'calendar' ? 'Mes natural' : 'De nómina a nómina'}
            </button>
          ))}
        </div>
        {settings.budgetCycle === 'payday' && payDay === '' && (
          <p className="mt-1 text-xs text-amber-300">Indica tu día de cobro para usar este periodo.</p>
        )}
      </fieldset>

      <fieldset className="mt-4">
        <legend className="text-sm font-medium text-slate-300">Meses con paga extra</legend>
        <div className="mt-2 grid grid-cols-6 gap-1.5">
          {MONTHS.map((label, i) => {
            const m = i + 1;
            const on = settings.extraPayMonths.includes(m);
            return (
              <button
                key={m}
                type="button"
                aria-pressed={on}
                onClick={() => toggleMonth(m)}
                className={`rounded-md border py-1 text-xs ${on ? 'border-indigo-500 bg-indigo-600/20 text-indigo-200' : 'border-slate-700 text-slate-400'}`}
              >
                {label}
              </button>
            );
          })}
        </div>
        <label className="mt-3 flex items-start gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={settings.reserveExtraPay}
            onChange={(e) => setSettings({ ...settings, reserveExtraPay: e.target.checked })}
            className="mt-0.5"
          />
          <span>
            Apartar las pagas extra del disponible
            <span className="block text-xs text-slate-500">
              Una paga extra no se convierte en dinero del mes: queda apartada hasta tu siguiente cobro para que la
              asignes a un objetivo o fondo.
            </span>
          </span>
        </label>
      </fieldset>

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      <div className="mt-4 flex justify-end">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {saving ? 'Guardando...' : 'Guardar'}
        </button>
      </div>
    </form>
  );
}
