// Repositorio de configuracion por perfil (Setting). Relacion 1:1 con Profile.
// Exige profileId. Ver DATA_MODEL 2.2.
import type { Setting } from './schema';
import { db, newId, now } from './index';
import { requireProfileId } from '../lib/validation';

export type SettingInput = Omit<Setting, 'id' | 'profileId' | 'createdAt' | 'updatedAt'>;
export type SettingPatch = Partial<SettingInput>;

// Valores por defecto de un perfil nuevo (una sola moneda por perfil en el MVP).
export function defaultSettingInput(): SettingInput {
  return {
    currency: 'EUR',
    locale: 'es-ES',
    weekStart: 'monday',
    defaultAccountId: null,
    encryptionEnabled: false, // Reservado fase 2. En el MVP siempre false.
  };
}

async function getRow(profileId: string): Promise<Setting | undefined> {
  const rows = await db.settings.where('profileId').equals(profileId).toArray();
  return rows[0];
}

export const settingsRepo = {
  getByProfile(profileId: string): Promise<Setting | undefined> {
    requireProfileId(profileId);
    return getRow(profileId);
  },

  // Crea la configuracion del perfil (1:1). El indice &profileId impide duplicados.
  async create(profileId: string, input: SettingInput): Promise<Setting> {
    requireProfileId(profileId);
    const ts = now();
    const entity: Setting = {
      ...input,
      id: newId(),
      profileId,
      createdAt: ts,
      updatedAt: ts,
    };
    await db.settings.add(entity);
    return entity;
  },

  async update(profileId: string, patch: SettingPatch): Promise<Setting> {
    requireProfileId(profileId);
    const existing = await getRow(profileId);
    if (!existing) {
      // Sin errores silenciosos: crear con defaults + patch si no existe.
      return settingsRepo.create(profileId, { ...defaultSettingInput(), ...patch });
    }
    const updated: Setting = { ...existing, ...patch, updatedAt: now() };
    await db.settings.put(updated);
    return updated;
  },
};
