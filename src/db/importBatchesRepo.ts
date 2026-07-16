// Repositorio de lotes de importacion (ImportBatch). Exige profileId.
// Ver DATA_MODEL 2.10. Permite trazabilidad, atomicidad del commit y deshacer un lote.
import type { ImportBatch, ImportBatchStatus, NoDuplicateDecision, Transaction } from './schema';
import { db, newId, now, syncDefaults } from './index';
import { createProfileRepo, isAlive } from './baseRepo';
import { enqueueMutation, ownerOfProfile } from './outboxWrite';
import { buildTransactionEntity } from './transactionsRepo';
import type { NewTransaction } from './transactionsRepo';
import { noDuplicateDecisionsRepo } from './noDuplicateDecisionsRepo';
import { NotFoundError, requireId, requireProfileId } from '../lib/validation';

const base = createProfileRepo<ImportBatch>(db.importBatches, 'ImportBatch', 'importBatch');

// Datos del lote que aporta el servicio; el resto (id, importedAt, status, timestamps) lo
// fija el repositorio.
export interface CommitBatchInput {
  templateId: string | null;
  fileName: string;
  rowsTotal: number;
  rowsImported: number;
  rowsSkippedDuplicate: number;
  rowsLinked: number;
  // Hash/tamano del fichero de origen (fase 5), para detectar "archivo repetido" en futuras
  // importaciones. null si no se pudo calcular (p. ej. Web Crypto no disponible).
  sourceFileHash: string | null;
  sourceFileSize: number | null;
}

// Patch de metadatos BANCARIOS que la decision "vincular" (fase 5) aplica sobre un movimiento
// YA EXISTENTE: nunca importe, categoria, tags ni ningun otro campo de gestion del usuario.
export type LinkPatch = Pick<
  Transaction,
  | 'bankTransactionId'
  | 'bookingDate'
  | 'valueDate'
  | 'pending'
  | 'currency'
  | 'balanceAfterCents'
  | 'bankReference'
  | 'operationType'
  | 'sourceFileHash'
  | 'sourceFileSize'
>;

// Operacion "vincular" (fase 5): candidateId debe ser un Transaction YA PERSISTIDO (el
// llamante lo garantiza; commitBatch revalida su existencia y pertenencia dentro de la misma
// transaccion atomica).
export interface CommitLinkOperation {
  candidateId: string;
  patch: LinkPatch;
}

// Operacion "marcar no duplicado" (fase 5): misma forma que NoDuplicateDecision sin los
// campos que fija el repositorio (id, timestamps, sync).
export interface CommitNotDuplicateOperation {
  leftFingerprint: string;
  rightFingerprint: string;
  leftTxId: string | null;
  rightTxId: string | null;
  reason: string | null;
}

export const importBatchesRepo = {
  ...base,

  async listByStatus(profileId: string, status: ImportBatchStatus): Promise<ImportBatch[]> {
    requireProfileId(profileId);
    return db.importBatches
      .where('[profileId+status]')
      .equals([profileId, status])
      .filter(isAlive)
      .toArray();
  },

  // Lotes previos con el mismo hash de fichero (deteccion de "archivo repetido", fase 5). Solo
  // lotes vigentes (committed): un lote deshecho no cuenta como aviso de repeticion.
  async listBySourceFileHash(profileId: string, sourceFileHash: string): Promise<ImportBatch[]> {
    requireProfileId(profileId);
    const rows = await db.importBatches
      .where('[profileId+sourceFileHash]')
      .equals([profileId, sourceFileHash])
      .filter(isAlive)
      .toArray();
    return rows.filter((b) => b.status === 'committed');
  },

  // Lotes del perfil, del mas reciente al mas antiguo (sin tombstones).
  async listRecent(profileId: string): Promise<ImportBatch[]> {
    requireProfileId(profileId);
    const all = await db.importBatches.where('profileId').equals(profileId).filter(isAlive).toArray();
    return all.sort((a, b) => b.importedAt - a.importedAt);
  },

  // Commit atomico de una importacion: crea el ImportBatch, todos sus Transaction, y aplica
  // las decisiones "vincular" y "marcar no duplicado" de la previsualizacion, TODO en UNA sola
  // transaccion Dexie. Si algo falla en cualquier punto (validacion de integridad de una fila,
  // un candidato de "vincular" borrado entre la previsualizacion y el commit, error de
  // escritura), la transaccion se revierte entera: no puede quedar un ImportBatch ya creado
  // con sus vinculaciones a medias, que un reintento del usuario volveria a crear desde cero y
  // duplicaria el movimiento (hallazgo critico de auditoria financiera — antes estas dos
  // decisiones se aplicaban en bucles SEPARADOS, fuera de esta transaccion, en
  // importService.commit()). Cada movimiento recibe el importBatchId del lote para poder
  // deshacerlo despues.
  async commitBatch(
    profileId: string,
    batchInput: CommitBatchInput,
    transactions: NewTransaction[],
    linkOps: CommitLinkOperation[] = [],
    notDuplicateOps: CommitNotDuplicateOperation[] = [],
  ): Promise<ImportBatch> {
    requireProfileId(profileId);
    const ts = now();
    const batch: ImportBatch = {
      ...syncDefaults(),
      id: newId(),
      profileId,
      templateId: batchInput.templateId,
      fileName: batchInput.fileName,
      importedAt: ts,
      rowsTotal: batchInput.rowsTotal,
      rowsImported: batchInput.rowsImported,
      rowsSkippedDuplicate: batchInput.rowsSkippedDuplicate,
      rowsLinked: batchInput.rowsLinked,
      status: 'committed',
      sourceFileHash: batchInput.sourceFileHash,
      sourceFileSize: batchInput.sourceFileSize,
      createdAt: ts,
      updatedAt: ts,
    };
    // Se construyen (y validan) las entidades antes de abrir la transaccion para fallar
    // rapido; el importBatchId se fija aqui para enlazar cada movimiento con su lote.
    const entities: Transaction[] = transactions.map((input) =>
      buildTransactionEntity(profileId, { ...input, importBatchId: batch.id }),
    );
    await db.transaction(
      'rw',
      [db.importBatches, db.transactions, db.profiles, db.outbox, db.noDuplicateDecisions],
      async () => {
        // Con cuenta vinculada, la importacion es optimista y genera mutaciones AGRUPADAS por lote
        // (el lote antes que sus movimientos por orden de dependencias). El push las procesa por
        // lotes. En modo local puro no hay outbox (comportamiento historico).
        const userId = await ownerOfProfile(profileId);
        if (userId) {
          batch.syncStatus = 'pending';
          for (const e of entities) e.syncStatus = 'pending';
        }
        await db.importBatches.add(batch);
        if (entities.length > 0) await db.transactions.bulkAdd(entities);

        // Decision "sustituir pendiente" (fase 5): un confirmado que sustituye a un pendiente
        // borra logicamente ese pendiente (tombstone) para no duplicar saldo, SIEMPRE (tambien
        // en modo local sin cuenta) para que deshacer el lote pueda restaurarlo con sus datos
        // intactos (ver undoBatch). Se hace ANTES de encolar los altas de los confirmados y
        // con un createdAt EXPLICITAMENTE anterior (ts - 1): el push procesa la cola por
        // createdAt ascendente (sync/outboxRepo.ts listPending), asi que el borrado del
        // pendiente llega al servidor antes que el alta del confirmado con el mismo
        // bankTransactionId. Sin esta garantia de orden, el alta podria intentarse mientras
        // el pendiente sigue vivo en remoto y violar la unicidad (profile_id, account_id,
        // bank_transaction_id) — no es un conflicto resoluble, es un error de integridad.
        const tombstoneTs = ts - 1;
        for (const e of entities) {
          if (e.pendingReplacementId === null) continue;
          const pendingTx = await db.transactions.get(e.pendingReplacementId);
          if (!pendingTx || pendingTx.profileId !== profileId || !isAlive(pendingTx)) continue;
          const tomb: Transaction = {
            ...pendingTx,
            deletedAt: tombstoneTs,
            updatedAt: tombstoneTs,
            syncStatus: userId ? 'pending' : pendingTx.syncStatus,
          };
          await db.transactions.put(tomb);
          if (userId) {
            await enqueueMutation({
              userId,
              profileId,
              entityType: 'transaction',
              entityId: pendingTx.id,
              operation: 'delete',
              entity: tomb as unknown as Record<string, unknown>,
              baseRevision: pendingTx.revision ?? 0,
              createdAt: tombstoneTs,
            });
          }
        }

        if (userId) {
          await enqueueMutation({
            userId,
            profileId,
            entityType: 'importBatch',
            entityId: batch.id,
            operation: 'insert',
            entity: batch as unknown as Record<string, unknown>,
            baseRevision: 0,
          });
          for (const e of entities) {
            await enqueueMutation({
              userId,
              profileId,
              entityType: 'transaction',
              entityId: e.id,
              operation: 'insert',
              entity: e as unknown as Record<string, unknown>,
              baseRevision: 0,
            });
          }
        }

        // Decision "vincular" (fase 5): actualiza movimientos YA PERSISTIDOS con los
        // metadatos bancarios de la fila importada, EN LA MISMA TRANSACCION ATOMICA que el
        // resto del commit (antes se aplicaba en un bucle separado, fuera de la transaccion,
        // en importService.commit() — hallazgo critico de auditoria financiera: un fallo aqui
        // ya no puede dejar el batch/las altas creadas sin sus vinculaciones). Nunca toca
        // importe, categoria ni tags. Revalida pertenencia/vida del candidato: pudo borrarse
        // entre la previsualizacion y el commit.
        for (const op of linkOps) {
          const existing = await db.transactions.get(op.candidateId);
          if (!existing || existing.profileId !== profileId || !isAlive(existing)) {
            throw new NotFoundError(
              `Transaction ${op.candidateId} no existe en el perfil ${profileId} (decision "vincular").`,
            );
          }
          const merged: Transaction = {
            ...existing,
            ...op.patch,
            id: existing.id,
            profileId: existing.profileId,
            duplicateStatus: 'unique',
            duplicateConfidence: 0,
            duplicateReasonCodes: [],
            duplicateCandidateIds: [],
            updatedAt: ts,
            syncStatus: userId ? 'pending' : existing.syncStatus,
          };
          await db.transactions.put(merged);
          if (userId) {
            await enqueueMutation({
              userId,
              profileId,
              entityType: 'transaction',
              entityId: merged.id,
              operation: 'update',
              entity: merged as unknown as Record<string, unknown>,
              baseRevision: existing.revision ?? 0,
            });
          }
        }

        // Decision "marcar no duplicado" (fase 5): registra la pareja de huellas, tambien
        // dentro de la misma transaccion atomica. Evita crecimiento de decisiones redundantes
        // si el usuario repite la misma decision sobre la misma pareja en importaciones
        // sucesivas (findForPair es una lectura pura, no abre su propia transaccion).
        for (const op of notDuplicateOps) {
          const alreadyDecided = await noDuplicateDecisionsRepo.findForPair(
            profileId,
            op.leftFingerprint,
            op.rightFingerprint,
          );
          if (alreadyDecided) continue;
          const decision: NoDuplicateDecision = {
            ...syncDefaults(),
            id: newId(),
            profileId,
            leftFingerprint: op.leftFingerprint,
            rightFingerprint: op.rightFingerprint,
            leftTxId: op.leftTxId,
            rightTxId: op.rightTxId,
            reason: op.reason,
            createdAt: ts,
            updatedAt: ts,
          };
          if (userId) decision.syncStatus = 'pending';
          await db.noDuplicateDecisions.add(decision);
          if (userId) {
            await enqueueMutation({
              userId,
              profileId,
              entityType: 'noDuplicateDecision',
              entityId: decision.id,
              operation: 'insert',
              entity: decision as unknown as Record<string, unknown>,
              baseRevision: 0,
            });
          }
        }
      },
    );
    return batch;
  },

  // Deshace un lote: borra en una unica transaccion Dexie todos los Transaction con ese
  // importBatchId dentro del perfil y marca el lote como 'undone' (DATA_MODEL 2.10). Deja
  // el estado como antes de importar. Devuelve cuantos movimientos se borraron.
  async undoBatch(profileId: string, batchId: string): Promise<number> {
    requireProfileId(profileId);
    requireId(batchId);
    // Se valida la pertenencia ANTES de abrir la transaccion para que el error de
    // aislamiento propague limpio (Dexie reenvuelve los errores lanzados dentro de una
    // transaccion). Aislamiento: un lote de otro perfil se comporta como inexistente.
    const batch = await db.importBatches.get(batchId);
    if (!batch || batch.profileId !== profileId) {
      throw new NotFoundError(`ImportBatch ${batchId} no existe en el perfil ${profileId}.`);
    }
    let removed = 0;
    await db.transaction(
      'rw',
      [db.importBatches, db.transactions, db.profiles, db.outbox],
      async () => {
        const userId = await ownerOfProfile(profileId);
        const coll = db.transactions
          .where('[profileId+importBatchId]')
          .equals([profileId, batchId]);
        const ts = now();
        // Restaura cualquier pendiente que este lote hubiera sustituido (decision "sustituir
        // pendiente", fase 5): al deshacer la importacion, el pendiente vuelve a estar vivo
        // con sus datos intactos (se tomb-stoneo, nunca se borro fisicamente, precisamente
        // para que este restore fuera posible). No duplica saldo porque el confirmado que lo
        // sustituia se borra a continuacion en esta misma funcion.
        // El restore se encola con createdAt EXPLICITAMENTE posterior al de los tombstones de
        // los confirmados (ver mismo razonamiento que en commitBatch): el push procesa la
        // cola por createdAt ascendente, asi que el borrado del confirmado (mismo
        // bankTransactionId) llega al servidor antes que la restauracion del pendiente,
        // evitando violar la unicidad remota (profile_id, account_id, bank_transaction_id)
        // por tener momentaneamente dos filas vivas con el mismo identificador.
        const restoreTs = ts + 1;
        const restorePendingLinks = async (
          removedTxs: Transaction[],
          uid: string | null,
        ): Promise<void> => {
          for (const t of removedTxs) {
            if (t.pendingReplacementId === null) continue;
            const pendingTx = await db.transactions.get(t.pendingReplacementId);
            if (!pendingTx || pendingTx.profileId !== profileId || isAlive(pendingTx)) continue;
            const restored: Transaction = {
              ...pendingTx,
              deletedAt: null,
              updatedAt: restoreTs,
              syncStatus: uid ? 'pending' : pendingTx.syncStatus,
            };
            await db.transactions.put(restored);
            if (uid) {
              await enqueueMutation({
                userId: uid,
                profileId,
                entityType: 'transaction',
                entityId: pendingTx.id,
                operation: 'update',
                entity: restored as unknown as Record<string, unknown>,
                baseRevision: pendingTx.revision ?? 0,
                createdAt: restoreTs,
              });
            }
          }
        };
        if (userId) {
          // Con cuenta: deshacer = borrado LOGICO de los movimientos (tombstone + mutacion) para
          // que el deshacer se sincronice y no reaparezcan desde otro dispositivo.
          const txs = await coll.toArray();
          const live = txs.filter(isAlive);
          removed = live.length;
          for (const t of live) {
            const tomb = { ...t, deletedAt: ts, updatedAt: ts, syncStatus: 'pending' as const };
            await db.transactions.put(tomb);
            await enqueueMutation({
              userId,
              profileId,
              entityType: 'transaction',
              entityId: t.id,
              operation: 'delete',
              entity: tomb as unknown as Record<string, unknown>,
              baseRevision: t.revision ?? 0,
            });
          }
          await restorePendingLinks(live, userId);
          const updatedBatch: ImportBatch = {
            ...batch,
            status: 'undone',
            updatedAt: ts,
            syncStatus: 'pending',
          };
          await db.importBatches.put(updatedBatch);
          await enqueueMutation({
            userId,
            profileId,
            entityType: 'importBatch',
            entityId: batch.id,
            operation: 'update',
            entity: updatedBatch as unknown as Record<string, unknown>,
            baseRevision: batch.revision ?? 0,
          });
        } else {
          // Modo local puro: borrado fisico (comportamiento historico). Los pendientes
          // sustituidos, sin embargo, se restauran (se habian tomb-stoneado, no borrado, para
          // permitir exactamente este undo).
          const txs = await coll.toArray();
          removed = txs.length;
          await restorePendingLinks(txs, null);
          await coll.delete();
          await db.importBatches.put({ ...batch, status: 'undone', updatedAt: now() });
        }
      },
    );
    return removed;
  },
};
