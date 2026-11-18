// Hook de patrimonio del perfil activo: ventana temporal seleccionada y resultado ya calculado
// por netWorthService (toda la agregacion ocurre en el service, nunca en el render).
import { useCallback, useEffect, useRef, useState } from 'react';
import { useActiveProfileId } from './useProfiles';
import { netWorthService, type NetWorthResult, type NetWorthWindow } from '../services/netWorthService';
import { accountService } from '../services/accountService';
import type { Account } from '../db/schema';

export interface UseNetWorth {
  netWorthWindow: NetWorthWindow;
  setNetWorthWindow: (w: NetWorthWindow) => void;
  data: NetWorthResult | null;
  accounts: Account[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

export function useNetWorth(initialWindow: NetWorthWindow = '1y'): UseNetWorth {
  const profileId = useActiveProfileId();
  const [netWorthWindow, setNetWorthWindow] = useState<NetWorthWindow>(initialWindow);
  const [data, setData] = useState<NetWorthResult | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Peticion vigente: una respuesta que llega tarde (otro perfil u otra ventana) se descarta.
  const requestRef = useRef(0);

  // Al cambiar de perfil se vacia todo antes de cargar: nunca se muestran datos de otro perfil.
  useEffect(() => {
    setData(null);
    setAccounts([]);
  }, [profileId]);

  const reload = useCallback(async () => {
    const request = ++requestRef.current;
    setLoading(true);
    try {
      const [result, accs] = await Promise.all([
        netWorthService.compute(profileId, { window: netWorthWindow }),
        accountService.listAll(profileId),
      ]);
      if (request !== requestRef.current) return;
      setData(result);
      setAccounts(accs);
      setError(null);
    } catch (e) {
      if (request !== requestRef.current) return;
      setError(e instanceof Error ? e.message : 'No se pudo calcular el patrimonio.');
      setData(null);
      setAccounts([]);
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [profileId, netWorthWindow]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { netWorthWindow, setNetWorthWindow, data, accounts, loading, error, reload };
}
