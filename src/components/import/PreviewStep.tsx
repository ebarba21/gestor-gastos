// Paso 3 del wizard: previsualizacion completa antes de importar. Muestra cada fila
// resultante, senala los errores de parseo fila a fila y marca los posibles duplicados,
// dejando que el usuario excluya filas. La lista se virtualiza (VirtualList) para seguir
// fluida con decenas de miles de filas en PC y movil. La importacion es atomica
// (importService.commit).
import { useMemo } from 'react';
import type { ImportPreview, PreviewRow } from '../../services/importService';
import { formatCents } from '../../lib/money';
import { VirtualList } from '../common';

interface Props {
  preview: ImportPreview;
  accountNames: Map<string, string>;
  onToggleRow: (rowIndex: number) => void;
  onIncludeAllValid: () => void;
  onExcludeDuplicates: () => void;
  onCommit: () => void;
  onBack: () => void;
  busy: boolean;
  locale: string;
  currency: string;
}

// Rejilla compartida por la cabecera y las filas para que las columnas queden alineadas.
const GRID_COLUMNS = '56px 48px 108px minmax(160px, 1fr) 120px 140px minmax(180px, 240px)';
const ROW_HEIGHT = 44;
const LIST_HEIGHT = 460;

export function PreviewStep({
  preview,
  accountNames,
  onToggleRow,
  onIncludeAllValid,
  onExcludeDuplicates,
  onCommit,
  onBack,
  busy,
  locale,
  currency,
}: Props) {
  const { rows, summary } = preview;
  const selectedCount = useMemo(() => rows.filter((r) => r.include).length, [rows]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-semibold text-slate-100">Previsualizacion</h3>
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
        >
          Volver al mapeo
        </button>
      </div>

      {/* Resumen */}
      <div className="flex flex-wrap gap-2 text-sm">
        <Badge tone="slate">{summary.total} filas</Badge>
        <Badge tone="emerald">{summary.ok} correctas</Badge>
        <Badge tone="amber">{summary.duplicates} posibles duplicados</Badge>
        <Badge tone="red">{summary.errors} con error</Badge>
        <Badge tone="indigo">{selectedCount} seleccionadas</Badge>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onIncludeAllValid}
          className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
        >
          Seleccionar todas las validas
        </button>
        <button
          type="button"
          onClick={onExcludeDuplicates}
          className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
        >
          Excluir duplicados
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <div className="min-w-[760px]">
          {/* Cabecera */}
          <div
            className="grid items-center gap-2 border-b border-slate-800 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-400"
            style={{ gridTemplateColumns: GRID_COLUMNS }}
          >
            <span>Importar</span>
            <span>Fila</span>
            <span>Fecha</span>
            <span>Concepto</span>
            <span className="text-right">Importe</span>
            <span>Cuenta</span>
            <span>Estado</span>
          </div>

          <VirtualList
            items={rows}
            rowHeight={ROW_HEIGHT}
            height={Math.min(LIST_HEIGHT, Math.max(ROW_HEIGHT, rows.length * ROW_HEIGHT))}
            keyFor={(r) => String(r.rowIndex)}
            renderRow={(row) => (
              <PreviewRowView
                row={row}
                accountNames={accountNames}
                onToggle={onToggleRow}
                locale={locale}
                currency={currency}
              />
            )}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-3">
        <span className="text-sm text-slate-400">
          Se importaran <strong className="text-slate-100">{selectedCount}</strong> movimientos.
        </span>
        <button
          type="button"
          disabled={selectedCount === 0 || busy}
          onClick={onCommit}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
        >
          {busy ? 'Importando...' : `Importar ${selectedCount}`}
        </button>
      </div>
    </div>
  );
}

interface RowProps {
  row: PreviewRow;
  accountNames: Map<string, string>;
  onToggle: (rowIndex: number) => void;
  locale: string;
  currency: string;
}

function PreviewRowView({ row, accountNames, onToggle, locale, currency }: RowProps) {
  const isError = row.status === 'error';
  return (
    <div
      className={[
        'grid h-full items-center gap-2 border-b border-slate-800/70 px-3 text-sm',
        isError ? 'bg-red-950/30' : row.duplicate ? 'bg-amber-950/20' : '',
      ].join(' ')}
      style={{ gridTemplateColumns: GRID_COLUMNS }}
    >
      <input
        type="checkbox"
        checked={row.include}
        disabled={isError}
        onChange={() => onToggle(row.rowIndex)}
        aria-label={`Importar fila ${row.rowIndex + 1}`}
        className="h-4 w-4"
      />
      <span className="text-slate-500">{row.rowIndex + 1}</span>
      <span className="truncate text-slate-300">{row.displayDate ?? '—'}</span>
      <span className="truncate text-slate-200" title={row.displayConcept ?? undefined}>
        {row.displayConcept ?? '—'}
      </span>
      <span
        className={[
          'truncate text-right tabular-nums',
          row.displayAmountCents !== null && row.displayAmountCents < 0
            ? 'text-red-300'
            : 'text-emerald-300',
        ].join(' ')}
      >
        {row.displayAmountCents !== null
          ? formatCents(row.displayAmountCents, locale, currency)
          : '—'}
      </span>
      <span className="truncate text-slate-400">
        {row.displayAccountId ? accountNames.get(row.displayAccountId) ?? '—' : '—'}
      </span>
      <span className="truncate">
        {isError ? (
          <span className="text-xs text-red-400" title={row.errors.join(' ')}>
            {row.errors.join(' ')}
          </span>
        ) : row.duplicate ? (
          <span className="text-xs text-amber-400">
            Posible duplicado{row.duplicateOf === 'batch' ? ' (en el fichero)' : ' (ya existe)'}
          </span>
        ) : (
          <span className="text-xs text-emerald-400">Nuevo</span>
        )}
      </span>
    </div>
  );
}

type Tone = 'slate' | 'emerald' | 'amber' | 'red' | 'indigo';

const TONE_CLASS: Record<Tone, string> = {
  slate: 'border-slate-700 text-slate-300',
  emerald: 'border-emerald-700 text-emerald-300',
  amber: 'border-amber-700 text-amber-300',
  red: 'border-red-700 text-red-300',
  indigo: 'border-indigo-600 text-indigo-300',
};

function Badge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className={`rounded-full border px-2.5 py-0.5 text-xs ${TONE_CLASS[tone]}`}>
      {children}
    </span>
  );
}
