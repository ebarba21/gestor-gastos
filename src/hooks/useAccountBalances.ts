// Hook de saldos actuales de las cuentas del perfil activo. Se recalcula cada vez que cambia
// la lista de cuentas (crear, editar el saldo inicial, archivar...) para no mostrar un saldo
// desfasado. El calculo vive en accountService.computeAccountBalances.
import { useEffect, useState } from 'react';
import type { Account } from '../db/schema';
import { accountService } from '../services/accountService';

interface UseAccountBalances {
  balances: Map<string, number>;
  loading: boolean;
  error: string | null;
}

export function useAccountBalances(profileId: string, accounts: Account[]): UseAccountBalances {
  const [balances, setBalances] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    accountService
      .getBalances(profileId)
      .then((result) => {
        if (cancelled) return;
        setBalances(result);
        setError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'No se pudieron calcular los saldos.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [profileId, accounts]);

  return { balances, loading, error };
}
