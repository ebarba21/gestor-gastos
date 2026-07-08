// Servicio de reglas de autocategorizacion (ver DATA_MODEL 2.7 y ARCHITECTURE 5.2).
//
// Estructura del modulo:
//  1. MOTOR PURO (sin acceso a datos ni React): evaluacion de condiciones, casacion de una
//     regla (matchMode all/any), evaluacion de un conjunto de reglas por prioridad con
//     stopOnMatch, y derivacion de la categorizacion resultante. Funciones deterministas,
//     de test obligatorio y aisladas (requisito del alcance de la fase). Una regex invalida
//     NUNCA rompe el motor: la condicion no casa y se ignora (sin errores silenciosos: la
//     validacion al guardar la regla si rechaza una regex invalida y avisa).
//  2. ORQUESTACION (async, exige profileId): CRUD de reglas, reordenar prioridad, simulacion
//     (dry-run: cuenta y describe afectados sin escribir), aplicacion retroactiva a los
//     movimientos existentes y auto-aplicacion a movimientos nuevos (alta manual e import).
//  3. IMPORTACION de reglas desde CSV/XLSX reutilizando el lexer de fichero de la fase de
//     importacion (importService.parseFile / lib/csvXlsx): mapeo de columnas y previsualizacion.
//
// Aislamiento por perfil (invariante 4 de CLAUDE.md): toda operacion async exige profileId y
// solo lee/escribe datos de ese perfil a traves de los repositorios.
import type {
  CategorizedBy,
  Rule,
  RuleAction,
  RuleCondition,
  RuleConditionField,
  RuleConditionOperator,
  RuleMatchMode,
  Transaction,
  TransactionType,
} from '../db/schema';
import { rulesRepo } from '../db/rulesRepo';
import { transactionsRepo } from '../db/transactionsRepo';
import type { NewTransaction, TransactionPatch } from '../db/transactionsRepo';
import {
  ValidationError,
  assert,
  isValidAccountingDate,
  requireId,
  requireProfileId,
} from '../lib/validation';

export const MAX_RULE_NAME_LENGTH = 60;

// Operadores validos por campo de condicion (DATA_MODEL 2.7). Fuente de verdad para la UI
// (que operadores ofrecer segun el campo) y para la validacion.
export const OPERATORS_BY_FIELD: Record<RuleConditionField, readonly RuleConditionOperator[]> = {
  concept: ['contains', 'notContains', 'startsWith', 'endsWith', 'equals', 'regex'],
  amount: ['gt', 'lt', 'gte', 'lte', 'eq', 'between'],
  date: ['before', 'after', 'between'],
  account: ['equals'],
  type: ['equals'],
};

const VALID_TX_TYPES: readonly TransactionType[] = ['expense', 'income', 'transfer'];

// ---------------------------------------------------------------------------
// 1. MOTOR PURO
// ---------------------------------------------------------------------------

// Campos de un movimiento que el motor necesita para evaluar condiciones. Se acepta esta
// forma minima para poder evaluar tanto Transaction (retroactivo) como un borrador de
// movimiento nuevo (alta manual / import) sin acoplarse a la entidad completa.
export interface EvaluableTransaction {
  concept: string;
  amountCents: number;
  date: string; // YYYY-MM-DD (ordenable lexicograficamente)
  accountId: string;
  type: TransactionType;
}

// Estado de categorizacion actual de un movimiento (lo que una regla podria cambiar).
export interface CurrentCategorization {
  categoryId: string | null;
  subcategoryId: string | null;
  tagIds: string[];
  excludedFromStats: boolean;
  categorizedBy: CategorizedBy;
  ruleId: string | null;
}

// Resultado de aplicar una categorizacion por reglas a un movimiento.
export interface Categorization {
  categoryId: string | null;
  subcategoryId: string | null;
  tagIds: string[];
  excludedFromStats: boolean;
  categorizedBy: CategorizedBy;
  ruleId: string | null;
}

// Resultado de evaluar un conjunto de reglas contra un movimiento. Acumula el efecto de las
// reglas que casan (en orden de prioridad) hasta la primera con stopOnMatch, o hasta el final.
export interface RuleEvaluation {
  matched: boolean;
  // Regla "propietaria" de la categorizacion: la PRIMERA que casa (por prioridad). Es la que
  // se registra en Transaction.ruleId (trazabilidad: "que regla categorizo el movimiento").
  ruleId: string | null;
  // Categoria/subcategoria a asignar (de la primera regla que aporta categoria). null = ninguna.
  setCategoryId: string | null;
  setSubcategoryId: string | null;
  // Etiquetas a anadir (union de todas las reglas que casan). Sin duplicados.
  addTagIds: string[];
  // Exclusion a forzar (de la primera regla que la dicta). null = no tocar la exclusion.
  setExcludedFromStats: boolean | null;
  // Todas las reglas que casaron (para depurar/mostrar). Orden de prioridad.
  matchedRuleIds: string[];
}

// Normaliza texto para comparaciones de condicion de concepto. caseSensitive=false pasa a
// minusculas (locale-aware). No se quitan acentos: la comparacion es predecible y literal.
function normalizeText(value: string, caseSensitive: boolean): string {
  return caseSensitive ? value : value.toLocaleLowerCase();
}

// Compila una regex de forma segura para el MOTOR: si el patron es invalido devuelve null
// (la condicion no casa) en lugar de lanzar. Asi una regex invalida no rompe la evaluacion.
function safeCompileRegex(pattern: string, caseSensitive: boolean): RegExp | null {
  try {
    return new RegExp(pattern, caseSensitive ? '' : 'i');
  } catch {
    return null;
  }
}

// Compila una regex para VALIDACION al guardar: lanza ValidationError si el patron es
// invalido (sin errores silenciosos; el usuario ve el motivo).
export function compileRuleRegex(pattern: string, caseSensitive: boolean): RegExp {
  try {
    return new RegExp(pattern, caseSensitive ? '' : 'i');
  } catch (e) {
    throw new ValidationError(
      `Expresion regular invalida: ${e instanceof Error ? e.message : String(e)}.`,
    );
  }
}

function toNumber(value: string | number | null): number {
  if (typeof value === 'number') return value;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function textConditionMatches(condition: RuleCondition, concept: string): boolean {
  const rawValue = String(condition.value ?? '');
  if (condition.operator === 'regex') {
    const re = safeCompileRegex(rawValue, condition.caseSensitive);
    // Regex invalida: la condicion no casa (no rompe el motor).
    if (re === null) return false;
    return re.test(concept);
  }
  const hay = normalizeText(concept, condition.caseSensitive);
  const needle = normalizeText(rawValue, condition.caseSensitive);
  switch (condition.operator) {
    case 'contains':
      return hay.includes(needle);
    case 'notContains':
      return !hay.includes(needle);
    case 'startsWith':
      return hay.startsWith(needle);
    case 'endsWith':
      return hay.endsWith(needle);
    case 'equals':
      return hay === needle;
    default:
      return false;
  }
}

// Comparaciones de importe sobre el importe CON SIGNO en centimos (gasto negativo, ingreso
// positivo), coherente con DATA_MODEL. La UI advierte de que los gastos son negativos.
function amountConditionMatches(condition: RuleCondition, amountCents: number): boolean {
  const v = toNumber(condition.value);
  if (Number.isNaN(v)) return false;
  switch (condition.operator) {
    case 'gt':
      return amountCents > v;
    case 'lt':
      return amountCents < v;
    case 'gte':
      return amountCents >= v;
    case 'lte':
      return amountCents <= v;
    case 'eq':
      return amountCents === v;
    case 'between': {
      const v2 = toNumber(condition.value2);
      if (Number.isNaN(v2)) return false;
      const lo = Math.min(v, v2);
      const hi = Math.max(v, v2);
      return amountCents >= lo && amountCents <= hi;
    }
    default:
      return false;
  }
}

// Comparaciones de fecha lexicograficas sobre YYYY-MM-DD (equivalen a comparacion temporal).
function dateConditionMatches(condition: RuleCondition, date: string): boolean {
  const v = String(condition.value ?? '');
  switch (condition.operator) {
    case 'before':
      return date < v;
    case 'after':
      return date > v;
    case 'between': {
      const v2 = String(condition.value2 ?? '');
      const lo = v <= v2 ? v : v2;
      const hi = v <= v2 ? v2 : v;
      return date >= lo && date <= hi;
    }
    default:
      return false;
  }
}

// Evalua UNA condicion contra un movimiento. Pura y sin efectos.
export function conditionMatches(condition: RuleCondition, tx: EvaluableTransaction): boolean {
  switch (condition.field) {
    case 'concept':
      return textConditionMatches(condition, tx.concept);
    case 'amount':
      return amountConditionMatches(condition, tx.amountCents);
    case 'date':
      return dateConditionMatches(condition, tx.date);
    case 'account':
      return condition.operator === 'equals' && tx.accountId === String(condition.value);
    case 'type':
      return condition.operator === 'equals' && tx.type === String(condition.value);
    default:
      return false;
  }
}

// Evalua si una regla casa con un movimiento segun su matchMode. Una regla SIN condiciones
// nunca casa (evita categorizar todo por accidente; la validacion tambien lo impide).
export function ruleMatches(rule: Rule, tx: EvaluableTransaction): boolean {
  if (rule.conditions.length === 0) return false;
  if (rule.matchMode === 'all') {
    return rule.conditions.every((c) => conditionMatches(c, tx));
  }
  return rule.conditions.some((c) => conditionMatches(c, tx));
}

// Orden de evaluacion: menor priority = mayor prioridad. Desempate estable por createdAt.
function byPriority(a: Rule, b: Rule): number {
  return a.priority - b.priority || a.createdAt - b.createdAt;
}

// Evalua un conjunto de reglas contra un movimiento. Solo considera las reglas ACTIVAS
// (enabled), en orden de prioridad. Acumula el efecto de cada regla que casa: la primera que
// aporta categoria fija la categoria/subcategoria; las etiquetas se unen; la primera que
// dicta exclusion la fija; se detiene en la primera regla con stopOnMatch. La regla
// propietaria (ruleId) es la PRIMERA que casa.
export function evaluateRules(rules: Rule[], tx: EvaluableTransaction): RuleEvaluation {
  const active = rules.filter((r) => r.enabled).sort(byPriority);
  const result: RuleEvaluation = {
    matched: false,
    ruleId: null,
    setCategoryId: null,
    setSubcategoryId: null,
    addTagIds: [],
    setExcludedFromStats: null,
    matchedRuleIds: [],
  };
  for (const rule of active) {
    if (!ruleMatches(rule, tx)) continue;
    result.matched = true;
    result.matchedRuleIds.push(rule.id);
    if (result.ruleId === null) result.ruleId = rule.id;
    const action = rule.action;
    if (action.setCategoryId !== null && result.setCategoryId === null) {
      result.setCategoryId = action.setCategoryId;
      result.setSubcategoryId = action.setSubcategoryId ?? null;
    }
    for (const tagId of action.addTagIds) {
      if (!result.addTagIds.includes(tagId)) result.addTagIds.push(tagId);
    }
    if (action.setExcludedFromStats !== null && result.setExcludedFromStats === null) {
      result.setExcludedFromStats = action.setExcludedFromStats;
    }
    if (rule.stopOnMatch) break;
  }
  return result;
}

function sameStringArray(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// Deriva la categorizacion resultante de aplicar una evaluacion sobre el estado actual de un
// movimiento. Devuelve null si no hay NINGUN cambio efectivo (idempotente: aplicar dos veces
// no genera un segundo cambio). Al aplicarse una regla, categorizedBy pasa a 'rule' y ruleId
// a la regla propietaria (DATA_MODEL 2.7). Las etiquetas se ANADEN a las existentes; la
// categoria y la exclusion solo cambian si la evaluacion las dicta.
export function categorizationFrom(
  current: CurrentCategorization,
  evaluation: RuleEvaluation,
): Categorization | null {
  if (!evaluation.matched) return null;
  const hasCategoryDirective = evaluation.setCategoryId !== null;
  const mergedTags = [...current.tagIds];
  for (const tagId of evaluation.addTagIds) {
    if (!mergedTags.includes(tagId)) mergedTags.push(tagId);
  }
  const next: Categorization = {
    categoryId: hasCategoryDirective ? evaluation.setCategoryId : current.categoryId,
    subcategoryId: hasCategoryDirective ? evaluation.setSubcategoryId : current.subcategoryId,
    tagIds: mergedTags,
    excludedFromStats:
      evaluation.setExcludedFromStats !== null
        ? evaluation.setExcludedFromStats
        : current.excludedFromStats,
    categorizedBy: 'rule',
    ruleId: evaluation.ruleId,
  };
  // No-op si el resultado coincide exactamente con el estado actual (incluida la procedencia).
  if (
    next.categoryId === current.categoryId &&
    next.subcategoryId === current.subcategoryId &&
    sameStringArray(next.tagIds, current.tagIds) &&
    next.excludedFromStats === current.excludedFromStats &&
    next.categorizedBy === current.categorizedBy &&
    next.ruleId === current.ruleId
  ) {
    return null;
  }
  return next;
}

// Movimientos elegibles para autocategorizacion por reglas. Se excluyen los movimientos
// especiales gestionados por su propio flujo, cuyos invariantes no debe tocar el motor:
//  - transferencias (ambas patas): son type='transfer' y deben permanecer excluidas de stats.
//  - padres de split: estan excluidos y las categorias reales viven en las lineas hijas.
// Las lineas hijas de split y los movimientos normales SI son elegibles.
export function isRuleEligible(tx: Transaction): boolean {
  if (tx.transferGroupId !== null) return false;
  if (tx.isSplitParent) return false;
  return true;
}

// Snapshot de los campos de categorizacion (para el "antes" de una simulacion).
function snapshotCategorization(tx: Transaction): Categorization {
  return {
    categoryId: tx.categoryId,
    subcategoryId: tx.subcategoryId,
    tagIds: [...tx.tagIds],
    excludedFromStats: tx.excludedFromStats,
    categorizedBy: tx.categorizedBy,
    ruleId: tx.ruleId,
  };
}

function toPatch(cat: Categorization): TransactionPatch {
  return {
    categoryId: cat.categoryId,
    subcategoryId: cat.subcategoryId,
    tagIds: cat.tagIds,
    excludedFromStats: cat.excludedFromStats,
    categorizedBy: cat.categorizedBy,
    ruleId: cat.ruleId,
  };
}

// --- Simulacion (dry-run) sobre un conjunto de movimientos ya cargado. Pura. ---

export interface SimulateOptions {
  // Si es true, tambien recategoriza movimientos ya categorizados manualmente (por defecto
  // NO: la categorizacion manual del usuario prevalece, DATA_MODEL 2.7 y alcance punto 6).
  overrideManual?: boolean;
}

export interface RuleChange {
  transaction: Transaction;
  before: Categorization;
  after: Categorization;
  ruleId: string; // regla propietaria del cambio
}

export interface SimulationResult {
  affected: RuleChange[];
  eligible: number; // movimientos elegibles evaluados
  changed: number; // = affected.length
  skippedManual: number; // manuales respetados (no recategorizados)
}

// Simula la aplicacion de un conjunto de reglas sobre una lista de movimientos, SIN escribir.
export function simulateOnTransactions(
  rules: Rule[],
  transactions: Transaction[],
  options: SimulateOptions = {},
): SimulationResult {
  const overrideManual = options.overrideManual ?? false;
  const affected: RuleChange[] = [];
  let eligible = 0;
  let skippedManual = 0;
  for (const tx of transactions) {
    if (!isRuleEligible(tx)) continue;
    eligible += 1;
    if (!overrideManual && tx.categorizedBy === 'manual') {
      skippedManual += 1;
      continue;
    }
    const evaluation = evaluateRules(rules, tx);
    const after = categorizationFrom(snapshotCategorization(tx), evaluation);
    if (after === null) continue;
    affected.push({
      transaction: tx,
      before: snapshotCategorization(tx),
      after,
      ruleId: evaluation.ruleId as string,
    });
  }
  return { affected, eligible, changed: affected.length, skippedManual };
}

// Aplica un conjunto de reglas sobre un BORRADOR de movimiento nuevo (alta manual o import),
// mutandolo in situ. Solo considera reglas activas. No toca movimientos ya marcados como
// manuales (categorizedBy 'manual'): respeta una categoria elegida a mano en el alta.
export function applyRulesToDraft(rules: Rule[], draft: NewTransaction): void {
  if (draft.categorizedBy === 'manual') return;
  // Defensa en profundidad: no autocategorizar movimientos especiales gestionados (patas de
  // transferencia y padres de split), cuyos invariantes no debe tocar el motor. Coherente con
  // isRuleEligible para los movimientos ya persistidos.
  if (draft.transferGroupId !== null || draft.isSplitParent) return;
  const evaluation = evaluateRules(rules, {
    concept: draft.concept,
    amountCents: draft.amountCents,
    date: draft.date,
    accountId: draft.accountId,
    type: draft.type,
  });
  const next = categorizationFrom(
    {
      categoryId: draft.categoryId,
      subcategoryId: draft.subcategoryId,
      tagIds: draft.tagIds,
      excludedFromStats: draft.excludedFromStats,
      categorizedBy: draft.categorizedBy,
      ruleId: draft.ruleId,
    },
    evaluation,
  );
  if (next === null) return;
  draft.categoryId = next.categoryId;
  draft.subcategoryId = next.subcategoryId;
  draft.tagIds = next.tagIds;
  draft.excludedFromStats = next.excludedFromStats;
  draft.categorizedBy = next.categorizedBy;
  draft.ruleId = next.ruleId;
}

// ---------------------------------------------------------------------------
// 2. VALIDACION Y CRUD
// ---------------------------------------------------------------------------

export interface RuleInput {
  name: string;
  enabled: boolean;
  matchMode: RuleMatchMode;
  conditions: RuleCondition[];
  action: RuleAction;
  stopOnMatch: boolean;
}

function normalizeRuleName(name: string): string {
  const trimmed = (name ?? '').trim().replace(/\s+/g, ' ');
  if (trimmed.length === 0) {
    throw new ValidationError('El nombre de la regla no puede estar vacio.');
  }
  if (trimmed.length > MAX_RULE_NAME_LENGTH) {
    throw new ValidationError(
      `El nombre de la regla no puede superar ${MAX_RULE_NAME_LENGTH} caracteres.`,
    );
  }
  return trimmed;
}

// Valida una condicion segun su campo y operador. Lanza ValidationError con el motivo.
export function validateCondition(condition: RuleCondition): void {
  const validOps = OPERATORS_BY_FIELD[condition.field];
  assert(validOps !== undefined, `Campo de condicion invalido: "${condition.field}".`);
  assert(
    validOps.includes(condition.operator),
    `El operador "${condition.operator}" no es valido para el campo "${condition.field}".`,
  );
  switch (condition.field) {
    case 'concept': {
      assert(
        typeof condition.value === 'string' && condition.value.length > 0,
        'La condicion de texto necesita un valor.',
      );
      if (condition.operator === 'regex') {
        // Compila para validar: una regex invalida se rechaza al guardar (no en el motor).
        compileRuleRegex(String(condition.value), condition.caseSensitive);
      }
      break;
    }
    case 'amount': {
      assert(
        typeof condition.value === 'number' && Number.isInteger(condition.value),
        'La condicion de importe necesita un valor en centimos (entero).',
      );
      if (condition.operator === 'between') {
        assert(
          typeof condition.value2 === 'number' && Number.isInteger(condition.value2),
          'El rango de importe necesita un segundo valor en centimos (entero).',
        );
      }
      break;
    }
    case 'date': {
      assert(
        isValidAccountingDate(String(condition.value)),
        'La condicion de fecha necesita una fecha YYYY-MM-DD valida.',
      );
      if (condition.operator === 'between') {
        assert(
          isValidAccountingDate(String(condition.value2 ?? '')),
          'El rango de fechas necesita una segunda fecha YYYY-MM-DD valida.',
        );
      }
      break;
    }
    case 'account': {
      assert(
        typeof condition.value === 'string' && condition.value.length > 0,
        'La condicion de cuenta necesita una cuenta.',
      );
      break;
    }
    case 'type': {
      assert(
        VALID_TX_TYPES.includes(String(condition.value) as TransactionType),
        'La condicion de tipo necesita un tipo de movimiento valido.',
      );
      break;
    }
    default:
      throw new ValidationError(`Campo de condicion invalido: "${condition.field}".`);
  }
}

// Valida una accion: al menos un efecto (categoria, etiquetas o exclusion) y coherencia
// subcategoria->categoria.
export function validateAction(action: RuleAction): void {
  const hasCategory = action.setCategoryId !== null;
  const hasTags = action.addTagIds.length > 0;
  const hasExclusion = action.setExcludedFromStats !== null;
  assert(
    hasCategory || hasTags || hasExclusion,
    'La regla debe tener al menos una accion: asignar categoria, anadir etiquetas o forzar exclusion.',
  );
  if (action.setSubcategoryId !== null) {
    assert(
      action.setCategoryId !== null,
      'Para asignar una subcategoria hay que asignar tambien su categoria raiz.',
    );
  }
}

// Valida y normaliza un RuleInput. Devuelve la entrada saneada lista para persistir.
export function validateRuleInput(input: RuleInput): RuleInput {
  const name = normalizeRuleName(input.name);
  assert(
    input.matchMode === 'all' || input.matchMode === 'any',
    'El modo de coincidencia debe ser "all" o "any".',
  );
  assert(input.conditions.length >= 1, 'La regla necesita al menos una condicion.');
  for (const condition of input.conditions) validateCondition(condition);
  validateAction(input.action);
  return {
    name,
    enabled: input.enabled,
    matchMode: input.matchMode,
    conditions: input.conditions,
    action: {
      setCategoryId: input.action.setCategoryId,
      setSubcategoryId: input.action.setCategoryId === null ? null : input.action.setSubcategoryId,
      addTagIds: [...new Set(input.action.addTagIds)],
      setExcludedFromStats: input.action.setExcludedFromStats,
    },
    stopOnMatch: input.stopOnMatch,
  };
}

// ---------------------------------------------------------------------------
// 3. ORQUESTACION (async, exige profileId)
// ---------------------------------------------------------------------------

export const ruleService = {
  // Todas las reglas del perfil ordenadas por prioridad (para la lista de la seccion).
  list(profileId: string): Promise<Rule[]> {
    requireProfileId(profileId);
    return rulesRepo.listByPriority(profileId);
  },

  getById(profileId: string, id: string): Promise<Rule | undefined> {
    requireProfileId(profileId);
    requireId(id);
    return rulesRepo.getById(profileId, id);
  },

  // Crea una regla. Se anade al final del orden de prioridad (priority = numero de reglas).
  async create(profileId: string, input: RuleInput): Promise<Rule> {
    requireProfileId(profileId);
    const clean = validateRuleInput(input);
    const priority = await rulesRepo.count(profileId);
    return rulesRepo.create(profileId, { ...clean, priority });
  },

  // Actualiza una regla conservando su prioridad (el orden se cambia con move/reorder).
  async update(profileId: string, id: string, input: RuleInput): Promise<Rule> {
    requireProfileId(profileId);
    requireId(id);
    const clean = validateRuleInput(input);
    return rulesRepo.update(profileId, id, clean);
  },

  setEnabled(profileId: string, id: string, enabled: boolean): Promise<Rule> {
    requireProfileId(profileId);
    requireId(id);
    return rulesRepo.update(profileId, id, { enabled });
  },

  remove(profileId: string, id: string): Promise<void> {
    requireProfileId(profileId);
    requireId(id);
    return rulesRepo.remove(profileId, id);
  },

  // Reasigna prioridades contiguas (0..n-1) segun el orden de ids indicado.
  async reorder(profileId: string, orderedIds: string[]): Promise<void> {
    requireProfileId(profileId);
    for (let i = 0; i < orderedIds.length; i++) {
      await rulesRepo.update(profileId, orderedIds[i], { priority: i });
    }
  },

  // Sube o baja una regla una posicion en el orden de prioridad.
  async move(profileId: string, id: string, direction: 'up' | 'down'): Promise<void> {
    requireProfileId(profileId);
    requireId(id);
    const rules = await rulesRepo.listByPriority(profileId);
    const idx = rules.findIndex((r) => r.id === id);
    if (idx < 0) return;
    const swapWith = direction === 'up' ? idx - 1 : idx + 1;
    if (swapWith < 0 || swapWith >= rules.length) return;
    const ids = rules.map((r) => r.id);
    [ids[idx], ids[swapWith]] = [ids[swapWith], ids[idx]];
    await ruleService.reorder(profileId, ids);
  },

  // --- Simulacion ---

  // Simula un conjunto de reglas (p. ej. TODAS las del perfil, o una regla candidata aun sin
  // guardar) contra los movimientos existentes del perfil, sin escribir nada. La regla
  // candidata debe venir con enabled=true para que se evalue.
  async simulate(
    profileId: string,
    rules: Rule[],
    options: SimulateOptions = {},
  ): Promise<SimulationResult> {
    requireProfileId(profileId);
    const transactions = await transactionsRepo.list(profileId);
    return simulateOnTransactions(rules, transactions, options);
  },

  // Simula todas las reglas activas del perfil.
  async simulateAll(profileId: string, options: SimulateOptions = {}): Promise<SimulationResult> {
    requireProfileId(profileId);
    const rules = await rulesRepo.listByPriority(profileId);
    return simulateOnTransactions(rules, await transactionsRepo.list(profileId), options);
  },

  // --- Aplicacion retroactiva ---

  // Aplica un conjunto de reglas a los movimientos existentes del perfil. Reutiliza la
  // simulacion para decidir a quien afecta (respetando manuales salvo overrideManual) y
  // escribe los cambios en una unica transaccion Dexie (transactionsRepo.applyToMany).
  // Devuelve cuantos movimientos se modificaron. La UI muestra la simulacion antes (confirmacion).
  async applyRetroactive(
    profileId: string,
    rules: Rule[],
    options: SimulateOptions = {},
  ): Promise<{ changed: number }> {
    requireProfileId(profileId);
    const simulation = await ruleService.simulate(profileId, rules, options);
    if (simulation.affected.length === 0) return { changed: 0 };
    const patchById = new Map<string, TransactionPatch>(
      simulation.affected.map((a) => [a.transaction.id, toPatch(a.after)]),
    );
    const changed = await transactionsRepo.applyToMany(
      profileId,
      [...patchById.keys()],
      (tx) => patchById.get(tx.id) ?? {},
    );
    return { changed };
  },

  // Aplica todas las reglas activas del perfil a los movimientos existentes.
  async applyAllRetroactive(
    profileId: string,
    options: SimulateOptions = {},
  ): Promise<{ changed: number }> {
    requireProfileId(profileId);
    const rules = await rulesRepo.listByPriority(profileId);
    return ruleService.applyRetroactive(profileId, rules, options);
  },

  // --- Auto-aplicacion a movimientos nuevos ---

  // Aplica las reglas activas a un movimiento recien creado a mano. No hace nada si el
  // movimiento no es elegible, fue categorizado manualmente o ninguna regla casa. Devuelve el
  // movimiento actualizado, o null si no hubo cambios.
  async applyToTransaction(profileId: string, txId: string): Promise<Transaction | null> {
    requireProfileId(profileId);
    requireId(txId);
    const tx = await transactionsRepo.getById(profileId, txId);
    if (!tx || !isRuleEligible(tx) || tx.categorizedBy === 'manual') return null;
    const rules = await rulesRepo.listEnabledByPriority(profileId);
    const evaluation = evaluateRules(rules, tx);
    const next = categorizationFrom(snapshotCategorization(tx), evaluation);
    if (next === null) return null;
    return transactionsRepo.update(profileId, txId, toPatch(next));
  },

  // Devuelve las reglas activas del perfil (para auto-aplicar en el commit de importacion sin
  // volver a consultar dentro del servicio de importacion).
  listEnabled(profileId: string): Promise<Rule[]> {
    requireProfileId(profileId);
    return rulesRepo.listEnabledByPriority(profileId);
  },
};
