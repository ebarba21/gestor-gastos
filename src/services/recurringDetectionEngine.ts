// Motor de deteccion de series recurrentes (ampliacion, fase 7). Ver DATA_MODEL seccion 18 y
// FINANCIAL_ALGORITHMS seccion 7.1. MOTOR PURO, determinista, versionado (mismo patron que
// duplicateEngine.ts/transferCandidateEngine.ts/refundCandidateEngine.ts): nunca confirma una
// serie por si solo, solo propone candidatas (status siempre 'candidate' en el resultado).
import type { RecurringDirection, RecurringFrequency } from '../db/schema';
import { parseISO, shiftDays, shiftMonths, shiftYears } from '../lib/dates';
import { medianAbsoluteDeviation, medianCents, medianNumber, mode } from '../lib/statistics';

// Version del algoritmo de deteccion. Cambiar la heuristica incrementa esta version; las series
// ya detectadas conservan la version con la que se generaron (DATA_MODEL seccion 20).
export const RECURRING_DETECTION_VERSION = 1;

// Numero minimo de ocurrencias en un grupo para proponerlo como candidata. Por debajo no hay
// senal suficiente para inferir periodicidad (se necesitan al menos 2 separaciones).
export const MIN_OCCURRENCES_FOR_DETECTION = 3;

// Forma minima de un movimiento que el motor necesita para agrupar y puntuar. Solo campos de
// lectura, sin dependencia de Dexie.
export interface DetectableTransaction {
  id: string;
  date: string; // YYYY-MM-DD
  amountCents: number; // con signo (gasto negativo, ingreso positivo)
  type: 'expense' | 'income' | 'transfer';
  concept: string;
  accountId: string;
  merchantId: string | null;
  normalizedConcept: string;
  excludedFromStats: boolean;
  isSplitParent: boolean;
  pending: boolean;
}

export interface RecurringSeriesCandidate {
  // Clave de agrupacion determinista (merchantId o concepto normalizado + direccion + cuenta).
  // No se persiste en RecurringSeries; la usa el servicio para el emparejamiento idempotente
  // con series ya existentes.
  groupKey: string;
  accountId: string;
  merchantId: string | null;
  name: string;
  direction: RecurringDirection;
  frequency: RecurringFrequency;
  interval: number;
  expectedAmountCents: number;
  amountToleranceCents: number;
  amountTolerancePpm: number;
  expectedDayOfWeek: number | null;
  expectedDayOfMonth: number | null;
  dateToleranceDays: number;
  nextExpectedDate: string;
  confidence: number;
  detectionVersion: number;
  // Movimientos que formaron el grupo, ordenados por fecha ascendente. El llamante los usa para
  // materializar las RecurringOccurrence 'matched' iniciales.
  transactionIds: string[];
}

// Un movimiento entra en la deteccion si es un gasto o ingreso real: no transferencia, no
// excluido de estadisticas (eso ya descarta transferencias y padres de split por diseno del
// modelo, DATA_MODEL seccion 6.4), no padre de split (redundante con excludedFromStats pero
// explicito) y no pendiente (una operacion aun no confirmada no establece patron).
export function isEligibleForRecurringDetection(t: DetectableTransaction): boolean {
  return (
    (t.type === 'expense' || t.type === 'income') &&
    !t.excludedFromStats &&
    !t.isSplitParent &&
    !t.pending
  );
}

// Agrupacion por comercio (o concepto normalizado si no hay comercio), direccion y cuenta
// (FINANCIAL_ALGORITHMS 7.1).
export function groupKeyOf(t: DetectableTransaction): string {
  const subject = t.merchantId !== null ? `m:${t.merchantId}` : `c:${t.normalizedConcept}`;
  return `${subject}|${t.type}|${t.accountId}`;
}

function dayOfWeekUTC(iso: string): number {
  const { y, m, d } = parseISO(iso);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function dayOfMonthOf(iso: string): number {
  return parseISO(iso).d;
}

// Diferencia en dias entre dos fechas YYYY-MM-DD (b - a). Positiva si b es posterior a a.
function daysBetween(aISO: string, bISO: string): number {
  const a = parseISO(aISO);
  const b = parseISO(bISO);
  const ta = Date.UTC(a.y, a.m - 1, a.d);
  const tb = Date.UTC(b.y, b.m - 1, b.d);
  return Math.round((tb - ta) / 86_400_000);
}

const AVG_MONTH_DAYS = 30.4368;
// Intervalo semanal maximo considerado: mas alla de 4 semanas (~28 dias) la separacion se
// interpreta en meses (evita que un multiplo casual de 7 -p. ej. 91 dias = 13 semanas- se
// clasifique como semanal en vez de trimestral).
const MAX_WEEKLY_INTERVAL = 4;

// Clasifica la frecuencia e intervalo a partir de la separacion tipica (mediana) entre fechas
// consecutivas del grupo, en dias. Compara el error de redondear la separacion a semanas enteras
// (hasta 4) frente al error de redondearla a meses enteros, y elige la interpretacion mas
// ajustada; por eso 30 dias se lee como mensual (encaja casi exacto en 1 mes) y 14 como semanal
// interval 2 (encaja exacto en 2 semanas) aunque ambas caigan en un rango de dias similar. Por
// encima del rango semanal se reconoce trimestral/anual cuando la separacion en meses es
// multiplo exacto de 3/12; el resto queda como mensual con el intervalo detectado (p. ej. cada 2
// meses).
export function classifyFrequency(
  medianGapDays: number,
): { frequency: RecurringFrequency; interval: number } {
  const weeklyInterval = Math.max(1, Math.round(medianGapDays / 7));
  const weeklyError = Math.abs(medianGapDays - weeklyInterval * 7);
  const monthGap = Math.max(1, Math.round(medianGapDays / AVG_MONTH_DAYS));
  const monthlyError = Math.abs(medianGapDays - monthGap * AVG_MONTH_DAYS);

  if (weeklyInterval <= MAX_WEEKLY_INTERVAL && weeklyError <= monthlyError) {
    return { frequency: 'weekly', interval: weeklyInterval };
  }
  if (monthGap % 12 === 0) return { frequency: 'yearly', interval: monthGap / 12 };
  if (monthGap % 3 === 0) return { frequency: 'quarterly', interval: monthGap / 3 };
  return { frequency: 'monthly', interval: monthGap };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// Tolerancia de fecha (dias) por frecuencia: suelo y techo para que la dispersion real de las
// fechas (MAD de las separaciones) no produzca una tolerancia irrisoria (jitter de fin de
// semana en pagos semanales) ni desmedida (una tolerancia mayor que el propio periodo).
const DATE_TOLERANCE_BOUNDS: Record<RecurringFrequency, { min: number; max: number }> = {
  weekly: { min: 1, max: 3 },
  monthly: { min: 2, max: 7 },
  quarterly: { min: 3, max: 10 },
  yearly: { min: 5, max: 15 },
};

function nextExpectedDateFrom(
  lastDateISO: string,
  frequency: RecurringFrequency,
  interval: number,
): string {
  switch (frequency) {
    case 'weekly':
      return shiftDays(lastDateISO, 7 * interval);
    case 'monthly':
      return shiftMonths(lastDateISO, interval);
    case 'quarterly':
      return shiftMonths(lastDateISO, interval * 3);
    case 'yearly':
      return shiftYears(lastDateISO, interval);
  }
}

// Puntua un grupo YA agrupado (mismo comercio/concepto, direccion y cuenta) y devuelve la
// candidata, o null si no alcanza el minimo de ocurrencias. Funcion PURA y determinista.
export function scoreRecurringGroup(
  transactions: DetectableTransaction[],
): RecurringSeriesCandidate | null {
  if (transactions.length < MIN_OCCURRENCES_FOR_DETECTION) return null;

  const sorted = [...transactions].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const direction: RecurringDirection = first.type === 'income' ? 'income' : 'expense';

  const amounts = sorted.map((t) => Math.abs(t.amountCents));
  const med = medianCents(amounts);
  const madAmount = medianAbsoluteDeviation(amounts);

  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    gaps.push(daysBetween(sorted[i - 1]!.date, sorted[i]!.date));
  }
  const medianGapDays = medianNumber(gaps);
  const madGapDays = gaps.length > 0 ? medianAbsoluteDeviation(gaps) : 0;

  const { frequency, interval } = classifyFrequency(medianGapDays);

  const minAmountTolerance = Math.max(50, Math.round(med * 0.02));
  const maxAmountTolerance = Math.round(med * 0.5);
  const amountToleranceCents =
    med === 0 ? 0 : clamp(Math.round(madAmount * 1.5), minAmountTolerance, maxAmountTolerance);
  const amountTolerancePpm = med > 0 ? Math.round((amountToleranceCents / med) * 1_000_000) : 0;

  const bounds = DATE_TOLERANCE_BOUNDS[frequency];
  const dateToleranceDays = clamp(Math.round(madGapDays * 1.5), bounds.min, bounds.max);

  const expectedDayOfWeek = frequency === 'weekly' ? mode(sorted.map((t) => dayOfWeekUTC(t.date))) : null;
  const expectedDayOfMonth =
    frequency === 'weekly' ? null : mode(sorted.map((t) => dayOfMonthOf(t.date)));

  // Confianza (0..1000, heuristica orientativa): regularidad de fechas + regularidad de
  // importes + volumen de ocurrencias por encima del minimo. Nunca decide sola la confirmacion
  // (nace 'candidate' siempre); solo ordena/filtra en la UI las sugerencias mas fiables.
  const regularityDate = medianGapDays > 0 ? Math.max(0, 1 - madGapDays / medianGapDays) : 1;
  const regularityAmount = med > 0 ? Math.max(0, 1 - madAmount / med) : madAmount === 0 ? 1 : 0;
  const countFactor = Math.min(1, sorted.length / (MIN_OCCURRENCES_FOR_DETECTION + 3));
  const confidence = Math.round(
    clamp(1000 * (0.4 * regularityDate + 0.4 * regularityAmount + 0.2 * countFactor), 0, 1000),
  );

  return {
    groupKey: groupKeyOf(first),
    accountId: first.accountId,
    merchantId: first.merchantId,
    name: last.concept,
    direction,
    frequency,
    interval,
    expectedAmountCents: med,
    amountToleranceCents,
    amountTolerancePpm,
    expectedDayOfWeek,
    expectedDayOfMonth,
    dateToleranceDays,
    nextExpectedDate: nextExpectedDateFrom(last.date, frequency, interval),
    confidence,
    detectionVersion: RECURRING_DETECTION_VERSION,
    transactionIds: sorted.map((t) => t.id),
  };
}

// Agrupa el historico elegible y puntua cada grupo. No confirma nada (todas las candidatas
// resultan en status 'candidate' cuando el llamante las persiste); es responsabilidad del
// servicio decidir si actualiza una candidata existente o crea una nueva.
export function detectRecurringSeriesCandidates(
  transactions: DetectableTransaction[],
): RecurringSeriesCandidate[] {
  const groups = new Map<string, DetectableTransaction[]>();
  for (const t of transactions) {
    if (!isEligibleForRecurringDetection(t)) continue;
    const key = groupKeyOf(t);
    const list = groups.get(key);
    if (list) list.push(t);
    else groups.set(key, [t]);
  }
  const candidates: RecurringSeriesCandidate[] = [];
  for (const group of groups.values()) {
    const candidate = scoreRecurringGroup(group);
    if (candidate) candidates.push(candidate);
  }
  return candidates.sort((a, b) => b.confidence - a.confidence || a.groupKey.localeCompare(b.groupKey));
}
