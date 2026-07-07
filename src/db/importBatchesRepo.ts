// Repositorio de lotes de importacion (ImportBatch). Exige profileId.
// Ver DATA_MODEL 2.10. Permite trazabilidad y deshacer importaciones (fase 3).
import type { ImportBatch, ImportBatchStatus } from './schema';
import { db } from './index';
import { createProfileRepo } from './baseRepo';
import { requireProfileId } from '../lib/validation';

const base = createProfileRepo<ImportBatch>(db.importBatches, 'ImportBatch');

export const importBatchesRepo = {
  ...base,

  async listByStatus(profileId: string, status: ImportBatchStatus): Promise<ImportBatch[]> {
    requireProfileId(profileId);
    return db.importBatches.where('[profileId+status]').equals([profileId, status]).toArray();
  },
};
