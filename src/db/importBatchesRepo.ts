// Repositorio de lotes de importacion (ImportBatch). Exige profileId.
// Ver DATA_MODEL 2.10. Permite trazabilidad, atomicidad del commit y deshacer un lote.
import type { ImportBatch, ImportBatchStatus, Transaction } from './schema';
import { db, newId, now } from './index';
import { createProfileRepo } from './baseRepo';
import { buildTransactionEntity } from './transactionsRepo';
import type { NewTransaction } from './transactionsRepo';
import { NotFoundError, requireId, requireProfileId } from '../lib/validation';

const base = createProfileRepo<ImportBatch>(db.importBatches, 'ImportBatch');

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
    return db.importBatches.where('[profileId+status]').equals([profileId, status]).toArray();
  },

  // Lotes del perfil, del mas reciente al mas antiguo.
  async listRecent(profileId: string): Promise<ImportBatch[]> {
    requireProfileId(profileId);
    const all = await db.importBatches.where('profileId').equals(profileId).toArray();
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
    await db.transaction('rw', db.importBatches, db.transactions, async () => {
      await db.importBatches.add(batch);
      if (entities.length > 0) await db.transactions.bulkAdd(entities);
    });
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
    await db.transaction('rw', db.importBatches, db.transactions, async () => {
      const coll = db.transactions
        .where('[profileId+importBatchId]')
        .equals([profileId, batchId]);
      removed = await coll.count();
      await coll.delete();
      await db.importBatches.put({ ...batch, status: 'undone', updatedAt: now() });
    });
    return removed;
  },
};
