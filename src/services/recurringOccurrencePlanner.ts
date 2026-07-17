// Planificador PURO de ocurrencias de una serie recurrente (ampliacion, fase 7). Ver
// FINANCIAL_ALGORITHMS seccion 7.2. Dado el estado actual de una serie ACTIVA, sus ocurrencias
// ya existentes y los movimientos candidatos a resolverlas, decide que ocurrencias crear o
// actualizar, si la serie debe pasar a 'possiblyCancelled' y que anomalias generar. NUNCA borra
// ni resuelve nada en Dexie por si mismo: devuelve un plan que el servicio (recurringSeriesService)
// ejecuta contra los repositorios. Determinista dado el mismo `referenceDateISO`.
import type { RecurringOccurrence, RecurringOccurrenceStatus, RecurringSeries } from '../db/schema';
import { parseISO, shiftDays, shiftMonths, shiftYears } from '../lib/dates';

// Umbrales de subida de precio (FINANCIAL_ALGORITHMS 7.2): hace falta diferencia absoluta Y
// porcentual por encima del umbral para proponer un nuevo importe base (evita ruido por
// redondeos de un centimo).
export const PRICE_INCREASE_MIN_ABS_CENTS = 100;
export const PRICE_INCREASE_MIN_PPM = 30_000; // 3%

// Numero de ausencias CONSECUTIVAS necesarias para marcar la serie como posiblemente cancelada.
// Nunca 1: un unico retraso no es cancelacion (FINANCIAL_ALGORITHMS 7.2).
export const MISSING_STREAK_FOR_POSSIBLY_CANCELLED = 2;

// Cota de iteraciones del bucle de generacion (defensa en profundidad: con una frecuencia
// semanal y un horizonte de 1 ano son ~52 iteraciones; 400 cubre casos extremos sin riesgo de
// bucle infinito por un dato corrupto).
const MAX_PLANNER_ITERATIONS = 400;

export interface PlannerCandidateTransaction {
  id: string;
  date: string; // YYYY-MM-DD
  amountCents: number; // con signo
}

export interface OccurrenceUpsert {
  existingId: string | null; // null = crear
  expectedDate: string;
  expectedAmountCents: number;
  status: RecurringOccurrenceStatus;
  transactionId: string | null;
}

export type RecurringAnomalyType =
  | 'priceIncrease'
  | 'missingExpected'
  | 'possiblyCancelled'
  | 'duplicateOccurrence';

export interface RecurringAnomaly {
  type: RecurringAnomalyType;
  // Fecha esperada de la ocurrencia asociada (ancla legible; el review item referencia la
  // SERIE, DATA_MODEL 16: entityType='recurringSeries').
  expectedDate: string;
  metadata: Record<string, unknown>;
}

export interface OccurrencePlan {
  upserts: OccurrenceUpsert[];
  // Nueva fecha esperada de la serie tras el avance (o null si no cambia).
  nextExpectedDatePatch: string | null;
  // 'possiblyCancelled' si el planificador detecta la racha de ausencias; 'active' si una serie
  // possiblyCancelled vuelve a cobrar (un match rompe la racha: ya no es exacto seguir
  // avisando de posible cancelacion); null = sin cambio.
  statusPatch: 'possiblyCancelled' | 'active' | null;
  anomalies: RecurringAnomaly[];
}

function nextPeriodDate(fromISO: string, series: Pick<RecurringSeries, 'frequency' | 'interval'>): string {
  switch (series.frequency) {
    case 'weekly':
      return shiftDays(fromISO, 7 * series.interval);
    case 'monthly':
      return shiftMonths(fromISO, series.interval);
    case 'quarterly':
      return shiftMonths(fromISO, series.interval * 3);
    case 'yearly':
      return shiftYears(fromISO, series.interval);
  }
}

function daysBetween(aISO: string, bISO: string): number {
  const a = parseISO(aISO);
  const b = parseISO(bISO);
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000);
}

// Amplitud de tolerancia de importe efectiva: el MAYOR de la tolerancia absoluta y la relativa
// (ppm) sobre el importe esperado, igual que otros motores de la app combinan cota absoluta y
// relativa. Exportada para que forecastService pueda construir el margen (lower/upper) de los
// cobros pendientes con el mismo criterio que el emparejamiento.
export function effectiveAmountTolerance(series: RecurringSeries): number {
  const relative = Math.round((series.expectedAmountCents * series.amountTolerancePpm) / 1_000_000);
  return Math.max(series.amountToleranceCents, relative);
}

// Planifica el avance de una serie ACTIVA desde su `nextExpectedDate` hasta cubrir, como
// minimo, `referenceDateISO` (resolviendo match/ausencia) y, como maximo, `horizonDateISO`
// (generando placeholders 'expected' futuros para que el forecast por rango pueda sumarlos sin
// re-ejecutar deteccion). Idempotente: volver a planificar sobre el mismo estado no genera
// duplicados (una ocurrencia ya resuelta -status distinto de 'expected'- se respeta tal cual).
export function planOccurrenceSync(params: {
  series: RecurringSeries;
  existingOccurrences: RecurringOccurrence[]; // todas las vivas de esta serie, cualquier estado
  candidateTransactions: PlannerCandidateTransaction[]; // elegibles, no vinculadas aun
  referenceDateISO: string;
  horizonDateISO: string;
}): OccurrencePlan {
  const { series, existingOccurrences, candidateTransactions, referenceDateISO, horizonDateISO } = params;
  const upserts: OccurrenceUpsert[] = [];
  const anomalies: RecurringAnomaly[] = [];
  const usedTransactionIds = new Set<string>();
  const byDate = new Map(existingOccurrences.map((o) => [o.expectedDate, o] as const));
  const tolerance = effectiveAmountTolerance(series);

  const start = series.nextExpectedDate;
  if (start === null) {
    return { upserts: [], nextExpectedDatePatch: null, statusPatch: null, anomalies: [] };
  }
  let cursor: string = start;

  // Racha de ausencias consecutivas justo antes del cursor (para no declarar posible
  // cancelacion por un unico retraso, FINANCIAL_ALGORITHMS 7.2). Se recalcula segun se generan
  // nuevas 'missing' dentro de este mismo plan.
  const sortedExisting = [...existingOccurrences].sort((a, b) => a.expectedDate.localeCompare(b.expectedDate));
  let missingStreak = 0;
  for (let i = sortedExisting.length - 1; i >= 0; i--) {
    const o = sortedExisting[i]!;
    if (o.status === 'missing') missingStreak++;
    else break;
  }

  let statusPatch: 'possiblyCancelled' | 'active' | null = null;
  // Estado efectivo de la serie segun avanza el plan dentro de esta misma pasada (una racha de
  // ausencias y una recuperacion posterior pueden ocurrir en la misma ejecucion si el horizonte
  // cubre varios periodos sin sincronizar).
  let effectiveStatus: RecurringSeries['status'] = series.status;
  let iterations = 0;
  const horizon = referenceDateISO > horizonDateISO ? referenceDateISO : horizonDateISO;

  while (cursor <= horizon && iterations < MAX_PLANNER_ITERATIONS) {
    iterations++;
    const existing = byDate.get(cursor);

    // Una ocurrencia ya resuelta (matched/missing/skipped/manuallyCompleted) se respeta:
    // idempotencia (volver a ejecutar el plan no la reabre en silencio).
    if (existing && existing.status !== 'expected') {
      cursor = nextPeriodDate(cursor, series);
      continue;
    }

    if (cursor > referenceDateISO) {
      // Futuro (mas alla de hoy): solo se asegura el placeholder 'expected' para que el
      // forecast pueda contarlo; no hay movimiento que lo pueda resolver todavia.
      if (!existing) {
        upserts.push({
          existingId: null,
          expectedDate: cursor,
          expectedAmountCents: series.expectedAmountCents,
          status: 'expected',
          transactionId: null,
        });
      }
      cursor = nextPeriodDate(cursor, series);
      continue;
    }

    // cursor <= referenceDateISO: hay que resolver (match, ausencia, o "aun dentro de la
    // ventana de tolerancia, sigue expected").
    const matches = candidateTransactions
      .filter((t) => !usedTransactionIds.has(t.id))
      .filter((t) => Math.abs(daysBetween(cursor, t.date)) <= series.dateToleranceDays)
      .filter((t) => Math.abs(Math.abs(t.amountCents) - series.expectedAmountCents) <= tolerance)
      .sort((a, b) => {
        const da = Math.abs(daysBetween(cursor, a.date));
        const db_ = Math.abs(daysBetween(cursor, b.date));
        if (da !== db_) return da - db_;
        return (
          Math.abs(Math.abs(a.amountCents) - series.expectedAmountCents) -
          Math.abs(Math.abs(b.amountCents) - series.expectedAmountCents)
        );
      });

    if (matches.length > 0) {
      const best = matches[0]!;
      usedTransactionIds.add(best.id);
      upserts.push({
        existingId: existing?.id ?? null,
        expectedDate: cursor,
        expectedAmountCents: series.expectedAmountCents,
        status: 'matched',
        transactionId: best.id,
      });
      missingStreak = 0;
      // Una serie "posiblemente cancelada" que vuelve a cobrar deja de serlo: no es una
      // decision financiera silenciosa, es corregir un estado derivado (igual que
      // reviewService cierra automaticamente lowConfidenceRule cuando la confianza mejora).
      if (effectiveStatus === 'possiblyCancelled') {
        statusPatch = 'active';
        effectiveStatus = 'active';
      }

      const actual = Math.abs(best.amountCents);
      const absDiff = Math.abs(actual - series.expectedAmountCents);
      const ppmDiff =
        series.expectedAmountCents > 0
          ? Math.round((absDiff / series.expectedAmountCents) * 1_000_000)
          : 0;
      if (absDiff >= PRICE_INCREASE_MIN_ABS_CENTS && ppmDiff >= PRICE_INCREASE_MIN_PPM) {
        // metadata solo lleva la REFERENCIA al movimiento (transactionId), nunca los importes en
        // si (DATA_MODEL seccion 16: "minima; referencias, nunca copia de importes u otros datos
        // financieros completos"). El importe actual y el esperado se resuelven consultando la
        // serie y el movimiento (ya aislados por perfil) en el momento de mostrar/aceptar.
        anomalies.push({
          type: 'priceIncrease',
          expectedDate: cursor,
          metadata: { transactionId: best.id },
        });
      }

      // Duplicado: otro movimiento tambien casaba en la misma ventana. No se vincula (una sola
      // ocurrencia por fecha esperada); se avisa para que la persona decida (posible cobro
      // duplicado, o dos gastos reales coincidentes).
      for (const extra of matches.slice(1)) {
        anomalies.push({
          type: 'duplicateOccurrence',
          expectedDate: cursor,
          metadata: { transactionId: extra.id, matchedTransactionId: best.id },
        });
      }
    } else if (daysBetween(cursor, referenceDateISO) > series.dateToleranceDays) {
      // La ventana de tolerancia ya paso sin aparecer el movimiento: ausencia.
      upserts.push({
        existingId: existing?.id ?? null,
        expectedDate: cursor,
        expectedAmountCents: series.expectedAmountCents,
        status: 'missing',
        transactionId: null,
      });
      missingStreak++;
      anomalies.push({
        type: 'missingExpected',
        expectedDate: cursor,
        metadata: { missingStreak },
      });
      if (missingStreak >= MISSING_STREAK_FOR_POSSIBLY_CANCELLED && effectiveStatus !== 'possiblyCancelled') {
        statusPatch = 'possiblyCancelled';
        effectiveStatus = 'possiblyCancelled';
        anomalies.push({
          type: 'possiblyCancelled',
          expectedDate: cursor,
          metadata: { missingStreak },
        });
      }
    } else {
      // Todavia dentro de la ventana de tolerancia: sigue 'expected', sin anomalia.
      if (!existing) {
        upserts.push({
          existingId: null,
          expectedDate: cursor,
          expectedAmountCents: series.expectedAmountCents,
          status: 'expected',
          transactionId: null,
        });
      }
    }

    cursor = nextPeriodDate(cursor, series);
  }

  // nextExpectedDate debe ser la fecha MINIMA entre las ocurrencias que siguen 'expected' (las
  // aun no resueltas), nunca el cursor donde termino el bucle de generacion de placeholders. Si
  // fuera el cursor final, tras generar de una vez los placeholders hasta el horizonte (p. ej.
  // 12 meses) nextExpectedDate saltaria mas alla de todos ellos y una sincronizacion futura ya
  // no volveria a intentar emparejarlos contra movimientos reales (se quedarian 'expected' para
  // siempre aunque el pago ya hubiera llegado o la ventana ya hubiera pasado). Se calcula sobre
  // la vision fusionada: ocurrencias existentes no tocadas en este plan + los upserts de esta
  // pasada (los upserts prevalecen sobre el estado existente de la misma fecha).
  const finalStatusByDate = new Map<string, RecurringOccurrenceStatus>();
  for (const o of existingOccurrences) finalStatusByDate.set(o.expectedDate, o.status);
  for (const u of upserts) finalStatusByDate.set(u.expectedDate, u.status);
  let earliestExpected: string | null = null;
  for (const [date, status] of finalStatusByDate) {
    if (status !== 'expected') continue;
    if (earliestExpected === null || date < earliestExpected) earliestExpected = date;
  }
  const resolvedNext = earliestExpected ?? (cursor === start ? null : cursor);
  const nextExpectedDatePatch = resolvedNext === start ? null : resolvedNext;
  return { upserts, nextExpectedDatePatch, statusPatch, anomalies };
}
