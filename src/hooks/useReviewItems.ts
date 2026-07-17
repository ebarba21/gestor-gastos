// Hook de la bandeja de revision del perfil activo. Carga las tareas segun los filtros
// activos y los contadores por tipo (para la UI de la bandeja y el badge de navegacion).
// Los handlers de accion llaman a reviewService y despues a reload().
import { useCallback, useEffect, useState } from 'react';
import { useActiveProfileId } from './useProfiles';
import { reviewService, type ReviewInboxFilters } from '../services/reviewService';
import type { ReviewItem, ReviewItemType } from '../db/schema';

export interface UseReviewItems {
  profileId: string;
  items: ReviewItem[];
  counts: { total: number; byType: Partial<Record<ReviewItemType, number>> };
  filters: ReviewInboxFilters;
  setFilters: (next: ReviewInboxFilters) => void;
  loading: boolean;
  scanning: boolean;
  error: string | null;
  reload: () => Promise<void>;
  runFullScan: () => Promise<void>;
}

const DEFAULT_FILTERS: ReviewInboxFilters = { status: 'open', sort: 'newest' };

export function useReviewItems(): UseReviewItems {
  const profileId = useActiveProfileId();
  const [filters, setFilters] = useState<ReviewInboxFilters>(DEFAULT_FILTERS);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [counts, setCounts] = useState<{ total: number; byType: Partial<Record<ReviewItemType, number>> }>({
    total: 0,
    byType: {},
  });
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [list, countsResult] = await Promise.all([
        reviewService.listInbox(profileId, filters),
        reviewService.countsByType(profileId),
      ]);
      setItems(list);
      setCounts(countsResult);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar la bandeja de revision.');
    } finally {
      setLoading(false);
    }
    // Se compara por contenido (JSON.stringify), no por referencia: setFilters({...filters, x})
    // crea un objeto nuevo en cada cambio de la UI y no queremos recargar si el contenido es
    // igual.
  }, [profileId, JSON.stringify(filters)]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const runFullScan = useCallback(async () => {
    setScanning(true);
    try {
      await reviewService.runFullScan(profileId);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo completar el escaneo.');
    } finally {
      setScanning(false);
    }
  }, [profileId, reload]);

  return { profileId, items, counts, filters, setFilters, loading, scanning, error, reload, runFullScan };
}
