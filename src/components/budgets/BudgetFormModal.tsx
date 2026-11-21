// Formulario de crear/editar presupuesto o meta. El limite se introduce en euros y se
// convierte a centimos enteros (nunca se persiste como float). El ambito determina que
// selector se muestra (categoria raiz, subcategoria o cuenta). Delega en budgetService.
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { Account, Budget, BudgetDirection, BudgetKind, BudgetPeriod, BudgetScope } from '../../db/schema';
import type { CategoryNode } from '../../services/categoryService';
import { Modal } from '../common';
import {
  budgetService,
  BUDGET_DIRECTION_LABELS,
  BUDGET_KIND_LABELS,
  BUDGET_PERIOD_LABELS,
  budgetKindOf,
  BUDGET_SCOPE_LABELS,
  MAX_BUDGET_NAME_LENGTH,
} from '../../services/budgetService';
import { centsToEuros, eurosToCents } from '../../lib/money';
import { shiftMonths, todayISO } from '../../lib/dates';
import { formatCents } from '../../lib/money';
import { useToast } from '../../context/ToastContext';

interface BudgetFormModalProps {
  open: boolean;
  onClose: () => void;
  profileId: string;
  onSaved: () => void | Promise<void>;
  budget?: Budget | null;
  categoryTree: CategoryNode[];
  accounts: Account[];
  // Tipo con el que se abre al crear (desde los botones de la seccion).
  initialKind?: BudgetKind;
  // Importe flexible sugerido (ingreso habitual - fijos - fondos - objetivos), si se conoce.
  suggestedFlexCents?: number | null;
}

const KIND_ORDER: readonly BudgetKind[] = ['limit', 'flex', 'goal', 'fund'];
const KIND_HINTS: Record<BudgetKind, string> = {
  limit: 'Un tope de gasto (o un objetivo de ingreso) para una categoría, cuenta o todo.',
  flex: 'Un único tope para tu gasto variable: los recibos fijos de tus recurrencias no cuentan.',
  goal: 'Una cantidad que quieres reunir antes de una fecha (viaje, colchón, entrada...).',
  fund: 'Un gasto que no es mensual (seguro, IBI, ITV): se aparta una cuota cada mes hasta su fecha.',
};

const SCOPE_ORDER: readonly BudgetScope[] = ['overall', 'category', 'subcategory', 'account'];
const PERIOD_ORDER: readonly BudgetPeriod[] = ['monthly', 'quarterly', 'yearly', 'custom'];
const DIRECTION_ORDER: readonly BudgetDirection[] = ['expense', 'income'];

const inputClass =
  'mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-slate-500';

export function BudgetFormModal({
  open,
  onClose,
  profileId,
  onSaved,
  budget,
  categoryTree,
  accounts,
  initialKind = 'limit',
  suggestedFlexCents = null,
}: BudgetFormModalProps) {
  const { showToast } = useToast();
  const isEdit = Boolean(budget);
  const [name, setName] = useState('');
  const [scope, setScope] = useState<BudgetScope>('overall');
  const [scopeId, setScopeId] = useState<string>('');
  const [direction, setDirection] = useState<BudgetDirection>('expense');
  const [limit, setLimit] = useState('0');
  const [period, setPeriod] = useState<BudgetPeriod>('monthly');
  const [customStart, setCustomStart] = useState(todayISO());
  const [customEnd, setCustomEnd] = useState(todayISO());
  const [kind, setKind] = useState<BudgetKind>('limit');
  const [rollover, setRollover] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Subcategorias aplanadas (con nombre "Padre / Hija") para el selector de subcategoria.
  const subcategories = useMemo(
    () =>
      categoryTree.flatMap((node) =>
        node.children.map((child) => ({
          id: child.id,
          label: `${node.category.name} / ${child.name}`,
        })),
      ),
    [categoryTree],
  );
  const roots = useMemo(() => categoryTree.map((n) => n.category), [categoryTree]);
  const activeAccounts = useMemo(() => accounts.filter((a) => a.archivedAt === null), [accounts]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSaving(false);
    if (budget) {
      setName(budget.name);
      setScope(budget.scope);
      setScopeId(budget.scopeId ?? '');
      setDirection(budget.direction);
      setLimit(String(centsToEuros(budget.limitCents)));
      setPeriod(budget.period);
      setCustomStart(budget.customStart ?? todayISO());
      setCustomEnd(budget.customEnd ?? todayISO());
      setKind(budgetKindOf(budget));
      setRollover(budget.rollover);
    } else {
      setName('');
      setLimit('0');
      setRollover(false);
      applyKind(initialKind);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, budget, initialKind]);

  // Ajusta los campos fijos de cada tipo (ambito, direccion y periodo).
  function applyKind(next: BudgetKind) {
    setKind(next);
    setError(null);
    if (next === 'flex') {
      setScope('overall');
      setScopeId('');
      setDirection('expense');
      setPeriod('monthly');
      if (suggestedFlexCents !== null && suggestedFlexCents > 0) setLimit(String(centsToEuros(suggestedFlexCents)));
    } else if (next === 'goal') {
      setScope('category');
      setScopeId('');
      setDirection('income');
      setPeriod('custom');
      setRollover(false);
      setCustomStart(todayISO());
      setCustomEnd(shiftMonths(todayISO(), 6));
    } else if (next === 'fund') {
      setScope('category');
      setScopeId('');
      setDirection('expense');
      setPeriod('custom');
      setRollover(false);
      setCustomStart(todayISO());
      setCustomEnd(shiftMonths(todayISO(), 12));
    } else {
      setScope('overall');
      setScopeId('');
      setDirection('expense');
      setPeriod('monthly');
    }
  }
  const scopeOptions: readonly BudgetScope[] =
    kind === 'fund' ? ['category', 'subcategory'] : kind === 'flex' ? ['overall'] : SCOPE_ORDER;
  const periodOptions: readonly BudgetPeriod[] =
    kind === 'flex' ? ['monthly', 'quarterly', 'yearly'] : PERIOD_ORDER;
  const canRollover = (kind === 'limit' || kind === 'flex') && direction === 'expense' && period !== 'custom';

  // Al cambiar de ambito se limpia el scopeId (las opciones dependen del ambito).
  function changeScope(next: BudgetScope) {
    setScope(next);
    setScopeId('');
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    setError(null);
    setSaving(true);
    try {
      const euros = limit.trim() === '' ? NaN : Number(limit.replace(',', '.'));
      if (!Number.isFinite(euros)) {
        throw new Error('El importe del presupuesto debe ser un número válido.');
      }
      const limitCents = eurosToCents(euros);
      const input = {
        name,
        scope,
        scopeId: scope === 'overall' ? null : scopeId,
        direction,
        limitCents,
        period,
        customStart: period === 'custom' ? customStart : null,
        customEnd: period === 'custom' ? customEnd : null,
        rollover: canRollover && rollover,
        kind,
      };
      if (budget) {
        await budgetService.update(profileId, budget.id, input);
      } else {
        await budgetService.create(profileId, input);
      }
      showToast(isEdit ? 'Presupuesto actualizado.' : 'Presupuesto creado.', 'success');
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el presupuesto.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? `Editar: ${BUDGET_KIND_LABELS[kind].toLowerCase()}` : 'Nuevo presupuesto, objetivo o fondo'}
      dismissible={!saving}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="budget-name" className="block text-sm font-medium text-slate-300">
            Nombre
          </label>
          <input
            id="budget-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={MAX_BUDGET_NAME_LENGTH}
            autoFocus
            placeholder="Gastos del mes, Ahorro, Supermercado..."
            className={inputClass}
          />
        </div>

        {!isEdit && (
          <div>
            <span className="block text-sm font-medium text-slate-300">Qué quieres crear</span>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {KIND_ORDER.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => applyKind(k)}
                  aria-pressed={kind === k}
                  className={[
                    'rounded-lg border px-3 py-2 text-left text-sm',
                    kind === k
                      ? 'border-indigo-500 bg-indigo-600/20 text-indigo-200'
                      : 'border-slate-700 text-slate-300',
                  ].join(' ')}
                >
                  {BUDGET_KIND_LABELS[k]}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-slate-500">{KIND_HINTS[kind]}</p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          {kind === 'limit' ? (
          <div>
            <label htmlFor="budget-direction" className="block text-sm font-medium text-slate-300">
              Tipo
            </label>
            <select
              id="budget-direction"
              value={direction}
              onChange={(e) => setDirection(e.target.value as BudgetDirection)}
              className={inputClass}
            >
              {DIRECTION_ORDER.map((d) => (
                <option key={d} value={d}>
                  {BUDGET_DIRECTION_LABELS[d]}
                </option>
              ))}
            </select>
          </div>
          ) : (
            <div className="self-end pb-2 text-xs text-slate-500">
              {kind === 'flex' && suggestedFlexCents !== null
                ? `Sugerido: ${formatCents(suggestedFlexCents)} (ingreso habitual menos fijos, fondos y objetivos)`
                : kind === 'goal'
                  ? 'Importe a reunir'
                  : kind === 'fund'
                    ? 'Importe del gasto'
                    : ''}
            </div>
          )}
          <div>
            <label htmlFor="budget-limit" className="block text-sm font-medium text-slate-300">
              {kind === 'goal' ? 'Objetivo (EUR)' : kind === 'fund' ? 'Gasto previsto (EUR)' : 'Importe (EUR)'}
            </label>
            <input
              id="budget-limit"
              type="text"
              inputMode="decimal"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>

        {kind !== 'flex' && (
        <div>
          <label htmlFor="budget-scope" className="block text-sm font-medium text-slate-300">
            {kind === 'goal' ? 'Dónde ahorras' : kind === 'fund' ? 'Dónde se registrará el gasto' : 'Ámbito'}
          </label>
          <select
            id="budget-scope"
            value={scope}
            onChange={(e) => changeScope(e.target.value as BudgetScope)}
            className={inputClass}
          >
            {scopeOptions.map((s) => (
              <option key={s} value={s}>
                {kind === 'goal' && s === 'overall' ? 'Ahorro neto total' : BUDGET_SCOPE_LABELS[s]}
              </option>
            ))}
          </select>
          {kind === 'goal' && (
            <p className="mt-1 text-xs text-slate-500">
              Por categoría cuenta lo que aportas a ella (p. ej. Ahorro); por cuenta, su saldo (una hucha o cuenta
              aparte, que deja de contar como dinero disponible).
            </p>
          )}
        </div>
        )}

        {scope !== 'overall' && (
          <div>
            <label htmlFor="budget-scope-id" className="block text-sm font-medium text-slate-300">
              {scope === 'account' ? 'Cuenta' : scope === 'subcategory' ? 'Subcategoría' : 'Categoría'}
            </label>
            <select
              id="budget-scope-id"
              value={scopeId}
              onChange={(e) => setScopeId(e.target.value)}
              className={inputClass}
            >
              <option value="">Selecciona...</option>
              {scope === 'account' &&
                activeAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              {scope === 'category' &&
                roots.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              {scope === 'subcategory' &&
                subcategories.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
            </select>
          </div>
        )}

        {(kind === 'limit' || kind === 'flex') && (
        <div>
          <label htmlFor="budget-period" className="block text-sm font-medium text-slate-300">
            Periodo
          </label>
          <select
            id="budget-period"
            value={period}
            onChange={(e) => setPeriod(e.target.value as BudgetPeriod)}
            className={inputClass}
          >
            {periodOptions.map((p) => (
              <option key={p} value={p}>
                {BUDGET_PERIOD_LABELS[p]}
              </option>
            ))}
          </select>
        </div>
        )}

        {canRollover && (
          <label className="flex items-start gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={rollover}
              onChange={(e) => setRollover(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Acumular lo que sobre o falte
              <span className="block text-xs text-slate-500">
                Lo que no gastes pasa al periodo siguiente; si te pasas, se descuenta. Sin castigo por un mal
                mes.
              </span>
            </span>
          </label>
        )}

        {period === 'custom' && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="budget-start" className="block text-sm font-medium text-slate-300">
                {kind === 'goal' || kind === 'fund' ? 'Empiezas el' : 'Desde'}
              </label>
              <input
                id="budget-start"
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="budget-end" className="block text-sm font-medium text-slate-300">
                {kind === 'goal' ? 'Fecha objetivo' : kind === 'fund' ? 'Vence el' : 'Hasta'}
              </label>
              <input
                id="budget-end"
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>
        )}

        {kind === 'fund' && (
          <p className="text-xs text-slate-500">
            Se repite cada año en la misma fecha. Lo apartado no cuenta en tu disponible para gastar.
          </p>
        )}

        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {saving ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
