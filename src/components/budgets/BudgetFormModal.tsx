// Formulario de crear/editar presupuesto o meta. El limite se introduce en euros y se
// convierte a centimos enteros (nunca se persiste como float). El ambito determina que
// selector se muestra (categoria raiz, subcategoria o cuenta). Delega en budgetService.
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { Account, Budget, BudgetDirection, BudgetPeriod, BudgetScope } from '../../db/schema';
import type { CategoryNode } from '../../services/categoryService';
import { Modal } from '../common';
import {
  budgetService,
  BUDGET_DIRECTION_LABELS,
  BUDGET_PERIOD_LABELS,
  BUDGET_SCOPE_LABELS,
  MAX_BUDGET_NAME_LENGTH,
} from '../../services/budgetService';
import { centsToEuros, eurosToCents } from '../../lib/money';
import { todayISO } from '../../lib/dates';
import { useToast } from '../../context/ToastContext';

interface BudgetFormModalProps {
  open: boolean;
  onClose: () => void;
  profileId: string;
  onSaved: () => void | Promise<void>;
  budget?: Budget | null;
  categoryTree: CategoryNode[];
  accounts: Account[];
}

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
    } else {
      setName('');
      setScope('overall');
      setScopeId('');
      setDirection('expense');
      setLimit('0');
      setPeriod('monthly');
      setCustomStart(todayISO());
      setCustomEnd(todayISO());
    }
  }, [open, budget]);

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
        throw new Error('El importe del presupuesto debe ser un numero valido.');
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
      title={isEdit ? 'Editar presupuesto' : 'Nuevo presupuesto'}
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

        <div className="grid grid-cols-2 gap-3">
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
          <div>
            <label htmlFor="budget-limit" className="block text-sm font-medium text-slate-300">
              Importe (EUR)
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

        <div>
          <label htmlFor="budget-scope" className="block text-sm font-medium text-slate-300">
            Ambito
          </label>
          <select
            id="budget-scope"
            value={scope}
            onChange={(e) => changeScope(e.target.value as BudgetScope)}
            className={inputClass}
          >
            {SCOPE_ORDER.map((s) => (
              <option key={s} value={s}>
                {BUDGET_SCOPE_LABELS[s]}
              </option>
            ))}
          </select>
        </div>

        {scope !== 'overall' && (
          <div>
            <label htmlFor="budget-scope-id" className="block text-sm font-medium text-slate-300">
              {scope === 'account' ? 'Cuenta' : scope === 'subcategory' ? 'Subcategoria' : 'Categoria'}
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
            {PERIOD_ORDER.map((p) => (
              <option key={p} value={p}>
                {BUDGET_PERIOD_LABELS[p]}
              </option>
            ))}
          </select>
        </div>

        {period === 'custom' && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="budget-start" className="block text-sm font-medium text-slate-300">
                Desde
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
                Hasta
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
