// Logica de negocio de presupuestos y metas (ver DATA_MODEL 2.8 y PRD 5.6). Un presupuesto
// fija un limite de gasto o un objetivo de ingreso/ahorro sobre un ambito (categoria,
// subcategoria, cuenta o global) y un periodo (mensual, trimestral, anual o personalizado).
//
// El CONSUMO no se persiste: se calcula en runtime sobre los movimientos del periodo,
// reutilizando las primitivas compartidas de statsService (las mismas que usara el
// dashboard). Asi se garantiza que el consumo mostrado coincide con la suma de movimientos
// que cuentan en estadísticas (PRD 6), respetando exclusiones, transferencias, splits y
// reembolsos.
import type { Budget, BudgetDirection, BudgetPeriod, BudgetScope, Transaction } from '../db/schema';
import { budgetsRepo } from '../db/budgetsRepo';
import type { CreateInput } from '../db/baseRepo';
import { categoriesRepo } from '../db/categoriesRepo';
import { accountsRepo } from '../db/accountsRepo';
import { transactionsRepo } from '../db/transactionsRepo';
import {
  buildStatsContext,
  computeBudgetConsumption,
  type Consumption,
  type StatsContext,
} from './statsService';
import {
  customRange,
  isWithinRange,
  monthRange,
  quarterRange,
  todayISO,
  yearRange,
  type DateRange,
} from '../lib/dates';
import { assert, requireProfileId, requireId } from '../lib/validation';
import { assertCents } from '../lib/money';

export const MAX_BUDGET_NAME_LENGTH = 60;

// Umbral (fraccion del limite) a partir del cual un presupuesto de gasto se marca "en
// aviso" (cerca del limite) aunque aun no lo haya superado. Solo presentacion de estado.
export const BUDGET_WARNING_RATIO = 0.8;

export const BUDGET_SCOPES: readonly BudgetScope[] = ['overall', 'category', 'subcategory', 'account'];
export const BUDGET_PERIODS: readonly BudgetPeriod[] = ['monthly', 'quarterly', 'yearly', 'custom'];
export const BUDGET_DIRECTIONS: readonly BudgetDirection[] = ['expense', 'income'];

export const BUDGET_SCOPE_LABELS: Record<BudgetScope, string> = {
  overall: 'Global',
  category: 'Categoría',
  subcategory: 'Subcategoría',
  account: 'Cuenta',
};

export const BUDGET_PERIOD_LABELS: Record<BudgetPeriod, string> = {
  monthly: 'Mensual',
  quarterly: 'Trimestral',
  yearly: 'Anual',
  custom: 'Personalizado',
};

export const BUDGET_DIRECTION_LABELS: Record<BudgetDirection, string> = {
  expense: 'Límite de gasto',
  income: 'Objetivo de ingreso/ahorro',
};

// Estado de un presupuesto evaluado:
//  - gasto: 'ok' (holgado), 'warning' (cerca del limite), 'exceeded' (superado).
//  - ingreso/objetivo: 'ok' (en progreso), 'met' (objetivo alcanzado o superado).
export type BudgetStatus = 'ok' | 'warning' | 'exceeded' | 'met';

export interface BudgetEvaluation {
  budget: Budget;
  range: DateRange; // periodo evaluado
  limitCents: number;
  grossCents: number; // gasto o ingreso bruto del ambito en el periodo
  refundCents: number; // reembolsos atribuidos (solo gasto)
  consumedCents: number; // consumo neto
  remainingCents: number; // limite - consumo (negativo = superado / objetivo rebasado)
  // Porcentaje consumido respecto al limite (entero redondeado). Puede superar 100.
  // Puede ser negativo si los reembolsos superan el gasto del periodo.
  percent: number;
  status: BudgetStatus;
}

export interface BudgetInput {
  name: string;
  scope: BudgetScope;
  scopeId: string | null;
  direction: BudgetDirection;
  limitCents: number; // entero positivo en centimos
  period: BudgetPeriod;
  customStart?: string | null;
  customEnd?: string | null;
  rollover?: boolean;
}

export function normalizeBudgetName(name: string): string {
  const trimmed = (name ?? '').trim().replace(/\s+/g, ' ');
  assert(trimmed.length > 0, 'El nombre del presupuesto no puede estar vacio.');
  assert(
    trimmed.length <= MAX_BUDGET_NAME_LENGTH,
    `El nombre del presupuesto no puede superar ${MAX_BUDGET_NAME_LENGTH} caracteres.`,
  );
  return trimmed;
}

// Resuelve el rango de fechas del periodo de un presupuesto para una fecha de referencia.
// mensual/trimestral/anual dependen de la referencia (por defecto hoy); personalizado usa
// sus fechas fijas guardadas.
export function resolveBudgetRange(budget: Budget, referenceISO: string = todayISO()): DateRange {
  switch (budget.period) {
    case 'monthly':
      return monthRange(referenceISO);
    case 'quarterly':
      return quarterRange(referenceISO);
    case 'yearly':
      return yearRange(referenceISO);
    case 'custom':
      assert(
        budget.customStart !== null && budget.customEnd !== null,
        'Un presupuesto personalizado necesita fecha inicial y final.',
      );
      return customRange(budget.customStart, budget.customEnd);
    default:
      throw new Error(`Periodo de presupuesto no soportado: ${String(budget.period)}`);
  }
}

// Deriva el estado y las metricas de un presupuesto a partir de su consumo.
function buildEvaluation(budget: Budget, range: DateRange, consumption: Consumption): BudgetEvaluation {
  const limit = budget.limitCents;
  const consumed = consumption.consumedCents;
  const remaining = limit - consumed;
  const percent = limit > 0 ? Math.round((consumed / limit) * 100) : 0;

  let status: BudgetStatus;
  if (budget.direction === 'expense') {
    if (consumed > limit) status = 'exceeded';
    // Aviso al alcanzar el umbral (comparacion en enteros para no depender de floats).
    else if (consumed * 100 >= limit * Math.round(BUDGET_WARNING_RATIO * 100)) status = 'warning';
    else status = 'ok';
  } else {
    status = consumed >= limit ? 'met' : 'ok';
  }

  return {
    budget,
    range,
    limitCents: limit,
    grossCents: consumption.grossCents,
    refundCents: consumption.refundCents,
    consumedCents: consumed,
    remainingCents: remaining,
    percent,
    status,
  };
}

// Valida la coherencia de la entrada y que las referencias existan en el perfil. Sin
// errores silenciosos: cualquier incoherencia lanza ValidationError.
async function validateInput(profileId: string, input: BudgetInput): Promise<void> {
  assertCents(input.limitCents);
  assert(input.limitCents > 0, 'El importe del presupuesto debe ser mayor que cero.');
  assert(BUDGET_SCOPES.includes(input.scope), 'Ambito de presupuesto no valido.');
  assert(BUDGET_PERIODS.includes(input.period), 'Periodo de presupuesto no válido.');
  assert(BUDGET_DIRECTIONS.includes(input.direction), 'Dirección de presupuesto no válida.');

  // Coherencia ambito <-> scopeId y existencia de la entidad referenciada en el perfil.
  if (input.scope === 'overall') {
    assert(input.scopeId === null, 'Un presupuesto global no lleva ambito concreto (scopeId).');
  } else {
    assert(
      typeof input.scopeId === 'string' && input.scopeId.length > 0,
      'Este ambito de presupuesto requiere seleccionar la categoria, subcategoria o cuenta.',
    );
    if (input.scope === 'account') {
      const acc = await accountsRepo.getById(profileId, input.scopeId);
      assert(acc !== undefined, 'La cuenta del presupuesto no existe en el perfil.');
    } else {
      const cat = await categoriesRepo.getById(profileId, input.scopeId);
      assert(cat !== undefined, 'La categoria del presupuesto no existe en el perfil.');
      if (input.scope === 'subcategory') {
        assert(cat!.parentId !== null, 'El ambito de subcategoria requiere una subcategoria (no una categoria raiz).');
      } else {
        assert(cat!.parentId === null, 'El ambito de categoria requiere una categoria raiz (para una subcategoria usa el ambito subcategoria).');
      }
    }
  }

  // Coherencia del periodo personalizado.
  if (input.period === 'custom') {
    assert(
      typeof input.customStart === 'string' && typeof input.customEnd === 'string',
      'Un presupuesto personalizado necesita fecha inicial y final.',
    );
    // customRange valida formato y orden (from <= to).
    customRange(input.customStart!, input.customEnd!);
  } else {
    assert(
      (input.customStart ?? null) === null && (input.customEnd ?? null) === null,
      'Solo los presupuestos personalizados llevan fechas inicial y final.',
    );
  }
}

// Normaliza los campos derivados de la entrada a la forma persistida.
function toPersisted(input: BudgetInput): CreateInput<Budget> {
  return {
    name: normalizeBudgetName(input.name),
    scope: input.scope,
    scopeId: input.scope === 'overall' ? null : input.scopeId,
    direction: input.direction,
    limitCents: input.limitCents,
    period: input.period,
    customStart: input.period === 'custom' ? input.customStart ?? null : null,
    customEnd: input.period === 'custom' ? input.customEnd ?? null : null,
    rollover: input.rollover ?? false,
    archivedAt: null,
  };
}

export const budgetService = {
  // Presupuestos activos del perfil, ordenados por nombre (para la vista de gestion).
  async list(profileId: string): Promise<Budget[]> {
    const all = await budgetsRepo.listActive(profileId);
    return all.sort((a, b) => a.name.localeCompare(b.name));
  },

  // Incluye archivados, ordenados: activos primero y alfabetico.
  async listAll(profileId: string): Promise<Budget[]> {
    const all = await budgetsRepo.list(profileId);
    return all.sort((a, b) => {
      const archA = a.archivedAt === null ? 0 : 1;
      const archB = b.archivedAt === null ? 0 : 1;
      return archA - archB || a.name.localeCompare(b.name);
    });
  },

  getById(profileId: string, id: string): Promise<Budget | undefined> {
    return budgetsRepo.getById(profileId, id);
  },

  async create(profileId: string, input: BudgetInput): Promise<Budget> {
    requireProfileId(profileId);
    await validateInput(profileId, input);
    return budgetsRepo.create(profileId, toPersisted(input));
  },

  async update(profileId: string, id: string, input: BudgetInput): Promise<Budget> {
    requireProfileId(profileId);
    requireId(id);
    await validateInput(profileId, input);
    const patch = toPersisted(input);
    // No se toca archivedAt en la edicion normal: se conserva el estado actual.
    const { archivedAt: _ignored, ...rest } = patch;
    void _ignored;
    return budgetsRepo.update(profileId, id, rest);
  },

  archive(profileId: string, id: string): Promise<Budget> {
    return budgetsRepo.update(profileId, id, { archivedAt: Date.now() });
  },

  unarchive(profileId: string, id: string): Promise<Budget> {
    return budgetsRepo.update(profileId, id, { archivedAt: null });
  },

  // Un presupuesto no tiene entidades dependientes: se puede borrar directamente.
  remove(profileId: string, id: string): Promise<void> {
    return budgetsRepo.remove(profileId, id);
  },

  // Evalua un unico presupuesto para una fecha de referencia. Carga las categorias y los
  // movimientos del perfil (estos ultimos completos, para atribuir reembolsos cuyo gasto
  // original caiga fuera del periodo). Para evaluar muchos, usar evaluateActive (una carga).
  async evaluateOne(
    profileId: string,
    budget: Budget,
    referenceISO: string = todayISO(),
  ): Promise<BudgetEvaluation> {
    requireProfileId(profileId);
    const [categories, allTx] = await Promise.all([
      categoriesRepo.list(profileId),
      transactionsRepo.list(profileId),
    ]);
    const ctx = buildStatsContext(categories, allTx);
    return evaluateWithContext(budget, allTx, ctx, referenceISO);
  },

  // Evalua todos los presupuestos activos del perfil para una fecha de referencia, con una
  // unica carga de categorias y movimientos (eficiente para la pagina de presupuestos).
  async evaluateActive(
    profileId: string,
    referenceISO: string = todayISO(),
  ): Promise<BudgetEvaluation[]> {
    requireProfileId(profileId);
    const [budgets, categories, allTx] = await Promise.all([
      budgetService.list(profileId),
      categoriesRepo.list(profileId),
      transactionsRepo.list(profileId),
    ]);
    const ctx = buildStatsContext(categories, allTx);
    return budgets.map((b) => evaluateWithContext(b, allTx, ctx, referenceISO));
  },
};

// Evaluacion pura: acota los movimientos al periodo del presupuesto y calcula su consumo.
// Aislada para poder testearla y compartir la carga entre varios presupuestos.
function evaluateWithContext(
  budget: Budget,
  allTx: Transaction[],
  ctx: StatsContext,
  referenceISO: string,
): BudgetEvaluation {
  const range = resolveBudgetRange(budget, referenceISO);
  const inPeriod = allTx.filter((t) => isWithinRange(t.date, range));
  const consumption = computeBudgetConsumption(budget, inPeriod, ctx);
  return buildEvaluation(budget, range, consumption);
}
