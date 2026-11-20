// Hook de insights del mes de referencia del dashboard y de la planificacion de hoy (disponible,
// prevision de saldo, KPIs). Toda la agregacion ocurre en los servicios; aqui solo se carga, se
// combinan los avisos (mes + planificacion), se ordenan por prioridad y se filtran segun las
// opiniones locales del usuario.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useActiveProfileId } from './useProfiles';
import {
  insightsService,
  sortAlertsByPriority,
  type InsightAlert,
  type MonthInsights,
} from '../services/insightsService';
import { netWorthService, type NetWorthResult } from '../services/netWorthService';
import { planningAlerts, planningService, type PlanningResult } from '../services/planningService';
import { insightFeedbackService, visibleAlerts } from '../services/insightFeedbackService';
import type { InsightFeedback } from '../db/schema';
import { todayISO } from '../lib/dates';

export type AlertFeedbackKind = 'useful' | 'notUseful' | 'snooze';

export interface UseInsights {
  insights: MonthInsights | null;
  netWorth: NetWorthResult | null;
  planning: PlanningResult | null;
  // Avisos del mes + de planificacion, por prioridad, sin los pospuestos.
  alerts: InsightAlert[];
  feedback: InsightFeedback[];
  giveFeedback: (alertId: string, kind: AlertFeedbackKind) => Promise<void>;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

export function useInsights(anchorISO: string | null): UseInsights {
  const profileId = useActiveProfileId();
  const [insights, setInsights] = useState<MonthInsights | null>(null);
  const [netWorth, setNetWorth] = useState<NetWorthResult | null>(null);
  const [planning, setPlanning] = useState<PlanningResult | null>(null);
  const [feedback, setFeedback] = useState<InsightFeedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Peticion vigente: una respuesta que llega tarde (otro perfil u otro mes) se descarta.
  const requestRef = useRef(0);

  // Al cambiar de perfil se vacia todo antes de cargar: nunca se muestran datos de otro perfil.
  useEffect(() => {
    setInsights(null);
    setNetWorth(null);
    setPlanning(null);
    setFeedback([]);
  }, [profileId]);

  const reload = useCallback(async () => {
    const request = ++requestRef.current;
    setLoading(true);
    try {
      const [ins, nw, plan, fb] = await Promise.all([
        anchorISO === null ? Promise.resolve(null) : insightsService.compute(profileId, { anchorISO }),
        netWorthService.compute(profileId, { window: '1y' }),
        // La planificacion es orientativa: si falla, el resto del dashboard sigue funcionando.
        planningService.compute(profileId).catch(() => null),
        insightFeedbackService.list(profileId),
      ]);
      if (request !== requestRef.current) return;
      setInsights(ins);
      setNetWorth(nw);
      setPlanning(plan);
      setFeedback(fb);
      setError(null);
    } catch (e) {
      if (request !== requestRef.current) return;
      setInsights(null);
      setNetWorth(null);
      setPlanning(null);
      setError(e instanceof Error ? e.message : 'No se pudieron calcular los insights.');
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [profileId, anchorISO]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const giveFeedback = useCallback(
    async (alertId: string, kind: AlertFeedbackKind) => {
      if (kind === 'useful') await insightFeedbackService.markUseful(profileId, alertId);
      else if (kind === 'notUseful') await insightFeedbackService.markNotUseful(profileId, alertId);
      else await insightFeedbackService.snooze(profileId, alertId);
      setFeedback(await insightFeedbackService.list(profileId));
    },
    [profileId],
  );

  const alerts = useMemo(() => {
    // Los avisos de planificacion miran a hoy: solo se mezclan si el dashboard muestra el mes en
    // curso (o no hay mes: modo rango).
    const today = todayISO();
    const showPlanning = anchorISO === null || anchorISO.slice(0, 7) === today.slice(0, 7);
    const merged = [...(insights?.alerts ?? []), ...(planning && showPlanning ? planningAlerts(planning) : [])];
    return visibleAlerts(sortAlertsByPriority(merged, today), feedback, Date.now());
  }, [insights, planning, feedback, anchorISO]);

  return { insights, netWorth, planning, alerts, feedback, giveFeedback, loading, error, reload };
}
