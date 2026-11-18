// Hook de insights del mes de referencia del dashboard. Toda la agregacion ocurre en
// insightsService; aqui solo se carga y se expone el resultado.
import { useCallback, useEffect, useState } from 'react';
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

  const reload = useCallback(async () => {
    if (anchorISO === null) {
      setInsights(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [ins, nw] = await Promise.all([
        insightsService.compute(profileId, { anchorISO }),
        netWorthService.compute(profileId, { window: '1y' }),
      ]);
      setInsights(ins);
      setNetWorth(nw);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron calcular los insights.');
    } finally {
      setLoading(false);
    }
  }, [profileId, anchorISO]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { insights, netWorth, loading, error, reload };
}
