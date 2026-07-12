// Hook de presupuestos del perfil activo. Carga las evaluaciones de los presupuestos
// activos para una fecha de referencia (por defecto hoy) y las entidades auxiliares que la
// UI necesita (categorias y cuentas para el formulario y para resolver nombres de ambito).
// Expone navegacion por periodos (desplazar meses) y recarga. Los handlers de accion llaman
// a budgetService y despues a reload().
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useActiveProfileId } from './useProfiles';
import { budgetService, type BudgetEvaluation } from '../services/budgetService';
import { categoryService, type CategoryNode } from '../services/categoryService';
import { accountService } from '../services/accountService';
import type { Account, Category } from '../db/schema';
import { shiftMonths, todayISO } from '../lib/dates';

export interface UseBudgets {
  profileId: string;
  referenceISO: string;
  setReferenceMonths: (delta: number) => void;
  resetReference: () => void;
  evaluations: BudgetEvaluation[];
  categories: Category[];
  categoryTree: CategoryNode[];
  accounts: Account[];
  categoryNames: Map<string, string>;
  accountNames: Map<string, string>;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

export function useBudgets(): UseBudgets {
  const profileId = useActiveProfileId();
  const [referenceISO, setReferenceISO] = useState<string>(() => todayISO());
  const [evaluations, setEvaluations] = useState<BudgetEvaluation[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryTree, setCategoryTree] = useState<CategoryNode[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      // Cargas en paralelo. Todas exigen profileId (aislamiento por diseno).
      const [evals, cats, tree, accs] = await Promise.all([
        budgetService.evaluateActive(profileId, referenceISO),
        categoryService.listAll(profileId),
        categoryService.listTree(profileId),
        accountService.listAll(profileId),
      ]);
      setEvaluations(evals);
      setCategories(cats);
      setCategoryTree(tree);
      setAccounts(accs);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cargar los presupuestos.');
    } finally {
      setLoading(false);
    }
  }, [profileId, referenceISO]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const setReferenceMonths = useCallback((delta: number) => {
    setReferenceISO((prev) => shiftMonths(prev, delta));
  }, []);

  const resetReference = useCallback(() => setReferenceISO(todayISO()), []);

  const categoryNames = useMemo(
    () => new Map(categories.map((c) => [c.id, c.name])),
    [categories],
  );
  const accountNames = useMemo(() => new Map(accounts.map((a) => [a.id, a.name])), [accounts]);

  return {
    profileId,
    referenceISO,
    setReferenceMonths,
    resetReference,
    evaluations,
    categories,
    categoryTree,
    accounts,
    categoryNames,
    accountNames,
    loading,
    error,
    reload,
  };
}
