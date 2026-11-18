// Hook de insights del mes de referencia del dashboard. Toda la agregacion ocurre en
// insightsService; aqui solo se carga y se expone el resultado.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useActiveProfileId } from './useProfiles';
import { insightsService, type MonthInsights } from '../services/insightsService';
import { netWorthService, type NetWorthResult } from '../services/netWorthService';

export interface UseInsights {
  insights: MonthInsights | null;
  netWorth: NetWorthResult | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

export function useInsights(anchorISO: string | null): UseInsights {
  const profileId = useActiveProfileId();
  const [insights, setInsights] = useState<MonthInsights | null>(null);
  const [netWorth, setNetWorth] = useState<NetWorthResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Peticion vigente: una respuesta que llega tarde (otro perfil u otro mes) se descarta.
  const requestRef = useRef(0);

  // Al cambiar de perfil se vacia todo antes de cargar: nunca se muestran datos de otro perfil.
  useEffect(() => {
    setInsights(null);
    setNetWorth(null);
  }, [profileId]);

  const reload = useCallback(async () => {
    const request = ++requestRef.current;
    if (anchorISO === null) {
      setInsights(null);
      setNetWorth(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [ins, nw] = await Promise.all([
        insightsService.compute(profileId, { anchorISO }),
        netWorthService.compute(profileId, { window: '1y' }),
      ]);
      if (request !== requestRef.current) return;
      setInsights(ins);
      setNetWorth(nw);
      setError(null);
    } catch (e) {
      if (request !== requestRef.current) return;
      setInsights(null);
      setNetWorth(null);
      setError(e instanceof Error ? e.message : 'No se pudieron calcular los insights.');
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [profileId, anchorISO]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { insights, netWorth, loading, error, reload };
}
