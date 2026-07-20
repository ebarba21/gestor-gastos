// Motor de deteccion avanzada de duplicados (ampliacion, fase 5). Ver DATA_MODEL seccion 15 y
// FINANCIAL_ALGORITHMS seccion 5.
//
// Estructura del modulo (mismo patron que merchantService.ts/ruleService.ts):
//  1. MOTOR PURO (sin acceso a datos ni React): puntuacion de un candidato contra un borrador,
//     y agregacion del mejor candidato. Determinista y versionado (FINGERPRINT_VERSION, ver
//     lib/duplicateFingerprint.ts): la formula de puntuacion cambia junto con las huellas, asi
//     que comparte version con ellas en vez de duplicar un segundo numero de version.
//  2. ORQUESTACION la hace el llamante (importService): genera los candidatos con consultas
//     acotadas al repositorio (por cuenta, moneda, importe, ventana temporal y comercio) y
//     llama a `evaluateDuplicates`. Este modulo NUNCA abre Dexie.
//
// La confianza es heuristica orientativa por mil (0..1000), NUNCA se presenta como
// probabilidad real (FINANCIAL_ALGORITHMS seccion 5).
import type { DuplicateStatus } from '../db/schema';

// Ventanas de tolerancia de fecha por nivel (dias, inclusive). Documentadas explicitamente
// porque fijan el comportamiento del motor: cambiar un valor es un cambio de producto, no un
// detalle de implementacion.
export const STRONG_DATE_WINDOW_DAYS = 3;
export const POSSIBLE_DATE_WINDOW_DAYS = 7;
export const WEAK_DATE_WINDOW_DAYS = 14;

export type DuplicateReasonCode =
  | 'sameBankTransactionId'
  | 'sameExactFingerprint'
  | 'sameAccountAmountCurrency'
  | 'sameMerchant'
  | 'sameNormalizedConcept'
  | 'pendingConfirmedMatch'
  | 'weakDateProximity';

// Motivos legibles para la UI (FINANCIAL_ALGORITHMS seccion 5: "duplicateReasonCodes").
export const REASON_CODE_LABELS: Record<DuplicateReasonCode, string> = {
  sameBankTransactionId: 'Mismo identificador bancario',
  sameExactFingerprint: 'Coincidencia exacta (cuenta, fecha, importe y concepto)',
  sameAccountAmountCurrency: 'Mismo importe, cuenta y moneda',
  sameMerchant: 'Mismo comercio',
  sameNormalizedConcept: 'Mismo concepto normalizado',
  pendingConfirmedMatch: 'Sustituye a un movimiento pendiente',
  weakDateProximity: 'Fecha proxima, sin mas coincidencias',
};

// Decisiones que puede tomar el usuario sobre una fila con posible duplicado (alcance fase 5,
// punto 8). "applyToEquivalents" y "undo" son acciones de UI/servicio sobre VARIAS filas o
// sobre una decision ya tomada; no forman parte del resultado por fila del motor.
export type DuplicateAction = 'skip' | 'import' | 'replacePending' | 'link' | 'markNotDuplicate';

// ---------------------------------------------------------------------------
// 1. MOTOR PURO
// ---------------------------------------------------------------------------

export interface DuplicateEvaluationInput {
  accountId: string;
  currency: string;
  amountCents: number;
  date: string; // YYYY-MM-DD
  normalizedConcept: string;
  merchantId: string | null;
  bankTransactionId: string | null;
  // true si la fila candidata a importar/crear es una operacion pendiente.
  pending: boolean;
  exactFingerprint: string;
  normalizedFingerprint: string;
}

// Forma minima de un movimiento ya existente que el motor necesita para puntuar. El llamante
// la construye a partir de un `Transaction` real.
export interface ExistingTxForDuplicate {
  id: string;
  accountId: string;
  currency: string;
  amountCents: number;
  date: string;
  normalizedConcept: string;
  merchantId: string | null;
  bankTransactionId: string | null;
  pending: boolean;
  exactFingerprint: string;
  normalizedFingerprint: string;
}

export interface DuplicateCandidateScore {
  candidateId: string;
  status: DuplicateStatus;
  confidence: number; // 0..1000, heuristica orientativa (no probabilidad real)
  reasonCodes: DuplicateReasonCode[];
  diffs: string[];
  actions: DuplicateAction[];
}

export interface DuplicateEvaluation {
  status: DuplicateStatus; // 'unique' si ningun candidato supero el umbral de ventana temporal
  confidence: number;
  reasonCodes: DuplicateReasonCode[];
  // Todos los candidatos que puntuaron, ordenados de mas a menos relevante.
  candidateIds: string[];
  best: DuplicateCandidateScore | null;
  // Si el mejor candidato es un pendiente que este borrador (confirmado) sustituye, su id;
  // si no, null. Ver FINANCIAL_ALGORITHMS seccion 5 ("pendiente -> confirmado").
  pendingReplacementCandidateId: string | null;
}

// Orden de relevancia para elegir el "mejor" candidato entre varios que puntuan. pendingReplaced
// va primero: es la situacion mas accionable (hay una sustitucion concreta que proponer).
const STATUS_RANK: Record<DuplicateStatus, number> = {
  unique: 0,
  weak: 1,
  possible: 2,
  strongNormalized: 3,
  exact: 4,
  pendingReplaced: 5,
};

// Diferencia en dias de calendario entre dos fechas YYYY-MM-DD (positiva o negativa segun
// cual sea posterior). Se opera en UTC sobre componentes ya validados por el llamante
// (evita desfases de zona horaria, igual que el resto de lib/dates.ts).
function daysBetweenIso(a: string, b: string): number {
  const ta = Date.parse(`${a}T00:00:00.000Z`);
  const tb = Date.parse(`${b}T00:00:00.000Z`);
  return Math.round((ta - tb) / 86_400_000);
}

// "vincular" y "sustituir pendiente" ACTUALIZAN un movimiento EXISTENTE (nunca crean uno
// nuevo): si el candidato no es el correcto, sobreescriben en silencio sus metadatos
// bancarios (incluido `pending`, que afecta a la conciliacion, FINANCIAL_ALGORITHMS seccion
// 6) de un movimiento real y distinto. Por eso solo se ofrecen en los niveles de identidad
// fuerte (exact/strongNormalized/pendingReplaced, que comparten bankTransactionId, huella
// exacta o comercio/concepto dentro de una ventana estricta). En los niveles heuristicos mas
// debiles (possible/weak: solo mismo importe+cuenta+moneda y fecha proxima, SIN comercio ni
// concepto compartido) el usuario solo puede omitir, importar o marcar explicitamente como no
// duplicado (hallazgo de auditoria financiera: un "vincular" erroneo contra un candidato weak
// puede corromper la conciliacion de un movimiento no relacionado).
function actionsFor(
  status: DuplicateStatus,
  candidateIsPending: boolean,
  inputIsPending: boolean,
): DuplicateAction[] {
  const actions: DuplicateAction[] = ['skip', 'import'];
  const strongIdentity =
    status === 'exact' || status === 'strongNormalized' || status === 'pendingReplaced';
  if (strongIdentity) {
    if (candidateIsPending && !inputIsPending) actions.push('replacePending');
    actions.push('link');
  }
  actions.push('markNotDuplicate');
  return actions;
}

// Puntua UN candidato existente contra el borrador `input`. Funcion PURA y determinista.
// Devuelve null si el candidato queda fuera de alcance (distinta cuenta/moneda/importe, o
// fecha mas alla de la ventana debil): el llamante lo descarta sin mas.
//
// Niveles (FINANCIAL_ALGORITHMS seccion 5), de mayor a menor confianza:
//   1. exact: mismo bankTransactionId, o mismo exactFingerprint.
//   2. strongNormalized: mismo importe/cuenta/moneda + mismo comercio o concepto normalizado,
//      dentro de STRONG_DATE_WINDOW_DAYS.
//   3. possible: mismo importe/cuenta/moneda, sin comercio/concepto compartido, dentro de
//      POSSIBLE_DATE_WINDOW_DAYS.
//   4. weak: igual que possible pero solo dentro de WEAK_DATE_WINDOW_DAYS (mas debil).
//   5. pendingReplaced: cualquiera de los niveles 1-2 donde el candidato esta pendiente y el
//      borrador no (una confirmacion que sustituye a un pendiente).
export function scoreCandidate(
  input: DuplicateEvaluationInput,
  existing: ExistingTxForDuplicate,
): DuplicateCandidateScore | null {
  // Acotacion dura: cuenta, moneda e importe deben coincidir exactamente. No se compara todo
  // contra todo (FINANCIAL_ALGORITHMS seccion 5); el llamante ya deberia haber filtrado esto
  // en la consulta, pero se revalida aqui porque es la unica funcion pura y testeada.
  if (existing.accountId !== input.accountId) return null;
  if (existing.currency !== input.currency) return null;
  if (existing.amountCents !== input.amountCents) return null;

  const dayDiff = Math.abs(daysBetweenIso(input.date, existing.date));
  const diffs: string[] = [];
  if (dayDiff > 0) diffs.push(`La fecha difiere ${dayDiff} dia(s).`);

  // Un pendiente existente que este borrador (ya confirmado) sustituye: solo aplica cuando el
  // candidato esta pendiente y el borrador no lo esta.
  const isPendingPromotion = existing.pending && !input.pending;

  const withPendingStatus = (base: DuplicateStatus): DuplicateStatus =>
    isPendingPromotion && (base === 'exact' || base === 'strongNormalized') ? 'pendingReplaced' : base;

  // Nivel 1: identificador bancario (el llamante ya acota por cuenta, ver DATA_MODEL 21.2 —
  // unicidad remota por cuenta).
  if (input.bankTransactionId !== null && input.bankTransactionId === existing.bankTransactionId) {
    const reasonCodes: DuplicateReasonCode[] = ['sameBankTransactionId'];
    const status = withPendingStatus('exact');
    if (status === 'pendingReplaced') reasonCodes.push('pendingConfirmedMatch');
    return {
      candidateId: existing.id,
      status,
      confidence: 1000,
      reasonCodes,
      diffs,
      actions: actionsFor(status, existing.pending, input.pending),
    };
  }

  // Nivel 1b: huella exacta (cuenta+fecha+importe+moneda+concepto normalizado identicos).
  if (input.exactFingerprint === existing.exactFingerprint) {
    const reasonCodes: DuplicateReasonCode[] = ['sameExactFingerprint'];
    const status = withPendingStatus('exact');
    if (status === 'pendingReplaced') reasonCodes.push('pendingConfirmedMatch');
    return {
      candidateId: existing.id,
      status,
      confidence: 950,
      reasonCodes,
      diffs,
      actions: actionsFor(status, existing.pending, input.pending),
    };
  }

  const sameMerchant = input.merchantId !== null && input.merchantId === existing.merchantId;
  const sameConcept = input.normalizedConcept === existing.normalizedConcept;

  // Nivel 2: importe/cuenta/moneda + comercio o concepto compartido, ventana estricta.
  if ((sameMerchant || sameConcept) && dayDiff <= STRONG_DATE_WINDOW_DAYS) {
    const reasonCodes: DuplicateReasonCode[] = ['sameAccountAmountCurrency'];
    reasonCodes.push(sameMerchant ? 'sameMerchant' : 'sameNormalizedConcept');
    const status = withPendingStatus('strongNormalized');
    if (status === 'pendingReplaced') reasonCodes.push('pendingConfirmedMatch');
    // La confianza decae con la distancia en dias, sin bajar del suelo del nivel.
    const confidence = Math.max(750, 900 - dayDiff * 30);
    return {
      candidateId: existing.id,
      status,
      confidence,
      reasonCodes,
      diffs,
      actions: actionsFor(status, existing.pending, input.pending),
    };
  }

  // Nivel 3: mismo importe/cuenta/moneda, sin comercio ni concepto compartidos, ventana media.
  if (dayDiff <= POSSIBLE_DATE_WINDOW_DAYS) {
    const confidence = Math.max(400, 650 - dayDiff * 20);
    return {
      candidateId: existing.id,
      status: 'possible',
      confidence,
      reasonCodes: ['sameAccountAmountCurrency'],
      diffs,
      actions: actionsFor('possible', existing.pending, input.pending),
    };
  }

  // Nivel 4: igual pero ventana amplia (senal debil).
  if (dayDiff <= WEAK_DATE_WINDOW_DAYS) {
    const confidence = Math.max(100, 350 - dayDiff * 10);
    return {
      candidateId: existing.id,
      status: 'weak',
      confidence,
      reasonCodes: ['sameAccountAmountCurrency', 'weakDateProximity'],
      diffs,
      actions: actionsFor('weak', existing.pending, input.pending),
    };
  }

  // Fuera de toda ventana: no se considera candidato.
  return null;
}

// Puntua TODOS los candidatos (ya acotados por el llamante) contra el borrador. Determinista:
// no depende del orden de `candidates`. No agrega: devuelve la puntuacion de cada candidato
// que quedo dentro de alcance (util para aplicar filtros posteriores antes de agregar).
export function scoreAllCandidates(
  input: DuplicateEvaluationInput,
  candidates: ExistingTxForDuplicate[],
): DuplicateCandidateScore[] {
  const scored: DuplicateCandidateScore[] = [];
  for (const candidate of candidates) {
    const score = scoreCandidate(input, candidate);
    if (score !== null) scored.push(score);
  }
  return scored;
}

// Agrega una lista de puntuaciones ya calculadas: elige el mejor candidato (nivel/confianza/
// razones) y conserva la lista completa de ids considerados (trazabilidad, DATA_MODEL 15.1
// "duplicateCandidateIds"). Determinista: el orden de entrada no afecta al resultado.
export function aggregateScores(scored: DuplicateCandidateScore[]): DuplicateEvaluation {
  const sorted = [...scored].sort((a, b) => {
    const rankDiff = STATUS_RANK[b.status] - STATUS_RANK[a.status];
    if (rankDiff !== 0) return rankDiff;
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    // Desempate determinista (mismo criterio que ruleService/merchantService): por id.
    return a.candidateId.localeCompare(b.candidateId);
  });
  const best = sorted[0] ?? null;
  return {
    status: best?.status ?? 'unique',
    confidence: best?.confidence ?? 0,
    reasonCodes: best?.reasonCodes ?? [],
    candidateIds: sorted.map((s) => s.candidateId),
    best,
    pendingReplacementCandidateId: best?.status === 'pendingReplaced' ? best.candidateId : null,
  };
}

// Puntua y agrega en un solo paso, sin decisiones de "no duplicado" (uso en tests/casos
// simples). Para el flujo real de importacion usar `evaluateDuplicatesWithDecisions`.
export function evaluateDuplicates(
  input: DuplicateEvaluationInput,
  candidates: ExistingTxForDuplicate[],
): DuplicateEvaluation {
  return aggregateScores(scoreAllCandidates(input, candidates));
}

// Decision de "no duplicado" tal como la persiste noDuplicateDecisionsRepo (DATA_MODEL 15.2).
// leftTxId/rightTxId son la referencia (opcional) al movimiento EXISTENTE concreto que se
// comparo en el momento de decidir; null si no se pudo determinar (p. ej. candidato sintetico
// del propio fichero, aun sin persistir).
export interface NoDuplicateDecisionPair {
  leftFingerprint: string;
  rightFingerprint: string;
  leftTxId: string | null;
  rightTxId: string | null;
}

// Comprueba si una pareja de huellas ya fue marcada explicitamente como NO duplicado
// (DATA_MODEL 15.2). Simetrica: A-no-duplicado-de-B es igual que B-no-duplicado-de-A. Funcion
// pura sobre una lista ya cargada por el llamante (evita acoplar el motor a Dexie).
export function isPairDecidedNotDuplicate(
  fingerprintA: string,
  fingerprintB: string,
  decisions: ReadonlyArray<{ leftFingerprint: string; rightFingerprint: string }>,
): boolean {
  return decisions.some(
    (d) =>
      (d.leftFingerprint === fingerprintA && d.rightFingerprint === fingerprintB) ||
      (d.leftFingerprint === fingerprintB && d.rightFingerprint === fingerprintA),
  );
}

// Verdadero si alguna decision cubre la pareja (huella del borrador, huella+id del candidato).
// `requireCandidateId`: para niveles de identidad fuerte se exige ADEMAS que la decision
// referencie explicitamente el id de ESTE candidato concreto (no basta con compartir la
// huella tolerante con OTRO candidato que si fue decidido). Para niveles heuristicos basta la
// huella (mas tolerante a que el id cambie entre dispositivos/backups).
function decisionCoversCandidate(
  input: DuplicateEvaluationInput,
  candidateId: string,
  candidateFingerprint: string,
  decisions: ReadonlyArray<NoDuplicateDecisionPair>,
  requireCandidateId: boolean,
): boolean {
  return decisions.some((d) => {
    const fpMatch =
      (d.leftFingerprint === input.normalizedFingerprint && d.rightFingerprint === candidateFingerprint) ||
      (d.leftFingerprint === candidateFingerprint && d.rightFingerprint === input.normalizedFingerprint);
    if (!fpMatch) return false;
    if (!requireCandidateId) return true;
    return d.leftTxId === candidateId || d.rightTxId === candidateId;
  });
}

// Puntua, aplica las decisiones de "no duplicado" y agrega, todo en un solo paso. IMPORTANTE
// (invariante 11 de CLAUDE.md, FINANCIAL_ALGORITHMS seccion 12 — nunca resolver un conflicto
// financiero en silencio, nunca un falso negativo que duplique saldo):
//   - Niveles HEURISTICOS (possible / weak / strongNormalized): se suprimen si la PAREJA DE
//     HUELLAS coincide con una decision, sin exigir el id exacto (tolerante a que el
//     candidato cambie de id entre dispositivos/backups, coherente con que estos niveles ya
//     son heuristicos).
//   - Niveles de identidad FUERTE (exact: mismo bankTransactionId o mismo exactFingerprint;
//     pendingReplaced): SOLO se suprimen si la decision referencia EXPLICITAMENTE el id de
//     ESE candidato concreto. Nunca se suprimen por compartir la huella tolerante con OTRO
//     candidato distinto que si fue decidido: eso silenciaria un duplicado real (misma
//     operacion bancaria) que el usuario nunca revisó.
export function evaluateDuplicatesWithDecisions(
  input: DuplicateEvaluationInput,
  candidates: ExistingTxForDuplicate[],
  decisions: ReadonlyArray<NoDuplicateDecisionPair>,
): DuplicateEvaluation {
  if (decisions.length === 0) return evaluateDuplicates(input, candidates);
  // Mapa unico por candidato (O(n) en vez de un `.find` por candidato dentro del filtro, que
  // seria O(n^2) sobre decenas de miles de movimientos).
  const byId = new Map(candidates.map((c) => [c.id, c] as const));
  const scored = scoreAllCandidates(input, candidates).filter((score) => {
    const isStrongIdentity = score.status === 'exact' || score.status === 'pendingReplaced';
    const candidate = byId.get(score.candidateId);
    if (!candidate) return true;
    const covered = decisionCoversCandidate(
      input,
      score.candidateId,
      candidate.normalizedFingerprint,
      decisions,
      isStrongIdentity,
    );
    return !covered;
  });
  return aggregateScores(scored);
}
