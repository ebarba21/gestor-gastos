// Insights del mes: lo que la portada debe responder en un vistazo.
//  1. Ritmo: cuanto gasto VARIABLE queda frente a tu referencia (mediana de los ultimos meses),
//     a cuanto por dia, y la curva acumulada frente a la linea de ritmo ideal. Los gastos fijos
//     (movimientos vinculados a recurrencias confirmadas) quedan fuera para que la curva no se
//     dispare el dia que llega el recibo.
//  2. Categorias frente a su media (barra + raya de la media).
//  3. Lo que ha cambiado: alertas accionables y explicadas con cifras.
//  4. Cascada del mes: ingresos, fijos, variables, ahorro neto y su reparto.
//  5. Calendario de gasto diario frente a tu media diaria.
//  6. Flujo del dinero (Sankey): de donde viene y a donde va.
//  7. Resumen narrado del mes.
//  8. Salud de los datos: frescura por cuenta, categorizacion, bandeja y conciliaciones.
//
// Funciones puras y deterministas (hoy inyectable). Centimos enteros. Toda la semantica de gasto
// neto sale de statsService (netExpenseContribution, aggregatePeriod): las cifras cuadran al
// centimo con el resto del dashboard.
import type {
  Account,
  Category,
  ReconciliationStatus,
  ReviewItemType,
  Transaction,
} from '../db/schema';
import { accountsRepo } from '../db/accountsRepo';
import { categoriesRepo } from '../db/categoriesRepo';
import { importBatchesRepo } from '../db/importBatchesRepo';
import { reconciliationsRepo } from '../db/reconciliationsRepo';
import { recurringOccurrencesRepo } from '../db/recurringOccurrencesRepo';
import { recurringSeriesRepo } from '../db/recurringSeriesRepo';
import { reviewItemsRepo } from '../db/reviewItemsRepo';
import { transactionsRepo } from '../db/transactionsRepo';
import { daysInMonth, parseISO, shiftDays, shiftMonths, todayISO, toISO, type DateRange } from '../lib/dates';
import { formatCents } from '../lib/money';
import { medianCents } from '../lib/statistics';
import { requireProfileId } from '../lib/validation';
import {
  aggregatePeriod,
  buildStatsContext,
  countsInStats,
  isRealIncome,
  monthKey,
  netExpenseContribution,
  type IncomeExpenseSummary,
  type StatsContext,
} from './statsService';

// --- Tipos de resultado ---

export interface PaceDay {
  day: number; // 1..dias del mes
  actualCents: number | null; // gasto variable acumulado hasta ese dia (null en dias futuros)
  idealCents: number | null; // ritmo ideal acumulado (null sin referencia)
}

export interface Pace {
  month: string; // YYYY-MM
  isCurrentMonth: boolean;
  daysInMonth: number;
  daysElapsed: number;
  daysLeft: number; // dias que quedan incluido hoy (0 en meses cerrados)
  variableSpentCents: number;
  fixedSpentCents: number;
  // Referencia de gasto variable mensual: mediana de los meses previos con actividad. null si
  // aun no hay historial.
  baselineCents: number | null;
  baselineMonths: number;
  remainingCents: number | null; // referencia - gastado (puede ser negativo)
  perDayCents: number | null; // restante / dias que quedan (solo mes en curso y restante > 0)
  // Gastado - ritmo ideal a estas alturas. < 0 = vas por debajo del ritmo.
  vsPaceCents: number | null;
  days: PaceDay[];
  hasFixedSeries: boolean; // hay recurrencias confirmadas para separar los fijos
}

export type CategoryStatus = 'over' | 'under' | 'normal' | 'new';

export interface CategoryBullet {
  categoryId: string | null;
  currentCents: number; // gasto neto del mes (hasta hoy en el mes en curso)
  averageCents: number; // media mensual completa de los meses de referencia
  averageToDateCents: number; // media prorrateada a los dias transcurridos
  deltaPerMille: number | null; // (actual - media a la fecha) / media a la fecha
  status: CategoryStatus;
}

export type InsightSeverity = 'critical' | 'action' | 'info';

export interface InsightAlert {
  id: string;
  severity: InsightSeverity;
  title: string;
  detail: string; // explicacion con las cifras que lo originan
  route?: string; // pantalla donde resolverlo
  transactionId?: string; // movimiento que lo origina, si es uno
  categoryId?: string | null; // categoria que lo origina, si es una
}

export interface WaterfallStep {
  key: 'income' | 'fixed' | 'variable' | 'netSavings' | 'savings' | 'investment' | 'free';
  label: string;
  cents: number; // con signo: + entra, - sale
  kind: 'start' | 'delta' | 'total' | 'part';
}

export interface HeatmapDay {
  date: string;
  day: number;
  weekday: number; // 0 = lunes .. 6 = domingo
  netCents: number | null; // gasto neto del dia (null en dias futuros)
  level: 0 | 1 | 2 | 3 | 4 | null; // 0 sin gasto .. 4 muy por encima de tu media diaria
}

export interface Heatmap {
  days: HeatmapDay[];
  averageDailyCents: number | null; // media diaria de los 3 meses previos
  zeroSpendDays: number;
  biggestDay: { date: string; netCents: number } | null;
}

export interface SankeyNode {
  name: string;
  kind: 'source' | 'hub' | 'category' | 'savings' | 'investment' | 'free' | 'other';
  categoryId?: string | null;
}

export interface SankeyLink {
  source: number;
  target: number;
  value: number; // centimos > 0
}

export interface MoneyFlow {
  nodes: SankeyNode[];
  links: SankeyLink[];
}

export interface AccountFreshness {
  accountId: string;
  lastMovementDate: string | null;
  daysSinceLastMovement: number | null;
  lastReconciliationDate: string | null;
  lastReconciliationStatus: ReconciliationStatus | null;
  stale: boolean;
}

export interface DataHealth {
  status: 'ok' | 'stale' | 'review';
  headline: string;
  lastImportAt: number | null;
  daysSinceLastImport: number | null;
  latestMovementDate: string | null;
  accounts: AccountFreshness[];
  uncategorizedCount: number; // ultimos 90 dias
  recentMovements: number; // ultimos 90 dias que cuentan en estadisticas
  byRulePerMille: number | null;
  manualPerMille: number | null;
  importPerMille: number | null;
  openReviewCount: number;
  openReviewByType: Partial<Record<ReviewItemType, number>>;
}

export interface MonthInsights {
  month: string;
  range: DateRange; // mes completo
  toDate: DateRange; // mes hasta hoy (o completo si ya cerro)
  summary: IncomeExpenseSummary; // del mes hasta hoy
  pace: Pace;
  categories: CategoryBullet[];
  alerts: InsightAlert[];
  waterfall: WaterfallStep[];
  heatmap: Heatmap;
  flow: MoneyFlow;
  narrative: string[];
  health: DataHealth;
}

export interface InsightsInput {
  transactions: Transaction[];
  categories: Category[];
  accounts: Account[];
  // Movimientos vinculados a una recurrencia de gasto confirmada (gasto fijo).
  fixedTransactionIds: ReadonlySet<string>;
  hasFixedSeries: boolean;
  openReviewCounts: Partial<Record<ReviewItemType, number>>;
  lastImportAt: number | null;
  latestReconciliationByAccount: ReadonlyMap<string, { statementDate: string; status: ReconciliationStatus }>;
  anchorISO: string;
  today?: string;
  // Parametros (por defecto los documentados).
  baselineMonths?: number; // meses previos para la referencia (6)
  heatmapMonths?: number; // meses previos para la media diaria (3)
  staleDays?: number; // dias sin movimientos para avisar (14)
  categoryLimit?: number; // categorias en el desglose (6)
}

// --- Utilidades ---

const OVER_FACTOR_PER_MILLE = 1150; // +15 %
const UNDER_FACTOR_PER_MILLE = 850; // -15 %
const MIN_DELTA_CENTS = 2000; // por debajo de 20 EUR no se avisa
const UNUSUAL_MIN_CENTS = 10000; // gasto inusual: al menos 100 EUR...
const UNUSUAL_FACTOR = 3; // ...y 3 veces la mediana de su categoria

// Dias entre dos fechas YYYY-MM-DD (b - a). Sin zonas horarias: componentes en UTC.
export function daysBetween(a: string, b: string): number {
  const pa = parseISO(a);
  const pb = parseISO(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86400000);
}

// Dia de la semana con lunes = 0.
function weekdayMondayFirst(iso: string): number {
  const { y, m, d } = parseISO(iso);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

function perMille(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part * 1000) / whole) : null;
}

function pct(perMilleValue: number): string {
  return `${Math.round(Math.abs(perMilleValue) / 10)} %`;
}

// Movimiento de gasto fijo: vinculado a una recurrencia, o reembolso de uno vinculado.
function isFixed(t: Transaction, fixedIds: ReadonlySet<string>): boolean {
  return fixedIds.has(t.id) || (t.refundOfId !== null && fixedIds.has(t.refundOfId));
}

function monthBounds(monthKeyValue: string): DateRange {
  const [y, m] = monthKeyValue.split('-').map(Number) as [number, number];
  return { from: toISO(y, m, 1), to: toISO(y, m, daysInMonth(y, m)) };
}

// Meses previos al de referencia (del mas antiguo al mas reciente).
function previousMonthKeys(anchorISO: string, count: number): string[] {
  const keys: string[] = [];
  for (let i = count; i >= 1; i--) keys.push(monthKey(shiftMonths(anchorISO, -i)));
  return keys;
}

interface MonthBuckets {
  variable: number;
  fixed: number;
  byCategory: Map<string | null, number>;
  // Lo mismo pero solo hasta el dia `cutoffDay` del mes ("a estas alturas").
  byCategoryToDay: Map<string | null, number>;
  variableByDay: number[]; // indice 1..31: gasto variable neto de cada dia
  active: boolean; // hubo algun ingreso o gasto que cuente
}

// Agrega por mes, en un unico recorrido, gasto variable, fijo y por categoria (completo y hasta
// el dia de corte).
function bucketByMonth(
  txs: Transaction[],
  ctx: StatsContext,
  fixedIds: ReadonlySet<string>,
  months: ReadonlySet<string>,
  upTo: string | null,
  cutoffDay: number,
): Map<string, MonthBuckets> {
  const out = new Map<string, MonthBuckets>();
  for (const k of months) {
    out.set(k, {
      variable: 0,
      fixed: 0,
      byCategory: new Map(),
      byCategoryToDay: new Map(),
      variableByDay: new Array<number>(32).fill(0),
      active: false,
    });
  }
  for (const t of txs) {
    const k = monthKey(t.date);
    const b = out.get(k);
    if (!b) continue;
    if (upTo !== null && t.date > upTo) continue;
    if (!countsInStats(t)) continue;
    if (isRealIncome(t, ctx)) {
      b.active = true;
      continue;
    }
    const c = netExpenseContribution(t, ctx);
    if (!c) continue;
    b.active = true;
    const day = parseISO(t.date).d;
    if (isFixed(t, fixedIds)) b.fixed += c.cents;
    else {
      b.variable += c.cents;
      b.variableByDay[day]! += c.cents;
    }
    b.byCategory.set(c.rootCategoryId, (b.byCategory.get(c.rootCategoryId) ?? 0) + c.cents);
    if (day <= cutoffDay) {
      b.byCategoryToDay.set(c.rootCategoryId, (b.byCategoryToDay.get(c.rootCategoryId) ?? 0) + c.cents);
    }
  }
  return out;
}

// Curva habitual de gasto variable: para cada dia d, que fraccion del gasto variable del mes
// solias llevar a dia d (media de los meses de referencia). Asi el ritmo ideal respeta tu forma
// real de gastar (p. ej. la compra grande a principio de mes) en lugar de suponer un reparto
// lineal. Sin meses con gasto positivo, reparto lineal. Monotona y termina en 1.
export function typicalSpendShare(months: { variableByDay: number[]; days: number }[], dim: number): number[] {
  const usable = months.filter((m) => m.variableByDay.reduce((s, v) => s + v, 0) > 0);
  const share = new Array<number>(dim + 1).fill(0);
  for (let d = 1; d <= dim; d++) {
    if (usable.length === 0) {
      share[d] = d / dim;
      continue;
    }
    let sum = 0;
    for (const m of usable) {
      const total = m.variableByDay.reduce((s, v) => s + v, 0);
      let cum = 0;
      for (let i = 1; i <= Math.min(d, m.days); i++) cum += m.variableByDay[i]!;
      sum += Math.min(1, Math.max(0, cum / total));
    }
    share[d] = Math.max(share[d - 1]!, sum / usable.length);
  }
  share[dim] = 1;
  return share;
}

// --- Calculo principal ---

export function computeInsights(input: InsightsInput): MonthInsights {
  const today = input.today ?? todayISO();
  const baselineMonths = input.baselineMonths ?? 6;
  const heatmapMonths = input.heatmapMonths ?? 3;
  const staleDays = input.staleDays ?? 14;
  const categoryLimit = input.categoryLimit ?? 6;
  const ctx = buildStatsContext(input.categories, input.transactions);
  const names = new Map(input.categories.map((c) => [c.id, c.name]));
  const catName = (id: string | null) => (id === null ? 'Sin categoría' : names.get(id) ?? 'Categoría');

  const month = monthKey(input.anchorISO);
  const range = monthBounds(month);
  const anchor = parseISO(range.from);
  const now = parseISO(today);
  const dim = daysInMonth(anchor.y, anchor.m);
  const isCurrentMonth = anchor.y === now.y && anchor.m === now.m;
  const isFutureMonth = range.from > today;
  const daysElapsed = isCurrentMonth ? Math.min(now.d, dim) : isFutureMonth ? 0 : dim;
  const toDate: DateRange = { from: range.from, to: isCurrentMonth ? today : range.to };
  const upTo = isCurrentMonth ? today : null;

  const prevKeys = previousMonthKeys(input.anchorISO, Math.max(baselineMonths, heatmapMonths));
  const allKeys = new Set([...prevKeys, month]);
  const buckets = bucketByMonth(input.transactions, ctx, input.fixedTransactionIds, allKeys, upTo, daysElapsed);
  const current = buckets.get(month)!;
  const baselineKeys = prevKeys.slice(-baselineMonths).filter((k) => buckets.get(k)!.active);

  const inMonthToDate = input.transactions.filter((t) => t.date >= toDate.from && t.date <= toDate.to);
  const { summary, byCategory } = aggregatePeriod(inMonthToDate, ctx);

  // 1. Ritmo
  // Referencia: mediana del gasto variable de los meses con actividad. Si es 0 o negativa (todo
  // tu gasto esta marcado como fijo, o las devoluciones superan al gasto) no hay referencia util.
  const baselineMedian =
    baselineKeys.length > 0 ? medianCents(baselineKeys.map((k) => buckets.get(k)!.variable)) : null;
  const baselineCents = baselineMedian !== null && baselineMedian > 0 ? baselineMedian : null;
  const share = typicalSpendShare(
    baselineKeys.map((k) => ({ variableByDay: buckets.get(k)!.variableByDay, days: parseISO(monthBounds(k).to).d })),
    dim,
  );
  const idealAt = (d: number) => (baselineCents === null ? null : Math.round(baselineCents * share[d]!));
  const daysLeft = isCurrentMonth ? dim - daysElapsed + 1 : 0;
  const dailyVariable = new Array<number>(dim + 1).fill(0);
  for (const t of inMonthToDate) {
    if (isFixed(t, input.fixedTransactionIds)) continue;
    const c = netExpenseContribution(t, ctx);
    if (!c) continue;
    dailyVariable[parseISO(t.date).d]! += c.cents;
  }
  const days: PaceDay[] = [];
  let acc = 0;
  for (let d = 1; d <= dim; d++) {
    acc += dailyVariable[d]!;
    days.push({
      day: d,
      actualCents: d <= daysElapsed ? acc : null,
      idealCents: idealAt(d),
    });
  }
  const remainingCents = baselineCents === null ? null : baselineCents - current.variable;
  const pace: Pace = {
    month,
    isCurrentMonth,
    daysInMonth: dim,
    daysElapsed,
    daysLeft,
    variableSpentCents: current.variable,
    fixedSpentCents: current.fixed,
    baselineCents,
    baselineMonths: baselineCents === null ? 0 : baselineKeys.length,
    remainingCents,
    perDayCents:
      remainingCents !== null && remainingCents > 0 && daysLeft > 0 ? Math.floor(remainingCents / daysLeft) : null,
    vsPaceCents: baselineCents === null ? null : current.variable - idealAt(daysElapsed)!,
    days,
    hasFixedSeries: input.hasFixedSeries,
  };

  // 2. Categorias frente a su media
  const catIds = new Set<string | null>([...current.byCategory.keys()]);
  for (const k of baselineKeys) for (const id of buckets.get(k)!.byCategory.keys()) catIds.add(id);
  const bullets: CategoryBullet[] = [];
  for (const id of catIds) {
    const cur = current.byCategory.get(id) ?? 0;
    const avg =
      baselineKeys.length > 0
        ? Math.round(baselineKeys.reduce((s, k) => s + (buckets.get(k)!.byCategory.get(id) ?? 0), 0) / baselineKeys.length)
        : 0;
    // "A estas alturas": lo que solias llevar gastado en esa categoria a dia N (no la media
    // prorrateada por dias, que penaliza los cargos de principio de mes).
    const avgToDate =
      baselineKeys.length > 0
        ? Math.round(
            baselineKeys.reduce((s, k) => s + (buckets.get(k)!.byCategoryToDay.get(id) ?? 0), 0) / baselineKeys.length,
          )
        : 0;
    if (cur <= 0 && avg <= 0) continue;
    let status: CategoryStatus = 'normal';
    if (avgToDate <= 0) status = cur > 0 && baselineKeys.length > 0 ? 'new' : 'normal';
    else if (cur * 1000 > avgToDate * OVER_FACTOR_PER_MILLE && cur - avgToDate >= MIN_DELTA_CENTS) status = 'over';
    else if (cur * 1000 < avgToDate * UNDER_FACTOR_PER_MILLE && avgToDate - cur >= MIN_DELTA_CENTS) status = 'under';
    bullets.push({
      categoryId: id,
      currentCents: cur,
      averageCents: avg,
      averageToDateCents: avgToDate,
      deltaPerMille: avgToDate > 0 ? Math.round(((cur - avgToDate) * 1000) / avgToDate) : null,
      status,
    });
  }
  bullets.sort((a, b) => b.currentCents - a.currentCents || b.averageCents - a.averageCents);
  const categories = bullets.slice(0, categoryLimit);

  // 3. Alertas
  const alerts: InsightAlert[] = [];
  const review = input.openReviewCounts;
  const dupes = review.possibleDuplicate ?? 0;
  if (dupes > 0) {
    alerts.push({
      id: 'review-duplicates',
      severity: 'critical',
      title: dupes === 1 ? '1 posible duplicado por revisar' : `${dupes} posibles duplicados por revisar`,
      detail: 'Si son el mismo cargo, inflan tu gasto y tu saldo.',
      route: '/bandeja',
    });
  }
  const anomalies = review.recurringAnomaly ?? 0;
  if (anomalies > 0) {
    alerts.push({
      id: 'review-recurring',
      severity: 'action',
      title: anomalies === 1 ? '1 aviso en tus recurrencias' : `${anomalies} avisos en tus recurrencias`,
      detail: 'Subidas de precio, cobros que faltan o cobros repetidos.',
      route: '/bandeja',
    });
  }
  for (const b of bullets.filter((x) => x.status === 'over').slice(0, 3)) {
    alerts.push({
      id: `category-over-${b.categoryId ?? 'none'}`,
      severity: 'action',
      title: `${catName(b.categoryId)} va un ${pct(b.deltaPerMille ?? 0)} por encima de tu media`,
      detail: `${formatCents(b.currentCents)} ${isCurrentMonth ? 'hasta hoy' : 'en el mes'} frente a ${formatCents(
        b.averageToDateCents,
      )} de media ${isCurrentMonth ? 'a estas alturas' : 'mensual'}.`,
      categoryId: b.categoryId,
    });
  }
  // Gasto inusual: muy por encima de la mediana de su categoria en los meses de referencia.
  const pastByCategory = new Map<string | null, number[]>();
  const baselineSet = new Set(baselineKeys);
  for (const t of input.transactions) {
    if (t.type !== 'expense' || !baselineSet.has(monthKey(t.date))) continue;
    const c = netExpenseContribution(t, ctx);
    if (!c || c.cents <= 0) continue;
    const list = pastByCategory.get(c.rootCategoryId) ?? [];
    list.push(c.cents);
    pastByCategory.set(c.rootCategoryId, list);
  }
  const unusual: { t: Transaction; cents: number; median: number; categoryId: string | null }[] = [];
  for (const t of inMonthToDate) {
    if (t.type !== 'expense' || isFixed(t, input.fixedTransactionIds)) continue;
    const c = netExpenseContribution(t, ctx);
    if (!c || c.cents < UNUSUAL_MIN_CENTS) continue;
    const past = pastByCategory.get(c.rootCategoryId) ?? [];
    if (past.length < 3) continue;
    const median = medianCents(past);
    if (median > 0 && c.cents >= median * UNUSUAL_FACTOR) {
      unusual.push({ t, cents: c.cents, median, categoryId: c.rootCategoryId });
    }
  }
  unusual.sort((a, b) => b.cents - a.cents);
  for (const u of unusual.slice(0, 2)) {
    alerts.push({
      id: `unusual-${u.t.id}`,
      severity: 'info',
      title: `Gasto inusual: ${u.t.concept} (${formatCents(u.cents)})`,
      detail: `Es ${Math.floor(u.cents / u.median)} veces lo que sueles gastar de una vez en ${catName(
        u.categoryId,
      )} (${formatCents(u.median)}).`,
      transactionId: u.t.id,
      categoryId: u.categoryId,
    });
  }
  const toLink = (review.transferCandidate ?? 0) + (review.refundCandidate ?? 0);
  if (toLink > 0) {
    alerts.push({
      id: 'review-links',
      severity: 'action',
      title: toLink === 1 ? '1 transferencia o reembolso por enlazar' : `${toLink} transferencias o reembolsos por enlazar`,
      detail: 'Sin enlazar, un traspaso entre tus cuentas cuenta como gasto o como gasto positivo.',
      route: '/bandeja',
    });
  }
  const toCategorize = (review.uncategorized ?? 0) + (review.lowConfidenceRule ?? 0);
  if (toCategorize > 0) {
    alerts.push({
      id: 'review-categorize',
      severity: 'action',
      title: toCategorize === 1 ? '1 movimiento sin categoría segura' : `${toCategorize} movimientos sin categoría segura`,
      detail: 'Revísalos para que el desglose por categoría sea fiable.',
      route: '/bandeja',
    });
  }
  const severityOrder: Record<InsightSeverity, number> = { critical: 0, action: 1, info: 2 };
  alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  // 4. Cascada (mes hasta hoy). fijo + variable = gasto neto (misma semantica).
  const freeCents = summary.netSavingsCents - summary.savingsContribCents - summary.investmentContribCents;
  const waterfall: WaterfallStep[] = [
    { key: 'income', label: 'Ingresos', cents: summary.incomeCents, kind: 'start' },
    { key: 'fixed', label: 'Gasto fijo', cents: -current.fixed, kind: 'delta' },
    { key: 'variable', label: 'Gasto variable', cents: -current.variable, kind: 'delta' },
    { key: 'netSavings', label: 'Ahorro neto', cents: summary.netSavingsCents, kind: 'total' },
    { key: 'savings', label: 'Apartado a ahorro', cents: summary.savingsContribCents, kind: 'part' },
    { key: 'investment', label: 'Invertido', cents: summary.investmentContribCents, kind: 'part' },
    { key: 'free', label: 'Queda en cuentas', cents: freeCents, kind: 'part' },
  ];

  // 5. Calendario de gasto diario
  const heatKeys = prevKeys.slice(-heatmapMonths);
  let heatTotal = 0;
  let heatDays = 0;
  for (const k of heatKeys) {
    const b = buckets.get(k)!;
    if (!b.active) continue;
    heatTotal += b.variable + b.fixed;
    const r = monthBounds(k);
    heatDays += parseISO(r.to).d;
  }
  const averageDailyCents = heatDays > 0 ? Math.round(heatTotal / heatDays) : null;
  const dailyAll = new Array<number>(dim + 1).fill(0);
  for (const t of inMonthToDate) {
    const c = netExpenseContribution(t, ctx);
    if (c) dailyAll[parseISO(t.date).d]! += c.cents;
  }
  const heatmapDays: HeatmapDay[] = [];
  let zeroSpendDays = 0;
  let biggestDay: Heatmap['biggestDay'] = null;
  for (let d = 1; d <= dim; d++) {
    const date = toISO(anchor.y, anchor.m, d);
    const future = d > daysElapsed;
    const net = future ? null : dailyAll[d]!;
    let level: HeatmapDay['level'] = null;
    if (net !== null) {
      if (net <= 0) {
        level = 0;
        zeroSpendDays++;
      } else if (averageDailyCents === null || averageDailyCents <= 0) level = 2;
      else if (net < averageDailyCents * 0.5) level = 1;
      else if (net < averageDailyCents) level = 2;
      else if (net < averageDailyCents * 2) level = 3;
      else level = 4;
      if (net > 0 && (biggestDay === null || net > biggestDay.netCents)) biggestDay = { date, netCents: net };
    }
    heatmapDays.push({ date, day: d, weekday: weekdayMondayFirst(date), netCents: net, level });
  }
  const heatmap: Heatmap = { days: heatmapDays, averageDailyCents, zeroSpendDays, biggestDay };

  // 6. Flujo del dinero
  const flow = buildMoneyFlow(summary, byCategory, catName);

  // 8. Salud de los datos (antes del resumen, que la menciona)
  const health = computeDataHealth(input, today, staleDays);

  // 7. Resumen narrado
  const narrative = buildNarrative({
    month,
    isCurrentMonth,
    summary,
    pace,
    bullets,
    catName,
  });

  return {
    month,
    range,
    toDate,
    summary,
    pace,
    categories,
    alerts,
    waterfall,
    heatmap,
    flow,
    narrative,
    health,
  };
}

// --- Flujo del dinero (Sankey) ---

export function buildMoneyFlow(
  summary: IncomeExpenseSummary,
  byCategory: { categoryId: string | null; netCents: number }[],
  catName: (id: string | null) => string,
  maxCategories = 7,
): MoneyFlow {
  const positives = byCategory.filter((c) => c.netCents > 0).sort((a, b) => b.netCents - a.netCents);
  const negatives = byCategory.filter((c) => c.netCents < 0).reduce((s, c) => s - c.netCents, 0);
  const shown = positives.slice(0, maxCategories);
  const rest = positives.slice(maxCategories).reduce((s, c) => s + c.netCents, 0);
  const savings = Math.max(0, summary.savingsContribCents);
  const investment = Math.max(0, summary.investmentContribCents);
  const outflows = positives.reduce((s, c) => s + c.netCents, 0) + savings + investment;
  const inflows = summary.incomeCents + negatives;
  const free = inflows - outflows;

  const nodes: SankeyNode[] = [];
  const links: SankeyLink[] = [];
  const sources: { name: string; value: number }[] = [];
  if (summary.incomeCents > 0) sources.push({ name: 'Ingresos', value: summary.incomeCents });
  if (negatives > 0) sources.push({ name: 'Devoluciones y Bizums', value: negatives });
  if (free < 0) sources.push({ name: 'De tus ahorros', value: -free });
  const targets: { node: SankeyNode; value: number }[] = [];
  for (const c of shown) {
    targets.push({ node: { name: catName(c.categoryId), kind: 'category', categoryId: c.categoryId }, value: c.netCents });
  }
  if (rest > 0) targets.push({ node: { name: 'Otras categorías', kind: 'other' }, value: rest });
  if (savings > 0) targets.push({ node: { name: 'Ahorro', kind: 'savings' }, value: savings });
  if (investment > 0) targets.push({ node: { name: 'Inversión', kind: 'investment' }, value: investment });
  if (free > 0) targets.push({ node: { name: 'Sin gastar', kind: 'free' }, value: free });
  if (sources.length === 0 || targets.length === 0) return { nodes: [], links: [] };

  // Un solo origen: enlaces directos. Varios: pasan por un nodo central para que se lea el total.
  const hubNeeded = sources.length > 1;
  for (const s of sources) nodes.push({ name: s.name, kind: 'source' });
  let hubIndex = -1;
  if (hubNeeded) {
    hubIndex = nodes.length;
    nodes.push({ name: 'Dinero del mes', kind: 'hub' });
    sources.forEach((s, i) => links.push({ source: i, target: hubIndex, value: s.value }));
  }
  const from = hubNeeded ? hubIndex : 0;
  for (const t of targets) {
    const idx = nodes.length;
    nodes.push(t.node);
    links.push({ source: from, target: idx, value: t.value });
  }
  return { nodes, links };
}

// --- Salud de los datos ---

function computeDataHealth(
  input: InsightsInput,
  today: string,
  staleDays: number,
): DataHealth {
  const lastByAccount = new Map<string, string>();
  let latestMovementDate: string | null = null;
  const since = shiftDays(today, -90);
  let recent = 0;
  let uncategorized = 0;
  let byRule = 0;
  let manual = 0;
  let imported = 0;
  for (const t of input.transactions) {
    if (t.parentId === null && t.date <= today) {
      const prev = lastByAccount.get(t.accountId);
      if (prev === undefined || t.date > prev) lastByAccount.set(t.accountId, t.date);
      if (latestMovementDate === null || t.date > latestMovementDate) latestMovementDate = t.date;
    }
    if (!countsInStats(t) || t.date < since || t.date > today) continue;
    if (t.type === 'transfer') continue;
    recent++;
    if (t.categoryId === null && t.subcategoryId === null) {
      uncategorized++;
      continue;
    }
    if (t.categorizedBy === 'rule') byRule++;
    else if (t.categorizedBy === 'manual') manual++;
    else if (t.categorizedBy === 'import') imported++;
  }

  const accounts: AccountFreshness[] = input.accounts
    .filter((a) => a.archivedAt === null)
    .map((a) => {
      const last = lastByAccount.get(a.id) ?? null;
      const days = last === null ? null : daysBetween(last, today);
      const rec = input.latestReconciliationByAccount.get(a.id) ?? null;
      return {
        accountId: a.id,
        lastMovementDate: last,
        daysSinceLastMovement: days,
        lastReconciliationDate: rec?.statementDate ?? null,
        lastReconciliationStatus: rec?.status ?? null,
        stale: days !== null && days > staleDays,
      };
    })
    .sort((a, b) => (b.daysSinceLastMovement ?? -1) - (a.daysSinceLastMovement ?? -1));

  const openReviewCount = Object.values(input.openReviewCounts).reduce((s, n) => s + (n ?? 0), 0);
  const daysSinceLastImport =
    input.lastImportAt === null
      ? null
      : Math.max(0, daysBetween(isoFromEpoch(input.lastImportAt), today));
  const staleAccounts = accounts.filter((a) => a.stale);
  const status: DataHealth['status'] = staleAccounts.length > 0 ? 'stale' : openReviewCount > 0 ? 'review' : 'ok';
  const daysAgo = (n: number) => (n === 0 ? 'hoy' : n === 1 ? 'ayer' : `hace ${n} días`);
  let headline: string;
  if (latestMovementDate === null) headline = 'Aún no hay movimientos';
  else if (staleAccounts.length === 1) headline = `1 cuenta sin movimientos desde ${daysAgo(staleAccounts[0]!.daysSinceLastMovement!)}`;
  else if (staleAccounts.length > 1) headline = `${staleAccounts.length} cuentas sin movimientos recientes`;
  else headline = `Datos al día · último movimiento ${daysAgo(daysBetween(latestMovementDate, today))}`;

  return {
    status,
    headline,
    lastImportAt: input.lastImportAt,
    daysSinceLastImport,
    latestMovementDate,
    accounts,
    uncategorizedCount: uncategorized,
    recentMovements: recent,
    byRulePerMille: perMille(byRule, recent),
    manualPerMille: perMille(manual, recent),
    importPerMille: perMille(imported, recent),
    openReviewCount,
    openReviewByType: input.openReviewCounts,
  };
}

// Fecha local YYYY-MM-DD de un instante epoch ms (solo para "hace N dias").
function isoFromEpoch(ms: number): string {
  const d = new Date(ms);
  return toISO(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

// --- Resumen narrado ---

const MONTH_NAMES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

function buildNarrative(args: {
  month: string;
  isCurrentMonth: boolean;
  summary: IncomeExpenseSummary;
  pace: Pace;
  bullets: CategoryBullet[];
  catName: (id: string | null) => string;
}): string[] {
  const { month, isCurrentMonth, summary, pace, bullets, catName } = args;
  const monthName = MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? month;
  const lines: string[] = [];
  const spent = summary.expenseNetCents;
  if (spent === 0 && summary.incomeCents === 0) return [`Aún no hay movimientos en ${monthName}.`];

  const verb = isCurrentMonth ? 'llevas' : 'gastaste';
  lines.push(`En ${monthName} ${verb} ${formatCents(spent)} de gasto neto.`);
  if (pace.baselineCents !== null && pace.vsPaceCents !== null) {
    const expected = pace.variableSpentCents - pace.vsPaceCents;
    const rel = expected > 0 ? Math.round((Math.abs(pace.vsPaceCents) * 100) / expected) : null;
    const when = isCurrentMonth ? ' a estas alturas' : '';
    if (rel !== null && rel >= 3) {
      lines.push(`Tu gasto variable va un ${rel} % por ${pace.vsPaceCents < 0 ? 'debajo' : 'encima'} de lo habitual${when}.`);
    } else if (rel !== null) {
      lines.push(`Tu gasto variable va en línea con lo habitual${when}.`);
    }
  }

  const over = bullets.filter((b) => b.status === 'over').sort((a, b) => (b.currentCents - b.averageToDateCents) - (a.currentCents - a.averageToDateCents));
  const under = bullets.filter((b) => b.status === 'under').sort((a, b) => (b.averageToDateCents - b.currentCents) - (a.averageToDateCents - a.currentCents));
  if (over[0]) {
    lines.push(
      `${catName(over[0].categoryId)} sube ${formatCents(over[0].currentCents - over[0].averageToDateCents)} sobre su media.`,
    );
  }
  if (under[0]) {
    lines.push(
      `${catName(under[0].categoryId)} baja ${formatCents(under[0].averageToDateCents - under[0].currentCents)} respecto a su media.`,
    );
  }
  if (pace.fixedSpentCents > 0) lines.push(`Tus gastos fijos suman ${formatCents(pace.fixedSpentCents)}.`);

  if (summary.incomeCents > 0) {
    const rate = summary.savingsRatePerMille !== null ? ` (${(summary.savingsRatePerMille / 10).toFixed(0)} % de tus ingresos)` : '';
    lines.push(
      `Has ingresado ${formatCents(summary.incomeCents)} y tu ahorro neto es de ${formatCents(summary.netSavingsCents)}${rate}.`,
    );
  }
  if (summary.investmentContribCents > 0 || summary.savingsContribCents > 0) {
    const parts: string[] = [];
    if (summary.savingsContribCents > 0) parts.push(`${formatCents(summary.savingsContribCents)} a ahorro`);
    if (summary.investmentContribCents > 0) parts.push(`${formatCents(summary.investmentContribCents)} a inversión`);
    lines.push(`Has apartado ${parts.join(' y ')}.`);
  }
  return lines;
}

// --- Servicio (carga de datos del perfil) ---

export const insightsService = {
  // Aislamiento por diseno: todos los repositorios exigen profileId y no cruzan perfiles.
  async compute(profileId: string, params: { anchorISO: string; today?: string }): Promise<MonthInsights> {
    requireProfileId(profileId);
    const [transactions, categories, accounts, matched, series, openReviewCounts, batches] = await Promise.all([
      transactionsRepo.list(profileId),
      categoriesRepo.list(profileId),
      accountsRepo.list(profileId),
      recurringOccurrencesRepo.listByStatus(profileId, 'matched'),
      recurringSeriesRepo.list(profileId),
      reviewItemsRepo.countOpenByType(profileId),
      importBatchesRepo.listRecent(profileId),
    ]);
    // Gasto fijo: movimientos vinculados a recurrencias de gasto confirmadas (no candidatas).
    // Las semanales (la compra de cada sabado) no son un recibo fijo: se quedan en variable.
    const fixedSeries = new Set(
      series
        .filter((s) => s.direction === 'expense' && s.status !== 'candidate' && s.frequency !== 'weekly')
        .map((s) => s.id),
    );
    const fixedTransactionIds = new Set(
      matched.filter((o) => o.transactionId !== null && fixedSeries.has(o.seriesId)).map((o) => o.transactionId!),
    );
    const latestReconciliationByAccount = new Map<string, { statementDate: string; status: ReconciliationStatus }>();
    await Promise.all(
      accounts.map(async (a) => {
        const r = await reconciliationsRepo.latestForAccount(profileId, a.id);
        if (r) latestReconciliationByAccount.set(a.id, { statementDate: r.statementDate, status: r.status });
      }),
    );
    const committed = batches.filter((b) => b.status === 'committed');
    return computeInsights({
      transactions,
      categories,
      accounts,
      fixedTransactionIds,
      hasFixedSeries: fixedSeries.size > 0,
      openReviewCounts,
      lastImportAt: committed.length > 0 ? committed[0]!.importedAt : null,
      latestReconciliationByAccount,
      anchorISO: params.anchorISO,
      today: params.today,
    });
  },
};
