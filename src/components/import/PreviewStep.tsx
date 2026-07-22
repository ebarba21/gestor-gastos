// Paso 3 del wizard: previsualizacion completa antes de importar. Muestra cada fila
// resultante, senala los errores de parseo fila a fila y ejecuta el motor de duplicados
// multinivel (services/duplicateEngine.ts), mostrando nivel, confianza orientativa, motivos y
// la decision a tomar (omitir, importar, sustituir pendiente, vincular, marcar no duplicado).
// La lista se virtualiza (VirtualList) para seguir fluida con decenas de miles de filas en PC
// y movil. La importacion es atomica (importService.commit).
import { useMemo } from 'react';
import type { ImportPreview, PreviewRow } from '../../services/importService';
import type { DuplicateAction } from '../../services/duplicateEngine';
import { REASON_CODE_LABELS } from '../../services/duplicateEngine';
import { formatCents } from '../../lib/money';
import { VirtualList } from '../common';

interface Props {
  preview: ImportPreview;
  accountNames: Map<string, string>;
  onToggleRow: (rowIndex: number) => void;
  onDecisionChange: (rowIndex: number, decisión: DuplicateAction) => void;
  onApplyToEquivalents: (rowIndex: number) => void;
  onIncludeAllValid: () => void;
  onExcludeDuplicates: () => void;
  onCommit: () => void;
  onBack: () => void;
  busy: boolean;
  locale: string;
  currency: string;
}

// Rejilla compartida por la cabecera y las filas para que las columnas queden alineadas.
const GRID_COLUMNS = '56px 48px 108px minmax(160px, 1fr) 120px 140px minmax(220px, 320px)';
const ROW_HEIGHT = 56;
const LIST_HEIGHT = 520;

const DECISION_LABELS: Record<DuplicateAction, string> = {
  skip: 'Omitir',
  import: 'Importar de todos modos',
  replacePending: 'Sustituir el pendiente',
  link: 'Vincular al existente (no crea uno nuevo)',
  markNotDuplicate: 'No es un duplicado',
};

const STATUS_LABELS: Record<Exclude<PreviewRow['duplicateStatus'], 'unique'>, string> = {
  exact: 'Coincidencia exacta',
  strongNormalized: 'Coincidencia probable',
  possible: 'Posible duplicado',
  weak: 'Coincidencia debil',
  pendingReplaced: 'Sustituye a un pendiente',
};

const STATUS_TONE: Record<Exclude<PreviewRow['duplicateStatus'], 'unique'>, string> = {
  exact: 'text-red-400',
  strongNormalized: 'text-amber-400',
  possible: 'text-amber-400',
  weak: 'text-amber-300/80',
  pendingReplaced: 'text-sky-400',
};

export function PreviewStep({
  preview,
  accountNames,
  onToggleRow,
  onDecisionChange,
  onApplyToEquivalents,
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
      <p className="text-xs text-slate-500">
        La confianza mostrada es orientativa (heuristica), no una probabilidad real. Nunca se
        borra ni se sustituye nada sin tu confirmación explicita.
      </p>

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
        <div className="min-w-[900px]">
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
                onDecisionChange={onDecisionChange}
                onApplyToEquivalents={onApplyToEquivalents}
                locale={locale}
                currency={currency}
              />
            )}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-3">
        <span className="text-sm text-slate-400">
          Se aplicaran <strong className="text-slate-100">{selectedCount}</strong> filas.
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
  onDecisionChange: (rowIndex: number, decisión: DuplicateAction) => void;
  onApplyToEquivalents: (rowIndex: number) => void;
  locale: string;
  currency: string;
}

function PreviewRowView({
  row,
  accountNames,
  onToggle,
  onDecisionChange,
  onApplyToEquivalents,
  locale,
  currency,
}: RowProps) {
  const isError = row.status === 'error';
  const isDuplicate = row.duplicateStatus !== 'unique';
  return (
    <div
      className={[
        'grid h-full items-center gap-2 border-b border-slate-800/70 px-3 py-1.5 text-sm',
        isError ? 'bg-red-950/30' : isDuplicate ? 'bg-amber-950/20' : '',
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
      <div className="min-w-0">
        {isError ? (
          <span className="text-xs text-red-400" title={row.errors.join(' ')}>
            {row.errors.join(' ')}
          </span>
        ) : isDuplicate ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={`text-xs font-medium ${STATUS_TONE[row.duplicateStatus as Exclude<PreviewRow['duplicateStatus'], 'unique'>]}`}
              title={row.duplicateReasonCodes.map((c) => REASON_CODE_LABELS[c]).join(' · ')}
            >
              {STATUS_LABELS[row.duplicateStatus as Exclude<PreviewRow['duplicateStatus'], 'unique'>]} (
              {Math.round(row.duplicateConfidence / 10)}%)
            </span>
            <select
              value={row.decision ?? 'import'}
              onChange={(e) => onDecisionChange(row.rowIndex, e.target.value as DuplicateAction)}
              className="rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-xs text-slate-200"
              aria-label={`Decisión para la fila ${row.rowIndex + 1}`}
            >
              {row.availableDecisions.map((d) => (
                <option key={d} value={d}>
                  {DECISION_LABELS[d]}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => onApplyToEquivalents(row.rowIndex)}
              className="text-xs text-slate-500 underline decoration-dotted hover:text-slate-300"
              title="Aplica esta selección e decisión a todas las filas con el mismo nivel de coincidencia"
            >
              Aplicar a equivalentes
            </button>
          </div>
        ) : (
          <span className="text-xs text-emerald-400">Nuevo</span>
        )}
      </div>
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
