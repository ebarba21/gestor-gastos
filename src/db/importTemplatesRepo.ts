// Repositorio de plantillas de importacion (ImportTemplate). Exige profileId.
// Ver DATA_MODEL 2.9. La logica de importacion es fase 3; aqui solo el acceso a datos.
import type { ImportTemplate } from './schema';
import { db } from './index';
import { createProfileRepo } from './baseRepo';
import { requireProfileId } from '../lib/validation';

const base = createProfileRepo<ImportTemplate>(db.importTemplates, 'ImportTemplate');

export const importTemplatesRepo = {
  ...base,

  async findByName(profileId: string, name: string): Promise<ImportTemplate | undefined> {
    requireProfileId(profileId);
    const rows = await db.importTemplates
      .where('[profileId+name]')
      .equals([profileId, name])
      .toArray();
    return rows[0];
  },
};
