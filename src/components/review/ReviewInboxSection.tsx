// Bandeja de revision: cola unificada de excepciones (ARCHITECTURE seccion 17, DATA_MODEL
// seccion 16). Contadores totales y por tipo, filtros, busqueda, orden, seleccion multiple,
// acciones masivas, panel de detalle por tarea y estados vacios. Responsive: lista apilada en
// cualquier ancho, sin tablas anchas que desborden en movil.
import { useEffect, useMemo, useState } from 'react';
import { useReviewItems } from '../../hooks/useReviewItems';
import {
  reviewService,
  REVIEW_TYPE_LABELS,
  REVIEW_STATUS_LABELS,
  type RuleProposal,
  type ReviewSubject,
} from '../../services/reviewService';
import type { ReviewItem, ReviewItemStatus, ReviewItemType } from '../../db/schema';
import { EmptyState, SwipeRow } from '../common';
import { useToast } from '../../context/ToastContext';
import { ReviewItemRow } from './ReviewItemRow';
import { ReviewItemDetailModal } from './ReviewItemDetailModal';

const STATUS_OPTIONS: ReviewItemStatus[] = ['open', 'snoozed', 'resolved', 'dismissed'];
const SORT_OPTIONS: { value: 'newest' | 'oldest' | 'confidence'; label: string }[] = [
  { value: 'newest', label: 'Más recientes' },
  { value: 'oldest', label: 'Más antiguas' },
  { value: 'confidence', label: 'Mayor confianza' },
];

const PAGE_SIZE = 100;

const inputClass =
  'rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-sm text-slate-100 outline-none focus:border-slate-500';

export function ReviewInboxSection() {
  const { profileId, items, counts, filters, setFilters, loading, scanning, error, reload, runFullScan } =
    useReviewItems();
  const { showToast } = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openItem, setOpenItem] = useState<ReviewItem | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [proposals, setProposals] = useState<Map<string, RuleProposal>>(new Map());
  const [subjects, setSubjects] = useState<Map<string, ReviewSubject>>(new Map());
  // Con cientos de tareas, pintarlas todas de golpe hace la pagina enorme y lenta: se muestran
  // por tandas y un boton carga mas. Cambiar filtros vuelve a la primera tanda.
  const [shown, setShown] = useState(PAGE_SIZE);
  useEffect(() => setShown(PAGE_SIZE), [filters]);

  // Movimiento de cada tarea (fecha, concepto, importe) para identificarla sin abrir el detalle.
  useEffect(() => {
    let cancelled = false;
    reviewService
      .describeSubjects(profileId, items)
      .then((map) => {
        if (!cancelled) setSubjects(map);
      })
      .catch(() => {
        // Sin este dato la fila sigue mostrando tipo y motivos; el detalle lo carga igualmente.
        if (!cancelled) setSubjects(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [profileId, items]);

  // Categoria propuesta de cada tarea "regla de baja confianza", para verla sin abrir el detalle.
  useEffect(() => {
    let cancelled = false;
    reviewService
      .describeRuleProposals(profileId, items)
      .then((map) => {
        if (!cancelled) setProposals(map);
      })
      .catch(() => {
        // La bandeja sigue siendo usable sin este dato; el detalle de la tarea lo vuelve a cargar.
        if (!cancelled) setProposals(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [profileId, items]);

  const typeEntries = useMemo(
    () => Object.entries(counts.byType) as [ReviewItemType, number][],
    [counts.byType],
  );

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) => (prev.size === items.length ? new Set() : new Set(items.map((i) => i.id))));
  }

  // Gesto rapido sobre una tarea: resolver o descartar, con "Deshacer" en el aviso.
  async function quickAction(item: ReviewItem, action: 'resolve' | 'dismiss') {
    try {
      if (action === 'resolve') await reviewService.resolve(profileId, item.id, 'swipe:resolved');
      else await reviewService.dismiss(profileId, item.id, 'swipe:dismissed');
      await reload();
      showToast(action === 'resolve' ? 'Tarea resuelta.' : 'Tarea descartada.', 'success', {
        label: 'Deshacer',
        onClick: async () => {
          try {
            await reviewService.reopen(profileId, item.id);
            await reload();
          } catch (e) {
            showToast(e instanceof Error ? e.message : 'No se pudo deshacer.', 'error');
          }
        },
      });
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'No se pudo actualizar la tarea.', 'error');
    }
  }

  async function bulkAction(action: 'resolve' | 'dismiss') {
    if (selected.size === 0 || bulkBusy) return;
    setBulkBusy(true);
    try {
      const ids = [...selected];
      if (action === 'resolve') {
        await reviewService.bulkResolve(profileId, ids, 'bulk:resolved');
      } else {
        await reviewService.bulkDismiss(profileId, ids, 'bulk:dismissed');
      }
      showToast(`${ids.length} tarea(s) actualizada(s).`, 'success');
      setSelected(new Set());
      await reload();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'No se pudo completar la acción masiva.', 'error');
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold text-slate-100">Bandeja de revisión</h2>
          <p className="mt-1 text-sm text-slate-400">
            {counts.total} tarea(s) abierta(s) en total.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void runFullScan()}
          disabled={scanning}
          className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50"
        >
          {scanning ? 'Buscando...' : 'Buscar tareas pendientes'}
        </button>
      </div>

      {/* Contadores por tipo, clicables para filtrar */}
      {typeEntries.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {typeEntries.map(([type, count]) => (
            <button
              key={type}
              type="button"
              onClick={() =>
                setFilters({ ...filters, type: filters.type === type ? undefined : type })
              }
              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                filters.type === type
                  ? 'border-indigo-500 bg-indigo-900/50 text-indigo-200'
                  : 'border-slate-700 text-slate-300 hover:bg-slate-800'
              }`}
            >
              {REVIEW_TYPE_LABELS[type]} ({count})
            </button>
          ))}
        </div>
      )}

      {/* Filtros, busqueda y orden */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="review-status-filter">
          Estado
        </label>
        <select
          id="review-status-filter"
          value={filters.status ?? 'open'}
          onChange={(e) => setFilters({ ...filters, status: e.target.value as ReviewItemStatus })}
          className={inputClass}
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {REVIEW_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="review-search">
          Buscar
        </label>
        <input
          id="review-search"
          type="search"
          placeholder="Buscar por tipo o motivo..."
          value={filters.search ?? ''}
          onChange={(e) => setFilters({ ...filters, search: e.target.value || undefined })}
          // Ancho minimo: en pantallas estrechas baja a su propia linea en vez de encogerse a nada.
          className={`${inputClass} min-w-[12rem] flex-1`}
        />
        <label className="sr-only" htmlFor="review-sort">
          Orden
        </label>
        <select
          id="review-sort"
          value={filters.sort ?? 'newest'}
          onChange={(e) =>
            setFilters({ ...filters, sort: e.target.value as 'newest' | 'oldest' | 'confidence' })
          }
          className={inputClass}
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {!loading && items.length === 0 && (
        <EmptyState
          icon="✅"
          title="No hay tareas que revisar"
          description="Cuando importes movimientos, apliques reglas o se detecten posibles duplicados, transferencias o reembolsos, aparecerán aquí."
        />
      )}

      {items.length > 0 && (
        <>
          <div className="flex items-center gap-3 text-sm text-slate-300">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={selected.size === items.length && items.length > 0}
                onChange={toggleSelectAll}
                aria-label="Seleccionar todas las tareas visibles"
                className="h-4 w-4 rounded border-slate-600 bg-slate-800"
              />
              Seleccionar todo
            </label>
            {selected.size > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-slate-400">{selected.size} seleccionada(s)</span>
                <button
                  type="button"
                  disabled={bulkBusy}
                  onClick={() => void bulkAction('resolve')}
                  className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                >
                  Resolver
                </button>
                <button
                  type="button"
                  disabled={bulkBusy}
                  onClick={() => void bulkAction('dismiss')}
                  className="rounded-lg border border-slate-700 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                >
                  Descartar
                </button>
              </div>
            )}
          </div>

          <p className="text-xs text-slate-500 md:hidden">
            Desliza una tarea a la derecha para resolverla o a la izquierda para descartarla.
          </p>
          <ul className="space-y-2">
            {items.slice(0, shown).map((item) => (
              <SwipeRow
                key={item.id}
                className="rounded-lg"
                leading={{ label: 'Resolver', className: 'bg-emerald-600 text-white', onTrigger: () => void quickAction(item, 'resolve') }}
                trailing={{ label: 'Descartar', className: 'bg-slate-600 text-white', onTrigger: () => void quickAction(item, 'dismiss') }}
              >
                <ReviewItemRow
                  item={item}
                  selected={selected.has(item.id)}
                  onToggleSelect={() => toggleSelect(item.id)}
                  onOpen={() => setOpenItem(item)}
                  proposal={proposals.get(item.id)}
                  subject={subjects.get(item.id)}
                />
              </SwipeRow>
            ))}
          </ul>
          {items.length > shown && (
            <div className="flex flex-wrap items-center justify-center gap-3 py-2 text-sm">
              <span className="text-slate-500">
                Mostrando {shown} de {items.length}
              </span>
              <button
                type="button"
                onClick={() => setShown((n) => n + PAGE_SIZE)}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-slate-200 hover:bg-slate-800"
              >
                Mostrar {Math.min(PAGE_SIZE, items.length - shown)} más
              </button>
            </div>
          )}
        </>
      )}

      {openItem && (
        <ReviewItemDetailModal
          profileId={profileId}
          item={openItem}
          onClose={() => setOpenItem(null)}
          onChanged={() => void reload()}
        />
      )}
    </section>
  );
}
