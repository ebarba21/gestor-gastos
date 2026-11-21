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
  | 'laterDate'
  | 'splitShare';

export const REFUND_REASON_CODE_LABELS: Record<RefundReasonCode, string> = {
  oppositeAmounts: 'Importe opuesto (parcial o total)',
  sameMerchant: 'Mismo comercio',
  sameNormalizedConcept: 'Mismo concepto normalizado',
  laterDate: 'Fecha posterior al gasto original',
  splitShare: 'Bizum que cuadra con una parte del gasto',
};

// Bizum de reparto (noviembre 2026): pagas una cena de 80 EUR y un amigo te manda un Bizum de
// 40 (o 20, si erais cuatro). No comparte comercio ni concepto con el gasto, asi que el motor
// clasico no lo propone. Aqui se acepta si el importe es el gasto entre N (2..6), o el gasto
// entero (N = 1), con un margen de 1 centimo por persona por redondeo, y llega pocos dias
// despues. Es una SUGERENCIA para la bandeja: nunca se enlaza sola.
export const SPLIT_SHARE_MAX_PEOPLE = 6;
export const SPLIT_SHARE_WINDOW_DAYS = 10;

// Concepto de un Bizum recibido (Ibercaja, Revolut "Dinero anadido a traves de BIZUM"...).
export function isBizumConcept(normalizedConcept: string): boolean {
  return normalizedConcept.toLowerCase().includes('bizum');
}

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
  shareOf?: number; // solo Bizum de reparto: el gasto entre cuantas personas
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

// Puntua si `candidate` (un Bizum recibido) es la parte de un gasto compartido `original`.
// `alreadyLinkedCents`: lo que otros reembolsos ya devolvieron de ese gasto (no se puede devolver
// mas que el gasto). PURA y determinista.
export function scoreSplitSharePair(
  original: RefundOriginalTx,
  candidate: RefundCandidateTx,
  alreadyLinkedCents = 0,
): RefundPairScore | null {
  if (original.id === candidate.id) return null;
  if (original.refundOfId !== null || candidate.refundOfId !== null) return null;
  if (original.amountCents >= 0 || candidate.amountCents <= 0) return null;
  if (!isBizumConcept(candidate.normalizedConcept)) return null;
  // El gasto original no es otro Bizum (enviar y recibir Bizums no es un reparto de gasto).
  if (isBizumConcept(original.normalizedConcept)) return null;
  const expense = Math.abs(original.amountCents);
  if (alreadyLinkedCents + candidate.amountCents > expense) return null;
  const dayDiff = daysBetweenIso(candidate.date, original.date);
  if (dayDiff < 0 || dayDiff > SPLIT_SHARE_WINDOW_DAYS) return null;
  let shareOf: number | null = null;
  for (let n = 2; n <= SPLIT_SHARE_MAX_PEOPLE; n++) {
    if (Math.abs(candidate.amountCents * n - expense) <= n) {
      shareOf = n;
      break;
    }
  }
  if (shareOf === null && candidate.amountCents === expense) shareOf = 1;
  if (shareOf === null) return null;
  const base = shareOf === 1 ? 550 : 600;
  return {
    originalId: original.id,
    confidence: Math.max(300, base - dayDiff * 20),
    reasonCodes: ['oppositeAmounts', 'splitShare', ...(dayDiff > 0 ? (['laterDate'] as const) : [])],
    dayDiff,
    shareOf,
  };
}

// Mejor gasto del que un Bizum recibido puede ser la parte. Empates: el mas cercano en fecha, y
// despues el de mayor confianza y el id (determinista).
export function bestSplitShareCandidate(
  candidate: RefundCandidateTx,
  originals: RefundOriginalTx[],
  linkedByOriginal: ReadonlyMap<string, number> = new Map(),
): RefundPairScore | null {
  let best: RefundPairScore | null = null;
  for (const o of originals) {
    const s = scoreSplitSharePair(o, candidate, linkedByOriginal.get(o.id) ?? 0);
    if (s === null) continue;
    if (
      best === null ||
      s.confidence > best.confidence ||
      (s.confidence === best.confidence && s.originalId.localeCompare(best.originalId) < 0)
    ) {
      best = s;
    }
  }
  return best;
}
