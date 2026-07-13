// Repositorio de alias de comercio (MerchantAlias). Exige profileId. Ver DATA_MODEL 2.14.2.
import type { MerchantAlias } from './schema';
import { db } from './index';
import { createProfileRepo, isAlive } from './baseRepo';
import type { CreateInput, UpdateInput } from './baseRepo';
import { assert, requireProfileId } from '../lib/validation';

const base = createProfileRepo<MerchantAlias>(db.merchantAliases, 'MerchantAlias', 'merchantAlias');

// Valida que el comercio referenciado existe en el mismo perfil (aislamiento e integridad
// referencial, defensa en profundidad ademas de la FK compuesta remota).
async function assertValidMerchant(profileId: string, merchantId: string): Promise<void> {
  const merchant = await db.merchants.get(merchantId);
  assert(
    merchant !== undefined && merchant.profileId === profileId && isAlive(merchant),
    `El comercio ${merchantId} no existe en el perfil.`,
  );
}

export const merchantAliasesRepo = {
  ...base,

  async create(profileId: string, input: CreateInput<MerchantAlias>): Promise<MerchantAlias> {
    requireProfileId(profileId);
    await assertValidMerchant(profileId, input.merchantId);
    return base.create(profileId, input);
  },

  async update(profileId: string, id: string, patch: UpdateInput<MerchantAlias>): Promise<MerchantAlias> {
    requireProfileId(profileId);
    if (patch.merchantId !== undefined) await assertValidMerchant(profileId, patch.merchantId);
    return base.update(profileId, id, patch);
  },

  // Alias (vivos) de un comercio, en cualquier orden.
  listByMerchant(profileId: string, merchantId: string): Promise<MerchantAlias[]> {
    requireProfileId(profileId);
    return db.merchantAliases
      .where('merchantId')
      .equals(merchantId)
      .filter((a) => a.profileId === profileId && isAlive(a))
      .toArray();
  },

  // Todos los alias ACTIVOS del perfil ordenados por prioridad (menor = mayor prioridad).
  // Es el conjunto que consume el motor de asociacion (merchantMatchEngine).
  async listEnabledByPriority(profileId: string): Promise<MerchantAlias[]> {
    requireProfileId(profileId);
    const all = await db.merchantAliases.where('profileId').equals(profileId).filter(isAlive).toArray();
    return all.filter((a) => a.enabled).sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt);
  },
};
