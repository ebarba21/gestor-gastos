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
  return { parentOf, txById };
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
export function computeConsumption(
  txsInPeriod: Transaction[],
  scope: BudgetScope,
  scopeId: string | null,
  direction: BudgetDirection,
  ctx: StatsContext,
): Consumption {
  let gross = 0;
  let refund = 0;

  for (const t of txsInPeriod) {
    if (!countsInStats(t)) continue;

    if (direction === 'expense') {
      if (t.type === 'expense' && inScope(t, scope, scopeId, ctx, false)) {
        gross += expenseMagnitude(t);
      } else if (isRefund(t) && inScope(t, scope, scopeId, ctx, true)) {
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
  const grossByCat = new Map<string | null, number>();
  const refundByCat = new Map<string | null, number>();

  for (const t of txsInPeriod) {
    if (!countsInStats(t)) continue;

    if (t.type === 'expense') {
      const mag = expenseMagnitude(t);
      expenseGross += mag;
      const root = rootCategoryIdOf(t.categoryId, t.subcategoryId, ctx.parentOf);
      grossByCat.set(root, (grossByCat.get(root) ?? 0) + mag);
    } else if (isRefund(t)) {
      const amt = Math.abs(t.amountCents);
      refund += amt;
      // Se atribuye a la categoria del gasto original (misma regla que presupuestos).
      const refs = attributeRefundRefs(t, ctx);
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
    if (t.type === 'expense') {
      expenseNet.set(k, (expenseNet.get(k) ?? 0) + expenseMagnitude(t));
    } else if (isRefund(t)) {
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
  currentExpenseNetCents: number; // gasto neto del mes de referencia
  averageExpenseNetCents: number; // media de gasto neto de los meses previos con actividad
  monthsCompared: number; // cuantos meses previos entraron en la media
  deltaCents: number; // current - average
  // Variacion relativa en tanto por mil (entero). null si no hay meses previos con
  // actividad o su media es 0 (no se divide por cero).
  deltaPerMille: number | null;
}

// Compara el gasto neto del mes de referencia contra la media de los `monthsBack`
// meses anteriores QUE TUVIERON actividad (ingreso o gasto). Excluir los meses sin
// actividad evita que un historial vacio (perfil nuevo) hunda la media a casi cero.
// Nota: si el mes de referencia es el mes en curso, su gasto es PARCIAL (a fecha de
// hoy) y se compara contra medias de meses completos; el delta queda sesgado a la baja.
// La proyeccion a mes cerrado la da el forecast; la UI debe aclararlo cuando aplique.
// Un mes con gasto y reembolso que se anulan (neto 0, ingreso 0) se considera sin
// actividad y no entra en la media (criterio deliberado).
export function computeComparison(
  allTx: Transaction[],
  anchorISO: string,
  monthsBack: number,
): Comparison {
  // Ventana: mes de referencia + monthsBack previos.
  const series = computeMonthlyEvolution(allTx, anchorISO, monthsBack + 1);
  const current = series[series.length - 1]!;
  const previous = series.slice(0, series.length - 1);
  // Solo meses con actividad real (evita promediar meses vacios de un perfil nuevo).
  const active = previous.filter((m) => m.incomeCents !== 0 || m.expenseNetCents !== 0);
  const monthsCompared = active.length;
  const average =
    monthsCompared > 0
      ? Math.round(active.reduce((s, m) => s + m.expenseNetCents, 0) / monthsCompared)
      : 0;
  const delta = current.expenseNetCents - average;
  const deltaPerMille = average > 0 ? Math.round((delta / average) * 1000) : null;
  return {
    currentExpenseNetCents: current.expenseNetCents,
    averageExpenseNetCents: average,
    monthsCompared,
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

// --- Orquestador puro: todas las metricas del dashboard de una sola carga ---

export interface DashboardParams {
  range: DateRange; // periodo seleccionado (mes en curso por defecto o rango personalizado)
  anchorISO: string; // fecha ancla del mes de referencia (evolucion, comparativa, forecast)
  today?: string; // hoy (inyectable en tests); por defecto el reloj local
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
  hasData: boolean; // hay algun movimiento que cuente en el periodo seleccionado
  summary: IncomeExpenseSummary;
  byCategory: CategorySpend[];
  monthly: MonthPoint[];
  topExpenses: TopExpense[];
  recurring: RecurringExpense[];
  comparison: Comparison;
  forecast: Forecast;
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
    monthsBack = 12,
    topLimit = 5,
    recurringMonthsBack = 6,
    recurringMinMonths = 3,
    recurringLimit = 8,
    comparisonMonthsBack = 3,
  } = params;

  // Acotar una sola vez el conjunto del periodo seleccionado.
  const inPeriod = allTx.filter((t) => isWithinRange(t.date, range));
  const { summary, byCategory } = aggregatePeriod(inPeriod, ctx);
  const hasData = inPeriod.some((t) => countsInStats(t));

  return {
    range,
    anchorMonth: monthKey(anchorISO),
    hasData,
    summary,
    byCategory,
    monthly: computeMonthlyEvolution(allTx, anchorISO, monthsBack),
    topExpenses: computeTopExpenses(inPeriod, ctx, topLimit),
    recurring: computeRecurringExpenses(
      allTx,
      anchorISO,
      recurringMonthsBack,
      recurringMinMonths,
      recurringLimit,
    ),
    comparison: computeComparison(allTx, anchorISO, comparisonMonthsBack),
    forecast: computeForecast(allTx, anchorISO, ctx, today),
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
