// Primitivas de calculo financiero compartidas. Fuente unica de la semantica de que
// cuenta y como en estadisticas: las usan tanto los presupuestos (fase actual) como el
// dashboard (fase posterior). Mantener aqui la logica garantiza que "el consumo de un
// presupuesto coincide con la suma de movimientos que cuentan en estadisticas" (PRD 6).
//
// Reglas de negocio (DATA_MODEL seccion 6), aplicadas de forma centralizada:
//  - Exclusiones: solo cuentan los movimientos con excludedFromStats === false. Esto ya
//    deja fuera, por diseno del modelo, las dos patas de una transferencia interna y el
//    padre de un split (ambos se marcan excluidos al crearse).
//  - Splits: cuentan las lineas hijas (llevan la categoria real); el padre no (excluido).
//  - Reembolsos: un reembolso (movimiento con refundOfId != null) NO se cuenta como
//    ingreso; reduce el gasto NETO de la categoria del gasto original al que reembolsa.
//    Ver detalle en attributeRefundRefs.
//
// Todos los importes se manejan en centimos enteros (nunca floats). Las magnitudes de
// gasto se devuelven como enteros positivos.
import type { Budget, BudgetDirection, BudgetScope, Category, Transaction } from '../db/schema';
import {
  daysInMonth,
  isWithinRange,
  parseISO,
  shiftMonths,
  todayISO,
  toISO,
  type DateRange,
} from '../lib/dates';
import { normalizeConcept } from '../lib/dedupe';
import { categoriesRepo } from '../db/categoriesRepo';
import { transactionsRepo } from '../db/transactionsRepo';
import { requireProfileId } from '../lib/validation';

// --- Contexto de calculo ---
// Estructuras derivadas una sola vez y reutilizadas en la agregacion. txById permite
// resolver el gasto original de un reembolso aunque este en otro periodo; parentOf permite
// que un presupuesto de categoria raiz agregue tambien sus subcategorias.
export interface StatsContext {
  parentOf: Map<string, string | null>; // categoryId -> parentId (null para raices)
  txById: Map<string, Transaction>; // indice completo del perfil por id de movimiento
  // Ids de categoria (raiz y sus subcategorias) consideradas de "ahorro": los gastos
  // atribuidos a ellas NO se cuentan como gasto, sino como aportacion a ahorro. Ver
  // savingsCategoryIds / isSavingsMovement.
  savingsCategoryIds: Set<string>;
  // Ids de categoria consideradas de "inversion". La inversion es un concepto DISTINTO del
  // ahorro (se contabiliza y se muestra por separado, con enfasis propio), pero comparte una
  // propiedad clave: un gasto a inversion NO es consumo (el dinero sigue siendo tuyo, solo
  // cambia de forma), asi que tampoco infla el gasto ni reduce el ahorro neto. Ver
  // investmentCategoryIds / isInvestmentMovement.
  investmentCategoryIds: Set<string>;
}

// Nombres de categoria (ya normalizados: minusculas, sin acentos) que marcan una categoria
// como de "ahorro". Un gasto en una de estas categorias es en realidad dinero apartado, no
// consumo: debe tratarse como ahorro y no inflar el gasto ni reducir el ahorro neto.
const SAVINGS_CATEGORY_NAMES = new Set(['ahorro', 'ahorros']);

// Nombres de categoria que marcan una categoria como de "inversion" (analogo a ahorro pero
// concepto separado). Un gasto a inversion es dinero que sigue siendo tuyo (cambia de forma),
// no consumo: no infla el gasto y se contabiliza aparte, en su propia metrica.
const INVESTMENT_CATEGORY_NAMES = new Set(['inversion', 'inversiones']);

// Conjunto de ids cuyo nombre (normalizado, sin distinguir mayusculas ni acentos) esta en
// `names`, mas TODAS sus subcategorias (un nivel en el MVP). Base comun de las categorias de
// ahorro y de inversion: asi una subcategoria dentro de "Ahorros" (p. ej. "Fondo de
// emergencia") o de "Inversiones" (p. ej. "Fondos indexados") hereda el tratamiento del padre
// aunque su nombre no lo diga.
function categoryIdsMatchingNames(categories: Category[], names: Set<string>): Set<string> {
  const roots = new Set<string>();
  for (const c of categories) {
    if (names.has(normalizeConcept(c.name))) roots.add(c.id);
  }
  const all = new Set<string>(roots);
  for (const c of categories) {
    if (c.parentId !== null && roots.has(c.parentId)) all.add(c.id);
  }
  return all;
}

// Categorias de ahorro (raiz + subcategorias). Ver categoryIdsMatchingNames.
export function computeSavingsCategoryIds(categories: Category[]): Set<string> {
  return categoryIdsMatchingNames(categories, SAVINGS_CATEGORY_NAMES);
}

// Categorias de inversion (raiz + subcategorias). Analogo a computeSavingsCategoryIds.
export function computeInvestmentCategoryIds(categories: Category[]): Set<string> {
  return categoryIdsMatchingNames(categories, INVESTMENT_CATEGORY_NAMES);
}

// Construye el contexto a partir de las categorias y de TODOS los movimientos del perfil.
// El indice completo de movimientos es necesario para atribuir reembolsos cuyo gasto
// original cae fuera del periodo evaluado.
export function buildStatsContext(
  categories: Category[],
  allTransactions: Transaction[],
): StatsContext {
  const parentOf = new Map<string, string | null>();
  for (const c of categories) parentOf.set(c.id, c.parentId);
  const txById = new Map<string, Transaction>();
  for (const t of allTransactions) txById.set(t.id, t);
  return {
    parentOf,
    txById,
    savingsCategoryIds: computeSavingsCategoryIds(categories),
    investmentCategoryIds: computeInvestmentCategoryIds(categories),
  };
}

// --- Predicados base ---

// Un movimiento cuenta en estadisticas si no esta excluido. Espejo de statsFlag === 0.
export function countsInStats(t: Transaction): boolean {
  return !t.excludedFromStats;
}

// Un movimiento es un reembolso si enlaza con un gasto original (refundOfId != null) y no
// es en si mismo un gasto (un gasto se computa como gasto, no como reduccion). En el modelo
// un reembolso es de tipo income; esta guarda evita dobles interpretaciones.
export function isRefund(t: Transaction): boolean {
  return t.refundOfId !== null && t.type !== 'expense';
}

// Magnitud de gasto (entero positivo) de un movimiento de gasto; 0 si no es gasto.
export function expenseMagnitude(t: Transaction): number {
  return t.type === 'expense' ? Math.abs(t.amountCents) : 0;
}

// True si un par de referencias de categoria apunta a una categoria de ahorro.
function refsAreSavings(
  categoryId: string | null,
  subcategoryId: string | null,
  ctx: StatsContext,
): boolean {
  return (
    (categoryId !== null && ctx.savingsCategoryIds.has(categoryId)) ||
    (subcategoryId !== null && ctx.savingsCategoryIds.has(subcategoryId))
  );
}

// Un movimiento es una "aportacion a ahorro" si es un gasto cuya (sub)categoria es de ahorro.
// Estos movimientos NO son consumo: se excluyen del gasto en todas las metricas y se
// contabilizan aparte como ahorro. Solo aplica a gastos (un ingreso a una categoria de
// ahorro sigue siendo un ingreso normal).
export function isSavingsMovement(t: Transaction, ctx: StatsContext): boolean {
  return t.type === 'expense' && refsAreSavings(t.categoryId, t.subcategoryId, ctx);
}

// True si un par de referencias de categoria apunta a una categoria de inversion.
function refsAreInvestment(
  categoryId: string | null,
  subcategoryId: string | null,
  ctx: StatsContext,
): boolean {
  return (
    (categoryId !== null && ctx.investmentCategoryIds.has(categoryId)) ||
    (subcategoryId !== null && ctx.investmentCategoryIds.has(subcategoryId))
  );
}

// Un movimiento es una "aportacion a inversion" si es un gasto cuya (sub)categoria es de
// inversion. Mismo tratamiento estructural que el ahorro (no es consumo), pero se contabiliza
// en una metrica separada. Solo aplica a gastos.
export function isInvestmentMovement(t: Transaction, ctx: StatsContext): boolean {
  return t.type === 'expense' && refsAreInvestment(t.categoryId, t.subcategoryId, ctx);
}

// Un gasto que NO es consumo real: una aportacion a ahorro o a inversion. Se usa en las
// metricas de gasto (evolucion, top, recurrentes) para dejar ambos conceptos fuera del gasto.
export function isApartFromExpense(t: Transaction, ctx: StatsContext): boolean {
  return isSavingsMovement(t, ctx) || isInvestmentMovement(t, ctx);
}

// --- Resolucion de la categoria/subcategoria a efectos de ambito (scope) ---

interface CategoryRefs {
  categoryId: string | null;
  subcategoryId: string | null;
}

// Referencias de categoria del propio movimiento.
function ownRefs(t: Transaction): CategoryRefs {
  return { categoryId: t.categoryId, subcategoryId: t.subcategoryId };
}

// Categoria a la que se atribuye la REDUCCION de un reembolso: la del gasto original
// (resuelto por refundOfId), porque es el gasto de esa categoria el que se esta devolviendo.
// Si el original no es resoluble en el perfil, se cae con seguridad a la categoria propia
// del reembolso. Asi un reembolso sin categoria pero enlazado sigue reduciendo la categoria
// correcta.
export function attributeRefundRefs(t: Transaction, ctx: StatsContext): CategoryRefs {
  if (t.refundOfId !== null) {
    const original = ctx.txById.get(t.refundOfId);
    if (original) return { categoryId: original.categoryId, subcategoryId: original.subcategoryId };
  }
  return ownRefs(t);
}

// Conjunto de ids de categoria a los que pertenece un par de referencias, con acumulacion
// hacia la raiz: una subcategoria aporta tambien su categoria padre, de modo que un
// presupuesto de la categoria raiz agrega el gasto de sus subcategorias.
function rolledUpCategoryIds(refs: CategoryRefs, parentOf: Map<string, string | null>): Set<string> {
  const ids = new Set<string>();
  for (const c of [refs.categoryId, refs.subcategoryId]) {
    if (!c) continue;
    ids.add(c);
    const parent = parentOf.get(c);
    if (parent) ids.add(parent);
  }
  return ids;
}

// Comprueba si un movimiento cae dentro del ambito de un presupuesto. `asRefund` indica que
// se esta evaluando la reduccion de un reembolso, en cuyo caso la categoria se toma del
// gasto original (para category/subcategory). El ambito de cuenta usa siempre la cuenta
// fisica del movimiento (el dinero se mueve en su cuenta), tambien para reembolsos.
export function inScope(
  t: Transaction,
  scope: BudgetScope,
  scopeId: string | null,
  ctx: StatsContext,
  asRefund: boolean,
): boolean {
  switch (scope) {
    case 'overall':
      return true;
    case 'account':
      return t.accountId === scopeId;
    case 'subcategory': {
      const refs = asRefund ? attributeRefundRefs(t, ctx) : ownRefs(t);
      // Coincidencia exacta con la subcategoria (sin acumular hacia la raiz).
      return refs.categoryId === scopeId || refs.subcategoryId === scopeId;
    }
    case 'category': {
      const refs = asRefund ? attributeRefundRefs(t, ctx) : ownRefs(t);
      if (scopeId === null) return false;
      return rolledUpCategoryIds(refs, ctx.parentOf).has(scopeId);
    }
    default:
      return false;
  }
}

// --- Consumo de un ambito en un conjunto de movimientos (ya filtrado al periodo) ---

export interface Consumption {
  // Gasto o ingreso bruto del ambito (entero positivo, magnitud).
  grossCents: number;
  // Reembolsos atribuidos al ambito (entero positivo). Solo aplica a direccion 'expense'.
  refundCents: number;
  // Consumo neto: gasto bruto menos reembolsos (expense) o ingreso bruto (income).
  consumedCents: number;
}

// Calcula el consumo de un ambito y direccion sobre los movimientos de un periodo.
// Precondicion: `txsInPeriod` ya esta acotado a las fechas del periodo. Solo se consideran
// los movimientos que cuentan en estadisticas (countsInStats).
//
//  - direccion 'expense': suma la magnitud de los gastos del ambito y le resta los
//    reembolsos atribuidos a ese ambito (gasto neto). El neto puede ser negativo si en el
//    periodo se devuelve mas de lo gastado; se devuelve tal cual (la UI decide como pintarlo).
//  - direccion 'income': suma los ingresos del ambito, EXCLUYENDO reembolsos (un reembolso
//    no es un ingreso real; contarlo inflaria ingresos y ahorro).
//
// Aportaciones a ahorro: una aportacion a una categoria de ahorro NO es gasto (misma regla
// que el dashboard), por lo que NO consume un presupuesto de gasto general (overall, cuenta u
// otra categoria). La excepcion es un presupuesto de gasto cuyo ambito ES esa categoria de
// ahorro (una meta de ahorro modelada como presupuesto): ahi si debe contar. Asi se preserva
// el invariante "el consumo coincide con la suma de movimientos que cuentan en estadisticas"
// para presupuestos de gasto normales, sin romper las metas de ahorro por categoria.
export function computeConsumption(
  txsInPeriod: Transaction[],
  scope: BudgetScope,
  scopeId: string | null,
  direction: BudgetDirection,
  ctx: StatsContext,
): Consumption {
  let gross = 0;
  let refund = 0;

  // El ambito apunta explicitamente a una categoria de ahorro (meta de ahorro): en ese caso
  // las aportaciones SI cuentan; en cualquier otro ambito de gasto se excluyen.
  const savingsScoped =
    (scope === 'category' || scope === 'subcategory') &&
    scopeId !== null &&
    ctx.savingsCategoryIds.has(scopeId);
  // Analogo para inversion: una meta modelada sobre la categoria de inversion si cuenta sus
  // aportaciones; cualquier otro presupuesto de gasto las excluye.
  const investmentScoped =
    (scope === 'category' || scope === 'subcategory') &&
    scopeId !== null &&
    ctx.investmentCategoryIds.has(scopeId);

  for (const t of txsInPeriod) {
    if (!countsInStats(t)) continue;

    if (direction === 'expense') {
      if (t.type === 'expense' && inScope(t, scope, scopeId, ctx, false)) {
        // La aportacion a ahorro no consume un presupuesto de gasto que no sea de ahorro.
        if (isSavingsMovement(t, ctx) && !savingsScoped) continue;
        // Igual para inversion: no consume un presupuesto de gasto que no sea de inversion.
        if (isInvestmentMovement(t, ctx) && !investmentScoped) continue;
        gross += expenseMagnitude(t);
      } else if (isRefund(t) && inScope(t, scope, scopeId, ctx, true)) {
        const refs = attributeRefundRefs(t, ctx);
        // Reembolso de una aportacion a ahorro: no altera un presupuesto de gasto normal.
        if (refsAreSavings(refs.categoryId, refs.subcategoryId, ctx) && !savingsScoped) continue;
        // Reembolso de una aportacion a inversion: idem para presupuestos de gasto normales.
        if (refsAreInvestment(refs.categoryId, refs.subcategoryId, ctx) && !investmentScoped) continue;
        refund += Math.abs(t.amountCents);
      }
    } else {
      // income: ingresos reales del ambito, sin reembolsos.
      if (t.type === 'income' && !isRefund(t) && inScope(t, scope, scopeId, ctx, false)) {
        gross += Math.abs(t.amountCents);
      }
    }
  }

  const consumed = direction === 'expense' ? gross - refund : gross;
  return { grossCents: gross, refundCents: refund, consumedCents: consumed };
}

// Conveniencia: consumo de un presupuesto sobre un conjunto de movimientos ya acotado al
// periodo del presupuesto.
export function computeBudgetConsumption(
  budget: Pick<Budget, 'scope' | 'scopeId' | 'direction'>,
  txsInPeriod: Transaction[],
  ctx: StatsContext,
): Consumption {
  return computeConsumption(txsInPeriod, budget.scope, budget.scopeId, budget.direction, ctx);
}

// ===========================================================================
// Dashboard (fase actual). Metricas y series listas para graficar, calculadas
// como funciones PURAS sobre los movimientos ya cargados del perfil. Toda la
// agregacion vive aqui (services), nunca en el render: asi el dashboard rinde
// con decenas de miles de movimientos (un unico recorrido por metrica).
//
// Semantica financiera identica a la de presupuestos, reutilizando las mismas
// primitivas (countsInStats, expenseMagnitude, isRefund, attributeRefundRefs):
//  - Exclusiones: solo cuentan los movimientos con excludedFromStats === false.
//    Eso deja fuera, por diseno del modelo, las dos patas de una transferencia
//    interna y el padre de un split.
//  - Splits: cuentan las lineas hijas (llevan la categoria real); el padre no.
//  - Reembolsos: NO son ingreso; reducen el gasto NETO de la categoria del gasto
//    original (o de la propia si el original no es resoluble).
// Todos los importes en centimos enteros. Las magnitudes de gasto son enteros
// positivos (el gasto NETO puede ser negativo si se devuelve mas de lo gastado).
// ===========================================================================

// Categoria raiz a la que se atribuye un par de referencias: la subcategoria (si
// existe) sube a su categoria padre; una categoria raiz se atribuye a si misma.
// Devuelve null si no hay categoria (movimiento sin clasificar). Un id de
// categoria ya inexistente (borrada) se atribuye a si mismo, no se pierde.
export function rootCategoryIdOf(
  categoryId: string | null,
  subcategoryId: string | null,
  parentOf: Map<string, string | null>,
): string | null {
  const effective = subcategoryId ?? categoryId;
  if (!effective) return null;
  const parent = parentOf.get(effective);
  // parent === null  -> effective ya es raiz.
  // parent === undefined -> categoria no encontrada; se atribuye a si misma.
  return parent ?? effective;
}

// Clave de mes contable (YYYY-MM) de una fecha YYYY-MM-DD. Ordenable lexicograficamente.
export function monthKey(dateISO: string): string {
  return dateISO.slice(0, 7);
}

// --- Resumen ingresos / gastos / ahorro de un periodo ---

export interface IncomeExpenseSummary {
  incomeCents: number; // ingresos reales del periodo (sin reembolsos), entero >= 0
  expenseGrossCents: number; // gasto bruto (magnitud), entero >= 0
  refundCents: number; // reembolsos del periodo, entero >= 0
  expenseNetCents: number; // gasto neto = bruto - reembolsos (puede ser < 0)
  netSavingsCents: number; // ahorro neto = ingresos - gasto neto
  // Aportacion neta a ahorro del periodo: suma de gastos en categorias de ahorro menos los
  // reembolsos/retiradas atribuidos a ellas. Normalmente >= 0, pero puede ser NEGATIVO en un
  // periodo con retirada neta de ahorro. Ya NO cuenta como gasto; es informativo para la UI
  // (que solo lo muestra cuando es positivo). Su efecto sobre el ahorro neto es automatico.
  savingsContribCents: number;
  // Aportacion neta a inversion del periodo: analogo a savingsContribCents pero para las
  // categorias de inversion. Concepto separado del ahorro, mostrado con enfasis propio en la
  // UI. Tampoco cuenta como gasto; su efecto sobre el ahorro neto (dinero no consumido) es
  // automatico. Puede ser NEGATIVO si en el periodo se retira mas de lo invertido.
  investmentContribCents: number;
  // Tasa de ahorro en TANTO POR MIL entero (350 = 35,0%). null cuando no hay
  // ingresos en el periodo (no se divide por cero: la tasa no esta definida).
  savingsRatePerMille: number | null;
}

// Gasto neto atribuido a una categoria raiz (o al bucket "sin categoria").
export interface CategorySpend {
  categoryId: string | null; // null = sin categoria
  grossCents: number; // gasto bruto atribuido, entero >= 0
  refundCents: number; // reembolsos atribuidos, entero >= 0
  netCents: number; // bruto - reembolsos (puede ser < 0)
}

// Resultado de un unico recorrido por los movimientos del periodo: alimenta a la
// vez el resumen y el desglose por categoria (evita recorrer dos veces).
interface PeriodAggregate {
  summary: IncomeExpenseSummary;
  byCategory: CategorySpend[]; // ordenado por gasto neto desc; "sin categoria" al final
}

// Tasa de ahorro en tanto por mil (entero). null si no hay ingresos (evita
// division por cero; la tasa queda indefinida y la UI muestra "sin datos").
export function savingsRatePerMille(incomeCents: number, netSavingsCents: number): number | null {
  if (incomeCents <= 0) return null;
  return Math.round((netSavingsCents / incomeCents) * 1000);
}

// Agrega los movimientos de un periodo (ya acotado a fechas) en un unico recorrido.
// Precondicion: txsInPeriod ya esta filtrado al rango del periodo.
export function aggregatePeriod(txsInPeriod: Transaction[], ctx: StatsContext): PeriodAggregate {
  let income = 0;
  let expenseGross = 0;
  let refund = 0;
  let savingsContrib = 0;
  let investmentContrib = 0;
  const grossByCat = new Map<string | null, number>();
  const refundByCat = new Map<string | null, number>();

  for (const t of txsInPeriod) {
    if (!countsInStats(t)) continue;

    if (t.type === 'expense') {
      // Aportacion a ahorro: no es gasto ni entra en el desglose por categoria de gasto.
      if (isSavingsMovement(t, ctx)) {
        savingsContrib += expenseMagnitude(t);
        continue;
      }
      // Aportacion a inversion: mismo tratamiento estructural, metrica separada.
      if (isInvestmentMovement(t, ctx)) {
        investmentContrib += expenseMagnitude(t);
        continue;
      }
      const mag = expenseMagnitude(t);
      expenseGross += mag;
      const root = rootCategoryIdOf(t.categoryId, t.subcategoryId, ctx.parentOf);
      grossByCat.set(root, (grossByCat.get(root) ?? 0) + mag);
    } else if (isRefund(t)) {
      const refs = attributeRefundRefs(t, ctx);
      const amt = Math.abs(t.amountCents);
      // Reembolso de una aportacion a ahorro: revierte ahorro, no reduce gasto.
      if (refsAreSavings(refs.categoryId, refs.subcategoryId, ctx)) {
        savingsContrib -= amt;
        continue;
      }
      // Reembolso/retirada de una aportacion a inversion: revierte inversion, no reduce gasto.
      if (refsAreInvestment(refs.categoryId, refs.subcategoryId, ctx)) {
        investmentContrib -= amt;
        continue;
      }
      refund += amt;
      // Se atribuye a la categoria del gasto original (misma regla que presupuestos).
      const root = rootCategoryIdOf(refs.categoryId, refs.subcategoryId, ctx.parentOf);
      refundByCat.set(root, (refundByCat.get(root) ?? 0) + amt);
    } else if (t.type === 'income') {
      income += Math.abs(t.amountCents);
    }
  }

  const expenseNet = expenseGross - refund;
  const netSavings = income - expenseNet;
  const summary: IncomeExpenseSummary = {
    incomeCents: income,
    expenseGrossCents: expenseGross,
    refundCents: refund,
    expenseNetCents: expenseNet,
    netSavingsCents: netSavings,
    savingsContribCents: savingsContrib,
    investmentContribCents: investmentContrib,
    savingsRatePerMille: savingsRatePerMille(income, netSavings),
  };

  // Union de categorias con gasto o con reembolso.
  const catIds = new Set<string | null>([...grossByCat.keys(), ...refundByCat.keys()]);
  const byCategory: CategorySpend[] = [];
  for (const id of catIds) {
    const gross = grossByCat.get(id) ?? 0;
    const ref = refundByCat.get(id) ?? 0;
    byCategory.push({ categoryId: id, grossCents: gross, refundCents: ref, netCents: gross - ref });
  }
  // Orden por gasto neto descendente; el bucket "sin categoria" (null) al final a igualdad.
  byCategory.sort((a, b) => {
    if (b.netCents !== a.netCents) return b.netCents - a.netCents;
    if (a.categoryId === null) return 1;
    if (b.categoryId === null) return -1;
    return 0;
  });

  return { summary, byCategory };
}

// --- Evolucion mensual ---

export interface MonthPoint {
  month: string; // YYYY-MM
  incomeCents: number; // ingresos reales del mes (>= 0)
  expenseNetCents: number; // gasto neto del mes (bruto - reembolsos del mes)
  netSavingsCents: number; // ingresos - gasto neto
}

// Lista de claves de mes (YYYY-MM) de una ventana de `count` meses que TERMINA en
// el mes de `anchorISO` (incluido), en orden cronologico. Cruza cambios de ano.
export function monthKeysEndingAt(anchorISO: string, count: number): string[] {
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    keys.push(monthKey(shiftMonths(anchorISO, -i)));
  }
  return keys;
}

// Serie de evolucion mensual: para cada mes de la ventana (aunque no tenga
// movimientos, para no dejar huecos en el grafico), ingresos, gasto neto y ahorro.
// Un unico recorrido por los movimientos + relleno de la rejilla de meses.
export function computeMonthlyEvolution(
  allTx: Transaction[],
  anchorISO: string,
  monthsBack: number,
  ctx?: StatsContext,
): MonthPoint[] {
  const keys = monthKeysEndingAt(anchorISO, monthsBack);
  const first = keys[0]!;
  const last = keys[keys.length - 1]!;
  const income = new Map<string, number>();
  const expenseNet = new Map<string, number>();

  for (const t of allTx) {
    if (!countsInStats(t)) continue;
    const k = monthKey(t.date);
    if (k < first || k > last) continue; // fuera de la ventana
    // Las aportaciones a ahorro o a inversion no son gasto: no reducen el gasto neto mensual.
    if (ctx && isApartFromExpense(t, ctx)) continue;
    if (t.type === 'expense') {
      expenseNet.set(k, (expenseNet.get(k) ?? 0) + expenseMagnitude(t));
    } else if (isRefund(t)) {
      // El reembolso de una aportacion a ahorro o inversion no reduce el gasto del mes.
      if (ctx) {
        const refs = attributeRefundRefs(t, ctx);
        if (
          refsAreSavings(refs.categoryId, refs.subcategoryId, ctx) ||
          refsAreInvestment(refs.categoryId, refs.subcategoryId, ctx)
        )
          continue;
      }
      // El reembolso reduce el gasto del mes en que ocurre.
      expenseNet.set(k, (expenseNet.get(k) ?? 0) - Math.abs(t.amountCents));
    } else if (t.type === 'income') {
      income.set(k, (income.get(k) ?? 0) + Math.abs(t.amountCents));
    }
  }

  return keys.map((month) => {
    const inc = income.get(month) ?? 0;
    const exp = expenseNet.get(month) ?? 0;
    return { month, incomeCents: inc, expenseNetCents: exp, netSavingsCents: inc - exp };
  });
}

// --- Top gastos individuales ---

export interface TopExpense {
  id: string;
  date: string;
  concept: string;
  amountCents: number; // magnitud positiva del gasto
  categoryId: string | null; // categoria raiz atribuida (para color/nombre en UI)
  accountId: string;
}

// Mayores gastos individuales del periodo (lineas que cuentan en estadisticas).
// Las lineas hijas de un split cuentan (tienen categoria real); el padre queda
// excluido y no aparece. Orden por magnitud desc; desempate por fecha desc.
export function computeTopExpenses(
  txsInPeriod: Transaction[],
  ctx: StatsContext,
  limit: number,
): TopExpense[] {
  const expenses: TopExpense[] = [];
  for (const t of txsInPeriod) {
    if (!countsInStats(t) || t.type !== 'expense') continue;
    // Las aportaciones a ahorro o inversion no son gasto: no aparecen entre los mayores gastos.
    if (isApartFromExpense(t, ctx)) continue;
    expenses.push({
      id: t.id,
      date: t.date,
      concept: t.concept,
      amountCents: expenseMagnitude(t),
      categoryId: rootCategoryIdOf(t.categoryId, t.subcategoryId, ctx.parentOf),
      accountId: t.accountId,
    });
  }
  expenses.sort((a, b) => b.amountCents - a.amountCents || (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return expenses.slice(0, limit);
}

// --- Gastos recurrentes detectados ---

export interface RecurringExpense {
  key: string; // concepto normalizado (clave de agrupacion)
  label: string; // concepto representativo (el de la ocurrencia mas reciente)
  occurrences: number; // numero de movimientos del grupo
  months: number; // meses distintos en que aparece
  totalCents: number; // suma de magnitudes (bruto), entero >= 0
  averageCents: number; // media por ocurrencia (redondeada)
  lastDate: string; // fecha de la ocurrencia mas reciente
}

// Deteccion simple de gastos recurrentes en una ventana de `monthsBack` meses que
// termina en el mes de `anchorISO`: agrupa gastos por concepto normalizado y marca
// como recurrente el grupo que aparece en al menos `minMonths` meses DISTINTOS.
// Heuristica deliberadamente conservadora (deteccion basica del MVP): no infiere
// periodicidad exacta, solo repeticion mensual. Orden por numero de meses desc.
export function computeRecurringExpenses(
  allTx: Transaction[],
  anchorISO: string,
  monthsBack: number,
  minMonths: number,
  limit: number,
  ctx?: StatsContext,
): RecurringExpense[] {
  const keys = monthKeysEndingAt(anchorISO, monthsBack);
  const first = keys[0]!;
  const last = keys[keys.length - 1]!;

  interface Group {
    label: string;
    lastDate: string;
    occurrences: number;
    total: number;
    months: Set<string>;
  }
  const groups = new Map<string, Group>();

  for (const t of allTx) {
    if (!countsInStats(t) || t.type !== 'expense') continue;
    // Las aportaciones a ahorro o inversion no son gasto: no se consideran recurrentes de gasto.
    if (ctx && isApartFromExpense(t, ctx)) continue;
    const mk = monthKey(t.date);
    if (mk < first || mk > last) continue;
    const norm = normalizeConcept(t.concept);
    if (norm.length === 0) continue; // sin concepto: no se puede agrupar de forma fiable
    let g = groups.get(norm);
    if (!g) {
      g = { label: t.concept, lastDate: t.date, occurrences: 0, total: 0, months: new Set() };
      groups.set(norm, g);
    }
    g.occurrences += 1;
    g.total += expenseMagnitude(t);
    g.months.add(mk);
    // El label representativo es el de la ocurrencia mas reciente.
    if (t.date >= g.lastDate) {
      g.lastDate = t.date;
      g.label = t.concept;
    }
  }

  const result: RecurringExpense[] = [];
  for (const [key, g] of groups) {
    if (g.months.size < minMonths) continue;
    result.push({
      key,
      label: g.label,
      occurrences: g.occurrences,
      months: g.months.size,
      totalCents: g.total,
      averageCents: Math.round(g.total / g.occurrences),
      lastDate: g.lastDate,
    });
  }
  result.sort(
    (a, b) => b.months - a.months || b.occurrences - a.occurrences || b.totalCents - a.totalCents,
  );
  return result.slice(0, limit);
}

// --- Comparativa contra el promedio de meses anteriores ---

export interface Comparison {
  currentExpenseNetCents: number; // gasto neto del mes de referencia (parcial si es el mes en curso)
  averageExpenseNetCents: number; // media de gasto neto MENSUAL COMPLETO de los meses previos con actividad
  monthsCompared: number; // cuantos meses previos entraron en la media
  // Regla de 3: si el mes de referencia es el mes en curso, su gasto es PARCIAL (hasta hoy).
  // Comparar ese parcial contra medias de meses completos no tiene sentido (el gap se cierra
  // solo segun avanzan los dias). Por eso se prorratea la media completa a la misma porcion de
  // mes transcurrida (media * diasTranscurridos / diasDelMes) y se compara contra ese valor.
  prorated: boolean; // true si se ha prorrateado (mes en curso, parcial)
  daysElapsed: number; // dias del mes de referencia considerados (todos si el mes esta cerrado)
  daysInMonth: number; // dias del mes de referencia
  averageComparedCents: number; // media contra la que se compara realmente (prorrateada si aplica)
  deltaCents: number; // current - averageCompared
  // Variacion relativa en tanto por mil (entero). null si no hay meses previos con
  // actividad o la media comparada es 0 (no se divide por cero).
  deltaPerMille: number | null;
}

// Compara el gasto neto del mes de referencia contra la media de los `monthsBack`
// meses anteriores QUE TUVIERON actividad (ingreso o gasto). Excluir los meses sin
// actividad evita que un historial vacio (perfil nuevo) hunda la media a casi cero.
//
// Regla de 3 para el mes en curso: cuando el mes de referencia es el mes natural en curso,
// su gasto es parcial (hasta `today`). Comparar ese parcial contra medias de meses completos
// esta sesgado a la baja. Para que la comparativa sea justa se prorratea la media completa a
// los dias transcurridos (media * diasTranscurridos / diasDelMes), de modo que ambos lados
// cubren la misma fraccion del mes. En meses cerrados (pasados) no se prorratea: se compara
// mes completo contra media de meses completos.
//
// Un mes con gasto y reembolso que se anulan (neto 0, ingreso 0) se considera sin actividad
// y no entra en la media (criterio deliberado).
export function computeComparison(
  allTx: Transaction[],
  anchorISO: string,
  monthsBack: number,
  ctx?: StatsContext,
  today: string = todayISO(),
): Comparison {
  // Ventana: mes de referencia + monthsBack previos.
  const series = computeMonthlyEvolution(allTx, anchorISO, monthsBack + 1, ctx);
  const current = series[series.length - 1]!;
  const previous = series.slice(0, series.length - 1);
  // Solo meses con actividad real (evita promediar meses vacios de un perfil nuevo).
  const active = previous.filter((m) => m.incomeCents !== 0 || m.expenseNetCents !== 0);
  const monthsCompared = active.length;
  const average =
    monthsCompared > 0
      ? Math.round(active.reduce((s, m) => s + m.expenseNetCents, 0) / monthsCompared)
      : 0;

  // Prorrateo (regla de 3) solo si el mes de referencia es el mes natural en curso y aun no
  // ha terminado. daysElapsed nunca supera los dias del mes (por si `today` cae despues).
  const anchor = parseISO(anchorISO);
  const now = parseISO(today);
  const dim = daysInMonth(anchor.y, anchor.m);
  const isCurrentMonth = anchor.y === now.y && anchor.m === now.m;
  const daysElapsed = isCurrentMonth ? Math.min(now.d, dim) : dim;
  const prorated = isCurrentMonth && daysElapsed < dim;
  const averageCompared = prorated ? Math.round((average * daysElapsed) / dim) : average;

  // Gasto actual: en el mes en curso se acota HASTA hoy (igual que el forecast), para que el
  // parcial cubra literalmente los dias transcurridos aunque existan movimientos con fecha
  // futura ya registrados en el mes. Sin ctx (algunos tests) se usa el total del mes de la
  // serie. La serie ya excluye ahorros; el recorte tambien via aggregatePeriod.
  let currentExpenseNet = current.expenseNetCents;
  if (isCurrentMonth && ctx) {
    const monthToToday: DateRange = { from: toISO(anchor.y, anchor.m, 1), to: toISO(now.y, now.m, daysElapsed) };
    const inMonthToToday = allTx.filter((t) => isWithinRange(t.date, monthToToday));
    currentExpenseNet = aggregatePeriod(inMonthToToday, ctx).summary.expenseNetCents;
  }

  const delta = currentExpenseNet - averageCompared;
  const deltaPerMille = averageCompared > 0 ? Math.round((delta / averageCompared) * 1000) : null;
  return {
    currentExpenseNetCents: currentExpenseNet,
    averageExpenseNetCents: average,
    monthsCompared,
    prorated,
    daysElapsed,
    daysInMonth: dim,
    averageComparedCents: averageCompared,
    deltaCents: delta,
    deltaPerMille,
  };
}

// --- Forecast simple de cierre de mes ---

export interface Forecast {
  // Solo aplica cuando el mes analizado es el mes natural en curso (segun `todayISO`).
  // En un mes pasado o futuro no tiene sentido extrapolar: applicable = false.
  applicable: boolean;
  spentSoFarCents: number; // gasto neto en lo que va de mes (hasta hoy, incluido)
  projectedExpenseCents: number; // extrapolacion lineal a fin de mes (ESTIMACION)
  daysElapsed: number; // dias transcurridos del mes (>= 1)
  daysInMonth: number; // dias del mes
}

// Extrapolacion lineal del ritmo de gasto: proyecta el gasto de fin de mes a partir
// del gasto acumulado hasta hoy, asumiendo un ritmo constante. Es una ESTIMACION
// simple (MVP), claramente etiquetada como tal en la UI. Solo aplica al mes en curso.
export function computeForecast(
  allTx: Transaction[],
  anchorISO: string,
  ctx: StatsContext,
  today: string = todayISO(),
): Forecast {
  const anchor = parseISO(anchorISO);
  const now = parseISO(today);
  const applicable = anchor.y === now.y && anchor.m === now.m;
  const dim = daysInMonth(anchor.y, anchor.m);

  // Gasto neto acumulado del mes hasta la fecha de corte (hoy si es el mes en curso;
  // fin de mes en cualquier otro caso, donde no se extrapola).
  const cutoff = applicable ? today : toISO(anchor.y, anchor.m, dim);
  const range: DateRange = { from: toISO(anchor.y, anchor.m, 1), to: cutoff };
  const inRange = allTx.filter((t) => isWithinRange(t.date, range));
  const spentSoFar = aggregatePeriod(inRange, ctx).summary.expenseNetCents;

  if (!applicable) {
    return {
      applicable: false,
      spentSoFarCents: spentSoFar,
      projectedExpenseCents: spentSoFar,
      daysElapsed: dim,
      daysInMonth: dim,
    };
  }
  const daysElapsed = now.d; // >= 1, nunca 0: no hay division por cero
  const projected = Math.round((spentSoFar * dim) / daysElapsed);
  return {
    applicable: true,
    spentSoFarCents: spentSoFar,
    projectedExpenseCents: projected,
    daysElapsed,
    daysInMonth: dim,
  };
}

// --- Analitica de ahorro e inversion ---

// Punto mensual de la analitica de ahorro e inversion. Las aportaciones son NETAS
// (aportado menos retirado via reembolso, misma semantica que el resumen del periodo) y
// pueden ser negativas en un mes con retirada neta. Los acumulados corren DENTRO de la
// ventana analizada (no son el acumulado historico; ese va aparte en el agregado).
export interface SavingsInvestmentMonthPoint {
  month: string; // YYYY-MM
  incomeCents: number; // ingresos reales del mes (sin reembolsos)
  netSavingsCents: number; // ahorro neto del mes = ingresos - gasto neto
  savingsContribCents: number; // aportacion neta a categorias de ahorro
  investmentContribCents: number; // aportacion neta a categorias de inversion
  cumulativeSavingsContribCents: number; // ahorro aportado acumulado en la ventana
  cumulativeInvestmentContribCents: number; // inversion aportada acumulada en la ventana
  savingsRatePerMille: number | null; // tasa de ahorro del mes (null sin ingresos)
}

// Mejor mes de una metrica: clave de mes e importe. Solo se declara "mejor" un mes con
// valor positivo (con todo negativo o cero no hay mejor mes que celebrar: null).
export interface BestMonth {
  month: string; // YYYY-MM
  cents: number;
}

export interface SavingsInvestmentAnalysis {
  months: SavingsInvestmentMonthPoint[]; // rejilla completa de la ventana, sin huecos
  // Totales de la ventana analizada.
  totalIncomeCents: number;
  totalNetSavingsCents: number;
  totalSavingsContribCents: number;
  totalInvestmentContribCents: number;
  // Tasa de ahorro agregada de la ventana: ahorro neto total sobre ingresos totales.
  // null si no hubo ingresos en toda la ventana (no se divide por cero).
  overallSavingsRatePerMille: number | null;
  // Medias mensuales sobre los meses CON actividad (mismo criterio que la comparativa:
  // un mes sin ingresos, sin gasto neto y sin aportaciones no diluye las medias).
  activeMonths: number;
  avgNetSavingsCents: number; // 0 si no hay meses activos
  avgSavingsContribCents: number;
  avgInvestmentContribCents: number;
  // Mejores meses (entre los activos). null si ningun mes fue positivo en esa metrica.
  bestNetSavingsMonth: BestMonth | null;
  bestInvestmentMonth: BestMonth | null;
  bestSavingsRateMonth: { month: string; perMille: number } | null;
  // Rachas de meses CONSECUTIVOS con ahorro neto positivo dentro de la ventana. La racha
  // actual termina en el ultimo mes de la ventana; si ese ultimo mes aun no tiene
  // actividad (p. ej. un mes recien empezado) se ignora y la racha se mide hasta el
  // anterior, para no romperla de forma artificial el dia 1 de cada mes.
  currentStreakMonths: number;
  longestStreakMonths: number;
  // Acumulado HISTORICO del perfil (todos los movimientos, no solo la ventana).
  allTimeSavingsContribCents: number;
  allTimeInvestmentContribCents: number;
  // Hay alguna aportacion (historica o de la ventana) a ahorro o inversion. La UI lo usa
  // para explicar como activar el apartado cuando aun no se usan esas categorias.
  hasAnyContrib: boolean;
}

// Actividad de un mes a efectos de medias y rachas: mismo criterio deliberado que
// computeComparison (un mes donde todo queda a cero no cuenta), ampliado con las
// aportaciones (un mes que solo tuvo un traspaso a ahorro SI es un mes activo).
function isActiveMonth(p: SavingsInvestmentMonthPoint): boolean {
  return (
    p.incomeCents !== 0 ||
    p.netSavingsCents !== 0 ||
    p.savingsContribCents !== 0 ||
    p.investmentContribCents !== 0
  );
}

// Analitica de ahorro e inversion sobre una ventana de `monthsBack` meses que termina en
// el mes de `anchorISO`. Un unico recorrido para bucketizar por mes (reutilizando
// aggregatePeriod por bucket: identica semantica que el resumen del dashboard) mas un
// recorrido para el acumulado historico. Pura y determinista.
export function computeSavingsInvestment(
  allTx: Transaction[],
  anchorISO: string,
  monthsBack: number,
  ctx: StatsContext,
): SavingsInvestmentAnalysis {
  // Contrato explicito: la ventana necesita al menos un mes (sin errores silenciosos).
  if (monthsBack < 1) {
    throw new Error(`La ventana de la analitica de ahorro requiere al menos 1 mes (recibido: ${monthsBack}).`);
  }
  const keys = monthKeysEndingAt(anchorISO, monthsBack);
  const first = keys[0]!;
  const last = keys[keys.length - 1]!;

  // Bucket por mes dentro de la ventana + acumulado historico en el mismo recorrido.
  const byMonth = new Map<string, Transaction[]>();
  let allTimeSavings = 0;
  let allTimeInvestment = 0;
  for (const t of allTx) {
    if (!countsInStats(t)) continue;
    // Acumulado historico de aportaciones netas (independiente de la ventana).
    if (isSavingsMovement(t, ctx)) {
      allTimeSavings += expenseMagnitude(t);
    } else if (isInvestmentMovement(t, ctx)) {
      allTimeInvestment += expenseMagnitude(t);
    } else if (isRefund(t)) {
      const refs = attributeRefundRefs(t, ctx);
      if (refsAreSavings(refs.categoryId, refs.subcategoryId, ctx)) {
        allTimeSavings -= Math.abs(t.amountCents);
      } else if (refsAreInvestment(refs.categoryId, refs.subcategoryId, ctx)) {
        allTimeInvestment -= Math.abs(t.amountCents);
      }
    }
    const k = monthKey(t.date);
    if (k < first || k > last) continue;
    const bucket = byMonth.get(k);
    if (bucket) bucket.push(t);
    else byMonth.set(k, [t]);
  }

  // Serie mensual: cada mes se agrega con aggregatePeriod (misma semantica que el resumen
  // del periodo: exclusiones, reembolsos, ahorro e inversion aparte del gasto).
  let cumSavings = 0;
  let cumInvestment = 0;
  const months: SavingsInvestmentMonthPoint[] = keys.map((month) => {
    const { summary } = aggregatePeriod(byMonth.get(month) ?? [], ctx);
    cumSavings += summary.savingsContribCents;
    cumInvestment += summary.investmentContribCents;
    return {
      month,
      incomeCents: summary.incomeCents,
      netSavingsCents: summary.netSavingsCents,
      savingsContribCents: summary.savingsContribCents,
      investmentContribCents: summary.investmentContribCents,
      cumulativeSavingsContribCents: cumSavings,
      cumulativeInvestmentContribCents: cumInvestment,
      savingsRatePerMille: summary.savingsRatePerMille,
    };
  });

  // Totales de la ventana y medias sobre meses activos.
  const totalIncome = months.reduce((s, m) => s + m.incomeCents, 0);
  const totalNetSavings = months.reduce((s, m) => s + m.netSavingsCents, 0);
  const totalSavingsContrib = months.reduce((s, m) => s + m.savingsContribCents, 0);
  const totalInvestmentContrib = months.reduce((s, m) => s + m.investmentContribCents, 0);
  const active = months.filter(isActiveMonth);
  const avg = (total: number): number =>
    active.length > 0 ? Math.round(total / active.length) : 0;

  // Mejores meses entre los activos; solo cuentan valores positivos (ver BestMonth).
  let bestNet: BestMonth | null = null;
  let bestInv: BestMonth | null = null;
  let bestRate: { month: string; perMille: number } | null = null;
  for (const m of active) {
    if (m.netSavingsCents > 0 && (bestNet === null || m.netSavingsCents > bestNet.cents)) {
      bestNet = { month: m.month, cents: m.netSavingsCents };
    }
    if (
      m.investmentContribCents > 0 &&
      (bestInv === null || m.investmentContribCents > bestInv.cents)
    ) {
      bestInv = { month: m.month, cents: m.investmentContribCents };
    }
    if (
      m.savingsRatePerMille !== null &&
      m.savingsRatePerMille > 0 &&
      (bestRate === null || m.savingsRatePerMille > bestRate.perMille)
    ) {
      bestRate = { month: m.month, perMille: m.savingsRatePerMille };
    }
  }

  // Rachas de meses consecutivos con ahorro neto positivo.
  let longestStreak = 0;
  let run = 0;
  for (const m of months) {
    run = m.netSavingsCents > 0 ? run + 1 : 0;
    if (run > longestStreak) longestStreak = run;
  }
  // Racha actual: desde el final hacia atras; un ultimo mes sin actividad no la rompe.
  let currentStreak = 0;
  let i = months.length - 1;
  if (i >= 0 && !isActiveMonth(months[i]!)) i--;
  for (; i >= 0; i--) {
    if (months[i]!.netSavingsCents > 0) currentStreak++;
    else break;
  }

  return {
    months,
    totalIncomeCents: totalIncome,
    totalNetSavingsCents: totalNetSavings,
    totalSavingsContribCents: totalSavingsContrib,
    totalInvestmentContribCents: totalInvestmentContrib,
    overallSavingsRatePerMille: savingsRatePerMille(totalIncome, totalNetSavings),
    activeMonths: active.length,
    avgNetSavingsCents: avg(totalNetSavings),
    avgSavingsContribCents: avg(totalSavingsContrib),
    avgInvestmentContribCents: avg(totalInvestmentContrib),
    bestNetSavingsMonth: bestNet,
    bestInvestmentMonth: bestInv,
    bestSavingsRateMonth: bestRate,
    currentStreakMonths: currentStreak,
    longestStreakMonths: longestStreak,
    allTimeSavingsContribCents: allTimeSavings,
    allTimeInvestmentContribCents: allTimeInvestment,
    hasAnyContrib: allTimeSavings !== 0 || allTimeInvestment !== 0,
  };
}

// --- Orquestador puro: todas las metricas del dashboard de una sola carga ---

// Filtro cruzado del dashboard: al pulsar un elemento visual (p. ej. una barra de categoria)
// el resto de visuales se recalculan acotados a esa dimension. De momento la unica dimension
// es la categoria raiz (categoryId = null representa el bucket "sin categoria"). El grafico de
// gasto por categoria actua de control (se muestra siempre completo, resaltando el activo);
// el resto de metricas se filtran. La navegacion por mes NO usa este filtro: pulsar un mes en
// la evolucion cambia el periodo de referencia (mismo mecanismo que el selector de periodo).
export interface DashboardFilter {
  categoryId: string | null; // categoria raiz seleccionada; null = "sin categoria"
}

export interface DashboardParams {
  range: DateRange; // periodo seleccionado (mes en curso por defecto o rango personalizado)
  anchorISO: string; // fecha ancla del mes de referencia (evolucion, comparativa, forecast)
  today?: string; // hoy (inyectable en tests); por defecto el reloj local
  filter?: DashboardFilter; // filtro cruzado activo (sin filtro si se omite)
  monthsBack?: number; // meses de la serie de evolucion (por defecto 12)
  topLimit?: number; // numero de top gastos (por defecto 5)
  recurringMonthsBack?: number; // ventana de recurrentes (por defecto 6)
  recurringMinMonths?: number; // meses distintos minimos para recurrente (por defecto 3)
  recurringLimit?: number; // numero de recurrentes (por defecto 8)
  comparisonMonthsBack?: number; // meses previos para la comparativa (por defecto 3)
}

export interface DashboardData {
  range: DateRange;
  anchorMonth: string; // YYYY-MM
  hasData: boolean; // hay algun movimiento que cuente en el periodo seleccionado (sin filtro)
  filter: DashboardFilter | null; // filtro cruzado aplicado (null si ninguno)
  summary: IncomeExpenseSummary;
  byCategory: CategorySpend[]; // SIEMPRE completo (control del filtro), no acotado por filter
  monthly: MonthPoint[];
  topExpenses: TopExpense[];
  recurring: RecurringExpense[];
  comparison: Comparison;
  forecast: Forecast;
  // Analitica de ahorro e inversion de la ventana de evolucion. SIEMPRE sin filtro
  // cruzado: el filtro apunta a categorias de gasto y las aportaciones a ahorro/inversion
  // viven fuera del gasto, asi que filtrarla la dejaria a cero de forma enganosa.
  savingsInvestment: SavingsInvestmentAnalysis;
}

// Categoria raiz atribuida a un movimiento a efectos del filtro cruzado: la del gasto
// original si es un reembolso (misma atribucion que en el desglose), la propia en otro caso.
function filterRootCategoryId(t: Transaction, ctx: StatsContext): string | null {
  if (isRefund(t)) {
    const refs = attributeRefundRefs(t, ctx);
    return rootCategoryIdOf(refs.categoryId, refs.subcategoryId, ctx.parentOf);
  }
  return rootCategoryIdOf(t.categoryId, t.subcategoryId, ctx.parentOf);
}

// Calcula TODAS las metricas del dashboard a partir de los movimientos y categorias
// ya cargados del perfil. Puro y determinista (con `today` inyectable). Cada metrica
// recorre los datos una vez; nada se calcula en el render.
export function computeDashboard(
  allTx: Transaction[],
  categories: Category[],
  params: DashboardParams,
): DashboardData {
  const ctx = buildStatsContext(categories, allTx);
  const {
    range,
    anchorISO,
    today = todayISO(),
    filter,
    monthsBack = 12,
    topLimit = 5,
    recurringMonthsBack = 6,
    recurringMinMonths = 3,
    recurringLimit = 8,
    comparisonMonthsBack = 3,
  } = params;

  // Acotar una sola vez el conjunto del periodo seleccionado (sin filtro cruzado).
  const inPeriod = allTx.filter((t) => isWithinRange(t.date, range));
  // hasData refleja si hay datos en el periodo con independencia del filtro cruzado: asi el
  // estado vacio solo aparece cuando de verdad no hay movimientos, no al filtrar por categoria.
  const hasData = inPeriod.some((t) => countsInStats(t));

  // El desglose por categoria se calcula SIEMPRE completo: es el control del filtro y debe
  // mostrar todas las categorias para poder cambiar la seleccion.
  const { byCategory } = aggregatePeriod(inPeriod, ctx);

  // Resto de metricas: acotadas al filtro cruzado (por categoria raiz) si esta activo. Sin
  // filtro, `keep` es la identidad y el resultado es identico al comportamiento previo.
  const keep = (list: Transaction[]): Transaction[] =>
    filter === undefined ? list : list.filter((t) => filterRootCategoryId(t, ctx) === filter.categoryId);

  const inPeriodFiltered = keep(inPeriod);
  const allTxFiltered = keep(allTx);
  const { summary } = aggregatePeriod(inPeriodFiltered, ctx);

  return {
    range,
    anchorMonth: monthKey(anchorISO),
    hasData,
    filter: filter ?? null,
    summary,
    byCategory,
    monthly: computeMonthlyEvolution(allTxFiltered, anchorISO, monthsBack, ctx),
    topExpenses: computeTopExpenses(inPeriodFiltered, ctx, topLimit),
    recurring: computeRecurringExpenses(
      allTxFiltered,
      anchorISO,
      recurringMonthsBack,
      recurringMinMonths,
      recurringLimit,
      ctx,
    ),
    comparison: computeComparison(allTxFiltered, anchorISO, comparisonMonthsBack, ctx, today),
    forecast: computeForecast(allTxFiltered, anchorISO, ctx, today),
    // Sin filtro cruzado a proposito (ver DashboardData.savingsInvestment).
    savingsInvestment: computeSavingsInvestment(allTx, anchorISO, monthsBack, ctx),
  };
}

export const statsService = {
  // Carga los movimientos y categorias del perfil (una sola vez) y calcula todas las
  // metricas del dashboard. Aislamiento por diseno: ambos repositorios exigen profileId y
  // no existe consulta que cruce perfiles. La agregacion ocurre aqui, no en el render.
  async computeDashboard(profileId: string, params: DashboardParams): Promise<DashboardData> {
    requireProfileId(profileId);
    const [categories, allTx] = await Promise.all([
      categoriesRepo.list(profileId),
      transactionsRepo.list(profileId),
    ]);
    return computeDashboard(allTx, categories, params);
  },
};
