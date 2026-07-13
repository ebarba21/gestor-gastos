// Hook de reglas del perfil activo. Carga las reglas (ordenadas por prioridad) y las
// entidades auxiliares que la UI necesita para construir condiciones y acciones (cuentas para
// la condicion de cuenta; categorias/subcategorias y etiquetas para la accion). Expone
// recarga. Los handlers de accion llaman a ruleService y despues a reload().
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useActiveProfileId } from './useProfiles';
import { ruleService } from '../services/ruleService';
import { accountService } from '../services/accountService';
import { categoryService } from '../services/categoryService';
import { tagService } from '../services/tagService';
import { merchantService } from '../services/merchantService';
import type { Account, Category, Merchant, Rule, Tag } from '../db/schema';

export interface UseRules {
  profileId: string;
  rules: Rule[];
  accounts: Account[];
  categories: Category[];
  tags: Tag[];
  merchants: Merchant[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  accountNames: Map<string, string>;
  categoryNames: Map<string, string>;
  tagNames: Map<string, string>;
  merchantNames: Map<string, string>;
}

export function useRules(): UseRules {
  const profileId = useActiveProfileId();
  const [rules, setRules] = useState<Rule[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      // Cargas en paralelo. Todas exigen profileId (aislamiento por diseno).
      const [rs, accs, cats, tgs, merchs] = await Promise.all([
        ruleService.list(profileId),
        accountService.listAll(profileId),
        categoryService.listAll(profileId),
        tagService.listTags(profileId),
        merchantService.list(profileId),
      ]);
      setRules(rs);
      setAccounts(accs);
      setCategories(cats);
      setTags(tgs);
      setMerchants(merchs);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cargar las reglas.');
    } finally {
      setLoading(false);
    }
  }, [profileId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const accountNames = useMemo(() => new Map(accounts.map((a) => [a.id, a.name])), [accounts]);
  const categoryNames = useMemo(
    () => new Map(categories.map((c) => [c.id, c.name])),
    [categories],
  );
  const tagNames = useMemo(() => new Map(tags.map((t) => [t.id, t.name])), [tags]);
  const merchantNames = useMemo(
    () => new Map(merchants.map((m) => [m.id, m.canonicalName])),
    [merchants],
  );

  return {
    profileId,
    rules,
    accounts,
    categories,
    tags,
    merchants,
    loading,
    error,
    reload,
    accountNames,
    categoryNames,
    tagNames,
    merchantNames,
  };
}
