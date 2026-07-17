// Hook de recurrencias del perfil activo (ampliacion, fase 7). Carga las series agrupadas por
// estado y los proximos cobros/ingresos, y expone las acciones de gestion (confirmar, editar,
// pausar, cancelar, excluir, anadir, omitir/completar/desvincular ocurrencia, dividir, fusionar).
// Los handlers llaman a recurringSeriesService y despues a reload(), mismo patron que
// useReviewItems/useReconciliation.
import { useCallback, useEffect, useState } from 'react';
import { useActiveProfileId } from './useProfiles';
import {
  recurringSeriesService,
  type CreateManualSeriesInput,
  type EditableSeriesFields,
  type UpcomingCharge,
} from '../services/recurringSeriesService';
import { recurringSeriesRepo } from '../db/recurringSeriesRepo';
import { recurringOccurrencesRepo } from '../db/recurringOccurrencesRepo';
import type { RecurringOccurrence, RecurringSeries } from '../db/schema';
import { shiftMonths, todayISO } from '../lib/dates';

// Horizonte por defecto de "proximos cobros" mostrados en la UI (60 dias).
const UPCOMING_HORIZON_DAYS_DEFAULT_MONTHS = 2;

export interface UseRecurringSeries {
  profileId: string;
  candidates: RecurringSeries[];
  active: RecurringSeries[];
  paused: RecurringSeries[];
  possiblyCancelled: RecurringSeries[];
  cancelled: RecurringSeries[];
  upcomingCharges: UpcomingCharge[];
  loading: boolean;
  detecting: boolean;
  error: string | null;
  reload: () => Promise<void>;
  runDetection: () => Promise<void>;
  confirm: (seriesId: string) => Promise<void>;
  pause: (seriesId: string) => Promise<void>;
  resume: (seriesId: string) => Promise<void>;
  cancel: (seriesId: string) => Promise<void>;
  excludeCandidate: (seriesId: string) => Promise<void>;
  edit: (seriesId: string, patch: EditableSeriesFields) => Promise<void>;
  createManual: (input: CreateManualSeriesInput) => Promise<void>;
  skipOccurrence: (occurrenceId: string) => Promise<void>;
  completeOccurrenceManually: (occurrenceId: string) => Promise<void>;
  unlinkOccurrenceTransaction: (occurrenceId: string) => Promise<void>;
  splitSeries: (seriesId: string, fromDateISO: string, newName?: string) => Promise<void>;
  mergeSeries: (keepSeriesId: string, mergeSeriesId: string) => Promise<void>;
  occurrencesOf: (seriesId: string) => Promise<RecurringOccurrence[]>;
}

export function useRecurringSeries(): UseRecurringSeries {
  const profileId = useActiveProfileId();
  const [series, setSeries] = useState<RecurringSeries[]>([]);
  const [upcomingCharges, setUpcomingCharges] = useState<UpcomingCharge[]>([]);
  const [loading, setLoading] = useState(true);
  const [detecting, setDetecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      await recurringSeriesService.syncAllTracked(profileId);
      const until = shiftMonths(todayISO(), UPCOMING_HORIZON_DAYS_DEFAULT_MONTHS);
      const [all, upcoming] = await Promise.all([
        recurringSeriesRepo.list(profileId),
        recurringSeriesService.listUpcomingCharges(profileId, until),
      ]);
      setSeries(all);
      setUpcomingCharges(upcoming);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cargar las recurrencias.');
    } finally {
      setLoading(false);
    }
  }, [profileId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const runDetection = useCallback(async () => {
    setDetecting(true);
    try {
      await recurringSeriesService.runDetection(profileId);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo completar la deteccion.');
    } finally {
      setDetecting(false);
    }
  }, [profileId, reload]);

  function action<Args extends unknown[]>(fn: (profileId: string, ...args: Args) => Promise<unknown>) {
    return async (...args: Args) => {
      try {
        await fn(profileId, ...args);
        await reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'No se pudo completar la accion.');
      }
    };
  }

  return {
    profileId,
    candidates: series.filter((s) => s.status === 'candidate'),
    active: series.filter((s) => s.status === 'active'),
    paused: series.filter((s) => s.status === 'paused'),
    possiblyCancelled: series.filter((s) => s.status === 'possiblyCancelled'),
    cancelled: series.filter((s) => s.status === 'cancelled'),
    upcomingCharges,
    loading,
    detecting,
    error,
    reload,
    runDetection,
    confirm: action(recurringSeriesService.confirm),
    pause: action(recurringSeriesService.pause),
    resume: action(recurringSeriesService.resume),
    cancel: action(recurringSeriesService.cancel),
    excludeCandidate: action(recurringSeriesService.excludeCandidate),
    edit: action(recurringSeriesService.edit),
    createManual: action(recurringSeriesService.createManual),
    skipOccurrence: action(recurringSeriesService.skipOccurrence),
    completeOccurrenceManually: action((pid, occId: string) =>
      recurringSeriesService.completeOccurrenceManually(pid, occId),
    ),
    unlinkOccurrenceTransaction: action(recurringSeriesService.unlinkOccurrenceTransaction),
    splitSeries: action(recurringSeriesService.splitSeries),
    mergeSeries: action(recurringSeriesService.mergeSeries),
    occurrencesOf: (seriesId: string) => recurringOccurrencesRepo.listBySeries(profileId, seriesId),
  };
}
