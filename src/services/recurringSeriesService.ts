// Servicio de gestion de recurrencias (ampliacion, fase 7). Ver DATA_MODEL seccion 18 y
// FINANCIAL_ALGORITHMS seccion 7. Orquesta el motor de deteccion (puro) y el planificador de
// ocurrencias (puro) contra los repositorios; genera tareas de revision para las anomalias
// (invariante 11: ningun conflicto financiero se resuelve en silencio).
import type {
  RecurringOccurrence,
  RecurringOccurrenceStatus,
  RecurringSeries,
  RecurringSeriesStatus,
  Transaction,
} from '../db/schema';
import { recurringSeriesRepo } from '../db/recurringSeriesRepo';
import { recurringOccurrencesRepo } from '../db/recurringOccurrencesRepo';
import { transactionsRepo } from '../db/transactionsRepo';
import { merchantsRepo } from '../db/merchantsRepo';
import {
  detectRecurringSeriesCandidates,
  isEligibleForRecurringDetection,
  type DetectableTransaction,
  type RecurringSeriesCandidate,
} from './recurringDetectionEngine';
import {
  planOccurrenceSync,
  type PlannerCandidateTransaction,
} from './recurringOccurrencePlanner';
import { upsertOpenReviewItem } from './reviewService';
import { normalizeConcept } from '../lib/dedupe';
import { shiftMonths, todayISO } from '../lib/dates';
import { NotFoundError, ValidationError, requireId, requireProfileId } from '../lib/validation';

// Horizonte por defecto de generacion de ocurrencias futuras (para que el forecast por rango
// pueda sumarlas sin disparar una deteccion/sincronizacion propia). 12 meses cubre cualquier
// rango de forecast razonable (mensual, trimestral, anual).
const DEFAULT_HORIZON_MONTHS = 12;

function toDetectable(t: Transaction): DetectableTransaction {
  return {
    id: t.id,
    date: t.date,
    amountCents: t.amountCents,
    type: t.type,
    concept: t.concept,
    accountId: t.accountId,
    merchantId: t.merchantId,
    normalizedConcept: t.normalizedConcept,
    excludedFromStats: t.excludedFromStats,
    isSplitParent: t.isSplitParent,
    pending: t.pending,
  };
}

// Misma clave que RecurringSeriesCandidate.groupKey (recurringDetectionEngine.groupKeyOf),
// calculada a partir de una serie ya persistida. Como RecurringSeries no guarda el concepto
// normalizado (solo `name`, editable), una serie sin comercio se reconcilia por
// normalizeConcept(name); renombrar una serie sin comercio puede desacoplarla de la deteccion
// futura (limitacion conocida, documentada).
function matchKeyOfSeries(s: Pick<RecurringSeries, 'merchantId' | 'name' | 'direction' | 'accountId'>): string {
  const subject = s.merchantId !== null ? `m:${s.merchantId}` : `c:${normalizeConcept(s.name)}`;
  return `${subject}|${s.direction}|${s.accountId ?? ''}`;
}

// --- Deteccion ---

// Ejecuta el motor de deteccion sobre el historico del perfil y concilia el resultado con las
// series existentes (idempotente, DATA_MODEL seccion 18):
//  - Si ya existe CUALQUIER serie (de cualquier estado) para la misma clave de agrupacion, no se
//    crea una candidata duplicada: si esa serie sigue en 'candidate' se actualizan sus stats
//    (mediana, tolerancias, confianza); si esta activa/pausada/cancelada/posiblemente cancelada
//    se respeta la decision del usuario sin tocarla.
//  - Si no existe ninguna, se crea una serie nueva en estado 'candidate' (nunca se confirma
//    sola) con ocurrencias 'matched' iniciales para el historico que la origino.
async function runDetection(profileId: string): Promise<{ created: number; updated: number }> {
  requireProfileId(profileId);
  const [transactions, existingSeries] = await Promise.all([
    transactionsRepo.list(profileId),
    recurringSeriesRepo.list(profileId),
  ]);
  const candidates = detectRecurringSeriesCandidates(transactions.map(toDetectable));
  const existingByKey = new Map(existingSeries.map((s) => [matchKeyOfSeries(s), s] as const));
  const txById = new Map(transactions.map((t) => [t.id, t] as const));

  let created = 0;
  let updated = 0;
  for (const candidate of candidates) {
    const existing = existingByKey.get(candidate.groupKey);
    if (!existing) {
      const series = await recurringSeriesRepo.create(profileId, {
        merchantId: candidate.merchantId,
        accountId: candidate.accountId,
        name: candidate.name,
        direction: candidate.direction,
        frequency: candidate.frequency,
        interval: candidate.interval,
        expectedAmountCents: candidate.expectedAmountCents,
        amountToleranceCents: candidate.amountToleranceCents,
        amountTolerancePpm: candidate.amountTolerancePpm,
        expectedDayOfWeek: candidate.expectedDayOfWeek,
        expectedDayOfMonth: candidate.expectedDayOfMonth,
        dateToleranceDays: candidate.dateToleranceDays,
        nextExpectedDate: candidate.nextExpectedDate,
        status: 'candidate',
        confidence: candidate.confidence,
        detectionVersion: candidate.detectionVersion,
      });
      await seedHistoricalOccurrences(profileId, series, candidate, txById);
      created++;
      continue;
    }
    if (existing.status === 'candidate') {
      await recurringSeriesRepo.update(profileId, existing.id, {
        expectedAmountCents: candidate.expectedAmountCents,
        amountToleranceCents: candidate.amountToleranceCents,
        amountTolerancePpm: candidate.amountTolerancePpm,
        expectedDayOfWeek: candidate.expectedDayOfWeek,
        expectedDayOfMonth: candidate.expectedDayOfMonth,
        dateToleranceDays: candidate.dateToleranceDays,
        nextExpectedDate: candidate.nextExpectedDate,
        confidence: candidate.confidence,
        detectionVersion: candidate.detectionVersion,
      });
      await seedHistoricalOccurrences(profileId, existing, candidate, txById);
      updated++;
    }
    // Cualquier otro estado (active/paused/possiblyCancelled/cancelled): decision del usuario,
    // no se toca (nunca se re-propone ni se sobrescribe en silencio).
  }
  return { created, updated };
}

// Crea ocurrencias 'matched' para los movimientos que formaron el grupo detectado, si aun no
// existe una ocurrencia para esa fecha esperada (idempotente frente a re-ejecutar la deteccion).
async function seedHistoricalOccurrences(
  profileId: string,
  series: RecurringSeries,
  candidate: RecurringSeriesCandidate,
  txById: ReadonlyMap<string, Transaction>,
): Promise<void> {
  const existingOccurrences = await recurringOccurrencesRepo.listBySeries(profileId, series.id);
  const linkedTxIds = new Set(existingOccurrences.map((o) => o.transactionId).filter((id) => id !== null));
  for (const txId of candidate.transactionIds) {
    if (linkedTxIds.has(txId)) continue;
    const tx = txById.get(txId);
    if (!tx) continue;
    await recurringOccurrencesRepo.create(profileId, {
      seriesId: series.id,
      transactionId: tx.id,
      expectedDate: tx.date,
      expectedAmountCents: series.expectedAmountCents,
      status: 'matched',
    });
  }
}

// --- Gestion (confirmar, editar, pausar, cancelar, excluir, anadir) ---

async function requireOwnedSeries(profileId: string, id: string): Promise<RecurringSeries> {
  const series = await recurringSeriesRepo.getById(profileId, id);
  if (!series) throw new NotFoundError(`RecurringSeries ${id} no existe en el perfil ${profileId}.`);
  return series;
}

async function requireOwnedOccurrence(profileId: string, id: string): Promise<RecurringOccurrence> {
  const occ = await recurringOccurrencesRepo.getById(profileId, id);
  if (!occ) throw new NotFoundError(`RecurringOccurrence ${id} no existe en el perfil ${profileId}.`);
  return occ;
}

// Transiciones validas de estado (FINANCIAL_ALGORITHMS 7.1/7.2). Cualquier otra transicion se
// rechaza explicitamente (sin errores silenciosos).
const ALLOWED_TRANSITIONS: Record<RecurringSeriesStatus, RecurringSeriesStatus[]> = {
  candidate: ['active', 'cancelled'],
  active: ['paused', 'cancelled'],
  paused: ['active', 'cancelled'],
  possiblyCancelled: ['active', 'paused', 'cancelled'],
  cancelled: [],
};

async function transition(
  profileId: string,
  seriesId: string,
  to: RecurringSeriesStatus,
): Promise<RecurringSeries> {
  requireProfileId(profileId);
  requireId(seriesId);
  const series = await requireOwnedSeries(profileId, seriesId);
  if (!ALLOWED_TRANSITIONS[series.status].includes(to)) {
    throw new ValidationError(`No se puede pasar una serie de '${series.status}' a '${to}'.`);
  }
  return recurringSeriesRepo.update(profileId, seriesId, { status: to });
}

// Confirma una candidata (o reactiva una posiblemente cancelada) como serie activa seguida.
// `today` es inyectable (tests); por defecto la fecha real del dispositivo.
async function confirm(
  profileId: string,
  seriesId: string,
  opts: { today?: string } = {},
): Promise<RecurringSeries> {
  const updated = await transition(profileId, seriesId, 'active');
  await syncSeries(profileId, seriesId, opts);
  return updated;
}

async function pause(profileId: string, seriesId: string): Promise<RecurringSeries> {
  return transition(profileId, seriesId, 'paused');
}

async function resume(
  profileId: string,
  seriesId: string,
  opts: { today?: string } = {},
): Promise<RecurringSeries> {
  const updated = await transition(profileId, seriesId, 'active');
  await syncSeries(profileId, seriesId, opts);
  return updated;
}

async function cancel(profileId: string, seriesId: string): Promise<RecurringSeries> {
  return transition(profileId, seriesId, 'cancelled');
}

// "Excluir" una candidata: la sugerencia no es una recurrencia real. Se cancela para que la
// deteccion no vuelva a proponerla (matchKeyOfSeries seguira encontrando esta serie cancelada).
async function excludeCandidate(profileId: string, seriesId: string): Promise<RecurringSeries> {
  return transition(profileId, seriesId, 'cancelled');
}

export type EditableSeriesFields = Partial<
  Pick<
    RecurringSeries,
    | 'name'
    | 'merchantId'
    | 'accountId'
    | 'frequency'
    | 'interval'
    | 'expectedAmountCents'
    | 'amountToleranceCents'
    | 'amountTolerancePpm'
    | 'expectedDayOfWeek'
    | 'expectedDayOfMonth'
    | 'dateToleranceDays'
    | 'nextExpectedDate'
  >
>;

// Valida los campos editables/creables contra las mismas restricciones que los CHECK remotos
// (supabase/migrations 20260717090000_recurring_series_and_occurrences_schema.sql): sin esto,
// una fila local invalida se guardaria sin error y solo fallaria al sincronizar (mensaje
// generico del servidor), un error silencioso a efectos del usuario.
function validateSeriesFields(fields: Partial<CreateManualSeriesInput | EditableSeriesFields>): void {
  if (fields.name !== undefined && (fields.name.trim().length < 1 || fields.name.length > 160)) {
    throw new ValidationError('El nombre de la serie debe tener entre 1 y 160 caracteres.');
  }
  if (fields.interval !== undefined && (!Number.isInteger(fields.interval) || fields.interval < 1)) {
    throw new ValidationError('El intervalo debe ser un entero mayor o igual a 1.');
  }
  if (
    fields.expectedAmountCents !== undefined &&
    (!Number.isInteger(fields.expectedAmountCents) || fields.expectedAmountCents < 0)
  ) {
    throw new ValidationError('expectedAmountCents debe ser un entero en centimos no negativo.');
  }
  if (
    fields.amountToleranceCents !== undefined &&
    (!Number.isInteger(fields.amountToleranceCents) || fields.amountToleranceCents < 0)
  ) {
    throw new ValidationError('amountToleranceCents debe ser un entero en centimos no negativo.');
  }
  if (
    fields.amountTolerancePpm !== undefined &&
    (!Number.isInteger(fields.amountTolerancePpm) || fields.amountTolerancePpm < 0)
  ) {
    throw new ValidationError('amountTolerancePpm debe ser un entero (ppm) no negativo.');
  }
  if (
    fields.dateToleranceDays !== undefined &&
    (!Number.isInteger(fields.dateToleranceDays) || fields.dateToleranceDays < 0)
  ) {
    throw new ValidationError('dateToleranceDays debe ser un entero de dias no negativo.');
  }
  if (
    fields.expectedDayOfWeek !== undefined &&
    fields.expectedDayOfWeek !== null &&
    (!Number.isInteger(fields.expectedDayOfWeek) || fields.expectedDayOfWeek < 0 || fields.expectedDayOfWeek > 6)
  ) {
    throw new ValidationError('expectedDayOfWeek debe ser un entero entre 0 y 6, o null.');
  }
  if (
    fields.expectedDayOfMonth !== undefined &&
    fields.expectedDayOfMonth !== null &&
    (!Number.isInteger(fields.expectedDayOfMonth) || fields.expectedDayOfMonth < 1 || fields.expectedDayOfMonth > 31)
  ) {
    throw new ValidationError('expectedDayOfMonth debe ser un entero entre 1 y 31, o null.');
  }
}

async function edit(profileId: string, seriesId: string, patch: EditableSeriesFields): Promise<RecurringSeries> {
  requireProfileId(profileId);
  requireId(seriesId);
  await requireOwnedSeries(profileId, seriesId);
  validateSeriesFields(patch);
  return recurringSeriesRepo.update(profileId, seriesId, patch);
}

export interface CreateManualSeriesInput {
  name: string;
  merchantId: string | null;
  accountId: string | null;
  direction: RecurringSeries['direction'];
  frequency: RecurringSeries['frequency'];
  interval: number;
  expectedAmountCents: number;
  amountToleranceCents: number;
  amountTolerancePpm: number;
  expectedDayOfWeek: number | null;
  expectedDayOfMonth: number | null;
  dateToleranceDays: number;
  nextExpectedDate: string;
}

// "Anadir" una serie a mano (el usuario conoce una recurrencia que el motor aun no detecto por
// falta de historico). Nace 'active' directamente: la confirmacion manual ES la confirmacion.
async function createManual(profileId: string, input: CreateManualSeriesInput): Promise<RecurringSeries> {
  requireProfileId(profileId);
  validateSeriesFields(input);
  const series = await recurringSeriesRepo.create(profileId, {
    ...input,
    status: 'active',
    confidence: 1000, // confirmada por la persona: confianza maxima, no heuristica
    detectionVersion: 0, // 0 = no proviene del motor de deteccion
  });
  await syncSeries(profileId, series.id);
  return series;
}

// --- Gestion de ocurrencias individuales ---

async function skipOccurrence(profileId: string, occurrenceId: string): Promise<RecurringOccurrence> {
  requireProfileId(profileId);
  requireId(occurrenceId);
  await requireOwnedOccurrence(profileId, occurrenceId);
  return recurringOccurrencesRepo.update(profileId, occurrenceId, { status: 'skipped' });
}

async function completeOccurrenceManually(
  profileId: string,
  occurrenceId: string,
  transactionId: string | null = null,
): Promise<RecurringOccurrence> {
  requireProfileId(profileId);
  requireId(occurrenceId);
  await requireOwnedOccurrence(profileId, occurrenceId);
  return recurringOccurrencesRepo.update(profileId, occurrenceId, {
    status: 'manuallyCompleted',
    transactionId,
  });
}

// "Excluir" un movimiento vinculado por error: se desvincula y la ocurrencia vuelve a quedar
// pendiente de resolucion (expected si aun no vence, missing si ya vencio la ventana).
async function unlinkOccurrenceTransaction(
  profileId: string,
  occurrenceId: string,
  today: string = todayISO(),
): Promise<RecurringOccurrence> {
  requireProfileId(profileId);
  requireId(occurrenceId);
  const occurrence = await requireOwnedOccurrence(profileId, occurrenceId);
  const series = await requireOwnedSeries(profileId, occurrence.seriesId);
  const overdue = daysBetweenSimple(occurrence.expectedDate, today) > series.dateToleranceDays;
  const status: RecurringOccurrenceStatus = overdue ? 'missing' : 'expected';
  return recurringOccurrencesRepo.update(profileId, occurrenceId, { status, transactionId: null });
}

function daysBetweenSimple(aISO: string, bISO: string): number {
  const [ay, am, ad] = aISO.split('-').map(Number) as [number, number, number];
  const [by, bm, bd] = bISO.split('-').map(Number) as [number, number, number];
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

// --- Dividir y fusionar series ---

// Divide una serie en el punto `fromDateISO`: crea una serie nueva que hereda la configuracion
// (para reflejar, p. ej., un cambio de plan/importe estructural) y le reasigna las ocurrencias
// con expectedDate >= fromDateISO. La serie original queda cancelada desde ese punto (su
// nextExpectedDate se limpia): dividir es "aqui termina esta serie, empieza otra".
async function splitSeries(
  profileId: string,
  seriesId: string,
  fromDateISO: string,
  newName?: string,
): Promise<{ original: RecurringSeries; created: RecurringSeries }> {
  requireProfileId(profileId);
  requireId(seriesId);
  const original = await requireOwnedSeries(profileId, seriesId);
  const occurrences = await recurringOccurrencesRepo.listBySeries(profileId, seriesId);
  const toMove = occurrences.filter((o) => o.expectedDate >= fromDateISO).map((o) => o.id);

  const created = await recurringSeriesRepo.create(profileId, {
    merchantId: original.merchantId,
    accountId: original.accountId,
    name: newName ?? `${original.name} (nueva)`,
    direction: original.direction,
    frequency: original.frequency,
    interval: original.interval,
    expectedAmountCents: original.expectedAmountCents,
    amountToleranceCents: original.amountToleranceCents,
    amountTolerancePpm: original.amountTolerancePpm,
    expectedDayOfWeek: original.expectedDayOfWeek,
    expectedDayOfMonth: original.expectedDayOfMonth,
    dateToleranceDays: original.dateToleranceDays,
    nextExpectedDate: fromDateISO,
    status: original.status === 'cancelled' ? 'active' : original.status,
    confidence: original.confidence,
    detectionVersion: original.detectionVersion,
  });

  if (toMove.length > 0) {
    await recurringOccurrencesRepo.reassignSeries(profileId, toMove, created.id);
  }
  const updatedOriginal = await recurringSeriesRepo.update(profileId, seriesId, {
    status: 'cancelled',
    nextExpectedDate: null,
  });
  return { original: updatedOriginal, created };
}

// Fusiona `mergeSeriesId` dentro de `keepSeriesId`: todas las ocurrencias de la absorbida pasan
// a la superviviente y la absorbida se borra (logico). Util cuando la deteccion creo dos
// candidatas para lo que en realidad es una unica recurrencia.
async function mergeSeries(
  profileId: string,
  keepSeriesId: string,
  mergeSeriesId: string,
): Promise<RecurringSeries> {
  requireProfileId(profileId);
  requireId(keepSeriesId);
  requireId(mergeSeriesId);
  if (keepSeriesId === mergeSeriesId) {
    throw new ValidationError('No se puede fusionar una serie consigo misma.');
  }
  await requireOwnedSeries(profileId, keepSeriesId);
  await requireOwnedSeries(profileId, mergeSeriesId);
  const occurrences = await recurringOccurrencesRepo.listBySeries(profileId, mergeSeriesId);
  if (occurrences.length > 0) {
    await recurringOccurrencesRepo.reassignSeries(profileId, occurrences.map((o) => o.id), keepSeriesId);
  }
  await recurringSeriesRepo.remove(profileId, mergeSeriesId);
  return requireOwnedSeries(profileId, keepSeriesId);
}

// --- Sincronizacion de ocurrencias (avance, ausencias, subida de precio) ---

// Movimientos candidatos a resolver ocurrencias de una serie: mismo comercio (o concepto
// normalizado) + direccion + cuenta, elegibles (isEligibleForRecurringDetection) y NO vinculados
// ya a ninguna ocurrencia de NINGUNA serie del perfil (evita que un mismo movimiento resuelva
// dos series a la vez, "no doble conteo").
function candidateTransactionsFor(
  series: RecurringSeries,
  allTransactions: Transaction[],
  linkedTransactionIds: ReadonlySet<string>,
): PlannerCandidateTransaction[] {
  const seriesConcept = series.merchantId === null ? normalizeConcept(series.name) : null;
  return allTransactions
    .filter((t) => isEligibleForRecurringDetection(toDetectable(t)))
    .filter((t) => !linkedTransactionIds.has(t.id))
    .filter((t) => t.type === series.direction)
    .filter((t) => series.accountId === null || t.accountId === series.accountId)
    .filter((t) =>
      series.merchantId !== null ? t.merchantId === series.merchantId : t.normalizedConcept === seriesConcept,
    )
    .map((t) => ({ id: t.id, date: t.date, amountCents: t.amountCents }));
}

// Nucleo de la sincronizacion de UNA serie, dado el estado del perfil YA CARGADO (transacciones
// y ocurrencias de TODAS las series). Separado de `syncSeries`/`syncAllTracked` para que
// sincronizar el perfil entero (decenas de series) haga UNA sola lectura de cada tabla en vez de
// una por serie (evita el patron N+1 que no escala con decenas de miles de movimientos).
async function syncSeriesWithData(
  profileId: string,
  series: RecurringSeries,
  existingOccurrences: RecurringOccurrence[],
  allTransactions: Transaction[],
  linkedTransactionIds: ReadonlySet<string>,
  today: string,
  horizon: string,
): Promise<void> {
  if (series.status !== 'active' && series.status !== 'possiblyCancelled') return;
  if (series.nextExpectedDate === null) return;

  const candidateTransactions = candidateTransactionsFor(series, allTransactions, linkedTransactionIds);
  const plan = planOccurrenceSync({
    series,
    existingOccurrences,
    candidateTransactions,
    referenceDateISO: today,
    horizonDateISO: horizon,
  });

  for (const upsert of plan.upserts) {
    if (upsert.existingId) {
      await recurringOccurrencesRepo.update(profileId, upsert.existingId, {
        status: upsert.status,
        transactionId: upsert.transactionId,
        expectedAmountCents: upsert.expectedAmountCents,
      });
    } else {
      await recurringOccurrencesRepo.create(profileId, {
        seriesId: series.id,
        transactionId: upsert.transactionId,
        expectedDate: upsert.expectedDate,
        expectedAmountCents: upsert.expectedAmountCents,
        status: upsert.status,
      });
    }
  }

  if (plan.nextExpectedDatePatch !== null || plan.statusPatch !== null) {
    await recurringSeriesRepo.update(profileId, series.id, {
      ...(plan.nextExpectedDatePatch !== null ? { nextExpectedDate: plan.nextExpectedDatePatch } : {}),
      ...(plan.statusPatch !== null ? { status: plan.statusPatch } : {}),
    });
  }

  if (plan.anomalies.length > 0) {
    const reasonCodes = [...new Set(plan.anomalies.map((a) => a.type))];
    await upsertOpenReviewItem(profileId, 'recurringAnomaly', 'recurringSeries', series.id, {
      confidence: series.confidence,
      reasonCodes,
      metadata: { events: plan.anomalies },
    });
  }
}

// Avanza UNA serie activa o posiblemente cancelada: resuelve ocurrencias hasta hoy (match o
// ausencia) y genera placeholders 'expected' hasta el horizonte, persistiendo el resultado y
// generando (o resolviendo) la tarea de revision de anomalias correspondiente. Uso puntual (tras
// confirmar/reanudar una serie); para el perfil entero usa syncAllTracked (evita N+1).
async function syncSeries(
  profileId: string,
  seriesId: string,
  opts: { today?: string; horizon?: string } = {},
): Promise<void> {
  requireProfileId(profileId);
  requireId(seriesId);
  const series = await requireOwnedSeries(profileId, seriesId);
  const today = opts.today ?? todayISO();
  const horizon = opts.horizon ?? shiftMonths(today, DEFAULT_HORIZON_MONTHS);

  const [existingOccurrences, allTransactions, allOccurrences] = await Promise.all([
    recurringOccurrencesRepo.listBySeries(profileId, seriesId),
    transactionsRepo.list(profileId),
    recurringOccurrencesRepo.list(profileId),
  ]);
  const linkedTransactionIds = new Set(
    allOccurrences.map((o) => o.transactionId).filter((id): id is string => id !== null),
  );
  await syncSeriesWithData(
    profileId,
    series,
    existingOccurrences,
    allTransactions,
    linkedTransactionIds,
    today,
    horizon,
  );
}

// Avanza todas las series activas/posiblemente canceladas del perfil (llamado al abrir la
// pantalla de recurrencias o el dashboard). UNA sola lectura de transactions/recurringOccurrences
// para todo el perfil (no una por serie); secuencial entre series para no competir por la misma
// transaccion candidata.
async function syncAllTracked(profileId: string, opts: { today?: string; horizon?: string } = {}): Promise<void> {
  requireProfileId(profileId);
  const tracked = await recurringSeriesRepo.listTracked(profileId);
  if (tracked.length === 0) return;

  const today = opts.today ?? todayISO();
  const horizon = opts.horizon ?? shiftMonths(today, DEFAULT_HORIZON_MONTHS);
  const [allTransactions, allOccurrences] = await Promise.all([
    transactionsRepo.list(profileId),
    recurringOccurrencesRepo.list(profileId),
  ]);
  const occurrencesBySeries = new Map<string, RecurringOccurrence[]>();
  for (const o of allOccurrences) {
    const list = occurrencesBySeries.get(o.seriesId);
    if (list) list.push(o);
    else occurrencesBySeries.set(o.seriesId, [o]);
  }
  const linkedTransactionIds = new Set(
    allOccurrences.map((o) => o.transactionId).filter((id): id is string => id !== null),
  );

  for (const series of tracked) {
    await syncSeriesWithData(
      profileId,
      series,
      occurrencesBySeries.get(series.id) ?? [],
      allTransactions,
      linkedTransactionIds,
      today,
      horizon,
    );
  }
}

// --- Consultas para la UI ---

export interface UpcomingCharge {
  occurrenceId: string;
  seriesId: string;
  seriesName: string;
  expectedDate: string;
  expectedAmountCents: number;
  marginLowCents: number;
  marginHighCents: number;
  accountId: string | null;
  categoryId: string | null;
  direction: RecurringSeries['direction'];
  status: RecurringOccurrenceStatus;
  lastAmountCents: number | null;
  // Diferencia (centimos) entre el ultimo importe real conocido y el esperado. null si nunca se
  // ha cobrado.
  variationCents: number | null;
}

// Proximos cobros/ingresos: ocurrencias 'expected' hasta `untilDateISO`, enriquecidas con la
// info de la serie (seccion 4 del alcance: fecha, importe, margen, cuenta, categoria, ultimo,
// variacion, estado). La categoria se deriva del comercio por defecto (si lo hay) o de la
// categoria del ultimo movimiento vinculado; no se persiste en la serie (es una vista derivada).
async function listUpcomingCharges(profileId: string, untilDateISO: string): Promise<UpcomingCharge[]> {
  requireProfileId(profileId);
  // UNA sola lectura de cada tabla para todo el perfil (evita repetir listBySeries por cada
  // ocurrencia proxima, que no escalaria con decenas de miles de movimientos/ocurrencias).
  const [occurrences, allOccurrences, seriesList, transactions, merchants] = await Promise.all([
    recurringOccurrencesRepo.listExpectedUntil(profileId, untilDateISO),
    recurringOccurrencesRepo.list(profileId),
    recurringSeriesRepo.list(profileId),
    transactionsRepo.list(profileId),
    merchantsRepo.list(profileId),
  ]);
  const seriesById = new Map(seriesList.map((s) => [s.id, s] as const));
  const txById = new Map(transactions.map((t) => [t.id, t] as const));
  const merchantById = new Map(merchants.map((m) => [m.id, m] as const));

  // Ultimo movimiento cobrado (matched) por serie, precalculado una vez.
  const lastMatchedBySeries = new Map<string, RecurringOccurrence>();
  for (const o of allOccurrences) {
    if (o.status !== 'matched' || o.transactionId === null) continue;
    const current = lastMatchedBySeries.get(o.seriesId);
    if (!current || o.expectedDate > current.expectedDate) lastMatchedBySeries.set(o.seriesId, o);
  }

  const result: UpcomingCharge[] = [];
  for (const occ of occurrences) {
    const series = seriesById.get(occ.seriesId);
    if (!series || series.status !== 'active') continue;

    const lastMatched = lastMatchedBySeries.get(series.id);
    const lastTx = lastMatched?.transactionId ? txById.get(lastMatched.transactionId) : undefined;
    const lastAmountCents = lastTx ? Math.abs(lastTx.amountCents) : null;
    const categoryId = series.merchantId
      ? (merchantById.get(series.merchantId)?.defaultCategoryId ?? lastTx?.categoryId ?? null)
      : (lastTx?.categoryId ?? null);

    result.push({
      occurrenceId: occ.id,
      seriesId: series.id,
      seriesName: series.name,
      expectedDate: occ.expectedDate,
      expectedAmountCents: series.expectedAmountCents,
      marginLowCents: Math.max(0, series.expectedAmountCents - series.amountToleranceCents),
      marginHighCents: series.expectedAmountCents + series.amountToleranceCents,
      accountId: series.accountId,
      categoryId,
      direction: series.direction,
      status: occ.status,
      lastAmountCents,
      variationCents: lastAmountCents !== null ? lastAmountCents - series.expectedAmountCents : null,
    });
  }
  return result.sort((a, b) => a.expectedDate.localeCompare(b.expectedDate));
}

export const recurringSeriesService = {
  runDetection,
  confirm,
  pause,
  resume,
  cancel,
  excludeCandidate,
  edit,
  createManual,
  skipOccurrence,
  completeOccurrenceManually,
  unlinkOccurrenceTransaction,
  splitSeries,
  mergeSeries,
  syncSeries,
  syncAllTracked,
  listUpcomingCharges,
};
