// Logica de negocio de presupuestos y metas (ver DATA_MODEL 2.8 y PRD 5.6). Un presupuesto
// fija un limite de gasto o un objetivo de ingreso/ahorro sobre un ambito (categoria,
// subcategoria, cuenta o global) y un periodo (mensual, trimestral, anual o personalizado).
//
// El CONSUMO no se persiste: se calcula en runtime sobre los movimientos del periodo,
// reutilizando las primitivas compartidas de statsService (las mismas que usara el
// dashboard). Asi se garantiza que el consumo mostrado coincide con la suma de movimientos
// que cuentan en estadisticas (PRD 6), respetando exclusiones, transferencias, splits y
// reembolsos.
import type {
  Account,
  Budget,
  BudgetDirection,
  BudgetKind,
  BudgetPeriod,
  BudgetScope,
  Category,
  Transaction,
} from '../db/schema';
import { budgetsRepo } from '../db/budgetsRepo';
import type { CreateInput } from '../db/baseRepo';
import { categoriesRepo } from '../db/categoriesRepo';
import { accountsRepo } from '../db/accountsRepo';
import { transactionsRepo } from '../db/transactionsRepo';
import { recurringSeriesRepo } from '../db/recurringSeriesRepo';
import { recurringOccurrencesRepo } from '../db/recurringOccurrencesRepo';
import {
  aggregatePeriod,
  buildStatsContext,
  computeBudgetConsumption,
  computeConsumption,
  netExpenseContribution as netExpenseContributionForBudget,
  type Consumption,
  type StatsContext,
} from './statsService';
import { fixedTransactionIdsFrom, isFixedTransaction } from './fixedSpend';
import { planningSettingsService, DEFAULT_PLANNING_SETTINGS, type PlanningSettings } from './planningSettings';
import { balancesAtDates } from './netWorthService';
import {
  customRange,
  daysBetweenISO,
  isWithinRange,
  monthRange,
  monthsSpanned,
  payCycleRange,
  quarterRange,
  shiftDays,
  shiftMonths,
  shiftYears,
  toISO,
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
export const BUDGET_KINDS: readonly BudgetKind[] = ['limit', 'flex', 'goal', 'fund'];

export const BUDGET_KIND_LABELS: Record<BudgetKind, string> = {
  limit: 'Límite',
  flex: 'Gasto flexible',
  goal: 'Objetivo de ahorro',
  fund: 'Fondo para gasto no mensual',
};

// Maximo de periodos anteriores que acumula un presupuesto con rollover (un ano de meses).
export const MAX_ROLLOVER_PERIODS = 12;

// Tipo efectivo (filas anteriores a noviembre 2026 no lo tienen: equivale a 'limit').
export function budgetKindOf(b: Pick<Budget, 'kind'>): BudgetKind {
  return b.kind ?? 'limit';
}

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
  kind: BudgetKind;
  // Rollover: lo que sobra (o falta) de periodos anteriores. 0 sin rollover.
  carryCents: number;
  // Limite efectivo del periodo = limite + arrastre.
  effectiveLimitCents: number;
  goal?: GoalProgress;
  fund?: FundProgress;
}

export type GoalStatus = 'met' | 'onTrack' | 'behind' | 'noPace' | 'overdue';

export interface GoalProgress {
  targetCents: number;
  savedCents: number;
  remainingCents: number; // >= 0
  startDate: string;
  targetDate: string;
  monthsLeft: number; // meses naturales hasta la fecha objetivo (incluido el actual); 0 si vencido
  requiredMonthlyCents: number; // aportacion mensual necesaria para llegar a tiempo
  paceMonthlyCents: number | null; // ritmo medio de aportacion desde el inicio
  etaISO: string | null; // fecha estimada de llegada al ritmo actual
  status: GoalStatus;
  // Aportacion que falta este mes para ir al ritmo necesario (lo que el disponible aparta).
  pendingThisMonthCents: number;
}

export interface FundProgress {
  cycle: DateRange; // ciclo actual (se repite cada ano en la misma fecha)
  dueDate: string;
  monthsInCycle: number;
  monthlyProvisionCents: number;
  provisionedCents: number; // apartado virtualmente hasta hoy
  spentCents: number; // gastado en el ambito durante el ciclo
  earmarkedCents: number; // apartado y aun no gastado (lo que el disponible reserva)
}

// Datos que necesita la evaluacion, cargados una sola vez por perfil.
export interface BudgetEvalEnv {
  allTx: Transaction[];
  ctx: StatsContext;
  fixedIds: ReadonlySet<string>;
  accounts: Account[];
  planning: PlanningSettings;
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
  kind?: BudgetKind;
}

// Ritmo del periodo (noviembre 2026): que fraccion del periodo ha transcurrido a fecha `today`,
// en tanto por mil, contando el dia de hoy como transcurrido. Sirve para pintar en la barra de
// un limite de gasto la marca de "lo que llevarias gastado si fueras a ritmo constante".
// null si hoy cae fuera del periodo (periodo pasado o futuro: no hay ritmo que comparar).
export function periodElapsedPerMille(range: DateRange, today: string): number | null {
  if (today < range.from || today > range.to) return null;
  const total = daysBetweenISO(range.from, range.to) + 1;
  const elapsed = daysBetweenISO(range.from, today) + 1;
  return Math.round((elapsed * 1000) / total);
}

// Gasto que llevarias a ritmo constante: limite efectivo x fraccion transcurrida. Centimos.
export function paceTargetCents(effectiveLimitCents: number, elapsedPerMille: number): number {
  return Math.round((effectiveLimitCents * elapsedPerMille) / 1000);
}

// Presupuestos sugeridos para empezar (noviembre 2026): las categorias raiz con mas gasto neto
// variable de media en los ultimos 3 meses completos que aun no tienen limite, redondeadas hacia
// arriba a 10 EUR. Excluye gasto fijo (recurrencias confirmadas): un limite al alquiler no
// ayuda a decidir nada. Pura.
export interface BudgetSuggestion {
  categoryId: string;
  name: string;
  averageCents: number;
  limitCents: number;
}

export function suggestStarterBudgets(args: {
  transactions: Transaction[];
  categories: Category[];
  budgets: Budget[];
  fixedIds: ReadonlySet<string>;
  today: string;
  count?: number;
}): BudgetSuggestion[] {
  const count = args.count ?? 3;
  const ctx = buildStatsContext(args.categories, args.transactions);
  const thisMonth = monthRange(args.today);
  const from = shiftMonths(thisMonth.from, -3);
  const to = shiftDays(thisMonth.from, -1);
  const budgeted = new Set(
    args.budgets
      .filter((b) => b.archivedAt === null && b.direction === 'expense' && (b.scope === 'category' || b.scope === 'subcategory'))
      .map((b) => b.scopeId),
  );
  const totals = new Map<string, number>();
  const activeMonths = new Set<string>();
  for (const t of args.transactions) {
    if (t.date < from || t.date > to) continue;
    if (isFixedTransaction(t, args.fixedIds)) continue;
    const c = netExpenseContributionForBudget(t, ctx);
    if (!c) continue;
    activeMonths.add(t.date.slice(0, 7));
    if (c.rootCategoryId === null) continue;
    totals.set(c.rootCategoryId, (totals.get(c.rootCategoryId) ?? 0) + c.cents);
  }
  const months = Math.max(1, activeMonths.size);
  const names = new Map(args.categories.map((c) => [c.id, c]));
  return [...totals.entries()]
    .filter(([id, cents]) => cents > 0 && !budgeted.has(id) && names.get(id)?.archivedAt === null)
    .map(([id, cents]) => {
      const avg = Math.round(cents / months);
      return { categoryId: id, name: names.get(id)!.name, averageCents: avg, limitCents: Math.ceil(avg / 1000) * 1000 };
    })
    .sort((a, b) => b.averageCents - a.averageCents || a.name.localeCompare(b.name))
    .slice(0, count);
}

export function normalizeBudgetName(name: string): string {
  const trimmed = (name ?? '').trim().replace(/\s+/g, ' ');
  assert(trimmed.length > 0, 'El nombre del presupuesto no puede estar vacío.');
  assert(
    trimmed.length <= MAX_BUDGET_NAME_LENGTH,
    `El nombre del presupuesto no puede superar ${MAX_BUDGET_NAME_LENGTH} caracteres.`,
  );
  return trimmed;
}

// Resuelve el rango de fechas del periodo de un presupuesto para una fecha de referencia.
// mensual/trimestral/anual dependen de la referencia (por defecto hoy); personalizado usa
// sus fechas fijas guardadas.
// Con el ciclo de nomina activo (y dia de cobro indicado), los presupuestos mensuales van de
// nomina a nomina en lugar del mes natural.
export function resolveBudgetRange(
  budget: Pick<Budget, 'period' | 'customStart' | 'customEnd'>,
  referenceISO: string = todayISO(),
  planning: Pick<PlanningSettings, 'budgetCycle' | 'payDay'> = DEFAULT_PLANNING_SETTINGS,
): DateRange {
  switch (budget.period) {
    case 'monthly':
      if (planning.budgetCycle === 'payday' && planning.payDay !== null) {
        return payCycleRange(referenceISO, planning.payDay);
      }
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
function buildEvaluation(
  budget: Budget,
  range: DateRange,
  consumption: Consumption,
  carryCents = 0,
): BudgetEvaluation {
  const limit = budget.limitCents + carryCents;
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
    limitCents: budget.limitCents,
    grossCents: consumption.grossCents,
    refundCents: consumption.refundCents,
    consumedCents: consumed,
    remainingCents: remaining,
    percent,
    status,
    kind: budgetKindOf(budget),
    carryCents,
    effectiveLimitCents: limit,
  };
}

// Valida la coherencia de la entrada y que las referencias existan en el perfil. Sin
// errores silenciosos: cualquier incoherencia lanza ValidationError.
async function validateInput(profileId: string, input: BudgetInput): Promise<void> {
  assertCents(input.limitCents);
  assert(input.limitCents > 0, 'El importe del presupuesto debe ser mayor que cero.');
  assert(BUDGET_SCOPES.includes(input.scope), 'Ámbito de presupuesto no válido.');
  assert(BUDGET_PERIODS.includes(input.period), 'Periodo de presupuesto no válido.');
  assert(BUDGET_DIRECTIONS.includes(input.direction), 'Dirección de presupuesto no válida.');
  const kind = input.kind ?? 'limit';
  assert(BUDGET_KINDS.includes(kind), 'Tipo de presupuesto no válido.');
  if (kind === 'flex') {
    assert(input.scope === 'overall', 'El presupuesto flexible abarca todo tu gasto variable (ámbito global).');
    assert(input.direction === 'expense', 'El presupuesto flexible es un límite de gasto.');
    assert(input.period !== 'custom', 'El presupuesto flexible es mensual, trimestral o anual.');
  } else if (kind === 'goal') {
    assert(input.period === 'custom', 'Un objetivo necesita fecha de inicio y fecha objetivo.');
    assert(input.direction === 'income', 'Un objetivo de ahorro se registra como objetivo, no como límite de gasto.');
  } else if (kind === 'fund') {
    assert(input.period === 'custom', 'Un fondo necesita fecha de inicio y fecha de vencimiento.');
    assert(input.direction === 'expense', 'Un fondo reserva dinero para un gasto.');
    assert(
      input.scope === 'category' || input.scope === 'subcategory',
      'Un fondo se vincula a la categoría o subcategoría donde se registrará el gasto.',
    );
  }
  if (input.rollover) {
    assert(kind === 'limit' || kind === 'flex', 'Solo los límites de gasto acumulan lo que sobra.');
    assert(input.direction === 'expense', 'Solo los límites de gasto acumulan lo que sobra.');
    assert(input.period !== 'custom', 'Un periodo personalizado no se repite: no puede acumular lo que sobra.');
  }

  // Coherencia ambito <-> scopeId y existencia de la entidad referenciada en el perfil.
  if (input.scope === 'overall') {
    assert(input.scopeId === null, 'Un presupuesto global no lleva ámbito concreto (scopeId).');
  } else {
    assert(
      typeof input.scopeId === 'string' && input.scopeId.length > 0,
      'Este ámbito de presupuesto requiere seleccionar la categoría, subcategoría o cuenta.',
    );
    if (input.scope === 'account') {
      const acc = await accountsRepo.getById(profileId, input.scopeId);
      assert(acc !== undefined, 'La cuenta del presupuesto no existe en el perfil.');
    } else {
      const cat = await categoriesRepo.getById(profileId, input.scopeId);
      assert(cat !== undefined, 'La categoría del presupuesto no existe en el perfil.');
      if (input.scope === 'subcategory') {
        assert(cat!.parentId !== null, 'El ámbito de subcategoría requiere una subcategoría (no una categoría raíz).');
      } else {
        assert(cat!.parentId === null, 'El ámbito de categoría requiere una categoría raíz (para una subcategoría usa el ámbito subcategoría).');
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
    kind: input.kind ?? 'limit',
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

  // Calcula los presupuestos sugeridos del perfil (ver suggestStarterBudgets).
  async suggestStarters(profileId: string, today: string = todayISO()): Promise<BudgetSuggestion[]> {
    requireProfileId(profileId);
    const [transactions, categories, budgets, series, matched] = await Promise.all([
      transactionsRepo.list(profileId),
      categoriesRepo.list(profileId),
      budgetsRepo.list(profileId),
      recurringSeriesRepo.list(profileId),
      recurringOccurrencesRepo.listByStatus(profileId, 'matched'),
    ]);
    return suggestStarterBudgets({
      transactions,
      categories,
      budgets,
      fixedIds: fixedTransactionIdsFrom(series, matched),
      today,
    });
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

  // Evalua un unico presupuesto para una fecha de referencia. Para evaluar muchos, usar
  // evaluateActive (una sola carga de datos).
  async evaluateOne(
    profileId: string,
    budget: Budget,
    referenceISO: string = todayISO(),
  ): Promise<BudgetEvaluation> {
    requireProfileId(profileId);
    const env = await loadBudgetEnv(profileId);
    return evaluateBudget(budget, env, referenceISO);
  },

  // Evalua todos los presupuestos activos del perfil para una fecha de referencia, con una
  // unica carga de categorias, movimientos, cuentas, recurrencias y configuracion.
  async evaluateActive(
    profileId: string,
    referenceISO: string = todayISO(),
  ): Promise<BudgetEvaluation[]> {
    requireProfileId(profileId);
    const [budgets, env] = await Promise.all([budgetService.list(profileId), loadBudgetEnv(profileId)]);
    return budgets.map((b) => evaluateBudget(b, env, referenceISO));
  },
};

// Carga, aislada por perfil, de todo lo que necesita la evaluacion.
export async function loadBudgetEnv(profileId: string): Promise<BudgetEvalEnv> {
  requireProfileId(profileId);
  const [categories, allTx, accounts, series, matched, planning] = await Promise.all([
    categoriesRepo.list(profileId),
    transactionsRepo.list(profileId),
    accountsRepo.list(profileId),
    recurringSeriesRepo.list(profileId),
    recurringOccurrencesRepo.listByStatus(profileId, 'matched'),
    planningSettingsService.get(profileId),
  ]);
  return {
    allTx,
    ctx: buildStatsContext(categories, allTx),
    fixedIds: fixedTransactionIdsFrom(series, matched),
    accounts,
    planning,
  };
}

// Fecha contable (local) de un timestamp.
function isoOfMs(ms: number): string {
  const d = new Date(ms);
  return toISO(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

function inRange(txs: Transaction[], range: DateRange): Transaction[] {
  return txs.filter((t) => isWithinRange(t.date, range));
}

// Consumo de un limite (o del flexible, que excluye los recibos fijos) en un rango.
function limitConsumption(budget: Budget, env: BudgetEvalEnv, range: DateRange): Consumption {
  let txs = inRange(env.allTx, range);
  if (budgetKindOf(budget) === 'flex') txs = txs.filter((t) => !isFixedTransaction(t, env.fixedIds));
  return computeBudgetConsumption(budget, txs, env.ctx);
}

// Arrastre de periodos anteriores (rollover): suma de (limite - consumo) de cada periodo previo
// desde el periodo en que se creo el presupuesto, como maximo MAX_ROLLOVER_PERIODS. Un periodo
// con exceso arrastra negativo (lo gastado de mas se descuenta del siguiente).
export function computeCarry(budget: Budget, env: BudgetEvalEnv, current: DateRange): number {
  if (!budget.rollover || budget.direction !== 'expense' || budget.period === 'custom') return 0;
  const kind = budgetKindOf(budget);
  if (kind !== 'limit' && kind !== 'flex') return 0;
  const createdISO = isoOfMs(budget.createdAt);
  let carry = 0;
  let range = current;
  for (let i = 0; i < MAX_ROLLOVER_PERIODS; i++) {
    const prev = resolveBudgetRange(budget, shiftDays(range.from, -1), env.planning);
    if (prev.to < createdISO) break;
    carry += budget.limitCents - limitConsumption(budget, env, prev).consumedCents;
    range = prev;
  }
  return carry;
}

// Progreso de un objetivo de ahorro.
export function computeGoalProgress(budget: Budget, env: BudgetEvalEnv, referenceISO: string): GoalProgress {
  const startDate = budget.customStart!;
  const targetDate = budget.customEnd!;
  const until = referenceISO < startDate ? startDate : referenceISO;
  let saved = 0;
  let savedAtStart = 0;
  if (budget.scope === 'account') {
    const account = env.accounts.filter((a) => a.id === budget.scopeId);
    const points = balancesAtDates(account, env.allTx, [shiftDays(startDate, -1), until]);
    savedAtStart = points[0]!.totalCents;
    saved = points[1]!.totalCents;
  } else if (budget.scope === 'overall') {
    const txs = inRange(env.allTx, { from: startDate, to: until });
    saved = aggregatePeriod(txs, env.ctx).summary.netSavingsCents;
  } else {
    // Categoria/subcategoria (normalmente de ahorro o inversion): aportaciones netas.
    const txs = inRange(env.allTx, { from: startDate, to: until });
    saved = computeConsumption(txs, budget.scope, budget.scopeId, 'expense', env.ctx).consumedCents;
  }
  const target = budget.limitCents;
  const remaining = Math.max(0, target - saved);
  const overdue = referenceISO > targetDate;
  const monthsLeft = overdue ? 0 : monthsSpanned(referenceISO < startDate ? startDate : referenceISO, targetDate);
  const requiredMonthly = remaining === 0 ? 0 : Math.ceil(remaining / Math.max(1, monthsLeft));
  const elapsedMonths = referenceISO < startDate ? 0 : monthsSpanned(startDate, referenceISO);
  const progressSinceStart = saved - savedAtStart;
  const pace = elapsedMonths > 0 && progressSinceStart > 0 ? Math.round(progressSinceStart / elapsedMonths) : null;
  let eta: string | null = null;
  if (remaining === 0) eta = referenceISO;
  else if (pace !== null) eta = shiftMonths(referenceISO, Math.ceil(remaining / pace));
  let status: GoalStatus;
  if (remaining === 0) status = 'met';
  else if (overdue) status = 'overdue';
  else if (pace === null) status = 'noPace';
  else status = eta !== null && eta <= targetDate ? 'onTrack' : 'behind';

  // Lo que falta aportar este mes para ir al ritmo necesario (solo objetivos por categoria o
  // global, cuya aportacion sale de tus cuentas; en uno por cuenta el dinero ya esta apartado).
  let pendingThisMonth = 0;
  if (remaining > 0 && !overdue && budget.scope !== 'account' && referenceISO >= startDate) {
    const month = monthRange(referenceISO);
    const from = month.from < startDate ? startDate : month.from;
    const txs = inRange(env.allTx, { from, to: referenceISO });
    const thisMonth =
      budget.scope === 'overall'
        ? 0
        : computeConsumption(txs, budget.scope, budget.scopeId, 'expense', env.ctx).consumedCents;
    if (budget.scope !== 'overall') pendingThisMonth = Math.max(0, Math.min(remaining, requiredMonthly - thisMonth));
  }
  return {
    targetCents: target,
    savedCents: saved,
    remainingCents: remaining,
    startDate,
    targetDate,
    monthsLeft,
    requiredMonthlyCents: requiredMonthly,
    paceMonthlyCents: pace,
    etaISO: eta,
    status,
    pendingThisMonthCents: pendingThisMonth,
  };
}

// Ciclo actual de un fondo: el primero va de customStart a customEnd; despues se repite cada
// ano en la misma fecha de vencimiento.
export function fundCycle(customStart: string, customEnd: string, referenceISO: string): DateRange {
  let start = customStart;
  let end = customEnd;
  let guard = 0;
  while (end < referenceISO && guard < 200) {
    start = shiftDays(end, 1);
    end = shiftYears(end, 1);
    guard++;
  }
  return { from: start, to: end };
}

// Progreso de un fondo para gasto no mensual: se aparta (virtualmente) una cuota cada mes del
// ciclo y se descuenta lo gastado en su ambito.
export function computeFundProgress(budget: Budget, env: BudgetEvalEnv, referenceISO: string): FundProgress {
  const cycle = fundCycle(budget.customStart!, budget.customEnd!, referenceISO);
  const monthsInCycle = monthsSpanned(cycle.from, cycle.to);
  const monthlyProvision = Math.ceil(budget.limitCents / monthsInCycle);
  const elapsed = referenceISO < cycle.from ? 0 : Math.min(monthsInCycle, monthsSpanned(cycle.from, referenceISO));
  const provisioned = Math.min(budget.limitCents, monthlyProvision * elapsed);
  const spentRange: DateRange = { from: cycle.from, to: referenceISO < cycle.to ? referenceISO : cycle.to };
  const spent =
    referenceISO < cycle.from
      ? 0
      : Math.max(0, computeConsumption(inRange(env.allTx, spentRange), budget.scope, budget.scopeId, 'expense', env.ctx).consumedCents);
  return {
    cycle,
    dueDate: cycle.to,
    monthsInCycle,
    monthlyProvisionCents: monthlyProvision,
    provisionedCents: provisioned,
    spentCents: spent,
    earmarkedCents: Math.max(0, provisioned - spent),
  };
}

// Evaluacion pura de un presupuesto de cualquier tipo.
export function evaluateBudget(budget: Budget, env: BudgetEvalEnv, referenceISO: string): BudgetEvaluation {
  const kind = budgetKindOf(budget);
  if (kind === 'goal') {
    const goal = computeGoalProgress(budget, env, referenceISO);
    const range = customRange(budget.customStart!, budget.customEnd!);
    const ev = buildEvaluation(budget, range, {
      grossCents: goal.savedCents,
      refundCents: 0,
      consumedCents: goal.savedCents,
    });
    return { ...ev, goal };
  }
  if (kind === 'fund') {
    const fund = computeFundProgress(budget, env, referenceISO);
    const ev = buildEvaluation(budget, fund.cycle, {
      grossCents: fund.spentCents,
      refundCents: 0,
      consumedCents: fund.spentCents,
    });
    return { ...ev, fund };
  }
  const range = resolveBudgetRange(budget, referenceISO, env.planning);
  const consumption = limitConsumption(budget, env, range);
  const carry = computeCarry(budget, env, range);
  return buildEvaluation(budget, range, consumption, carry);
}
