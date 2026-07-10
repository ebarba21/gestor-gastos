// Hook del dashboard del perfil activo. Gestiona el selector de periodo (mes en curso por
// defecto, navegacion entre meses y rango personalizado), el filtro cruzado (al pulsar una
// categoria en un visual, el resto se recalculan acotados a ella) y carga las metricas ya
// agregadas desde statsService (toda la agregacion ocurre en el service, nunca en el render).
//
// Aislamiento por diseno: statsService.computeDashboard exige profileId y no cruza perfiles.
// Las categorias y cuentas se cargan aparte solo para resolver nombres y colores en la UI.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useActiveProfileId } from './useProfiles';
import { statsService, type DashboardData, type DashboardFilter } from '../services/statsService';
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
  // Selecciona un mes concreto (YYYY-MM) como periodo, p. ej. al pulsar la evolucion mensual.
  selectMonth: (monthKey: string) => void;
  // Modo rango personalizado.
  customFrom: string;
  customTo: string;
  setCustomFrom: (iso: string) => void;
  setCustomTo: (iso: string) => void;
  // Rango efectivo del periodo seleccionado (o null si el rango personalizado es invalido).
  range: DateRange | null;
  // Filtro cruzado activo (null si ninguno) y acciones para cambiarlo.
  filter: DashboardFilter | null;
  toggleCategoryFilter: (categoryId: string | null) => void;
  clearFilter: () => void;
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
  const [filter, setFilter] = useState<DashboardFilter | null>(null);

  const [data, setData] = useState<DashboardData | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const period = useMemo(
    () => resolvePeriod(mode, referenceISO, customFrom, customTo),
    [mode, referenceISO, customFrom, customTo],
  );

  // Al cambiar de perfil se descarta el filtro cruzado: nunca se arrastra entre perfiles.
  useEffect(() => {
    setFilter(null);
  }, [profileId]);

  // Nombres y colores para la UI. Solo dependen del perfil (no del periodo ni del filtro):
  // asi cambiar el filtro no recarga estas listas ni provoca un parpadeo.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [cats, accs] = await Promise.all([
          categoryService.listAll(profileId),
          accountService.listAll(profileId),
        ]);
        if (cancelled) return;
        setCategories(cats);
        setAccounts(accs);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'No se pudieron cargar las categorias.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profileId]);

  const reload = useCallback(async () => {
    // No se vacia `data` al recalcular (p. ej. al filtrar): se mantiene el ultimo resultado
    // visible para que el cambio de filtro no parpadee. El spinner solo aparece sin datos.
    setLoading(true);
    try {
      if (period === null) {
        // Rango personalizado invalido: no se calcula nada, se avisa sin romper la vista.
        setData(null);
        setError('El rango personalizado no es valido: la fecha inicial es posterior a la final.');
        return;
      }
      const dashboard = await statsService.computeDashboard(profileId, {
        range: period.range,
        anchorISO: period.anchorISO,
        filter: filter ?? undefined,
      });
      setData(dashboard);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar el dashboard.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [profileId, period, filter]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const setReferenceMonths = useCallback((delta: number) => {
    setReferenceISO((prev) => shiftMonths(prev, delta));
  }, []);
  const resetReference = useCallback(() => setReferenceISO(todayISO()), []);

  // Pulsar un mes en la evolucion mensual: pasa a modo "mes" y fija ese mes como referencia.
  // El dia 15 siempre existe, evita ajustes de fin de mes; el periodo es el mes natural.
  const selectMonth = useCallback((monthKey: string) => {
    setMode('month');
    setReferenceISO(`${monthKey}-15`);
  }, []);

  // Alterna el filtro por categoria: si ya esta esa categoria, lo quita; si no, lo pone.
  const toggleCategoryFilter = useCallback((categoryId: string | null) => {
    setFilter((prev) => (prev && prev.categoryId === categoryId ? null : { categoryId }));
  }, []);
  const clearFilter = useCallback(() => setFilter(null), []);

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
    selectMonth,
    customFrom,
    customTo,
    setCustomFrom,
    setCustomTo,
    range: period?.range ?? null,
    filter,
    toggleCategoryFilter,
    clearFilter,
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
