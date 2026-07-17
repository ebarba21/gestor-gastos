// Hook de forecast compuesto por rango (ampliacion, fase 7) para el periodo del dashboard. Ver
// FINANCIAL_ALGORITHMS seccion 7.3. Sustituye la extrapolacion lineal (statsService.
// computeForecast) como estimacion principal de cierre de periodo mostrada en el dashboard.
import { useEffect, useState } from 'react';
import { useActiveProfileId } from './useProfiles';
import { forecastService, type ForecastRangeResult } from '../services/forecastService';
import type { DateRange } from '../lib/dates';

export interface UseForecastRange {
  forecast: ForecastRangeResult | null;
  loading: boolean;
  error: string | null;
}

export function useForecastRange(range: DateRange | null): UseForecastRange {
  const profileId = useActiveProfileId();
  const [forecast, setForecast] = useState<ForecastRangeResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (range === null) {
      setForecast(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    void (async () => {
      try {
        const result = await forecastService.computeForRange(profileId, range);
        if (!cancelled) {
          setForecast(result);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'No se pudo calcular el forecast.');
          setForecast(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profileId, range?.from, range?.to]);

  return { forecast, loading, error };
}
