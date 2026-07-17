// Hook de deudas del perfil activo (ampliacion, fase 8). Carga deudas, resumen agregado y
// escenarios guardados; expone las acciones de gestion. Mismo patron que useRecurringSeries:
// los handlers llaman al servicio y despues a reload().
import { useCallback, useEffect, useState } from 'react';
import { useActiveProfileId } from './useProfiles';
import { debtsService, type CreateDebtInput, type UpdateDebtInput, type CreateScenarioInput, type RecordPaymentInput } from '../services/debtsService';
import { debtsRepo } from '../db/debtsRepo';
import { debtScenariosRepo } from '../db/debtScenariosRepo';
import type { Debt, DebtScenario } from '../db/schema';
import type { DebtsSummary } from '../services/debtsService';

export interface UseDebts {
  profileId: string;
  debts: Debt[];
  active: Debt[];
  paidOff: Debt[];
  archived: Debt[];
  scenarios: DebtScenario[];
  summary: DebtsSummary | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  createDebt: (input: CreateDebtInput) => Promise<void>;
  updateDebt: (debtId: string, patch: UpdateDebtInput) => Promise<void>;
  archiveDebt: (debtId: string) => Promise<void>;
  removeDebt: (debtId: string) => Promise<void>;
  recordPayment: (debtId: string, input: RecordPaymentInput) => Promise<void>;
  createScenario: (input: CreateScenarioInput) => Promise<void>;
  duplicateScenario: (scenarioId: string, newName: string) => Promise<void>;
  deleteScenario: (scenarioId: string) => Promise<void>;
  refreshScenario: (scenarioId: string) => Promise<void>;
}

export function useDebts(): UseDebts {
  const profileId = useActiveProfileId();
  const [debts, setDebts] = useState<Debt[]>([]);
  const [scenarios, setScenarios] = useState<DebtScenario[]>([]);
  const [summary, setSummary] = useState<DebtsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [allDebts, allScenarios, debtsSummary] = await Promise.all([
        debtsRepo.list(profileId),
        debtScenariosRepo.list(profileId),
        debtsService.getSummary(profileId),
      ]);
      setDebts(allDebts.sort((a, b) => a.name.localeCompare(b.name)));
      setScenarios(allScenarios.sort((a, b) => b.createdAt - a.createdAt));
      setSummary(debtsSummary);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cargar las deudas.');
    } finally {
      setLoading(false);
    }
  }, [profileId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  function action<Args extends unknown[]>(fn: (profileId: string, ...args: Args) => Promise<unknown>) {
    return async (...args: Args) => {
      try {
        await fn(profileId, ...args);
        await reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'No se pudo completar la accion.');
        throw e;
      }
    };
  }

  return {
    profileId,
    debts,
    active: debts.filter((d) => d.status === 'active'),
    paidOff: debts.filter((d) => d.status === 'paidOff'),
    archived: debts.filter((d) => d.status === 'archived'),
    scenarios,
    summary,
    loading,
    error,
    reload,
    createDebt: action(debtsService.createDebt),
    updateDebt: action((pid, debtId: string, patch: UpdateDebtInput) => debtsService.updateDebt(pid, debtId, patch)),
    archiveDebt: action(debtsService.archiveDebt),
    removeDebt: action((pid, debtId: string) => debtsRepo.remove(pid, debtId)),
    recordPayment: action((pid, debtId: string, input: RecordPaymentInput) =>
      debtsService.recordPayment(pid, debtId, input),
    ),
    createScenario: action(debtsService.createScenario),
    duplicateScenario: action((pid, scenarioId: string, newName: string) =>
      debtsService.duplicateScenario(pid, scenarioId, newName),
    ),
    deleteScenario: action((pid, scenarioId: string) => debtsService.deleteScenario(pid, scenarioId)),
    refreshScenario: action((pid, scenarioId: string) => debtsService.refreshScenario(pid, scenarioId)),
  };
}
