// Repositorio de configuracion por perfil (Setting). Relacion 1:1 con Profile.
// Exige profileId. Ver DATA_MODEL 2.2.
import type { Setting, SyncMeta } from './schema';
import { db, newId, now, syncDefaults } from './index';
import { isAlive } from './baseRepo';
import { enqueueMutation, ownerOfProfile } from './outboxWrite';
import { requireProfileId } from '../lib/validation';

// Los campos de sincronizacion los fija el repositorio (syncDefaults), no el llamante.
export type SettingInput = Omit<
  Setting,
  'id' | 'profileId' | 'createdAt' | 'updatedAt' | keyof SyncMeta
>;
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
  const rows = await db.settings.where('profileId').equals(profileId).filter(isAlive).toArray();
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
      ...syncDefaults(),
      id: newId(),
      profileId,
      createdAt: ts,
      updatedAt: ts,
    };
    await db.transaction('rw', [db.settings, db.profiles, db.outbox], async () => {
      const userId = await ownerOfProfile(profileId);
      if (userId) {
        entity.syncStatus = 'pending';
        await db.settings.add(entity);
        await enqueueMutation({
          userId,
          profileId,
          entityType: 'setting',
          entityId: entity.id,
          operation: 'insert',
          entity: entity as unknown as Record<string, unknown>,
          baseRevision: 0,
        });
      } else {
        await db.settings.add(entity);
      }
    });
    return entity;
  },

  async update(profileId: string, patch: SettingPatch): Promise<Setting> {
    requireProfileId(profileId);
    const existing = await getRow(profileId);
    if (!existing) {
      // Sin errores silenciosos: crear con defaults + patch si no existe.
      return settingsRepo.create(profileId, { ...defaultSettingInput(), ...patch });
    }
    let updated!: Setting;
    await db.transaction('rw', [db.settings, db.profiles, db.outbox], async () => {
      updated = { ...existing, ...patch, updatedAt: now() };
      const userId = await ownerOfProfile(profileId);
      if (userId) {
        updated.syncStatus = 'pending';
        await db.settings.put(updated);
        await enqueueMutation({
          userId,
          profileId,
          entityType: 'setting',
          entityId: updated.id,
          operation: 'update',
          entity: updated as unknown as Record<string, unknown>,
          baseRevision: existing.revision ?? 0,
        });
      } else {
        await db.settings.put(updated);
      }
    });
    return updated;
  },
};
