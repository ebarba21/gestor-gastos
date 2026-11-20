// Planificacion (noviembre 2026): lo que la portada responde mirando hacia delante.
//  1. Disponible seguro hasta el proximo cobro: saldo liquido - recibos pendientes antes del
//     cobro - fondos apartados - aportacion pendiente a objetivos - paga extra apartada - colchon.
//     Se muestra en RANGO (no al centimo) porque los recibos variables cambian y una cifra exacta
//     invita a apurarla hasta el final.
//  2. Prevision de saldo a 90 dias: recibos e ingresos recurrentes + gasto variable y ahorro
//     habituales, con banda de incertidumbre, saldo minimo y riesgo de quedarte en negativo.
//  3. KPIs de resiliencia: meses de colchon, recurrentes al mes, peso de los fijos en tus
//     ingresos, tasa de ahorro a 3 y 12 meses y lo pendiente de recuperar de gastos compartidos.
//  4. Plan flexible sugerido: ingreso habitual - fijos - fondos - objetivos.
//
// Funciones puras y deterministas (hoy inyectable). Centimos enteros. La semantica de ingreso,
// gasto neto, ahorro y transferencias es la de statsService; "fijo" es la de fixedSpend.ts; el
// saldo de una cuenta es el de netWorthService.balancesAtDates.
import type {
  Account,
  Budget,
  Category,
  RecurringOccurrence,
  RecurringSeries,
  Transaction,
} from '../db/schema';
import { accountsRepo } from '../db/accountsRepo';
import { budgetsRepo } from '../db/budgetsRepo';
import { categoriesRepo } from '../db/categoriesRepo';
import { recurringOccurrencesRepo } from '../db/recurringOccurrencesRepo';
import { recurringSeriesRepo } from '../db/recurringSeriesRepo';
import { transactionsRepo } from '../db/transactionsRepo';
import {
  daysBetweenISO,
  daysInMonth,
  monthRange,
  nextPayDate,
  parseISO,
  payDateInMonth,
  shiftDays,
  shiftMonths,
  toISO,
  todayISO,
  type DateRange,
} from '../lib/dates';
import { medianCents } from '../lib/statistics';
import { requireProfileId } from '../lib/validation';
import { aggregatePeriod, buildStatsContext, countsInStats, isRealIncome, netExpenseContribution, type StatsContext } from './statsService';
import { fixedTransactionIdsFrom, isFixedSeries, isFixedTransaction, monthlyEquivalentCents } from './fixedSpend';
import { budgetKindOf, evaluateBudget, type BudgetEvalEnv, type BudgetEvaluation } from './budgetService';
import { balancesAtDates } from './netWorthService';
import { planningSettingsService, type PlanningSettings } from './planningSettings';
import { effectiveAmountTolerance } from './recurringOccurrencePlanner';
import { recurringSeriesService } from './recurringSeriesService';
import type { InsightAlert } from './insightsService';
import { formatCents } from '../lib/money';

// --- Parametros ---

export const FORECAST_HORIZON_DAYS = 90;
// Una paga extra se detecta cuando lo cobrado en el ciclo supera el ingreso habitual en mas de
// este porcentaje.
const EXTRA_PAY_THRESHOLD_PER_MILLE = 250;
// El rango del disponible nunca es mas estrecho que esto (10 EUR) ni que el 5 % de la cifra.
const MIN_RANGE_WIDTH_CENTS = 1000;
const RANGE_ROUNDING_CENTS = 1000;
// Si el proximo cobro detectado queda mas lejos, el disponible se calcula a 31 dias.
const MAX_DAYS_TO_INCOME = 45;

// --- Tipos ---

export interface PlanningInput {
  transactions: Transaction[];
  categories: Category[];
  accounts: Account[];
  series: RecurringSeries[];
  occurrences: RecurringOccurrence[]; // todas las vivas del perfil
  budgets: Budget[]; // activos
  planning: PlanningSettings;
  today?: string;
}

export interface Commitment {
  name: string;
  date: string;
  amountCents: number; // magnitud esperada (positiva)
  highCents: number; // magnitud con el margen de la serie
  seriesId: string | null;
  kind: 'recurring' | 'fund';
}

export type NextIncomeSource = 'series' | 'payDay' | 'monthStart';

export interface SafeToSpend {
  today: string;
  asOf: string; // fecha de los datos: ultimo movimiento registrado (<= hoy)
  dataAgeDays: number;
  nextIncomeDate: string;
  nextIncomeSource: NextIncomeSource;
  nextIncomeName: string | null;
  incomeOverdue: boolean; // el cobro esperado ya deberia haber llegado y no esta registrado
  daysLeft: number; // desde hoy hasta el dia anterior al cobro (>= 1)
  liquidCents: number;
  excludedAccountIds: string[]; // cuentas de objetivos (dinero ya apartado)
  commitments: Commitment[];
  commitmentsCents: number;
  commitmentsHighCents: number;
  fundsEarmarkedCents: number;
  goalsPendingCents: number;
  extraPayReservedCents: number;
  bufferCents: number;
  safeCents: number; // cifra central
  rangeLowCents: number; // rango mostrado (redondeado a 10 EUR hacia abajo)
  rangeHighCents: number;
  perDayLowCents: number | null;
  perDayHighCents: number | null;
}

export interface ForecastEvent {
  date: string;
  name: string;
  amountCents: number; // con signo: + entra, - sale
  kind: 'income' | 'expense' | 'extraPay' | 'fund';
  estimated: boolean; // true si no viene de una recurrencia confirmada
}

export interface ForecastDay {
  date: string;
  centralCents: number;
  lowCents: number; // escenario prudente (mas gasto variable)
  highCents: number; // escenario holgado
}

export type ForecastRisk = 'none' | 'belowBuffer' | 'negative';

export interface BalanceForecast {
  asOf: string;
  startCents: number;
  days: ForecastDay[]; // asOf + 1 .. asOf + horizonte
  events: ForecastEvent[];
  min: { date: string; centralCents: number; lowCents: number } | null;
  firstNegativeDate: string | null; // primer dia con el escenario central < 0
  risk: ForecastRisk;
  incomeAssumed: 'series' | 'payDay' | 'none';
  variableMonthlyCents: number | null; // gasto variable + ahorro habitual (mediana)
  variableMonthlyLowCents: number | null;
  variableMonthlyHighCents: number | null;
}

export interface PlanningKpis {
  liquidCents: number;
  typicalMonthlySpendCents: number | null; // mediana del gasto neto mensual (6 meses)
  runwayMonthsX10: number | null; // meses de colchon x10 (37 = 3,7 meses)
  typicalIncomeCents: number | null; // mediana del ingreso real mensual (6 meses)
  recurringMonthlyCents: number; // recibos fijos activos al mes (anuales / 12, etc.)
  recurringCount: number;
  fixedShareOfIncomePerMille: number | null;
  savingsRate3mPerMille: number | null;
  savingsRate12mPerMille: number | null;
  savingsRateMonthsUsed: { short: number; long: number };
  reimbursablePendingCents: number;
  reimbursablePendingCount: number;
}

export interface FlexPlan {
  typicalIncomeCents: number | null;
  fixedMonthlyCents: number;
  fundsMonthlyCents: number;
  goalsMonthlyCents: number;
  suggestedFlexCents: number | null; // null sin ingreso habitual
}

export interface ExtraPayInfo {
  detected: boolean;
  excessCents: number; // lo cobrado en el ciclo por encima del ingreso habitual
  cycleFrom: string;
}

export interface PlanningResult {
  safe: SafeToSpend;
  forecast: BalanceForecast;
  kpis: PlanningKpis;
  flex: FlexPlan;
  extraPay: ExtraPayInfo;
  evaluations: BudgetEvaluation[]; // objetivos y fondos evaluados (para la UI)
}

// --- Utilidades ---

function floorTo(value: number, step: number): number {
  return Math.floor(value / step) * step;
}

function lastCompleteMonths(today: string, count: number): DateRange[] {
  const out: DateRange[] = [];
  for (let i = count; i >= 1; i--) out.push(monthRange(shiftMonths(monthRange(today).from, -i)));
  return out;
}

function inRange(txs: readonly Transaction[], r: DateRange): Transaction[] {
  return txs.filter((t) => t.date >= r.from && t.date <= r.to);
}

// Ingreso real de cada mes completo reciente (solo meses con ingreso).
function monthlyIncomes(txs: readonly Transaction[], ctx: StatsContext, months: DateRange[]): number[] {
  const out: number[] = [];
  for (const r of months) {
    let inc = 0;
    for (const t of inRange(txs, r)) if (countsInStats(t) && isRealIncome(t, ctx)) inc += t.amountCents;
    if (inc > 0) out.push(inc);
  }
  return out;
}

// Gasto neto mensual de meses con actividad.
function monthlyNetSpends(txs: readonly Transaction[], ctx: StatsContext, months: DateRange[]): number[] {
  const out: number[] = [];
  for (const r of months) {
    const inMonth = inRange(txs, r);
    if (!inMonth.some(countsInStats)) continue;
    out.push(aggregatePeriod(inMonth, ctx).summary.expenseNetCents);
  }
  return out;
}

// Gasto variable + aportaciones a ahorro/inversion no vinculadas a recurrencias, por mes.
function monthlyVariableOutflows(
  txs: readonly Transaction[],
  ctx: StatsContext,
  fixedIds: ReadonlySet<string>,
  months: DateRange[],
): number[] {
  const out: number[] = [];
  for (const r of months) {
    const inMonth = inRange(txs, r);
    if (!inMonth.some(countsInStats)) continue;
    let variable = 0;
    for (const t of inMonth) {
      if (isFixedTransaction(t, fixedIds)) continue;
      const c = netExpenseContribution(t, ctx);
      if (c) variable += c.cents;
    }
    const s = aggregatePeriod(inMonth, ctx).summary;
    // Aportaciones a ahorro/inversion que salen de tus cuentas (las vinculadas a recurrencias ya
    // estan en los recibos esperados).
    let savingsFromSeries = 0;
    for (const t of inMonth) {
      if (!isFixedTransaction(t, fixedIds) || !countsInStats(t)) continue;
      if (netExpenseContribution(t, ctx) === null && t.type === 'expense' && t.amountCents < 0) {
        savingsFromSeries += -t.amountCents;
      }
    }
    const savings = Math.max(0, s.savingsContribCents + s.investmentContribCents - savingsFromSeries);
    out.push(Math.max(0, variable) + savings);
  }
  return out;
}

// Cuentas que no cuentan como dinero disponible: las de objetivos por cuenta (dinero apartado).
function goalAccountIds(budgets: readonly Budget[]): Set<string> {
  const ids = new Set<string>();
  for (const b of budgets) {
    if (b.archivedAt !== null) continue;
    if (budgetKindOf(b) === 'goal' && b.scope === 'account' && b.scopeId !== null) ids.add(b.scopeId);
  }
  return ids;
}

// Fecha de los datos: el ultimo movimiento registrado con fecha <= hoy en las cuentas liquidas.
function dataAsOf(txs: readonly Transaction[], accountIds: ReadonlySet<string>, today: string): string {
  let latest: string | null = null;
  for (const t of txs) {
    if (!accountIds.has(t.accountId) || t.date > today) continue;
    if (latest === null || t.date > latest) latest = t.date;
  }
  return latest ?? today;
}

// Serie de ingreso principal: la activa con mayor importe mensual equivalente.
function mainIncomeSeries(series: readonly RecurringSeries[]): RecurringSeries | null {
  let best: RecurringSeries | null = null;
  for (const s of series) {
    if (s.direction !== 'income' || s.status !== 'active') continue;
    if (best === null || monthlyEquivalentCents(s) > monthlyEquivalentCents(best)) best = s;
  }
  return best;
}

// Proximo cobro posterior a `asOf`.
export function resolveNextIncome(
  asOf: string,
  series: readonly RecurringSeries[],
  occurrences: readonly RecurringOccurrence[],
  planning: PlanningSettings,
): { date: string; source: NextIncomeSource; name: string | null } {
  const main = mainIncomeSeries(series);
  if (main) {
    const next = occurrences
      .filter((o) => o.seriesId === main.id && o.status === 'expected' && o.expectedDate > asOf)
      .map((o) => o.expectedDate)
      .sort()[0];
    const fromSeries = next ?? (main.nextExpectedDate !== null && main.nextExpectedDate > asOf ? main.nextExpectedDate : null);
    if (fromSeries) return { date: fromSeries, source: 'series', name: main.name };
  }
  if (planning.payDay !== null) return { date: nextPayDate(asOf, planning.payDay), source: 'payDay', name: null };
  const { y, m } = parseISO(asOf);
  return { date: shiftDays(toISO(y, m, daysInMonth(y, m)), 1), source: 'monthStart', name: null };
}

// Recibos esperados entre asOf (exclusivo) y `until` (exclusivo). Incluye los que ya deberian
// haberse cobrado pero siguen pendientes dentro de su tolerancia de fecha.
function pendingCommitments(
  asOf: string,
  until: string,
  series: readonly RecurringSeries[],
  occurrences: readonly RecurringOccurrence[],
): Commitment[] {
  const byId = new Map(series.map((s) => [s.id, s] as const));
  const out: Commitment[] = [];
  for (const o of occurrences) {
    if (o.status !== 'expected') continue;
    const s = byId.get(o.seriesId);
    if (!s || s.status !== 'active' || s.direction !== 'expense') continue;
    const lateFrom = shiftDays(asOf, -s.dateToleranceDays);
    if (o.expectedDate >= until || o.expectedDate < lateFrom) continue;
    const amount = Math.abs(o.expectedAmountCents || s.expectedAmountCents);
    out.push({
      name: s.name,
      date: o.expectedDate <= asOf ? shiftDays(asOf, 1) : o.expectedDate,
      amountCents: amount,
      highCents: amount + effectiveAmountTolerance(s),
      seriesId: s.id,
      kind: 'recurring',
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

// --- Calculo principal ---

export function computePlanning(input: PlanningInput): PlanningResult {
  const today = input.today ?? todayISO();
  parseISO(today);
  const ctx = buildStatsContext(input.categories, input.transactions);
  const matched = input.occurrences.filter((o) => o.status === 'matched');
  const fixedIds = fixedTransactionIdsFrom(input.series, matched);
  const activeBudgets = input.budgets.filter((b) => b.archivedAt === null);
  const excluded = goalAccountIds(activeBudgets);
  const liquidAccounts = input.accounts.filter((a) => !excluded.has(a.id));
  const liquidIds = new Set(liquidAccounts.map((a) => a.id));

  // Objetivos y fondos evaluados a hoy.
  const env: BudgetEvalEnv = { allTx: input.transactions, ctx, fixedIds, accounts: input.accounts, planning: input.planning };
  const evaluations = activeBudgets
    .filter((b) => {
      const k = budgetKindOf(b);
      return (k === 'goal' || k === 'fund') && b.customStart !== null && b.customEnd !== null;
    })
    .map((b) => evaluateBudget(b, env, today));
  const fundsEarmarked = evaluations.reduce((s, e) => s + (e.fund?.earmarkedCents ?? 0), 0);
  const goalsPending = evaluations.reduce((s, e) => s + (e.goal?.pendingThisMonthCents ?? 0), 0);

  // Saldo liquido a la fecha de los datos.
  const asOf = dataAsOf(input.transactions, liquidIds, today);
  const liquid = balancesAtDates(liquidAccounts, input.transactions, [asOf])[0]!.totalCents;

  // Ingreso y gasto habituales (6 meses completos).
  const six = lastCompleteMonths(today, 6);
  const incomes = monthlyIncomes(input.transactions, ctx, six);
  const typicalIncome = incomes.length > 0 ? medianCents(incomes) : null;
  const spends = monthlyNetSpends(input.transactions, ctx, six);
  const typicalSpend = spends.length > 0 ? medianCents(spends) : null;

  // 1. Disponible seguro.
  let next = resolveNextIncome(asOf, input.series, input.occurrences, input.planning);
  if (daysBetweenISO(asOf, next.date) > MAX_DAYS_TO_INCOME) {
    next = { date: shiftDays(asOf, 31), source: next.source, name: next.name };
  }
  const commitments = pendingCommitments(asOf, next.date, input.series, input.occurrences);
  const commitmentsCents = commitments.reduce((s, c) => s + c.amountCents, 0);
  const commitmentsHigh = commitments.reduce((s, c) => s + c.highCents, 0);

  // Paga extra: lo cobrado desde el ultimo ciclo por encima del ingreso habitual.
  const cycleFrom = shiftMonths(next.date, -1);
  let cycleIncome = 0;
  for (const t of inRange(input.transactions, { from: cycleFrom, to: asOf })) {
    if (countsInStats(t) && isRealIncome(t, ctx)) cycleIncome += t.amountCents;
  }
  const excess = typicalIncome !== null ? cycleIncome - typicalIncome : 0;
  const extraDetected =
    typicalIncome !== null && typicalIncome > 0 && excess * 1000 > typicalIncome * EXTRA_PAY_THRESHOLD_PER_MILLE;
  const extraPay: ExtraPayInfo = { detected: extraDetected, excessCents: extraDetected ? excess : 0, cycleFrom };
  const extraReserved = extraDetected && input.planning.reserveExtraPay ? Math.max(0, Math.min(excess, liquid)) : 0;

  const buffer = input.planning.safetyBufferCents;
  const deductions = fundsEarmarked + goalsPending + extraReserved + buffer;
  const safeCentral = liquid - commitmentsCents - deductions;
  const safeLow = liquid - commitmentsHigh - deductions;
  const width = Math.max(MIN_RANGE_WIDTH_CENTS, safeCentral - safeLow, Math.round(Math.abs(safeCentral) * 0.05));
  const rangeHigh = floorTo(safeCentral, RANGE_ROUNDING_CENTS);
  let rangeLow = floorTo(safeCentral - width, RANGE_ROUNDING_CENTS);
  if (rangeLow >= rangeHigh) rangeLow = rangeHigh - RANGE_ROUNDING_CENTS;
  const incomeOverdue = next.date <= today;
  const daysLeft = Math.max(1, daysBetweenISO(today, next.date));
  const safe: SafeToSpend = {
    today,
    asOf,
    dataAgeDays: Math.max(0, daysBetweenISO(asOf, today)),
    nextIncomeDate: next.date,
    nextIncomeSource: next.source,
    nextIncomeName: next.name,
    incomeOverdue,
    daysLeft,
    liquidCents: liquid,
    excludedAccountIds: [...excluded],
    commitments,
    commitmentsCents,
    commitmentsHighCents: commitmentsHigh,
    fundsEarmarkedCents: fundsEarmarked,
    goalsPendingCents: goalsPending,
    extraPayReservedCents: extraReserved,
    bufferCents: buffer,
    safeCents: safeCentral,
    rangeLowCents: rangeLow,
    rangeHighCents: rangeHigh,
    perDayLowCents: rangeLow > 0 ? Math.floor(rangeLow / daysLeft) : null,
    perDayHighCents: rangeHigh > 0 ? Math.floor(rangeHigh / daysLeft) : null,
  };

  // 2. Prevision de saldo.
  const forecast = computeBalanceForecast({
    asOf,
    startCents: liquid,
    series: input.series,
    occurrences: input.occurrences,
    planning: input.planning,
    typicalIncome,
    variableMonths: monthlyVariableOutflows(input.transactions, ctx, fixedIds, lastCompleteMonths(today, 3)),
    funds: evaluations,
    buffer,
  });

  // 3. KPIs.
  let recurringMonthly = 0;
  let recurringCount = 0;
  for (const s of input.series) {
    if (!isFixedSeries(s) || s.status !== 'active') continue;
    recurringMonthly += monthlyEquivalentCents(s);
    recurringCount++;
  }
  const rate = (months: DateRange[]): { perMille: number | null; used: number } => {
    let inc = 0;
    let net = 0;
    let used = 0;
    for (const r of months) {
      const inMonth = inRange(input.transactions, r);
      if (!inMonth.some(countsInStats)) continue;
      const s = aggregatePeriod(inMonth, ctx).summary;
      inc += s.incomeCents;
      net += s.netSavingsCents;
      used++;
    }
    return { perMille: inc > 0 ? Math.round((net * 1000) / inc) : null, used };
  };
  const r3 = rate(lastCompleteMonths(today, 3));
  const r12 = rate(lastCompleteMonths(today, 12));
  let reimbursablePending = 0;
  let reimbursableCount = 0;
  const refundsByTarget = new Map<string, number>();
  for (const t of input.transactions) {
    if (t.refundOfId !== null && t.amountCents > 0) {
      refundsByTarget.set(t.refundOfId, (refundsByTarget.get(t.refundOfId) ?? 0) + t.amountCents);
    }
  }
  for (const t of input.transactions) {
    const r = t.reimbursableCents ?? null;
    if (r === null || r <= 0) continue;
    const pending = r - (refundsByTarget.get(t.id) ?? 0);
    if (pending > 0) {
      reimbursablePending += pending;
      reimbursableCount++;
    }
  }
  const kpis: PlanningKpis = {
    liquidCents: liquid,
    typicalMonthlySpendCents: typicalSpend,
    runwayMonthsX10: typicalSpend !== null && typicalSpend > 0 ? Math.floor((Math.max(0, liquid) * 10) / typicalSpend) : null,
    typicalIncomeCents: typicalIncome,
    recurringMonthlyCents: recurringMonthly,
    recurringCount,
    fixedShareOfIncomePerMille:
      typicalIncome !== null && typicalIncome > 0 ? Math.round((recurringMonthly * 1000) / typicalIncome) : null,
    savingsRate3mPerMille: r3.perMille,
    savingsRate12mPerMille: r12.perMille,
    savingsRateMonthsUsed: { short: r3.used, long: r12.used },
    reimbursablePendingCents: reimbursablePending,
    reimbursablePendingCount: reimbursableCount,
  };

  // 4. Plan flexible.
  let fundsMonthly = 0;
  let goalsMonthly = 0;
  for (const e of evaluations) {
    if (e.fund) fundsMonthly += e.fund.monthlyProvisionCents;
    if (e.goal && e.goal.status !== 'met' && e.goal.status !== 'overdue' && e.budget.scope !== 'account') {
      goalsMonthly += e.goal.requiredMonthlyCents;
    }
  }
  const flex: FlexPlan = {
    typicalIncomeCents: typicalIncome,
    fixedMonthlyCents: recurringMonthly,
    fundsMonthlyCents: fundsMonthly,
    goalsMonthlyCents: goalsMonthly,
    suggestedFlexCents:
      typicalIncome === null ? null : floorTo(typicalIncome - recurringMonthly - fundsMonthly - goalsMonthly, 1000),
  };

  return { safe, forecast, kpis, flex, extraPay, evaluations };
}

// --- Prevision de saldo ---

export function computeBalanceForecast(params: {
  asOf: string;
  startCents: number;
  series: readonly RecurringSeries[];
  occurrences: readonly RecurringOccurrence[];
  planning: PlanningSettings;
  typicalIncome: number | null;
  variableMonths: number[];
  funds: readonly BudgetEvaluation[];
  buffer: number;
  horizonDays?: number;
}): BalanceForecast {
  const horizon = params.horizonDays ?? FORECAST_HORIZON_DAYS;
  const end = shiftDays(params.asOf, horizon);
  const byId = new Map(params.series.map((s) => [s.id, s] as const));
  const events: ForecastEvent[] = [];
  let hasIncomeSeries = false;
  for (const o of params.occurrences) {
    if (o.status !== 'expected') continue;
    const s = byId.get(o.seriesId);
    if (!s || s.status !== 'active') continue;
    const lateFrom = shiftDays(params.asOf, -s.dateToleranceDays);
    if (o.expectedDate > end || o.expectedDate < lateFrom) continue;
    const date = o.expectedDate <= params.asOf ? shiftDays(params.asOf, 1) : o.expectedDate;
    const amount = Math.abs(o.expectedAmountCents || s.expectedAmountCents);
    if (s.direction === 'income') hasIncomeSeries = true;
    events.push({
      date,
      name: s.name,
      amountCents: s.direction === 'income' ? amount : -amount,
      kind: s.direction === 'income' ? 'income' : 'expense',
      estimated: false,
    });
  }
  // Sin nomina recurrente confirmada: ingreso habitual en el dia de cobro indicado.
  let incomeAssumed: BalanceForecast['incomeAssumed'] = hasIncomeSeries ? 'series' : 'none';
  if (!hasIncomeSeries && params.planning.payDay !== null && params.typicalIncome !== null && params.typicalIncome > 0) {
    incomeAssumed = 'payDay';
    let d = nextPayDate(params.asOf, params.planning.payDay);
    while (d <= end) {
      events.push({ date: d, name: 'Nomina (estimada)', amountCents: params.typicalIncome, kind: 'income', estimated: true });
      d = nextPayDate(d, params.planning.payDay);
    }
  }
  // Pagas extra en los meses indicados (aprox. un ingreso habitual, en el dia de cobro).
  if (params.typicalIncome !== null && params.typicalIncome > 0 && params.planning.extraPayMonths.length > 0) {
    const payDay = params.planning.payDay ?? 30;
    let cursor = monthRange(shiftDays(params.asOf, 1)).from;
    while (cursor <= end) {
      const { y, m } = parseISO(cursor);
      const date = payDateInMonth(y, m, payDay);
      if (params.planning.extraPayMonths.includes(m) && date > params.asOf && date <= end) {
        events.push({ date, name: 'Paga extra (estimada)', amountCents: params.typicalIncome, kind: 'extraPay', estimated: true });
      }
      cursor = shiftMonths(cursor, 1);
    }
  }
  // Fondos que vencen en el horizonte (si no hay ya un recibo recurrente parecido esas fechas).
  for (const e of params.funds) {
    const f = e.fund;
    if (!f || f.dueDate <= params.asOf || f.dueDate > end) continue;
    const pending = Math.max(0, e.budget.limitCents - f.spentCents);
    if (pending === 0) continue;
    const covered = events.some(
      (ev) =>
        ev.kind === 'expense' &&
        Math.abs(daysBetweenISO(ev.date, f.dueDate)) <= 15 &&
        Math.abs(-ev.amountCents - pending) * 5 <= pending,
    );
    if (!covered) {
      events.push({ date: f.dueDate, name: `${e.budget.name} (fondo)`, amountCents: -pending, kind: 'fund', estimated: true });
    }
  }
  events.sort((a, b) => a.date.localeCompare(b.date) || b.amountCents - a.amountCents);

  // Gasto variable y ahorro habituales, repartidos por dia.
  const vm = params.variableMonths;
  const central = vm.length > 0 ? medianCents(vm) : null;
  const high = vm.length > 0 ? Math.max(...vm) : null; // mas gasto: escenario prudente
  const low = vm.length > 0 ? Math.min(...vm) : null;
  const perDay = (monthly: number | null, date: string) => {
    if (monthly === null) return 0;
    const { y, m } = parseISO(date);
    return monthly / daysInMonth(y, m);
  };

  const days: ForecastDay[] = [];
  let c = params.startCents;
  let lo = params.startCents;
  let hi = params.startCents;
  let i = 0;
  let min: BalanceForecast['min'] = null;
  let firstNegative: string | null = null;
  for (let d = 1; d <= horizon; d++) {
    const date = shiftDays(params.asOf, d);
    let delta = 0;
    while (i < events.length && events[i]!.date <= date) {
      delta += events[i]!.amountCents;
      i++;
    }
    c += delta - perDay(central, date);
    lo += delta - perDay(high, date);
    hi += delta - perDay(low, date);
    const day: ForecastDay = { date, centralCents: Math.round(c), lowCents: Math.round(lo), highCents: Math.round(hi) };
    days.push(day);
    if (min === null || day.centralCents < min.centralCents) {
      min = { date, centralCents: day.centralCents, lowCents: day.lowCents };
    }
    if (firstNegative === null && day.centralCents < 0) firstNegative = date;
  }
  let risk: ForecastRisk = 'none';
  if (min !== null) {
    if (min.centralCents < 0) risk = 'negative';
    else if (min.centralCents < params.buffer || min.lowCents < 0) risk = 'belowBuffer';
  }
  return {
    asOf: params.asOf,
    startCents: params.startCents,
    days,
    events,
    min,
    firstNegativeDate: firstNegative,
    risk,
    incomeAssumed,
    variableMonthlyCents: central,
    variableMonthlyLowCents: low,
    variableMonthlyHighCents: high,
  };
}

// --- Avisos de planificacion ---

function shortDate(iso: string): string {
  const { y, m, d } = parseISO(iso);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

// Avisos que salen de mirar hacia delante: riesgo de saldo negativo o bajo el colchon, cobro que
// no llega, paga extra y gastos compartidos pendientes de cobrar. Explicados con cifras.
export function planningAlerts(p: PlanningResult): InsightAlert[] {
  const alerts: InsightAlert[] = [];
  const f = p.forecast;
  const horizon30 = shiftDays(f.asOf, 30);
  if (f.min !== null && f.min.date <= horizon30 && (f.risk === 'negative' || f.risk === 'belowBuffer')) {
    const date = f.risk === 'negative' && f.firstNegativeDate !== null ? f.firstNegativeDate : f.min.date;
    const day = f.days.find((d) => d.date === date);
    const cause = f.events
      .filter((e) => e.amountCents < 0 && e.date <= date && e.date > f.asOf)
      .sort((a, b) => a.amountCents - b.amountCents)[0];
    const balance = day?.centralCents ?? f.min.centralCents;
    alerts.push({
      id: `forecast-${f.risk}-${date}`,
      severity: f.risk === 'negative' ? 'critical' : 'action',
      title:
        f.risk === 'negative'
          ? `Tu saldo podria quedar en ${formatCents(balance)} el ${shortDate(date)}`
          : `Tu saldo bajara a ${formatCents(f.min.centralCents)} el ${shortDate(f.min.date)}, por debajo de tu colchon`,
      detail:
        (cause ? `Antes llega ${cause.name} (${formatCents(-cause.amountCents)}). ` : '') +
        'Puedes mover dinero desde otra cuenta o revisar los proximos cargos.',
      route: '/recurrencias',
      impactCents: Math.max(0, -balance),
      dueDate: date,
    });
  }
  if (p.safe.incomeOverdue && p.safe.nextIncomeSource === 'series') {
    alerts.push({
      id: `income-overdue-${p.safe.nextIncomeDate}`,
      severity: 'info',
      title: `${p.safe.nextIncomeName ?? 'Tu nomina'} se esperaba el ${shortDate(p.safe.nextIncomeDate)}`,
      detail: 'Aun no esta registrada. Si ya la cobraste, importa el extracto para que el disponible sea correcto.',
      route: '/importar',
    });
  }
  if (p.extraPay.detected) {
    alerts.push({
      id: `extra-pay-${p.extraPay.cycleFrom}`,
      severity: 'action',
      title: `Has cobrado unos ${formatCents(p.extraPay.excessCents)} mas de lo habitual`,
      detail:
        p.safe.extraPayReservedCents > 0
          ? 'Parece una paga extra: no cuenta en tu disponible hasta el proximo cobro. Asignala a un objetivo o a un fondo.'
          : 'Parece una paga extra. Puedes asignarla a un objetivo o a un fondo para que no se diluya en el mes.',
      route: '/presupuestos',
      impactCents: p.extraPay.excessCents,
    });
  }
  if (p.kpis.reimbursablePendingCents > 0) {
    alerts.push({
      id: 'reimbursable-pending',
      severity: 'info',
      title: `Te deben ${formatCents(p.kpis.reimbursablePendingCents)} de ${p.kpis.reimbursablePendingCount} ${
        p.kpis.reimbursablePendingCount === 1 ? 'gasto compartido' : 'gastos compartidos'
      }`,
      detail: 'Cuando llegue el Bizum o la transferencia, enlazalo como reembolso al gasto original.',
      route: '/movimientos',
      impactCents: p.kpis.reimbursablePendingCents,
    });
  }
  return alerts;
}

// --- Servicio (carga aislada por perfil) ---

export const planningService = {
  async compute(profileId: string, params: { today?: string } = {}): Promise<PlanningResult> {
    requireProfileId(profileId);
    // Las ocurrencias futuras de las recurrencias activas (placeholders 'expected') son la base de
    // los recibos pendientes y de la prevision: se refrescan antes (idempotente).
    await recurringSeriesService.syncAllTracked(profileId, { today: params.today });
    const [transactions, categories, accounts, series, occurrences, budgets, planning] = await Promise.all([
      transactionsRepo.list(profileId),
      categoriesRepo.list(profileId),
      accountsRepo.list(profileId),
      recurringSeriesRepo.list(profileId),
      recurringOccurrencesRepo.list(profileId),
      budgetsRepo.listActive(profileId),
      planningSettingsService.get(profileId),
    ]);
    return computePlanning({ transactions, categories, accounts, series, occurrences, budgets, planning, today: params.today });
  },
};
