// Configuracion de planificacion del perfil (noviembre 2026): dia de cobro, colchon, ciclo de
// presupuestos y pagas extra. Vive en Setting (1:1 con el perfil, sincronizable con
// last-write-wins como el resto de la configuracion). Los campos son opcionales en el modelo para
// que filas antiguas sigan siendo validas: este modulo es la UNICA fuente de sus defaults.
import type { BudgetCycle, Setting } from '../db/schema';
import { settingsRepo } from '../db/settingsRepo';
import { assertCents } from '../lib/money';
import { ValidationError, requireProfileId } from '../lib/validation';

export interface PlanningSettings {
  payDay: number | null; // 1..31 o null
  safetyBufferCents: number; // >= 0
  budgetCycle: BudgetCycle;
  extraPayMonths: number[]; // 1..12, ordenados y sin repetir
  reserveExtraPay: boolean;
}

export const DEFAULT_PLANNING_SETTINGS: PlanningSettings = {
  payDay: null,
  safetyBufferCents: 0,
  budgetCycle: 'calendar',
  extraPayMonths: [],
  reserveExtraPay: true,
};

// Lee la configuracion de planificacion de un Setting (o de su ausencia) con defaults.
export function planningFromSetting(setting: Setting | undefined | null): PlanningSettings {
  if (!setting) return { ...DEFAULT_PLANNING_SETTINGS, extraPayMonths: [] };
  return {
    payDay: setting.payDay ?? null,
    safetyBufferCents: setting.safetyBufferCents ?? 0,
    budgetCycle: setting.budgetCycle ?? 'calendar',
    extraPayMonths: [...(setting.extraPayMonths ?? [])],
    reserveExtraPay: setting.reserveExtraPay ?? true,
  };
}

// Valida y normaliza un parche. Sin errores silenciosos: lanza ValidationError.
export function validatePlanningPatch(patch: Partial<PlanningSettings>): Partial<PlanningSettings> {
  const out: Partial<PlanningSettings> = {};
  if (patch.payDay !== undefined) {
    if (patch.payDay !== null && (!Number.isInteger(patch.payDay) || patch.payDay < 1 || patch.payDay > 31)) {
      throw new ValidationError('El dia de cobro debe ser un numero entre 1 y 31.');
    }
    out.payDay = patch.payDay;
  }
  if (patch.safetyBufferCents !== undefined) {
    assertCents(patch.safetyBufferCents);
    if (patch.safetyBufferCents < 0) throw new ValidationError('El colchon no puede ser negativo.');
    out.safetyBufferCents = patch.safetyBufferCents;
  }
  if (patch.budgetCycle !== undefined) {
    if (patch.budgetCycle !== 'calendar' && patch.budgetCycle !== 'payday') {
      throw new ValidationError('Periodo de presupuestos no valido.');
    }
    out.budgetCycle = patch.budgetCycle;
  }
  if (patch.extraPayMonths !== undefined) {
    for (const m of patch.extraPayMonths) {
      if (!Number.isInteger(m) || m < 1 || m > 12) throw new ValidationError('Los meses de paga extra van de 1 a 12.');
    }
    out.extraPayMonths = [...new Set(patch.extraPayMonths)].sort((a, b) => a - b);
  }
  if (patch.reserveExtraPay !== undefined) out.reserveExtraPay = Boolean(patch.reserveExtraPay);
  return out;
}

export const planningSettingsService = {
  async get(profileId: string): Promise<PlanningSettings> {
    requireProfileId(profileId);
    return planningFromSetting(await settingsRepo.getByProfile(profileId));
  },

  async update(profileId: string, patch: Partial<PlanningSettings>): Promise<PlanningSettings> {
    requireProfileId(profileId);
    const clean = validatePlanningPatch(patch);
    if ((clean.budgetCycle ?? null) === 'payday') {
      const current = await planningSettingsService.get(profileId);
      const payDay = clean.payDay !== undefined ? clean.payDay : current.payDay;
      if (payDay === null) {
        throw new ValidationError('Para usar el periodo de nomina a nomina indica antes tu dia de cobro.');
      }
    }
    const updated = await settingsRepo.update(profileId, clean);
    return planningFromSetting(updated);
  },
};
