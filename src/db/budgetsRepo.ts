// Repositorio de presupuestos/metas (Budget). Exige profileId. Ver DATA_MODEL 2.8.
import type { Budget, BudgetScope } from './schema';
import type { CreateInput, UpdateInput } from './baseRepo';
import { db } from './index';
import { createProfileRepo } from './baseRepo';
import { requireProfileId } from '../lib/validation';
import { assertCents } from '../lib/money';

const base = createProfileRepo<Budget>(db.budgets, 'Budget');

export const budgetsRepo = {
  ...base,

  async create(profileId: string, input: CreateInput<Budget>): Promise<Budget> {
    requireProfileId(profileId);
    assertCents(input.limitCents);
    return base.create(profileId, input);
  },

  async update(profileId: string, id: string, patch: UpdateInput<Budget>): Promise<Budget> {
    if (patch.limitCents !== undefined) assertCents(patch.limitCents);
    return base.update(profileId, id, patch);
  },

  // Presupuestos no archivados del perfil.
  async listActive(profileId: string): Promise<Budget[]> {
    requireProfileId(profileId);
    const all = await db.budgets.where('profileId').equals(profileId).toArray();
    return all.filter((b) => b.archivedAt === null);
  },

  async listByScope(profileId: string, scope: BudgetScope): Promise<Budget[]> {
    requireProfileId(profileId);
    return db.budgets.where('[profileId+scope]').equals([profileId, scope]).toArray();
  },
};
