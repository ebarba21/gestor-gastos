// Motor de deteccion de transferencias candidatas (ampliacion, fase 6). Ver DATA_MODEL seccion
// 16 y ARCHITECTURE seccion 17. HOY NO EXISTE deteccion automatica de transferencias: el MVP
// solo permite crear el par manualmente (transactionService.createTransfer). Este motor detecta
// pares YA EXISTENTES que probablemente sean la misma transferencia interna sin vincular
// todavia (dos movimientos sueltos con `transferGroupId = null`), para proponerlos en la
// bandeja de revision.
//
// Mismo patron que duplicateEngine.ts: MOTOR PURO (sin acceso a datos ni React), determinista,
// confianza heuristica orientativa por mil (0..1000), NUNCA una probabilidad real. La
// orquestacion (generar candidatos acotados por importe/ventana temporal) la hace el llamante
// (reviewService), que nunca compara todo contra todo.
import type { TransactionType } from '../db/schema';

// Ventana de tolerancia de fecha (dias, inclusive) entre las dos patas. Documentada
// explicitamente: cambiar el valor es un cambio de producto, no un detalle de implementacion.
export const TRANSFER_DATE_WINDOW_DAYS = 5;

export type TransferReasonCode =
  | 'sameAbsoluteAmount'
  | 'oppositeSigns'
  | 'differentAccounts'
  | 'closeDates';

export const TRANSFER_REASON_CODE_LABELS: Record<TransferReasonCode, string> = {
  sameAbsoluteAmount: 'Mismo importe en valor absoluto',
  oppositeSigns: 'Signos opuestos (salida y entrada)',
  differentAccounts: 'Cuentas distintas',
  closeDates: 'Fechas proximas',
};

// Forma minima de un movimiento candidato a formar parte de una transferencia. El llamante la
// construye a partir de un `Transaction` real.
export interface TransferCandidateTx {
  id: string;
  accountId: string;
  amountCents: number; // con signo: gasto negativo, ingreso positivo
  date: string; // YYYY-MM-DD
  type: TransactionType;
  transferGroupId: string | null;
}

export interface TransferPairScore {
  // El otro movimiento de la pareja candidata.
  counterpartId: string;
  confidence: number; // 0..1000, heuristica orientativa (no probabilidad real)
  reasonCodes: TransferReasonCode[];
  dayDiff: number;
}

function daysBetweenIso(a: string, b: string): number {
  const ta = Date.parse(`${a}T00:00:00.000Z`);
  const tb = Date.parse(`${b}T00:00:00.000Z`);
  return Math.round((ta - tb) / 86_400_000);
}

// Puntua si dos movimientos EXISTENTES forman una pareja de transferencia candidata. Funcion
// PURA y determinista. Devuelve null si no cumplen los requisitos duros (DATA_MODEL 16 /
// ARCHITECTURE seccion 17: mismo importe absoluto, signos opuestos, cuentas distintas, fechas
// proximas) o si alguno ya pertenece a una transferencia vinculada.
export function scoreTransferPair(
  a: TransferCandidateTx,
  b: TransferCandidateTx,
): TransferPairScore | null {
  if (a.id === b.id) return null;
  // Ya vinculados (a una transferencia, la misma u otra): no son candidatos, son un hecho.
  if (a.transferGroupId !== null || b.transferGroupId !== null) return null;
  // Una transferencia mueve dinero entre DOS CUENTAS PROPIAS: si ya son 'transfer' de otro
  // grupo no aplica aqui (transferGroupId ya not null se descarta arriba); si son 'transfer'
  // sin grupo es un dato inconsistente que no genera candidato (nunca se asume una relacion).
  if (a.type === 'transfer' || b.type === 'transfer') return null;
  if (a.accountId === b.accountId) return null;
  if (a.amountCents === 0 || b.amountCents === 0) return null;
  if (Math.abs(a.amountCents) !== Math.abs(b.amountCents)) return null;
  const sameSign = (a.amountCents > 0) === (b.amountCents > 0);
  if (sameSign) return null;

  const dayDiff = Math.abs(daysBetweenIso(a.date, b.date));
  if (dayDiff > TRANSFER_DATE_WINDOW_DAYS) return null;

  const reasonCodes: TransferReasonCode[] = ['sameAbsoluteAmount', 'oppositeSigns', 'differentAccounts'];
  if (dayDiff > 0) reasonCodes.push('closeDates');
  // La confianza decae con la distancia en dias, sin bajar del suelo de la ventana.
  const confidence = Math.max(500, 950 - dayDiff * 90);

  return {
    counterpartId: b.id,
    confidence,
    reasonCodes,
    dayDiff,
  };
}

// Puntua un movimiento contra una lista de candidatos YA ACOTADA por el llamante (mismo
// importe absoluto, ventana temporal amplia). Determinista: no depende del orden de entrada.
export function scoreAllTransferCandidates(
  tx: TransferCandidateTx,
  candidates: TransferCandidateTx[],
): TransferPairScore[] {
  const scored: TransferPairScore[] = [];
  for (const candidate of candidates) {
    const score = scoreTransferPair(tx, candidate);
    if (score !== null) scored.push(score);
  }
  // Determinista: mayor confianza primero; empate por id del contraparte.
  return scored.sort((x, y) => {
    if (y.confidence !== x.confidence) return y.confidence - x.confidence;
    return x.counterpartId.localeCompare(y.counterpartId);
  });
}
