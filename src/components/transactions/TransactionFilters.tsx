// Barra de filtros del listado de movimientos. Estado controlado por el padre (la seccion).
// Solo presentacion: traduce interaccion de UI a un objeto TxFilter. Sin logica de negocio.
import { useEffect, useRef, useState } from 'react';
import type { Account, Category, Tag } from '../../db/schema';
import type { TxFilter } from '../../lib/transactionFilters';
import { eurosToCents } from '../../lib/money';

interface TransactionFiltersProps {
  filter: TxFilter;
  onChange: (next: TxFilter) => void;
  accounts: Account[];
  categories: Category[];
  tags: Tag[];
}

const controlClass =
  'rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-sm text-slate-100 outline-none focus:border-slate-500';

// Convierte un input de euros (texto) a centimos, o undefined si esta vacio/invalido.
function eurosFieldToCents(value: string): number | undefined {
  if (value.trim() === '') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return eurosToCents(n);
}

export function TransactionFilters({
  filter,
  onChange,
  accounts,
  categories,
  tags,
}: TransactionFiltersProps) {
  const [expanded, setExpanded] = useState(false);
  const roots = categories.filter((c) => c.parentId === null && c.archivedAt === null);
  const subs = categories.filter((c) => c.parentId !== null && c.archivedAt === null);

  function patch(part: Partial<TxFilter>) {
    onChange({ ...filter, ...part });
  }

  // Busqueda con debounce: el input responde al instante pero el filtro (que recorre todos
  // los movimientos) solo se aplica tras una breve pausa, para seguir fluido con decenas de
  // miles de movimientos. Se sincroniza si el filtro se limpia desde fuera.
  const [searchText, setSearchText] = useState(filter.search ?? '');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    setSearchText(filter.search ?? '');
  }, [filter.search]);
  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);
  function onSearchChange(value: string) {
    setSearchText(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => patch({ search: value || undefined }), 200);
  }

  // Importes: estado local controlado (se confirma al perder el foco). Se sincroniza con el
  // filtro para que "Limpiar" tambien vacie estos campos.
  const [amountMin, setAmountMin] = useState('');
  const [amountMax, setAmountMax] = useState('');
  useEffect(() => {
    setAmountMin(filter.amountMinCents !== undefined ? String(filter.amountMinCents / 100) : '');
  }, [filter.amountMinCents]);
  useEffect(() => {
    setAmountMax(filter.amountMaxCents !== undefined ? String(filter.amountMaxCents / 100) : '');
  }, [filter.amountMaxCents]);

  function toggleInArray<T>(arr: T[] | undefined, value: T): T[] {
    const cur = arr ?? [];
    return cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value];
  }

  const activeCount = [
    filter.accountIds?.length,
    filter.categoryIds?.length,
    filter.subcategoryIds?.length,
    filter.tagIds?.length,
    filter.types?.length,
    filter.statuses?.length,
    filter.dateFrom ? 1 : 0,
    filter.dateTo ? 1 : 0,
    filter.amountMinCents !== undefined ? 1 : 0,
    filter.amountMaxCents !== undefined ? 1 : 0,
    filter.excluded && filter.excluded !== 'all' ? 1 : 0,
    filter.onlyUncategorized ? 1 : 0,
  ].reduce((acc: number, n) => acc + (n ? 1 : 0), 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          placeholder="Buscar por concepto o notas"
          value={searchText}
          onChange={(e) => onSearchChange(e.target.value)}
          className={`${controlClass} min-w-[12rem] flex-1`}
        />
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
        >
          Filtros{activeCount > 0 ? ` (${activeCount})` : ''}
        </button>
        {(activeCount > 0 || filter.search) && (
          <button
            type="button"
            onClick={() => onChange({})}
            className="rounded-lg px-3 py-1.5 text-sm text-slate-400 hover:bg-slate-800"
          >
            Limpiar
          </button>
        )}
      </div>

      {expanded && (
        <div className="grid gap-4 rounded-lg border border-slate-800 bg-slate-900/60 p-4 sm:grid-cols-2">
          {/* Tipo */}
          <fieldset>
            <legend className="text-xs font-medium uppercase tracking-wide text-slate-500">Tipo</legend>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(['expense', 'income', 'transfer'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => patch({ types: toggleInArray(filter.types, t) })}
                  aria-pressed={filter.types?.includes(t) ?? false}
                  className={chipClass(filter.types?.includes(t) ?? false)}
                >
                  {t === 'expense' ? 'Gasto' : t === 'income' ? 'Ingreso' : 'Transferencia'}
                </button>
              ))}
            </div>
          </fieldset>

          {/* Estado */}
          <fieldset>
            <legend className="text-xs font-medium uppercase tracking-wide text-slate-500">Estado</legend>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(['cleared', 'pending', 'reconciled'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => patch({ statuses: toggleInArray(filter.statuses, s) })}
                  aria-pressed={filter.statuses?.includes(s) ?? false}
                  className={chipClass(filter.statuses?.includes(s) ?? false)}
                >
                  {s === 'cleared' ? 'Confirmado' : s === 'pending' ? 'Pendiente' : 'Conciliado'}
                </button>
              ))}
            </div>
          </fieldset>

          {/* Cuentas */}
          <fieldset>
            <legend className="text-xs font-medium uppercase tracking-wide text-slate-500">Cuentas</legend>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {accounts.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => patch({ accountIds: toggleInArray(filter.accountIds, a.id) })}
                  aria-pressed={filter.accountIds?.includes(a.id) ?? false}
                  className={chipClass(filter.accountIds?.includes(a.id) ?? false)}
                >
                  {a.name}
                </button>
              ))}
            </div>
          </fieldset>

          {/* Etiquetas */}
          {tags.length > 0 && (
            <fieldset>
              <legend className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Etiquetas
              </legend>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {tags.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => patch({ tagIds: toggleInArray(filter.tagIds, t.id) })}
                    aria-pressed={filter.tagIds?.includes(t.id) ?? false}
                    className={chipClass(filter.tagIds?.includes(t.id) ?? false)}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          {/* Categoría */}
          <label className="text-sm text-slate-300">
            Categoría
            <select
              value={filter.categoryIds?.[0] ?? ''}
              onChange={(e) =>
                patch({ categoryIds: e.target.value ? [e.target.value] : undefined })
              }
              className={`${controlClass} mt-1 w-full`}
            >
              <option value="">Todas</option>
              {roots.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          {/* Subcategoría */}
          <label className="text-sm text-slate-300">
            Subcategoría
            <select
              value={filter.subcategoryIds?.[0] ?? ''}
              onChange={(e) =>
                patch({ subcategoryIds: e.target.value ? [e.target.value] : undefined })
              }
              className={`${controlClass} mt-1 w-full`}
            >
              <option value="">Todas</option>
              {subs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          {/* Fechas */}
          <label className="text-sm text-slate-300">
            Desde
            <input
              type="date"
              value={filter.dateFrom ?? ''}
              onChange={(e) => patch({ dateFrom: e.target.value || undefined })}
              className={`${controlClass} mt-1 w-full`}
            />
          </label>
          <label className="text-sm text-slate-300">
            Hasta
            <input
              type="date"
              value={filter.dateTo ?? ''}
              onChange={(e) => patch({ dateTo: e.target.value || undefined })}
              className={`${controlClass} mt-1 w-full`}
            />
          </label>

          {/* Importe (con signo) */}
          <label className="text-sm text-slate-300">
            Importe desde (EUR)
            <input
              type="number"
              step="0.01"
              placeholder="p. ej. -100"
              value={amountMin}
              onChange={(e) => setAmountMin(e.target.value)}
              onBlur={(e) => patch({ amountMinCents: eurosFieldToCents(e.target.value) })}
              className={`${controlClass} mt-1 w-full`}
            />
          </label>
          <label className="text-sm text-slate-300">
            Importe hasta (EUR)
            <input
              type="number"
              step="0.01"
              placeholder="p. ej. 0"
              value={amountMax}
              onChange={(e) => setAmountMax(e.target.value)}
              onBlur={(e) => patch({ amountMaxCents: eurosFieldToCents(e.target.value) })}
              className={`${controlClass} mt-1 w-full`}
            />
          </label>

          {/* Exclusion y sin categoría */}
          <label className="text-sm text-slate-300">
            Estadisticas
            <select
              value={filter.excluded ?? 'all'}
              onChange={(e) => patch({ excluded: e.target.value as TxFilter['excluded'] })}
              className={`${controlClass} mt-1 w-full`}
            >
              <option value="all">Todos</option>
              <option value="exclude">Solo los que cuentan</option>
              <option value="only">Solo excluidos</option>
            </select>
          </label>
          <label className="flex items-end gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={filter.onlyUncategorized ?? false}
              onChange={(e) => patch({ onlyUncategorized: e.target.checked || undefined })}
              className="mb-2 h-4 w-4"
            />
            Solo sin categoría
          </label>
        </div>
      )}
    </div>
  );
}

function chipClass(active: boolean): string {
  return [
    'rounded-full border px-2.5 py-1 text-xs',
    active
      ? 'border-indigo-500 bg-indigo-600/20 text-indigo-200'
      : 'border-slate-700 text-slate-300 hover:bg-slate-800',
  ].join(' ');
}
