// Repositorio de conciliaciones bancarias (Reconciliation). Exige profileId. Ver DATA_MODEL
// seccion 17 y FINANCIAL_ALGORITHMS seccion 6.
import type { Reconciliation } from './schema';
import { db } from './index';
import { createProfileRepo, isAlive } from './baseRepo';
import { requireProfileId } from '../lib/validation';

const base = createProfileRepo(db.reconciliations, 'Reconciliation', 'reconciliation');

export const reconciliationsRepo = {
  ...base,

  async listByAccount(profileId: string, accountId: string): Promise<Reconciliation[]> {
    requireProfileId(profileId);
    return db.reconciliations
      .where('[profileId+accountId]')
      .equals([profileId, accountId])
      .filter(isAlive)
      .toArray();
  },

  // Historial del perfil, del mas reciente al mas antiguo (por fecha de extracto).
  async listRecent(profileId: string): Promise<Reconciliation[]> {
    requireProfileId(profileId);
    const all = await db.reconciliations.where('profileId').equals(profileId).filter(isAlive).toArray();
    return all.sort((a, b) => b.statementDate.localeCompare(a.statementDate));
  },

  // Ultima conciliacion registrada de una cuenta (por fecha de extracto), o undefined si nunca
  // se ha conciliado. Util para precargar el formulario con el punto de partida habitual.
  async latestForAccount(profileId: string, accountId: string): Promise<Reconciliation | undefined> {
    requireProfileId(profileId);
    const rows = await this.listByAccount(profileId, accountId);
    return rows.sort((a, b) => b.statementDate.localeCompare(a.statementDate))[0];
  },
};
