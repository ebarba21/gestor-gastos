// Hook de cuentas del perfil activo. Carga la lista ordenada (activas primero) y expone
// recarga.
import { useCallback, useEffect, useState } from 'react';
import { useActiveProfileId } from './useProfiles';
import { accountService } from '../services/accountService';
import type { Account } from '../db/schema';

interface UseAccounts {
  profileId: string;
  accounts: Account[];
  // Fecha (YYYY-MM-DD) del ultimo movimiento por cuenta. Las cuentas sin movimientos no aparecen.
  lastMovementDates: Map<string, string>;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

export function useAccounts(): UseAccounts {
  const profileId = useActiveProfileId();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [lastMovementDates, setLastMovementDates] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      // Cuentas y ultimas fechas del mismo perfil, en paralelo (consultas independientes).
      const [list, dates] = await Promise.all([
        accountService.listSorted(profileId),
        accountService.lastMovementDates(profileId),
      ]);
      setAccounts(list);
      setLastMovementDates(dates);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cargar las cuentas.');
    } finally {
      setLoading(false);
    }
  }, [profileId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { profileId, accounts, lastMovementDates, loading, error, reload };
}
