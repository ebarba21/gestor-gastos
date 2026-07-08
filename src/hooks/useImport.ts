// Hook de importacion del perfil activo. Carga las cuentas (destino de la importacion),
// las plantillas guardadas y el historial de lotes (para deshacer). Expone recarga. Los
// handlers de accion del componente llaman a importService y despues a reload().
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useActiveProfileId } from './useProfiles';
import { importService } from '../services/importService';
import { accountService } from '../services/accountService';
import type { Account, ImportBatch, ImportTemplate } from '../db/schema';

export interface UseImport {
  profileId: string;
  accounts: Account[];
  templates: ImportTemplate[];
  batches: ImportBatch[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  accountNames: Map<string, string>;
}

export function useImport(): UseImport {
  const profileId = useActiveProfileId();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [templates, setTemplates] = useState<ImportTemplate[]>([]);
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [accs, tpls, bts] = await Promise.all([
        accountService.listSorted(profileId),
        importService.listTemplates(profileId),
        importService.listBatches(profileId),
      ]);
      // Solo cuentas activas como destino de importacion (las archivadas se ocultan).
      setAccounts(accs.filter((a) => a.archivedAt === null));
      setTemplates(tpls.sort((a, b) => a.name.localeCompare(b.name)));
      setBatches(bts);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar la importacion.');
    } finally {
      setLoading(false);
    }
  }, [profileId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const accountNames = useMemo(
    () => new Map(accounts.map((a) => [a.id, a.name])),
    [accounts],
  );

  return { profileId, accounts, templates, batches, loading, error, reload, accountNames };
}
