// Repositorio de deudas (Debt). Exige profileId. Ver DATA_MODEL seccion 19.1 y
// FINANCIAL_ALGORITHMS secciones 8-9.
import type { Debt, DebtStatus } from './schema';
import { db } from './index';
import { createProfileRepo, isAlive } from './baseRepo';
import { requireProfileId, requireId } from '../lib/validation';

const base = createProfileRepo(db.debts, 'Debt', 'debt');

export const debtsRepo = {
  ...base,

  async listByStatus(profileId: string, status: DebtStatus): Promise<Debt[]> {
    requireProfileId(profileId);
    return db.debts
      .where('[profileId+status]')
      .equals([profileId, status])
      .filter(isAlive)
      .toArray();
  },

  // Deudas activas: las que participan en calendario/comparador (archivadas y liquidadas quedan
  // fuera de la simulacion por defecto, aunque siguen visibles en el listado general).
  async listActive(profileId: string): Promise<Debt[]> {
    return this.listByStatus(profileId, 'active');
  },

  async listByLinkedAccount(profileId: string, accountId: string): Promise<Debt[]> {
    requireProfileId(profileId);
    requireId(accountId);
    return db.debts
      .where('linkedAccountId')
      .equals(accountId)
      .filter((d) => d.profileId === profileId && isAlive(d))
      .toArray();
  },
};
