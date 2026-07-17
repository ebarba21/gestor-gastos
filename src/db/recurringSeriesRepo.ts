// Repositorio de series recurrentes (RecurringSeries). Exige profileId. Ver DATA_MODEL seccion
// 18.1 y FINANCIAL_ALGORITHMS seccion 7.
import type { RecurringSeries, RecurringSeriesStatus } from './schema';
import { db } from './index';
import { createProfileRepo, isAlive } from './baseRepo';
import { requireProfileId } from '../lib/validation';

const base = createProfileRepo(db.recurringSeries, 'RecurringSeries', 'recurringSeries');

export const recurringSeriesRepo = {
  ...base,

  async listByStatus(profileId: string, status: RecurringSeriesStatus): Promise<RecurringSeries[]> {
    requireProfileId(profileId);
    return db.recurringSeries
      .where('[profileId+status]')
      .equals([profileId, status])
      .filter(isAlive)
      .toArray();
  },

  // Series activas o posiblemente canceladas: las que participan en el forecast y en el
  // seguimiento de ausencias (las pausadas y canceladas se excluyen explicitamente de ambos).
  async listTracked(profileId: string): Promise<RecurringSeries[]> {
    requireProfileId(profileId);
    const [active, possiblyCancelled] = await Promise.all([
      this.listByStatus(profileId, 'active'),
      this.listByStatus(profileId, 'possiblyCancelled'),
    ]);
    return [...active, ...possiblyCancelled];
  },

  async listByMerchant(profileId: string, merchantId: string): Promise<RecurringSeries[]> {
    requireProfileId(profileId);
    return db.recurringSeries
      .where('merchantId')
      .equals(merchantId)
      .filter((s) => s.profileId === profileId && isAlive(s))
      .toArray();
  },
};
