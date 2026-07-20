// Repositorio de cuentas (Account). Exige profileId. Ver DATA_MODEL 2.3.
import type { Account, AccountKind } from './schema';
import type { CreateInput, UpdateInput } from './baseRepo';
import { db } from './index';
import { createProfileRepo, isAlive } from './baseRepo';
import { requireProfileId } from '../lib/validation';
import { assertCents } from '../lib/money';

const base = createProfileRepo<Account>(db.accounts, 'Account', 'account');

export const accountsRepo = {
  ...base,

  async create(profileId: string, input: CreateInput<Account>): Promise<Account> {
    requireProfileId(profileId);
    assertCents(input.openingBalanceCents);
    return base.create(profileId, input);
  },

  async update(profileId: string, id: string, patch: UpdateInput<Account>): Promise<Account> {
    if (patch.openingBalanceCents !== undefined) assertCents(patch.openingBalanceCents);
    return base.update(profileId, id, patch);
  },

  // Cuentas no archivadas del perfil.
  async listActive(profileId: string): Promise<Account[]> {
    requireProfileId(profileId);
    const all = await db.accounts.where('profileId').equals(profileId).filter(isAlive).toArray();
    return all.filter((a) => a.archivedAt === null);
  },

  async listByKind(profileId: string, kind: AccountKind): Promise<Account[]> {
    requireProfileId(profileId);
    return db.accounts.where('[profileId+kind]').equals([profileId, kind]).filter(isAlive).toArray();
  },
};
