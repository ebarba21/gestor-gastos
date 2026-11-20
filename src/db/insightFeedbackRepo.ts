// Opiniones locales sobre los avisos de la portada (noviembre 2026). Tabla SOLO del dispositivo:
// no genera mutaciones de sincronizacion ni entra en backups (como deviceSecurity). Exige
// profileId: las opiniones de un perfil nunca se ven desde otro.
import type { InsightFeedback } from './schema';
import { db, now } from './index';
import { requireProfileId } from '../lib/validation';

function keyOf(profileId: string, alertId: string): string {
  return `${profileId}:${alertId}`;
}

export const insightFeedbackRepo = {
  async list(profileId: string): Promise<InsightFeedback[]> {
    requireProfileId(profileId);
    return db.insightFeedback.where('profileId').equals(profileId).toArray();
  },

  async upsert(
    profileId: string,
    alertId: string,
    patch: Partial<Pick<InsightFeedback, 'useful' | 'snoozedUntil'>>,
  ): Promise<InsightFeedback> {
    requireProfileId(profileId);
    if (!alertId) throw new Error('alertId obligatorio.');
    const id = keyOf(profileId, alertId);
    const existing = await db.insightFeedback.get(id);
    const row: InsightFeedback = {
      id,
      profileId,
      alertId,
      useful: existing?.useful ?? null,
      snoozedUntil: existing?.snoozedUntil ?? null,
      ...patch,
      updatedAt: now(),
    };
    await db.insightFeedback.put(row);
    return row;
  },
};
