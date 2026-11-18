// Hook de patrimonio del perfil activo: ventana temporal seleccionada y resultado ya calculado
// por netWorthService (toda la agregacion ocurre en el service, nunca en el render).
import { useCallback, useEffect, useState } from 'react';
import { useActiveProfileId } from './useProfiles';
import { netWorthService, type NetWorthResult, type NetWorthWindow } from '../services/netWorthService';
import { accountService } from '../services/accountService';
import type { Account } from '../db/schema';

export interface UseNetWorth {
  window: NetWorthWindow;
  setWindow: (w: NetWorthWindow) => void;
  data: NetWorthResult | null;
  accounts: Account[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

export function useNetWorth(initialWindow: NetWorthWindow = '1y'): UseNetWorth {
  const profileId = useActiveProfileId();
  const [window, setWindow] = useState<NetWorthWindow>(initialWindow);
  const [data, setData] = useState<NetWorthResult | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [result, accs] = await Promise.all([
        netWorthService.compute(profileId, { window }),
        accountService.listAll(profileId),
      ]);
      setData(result);
      setAccounts(accs);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo calcular el patrimonio.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [profileId, window]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { window, setWindow, data, accounts, loading, error, reload };
}
