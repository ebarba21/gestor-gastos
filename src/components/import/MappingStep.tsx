// Paso 2 del wizard: mapeo manual de columnas y formato. La deteccion automatica llega ya
// aplicada como sugerencia editable. Permite cargar/guardar plantillas. Sin logica de
// negocio: toda la interpretacion vive en importService/importParsing.
import { useMemo, useState } from 'react';
import type { Account, AmountStrategy, ImportTemplate } from '../../db/schema';
import {
  importService,
  columnLabels,
  type ImportMappingConfig,
  type ParsedFile,
} from '../../services/importService';

interface Props {
  parsed: ParsedFile;
  config: ImportMappingConfig;
  onConfigChange: (config: ImportMappingConfig) => void;
  accounts: Account[];
  templates: ImportTemplate[];
  onPreview: () => void;
  onBack: () => void;
  onSaveTemplate: (name: string) => void;
  onDeleteTemplate: (id: string) => void;
  busy: boolean;
}

const UNSET = -1;
const DATE_FORMATS = ['dd/MM/yyyy', 'dd/MM/yy', 'yyyy-MM-dd', 'dd-MM-yyyy', 'dd.MM.yyyy'];

export function MappingStep({
  parsed,
  config,
  onConfigChange,
  accounts,
  templates,
  onPreview,
  onBack,
  onSaveTemplate,
  onDeleteTemplate,
  busy,
}: Props) {
  const [templateName, setTemplateName] = useState('');
  const labels = useMemo(
    () => columnLabels(parsed, config.hasHeaderRow),
    [parsed, config.hasHeaderRow],
  );
  const problems = importService.configProblems(config, parsed.columnCount);
  const canPreview = problems.length === 0 && !busy;

  const previewRows = config.hasHeaderRow ? parsed.rows.slice(1, 4) : parsed.rows.slice(0, 3);

  function setColumn(field: keyof typeof config.columnMap, value: number | null) {
    onConfigChange({ ...config, columnMap: { ...config.columnMap, [field]: value } });
  }

  function setStrategy(strategy: AmountStrategy) {
    if (strategy === config.amountStrategy) return;
    const columnMap = { ...config.columnMap };
    if (strategy === 'signed') {
      columnMap.debit = null;
      columnMap.credit = null;
    } else {
      columnMap.amount = null;
    }
    onConfigChange({ ...config, amountStrategy: strategy, columnMap });
  }

  function applyTemplate(id: string) {
    if (!id) return;
    const tpl = templates.find((t) => t.id === id);
    if (!tpl) return;
    // Conserva la cuenta destino elegida si la de la plantilla ya no existe en el perfil.
    const accountExists = accounts.some((a) => a.id === tpl.defaultAccountId);
    const override = accountExists ? undefined : config.defaultAccountId;
    onConfigChange(importService.templateToConfig(tpl, override));
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold text-slate-100">Mapeo de columnas</h3>
          <p className="text-sm text-slate-400">
            {parsed.fileName} · {parsed.columnCount} columnas ·{' '}
            {config.hasHeaderRow ? parsed.rows.length - 1 : parsed.rows.length} filas de datos
          </p>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
        >
          Cambiar fichero
        </button>
      </div>

      {/* Plantillas */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Cargar plantilla
          <select
            className="min-w-48 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-100"
            defaultValue=""
            onChange={(e) => {
              applyTemplate(e.target.value);
              e.target.value = '';
            }}
          >
            <option value="">Selecciona una plantilla...</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Guardar mapeo como plantilla
            <input
              type="text"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder="Nombre (p. ej. Banco X)"
              className="w-56 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-100"
            />
          </label>
          <button
            type="button"
            disabled={templateName.trim().length === 0}
            onClick={() => {
              onSaveTemplate(templateName.trim());
              setTemplateName('');
            }}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-40"
          >
            Guardar
          </button>
        </div>
        {templates.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {templates.map((t) => (
              <span
                key={t.id}
                className="inline-flex items-center gap-1 rounded-full border border-slate-700 px-2 py-0.5 text-xs text-slate-300"
              >
                {t.name}
                <button
                  type="button"
                  aria-label={`Borrar plantilla ${t.name}`}
                  onClick={() => onDeleteTemplate(t.id)}
                  className="text-slate-500 hover:text-red-400"
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Opciones de formato */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <ColumnSelect
          label="Fecha *"
          value={numOrUnset(config.columnMap.date)}
          labels={labels}
          onChange={(v) => setColumn('date', v)}
        />
        <ColumnSelect
          label="Concepto *"
          value={numOrUnset(config.columnMap.concept)}
          labels={labels}
          onChange={(v) => setColumn('concept', v)}
        />
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Estrategia de importe
          <select
            className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-100"
            value={config.amountStrategy}
            onChange={(e) => setStrategy(e.target.value as AmountStrategy)}
          >
            <option value="signed">Una columna con signo</option>
            <option value="debitCredit">Columnas separadas de cargo y abono</option>
          </select>
        </label>

        {config.amountStrategy === 'signed' ? (
          <ColumnSelect
            label="Importe *"
            value={numOrUnset(config.columnMap.amount)}
            labels={labels}
            onChange={(v) => setColumn('amount', v)}
          />
        ) : (
          <>
            <ColumnSelect
              label="Cargo / gasto"
              value={numOrUnset(config.columnMap.debit)}
              labels={labels}
              optional
              onChange={(v) => setColumn('debit', v)}
            />
            <ColumnSelect
              label="Abono / ingreso"
              value={numOrUnset(config.columnMap.credit)}
              labels={labels}
              optional
              onChange={(v) => setColumn('credit', v)}
            />
          </>
        )}

        <ColumnSelect
          label="Cuenta (opcional)"
          value={numOrUnset(config.columnMap.account)}
          labels={labels}
          optional
          onChange={(v) => setColumn('account', v)}
        />
        <ColumnSelect
          label="Notas (opcional)"
          value={numOrUnset(config.columnMap.notes)}
          labels={labels}
          optional
          onChange={(v) => setColumn('notes', v)}
        />
      </div>

      {/* Metadatos bancarios opcionales (fase 5): mejoran la deteccion de duplicados, pero
          ninguno es obligatorio. Si el fichero no los trae, se dejan sin asignar. */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-4">
        <p className="mb-3 text-xs font-medium text-slate-400">
          Metadatos bancarios (opcionales, mejoran la deteccion de duplicados)
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <ColumnSelect
            label="Identificador de operacion"
            value={numOrUnset(config.columnMap.bankTransactionId)}
            labels={labels}
            optional
            onChange={(v) => setColumn('bankTransactionId', v)}
          />
          <ColumnSelect
            label="Fecha contable"
            value={numOrUnset(config.columnMap.bookingDate)}
            labels={labels}
            optional
            onChange={(v) => setColumn('bookingDate', v)}
          />
          <ColumnSelect
            label="Fecha valor"
            value={numOrUnset(config.columnMap.valueDate)}
            labels={labels}
            optional
            onChange={(v) => setColumn('valueDate', v)}
          />
          <ColumnSelect
            label="Pendiente / confirmado"
            value={numOrUnset(config.columnMap.pending)}
            labels={labels}
            optional
            onChange={(v) => setColumn('pending', v)}
          />
          <ColumnSelect
            label="Comercio"
            value={numOrUnset(config.columnMap.merchant)}
            labels={labels}
            optional
            onChange={(v) => setColumn('merchant', v)}
          />
          <ColumnSelect
            label="Moneda"
            value={numOrUnset(config.columnMap.currency)}
            labels={labels}
            optional
            onChange={(v) => setColumn('currency', v)}
          />
          <ColumnSelect
            label="Saldo posterior"
            value={numOrUnset(config.columnMap.balanceAfter)}
            labels={labels}
            optional
            onChange={(v) => setColumn('balanceAfter', v)}
          />
          <ColumnSelect
            label="Referencia bancaria"
            value={numOrUnset(config.columnMap.bankReference)}
            labels={labels}
            optional
            onChange={(v) => setColumn('bankReference', v)}
          />
          <ColumnSelect
            label="Tipo de operacion"
            value={numOrUnset(config.columnMap.operationType)}
            labels={labels}
            optional
            onChange={(v) => setColumn('operationType', v)}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Formato de fecha
          <input
            type="text"
            list="date-formats"
            value={config.dateFormat}
            onChange={(e) => onConfigChange({ ...config, dateFormat: e.target.value })}
            className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-100"
          />
          <datalist id="date-formats">
            {DATE_FORMATS.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Separador decimal
          <select
            className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-100"
            value={config.decimalSeparator}
            onChange={(e) =>
              onConfigChange({
                ...config,
                decimalSeparator: e.target.value as ',' | '.',
                thousandSeparator: e.target.value === ',' ? '.' : ',',
              })
            }
          >
            <option value=",">Coma (1.234,56)</option>
            <option value=".">Punto (1,234.56)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Cuenta destino por defecto *
          <select
            className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-100"
            value={config.defaultAccountId ?? ''}
            onChange={(e) =>
              onConfigChange({ ...config, defaultAccountId: e.target.value || null })
            }
          >
            <option value="">Selecciona una cuenta...</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 self-end text-sm text-slate-300">
          <input
            type="checkbox"
            checked={config.hasHeaderRow}
            onChange={(e) => onConfigChange({ ...config, hasHeaderRow: e.target.checked })}
            className="h-4 w-4"
          />
          La primera fila es cabecera
        </label>
      </div>

      {/* Vista rapida de las primeras filas */}
      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="min-w-full text-xs">
          <thead className="bg-slate-900/60 text-slate-400">
            <tr>
              {labels.map((l, i) => (
                <th key={i} className="whitespace-nowrap px-3 py-2 text-left font-medium">
                  {l}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {previewRows.map((row, ri) => (
              <tr key={ri} className="border-t border-slate-800 text-slate-300">
                {labels.map((_, ci) => (
                  <td key={ci} className="whitespace-nowrap px-3 py-1.5">
                    {cellText(row[ci])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {problems.length > 0 && (
        <ul className="list-inside list-disc text-sm text-amber-400">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          disabled={!canPreview}
          onClick={onPreview}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
        >
          Previsualizar
        </button>
      </div>
    </div>
  );
}

interface ColumnSelectProps {
  label: string;
  value: number;
  labels: string[];
  optional?: boolean;
  onChange: (value: number | null) => void;
}

function ColumnSelect({ label, value, labels, optional, onChange }: ColumnSelectProps) {
  return (
    <label className="flex flex-col gap-1 text-xs text-slate-400">
      {label}
      <select
        className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-100"
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          onChange(n === UNSET ? (optional ? null : UNSET) : n);
        }}
      >
        <option value={UNSET}>(sin asignar)</option>
        {labels.map((l, i) => (
          <option key={i} value={i}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

function numOrUnset(value: number | string | null): number {
  return typeof value === 'number' ? value : UNSET;
}

function cellText(cell: unknown): string {
  if (cell === null || cell === undefined) return '';
  if (cell instanceof Date) return cell.toLocaleDateString('es-ES');
  return String(cell);
}
