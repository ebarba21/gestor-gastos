// Hook de cuentas del perfil activo. Carga la lista ordenada (activas primero) y expone
// recarga.
import { useCallback, useEffect, useState } from 'react';
import { useActiveProfileId } from './useProfiles';
import { accountService } from '../services/accountService';
import type { Account } from '../db/schema';

interface UseAccounts {
  profileId: string;
  accounts: Account[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

export function useAccounts(): UseAccounts {
  const profileId = useActiveProfileId();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setAccounts(await accountService.listSorted(profileId));
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

  return { profileId, accounts, loading, error, reload };
}
