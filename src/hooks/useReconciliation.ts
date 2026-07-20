// Hook de conciliacion bancaria del perfil activo. Carga las cuentas (para elegir cual
// conciliar) y el historial de conciliaciones. Los handlers de accion llaman a
// reconciliationService y despues a reload().
import { useCallback, useEffect, useState } from 'react';
import { useActiveProfileId } from './useProfiles';
import { accountService } from '../services/accountService';
import { reconciliationService } from '../services/reconciliationService';
import type { Account, Reconciliation } from '../db/schema';

export interface UseReconciliation {
  profileId: string;
  accounts: Account[];
  history: Reconciliation[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

export function useReconciliation(): UseReconciliation {
  const profileId = useActiveProfileId();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [history, setHistory] = useState<Reconciliation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [accs, recent] = await Promise.all([
        accountService.listSorted(profileId),
        reconciliationService.listRecent(profileId),
      ]);
      setAccounts(accs);
      setHistory(recent);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar la conciliacion.');
    } finally {
      setLoading(false);
    }
  }, [profileId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { profileId, accounts, history, loading, error, reload };
}
