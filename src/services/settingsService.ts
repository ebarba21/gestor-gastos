// Logica de negocio de la configuracion por perfil (Setting). Relacion 1:1 con Profile.
// Exige profileId. Los componentes acceden a los ajustes a traves de este servicio, no del
// repositorio directamente. Ver DATA_MODEL 2.2.
import type { Setting } from '../db/schema';
import { settingsRepo, defaultSettingInput, type SettingPatch } from '../db/settingsRepo';
import { requireProfileId } from '../lib/validation';

// Normaliza una fila de Setting posiblemente creada antes de anadir un campo aditivo: garantiza
// que los campos nuevos tengan su valor por defecto (no undefined) al leerlos. Aditivo y seguro.
function withDefaults(row: Setting): Setting {
  return {
    ...row,
    autoConsolidateTransfers: row.autoConsolidateTransfers ?? false,
  };
}

export const settingsService = {
  // Devuelve la configuracion del perfil, creandola con valores por defecto si aun no existe.
  async get(profileId: string): Promise<Setting> {
    requireProfileId(profileId);
    const existing = await settingsRepo.getByProfile(profileId);
    if (existing) return withDefaults(existing);
    return settingsRepo.create(profileId, defaultSettingInput());
  },

  // Indica si la consolidacion automatica de traspasos esta activa (opt-in). Filas antiguas sin
  // el campo se interpretan como false.
  async isAutoConsolidateTransfersEnabled(profileId: string): Promise<boolean> {
    const setting = await settingsService.get(profileId);
    return setting.autoConsolidateTransfers === true;
  },

  update(profileId: string, patch: SettingPatch): Promise<Setting> {
    requireProfileId(profileId);
    return settingsRepo.update(profileId, patch);
  },
};
