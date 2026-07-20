// Motor de deteccion de reembolsos candidatos (ampliacion, fase 6). Ver DATA_MODEL seccion 16,
// seccion 6.3, y ARCHITECTURE seccion 17. HOY NO EXISTE deteccion automatica: el MVP solo
// permite el enlace manual (transactionService.markAsRefund) mediante busqueda libre por
// concepto (RefundModal). Este motor detecta pares candidatos (gasto original + posible
// reembolso) para proponerlos en la bandeja de revision, sin vincularlos automaticamente.
//
// Mismo patron que duplicateEngine.ts/transferCandidateEngine.ts: MOTOR PURO, determinista,
// confianza heuristica orientativa por mil (0..1000), nunca probabilidad real.
export const REFUND_DATE_WINDOW_DAYS = 60;

export type RefundReasonCode =
  | 'oppositeAmounts'
  | 'sameMerchant'
  | 'sameNormalizedConcept'
  | 'laterDate';

export const REFUND_REASON_CODE_LABELS: Record<RefundReasonCode, string> = {
  oppositeAmounts: 'Importe opuesto (parcial o total)',
  sameMerchant: 'Mismo comercio',
  sameNormalizedConcept: 'Mismo concepto normalizado',
  laterDate: 'Fecha posterior al gasto original',
};

// Forma minima de un gasto original candidato a tener un reembolso.
export interface RefundOriginalTx {
  id: string;
  amountCents: number; // negativo (gasto)
  date: string; // YYYY-MM-DD
  normalizedConcept: string;
  merchantId: string | null;
  refundOfId: string | null;
}

// Forma minima de un movimiento candidato a SER un reembolso.
export interface RefundCandidateTx {
  id: string;
  amountCents: number; // positivo (dinero que vuelve)
  date: string; // YYYY-MM-DD
  normalizedConcept: string;
  merchantId: string | null;
  refundOfId: string | null;
}

export interface RefundPairScore {
  originalId: string;
  confidence: number; // 0..1000, heuristica orientativa (no probabilidad real)
  reasonCodes: RefundReasonCode[];
  dayDiff: number;
}

function daysBetweenIso(a: string, b: string): number {
  const ta = Date.parse(`${a}T00:00:00.000Z`);
  const tb = Date.parse(`${b}T00:00:00.000Z`);
  return Math.round((ta - tb) / 86_400_000);
}

// Puntua si `candidate` (dinero que vuelve) es un reembolso candidato de `original` (un gasto
// anterior). Funcion PURA y determinista. Devuelve null si no cumple los requisitos duros
// (DATA_MODEL 6.3: importes opuestos -parcial o total-, mismo comercio o concepto, fecha
// posterior dentro de ventana) o si alguno ya esta vinculado a otro reembolso/gasto.
export function scoreRefundPair(
  original: RefundOriginalTx,
  candidate: RefundCandidateTx,
): RefundPairScore | null {
  if (original.id === candidate.id) return null;
  // Ya vinculado (a este u otro gasto/reembolso): no es candidato, es un hecho.
  if (original.refundOfId !== null || candidate.refundOfId !== null) return null;
  if (original.amountCents >= 0 || candidate.amountCents <= 0) return null;
  // "Parcial o total": el reembolso nunca puede superar el gasto original en valor absoluto.
  if (candidate.amountCents > Math.abs(original.amountCents)) return null;

  const dayDiff = daysBetweenIso(candidate.date, original.date);
  // El reembolso es SIEMPRE posterior (o el mismo dia) al gasto original.
  if (dayDiff < 0) return null;
  if (dayDiff > REFUND_DATE_WINDOW_DAYS) return null;

  const sameMerchant = original.merchantId !== null && original.merchantId === candidate.merchantId;
  const sameConcept = original.normalizedConcept === candidate.normalizedConcept;
  // Sin comercio ni concepto compartido no hay senal suficiente para proponer el par (evita
  // proponer cualquier ingreso posterior como reembolso de cualquier gasto del mismo importe).
  if (!sameMerchant && !sameConcept) return null;

  const reasonCodes: RefundReasonCode[] = ['oppositeAmounts'];
  if (sameMerchant) reasonCodes.push('sameMerchant');
  if (sameConcept) reasonCodes.push('sameNormalizedConcept');
  if (dayDiff > 0) reasonCodes.push('laterDate');

  // Confianza: base alta si comparten comercio (mas fiable que solo el concepto), decae con la
  // distancia en dias sin bajar del suelo de la ventana.
  const base = sameMerchant ? 900 : 700;
  const confidence = Math.max(300, base - dayDiff * 5);

  return {
    originalId: original.id,
    confidence,
    reasonCodes,
    dayDiff,
  };
}

// Puntua un candidato a reembolso contra una lista de gastos originales YA ACOTADA por el
// llamante (importe <= abs(gasto), ventana temporal amplia). Determinista.
export function scoreAllRefundCandidates(
  candidate: RefundCandidateTx,
  originals: RefundOriginalTx[],
): RefundPairScore[] {
  const scored: RefundPairScore[] = [];
  for (const original of originals) {
    const score = scoreRefundPair(original, candidate);
    if (score !== null) scored.push(score);
  }
  return scored.sort((x, y) => {
    if (y.confidence !== x.confidence) return y.confidence - x.confidence;
    return x.originalId.localeCompare(y.originalId);
  });
}
