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
import { merchantService } from '../services/merchantService';
import type { Account, Category, Merchant } from '../db/schema';
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
  // Selecciona un mes concreto (YYYY-MM) como periodo, p. ej. al cerrar el detalle de un mes
  // pulsado en un grafico mensual. La ventana de los graficos no se desplaza.
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
  merchantNames: Map<string, string>;
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
  // Ancla fijada de la ventana de los graficos mensuales. Se fija al elegir un mes desde un
  // grafico (para que los meses visibles no se desplacen) y se suelta en cuanto la persona
  // cambia el periodo con el selector. null = la ventana sigue al periodo.
  const [windowPinISO, setWindowPinISO] = useState<string | null>(null);

  const [data, setData] = useState<DashboardData | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const period = useMemo(
    () => resolvePeriod(mode, referenceISO, customFrom, customTo),
    [mode, referenceISO, customFrom, customTo],
  );

  // Al cambiar de perfil se descarta el filtro cruzado: nunca se arrastra entre perfiles.
  useEffect(() => {
    setFilter(null);
    setWindowPinISO(null);
  }, [profileId]);

  // Nombres y colores para la UI. Solo dependen del perfil (no del periodo ni del filtro):
  // asi cambiar el filtro no recarga estas listas ni provoca un parpadeo.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [cats, accs, merchs] = await Promise.all([
          categoryService.listAll(profileId),
          accountService.listAll(profileId),
          merchantService.list(profileId),
        ]);
        if (cancelled) return;
        setCategories(cats);
        setAccounts(accs);
        setMerchants(merchs);
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
        windowAnchorISO: windowPinISO ?? undefined,
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
  }, [profileId, period, filter, windowPinISO]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Cualquier cambio de periodo hecho con el selector suelta la ventana fijada: a partir de
  // ahi los graficos vuelven a terminar en el mes del periodo, como siempre.
  const changeMode = useCallback((next: DashboardPeriodMode) => {
    setWindowPinISO(null);
    setMode(next);
  }, []);
  const setReferenceMonths = useCallback((delta: number) => {
    setWindowPinISO(null);
    setReferenceISO((prev) => shiftMonths(prev, delta));
  }, []);
  const resetReference = useCallback(() => {
    setWindowPinISO(null);
    setReferenceISO(todayISO());
  }, []);
  const changeCustomFrom = useCallback((iso: string) => {
    setWindowPinISO(null);
    setCustomFrom(iso);
  }, []);
  const changeCustomTo = useCallback((iso: string) => {
    setWindowPinISO(null);
    setCustomTo(iso);
  }, []);

  // Elegir un mes desde un grafico mensual: pasa a modo "mes" con ese mes como periodo y fija
  // la ventana donde estaba (si ya estaba fijada, se conserva) para que el grafico no se mueva.
  // El dia 15 siempre existe, evita ajustes de fin de mes; el periodo es el mes natural.
  const currentWindowAnchor = windowPinISO ?? period?.anchorISO ?? null;
  const selectMonth = useCallback(
    (monthKey: string) => {
      // Las claves llegan de los propios graficos; una clave mal formada no cambia nada.
      if (!/^\d{4}-\d{2}$/.test(monthKey)) return;
      setWindowPinISO(currentWindowAnchor);
      setMode('month');
      setReferenceISO(`${monthKey}-15`);
    },
    [currentWindowAnchor],
  );

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
  const merchantNames = useMemo(
    () => new Map(merchants.map((m) => [m.id, m.canonicalName])),
    [merchants],
  );

  return {
    profileId,
    mode,
    setMode: changeMode,
    referenceISO,
    setReferenceMonths,
    resetReference,
    selectMonth,
    customFrom,
    customTo,
    setCustomFrom: changeCustomFrom,
    setCustomTo: changeCustomTo,
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
    merchantNames,
    loading,
    error,
    reload,
  };
}
