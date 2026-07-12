// Repositorio de lotes de importacion (ImportBatch). Exige profileId.
// Ver DATA_MODEL 2.10. Permite trazabilidad, atomicidad del commit y deshacer un lote.
import type { ImportBatch, ImportBatchStatus, Transaction } from './schema';
import { db, newId, now, syncDefaults } from './index';
import { createProfileRepo, isAlive } from './baseRepo';
import { enqueueMutation, ownerOfProfile } from './outboxWrite';
import { buildTransactionEntity } from './transactionsRepo';
import type { NewTransaction } from './transactionsRepo';
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

  // Lotes del perfil, del mas reciente al mas antiguo (sin tombstones).
  async listRecent(profileId: string): Promise<ImportBatch[]> {
    requireProfileId(profileId);
    const all = await db.importBatches.where('profileId').equals(profileId).filter(isAlive).toArray();
    return all.sort((a, b) => b.importedAt - a.importedAt);
  },

  // Commit atomico de una importacion: crea el ImportBatch y todos sus Transaction en UNA
  // sola transaccion Dexie. Si algo falla (validacion de integridad de cualquier fila,
  // error de escritura), la transaccion se revierte entera: no quedan movimientos a medias
  // ni un lote huerfano (requisito de atomicidad por lote, punto 7 del alcance de fase).
  // Cada movimiento recibe el importBatchId del lote para poder deshacerlo despues.
  async commitBatch(
    profileId: string,
    batchInput: CommitBatchInput,
    transactions: NewTransaction[],
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
      status: 'committed',
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
      [db.importBatches, db.transactions, db.profiles, db.outbox],
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
        if (userId) {
          // Con cuenta: deshacer = borrado LOGICO de los movimientos (tombstone + mutacion) para
          // que el deshacer se sincronice y no reaparezcan desde otro dispositivo.
          const txs = await coll.toArray();
          const live = txs.filter(isAlive);
          removed = live.length;
          const ts = now();
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
          // Modo local puro: borrado fisico (comportamiento historico).
          removed = await coll.count();
          await coll.delete();
          await db.importBatches.put({ ...batch, status: 'undone', updatedAt: now() });
        }
      },
    );
    return removed;
  },
};
