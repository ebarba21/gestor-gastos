// Orquestador de deudas (ampliacion, fase 8). Ver DATA_MODEL seccion 19 y FINANCIAL_ALGORITHMS
// secciones 8-9. Lee/escribe con los repositorios (profileId siempre explicito) y delega TODO
// el calculo en debtAmortizationEngine (nucleo puro, sin Dexie). No es asesoramiento financiero
// personalizado: solo calculo determinista sobre los datos que registra la persona.
import type { Debt, DebtPayment, DebtScenario, DebtStatus, DebtType, ExtraPayment } from '../db/schema';
import { debtsRepo } from '../db/debtsRepo';
import { debtPaymentsRepo } from '../db/debtPaymentsRepo';
import { debtScenariosRepo } from '../db/debtScenariosRepo';
import { transactionsRepo } from '../db/transactionsRepo';
import { transactionService } from './transactionService';
import { db } from '../db/index';
import type { CreateInput, UpdateInput } from '../db/baseRepo';
import {
  buildAmortizationSchedule,
  compareExtraPayments,
  compareStrategies,
  simulateExtraPayments,
  DEBT_CALCULATION_VERSION,
  type CompareStrategiesInput,
  type ExtraPaymentPlan,
  type MultiDebtInput,
  type ScheduleResult,
  type StrategyComparison,
} from './debtAmortizationEngine';
import { assertCents } from '../lib/money';
import { assertPpm } from '../lib/interest';
import { todayISO, shiftMonths } from '../lib/dates';
import { ValidationError, requireProfileId, requireId, requireAccountingDate } from '../lib/validation';

const DEBT_TYPES: DebtType[] = ['personalLoan', 'mortgageFixed', 'card', 'other'];
const DEBT_STATUSES: DebtStatus[] = ['active', 'paidOff', 'archived'];

// Tipos con calendario de amortizacion en esta fase (FINANCIAL_ALGORITHMS 8.1). 'card' se
// registra igual, pero SIN calendario ni participacion en Snowball/Avalanche.
function isAmortizable(type: DebtType): boolean {
  return type !== 'card';
}

// --- Validacion (espejo de los CHECK remotos, defensa en profundidad local) ---

function validateDebtFields(input: {
  name: string;
  type: DebtType;
  currency: string;
  originalPrincipalCents: number;
  outstandingPrincipalCents: number;
  annualRatePpm: number;
  minimumPaymentCents: number;
  status: DebtStatus;
  remainingTermMonths: number | null;
}): void {
  if (input.name.trim().length < 1 || input.name.length > 160) {
    throw new ValidationError('El nombre de la deuda debe tener entre 1 y 160 caracteres.');
  }
  if (!DEBT_TYPES.includes(input.type)) {
    throw new ValidationError(`Tipo de deuda invalido: ${input.type}.`);
  }
  if (input.currency.length !== 3) {
    throw new ValidationError('La moneda debe ser un codigo ISO 4217 de 3 letras.');
  }
  assertCents(input.originalPrincipalCents);
  assertCents(input.outstandingPrincipalCents);
  assertCents(input.minimumPaymentCents);
  assertPpm(input.annualRatePpm);
  if (input.originalPrincipalCents < 0 || input.outstandingPrincipalCents < 0 || input.minimumPaymentCents < 0) {
    throw new ValidationError('Los importes de la deuda no pueden ser negativos.');
  }
  if (!DEBT_STATUSES.includes(input.status)) {
    throw new ValidationError(`Estado de deuda invalido: ${input.status}.`);
  }
  if (
    input.remainingTermMonths !== null &&
    (!Number.isInteger(input.remainingTermMonths) || input.remainingTermMonths < 0)
  ) {
    throw new ValidationError('El plazo restante debe ser un entero >= 0 meses, o nulo.');
  }
}

export type CreateDebtInput = CreateInput<Debt>;
export type UpdateDebtInput = UpdateInput<Debt>;

async function createDebt(profileId: string, input: CreateDebtInput): Promise<Debt> {
  requireProfileId(profileId);
  validateDebtFields(input);
  return debtsRepo.create(profileId, input);
}

async function updateDebt(profileId: string, debtId: string, patch: UpdateDebtInput): Promise<Debt> {
  requireProfileId(profileId);
  requireId(debtId);
  const existing = await debtsRepo.getById(profileId, debtId);
  if (!existing) throw new ValidationError('La deuda no existe en este perfil.');
  const merged = { ...existing, ...patch };
  validateDebtFields(merged);
  return debtsRepo.update(profileId, debtId, patch);
}

async function archiveDebt(profileId: string, debtId: string): Promise<Debt> {
  return updateDebt(profileId, debtId, { status: 'archived' });
}

// --- Calendario y amortizacion anticipada de UNA deuda ---

// Genera el calendario base de una deuda usando la CUOTA REGISTRADA (minimumPaymentCents), no
// una recalculada: una deuda dada de alta a mitad de plazo puede tener una cuota real que no
// coincide exactamente con la formula de anualidad sobre el saldo pendiente actual. Requiere
// `remainingTermMonths` (sin plazo conocido no hay calendario que generar, se explica en la UI).
async function getSchedule(profileId: string, debtId: string): Promise<ScheduleResult> {
  requireProfileId(profileId);
  const debt = await requireDebt(profileId, debtId);
  if (debt.remainingTermMonths === null) {
    throw new ValidationError('La deuda no tiene plazo restante registrado: no se puede generar el calendario.');
  }
  if (!isAmortizable(debt.type)) {
    throw new ValidationError('Las tarjetas (revolving) no tienen calendario de amortizacion en esta fase.');
  }
  return buildAmortizationSchedule({
    principalCents: debt.outstandingPrincipalCents,
    annualRatePpm: debt.annualRatePpm,
    termMonths: debt.remainingTermMonths,
    installmentCents: debt.minimumPaymentCents,
    startDate: debt.nextPaymentDate ?? todayISO(),
  });
}

export interface SimulateDebtExtraInput {
  recurringExtraCents: number;
  oneTimePayments: { period: number; amountCents: number }[];
  mode: ExtraPaymentPlan['mode'];
}

async function simulateDebtExtraPayments(profileId: string, debtId: string, input: SimulateDebtExtraInput) {
  requireProfileId(profileId);
  const debt = await requireDebt(profileId, debtId);
  if (debt.remainingTermMonths === null) {
    throw new ValidationError('La deuda no tiene plazo restante registrado: no se puede simular.');
  }
  if (!isAmortizable(debt.type)) {
    throw new ValidationError('Las tarjetas (revolving) no tienen calendario de amortizacion en esta fase.');
  }
  const baseline = buildAmortizationSchedule({
    principalCents: debt.outstandingPrincipalCents,
    annualRatePpm: debt.annualRatePpm,
    termMonths: debt.remainingTermMonths,
    installmentCents: debt.minimumPaymentCents,
    startDate: debt.nextPaymentDate ?? todayISO(),
  });
  const withExtras = simulateExtraPayments({
    principalCents: debt.outstandingPrincipalCents,
    annualRatePpm: debt.annualRatePpm,
    termMonths: debt.remainingTermMonths,
    baseInstallmentCents: debt.minimumPaymentCents,
    startDate: debt.nextPaymentDate ?? todayISO(),
    plan: {
      recurringExtraCents: input.recurringExtraCents,
      oneTime: input.oneTimePayments,
      mode: input.mode,
    },
  });
  const comparison = compareExtraPayments(baseline, withExtras, debt.remainingTermMonths);
  return { baseline, withExtras, comparison };
}

async function requireDebt(profileId: string, debtId: string): Promise<Debt> {
  const debt = await debtsRepo.getById(profileId, debtId);
  if (!debt) throw new ValidationError('La deuda no existe en este perfil.');
  return debt;
}

// --- Registro de pagos (sin doble conteo, principal/interes/comision separados) ---

export interface RecordPaymentInput {
  date: string;
  totalCents: number;
  principalCents: number;
  interestCents: number;
  feesCents: number;
  extraPrincipalCents: number;
  transactionId: string | null;
}

// Ajusta el movimiento vinculado para que la parte de PRINCIPAL no cuente como gasto de
// consumo en estadisticas, mientras que intereses y comisiones si (DATA_MODEL 19.2, invariante
// explicita: "la reduccion de pasivo no se trata automaticamente como gasto de consumo"). El
// importe del movimiento vinculado debe coincidir EXACTAMENTE (en valor absoluto) con el total
// del pago: si no coincide, se rechaza el vinculo en vez de repartir un importe que no es el
// real (nunca se inventa ni se fuerza un reparto que no cuadra con el movimiento bancario).
//
// Reutiliza el split ya probado (transactionService.splitTransaction) con exclusion por parte
// (extension aditiva de SplitPart para esta fase): principal excluido, interes+comisiones
// cuenta con la categoria original del movimiento. Casos degenerados sin reparto necesario:
// - principal = 0 (pago solo de intereses): el movimiento ya es gasto real completo, no se toca.
// - interes+comisiones = 0 (deuda a tipo 0 sin comisiones): el movimiento se excluye entero.
async function reflectPaymentInLinkedTransaction(
  profileId: string,
  transactionId: string,
  principalCents: number,
  interestCents: number,
  feesCents: number,
): Promise<void> {
  const tx = await transactionsRepo.getById(profileId, transactionId);
  if (!tx) {
    throw new ValidationError('El movimiento a vincular no existe en este perfil.');
  }
  if (tx.transferGroupId !== null) {
    throw new ValidationError('No se puede vincular un pago de deuda a una transferencia.');
  }
  if (tx.parentId !== null) {
    throw new ValidationError('No se puede vincular un pago de deuda a una linea de un split existente.');
  }
  const totalCents = principalCents + interestCents + feesCents;
  if (Math.abs(tx.amountCents) !== totalCents) {
    throw new ValidationError(
      `El importe del movimiento vinculado (${formatCentsForError(tx.amountCents)}) no coincide con el total del pago (${formatCentsForError(totalCents)}). Ajusta el pago o elige otro movimiento.`,
    );
  }
  const sign = tx.amountCents < 0 ? -1 : 1;
  const interestPlusFees = interestCents + feesCents;

  if (principalCents === 0) {
    return; // Solo intereses/comisiones: ya es gasto real completo, no se ajusta nada.
  }
  if (interestPlusFees === 0) {
    await transactionsRepo.update(profileId, transactionId, { excludedFromStats: true });
    return;
  }
  await transactionService.splitTransaction(profileId, transactionId, [
    {
      amountCents: sign * principalCents,
      categoryId: null,
      concept: `${tx.concept} (principal)`,
      excludedFromStats: true,
    },
    {
      amountCents: sign * interestPlusFees,
      categoryId: tx.categoryId,
      subcategoryId: tx.subcategoryId,
      concept: `${tx.concept} (interes/comisiones)`,
      excludedFromStats: false,
    },
  ]);
}

function formatCentsForError(cents: number): string {
  return (Math.abs(cents) / 100).toFixed(2);
}

// Revierte el ajuste de estadisticas hecho por reflectPaymentInLinkedTransaction al desvincular
// un pago: si el movimiento quedo dividido (reparto principal/interes), deshace el split; si
// quedo excluido entero (deuda sin interes), lo devuelve a contar.
async function revertLinkedTransactionStatsAdjustment(profileId: string, transactionId: string): Promise<void> {
  const tx = await transactionsRepo.getById(profileId, transactionId);
  if (!tx) return; // El movimiento ya no existe: nada que revertir.
  if (tx.isSplitParent) {
    await transactionService.unsplitTransaction(profileId, transactionId);
    return;
  }
  if (tx.excludedFromStats) {
    await transactionsRepo.update(profileId, transactionId, { excludedFromStats: false });
  }
}

// Registra un pago: valida la invariante total=principal+interes+comisiones (misma regla que
// el CHECK remoto), evita doble conteo (un mismo transactionId no puede vincularse a dos
// pagos), actualiza el saldo pendiente/plazo/proxima fecha de la deuda, y si se vincula un
// movimiento, ajusta sus estadisticas para que solo intereses/comisiones cuenten como gasto de
// consumo (ver reflectPaymentInLinkedTransaction).
async function recordPayment(profileId: string, debtId: string, input: RecordPaymentInput): Promise<DebtPayment> {
  requireProfileId(profileId);
  requireAccountingDate(input.date);
  assertCents(input.totalCents);
  assertCents(input.principalCents);
  assertCents(input.interestCents);
  assertCents(input.feesCents);
  assertCents(input.extraPrincipalCents);
  if (
    input.totalCents < 0 ||
    input.principalCents < 0 ||
    input.interestCents < 0 ||
    input.feesCents < 0 ||
    input.extraPrincipalCents < 0
  ) {
    throw new ValidationError('Los importes de un pago de deuda no pueden ser negativos.');
  }
  if (input.totalCents !== input.principalCents + input.interestCents + input.feesCents) {
    throw new ValidationError('El pago no cuadra: total debe ser igual a principal + interes + comisiones.');
  }
  if (input.extraPrincipalCents > input.principalCents) {
    throw new ValidationError('La amortizacion extraordinaria no puede superar el principal del pago.');
  }
  const debt = await requireDebt(profileId, debtId);

  // Atomicidad: crear el pago, ajustar el movimiento vinculado (split) y actualizar el saldo
  // de la deuda son escrituras relacionadas que deben confirmarse o revertirse juntas (nunca un
  // pago "huerfano" sin que la deuda refleje su saldo, ni una deuda actualizada sin su pago).
  // Dexie anida transacciones: al declarar aqui todas las tablas que tocan los repositorios
  // internos (baseRepo, transactionsRepo), sus `db.transaction(...)` propios reutilizan ESTA
  // misma transaccion en vez de abrir otra independiente.
  return db.transaction('rw', [db.debtPayments, db.debts, db.transactions, db.profiles, db.outbox], async () => {
    if (input.transactionId !== null) {
      const alreadyLinked = await debtPaymentsRepo.findByTransactionId(profileId, input.transactionId);
      if (alreadyLinked) {
        throw new ValidationError('Ese movimiento ya esta vinculado a otro pago de esta deuda: evita el doble conteo.');
      }
      // Se ajusta ANTES de crear el pago: si el importe no coincide (o el movimiento no es
      // vinculable), se rechaza el vinculo entero en vez de dejar un pago creado a medias.
      await reflectPaymentInLinkedTransaction(
        profileId,
        input.transactionId,
        input.principalCents,
        input.interestCents,
        input.feesCents,
      );
    }

    const payment = await debtPaymentsRepo.create(profileId, {
      debtId,
      date: input.date,
      totalCents: input.totalCents,
      principalCents: input.principalCents,
      interestCents: input.interestCents,
      feesCents: input.feesCents,
      extraPrincipalCents: input.extraPrincipalCents,
      transactionId: input.transactionId,
    });

    const newOutstanding = Math.max(0, debt.outstandingPrincipalCents - input.principalCents);
    const newRemainingTerm =
      debt.remainingTermMonths === null ? null : Math.max(0, debt.remainingTermMonths - 1);
    const paidOff = newOutstanding === 0;
    await debtsRepo.update(profileId, debtId, {
      outstandingPrincipalCents: newOutstanding,
      remainingTermMonths: newRemainingTerm,
      nextPaymentDate:
        paidOff || debt.nextPaymentDate === null ? debt.nextPaymentDate : shiftMonths(debt.nextPaymentDate, 1),
      status: paidOff ? 'paidOff' : debt.status,
    });

    return payment;
  });
}

async function unlinkPaymentTransaction(profileId: string, paymentId: string): Promise<DebtPayment> {
  requireProfileId(profileId);
  return db.transaction('rw', [db.debtPayments, db.transactions, db.profiles, db.outbox], async () => {
    const existing = await debtPaymentsRepo.getById(profileId, paymentId);
    if (!existing) throw new ValidationError('El pago no existe en este perfil.');
    if (existing.transactionId !== null) {
      await revertLinkedTransactionStatsAdjustment(profileId, existing.transactionId);
    }
    return debtPaymentsRepo.update(profileId, paymentId, { transactionId: null });
  });
}

// --- Vinculacion deuda-movimiento: candidatos (nunca vincula con confianza baja) ---

export interface PaymentCandidate {
  transactionId: string;
  date: string;
  amountCents: number;
  confidencePerMille: number;
}

const CANDIDATE_DATE_WINDOW_DAYS = 5;
const CANDIDATE_MIN_CONFIDENCE = 500; // por mil; por debajo no se propone (FINANCIAL_ALGORITHMS conventions)

// Propone movimientos de la cuenta vinculada que podrian corresponder a la proxima cuota de una
// deuda (misma cuenta, importe cercano al pago minimo, fecha cercana a nextPaymentDate). Nunca
// vincula automaticamente: solo lista candidatos para que la persona decida (evita doble
// conteo y falsos positivos). Excluye movimientos ya vinculados a otro pago.
async function proposePaymentCandidates(profileId: string, debtId: string): Promise<PaymentCandidate[]> {
  requireProfileId(profileId);
  const debt = await requireDebt(profileId, debtId);
  if (debt.linkedAccountId === null || debt.nextPaymentDate === null) return [];
  const [transactions, existingPayments] = await Promise.all([
    transactionsRepo.list(profileId),
    debtPaymentsRepo.listByDebt(profileId, debtId),
  ]);
  const linkedTxIds = new Set(existingPayments.map((p) => p.transactionId).filter((id): id is string => id !== null));
  const windowStart = addDaysISO(debt.nextPaymentDate, -CANDIDATE_DATE_WINDOW_DAYS);
  const windowEnd = addDaysISO(debt.nextPaymentDate, CANDIDATE_DATE_WINDOW_DAYS);

  const candidates: PaymentCandidate[] = [];
  for (const t of transactions) {
    if (t.accountId !== debt.linkedAccountId) continue;
    if (linkedTxIds.has(t.id)) continue;
    if (t.date < windowStart || t.date > windowEnd) continue;
    const amountAbs = Math.abs(t.amountCents);
    const amountDiff = Math.abs(amountAbs - debt.minimumPaymentCents);
    const amountScore = Math.max(0, 1000 - Math.round((amountDiff / Math.max(1, debt.minimumPaymentCents)) * 1000));
    const dateDiffDays = Math.abs(dayDiff(t.date, debt.nextPaymentDate));
    const dateScore = Math.max(0, 1000 - Math.round((dateDiffDays / CANDIDATE_DATE_WINDOW_DAYS) * 1000));
    const confidencePerMille = Math.round(amountScore * 0.7 + dateScore * 0.3);
    if (confidencePerMille < CANDIDATE_MIN_CONFIDENCE) continue;
    candidates.push({ transactionId: t.id, date: t.date, amountCents: t.amountCents, confidencePerMille });
  }
  return candidates.sort((a, b) => b.confidencePerMille - a.confidencePerMille);
}

function addDaysISO(iso: string, delta: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

function dayDiff(aISO: string, bISO: string): number {
  const [ay, am, ad] = aISO.split('-').map(Number) as [number, number, number];
  const [by, bm, bd] = bISO.split('-').map(Number) as [number, number, number];
  return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86_400_000);
}

// --- Resumen agregado (dashboard de deudas) ---

export interface DebtsSummary {
  totalOutstandingCents: number;
  totalMinimumPaymentCents: number;
  weightedAverageRatePpm: number; // ponderado por saldo pendiente; 0 si no hay deudas activas
  earliestNextPaymentDate: string | null;
  activeCount: number;
}

async function getSummary(profileId: string): Promise<DebtsSummary> {
  requireProfileId(profileId);
  const active = await debtsRepo.listActive(profileId);
  const totalOutstandingCents = active.reduce((s, d) => s + d.outstandingPrincipalCents, 0);
  const totalMinimumPaymentCents = active.reduce((s, d) => s + d.minimumPaymentCents, 0);
  const weightedSum = active.reduce((s, d) => s + d.outstandingPrincipalCents * d.annualRatePpm, 0);
  const weightedAverageRatePpm = totalOutstandingCents > 0 ? Math.round(weightedSum / totalOutstandingCents) : 0;
  const dates = active.map((d) => d.nextPaymentDate).filter((d): d is string => d !== null);
  const earliestNextPaymentDate = dates.length > 0 ? dates.sort()[0] : null;
  return {
    totalOutstandingCents,
    totalMinimumPaymentCents,
    weightedAverageRatePpm,
    earliestNextPaymentDate,
    activeCount: active.length,
  };
}

// --- Comparador multideuda (Snowball/Avalanche/personalizada) ---

export interface DebtsComparisonResult extends StrategyComparison {
  excludedCardDebtIds: string[];
  debtNames: Record<string, string>;
}

// Deudas participantes: activas y amortizables (excluye 'card' y archivadas/liquidadas). Las
// excluidas por tipo se listan para que la UI explique por que faltan (nunca en silencio).
//
// Orden de entrada al motor: FINANCIAL_ALGORITHMS 9 exige un desempate determinista "por un
// criterio fijo y documentado (p. ej. menor id/orden de creacion)". El motor usa el orden del
// array de entrada como ese criterio, pero un repositorio Dexie NO garantiza devolver las filas
// en orden de creacion (el orden de un `.toArray()` sobre un indice compuesto depende del
// almacenamiento interno, no de `createdAt`). Se ordena aqui explicitamente por createdAt
// ascendente y, si empatan, por id, para que el desempate sea el documentado y reproducible
// entre ejecuciones y dispositivos, no un accidente del orden de iteracion de IndexedDB.
function byCreationOrder(a: Debt, b: Debt): number {
  return a.createdAt - b.createdAt || a.id.localeCompare(b.id);
}

async function getComparableDebts(profileId: string): Promise<{ included: Debt[]; excludedCardDebtIds: string[] }> {
  const active = await debtsRepo.listActive(profileId);
  const included = active.filter((d) => isAmortizable(d.type)).sort(byCreationOrder);
  const excludedCardDebtIds = active.filter((d) => !isAmortizable(d.type)).map((d) => d.id);
  return { included, excludedCardDebtIds };
}

async function compareDebtStrategies(
  profileId: string,
  input: Omit<CompareStrategiesInput, 'debts' | 'startDate'> & { startDate?: string },
): Promise<DebtsComparisonResult> {
  requireProfileId(profileId);
  const { included, excludedCardDebtIds } = await getComparableDebts(profileId);
  const debts: MultiDebtInput[] = included.map((d) => ({
    id: d.id,
    balanceCents: d.outstandingPrincipalCents,
    annualRatePpm: d.annualRatePpm,
    minimumPaymentCents: d.minimumPaymentCents,
  }));
  const result = compareStrategies({
    debts,
    recurringExtraCents: input.recurringExtraCents,
    oneTimeExtraPayments: input.oneTimeExtraPayments,
    startDate: input.startDate ?? todayISO(),
    custom: input.custom,
  });
  return {
    ...result,
    excludedCardDebtIds,
    debtNames: Object.fromEntries(included.map((d) => [d.id, d.name])),
  };
}

// --- Escenarios (guardar, duplicar, borrar, recalcular, detectar desactualizado) ---

// Senal de cambio de una deuda para detectar un escenario desactualizado. DATA_MODEL 19.3 fija
// `sourceRevision` como "suma de las revision", pero `revision` es autoritativa del SERVIDOR y
// vale 0 mientras el perfil sea solo local (SyncMeta, DATA_MODEL seccion 9): sumar revisiones
// tal cual dejaria la deteccion muerta en el modo local-first, que es un ciudadano de primera
// clase (invariante 2 de CLAUDE.md) y debe funcionar sin cuenta. Por eso, mientras una fila no
// tiene revision confirmada (revision <= 0), se usa `updatedAt` (que SI cambia en cada escritura
// local) como sustituto monotono; en cuanto el perfil sincroniza y revision pasa a ser > 0, se
// usa la revision autoritativa tal como especifica el documento.
function changeSignal(d: Debt): number {
  const revision = d.revision ?? 0;
  return revision > 0 ? revision : d.updatedAt;
}

async function currentAggregateRevision(profileId: string): Promise<number> {
  const { included } = await getComparableDebts(profileId);
  return included.reduce((s, d) => s + changeSignal(d), 0);
}

export interface CreateScenarioInput {
  name: string;
  strategy: DebtScenario['strategy'];
  recurringExtraCents: number;
  oneTimeExtraPayments: ExtraPayment[];
}

async function createScenario(profileId: string, input: CreateScenarioInput): Promise<DebtScenario> {
  requireProfileId(profileId);
  if (input.name.trim().length < 1 || input.name.length > 160) {
    throw new ValidationError('El nombre del escenario debe tener entre 1 y 160 caracteres.');
  }
  assertCents(input.recurringExtraCents);
  if (input.recurringExtraCents < 0) throw new ValidationError('El extra mensual no puede ser negativo.');
  const sourceRevision = await currentAggregateRevision(profileId);
  return debtScenariosRepo.create(profileId, {
    name: input.name,
    strategy: input.strategy,
    recurringExtraCents: input.recurringExtraCents,
    oneTimeExtraPayments: input.oneTimeExtraPayments,
    calculationVersion: DEBT_CALCULATION_VERSION,
    sourceRevision,
  });
}

async function duplicateScenario(profileId: string, scenarioId: string, newName: string): Promise<DebtScenario> {
  requireProfileId(profileId);
  const existing = await debtScenariosRepo.getById(profileId, scenarioId);
  if (!existing) throw new ValidationError('El escenario no existe en este perfil.');
  return createScenario(profileId, {
    name: newName,
    strategy: existing.strategy,
    recurringExtraCents: existing.recurringExtraCents,
    oneTimeExtraPayments: existing.oneTimeExtraPayments,
  });
}

async function deleteScenario(profileId: string, scenarioId: string): Promise<void> {
  requireProfileId(profileId);
  return debtScenariosRepo.remove(profileId, scenarioId);
}

// Un escenario esta desactualizado si el agregado de revisiones de las deudas participantes
// cambio desde que se guardo (alguna deuda se edito o registro un pago). Nunca se recalcula en
// silencio: la UI debe avisar y el usuario decide "recalcular" explicitamente.
async function isScenarioStale(profileId: string, scenario: DebtScenario): Promise<boolean> {
  const current = await currentAggregateRevision(profileId);
  return current !== scenario.sourceRevision || scenario.calculationVersion !== DEBT_CALCULATION_VERSION;
}

// Recalcula: re-ancla sourceRevision/calculationVersion al estado actual. Los NUMEROS del
// escenario (meses, intereses) nunca se persisten: se derivan siempre en vivo a partir de
// strategy/recurringExtraCents/oneTimeExtraPayments contra las deudas actuales
// (compareDebtStrategies con custom apuntando a este escenario), asi que "recalcular" no
// duplica logica de calculo, solo confirma que el snapshot de origen vuelve a estar al dia.
async function refreshScenario(profileId: string, scenarioId: string): Promise<DebtScenario> {
  requireProfileId(profileId);
  const sourceRevision = await currentAggregateRevision(profileId);
  return debtScenariosRepo.update(profileId, scenarioId, {
    sourceRevision,
    calculationVersion: DEBT_CALCULATION_VERSION,
  });
}

// Resultado de un escenario guardado: aplica su strategy/extra sobre las deudas ACTUALES (nunca
// contra un snapshot congelado de saldos, para que el usuario siempre vea el resultado real).
async function evaluateScenario(profileId: string, scenario: DebtScenario): Promise<DebtsComparisonResult> {
  if (scenario.strategy === 'baseline' || scenario.strategy === 'snowball' || scenario.strategy === 'avalanche') {
    return compareDebtStrategies(profileId, {
      recurringExtraCents: scenario.recurringExtraCents,
      oneTimeExtraPayments: scenario.oneTimeExtraPayments.map((e) => ({
        debtId: e.debtId,
        month: monthsFromToday(e.date),
        amountCents: e.amountCents,
      })),
    });
  }
  return compareDebtStrategies(profileId, {
    recurringExtraCents: 0,
    custom: {
      recurringExtraCents: scenario.recurringExtraCents,
      oneTimeExtraPayments: scenario.oneTimeExtraPayments.map((e) => ({
        debtId: e.debtId,
        month: monthsFromToday(e.date),
        amountCents: e.amountCents,
      })),
    },
  });
}

function monthsFromToday(dateISO: string): number {
  const today = todayISO();
  const [ty, tm] = today.split('-').map(Number) as [number, number];
  const [dy, dm] = dateISO.split('-').map(Number) as [number, number];
  return Math.max(1, (dy - ty) * 12 + (dm - tm) + 1);
}

// Todas las deudas y pagos del perfil, para la exportacion XLSX (ver src/services/exportService.ts).
async function listAllForExport(profileId: string): Promise<{ debts: Debt[]; payments: DebtPayment[] }> {
  requireProfileId(profileId);
  const debts = await debtsRepo.list(profileId);
  const perDebtPayments = await Promise.all(debts.map((d) => debtPaymentsRepo.listByDebt(profileId, d.id)));
  return { debts, payments: perDebtPayments.flat() };
}

export const debtsService = {
  isAmortizable,
  createDebt,
  updateDebt,
  archiveDebt,
  getSchedule,
  listAllForExport,
  simulateDebtExtraPayments,
  recordPayment,
  unlinkPaymentTransaction,
  proposePaymentCandidates,
  getSummary,
  compareDebtStrategies,
  createScenario,
  duplicateScenario,
  deleteScenario,
  isScenarioStale,
  refreshScenario,
  evaluateScenario,
};
