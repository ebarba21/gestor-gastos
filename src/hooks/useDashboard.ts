// Hook del dashboard del perfil activo. Gestiona el selector de periodo (mes en curso por
// defecto, navegacion entre meses y rango personalizado) y carga las metricas ya agregadas
// desde statsService (toda la agregacion ocurre en el service, nunca en el render).
//
// Aislamiento por diseno: statsService.computeDashboard exige profileId y no cruza perfiles.
// Las categorias y cuentas se cargan aparte solo para resolver nombres y colores en la UI.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useActiveProfileId } from './useProfiles';
import { statsService, type DashboardData } from '../services/statsService';
import { categoryService } from '../services/categoryService';
import { accountService } from '../services/accountService';
import type { Account, Category } from '../db/schema';
import {
  customRange,
  monthRange,
  shiftMonths,
  todayISO,
  type DateRange,
} from '../lib/dates';

export type DashboardPeriodMode = 'month' | 'custom';

export interface UseDashboard {
  profileId: string;
  mode: DashboardPeriodMode;
  setMode: (mode: DashboardPeriodMode) => void;
  // Modo mes: fecha de referencia y navegacion.
  referenceISO: string;
  setReferenceMonths: (delta: number) => void;
  resetReference: () => void;
  // Modo rango personalizado.
  customFrom: string;
  customTo: string;
  setCustomFrom: (iso: string) => void;
  setCustomTo: (iso: string) => void;
  // Rango efectivo del periodo seleccionado (o null si el rango personalizado es invalido).
  range: DateRange | null;
  data: DashboardData | null;
  categories: Category[];
  accounts: Account[];
  categoryNames: Map<string, string>;
  categoryColors: Map<string, string>;
  accountNames: Map<string, string>;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

// Resuelve el rango del periodo y la fecha ancla (mes de referencia para evolucion,
// comparativa y forecast). Devuelve null en el rango si es personalizado e invalido.
function resolvePeriod(
  mode: DashboardPeriodMode,
  referenceISO: string,
  customFrom: string,
  customTo: string,
): { range: DateRange; anchorISO: string } | null {
  if (mode === 'month') {
    return { range: monthRange(referenceISO), anchorISO: referenceISO };
  }
  try {
    // customRange valida formato y orden (from <= to); si falla, rango invalido.
    const range = customRange(customFrom, customTo);
    // La fecha ancla es el final del rango: evolucion/comparativa/forecast giran sobre su mes.
    return { range, anchorISO: range.to };
  } catch {
    return null;
  }
}

export function useDashboard(): UseDashboard {
  const profileId = useActiveProfileId();
  const [mode, setMode] = useState<DashboardPeriodMode>('month');
  const [referenceISO, setReferenceISO] = useState<string>(() => todayISO());
  // Por defecto, el rango personalizado arranca en el mes en curso.
  const [customFrom, setCustomFrom] = useState<string>(() => monthRange(todayISO()).from);
  const [customTo, setCustomTo] = useState<string>(() => todayISO());

  const [data, setData] = useState<DashboardData | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const period = useMemo(
    () => resolvePeriod(mode, referenceISO, customFrom, customTo),
    [mode, referenceISO, customFrom, customTo],
  );

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      // Nombres y colores para la UI (cargados aparte del calculo). Aislados por profileId.
      const [cats, accs] = await Promise.all([
        categoryService.listAll(profileId),
        accountService.listAll(profileId),
      ]);
      setCategories(cats);
      setAccounts(accs);

      if (period === null) {
        // Rango personalizado invalido: no se calcula nada, se avisa sin romper la vista.
        setData(null);
        setError('El rango personalizado no es valido: la fecha inicial es posterior a la final.');
        return;
      }
      const dashboard = await statsService.computeDashboard(profileId, {
        range: period.range,
        anchorISO: period.anchorISO,
      });
      setData(dashboard);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar el dashboard.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [profileId, period]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const setReferenceMonths = useCallback((delta: number) => {
    setReferenceISO((prev) => shiftMonths(prev, delta));
  }, []);
  const resetReference = useCallback(() => setReferenceISO(todayISO()), []);

  const categoryNames = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);
  const categoryColors = useMemo(
    () => new Map(categories.filter((c) => c.color !== null).map((c) => [c.id, c.color!])),
    [categories],
  );
  const accountNames = useMemo(() => new Map(accounts.map((a) => [a.id, a.name])), [accounts]);

  return {
    profileId,
    mode,
    setMode,
    referenceISO,
    setReferenceMonths,
    resetReference,
    customFrom,
    customTo,
    setCustomFrom,
    setCustomTo,
    range: period?.range ?? null,
    data,
    categories,
    accounts,
    categoryNames,
    categoryColors,
    accountNames,
    loading,
    error,
    reload,
  };
}
