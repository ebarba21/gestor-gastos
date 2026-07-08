// Seccion Reglas: lista de reglas ordenadas por prioridad con CRUD, activar/desactivar,
// reordenar, simulacion (dentro del formulario), aplicacion retroactiva a los movimientos
// existentes (con simulacion y confirmacion previa) e importacion de reglas desde CSV/XLSX.
// Toda la logica vive en ruleService/ruleImportService; aqui solo orquestacion de UI.
import { useState } from 'react';
import type { Rule, RuleCondition } from '../../db/schema';
import { useRules } from '../../hooks/useRules';
import { ruleService, type SimulationResult } from '../../services/ruleService';
import { EmptyState, Modal, ConfirmDialog, type DialogButton } from '../common';
import { useToast } from '../../context/ToastContext';
import { formatCents } from '../../lib/money';
import { RuleFormModal } from './RuleFormModal';
import { RuleImportModal } from './RuleImportModal';

const LOCALE = 'es-ES';
const CURRENCY = 'EUR';

const FIELD_LABELS: Record<RuleCondition['field'], string> = {
  concept: 'concepto',
  amount: 'importe',
  date: 'fecha',
  account: 'cuenta',
  type: 'tipo',
};
const OPERATOR_LABELS: Record<RuleCondition['operator'], string> = {
  contains: 'contiene',
  notContains: 'no contiene',
  startsWith: 'empieza por',
  endsWith: 'termina en',
  equals: 'es',
  regex: 'regex',
  gt: '>',
  lt: '<',
  gte: '>=',
  lte: '<=',
  eq: '=',
  between: 'entre',
  before: 'antes de',
  after: 'despues de',
};
const TYPE_LABELS: Record<string, string> = {
  expense: 'Gasto',
  income: 'Ingreso',
  transfer: 'Transferencia',
};

interface NameMaps {
  accountNames: Map<string, string>;
  categoryNames: Map<string, string>;
  tagNames: Map<string, string>;
}

function formatConditionValue(c: RuleCondition, maps: NameMaps): string {
  if (c.field === 'amount') {
    const v = typeof c.value === 'number' ? formatCents(c.value, LOCALE, CURRENCY) : String(c.value);
    if (c.operator === 'between' && typeof c.value2 === 'number') {
      return `${v} y ${formatCents(c.value2, LOCALE, CURRENCY)}`;
    }
    return v;
  }
  if (c.field === 'account') {
    return maps.accountNames.get(String(c.value)) ?? '(cuenta)';
  }
  if (c.field === 'type') {
    return TYPE_LABELS[String(c.value)] ?? String(c.value);
  }
  if (c.field === 'date' && c.operator === 'between') {
    return `${String(c.value)} y ${String(c.value2 ?? '')}`;
  }
  return `"${String(c.value)}"`;
}

function formatCondition(c: RuleCondition, maps: NameMaps): string {
  return `${FIELD_LABELS[c.field]} ${OPERATOR_LABELS[c.operator]} ${formatConditionValue(c, maps)}`;
}

function formatAction(rule: Rule, maps: NameMaps): string {
  const parts: string[] = [];
  if (rule.action.setCategoryId) {
    const cat = maps.categoryNames.get(rule.action.setCategoryId) ?? '(categoria)';
    const sub = rule.action.setSubcategoryId
      ? ` / ${maps.categoryNames.get(rule.action.setSubcategoryId) ?? '(sub)'}`
      : '';
    parts.push(`${cat}${sub}`);
  }
  if (rule.action.addTagIds.length > 0) {
    const names = rule.action.addTagIds.map((id) => maps.tagNames.get(id) ?? '(etiqueta)');
    parts.push(`etiquetas: ${names.join(', ')}`);
  }
  if (rule.action.setExcludedFromStats === true) parts.push('excluir de estadisticas');
  if (rule.action.setExcludedFromStats === false) parts.push('incluir en estadisticas');
  return parts.length > 0 ? parts.join(' · ') : '(sin accion)';
}

export function RulesSection() {
  const {
    profileId,
    rules,
    accounts,
    categories,
    tags,
    loading,
    error,
    reload,
    accountNames,
    categoryNames,
    tagNames,
  } = useRules();
  const { showToast } = useToast();
  const maps: NameMaps = { accountNames, categoryNames, tagNames };

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Rule | null>(null);
  const [deleting, setDeleting] = useState<Rule | null>(null);
  const [importing, setImporting] = useState(false);

  // Estado del flujo de aplicacion retroactiva.
  const [applyOpen, setApplyOpen] = useState(false);
  const [applyOverrideManual, setApplyOverrideManual] = useState(false);
  const [simulation, setSimulation] = useState<SimulationResult | null>(null);
  const [applyBusy, setApplyBusy] = useState(false);

  async function toggleEnabled(rule: Rule) {
    try {
      await ruleService.setEnabled(profileId, rule.id, !rule.enabled);
      await reload();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'No se pudo cambiar la regla.', 'error');
    }
  }

  async function move(rule: Rule, direction: 'up' | 'down') {
    try {
      await ruleService.move(profileId, rule.id, direction);
      await reload();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'No se pudo reordenar.', 'error');
    }
  }

  function openApply() {
    setSimulation(null);
    setApplyOverrideManual(false);
    setApplyOpen(true);
  }

  async function runSimulation(overrideManual: boolean) {
    setApplyBusy(true);
    try {
      const result = await ruleService.simulateAll(profileId, { overrideManual });
      setSimulation(result);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'No se pudo simular.', 'error');
    } finally {
      setApplyBusy(false);
    }
  }

  async function runApply() {
    setApplyBusy(true);
    try {
      const { changed } = await ruleService.applyAllRetroactive(profileId, {
        overrideManual: applyOverrideManual,
      });
      showToast(`${changed} movimiento(s) recategorizados.`, 'success');
      setApplyOpen(false);
      await reload();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'No se pudo aplicar.', 'error');
    } finally {
      setApplyBusy(false);
    }
  }

  const deleteButtons: DialogButton[] = deleting
    ? [
        { label: 'Cancelar', variant: 'ghost' },
        {
          label: 'Eliminar',
          variant: 'danger',
          onClick: async () => {
            await ruleService.remove(profileId, deleting.id);
            showToast('Regla eliminada.', 'success');
            await reload();
          },
        },
      ]
    : [];

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold text-slate-100">Reglas</h2>
          <p className="mt-1 text-sm text-slate-400">
            Autocategoriza tus movimientos. Se evaluan por prioridad (arriba = primero).
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setImporting(true)}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm font-medium text-slate-200 hover:bg-slate-800"
          >
            Importar
          </button>
          <button
            type="button"
            onClick={openApply}
            disabled={rules.length === 0}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-40"
          >
            Aplicar a existentes
          </button>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
          >
            Nueva regla
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {loading ? (
        <p className="text-sm text-slate-500">Cargando reglas...</p>
      ) : rules.length === 0 ? (
        <EmptyState
          icon="⚙️"
          title="Sin reglas"
          description="Crea una regla para categorizar automaticamente tus movimientos, o importalas desde un fichero."
        />
      ) : (
        <div className="space-y-2">
          {rules.map((rule, index) => (
            <div
              key={rule.id}
              className={[
                'flex items-start gap-3 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2.5',
                rule.enabled ? '' : 'opacity-60',
              ].join(' ')}
            >
              {/* Reordenar */}
              <div className="flex flex-col">
                <button
                  type="button"
                  onClick={() => void move(rule, 'up')}
                  disabled={index === 0}
                  aria-label="Subir prioridad"
                  className="rounded px-1 text-slate-500 hover:text-slate-200 disabled:opacity-30"
                >
                  ▲
                </button>
                <button
                  type="button"
                  onClick={() => void move(rule, 'down')}
                  disabled={index === rules.length - 1}
                  aria-label="Bajar prioridad"
                  className="rounded px-1 text-slate-500 hover:text-slate-200 disabled:opacity-30"
                >
                  ▼
                </button>
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-slate-100">{rule.name}</span>
                  <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[11px] text-slate-400">
                    {rule.matchMode === 'all' ? 'todas' : 'alguna'}
                  </span>
                  {rule.stopOnMatch && (
                    <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[11px] text-slate-400">
                      stop
                    </span>
                  )}
                </div>
                <p className="mt-0.5 truncate text-xs text-slate-400">
                  {rule.conditions.map((c) => formatCondition(c, maps)).join(rule.matchMode === 'all' ? ' Y ' : ' O ')}
                </p>
                <p className="truncate text-xs text-indigo-300/80">→ {formatAction(rule, maps)}</p>
              </div>

              <div className="flex shrink-0 items-center gap-1 text-xs">
                <button
                  type="button"
                  onClick={() => void toggleEnabled(rule)}
                  className={[
                    'rounded px-2 py-1',
                    rule.enabled
                      ? 'text-emerald-400 hover:bg-slate-800'
                      : 'text-slate-500 hover:bg-slate-800',
                  ].join(' ')}
                >
                  {rule.enabled ? 'Activa' : 'Inactiva'}
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(rule)}
                  className="rounded px-2 py-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                >
                  Editar
                </button>
                <button
                  type="button"
                  onClick={() => setDeleting(rule)}
                  className="rounded px-2 py-1 text-red-400 hover:bg-red-950/60"
                >
                  Eliminar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modales */}
      <RuleFormModal
        open={creating}
        onClose={() => setCreating(false)}
        profileId={profileId}
        accounts={accounts}
        categories={categories}
        tags={tags}
        onSaved={reload}
      />
      <RuleFormModal
        open={editing !== null}
        onClose={() => setEditing(null)}
        profileId={profileId}
        accounts={accounts}
        categories={categories}
        tags={tags}
        onSaved={reload}
        rule={editing}
      />
      <RuleImportModal
        open={importing}
        onClose={() => setImporting(false)}
        profileId={profileId}
        context={{ categories, tags, accounts }}
        onImported={reload}
      />

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Eliminar regla"
        message={
          deleting ? (
            <span>
              Vas a eliminar la regla <strong className="text-slate-100">{deleting.name}</strong>.
              Los movimientos que categorizo conservan su categoria actual (no se recalculan).
            </span>
          ) : null
        }
        buttons={deleteButtons}
      />

      {/* Aplicacion retroactiva con simulacion previa */}
      <Modal
        open={applyOpen}
        onClose={() => !applyBusy && setApplyOpen(false)}
        title="Aplicar reglas a los movimientos existentes"
        dismissible={!applyBusy}
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-300">
            Aplica todas las reglas activas a los movimientos ya existentes. Primero simula para
            ver cuantos se veran afectados; nada se cambia hasta que confirmes.
          </p>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={applyOverrideManual}
              onChange={(e) => {
                setApplyOverrideManual(e.target.checked);
                setSimulation(null);
              }}
            />
            Recategorizar tambien los movimientos categorizados a mano
          </label>
          {!applyOverrideManual && (
            <p className="text-xs text-slate-500">
              Por defecto se respetan los movimientos categorizados manualmente.
            </p>
          )}

          {simulation && (
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-sm text-slate-300">
              <p>
                Afectaria a <strong className="text-indigo-300">{simulation.changed}</strong> de{' '}
                {simulation.eligible} movimiento(s) elegibles.
              </p>
              {simulation.skippedManual > 0 && (
                <p className="text-xs text-slate-500">
                  {simulation.skippedManual} manuales respetados.
                </p>
              )}
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setApplyOpen(false)}
              disabled={applyBusy}
              className="rounded-lg px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void runSimulation(applyOverrideManual)}
              disabled={applyBusy}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
            >
              {applyBusy && simulation === null ? 'Simulando...' : 'Simular'}
            </button>
            <button
              type="button"
              onClick={() => void runApply()}
              disabled={applyBusy || simulation === null || simulation.changed === 0}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {applyBusy && simulation !== null ? 'Aplicando...' : 'Aplicar'}
            </button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
