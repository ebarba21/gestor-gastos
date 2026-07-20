// Motor de calculo de deudas: calendario de amortizacion, amortizacion anticipada y
// estrategias multideuda (Snowball/Avalanche/personalizada). Ver FINANCIAL_ALGORITHMS.md
// secciones 8-9. NUCLEO PURO: no toca Dexie ni profileId, solo numeros y fechas ya cargados
// (mismo principio de separacion que forecastService.computeForecastRange). El orquestador que
// lee/escribe deudas vive en src/services/debtsService.ts.
//
// Alcance de esta fase (FINANCIAL_ALGORITHMS 8.1): solo deuda de cuota fija. El tipo 'card'
// (revolving) se registra pero queda fuera de este motor (ni calendario ni Snowball/Avalanche);
// el filtrado por tipo es responsabilidad del orquestador, este motor no conoce `DebtType`.
import { monthlyInterestCents, computeInstallmentCents } from '../lib/interest';
import { shiftMonths } from '../lib/dates';
import { assertCents } from '../lib/money';
import { ValidationError } from '../lib/validation';

// Version del algoritmo de calculo (DATA_MODEL seccion 20, campo DebtScenario.calculationVersion).
// Cambiar cualquier formula de este fichero exige incrementar esta constante.
export const DEBT_CALCULATION_VERSION = 1;

// Plazo extremo: mas de 50 anos mensuales se considera un dato de entrada no razonable, no un
// resultado a calcular (FINANCIAL_ALGORITHMS 8.4/10 "plazo extremo").
const MAX_TERM_MONTHS = 600;
// Cota de seguridad para simulaciones multideuda con extra muy pequeno o intereses altos: evita
// un bucle sin convergencia real (FINANCIAL_ALGORITHMS 8.4/10 "no convergencia").
const MAX_MULTI_DEBT_MONTHS = 1200;

export type DegenerateReason =
  | 'insufficientPayment' // cuota < interes del primer periodo: el saldo crece (amortizacion negativa)
  | 'criticalPayment' // cuota == interes del primer periodo: el principal del primer periodo es 0
  | 'incompatibleData' // principal, plazo o cuota no validos (<=0, no enteros)
  | 'nonConvergence' // no se alcanza saldo 0 dentro de la cota de seguridad
  | 'extremeTerm'; // plazo superior a MAX_TERM_MONTHS

export interface ScheduleRow {
  period: number;
  date: string; // YYYY-MM-DD
  paymentCents: number;
  interestCents: number;
  principalCents: number;
  balanceCents: number;
}

export interface ScheduleResult {
  installmentCents: number;
  rows: ScheduleRow[];
  totalInterestCents: number;
  totalPaymentsCents: number;
  payoffDate: string | null;
  degenerate: DegenerateReason | null;
}

// Detecta los casos degenerados de 8.4 ANTES de generar el calendario (nunca un calendario
// infinito ni un ultimo pago desorbitado). interest_i es no creciente mientras principal_i > 0
// en cada periodo previo (el saldo nunca sube), asi que comprobar solo el interes del PRIMER
// periodo basta para garantizar que ningun periodo posterior sea degenerado.
export function detectDegenerate(
  principalCents: number,
  annualRatePpm: number,
  installmentCents: number,
  termMonths: number,
): DegenerateReason | null {
  if (!Number.isInteger(termMonths) || termMonths < 1) return 'incompatibleData';
  if (!Number.isInteger(principalCents) || principalCents <= 0) return 'incompatibleData';
  if (!Number.isInteger(installmentCents) || installmentCents <= 0) return 'incompatibleData';
  if (termMonths > MAX_TERM_MONTHS) return 'extremeTerm';
  const interest1 = monthlyInterestCents(principalCents, annualRatePpm);
  if (installmentCents < interest1) return 'insufficientPayment';
  if (installmentCents === interest1 && annualRatePpm > 0) return 'criticalPayment';
  return null;
}

// Calendario base de cuota fija (FINANCIAL_ALGORITHMS 8.2-8.3). El PERIODO FINAL (termMonths)
// siempre fuerza el saldo a exactamente 0 (isLastPeriod): la cuota redondeada a centimo deja un
// residuo de subcentimo que debe absorberse en la ultima cuota contractual, nunca en un periodo
// extra (8.3: "la ultima cuota puede diferir en unos centimos").
export function buildAmortizationSchedule(input: {
  principalCents: number;
  annualRatePpm: number;
  termMonths: number;
  // Cuota a aplicar. Si se omite, se calcula con la formula de anualidad (8.2). Un valor
  // explicito permite recalcular calendarios tras "reducir cuota" (8.5) o forzar una cuota
  // insuficiente para probar la deteccion de degenerados (8.4).
  installmentCents?: number;
  startDate: string; // YYYY-MM-DD de la primera cuota
}): ScheduleResult {
  const { principalCents, annualRatePpm, termMonths, startDate } = input;
  assertCents(principalCents);
  const installmentCents =
    input.installmentCents ?? computeInstallmentCents(principalCents, annualRatePpm, termMonths);
  const degenerate = detectDegenerate(principalCents, annualRatePpm, installmentCents, termMonths);
  if (degenerate) {
    return {
      installmentCents,
      rows: [],
      totalInterestCents: 0,
      totalPaymentsCents: 0,
      payoffDate: null,
      degenerate,
    };
  }

  let balance = principalCents;
  let totalInterest = 0;
  let totalPayments = 0;
  const rows: ScheduleRow[] = [];
  for (let period = 1; period <= termMonths; period++) {
    const interest = monthlyInterestCents(balance, annualRatePpm);
    let principal = installmentCents - interest;
    let payment = installmentCents;
    const isLastPeriod = period === termMonths;
    if (principal >= balance || isLastPeriod) {
      principal = balance;
      payment = balance + interest;
      balance = 0;
    } else {
      balance -= principal;
    }
    totalInterest += interest;
    totalPayments += payment;
    rows.push({
      period,
      date: shiftMonths(startDate, period - 1),
      paymentCents: payment,
      interestCents: interest,
      principalCents: principal,
      balanceCents: balance,
    });
    if (balance === 0) break;
  }

  return {
    installmentCents,
    rows,
    totalInterestCents: totalInterest,
    totalPaymentsCents: totalPayments,
    payoffDate: rows[rows.length - 1]?.date ?? null,
    degenerate: null,
  };
}

// --- Amortizacion anticipada (8.5) ---

export type ExtraPaymentMode = 'reduceTerm' | 'reducePayment';

export interface ExtraPaymentInput {
  period: number; // 1-based, periodo del calendario base en el que se aplica
  amountCents: number;
}

export interface ExtraPaymentPlan {
  recurringExtraCents: number; // aplicado cada periodo desde el 1
  oneTime: ExtraPaymentInput[];
  mode: ExtraPaymentMode;
}

export interface ExtraScheduleRow extends ScheduleRow {
  extraPrincipalCents: number;
}

export interface ExtraPaymentSimResult {
  rows: ExtraScheduleRow[];
  totalInterestCents: number;
  totalPaymentsCents: number;
  payoffPeriod: number;
  payoffDate: string | null;
  // Cuota vigente al final de la simulacion (en reduceTerm nunca cambia; en reducePayment es la
  // ultima recalculada).
  finalInstallmentCents: number;
  degenerate: DegenerateReason | null;
}

// Simula el calendario aplicando amortizaciones extraordinarias puntuales y/o mensuales
// (8.5). 'reduceTerm': la cuota se mantiene, el extra se resta directamente del principal y el
// plazo se acorta (el bucle termina en cuanto el saldo llega a 0, antes de termMonths).
// 'reducePayment': tras cada extra aplicado, la cuota se recalcula sobre el saldo restante y el
// plazo ORIGINAL restante (termMonths - period), con la misma formula de 8.2; el plazo se
// mantiene. El periodo termMonths sigue forzando saldo 0 exacto (mismo motivo que 8.3).
export function simulateExtraPayments(input: {
  principalCents: number;
  annualRatePpm: number;
  termMonths: number;
  baseInstallmentCents: number;
  startDate: string;
  plan: ExtraPaymentPlan;
}): ExtraPaymentSimResult {
  const { principalCents, annualRatePpm, termMonths, baseInstallmentCents, startDate, plan } = input;
  const degenerate = detectDegenerate(principalCents, annualRatePpm, baseInstallmentCents, termMonths);
  if (degenerate) {
    return {
      rows: [],
      totalInterestCents: 0,
      totalPaymentsCents: 0,
      payoffPeriod: 0,
      payoffDate: null,
      finalInstallmentCents: baseInstallmentCents,
      degenerate,
    };
  }

  const oneTimeByPeriod = new Map(plan.oneTime.map((e) => [e.period, e.amountCents]));
  let balance = principalCents;
  let installment = baseInstallmentCents;
  let totalInterest = 0;
  let totalPayments = 0;
  const rows: ExtraScheduleRow[] = [];
  let period = 0;
  while (balance > 0 && period < termMonths) {
    period += 1;
    const interest = monthlyInterestCents(balance, annualRatePpm);
    let principal = installment - interest;
    let payment = installment;
    const isLastPeriod = period === termMonths;
    if (principal >= balance || isLastPeriod) {
      principal = balance;
      payment = balance + interest;
      balance = 0;
    } else {
      balance -= principal;
    }
    totalInterest += interest;

    const extra = plan.recurringExtraCents + (oneTimeByPeriod.get(period) ?? 0);
    let extraApplied = 0;
    if (extra > 0 && balance > 0) {
      extraApplied = Math.min(extra, balance);
      balance -= extraApplied;
    }
    const totalPayment = payment + extraApplied;
    totalPayments += totalPayment;
    rows.push({
      period,
      date: shiftMonths(startDate, period - 1),
      paymentCents: totalPayment,
      interestCents: interest,
      principalCents: principal + extraApplied,
      extraPrincipalCents: extraApplied,
      balanceCents: balance,
    });
    if (balance === 0) break;
    if (plan.mode === 'reducePayment' && extraApplied > 0) {
      const remainingTerm = termMonths - period;
      if (remainingTerm > 0) {
        installment = computeInstallmentCents(balance, annualRatePpm, remainingTerm);
      }
    }
  }

  return {
    rows,
    totalInterestCents: totalInterest,
    totalPaymentsCents: totalPayments,
    payoffPeriod: period,
    payoffDate: rows[rows.length - 1]?.date ?? null,
    finalInstallmentCents: installment,
    degenerate: null,
  };
}

// Compara un resultado de amortizacion anticipada contra el calendario base (mismo principal/
// tasa/plazo/cuota inicial sin extras). Salidas de 8.5: nueva fecha de fin, meses ahorrados,
// intereses ahorrados, cuota nueva, coste total.
export interface ExtraPaymentComparison {
  baselineTotalInterestCents: number;
  baselineTermMonths: number;
  newTotalInterestCents: number;
  newPayoffPeriod: number;
  monthsSaved: number;
  interestSavedCents: number;
  newInstallmentCents: number;
  newTotalCostCents: number;
}

export function compareExtraPayments(
  baseline: ScheduleResult,
  withExtras: ExtraPaymentSimResult,
  baselineTermMonths: number,
): ExtraPaymentComparison {
  return {
    baselineTotalInterestCents: baseline.totalInterestCents,
    baselineTermMonths,
    newTotalInterestCents: withExtras.totalInterestCents,
    newPayoffPeriod: withExtras.payoffPeriod,
    monthsSaved: baselineTermMonths - withExtras.payoffPeriod,
    interestSavedCents: baseline.totalInterestCents - withExtras.totalInterestCents,
    newInstallmentCents: withExtras.finalInstallmentCents,
    newTotalCostCents: withExtras.totalPaymentsCents,
  };
}

// --- Estrategias multideuda: Snowball, Avalanche, personalizada (seccion 9) ---

export type MultiDebtStrategy = 'baseline' | 'snowball' | 'avalanche' | 'custom';

export interface MultiDebtInput {
  id: string;
  balanceCents: number;
  annualRatePpm: number;
  minimumPaymentCents: number;
}

export interface DebtPayoffOrderEntry {
  debtId: string;
  payoffMonth: number; // 1-based
  payoffDate: string;
}

export interface MultiDebtSimResult {
  strategy: MultiDebtStrategy;
  totalMonths: number;
  totalInterestCents: number;
  totalPaidCents: number;
  freeDate: string | null; // fecha en la que TODAS las deudas participantes quedan liquidadas
  payoffOrder: DebtPayoffOrderEntry[];
  // Deudas excluidas de la simulacion por cuota insuficiente/critica (FINANCIAL_ALGORITHMS 8.4):
  // nunca se simulan con una formula que no converge; se listan para que la UI avise.
  degenerateDebtIds: string[];
}

export interface OneTimeMultiDebtExtra {
  debtId: string;
  month: number; // 1-based
  amountCents: number;
}

// Simula el pago conjunto de varias deudas de cuota fija con minimos + un extra compartido.
// 'baseline': solo minimos, sin extra (situacion actual). 'snowball': el extra prioriza la
// deuda de MENOR saldo vivo cada mes. 'avalanche': prioriza la de MAYOR tasa. 'custom': prioriza
// segun el ORDEN de `debts` tal cual se recibe (prioridad manual del usuario). Desempate
// determinista en todos los casos: el orden de `debts` de entrada (FINANCIAL_ALGORITHMS 9). La
// cuota liberada de una deuda ya liquidada se suma automaticamente al extra disponible de los
// meses siguientes ("bola de nieve").
export function simulateMultiDebtStrategy(input: {
  debts: MultiDebtInput[];
  strategy: MultiDebtStrategy;
  recurringExtraCents: number;
  oneTimeExtraPayments?: OneTimeMultiDebtExtra[];
  startDate: string;
}): MultiDebtSimResult {
  const { strategy, recurringExtraCents, startDate } = input;
  const oneTime = input.oneTimeExtraPayments ?? [];
  if (!Number.isInteger(recurringExtraCents) || recurringExtraCents < 0) {
    throw new ValidationError('El extra mensual debe ser un entero >= 0 en centimos.');
  }

  const orderIndex = new Map(input.debts.map((d, idx) => [d.id, idx]));
  const degenerateDebtIds: string[] = [];
  const state = input.debts
    .filter((d) => {
      if (d.balanceCents <= 0) return true;
      const interest1 = monthlyInterestCents(d.balanceCents, d.annualRatePpm);
      const bad = d.minimumPaymentCents <= interest1;
      if (bad) degenerateDebtIds.push(d.id);
      return !bad;
    })
    .map((d) => ({
      id: d.id,
      balance: d.balanceCents,
      rate: d.annualRatePpm,
      minPayment: d.minimumPaymentCents,
      done: d.balanceCents <= 0,
      payoffMonth: d.balanceCents <= 0 ? 0 : (null as number | null),
    }));

  const stateById = new Map(state.map((s) => [s.id, s] as const));

  let month = 0;
  let totalInterest = 0;
  let totalPaid = 0;
  while (state.some((s) => !s.done) && month < MAX_MULTI_DEBT_MONTHS) {
    month += 1;
    let availableExtra = strategy === 'baseline' ? 0 : recurringExtraCents;
    if (strategy !== 'baseline') {
      for (const s of state) if (s.done) availableExtra += s.minPayment;
    }

    for (const s of state) {
      if (s.done) continue;
      const interest = monthlyInterestCents(s.balance, s.rate);
      const payment = Math.min(s.minPayment, s.balance + interest);
      const principal = payment - interest;
      s.balance -= principal;
      totalInterest += interest;
      totalPaid += payment;
      if (s.balance <= 0) {
        s.balance = 0;
        s.done = true;
        s.payoffMonth = month;
      }
    }

    // Amortizaciones puntuales (DATA_MODEL 19.3, ExtraPayment.debtId = "deuda objetivo"): a
    // diferencia del extra recurrente (que la ESTRATEGIA reparte por prioridad, seccion 9), una
    // puntual tiene un destino explicito y se aplica DIRECTAMENTE a esa deuda, nunca al fondo
    // comun que reparte snowball/avalanche/personalizada. Si la deuda ya esta liquidada o no
    // participa en esta simulacion (degenerada o ausente), el importe no se redirige a otra.
    if (strategy !== 'baseline') {
      for (const e of oneTime) {
        if (e.month !== month) continue;
        const target = stateById.get(e.debtId);
        if (!target || target.done) continue;
        const applied = Math.min(e.amountCents, target.balance);
        target.balance -= applied;
        totalPaid += applied;
        if (target.balance <= 0) {
          target.balance = 0;
          target.done = true;
          target.payoffMonth = month;
        }
      }
    }

    if (strategy !== 'baseline' && availableExtra > 0) {
      const candidates = state.filter((s) => !s.done);
      const priority = candidates.slice().sort((a, b) => {
        if (strategy === 'snowball' && a.balance !== b.balance) return a.balance - b.balance;
        if (strategy === 'avalanche' && a.rate !== b.rate) return b.rate - a.rate;
        return (orderIndex.get(a.id) ?? 0) - (orderIndex.get(b.id) ?? 0);
      });
      let extra = availableExtra;
      for (const s of priority) {
        if (extra <= 0) break;
        const applied = Math.min(extra, s.balance);
        s.balance -= applied;
        extra -= applied;
        totalPaid += applied;
        if (s.balance <= 0) {
          s.balance = 0;
          s.done = true;
          s.payoffMonth = month;
        }
      }
    }
  }

  const degenerate = month >= MAX_MULTI_DEBT_MONTHS && state.some((s) => !s.done);
  const payoffOrder: DebtPayoffOrderEntry[] = state
    .filter((s): s is typeof s & { payoffMonth: number } => s.payoffMonth !== null)
    .sort(
      (a, b) =>
        a.payoffMonth - b.payoffMonth || (orderIndex.get(a.id) ?? 0) - (orderIndex.get(b.id) ?? 0),
    )
    .map((s) => ({
      debtId: s.id,
      payoffMonth: s.payoffMonth,
      payoffDate: shiftMonths(startDate, s.payoffMonth - 1),
    }));

  return {
    strategy,
    totalMonths: month,
    totalInterestCents: totalInterest,
    totalPaidCents: totalPaid,
    freeDate: degenerate || state.length === 0 ? null : shiftMonths(startDate, month - 1),
    payoffOrder,
    degenerateDebtIds,
  };
}

// --- Comparador (9): base vs Snowball vs Avalanche vs personalizada ---

export interface CompareStrategiesInput {
  debts: MultiDebtInput[];
  recurringExtraCents: number;
  oneTimeExtraPayments?: OneTimeMultiDebtExtra[];
  startDate: string;
  // Estrategia personalizada opcional: mismo extra o uno distinto, prioridad = orden de `debts`.
  custom?: {
    recurringExtraCents: number;
    oneTimeExtraPayments?: OneTimeMultiDebtExtra[];
  };
}

export interface StrategyComparison {
  results: MultiDebtSimResult[];
  // Nunca se afirma que una estrategia sea universalmente mejor (FINANCIAL_ALGORITHMS 9): solo
  // se identifica cual es mas rapida y cual de menor coste segun ESTE conjunto de datos.
  fastestStrategy: MultiDebtStrategy | null;
  cheapestStrategy: MultiDebtStrategy | null;
}

export function compareStrategies(input: CompareStrategiesInput): StrategyComparison {
  const baseline = simulateMultiDebtStrategy({
    debts: input.debts,
    strategy: 'baseline',
    recurringExtraCents: 0,
    startDate: input.startDate,
  });
  const snowball = simulateMultiDebtStrategy({
    debts: input.debts,
    strategy: 'snowball',
    recurringExtraCents: input.recurringExtraCents,
    oneTimeExtraPayments: input.oneTimeExtraPayments,
    startDate: input.startDate,
  });
  const avalanche = simulateMultiDebtStrategy({
    debts: input.debts,
    strategy: 'avalanche',
    recurringExtraCents: input.recurringExtraCents,
    oneTimeExtraPayments: input.oneTimeExtraPayments,
    startDate: input.startDate,
  });
  const results = [baseline, snowball, avalanche];
  if (input.custom) {
    results.push(
      simulateMultiDebtStrategy({
        debts: input.debts,
        strategy: 'custom',
        recurringExtraCents: input.custom.recurringExtraCents,
        oneTimeExtraPayments: input.custom.oneTimeExtraPayments,
        startDate: input.startDate,
      }),
    );
  }

  // 'baseline' es el punto de referencia ("no cambiar nada"), no una estrategia candidata: se
  // muestra en la tabla para comparar, pero nunca puede ganar "mas rapida"/"menor coste" (esas
  // etiquetas son para orientar entre snowball/avalanche/personalizada, FINANCIAL_ALGORITHMS 9).
  const withFreeDate = results.filter((r) => r.freeDate !== null && r.strategy !== 'baseline');
  const fastest = withFreeDate.reduce<MultiDebtSimResult | null>(
    (best, r) => (best === null || r.totalMonths < best.totalMonths ? r : best),
    null,
  );
  const cheapest = withFreeDate.reduce<MultiDebtSimResult | null>(
    (best, r) => (best === null || r.totalInterestCents < best.totalInterestCents ? r : best),
    null,
  );

  return {
    results,
    fastestStrategy: fastest?.strategy ?? null,
    cheapestStrategy: cheapest?.strategy ?? null,
  };
}
