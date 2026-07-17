// Servicio de la bandeja de revision (ampliacion, fase 6). Ver DATA_MODEL seccion 16 y
// ARCHITECTURE seccion 17: unifica en una cola las excepciones de import, reglas, duplicados,
// transferencias/reembolsos candidatos, comercios nuevos, errores de importacion y conflictos
// de sincronizacion. La generacion es idempotente: como mucho una tarea ABIERTA por
// (profileId, type, entityId) (ver reviewItemsRepo.findOpenByTypeAndEntity y el indice unico
// parcial remoto). Nunca se resuelve un conflicto financiero en silencio (invariante 11): las
// resoluciones las decide la persona desde la bandeja; este modulo solo GENERA y gestiona el
// ciclo de vida de las tareas.
import type {
  Conflict,
  ReviewItem,
  ReviewItemEntityType,
  ReviewItemStatus,
  ReviewItemType,
  Transaction,
} from '../db/schema';
import { now } from '../db/index';
import { reviewItemsRepo } from '../db/reviewItemsRepo';
import { transactionsRepo } from '../db/transactionsRepo';
import type { Rule } from '../db/schema';
import {
  estimateRuleMatchConfidence,
  matchingConditionIndexes,
  LOW_CONFIDENCE_THRESHOLD,
  type EvaluableTransaction,
} from './ruleService';
import {
  scoreAllTransferCandidates,
  type TransferCandidateTx,
} from './transferCandidateEngine';
import {
  scoreAllRefundCandidates,
  type RefundCandidateTx,
  type RefundOriginalTx,
} from './refundCandidateEngine';
import { NotFoundError, requireId, requireProfileId } from '../lib/validation';

// Umbral de antiguedad (dias) para considerar un movimiento pendiente como "pendiente antiguo".
export const STALE_PENDING_THRESHOLD_DAYS = 14;

// Etiquetas legibles para la UI (bandeja, resumen post-importacion, contadores).
export const REVIEW_TYPE_LABELS: Record<ReviewItemType, string> = {
  uncategorized: 'Sin categorizar',
  lowConfidenceRule: 'Regla de baja confianza',
  possibleDuplicate: 'Posible duplicado',
  transferCandidate: 'Transferencia candidata',
  refundCandidate: 'Reembolso candidato',
  stalePending: 'Pendiente antiguo',
  newMerchant: 'Comercio nuevo',
  importError: 'Error de importacion',
  syncConflict: 'Conflicto de sincronizacion',
  recurringAnomaly: 'Anomalia recurrente',
};

export const REVIEW_STATUS_LABELS: Record<ReviewItemStatus, string> = {
  open: 'Abierta',
  snoozed: 'Aplazada',
  resolved: 'Resuelta',
  dismissed: 'Descartada',
};

// Detalle de una fila de importacion que no se pudo convertir en movimiento (fila/campo/valor/
// motivo). Se agregan todas las de un mismo lote en UNA tarea de revision (metadata.errors),
// no una tarea por fila: `entityId` remoto es UUID y una fila fallida no tiene Transaction.
export interface ImportRowError {
  row: number;
  field: string;
  value: string;
  reason: string;
}

function daysBetweenIsoAndNow(dateIso: string): number {
  const t = Date.parse(`${dateIso}T00:00:00.000Z`);
  return Math.floor((Date.now() - t) / 86_400_000);
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

interface UpsertData {
  confidence?: number;
  reasonCodes?: string[];
  metadata?: Record<string, unknown>;
}

// Crea o actualiza (nunca duplica) la tarea ABIERTA para (type, entityId). Si ya existe una
// tarea RESUELTA/DESCARTADA para la misma entidad y los datos nuevos coinciden exactamente con
// los que la originaron, NO se reabre (respeta la decision del usuario; DATA_MODEL 16: la
// generacion es idempotente, no un sondeo que resucita tareas ya atendidas).
export async function upsertOpenReviewItem(
  profileId: string,
  type: ReviewItemType,
  entityType: ReviewItemEntityType,
  entityId: string,
  data: UpsertData,
): Promise<ReviewItem> {
  const confidence = data.confidence ?? 0;
  const reasonCodes = data.reasonCodes ?? [];
  const metadata = data.metadata ?? {};

  const open = await reviewItemsRepo.findOpenByTypeAndEntity(profileId, type, entityId);
  if (open) {
    if (
      open.confidence === confidence &&
      sameJson(open.reasonCodes, reasonCodes) &&
      sameJson(open.metadata, metadata)
    ) {
      return open; // nada cambio: no reescribe (evita ruido de updatedAt/outbox)
    }
    return reviewItemsRepo.update(profileId, open.id, { confidence, reasonCodes, metadata });
  }

  const latest = await reviewItemsRepo.findLatestByTypeAndEntity(profileId, type, entityId);
  if (latest && (latest.status === 'resolved' || latest.status === 'dismissed')) {
    const unchanged = sameJson(latest.reasonCodes, reasonCodes) && sameJson(latest.metadata, metadata);
    if (unchanged) return latest;
  }

  return reviewItemsRepo.create(profileId, {
    type,
    entityType,
    entityId,
    confidence,
    reasonCodes,
    metadata,
    status: 'open',
    resolution: null,
    resolvedAt: null,
  });
}

// Agrupa movimientos sin comercio por concepto normalizado (mismo criterio que la agrupacion de
// candidatos de comercios, src/components/merchants/CandidateGroupsModal.tsx) y genera UNA
// tarea "newMerchant" por concepto distinto, referenciando un movimiento representativo.
async function upsertNewMerchantGroups(profileId: string, candidates: Transaction[]): Promise<void> {
  const eligible = candidates.filter((t) => t.merchantId === null && t.type !== 'transfer');
  const byConcept = new Map<string, Transaction[]>();
  for (const t of eligible) {
    const list = byConcept.get(t.normalizedConcept) ?? [];
    list.push(t);
    byConcept.set(t.normalizedConcept, list);
  }
  for (const [concept, txs] of byConcept) {
    const sorted = [...txs].sort((a, b) => a.id.localeCompare(b.id));
    const [representative, ...rest] = sorted;
    await upsertOpenReviewItem(profileId, 'newMerchant', 'transaction', representative.id, {
      metadata: { normalizedConcept: concept, sampleTransactionIds: rest.map((t) => t.id) },
    });
  }
}

function toEvaluableTransaction(tx: Transaction): EvaluableTransaction {
  return {
    concept: tx.concept,
    amountCents: tx.amountCents,
    date: tx.date,
    accountId: tx.accountId,
    type: tx.type,
    merchantId: tx.merchantId,
  };
}

function toTransferCandidateTx(tx: Transaction): TransferCandidateTx {
  return {
    id: tx.id,
    accountId: tx.accountId,
    amountCents: tx.amountCents,
    date: tx.date,
    type: tx.type,
    transferGroupId: tx.transferGroupId,
  };
}

function toRefundOriginalTx(tx: Transaction): RefundOriginalTx {
  return {
    id: tx.id,
    amountCents: tx.amountCents,
    date: tx.date,
    normalizedConcept: tx.normalizedConcept,
    merchantId: tx.merchantId,
    refundOfId: tx.refundOfId,
  };
}

function toRefundCandidateTx(tx: Transaction): RefundCandidateTx {
  return {
    id: tx.id,
    amountCents: tx.amountCents,
    date: tx.date,
    normalizedConcept: tx.normalizedConcept,
    merchantId: tx.merchantId,
    refundOfId: tx.refundOfId,
  };
}

// ---------------------------------------------------------------------------
// Generadores (event-driven, ARCHITECTURE seccion 17). Todos idempotentes.
// ---------------------------------------------------------------------------

// Disparado tras el commit de una importacion (ImportSection, tras importService.commit):
// sin categorizar, posible duplicado (el motor de fase 5 ya calculo duplicateStatus), comercio
// nuevo (agrupado) y errores de fila del propio lote.
async function generateFromImportBatch(
  profileId: string,
  batchId: string,
  transactions: Transaction[],
  rowErrors: ImportRowError[] = [],
): Promise<void> {
  requireProfileId(profileId);
  for (const tx of transactions) {
    if (tx.type !== 'transfer' && !tx.isSplitParent && tx.categoryId === null) {
      await upsertOpenReviewItem(profileId, 'uncategorized', 'transaction', tx.id, {});
    }
    if (tx.duplicateStatus === 'possible' || tx.duplicateStatus === 'weak') {
      await upsertOpenReviewItem(profileId, 'possibleDuplicate', 'transaction', tx.id, {
        confidence: tx.duplicateConfidence,
        reasonCodes: tx.duplicateReasonCodes,
        metadata: { candidateIds: tx.duplicateCandidateIds },
      });
    }
  }
  await upsertNewMerchantGroups(profileId, transactions);
  if (rowErrors.length > 0) {
    await upsertOpenReviewItem(profileId, 'importError', 'importBatch', batchId, {
      metadata: { errors: rowErrors },
    });
  }
}

// Disparado tras evaluar/aplicar reglas a un conjunto de movimientos (auto o retroactivo):
// genera (o cierra automaticamente) tareas "lowConfidenceRule" segun la confianza estimada de
// la coincidencia (src/services/ruleService.ts). Cerrar automaticamente una tarea cuya causa ya
// no aplica (la regla mejoro) no es "resolver en silencio" un dato financiero: la
// categorizacion en si nunca la decide este modulo, solo la senal de revision sobre ELLA.
async function generateFromRuleMatches(
  profileId: string,
  transactions: Transaction[],
  rules: Rule[],
): Promise<void> {
  requireProfileId(profileId);
  const rulesById = new Map(rules.map((r) => [r.id, r] as const));
  for (const tx of transactions) {
    if (tx.categorizedBy !== 'rule' || tx.ruleId === null) continue;
    const rule = rulesById.get(tx.ruleId);
    if (!rule) continue;
    const matchedIndexes = matchingConditionIndexes(rule, toEvaluableTransaction(tx));
    const confidence = estimateRuleMatchConfidence(rule, matchedIndexes);
    if (confidence < LOW_CONFIDENCE_THRESHOLD) {
      await upsertOpenReviewItem(profileId, 'lowConfidenceRule', 'transaction', tx.id, {
        confidence,
        metadata: { ruleId: rule.id },
      });
    } else {
      const open = await reviewItemsRepo.findOpenByTypeAndEntity(profileId, 'lowConfidenceRule', tx.id);
      if (open) {
        await reviewItemsRepo.update(profileId, open.id, {
          status: 'resolved',
          resolution: 'auto:confidence-improved',
          resolvedAt: now(),
        });
      }
    }
  }
}

// Disparado tras crear/actualizar un Conflict de sincronizacion (src/sync/conflictsRepo.ts).
// entityId referencia el propio Conflict (entityType='conflict'), nunca la entidad financiera
// en conflicto directamente: el conflicto ya guarda esa referencia (Conflict.entityType/
// entityId) y es el objeto que la persona debe resolver (invariante 11).
async function generateFromConflict(conflict: Conflict): Promise<void> {
  await upsertOpenReviewItem(conflict.profileId, 'syncConflict', 'conflict', conflict.id, {
    metadata: { conflictEntityType: conflict.entityType, conflictEntityId: conflict.entityId },
  });
}

// --- Escaneos bajo demanda (no ligados a un evento puntual: comparan contra el historico). ---

async function generatePossibleDuplicates(profileId: string): Promise<void> {
  requireProfileId(profileId);
  const [possible, weak] = await Promise.all([
    transactionsRepo.listByDuplicateStatus(profileId, 'possible'),
    transactionsRepo.listByDuplicateStatus(profileId, 'weak'),
  ]);
  for (const tx of [...possible, ...weak]) {
    await upsertOpenReviewItem(profileId, 'possibleDuplicate', 'transaction', tx.id, {
      confidence: tx.duplicateConfidence,
      reasonCodes: tx.duplicateReasonCodes,
      metadata: { candidateIds: tx.duplicateCandidateIds },
    });
  }
}

async function generateNewMerchantCandidates(profileId: string): Promise<void> {
  requireProfileId(profileId);
  const withoutMerchant = await transactionsRepo.listWithoutMerchant(profileId);
  await upsertNewMerchantGroups(profileId, withoutMerchant);
}

async function generateStalePending(
  profileId: string,
  thresholdDays: number = STALE_PENDING_THRESHOLD_DAYS,
): Promise<void> {
  requireProfileId(profileId);
  const all = await transactionsRepo.list(profileId);
  for (const tx of all) {
    if (!tx.pending) continue;
    const ageDays = daysBetweenIsoAndNow(tx.date);
    if (ageDays >= thresholdDays) {
      await upsertOpenReviewItem(profileId, 'stalePending', 'transaction', tx.id, {
        metadata: { ageDays },
      });
    }
  }
}

// Genera candidatos de transferencia acotando por importe absoluto (nunca compara todo contra
// todo, FINANCIAL_ALGORITHMS seccion 5 principio equivalente para duplicados). Una tarea por
// PAREJA (no una por movimiento): se ancla en el primer movimiento visto de cada pareja.
async function generateTransferCandidates(profileId: string): Promise<void> {
  requireProfileId(profileId);
  const all = await transactionsRepo.list(profileId);
  const eligible = all.filter((t) => t.type !== 'transfer' && t.transferGroupId === null);
  const byAbsAmount = new Map<number, Transaction[]>();
  for (const t of eligible) {
    if (t.amountCents === 0) continue;
    const key = Math.abs(t.amountCents);
    const list = byAbsAmount.get(key) ?? [];
    list.push(t);
    byAbsAmount.set(key, list);
  }
  const seenPairs = new Set<string>();
  for (const group of byAbsAmount.values()) {
    if (group.length < 2) continue;
    const asCandidates = group.map(toTransferCandidateTx);
    for (const tx of group) {
      const others = asCandidates.filter((c) => c.id !== tx.id);
      const scores = scoreAllTransferCandidates(toTransferCandidateTx(tx), others);
      const best = scores[0];
      if (!best) continue;
      const pairKey = [tx.id, best.counterpartId].sort().join(':');
      if (seenPairs.has(pairKey)) continue;
      seenPairs.add(pairKey);
      await upsertOpenReviewItem(profileId, 'transferCandidate', 'transaction', tx.id, {
        confidence: best.confidence,
        reasonCodes: best.reasonCodes,
        metadata: { counterpartId: best.counterpartId },
      });
    }
  }
}

// Genera candidatos de reembolso: para cada ingreso sin refundOfId, busca el mejor gasto
// original candidato. Una tarea por movimiento candidato (ancla en el reembolso, no en el
// gasto: es la entidad "nueva" que hay que revisar).
async function generateRefundCandidates(profileId: string): Promise<void> {
  requireProfileId(profileId);
  const all = await transactionsRepo.list(profileId);
  const originals = all
    .filter((t) => t.amountCents < 0 && t.refundOfId === null)
    .map(toRefundOriginalTx);
  const candidates = all.filter((t) => t.amountCents > 0 && t.refundOfId === null);
  for (const c of candidates) {
    const scores = scoreAllRefundCandidates(toRefundCandidateTx(c), originals);
    const best = scores[0];
    if (!best) continue;
    await upsertOpenReviewItem(profileId, 'refundCandidate', 'transaction', c.id, {
      confidence: best.confidence,
      reasonCodes: best.reasonCodes,
      metadata: { originalId: best.originalId },
    });
  }
}

// Escaneo completo bajo demanda (boton "Buscar tareas pendientes" en la bandeja, y una vez
// automatica por perfil). NO se ejecuta dentro de la migracion de esquema Dexie (ver
// src/db/index.ts version(7)): es una operacion de negocio explicita, nunca en silencio.
async function runFullScan(profileId: string): Promise<void> {
  requireProfileId(profileId);
  await generatePossibleDuplicates(profileId);
  await generateNewMerchantCandidates(profileId);
  await generateStalePending(profileId);
  await generateTransferCandidates(profileId);
  await generateRefundCandidates(profileId);
}

// ---------------------------------------------------------------------------
// Acciones sobre una tarea (resolver, descartar, aplazar, reabrir/deshacer, masivas).
// ---------------------------------------------------------------------------

async function requireOwned(profileId: string, id: string): Promise<ReviewItem> {
  const item = await reviewItemsRepo.getById(profileId, id);
  if (!item) throw new NotFoundError(`ReviewItem ${id} no existe en el perfil ${profileId}.`);
  return item;
}

// Marca una tarea como resuelta. `resolution` es un codigo corto (p. ej. 'categorized',
// 'linked:transfer'); el detalle de la accion aplicada (si aporta alguno) va en
// `metadataPatch`, fusionado con la metadata existente (nunca la sustituye entera).
async function resolve(
  profileId: string,
  id: string,
  resolution: string,
  metadataPatch?: Record<string, unknown>,
): Promise<ReviewItem> {
  requireProfileId(profileId);
  requireId(id);
  const current = await requireOwned(profileId, id);
  return reviewItemsRepo.update(profileId, id, {
    status: 'resolved',
    resolution,
    resolvedAt: now(),
    metadata: metadataPatch ? { ...current.metadata, ...metadataPatch } : current.metadata,
  });
}

async function dismiss(profileId: string, id: string, reason: string = 'dismissed'): Promise<ReviewItem> {
  requireProfileId(profileId);
  requireId(id);
  await requireOwned(profileId, id);
  return reviewItemsRepo.update(profileId, id, {
    status: 'dismissed',
    resolution: reason,
    resolvedAt: now(),
  });
}

async function snooze(profileId: string, id: string, untilMs: number): Promise<ReviewItem> {
  requireProfileId(profileId);
  requireId(id);
  const current = await requireOwned(profileId, id);
  return reviewItemsRepo.update(profileId, id, {
    status: 'snoozed',
    metadata: { ...current.metadata, snoozedUntil: untilMs },
  });
}

// Reabre una tarea resuelta/descartada/aplazada. Es tambien el "deshacer" de una resolucion: la
// tarea vuelve a 'open' sin resolucion ni fecha de resolucion. No revierte por si sola ninguna
// accion aplicada sobre la entidad referida (p. ej. una categorizacion ya guardada): esa accion
// tiene su propio deshacer via el toast de la pantalla de movimientos (ARCHITECTURE seccion 8).
async function reopen(profileId: string, id: string): Promise<ReviewItem> {
  requireProfileId(profileId);
  requireId(id);
  await requireOwned(profileId, id);
  return reviewItemsRepo.update(profileId, id, {
    status: 'open',
    resolution: null,
    resolvedAt: null,
  });
}

const undo = reopen;

async function bulkResolve(profileId: string, ids: string[], resolution: string): Promise<ReviewItem[]> {
  requireProfileId(profileId);
  return reviewItemsRepo.bulkUpdateStatus(profileId, ids, { status: 'resolved', resolution });
}

async function bulkDismiss(profileId: string, ids: string[], reason: string = 'dismissed'): Promise<ReviewItem[]> {
  requireProfileId(profileId);
  return reviewItemsRepo.bulkUpdateStatus(profileId, ids, { status: 'dismissed', resolution: reason });
}

// ---------------------------------------------------------------------------
// Consultas para la UI (contadores, filtros, busqueda, orden).
// ---------------------------------------------------------------------------

export interface ReviewInboxFilters {
  status?: ReviewItemStatus;
  type?: ReviewItemType;
  search?: string;
  sort?: 'newest' | 'oldest' | 'confidence';
}

async function listInbox(profileId: string, filters: ReviewInboxFilters = {}): Promise<ReviewItem[]> {
  requireProfileId(profileId);
  const status = filters.status ?? 'open';
  let rows = await reviewItemsRepo.listByStatus(profileId, status);
  if (filters.type) rows = rows.filter((r) => r.type === filters.type);
  if (filters.search && filters.search.trim().length > 0) {
    const q = filters.search.trim().toLocaleLowerCase();
    rows = rows.filter(
      (r) =>
        r.type.toLocaleLowerCase().includes(q) ||
        (r.resolution ?? '').toLocaleLowerCase().includes(q) ||
        r.reasonCodes.some((c) => c.toLocaleLowerCase().includes(q)),
    );
  }
  const sort = filters.sort ?? 'newest';
  return [...rows].sort((a, b) => {
    if (sort === 'oldest') return a.createdAt - b.createdAt;
    if (sort === 'confidence') return b.confidence - a.confidence || b.createdAt - a.createdAt;
    return b.createdAt - a.createdAt;
  });
}

async function countsByType(
  profileId: string,
): Promise<{ total: number; byType: Partial<Record<ReviewItemType, number>> }> {
  requireProfileId(profileId);
  const byType = await reviewItemsRepo.countOpenByType(profileId);
  const total = Object.values(byType).reduce((sum: number, n) => sum + (n ?? 0), 0);
  return { total, byType };
}

export const reviewService = {
  generateFromImportBatch,
  generateFromRuleMatches,
  generateFromConflict,
  generatePossibleDuplicates,
  generateNewMerchantCandidates,
  generateStalePending,
  generateTransferCandidates,
  generateRefundCandidates,
  runFullScan,
  resolve,
  dismiss,
  snooze,
  reopen,
  undo,
  bulkResolve,
  bulkDismiss,
  listInbox,
  countsByType,
};

// Reexportado para que src/sync/conflictsRepo.ts (device-local) no necesite importar el
// servicio completo, solo el generador puntual que le corresponde.
export { generateFromConflict };
