// Formulario de crear/editar una regla de autocategorizacion. Construye las condiciones
// (combinables, con matchMode todas/alguna), la accion (categoria, subcategoria, etiquetas,
// exclusion) y permite SIMULAR contra los movimientos existentes antes de guardar (cuenta
// cuantos se verian afectados, sin escribir nada). Toda la logica vive en ruleService; aqui
// solo orquestacion de UI y conversion de importes euros<->centimos.
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type {
  Account,
  Category,
  Merchant,
  Rule,
  RuleAction,
  RuleCondition,
  RuleConditionField,
  RuleConditionOperator,
  RuleMatchMode,
  Tag,
  TransactionType,
} from '../../db/schema';
import { Modal } from '../common';
import { syncDefaults } from '../../db/index';
import { useToast } from '../../context/ToastContext';
import {
  ruleService,
  validateRuleInput,
  OPERATORS_BY_FIELD,
  type RuleInput,
} from '../../services/ruleService';
import { eurosToCents } from '../../lib/money';

const FIELDS: readonly RuleConditionField[] = ['concept', 'amount', 'date', 'account', 'type', 'merchant'];

const FIELD_LABELS: Record<RuleConditionField, string> = {
  concept: 'Concepto',
  amount: 'Importe',
  date: 'Fecha',
  account: 'Cuenta',
  type: 'Tipo',
  merchant: 'Comercio',
};

const OPERATOR_LABELS: Record<RuleConditionOperator, string> = {
  contains: 'contiene',
  notContains: 'no contiene',
  startsWith: 'empieza por',
  endsWith: 'termina en',
  equals: 'coincide',
  regex: 'regex',
  gt: 'mayor que',
  lt: 'menor que',
  gte: 'mayor o igual',
  lte: 'menor o igual',
  eq: 'igual a',
  between: 'entre',
  before: 'antes de',
  after: 'después de',
};

const TYPE_LABELS: Record<TransactionType, string> = {
  expense: 'Gasto',
  income: 'Ingreso',
  transfer: 'Transferencia',
};

// Estado editable de una condicion: los valores se guardan como texto y se convierten al
// construir la RuleCondition (importe: euros->centimos; el resto tal cual).
interface DraftCondition {
  field: RuleConditionField;
  operator: RuleConditionOperator;
  value: string;
  value2: string;
  caseSensitive: boolean;
}

type ExcludeMode = 'keep' | 'exclude' | 'include';

const inputClass =
  'mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-slate-500';
const smallSelect =
  'rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-slate-500';

function emptyCondition(): DraftCondition {
  return { field: 'concept', operator: 'contains', value: '', value2: '', caseSensitive: false };
}

// Convierte una RuleCondition persistida a estado editable (centimos->euros en importes).
function conditionToDraft(c: RuleCondition): DraftCondition {
  if (c.field === 'amount') {
    return {
      field: c.field,
      operator: c.operator,
      value: typeof c.value === 'number' ? String(c.value / 100) : String(c.value ?? ''),
      value2:
        typeof c.value2 === 'number' ? String(c.value2 / 100) : c.value2 != null ? String(c.value2) : '',
      caseSensitive: c.caseSensitive,
    };
  }
  return {
    field: c.field,
    operator: c.operator,
    value: String(c.value ?? ''),
    value2: c.value2 != null ? String(c.value2) : '',
    caseSensitive: c.caseSensitive,
  };
}

// Convierte un importe en euros escrito por el usuario a centimos enteros. Devuelve NaN si el
// texto esta vacio o no es numerico (la validacion de ruleService lo rechazara con un mensaje
// claro). Importante: Number('') es 0 en JS, por eso se trata la cadena vacia explicitamente,
// para no crear en silencio una condicion "importe = 0" cuando el campo se deja en blanco.
export function eurosTextToCents(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return Number.NaN;
  const n = Number(trimmed.replace(',', '.'));
  if (!Number.isFinite(n)) return Number.NaN;
  return eurosToCents(n);
}

// Construye la RuleCondition a partir del estado editable.
function draftToCondition(d: DraftCondition): RuleCondition {
  let value: string | number = d.value.trim();
  let value2: string | number | null = d.value2.trim().length > 0 ? d.value2.trim() : null;
  if (d.field === 'amount') {
    value = eurosTextToCents(d.value);
    value2 = d.operator === 'between' ? eurosTextToCents(d.value2) : null;
  } else if (d.field !== 'date') {
    value2 = null;
  }
  return { field: d.field, operator: d.operator, value, value2, caseSensitive: d.caseSensitive };
}

interface RuleFormModalProps {
  open: boolean;
  onClose: () => void;
  profileId: string;
  accounts: Account[];
  categories: Category[];
  tags: Tag[];
  merchants: Merchant[];
  onSaved: () => void | Promise<void>;
  rule?: Rule | null;
}

export function RuleFormModal({
  open,
  onClose,
  profileId,
  accounts,
  categories,
  tags,
  merchants,
  onSaved,
  rule,
}: RuleFormModalProps) {
  const { showToast } = useToast();
  const isEdit = Boolean(rule);

  const [name, setName] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [matchMode, setMatchMode] = useState<RuleMatchMode>('all');
  const [stopOnMatch, setStopOnMatch] = useState(true);
  const [conditions, setConditions] = useState<DraftCondition[]>([emptyCondition()]);
  const [categoryId, setCategoryId] = useState('');
  const [subcategoryId, setSubcategoryId] = useState('');
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [excludeMode, setExcludeMode] = useState<ExcludeMode>('keep');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [simCount, setSimCount] = useState<number | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [simOverrideManual, setSimOverrideManual] = useState(false);

  const rootCategories = useMemo(
    () =>
      categories
        .filter((c) => c.parentId === null)
        .filter((c) => c.archivedAt === null || c.id === categoryId)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    [categories, categoryId],
  );
  const subCategories = useMemo(
    () =>
      categories
        .filter((c) => c.parentId === categoryId)
        .filter((c) => c.archivedAt === null || c.id === subcategoryId)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    [categories, categoryId, subcategoryId],
  );
  const activeAccounts = useMemo(() => accounts.filter((a) => a.archivedAt === null), [accounts]);
  const activeMerchants = useMemo(() => merchants.filter((m) => m.archivedAt === null), [merchants]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSaving(false);
    setSimCount(null);
    setSimOverrideManual(false);
    if (rule) {
      setName(rule.name);
      setEnabled(rule.enabled);
      setMatchMode(rule.matchMode);
      setStopOnMatch(rule.stopOnMatch);
      setConditions(
        rule.conditions.length > 0 ? rule.conditions.map(conditionToDraft) : [emptyCondition()],
      );
      setCategoryId(rule.action.setCategoryId ?? '');
      setSubcategoryId(rule.action.setSubcategoryId ?? '');
      setTagIds(rule.action.addTagIds);
      setExcludeMode(
        rule.action.setExcludedFromStats === null
          ? 'keep'
          : rule.action.setExcludedFromStats
            ? 'exclude'
            : 'include',
      );
    } else {
      setName('');
      setEnabled(true);
      setMatchMode('all');
      setStopOnMatch(true);
      setConditions([emptyCondition()]);
      setCategoryId('');
      setSubcategoryId('');
      setTagIds([]);
      setExcludeMode('keep');
    }
  }, [open, rule]);

  function updateCondition(index: number, patch: Partial<DraftCondition>) {
    setConditions((cur) =>
      cur.map((c, i) => {
        if (i !== index) return c;
        const next = { ...c, ...patch };
        // Al cambiar el campo, el operador vuelve al primero valido de ese campo.
        if (patch.field !== undefined && patch.operator === undefined) {
          next.operator = OPERATORS_BY_FIELD[patch.field][0];
          next.value = '';
          next.value2 = '';
        }
        return next;
      }),
    );
    setSimCount(null);
  }

  function addCondition() {
    setConditions((cur) => [...cur, emptyCondition()]);
    setSimCount(null);
  }
  function removeCondition(index: number) {
    setConditions((cur) => (cur.length <= 1 ? cur : cur.filter((_, i) => i !== index)));
    setSimCount(null);
  }
  function toggleTag(id: string) {
    setTagIds((cur) => (cur.includes(id) ? cur.filter((t) => t !== id) : [...cur, id]));
    setSimCount(null);
  }

  // Construye el RuleInput a partir del formulario (sin validar; ruleService valida).
  function buildInput(): RuleInput {
    const action: RuleAction = {
      setCategoryId: categoryId || null,
      setSubcategoryId: categoryId && subcategoryId ? subcategoryId : null,
      addTagIds: tagIds,
      setExcludedFromStats:
        excludeMode === 'keep' ? null : excludeMode === 'exclude' ? true : false,
    };
    return {
      name,
      enabled,
      matchMode,
      conditions: conditions.map(draftToCondition),
      action,
      stopOnMatch,
    };
  }

  async function handleSimulate() {
    setError(null);
    setSimulating(true);
    try {
      const input = validateRuleInput(buildInput());
      // Regla candidata (forzada activa) para evaluar aunque se vaya a guardar desactivada.
      const candidate: Rule = {
        ...syncDefaults(),
        id: rule?.id ?? 'candidate',
        profileId,
        name: input.name,
        enabled: true,
        priority: rule?.priority ?? 0,
        matchMode: input.matchMode,
        conditions: input.conditions,
        action: input.action,
        stopOnMatch: input.stopOnMatch,
        createdAt: rule?.createdAt ?? 0,
        updatedAt: 0,
      };
      const result = await ruleService.simulate(profileId, [candidate], {
        overrideManual: simOverrideManual,
      });
      setSimCount(result.changed);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo simular la regla.');
    } finally {
      setSimulating(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    setError(null);
    setSaving(true);
    try {
      const input = buildInput();
      if (rule) await ruleService.update(profileId, rule.id, input);
      else await ruleService.create(profileId, input);
      showToast(isEdit ? 'Regla actualizada.' : 'Regla creada.', 'success');
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la regla.');
    } finally {
      setSaving(false);
    }
  }

  function renderValueInputs(c: DraftCondition, index: number) {
    if (c.field === 'account') {
      return (
        <select
          value={c.value}
          onChange={(e) => updateCondition(index, { value: e.target.value })}
          className={smallSelect}
        >
          <option value="">Elige cuenta</option>
          {activeAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      );
    }
    if (c.field === 'type') {
      return (
        <select
          value={c.value}
          onChange={(e) => updateCondition(index, { value: e.target.value })}
          className={smallSelect}
        >
          <option value="">Elige tipo</option>
          {(['expense', 'income', 'transfer'] as const).map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      );
    }
    if (c.field === 'merchant') {
      return (
        <select
          value={c.value}
          onChange={(e) => updateCondition(index, { value: e.target.value })}
          className={smallSelect}
        >
          <option value="">Elige comercio</option>
          {activeMerchants.map((m) => (
            <option key={m.id} value={m.id}>
              {m.canonicalName}
            </option>
          ))}
        </select>
      );
    }
    if (c.field === 'date') {
      return (
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            type="date"
            value={c.value}
            onChange={(e) => updateCondition(index, { value: e.target.value })}
            className={smallSelect}
          />
          {c.operator === 'between' && (
            <>
              <span className="text-xs text-slate-500">y</span>
              <input
                type="date"
                value={c.value2}
                onChange={(e) => updateCondition(index, { value2: e.target.value })}
                className={smallSelect}
              />
            </>
          )}
        </div>
      );
    }
    if (c.field === 'amount') {
      return (
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            type="number"
            step="0.01"
            inputMode="decimal"
            placeholder="Euros"
            value={c.value}
            onChange={(e) => updateCondition(index, { value: e.target.value })}
            className={`${smallSelect} w-28`}
          />
          {c.operator === 'between' && (
            <>
              <span className="text-xs text-slate-500">y</span>
              <input
                type="number"
                step="0.01"
                inputMode="decimal"
                placeholder="Euros"
                value={c.value2}
                onChange={(e) => updateCondition(index, { value2: e.target.value })}
                className={`${smallSelect} w-28`}
              />
            </>
          )}
        </div>
      );
    }
    // concept (texto)
    return (
      <div className="flex flex-1 flex-wrap items-center gap-2">
        <input
          type="text"
          value={c.value}
          placeholder={c.operator === 'regex' ? 'patron regex' : 'texto'}
          onChange={(e) => updateCondition(index, { value: e.target.value })}
          className={`${smallSelect} min-w-[8rem] flex-1`}
        />
        <label className="flex items-center gap-1 text-xs text-slate-400">
          <input
            type="checkbox"
            checked={c.caseSensitive}
            onChange={(e) => updateCondition(index, { caseSensitive: e.target.checked })}
          />
          May/min
        </label>
      </div>
    );
  }

  const title = isEdit ? 'Editar regla' : 'Nueva regla';

  return (
    <Modal open={open} onClose={onClose} title={title} dismissible={!saving}>
      <form onSubmit={handleSubmit} className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
        <div>
          <label htmlFor="rule-name" className="block text-sm font-medium text-slate-300">
            Nombre
          </label>
          <input
            id="rule-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            className={inputClass}
          />
        </div>

        {/* Condiciones */}
        <div>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-300">Condiciones</span>
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-slate-500">Cumplir</span>
              {(['all', 'any'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setMatchMode(m);
                    setSimCount(null);
                  }}
                  aria-pressed={matchMode === m}
                  className={[
                    'rounded-lg border px-2 py-1',
                    matchMode === m
                      ? 'border-indigo-500 bg-indigo-600/20 text-indigo-200'
                      : 'border-slate-700 text-slate-300',
                  ].join(' ')}
                >
                  {m === 'all' ? 'todas' : 'alguna'}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-2 space-y-2">
            {conditions.map((c, i) => (
              <div
                key={i}
                className="space-y-2 rounded-lg border border-slate-800 bg-slate-900/60 p-2"
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <select
                    value={c.field}
                    onChange={(e) =>
                      updateCondition(i, { field: e.target.value as RuleConditionField })
                    }
                    className={smallSelect}
                  >
                    {FIELDS.map((f) => (
                      <option key={f} value={f}>
                        {FIELD_LABELS[f]}
                      </option>
                    ))}
                  </select>
                  <select
                    value={c.operator}
                    onChange={(e) =>
                      updateCondition(i, { operator: e.target.value as RuleConditionOperator })
                    }
                    className={smallSelect}
                  >
                    {OPERATORS_BY_FIELD[c.field].map((op) => (
                      <option key={op} value={op}>
                        {OPERATOR_LABELS[op]}
                      </option>
                    ))}
                  </select>
                  {conditions.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeCondition(i)}
                      className="ml-auto rounded px-2 py-1 text-xs text-red-400 hover:bg-red-950/60"
                    >
                      Quitar
                    </button>
                  )}
                </div>
                {renderValueInputs(c, i)}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addCondition}
            className="mt-2 rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800"
          >
            + Añadir condicion
          </button>
          {conditions.some((c) => c.field === 'amount') && (
            <p className="mt-1 text-[11px] text-slate-500">
              Importes en euros. Los gastos son negativos (p. ej. -50 para un gasto de 50 euros).
            </p>
          )}
        </div>

        {/* Acción */}
        <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-900/60 p-3">
          <span className="text-sm font-medium text-slate-300">Acción</span>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-slate-400">Categoría</label>
              <select
                value={categoryId}
                onChange={(e) => {
                  setCategoryId(e.target.value);
                  setSubcategoryId('');
                  setSimCount(null);
                }}
                className={inputClass}
              >
                <option value="">Sin categoría</option>
                {rootCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400">Subcategoría</label>
              <select
                value={subcategoryId}
                onChange={(e) => setSubcategoryId(e.target.value)}
                disabled={!categoryId || subCategories.length === 0}
                className={`${inputClass} disabled:opacity-50`}
              >
                <option value="">Ninguna</option>
                {subCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {tags.length > 0 && (
            <div>
              <span className="block text-xs text-slate-400">Añadir etiquetas</span>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {tags.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => toggleTag(t.id)}
                    aria-pressed={tagIds.includes(t.id)}
                    className={[
                      'rounded-full border px-2.5 py-1 text-xs',
                      tagIds.includes(t.id)
                        ? 'border-indigo-500 bg-indigo-600/20 text-indigo-200'
                        : 'border-slate-700 text-slate-300',
                    ].join(' ')}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs text-slate-400">Exclusion de estadisticas</label>
            <select
              value={excludeMode}
              onChange={(e) => setExcludeMode(e.target.value as ExcludeMode)}
              className={inputClass}
            >
              <option value="keep">No cambiar</option>
              <option value="exclude">Excluir de estadisticas</option>
              <option value="include">Incluir en estadisticas</option>
            </select>
          </div>
        </div>

        {/* Opciones */}
        <div className="flex flex-wrap gap-4 text-sm text-slate-300">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Activa
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={stopOnMatch}
              onChange={(e) => setStopOnMatch(e.target.checked)}
            />
            Detener al casar
          </label>
        </div>

        {/* Simulación */}
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={handleSimulate}
              disabled={simulating}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
            >
              {simulating ? 'Simulando...' : 'Simular'}
            </button>
            <label className="flex items-center gap-2 text-xs text-slate-400">
              <input
                type="checkbox"
                checked={simOverrideManual}
                onChange={(e) => {
                  setSimOverrideManual(e.target.checked);
                  setSimCount(null);
                }}
              />
              Incluir manuales
            </label>
          </div>
          {simCount !== null && (
            <p className="mt-2 text-sm text-slate-300">
              Afectaria a <strong className="text-indigo-300">{simCount}</strong> movimiento(s)
              existentes.
            </p>
          )}
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
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
