// Forecast compuesto por rango (ampliacion, fase 7). Ver FINANCIAL_ALGORITHMS seccion 7.3.
// Sustituye la extrapolacion lineal (statsService.computeForecast, seccion 3 "vigente") por una
// formula de componentes separados que reutiliza la MISMA semantica de estadisticas
// (statsService.aggregatePeriod) para el gasto realizado, y anade recurrentes pendientes +
// gasto variable estimado con incertidumbre derivada del historico real (no un porcentaje fijo).
import type { Category, RecurringOccurrence, RecurringSeries, Transaction } from '../db/schema';
import {
  buildStatsContext,
  aggregatePeriod,
  type StatsContext,
} from './statsService';
import { effectiveAmountTolerance } from './recurringOccurrencePlanner';
import { medianNumber } from '../lib/statistics';
import { categoriesRepo } from '../db/categoriesRepo';
import { transactionsRepo } from '../db/transactionsRepo';
import { recurringSeriesRepo } from '../db/recurringSeriesRepo';
import { recurringOccurrencesRepo } from '../db/recurringOccurrencesRepo';
import { recurringSeriesService } from './recurringSeriesService';
import { daysInMonth, isWithinRange, monthRange, parseISO, shiftMonths, todayISO, type DateRange } from '../lib/dates';
import { requireProfileId } from '../lib/validation';

// Numero de meses historicos completos usados para estimar el gasto variable restante.
export const DEFAULT_HISTORY_MONTHS = 3;

export interface ForecastBreakdown {
  realizedCents: number;
  recurringPendingCents: number;
  variableRemainingCents: number;
}

export interface ForecastPendingCharge {
  occurrenceId: string;
  seriesId: string;
  seriesName: string;
  expectedDate: string;
  expectedAmountCents: number;
}

export interface ForecastRangeResult {
  range: DateRange;
  today: string;
  // Componentes del forecast CENTRAL (sin margen), en magnitudes de gasto positivas.
  central: ForecastBreakdown;
  centralTotalCents: number;
  lowerTotalCents: number;
  upperTotalCents: number;
  remainingDays: number;
  totalDaysInRange: number;
  historyMonthsUsed: number;
  historyMonthsRequested: number;
  insufficientHistory: boolean;
  pendingCharges: ForecastPendingCharge[];
  // Ocurrencias recurrentes cuya fecha esperada cae en este rango pero que ya se cobraron con
  // fecha real fuera de el (p. ej. cargo adelantado unos dias): su importe YA esta contado en
  // gasto_realizado del rango al que pertenece esa fecha real (nunca aqui, para no duplicarlo);
  // se listan solo para que la UI pueda explicarlo, nunca ocultarlo.
  settledOutsideRange: ForecastPendingCharge[];
  // Explicacion legible de la metodologia (formula, exclusiones, como se estima cada
  // componente); la muestra la UI como desglose/metodologia (alcance seccion 10).
  methodology: string[];
}

function daysCountInclusive(fromISO: string, toISO: string): number {
  const a = parseISO(fromISO);
  const b = parseISO(toISO);
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000) + 1;
}

function addDaysISO(iso: string, delta: number): string {
  const { y, m, d } = parseISO(iso);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

interface MonthlyVariableSample {
  monthsAgo: number; // 1 = mes completo mas reciente
  dailyAvgCents: number; // gasto variable neto del mes / dias del mes (puede tener decimales)
}

// Gasto "variable" de un mes: gasto neto (misma semantica que stats) EXCLUYENDO los movimientos
// ya vinculados a una ocurrencia recurrente (matched). Lo que queda es el gasto no recurrente:
// la base para estimar lo que falta por gastar en el resto del periodo.
function variableExpenseNetForMonth(
  allTx: Transaction[],
  range: DateRange,
  recurringLinkedIds: ReadonlySet<string>,
  ctx: StatsContext,
): number {
  const monthTx = allTx.filter((t) => isWithinRange(t.date, range) && !recurringLinkedIds.has(t.id));
  return aggregatePeriod(monthTx, ctx).summary.expenseNetCents;
}

// Reduce outliers: si hay 3 o mas meses de muestra, descarta los que se desvian de la mediana
// mas de 2x la desviacion absoluta mediana (MAD). Nunca deja la muestra vacia.
function reduceOutliers(samples: MonthlyVariableSample[]): { kept: MonthlyVariableSample[]; dispersion: number } {
  if (samples.length === 0) return { kept: [], dispersion: 0 };
  const values = samples.map((s) => s.dailyAvgCents);
  const med = medianNumber(values);
  const deviations = values.map((v) => Math.abs(v - med));
  const mad = medianNumber(deviations);
  if (samples.length < 3 || mad === 0) return { kept: samples, dispersion: mad };
  const threshold = med + 2 * mad;
  const kept = samples.filter((s) => s.dailyAvgCents <= threshold);
  return { kept: kept.length > 0 ? kept : samples, dispersion: mad };
}

// Media ponderada (mas peso a los meses recientes: peso = historyMonths - monthsAgo + 1).
function weightedDailyAverage(samples: MonthlyVariableSample[], historyMonths: number): number {
  if (samples.length === 0) return 0;
  let weightedSum = 0;
  let weightTotal = 0;
  for (const s of samples) {
    const weight = Math.max(1, historyMonths - s.monthsAgo + 1);
    weightedSum += s.dailyAvgCents * weight;
    weightTotal += weight;
  }
  return weightTotal > 0 ? weightedSum / weightTotal : 0;
}

// Nucleo PURO del forecast por rango. Recibe todo el estado ya cargado (transacciones,
// categorias, series y ocurrencias) para poder testear sin Dexie. `today` inyectable.
export function computeForecastRange(params: {
  allTransactions: Transaction[];
  categories: Category[];
  recurringSeries: RecurringSeries[];
  recurringOccurrences: RecurringOccurrence[];
  range: DateRange;
  today?: string;
  historyMonths?: number;
}): ForecastRangeResult {
  const {
    allTransactions,
    categories,
    recurringSeries,
    recurringOccurrences,
    range,
    today = todayISO(),
    historyMonths = DEFAULT_HISTORY_MONTHS,
  } = params;
  const ctx = buildStatsContext(categories, allTransactions);

  // --- 1) Gasto realizado: parte del rango que ya ha ocurrido (hasta hoy o hasta el fin del
  // rango si este ya termino). Misma semantica que estadisticas (statsService seccion 3):
  // excluye transferencias/excluidos/splits padre/ahorro-inversion; los reembolsos ya reducen
  // el gasto de su categoria original dentro de este mismo componente.
  const realizedTo = today < range.from ? null : today > range.to ? range.to : today;
  const realizedRange: DateRange | null = realizedTo === null ? null : { from: range.from, to: realizedTo };
  const realizedCents = realizedRange
    ? aggregatePeriod(allTransactions.filter((t) => isWithinRange(t.date, realizedRange)), ctx).summary
        .expenseNetCents
    : 0;

  const totalDaysInRange = daysCountInclusive(range.from, range.to);
  const remainingDays =
    today >= range.to ? 0 : daysCountInclusive(realizedTo === null ? range.from : addDaysISO(today, 1), range.to);

  // --- 2) Recurrentes pendientes del periodo: ocurrencias 'expected' (NO cobradas aun, para no
  // contarlas dos veces con el gasto realizado) de series de GASTO activas, con fecha esperada
  // dentro del rango. El margen usa la tolerancia efectiva de cada serie (igual que el motor de
  // emparejamiento).
  const seriesById = new Map(recurringSeries.map((s) => [s.id, s] as const));
  const pendingCharges: ForecastPendingCharge[] = [];
  let recurringPendingCents = 0;
  let recurringLowerCents = 0;
  let recurringUpperCents = 0;
  for (const occ of recurringOccurrences) {
    if (occ.status !== 'expected') continue;
    if (!isWithinRange(occ.expectedDate, range)) continue;
    const series = seriesById.get(occ.seriesId);
    if (!series || series.status !== 'active' || series.direction !== 'expense') continue;
    recurringPendingCents += occ.expectedAmountCents;
    const tolerance = effectiveAmountTolerance(series);
    recurringLowerCents += Math.max(0, occ.expectedAmountCents - tolerance);
    recurringUpperCents += occ.expectedAmountCents + tolerance;
    pendingCharges.push({
      occurrenceId: occ.id,
      seriesId: series.id,
      seriesName: series.name,
      expectedDate: occ.expectedDate,
      expectedAmountCents: occ.expectedAmountCents,
    });
  }
  pendingCharges.sort((a, b) => a.expectedDate.localeCompare(b.expectedDate));

  // Ocurrencias YA cobradas (matched) cuya fecha esperada cae dentro de este rango pero cuyo
  // movimiento real quedo fuera de `realizedRange` (p. ej. un pago adelantado unos dias por la
  // tolerancia de fecha, cargado a fin del mes anterior): no se suman aqui (ya cuentan en
  // gasto_realizado del rango al que pertenece su fecha real -evita doble conteo entre rangos-),
  // pero se listan de forma explicita para que la persona nunca vea desaparecer un importe del
  // desglose sin explicacion (invariante: nunca perder precision en silencio).
  const txById = new Map(allTransactions.map((t) => [t.id, t] as const));
  const settledOutsideRange: ForecastPendingCharge[] = [];
  for (const occ of recurringOccurrences) {
    if (occ.status !== 'matched' || occ.transactionId === null) continue;
    if (!isWithinRange(occ.expectedDate, range)) continue;
    const series = seriesById.get(occ.seriesId);
    if (!series || series.direction !== 'expense') continue;
    const tx = txById.get(occ.transactionId);
    if (!tx) continue;
    if (realizedRange && isWithinRange(tx.date, realizedRange)) continue; // ya contado aqui, normal
    settledOutsideRange.push({
      occurrenceId: occ.id,
      seriesId: series.id,
      seriesName: series.name,
      expectedDate: occ.expectedDate,
      expectedAmountCents: occ.expectedAmountCents,
    });
  }
  settledOutsideRange.sort((a, b) => a.expectedDate.localeCompare(b.expectedDate));

  // --- 3) Gasto variable restante: historico comparable (ultimos `historyMonths` meses
  // NATURALES completos anteriores a hoy), excluyendo movimientos ya vinculados a una
  // recurrencia, ponderando los mas recientes y reduciendo outliers; escalado a los dias que
  // quedan del rango (uso de "dias comparables": se trabaja en tasa diaria, no en totales
  // mensuales brutos).
  const recurringLinkedIds = new Set(
    recurringOccurrences.map((o) => o.transactionId).filter((id): id is string => id !== null),
  );
  // "Poco historico" significa que NO hay ningun movimiento anterior al rango con el que
  // comparar (perfil nuevo o cuenta recien creada), no que el gasto variable de esos meses
  // resultase en 0 (un mes real sin gasto variable es un dato valido, no una carencia).
  const hasHistoricalActivity = allTransactions.some((t) => t.date < range.from);
  const samples: MonthlyVariableSample[] = [];
  for (let monthsAgo = 1; monthsAgo <= historyMonths; monthsAgo++) {
    const anchor = shiftMonths(today, -monthsAgo);
    const mRange = monthRange(anchor);
    const netCents = variableExpenseNetForMonth(allTransactions, mRange, recurringLinkedIds, ctx);
    const { y, m } = parseISO(mRange.from);
    samples.push({ monthsAgo, dailyAvgCents: netCents / daysInMonth(y, m) });
  }
  const { kept, dispersion } = reduceOutliers(samples);
  const insufficientHistory = !hasHistoricalActivity;
  const weightedDailyAvg = weightedDailyAverage(kept, historyMonths);
  const variableCentral = Math.round(weightedDailyAvg * remainingDays);
  const variableLower = Math.round(Math.max(0, weightedDailyAvg - dispersion) * remainingDays);
  const variableUpper = Math.round((weightedDailyAvg + dispersion) * remainingDays);

  const central: ForecastBreakdown = {
    realizedCents,
    recurringPendingCents,
    variableRemainingCents: insufficientHistory ? 0 : variableCentral,
  };
  const centralTotalCents = central.realizedCents + central.recurringPendingCents + central.variableRemainingCents;
  const lowerTotalCents =
    realizedCents + recurringLowerCents + (insufficientHistory ? 0 : Math.min(variableLower, variableCentral));
  const upperTotalCents =
    realizedCents + recurringUpperCents + (insufficientHistory ? 0 : Math.max(variableUpper, variableCentral));

  const methodology: string[] = [
    'Formula: gasto realizado + recurrentes pendientes del periodo + gasto variable restante estimado.',
    'Gasto realizado: movimientos ya ocurridos en el periodo (hasta hoy), con la misma semantica que las estadisticas (excluye transferencias, movimientos excluidos, padres de split y aportaciones a ahorro/inversion; los reembolsos ya reducen el gasto de su categoria original).',
    'Recurrentes pendientes: ocurrencias esperadas de series de gasto activas dentro del periodo que aun no se han cobrado (las ya cobradas cuentan como gasto realizado, nunca dos veces).',
    insufficientHistory
      ? `Gasto variable restante: sin historico comparable suficiente (se necesitan meses completos anteriores a hoy); se muestra como 0 en vez de inventar precision.`
      : `Gasto variable restante: media ponderada del gasto no recurrente de los ultimos ${kept.length} de ${historyMonths} meses comparables (mas peso a los recientes, outliers reducidos), en tasa diaria, multiplicada por los ${remainingDays} dias que quedan del periodo.`,
    'El rango inferior/superior deriva de la tolerancia real de cada serie recurrente y de la dispersion real del historico variable, no de un porcentaje fijo arbitrario.',
  ];
  if (settledOutsideRange.length > 0) {
    methodology.push(
      `${settledOutsideRange.length} cobro(s) recurrente(s) previsto(s) en este periodo ya se cargaron con fecha real fuera de el (p. ej. unos dias antes); ya cuentan en el gasto realizado del periodo al que pertenece esa fecha real, no aqui, para no duplicarlos (ver desglose "settledOutsideRange").`,
    );
  }

  return {
    range,
    today,
    central,
    centralTotalCents,
    lowerTotalCents,
    upperTotalCents,
    remainingDays,
    totalDaysInRange,
    historyMonthsUsed: insufficientHistory ? 0 : kept.length,
    historyMonthsRequested: historyMonths,
    insufficientHistory,
    pendingCharges,
    settledOutsideRange,
    methodology,
  };
}

// Orquestador: carga todo lo necesario del perfil y sincroniza las series activas antes de
// calcular (para que 'recurrentes pendientes' refleje el estado mas reciente: matches/ausencias
// resueltas hasta hoy y placeholders futuros generados hasta el fin del rango solicitado).
async function computeForRange(
  profileId: string,
  range: DateRange,
  opts: { today?: string; historyMonths?: number } = {},
): Promise<ForecastRangeResult> {
  requireProfileId(profileId);
  const today = opts.today ?? todayISO();
  await recurringSeriesService.syncAllTracked(profileId, { today, horizon: range.to });
  const [allTransactions, categories, recurringSeries, recurringOccurrences] = await Promise.all([
    transactionsRepo.list(profileId),
    categoriesRepo.list(profileId),
    recurringSeriesRepo.list(profileId),
    recurringOccurrencesRepo.list(profileId),
  ]);
  return computeForecastRange({
    allTransactions,
    categories,
    recurringSeries,
    recurringOccurrences,
    range,
    today,
    historyMonths: opts.historyMonths,
  });
}

export const forecastService = {
  computeForRange,
};
