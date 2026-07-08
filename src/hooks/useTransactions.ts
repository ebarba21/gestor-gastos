// Hook de movimientos del perfil activo. Carga los movimientos y las entidades auxiliares
// (cuentas, categorias, etiquetas) que la UI necesita para mostrar y filtrar. Expone
// recarga y mapas de nombre para ordenar/etiquetar sin recalcular en cada render.
// Los handlers de accion llaman a transactionService y despues a reload().
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useActiveProfileId } from './useProfiles';
import { transactionService } from '../services/transactionService';
import { accountService } from '../services/accountService';
import { categoryService } from '../services/categoryService';
import { tagService } from '../services/tagService';
import type { Account, Category, Tag, Transaction } from '../db/schema';

export interface UseTransactions {
  profileId: string;
  transactions: Transaction[];
  accounts: Account[];
  categories: Category[];
  tags: Tag[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  // Mapas id -> nombre para presentacion y orden.
  accountNames: Map<string, string>;
  categoryNames: Map<string, string>;
  tagNames: Map<string, string>;
}

export function useTransactions(): UseTransactions {
  const profileId = useActiveProfileId();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      // Cargas en paralelo. Todas exigen profileId (aislamiento por diseno).
      const [txs, accs, cats, tgs] = await Promise.all([
        transactionService.list(profileId),
        accountService.listAll(profileId),
        categoryService.listAll(profileId),
        tagService.listTags(profileId),
      ]);
      setTransactions(txs);
      setAccounts(accs);
      setCategories(cats);
      setTags(tgs);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cargar los movimientos.');
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
  const categoryNames = useMemo(
    () => new Map(categories.map((c) => [c.id, c.name])),
    [categories],
  );
  const tagNames = useMemo(() => new Map(tags.map((t) => [t.id, t.name])), [tags]);

  return {
    profileId,
    transactions,
    accounts,
    categories,
    tags,
    loading,
    error,
    reload,
    accountNames,
    categoryNames,
    tagNames,
  };
}
