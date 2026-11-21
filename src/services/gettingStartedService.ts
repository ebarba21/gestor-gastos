// Primeros pasos (noviembre 2026): para quien acaba de crear su perfil (Nerea y el resto del
// grupo), una lista corta con lo que hace util la app cuanto antes. Se deduce de los datos y
// desaparece sola cuando todo esta hecho.
import { accountsRepo } from '../db/accountsRepo';
import { budgetsRepo } from '../db/budgetsRepo';
import { importBatchesRepo } from '../db/importBatchesRepo';
import { reviewItemsRepo } from '../db/reviewItemsRepo';
import { rulesRepo } from '../db/rulesRepo';
import { transactionsRepo } from '../db/transactionsRepo';
import { requireProfileId } from '../lib/validation';

export type GettingStartedStepId = 'accounts' | 'import' | 'review' | 'rules' | 'budgets';

export interface GettingStartedStep {
  id: GettingStartedStepId;
  title: string;
  detail: string;
  route: string;
  done: boolean;
}

export interface GettingStartedCounts {
  accounts: number;
  transactions: number;
  committedImports: number;
  openReview: number;
  rules: number;
  activeBudgets: number;
}

export function computeGettingStarted(c: GettingStartedCounts): GettingStartedStep[] {
  return [
    {
      id: 'accounts',
      title: 'Crea tus cuentas',
      detail: 'Banco, tarjeta, efectivo... Cada extracto se importa a su cuenta.',
      route: '/cuentas',
      done: c.accounts > 0,
    },
    {
      id: 'import',
      title: 'Importa tu primer extracto',
      detail: 'CSV o Excel de tu banco. Puedes deshacer la importación entera si algo no cuadra.',
      route: '/importar',
      done: c.committedImports > 0 || c.transactions > 0,
    },
    {
      id: 'review',
      title: 'Vacía la bandeja de revisión',
      detail: 'Sin categoría, duplicados, transferencias y Bizum por enlazar.',
      route: '/bandeja',
      // Sin movimientos no hay nada que revisar todavia: el paso no cuenta como hecho.
      done: c.transactions > 0 && c.openReview === 0,
    },
    {
      id: 'rules',
      title: 'Crea tus reglas',
      detail: 'Al corregir una categoría, la app te propone una regla para la próxima vez.',
      route: '/reglas',
      done: c.rules > 0,
    },
    {
      id: 'budgets',
      title: 'Pon tus primeros presupuestos',
      detail: 'En Presupuestos te sugerimos tres a partir de tu gasto real.',
      route: '/presupuestos',
      done: c.activeBudgets > 0,
    },
  ];
}

export const gettingStartedService = {
  async compute(profileId: string): Promise<GettingStartedStep[]> {
    requireProfileId(profileId);
    const [accounts, transactions, batches, openCounts, rules, budgets] = await Promise.all([
      accountsRepo.list(profileId),
      transactionsRepo.count(profileId),
      importBatchesRepo.listRecent(profileId),
      reviewItemsRepo.countOpenByType(profileId),
      rulesRepo.list(profileId),
      budgetsRepo.listActive(profileId),
    ]);
    return computeGettingStarted({
      accounts: accounts.length,
      transactions,
      committedImports: batches.filter((b) => b.status === 'committed').length,
      openReview: Object.values(openCounts).reduce((s, n) => s + (n ?? 0), 0),
      rules: rules.length,
      activeBudgets: budgets.length,
    });
  },
};
