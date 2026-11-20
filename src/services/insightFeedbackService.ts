// Opiniones sobre avisos (noviembre 2026): "util", "no util" y "posponer". Un aviso pospuesto o
// marcado como no util deja de mostrarse durante un tiempo; nunca se borra el dato que lo origina.
import type { InsightFeedback } from '../db/schema';
import { insightFeedbackRepo } from '../db/insightFeedbackRepo';

export const SNOOZE_DAYS = 7;
export const NOT_USEFUL_SNOOZE_DAYS = 30;
const DAY_MS = 86_400_000;

// Avisos visibles: quita los pospuestos (o marcados como no utiles) hasta su fecha. Pura.
export function visibleAlerts<T extends { id: string; severity: string }>(
  alerts: readonly T[],
  feedback: readonly InsightFeedback[],
  nowMs: number,
): T[] {
  const byAlert = new Map(feedback.map((f) => [f.alertId, f] as const));
  return alerts.filter((a) => {
    const f = byAlert.get(a.id);
    if (!f || f.snoozedUntil === null) return true;
    // Un aviso critico (dinero en riesgo) no se puede silenciar mas de un dia.
    const until = a.severity === 'critical' ? Math.min(f.snoozedUntil, f.updatedAt + DAY_MS) : f.snoozedUntil;
    return nowMs >= until;
  });
}

export const insightFeedbackService = {
  list(profileId: string): Promise<InsightFeedback[]> {
    return insightFeedbackRepo.list(profileId);
  },
  markUseful(profileId: string, alertId: string): Promise<InsightFeedback> {
    return insightFeedbackRepo.upsert(profileId, alertId, { useful: true });
  },
  markNotUseful(profileId: string, alertId: string, nowMs: number = Date.now()): Promise<InsightFeedback> {
    return insightFeedbackRepo.upsert(profileId, alertId, {
      useful: false,
      snoozedUntil: nowMs + NOT_USEFUL_SNOOZE_DAYS * DAY_MS,
    });
  },
  snooze(profileId: string, alertId: string, nowMs: number = Date.now()): Promise<InsightFeedback> {
    return insightFeedbackRepo.upsert(profileId, alertId, { snoozedUntil: nowMs + SNOOZE_DAYS * DAY_MS });
  },
};
