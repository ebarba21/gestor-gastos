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

// Ventana temporal estricta (dias) para la consolidacion AUTOMATICA (opt-in). Mas corta que la
// ventana de sugerencia (TRANSFER_DATE_WINDOW_DAYS): auto-vincular exige mas certeza que
// proponer. Cambiar el valor es un cambio de producto, no un detalle de implementacion.
export const AUTO_CONSOLIDATE_WINDOW_DAYS = 3;

// Un par auto-vinculable ya orientado: aId es la salida (importe negativo) y bId la entrada
// (importe positivo). confidence y dayDiff son orientativos (heuristica), no probabilidad real.
export interface AutoLinkPair {
  aId: string;
  bId: string;
  confidence: number;
  dayDiff: number;
}

// Encuentra pares de transferencia AUTO-VINCULABLES: solo los INEQUIVOCOS. Un par lo es cuando,
// dentro de su grupo de mismo importe absoluto y ventana estricta, cada pata tiene EXACTAMENTE
// UNA contraparte valida y ambas se apuntan entre si (match mutuo unico). Esto evita vincular dos
// movimientos de "-50" cualesquiera: si hay ambiguedad (varias contrapartes posibles), el par se
// descarta y queda para revision manual (nunca se adivina una relacion, invariante 11 de CLAUDE).
// Funcion PURA y determinista (no depende del orden de entrada). El llamante decide cuando usarla
// (opt-in) y sobre que universo (todo el perfil: asi empareja tambien patas que llegan en
// importaciones distintas, p. ej. la de Ibercaja semanas despues de la de Revolut).
export function findAutoLinkablePairs(
  txs: TransferCandidateTx[],
  windowDays: number = AUTO_CONSOLIDATE_WINDOW_DAYS,
): AutoLinkPair[] {
  const eligible = txs.filter(
    (t) => t.type !== 'transfer' && t.transferGroupId === null && t.amountCents !== 0,
  );
  const byAbsAmount = new Map<number, TransferCandidateTx[]>();
  for (const t of eligible) {
    const key = Math.abs(t.amountCents);
    const list = byAbsAmount.get(key) ?? [];
    list.push(t);
    byAbsAmount.set(key, list);
  }

  const result: AutoLinkPair[] = [];
  for (const group of byAbsAmount.values()) {
    if (group.length < 2) continue;
    // Aristas validas dentro del grupo: pares que cumplen los requisitos duros y la ventana
    // estricta. partners[id] = lista de contrapartes validas de ese id.
    const partners = new Map<string, { partnerId: string; score: TransferPairScore }[]>();
    const push = (id: string, partnerId: string, score: TransferPairScore) => {
      const list = partners.get(id);
      if (list) list.push({ partnerId, score });
      else partners.set(id, [{ partnerId, score }]);
    };
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const score = scoreTransferPair(group[i]!, group[j]!);
        if (!score || score.dayDiff > windowDays) continue;
        push(group[i]!.id, group[j]!.id, score);
        push(group[j]!.id, group[i]!.id, score);
      }
    }

    const seen = new Set<string>();
    for (const [id, list] of partners) {
      if (list.length !== 1) continue; // esta pata tiene contraparte ambigua o ninguna
      const { partnerId, score } = list[0]!;
      const partnerList = partners.get(partnerId);
      // La contraparte tambien debe tener exactamente una: este id (match mutuo unico).
      if (!partnerList || partnerList.length !== 1 || partnerList[0]!.partnerId !== id) continue;
      const pairKey = [id, partnerId].sort().join(':');
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);
      const t1 = group.find((t) => t.id === id)!;
      const t2 = group.find((t) => t.id === partnerId)!;
      const out = t1.amountCents < 0 ? t1 : t2; // salida (negativo)
      const inc = t1.amountCents < 0 ? t2 : t1; // entrada (positivo)
      result.push({ aId: out.id, bId: inc.id, confidence: score.confidence, dayDiff: score.dayDiff });
    }
  }

  // Orden determinista (independiente del orden de entrada).
  result.sort((x, y) => (x.aId + x.bId).localeCompare(y.aId + y.bId));
  return result;
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
