// Modal de importacion de reglas desde CSV/XLSX. Reutiliza el lexer de fichero de la fase de
// importacion (importService.parseFile) y el patron de mapeo de columnas + previsualizacion.
// Cada fila del fichero es una regla con una condicion. Toda la logica vive en
// ruleImportService; aqui solo orquestacion de UI.
import { useRef, useState } from 'react';
import { Modal } from '../common';
import { useToast } from '../../context/ToastContext';
import { importService, type ParsedFile } from '../../services/importService';
import {
  ruleImportService,
  emptyRuleColumnMap,
  ruleColumnLabels,
  type RuleImportColumnMap,
  type RuleImportConfig,
  type RuleImportContext,
  type RuleImportPreview,
} from '../../services/ruleImportService';

type Step = 'select' | 'map' | 'preview';

// Columnas mapeables y su etiqueta. value/category son las importantes; el resto opcionales.
const MAP_FIELDS: { key: keyof RuleImportColumnMap; label: string; hint?: string }[] = [
  { key: 'value', label: 'Valor de la condicion', hint: 'obligatorio' },
  { key: 'category', label: 'Categoría (acción)', hint: 'por nombre' },
  { key: 'field', label: 'Campo', hint: 'por defecto concepto' },
  { key: 'operator', label: 'Operador', hint: 'por defecto contiene' },
  { key: 'value2', label: 'Segundo valor', hint: 'rangos' },
  { key: 'subcategory', label: 'Subcategoría', hint: 'por nombre' },
  { key: 'tags', label: 'Etiquetas', hint: 'separadas por ; o ,' },
  { key: 'name', label: 'Nombre de la regla' },
  { key: 'caseSensitive', label: 'Sensible a mayusculas' },
  { key: 'matchMode', label: 'Modo (todas/alguna)' },
  { key: 'excludeFromStats', label: 'Excluir de estadisticas' },
  { key: 'enabled', label: 'Activa' },
  { key: 'stopOnMatch', label: 'Detener al casar' },
];

interface RuleImportModalProps {
  open: boolean;
  onClose: () => void;
  profileId: string;
  context: RuleImportContext;
  onImported: () => void | Promise<void>;
}

export function RuleImportModal({
  open,
  onClose,
  profileId,
  context,
  onImported,
}: RuleImportModalProps) {
  const { showToast } = useToast();
  const [step, setStep] = useState<Step>('select');
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [config, setConfig] = useState<RuleImportConfig>({
    columnMap: emptyRuleColumnMap(),
    hasHeaderRow: true,
  });
  const [preview, setPreview] = useState<RuleImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setStep('select');
    setParsed(null);
    setConfig({ columnMap: emptyRuleColumnMap(), hasHeaderRow: true });
    setPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleFile(file: File) {
    setBusy(true);
    try {
      const parsedFile = await importService.parseFile(file);
      setParsed(parsedFile);
      setConfig({ columnMap: emptyRuleColumnMap(), hasHeaderRow: true });
      setPreview(null);
      setStep('map');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'No se pudo leer el fichero.', 'error');
    } finally {
      setBusy(false);
    }
  }

  function setColumn(key: keyof RuleImportColumnMap, value: string) {
    const idx = value === '' ? null : Number(value);
    setConfig((cur) => ({ ...cur, columnMap: { ...cur.columnMap, [key]: idx } }));
  }

  function handlePreview() {
    if (!parsed) return;
    const problems = ruleImportService.configProblems(config, parsed.columnCount);
    if (problems.length > 0) {
      showToast(problems.join(' '), 'error');
      return;
    }
    try {
      const result = ruleImportService.buildPreview(profileId, parsed, config, context);
      setPreview(result);
      setStep('preview');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'No se pudo previsualizar.', 'error');
    }
  }

  function toggleRow(rowIndex: number) {
    setPreview((prev) =>
      prev
        ? {
            ...prev,
            rows: prev.rows.map((r) =>
              r.rowIndex === rowIndex && r.status === 'ok' ? { ...r, include: !r.include } : r,
            ),
          }
        : prev,
    );
  }

  async function handleCommit() {
    if (!preview) return;
    setBusy(true);
    try {
      const { created } = await ruleImportService.commit(profileId, preview);
      showToast(`${created} regla(s) importadas.`, 'success');
      await onImported();
      handleClose();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'No se pudo importar.', 'error');
    } finally {
      setBusy(false);
    }
  }

  const labels = parsed ? ruleColumnLabels(parsed, config.hasHeaderRow) : [];
  const includedCount = preview ? preview.rows.filter((r) => r.include).length : 0;

  return (
    <Modal open={open} onClose={handleClose} title="Importar reglas" dismissible={!busy}>
      <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
        {step === 'select' && (
          <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/40 p-8 text-center">
            <p className="text-3xl">📄</p>
            <p className="mt-2 text-sm text-slate-300">
              Selecciona un CSV o XLSX con tus reglas (una fila por regla).
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              className="sr-only"
              id="rule-import-file"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
              }}
            />
            <label
              htmlFor="rule-import-file"
              className="mt-3 inline-block cursor-pointer rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
            >
              {busy ? 'Leyendo...' : 'Elegir fichero'}
            </label>
          </div>
        )}

        {step === 'map' && parsed && (
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={config.hasHeaderRow}
                onChange={(e) => setConfig((c) => ({ ...c, hasHeaderRow: e.target.checked }))}
              />
              La primera fila es cabecera
            </label>
            <p className="text-xs text-slate-500">
              Asigna las columnas del fichero. Solo el valor de la condicion y la categoría (o
              etiquetas) son obligatorios; el resto usa valores por defecto.
            </p>
            <div className="space-y-1.5">
              {MAP_FIELDS.map((mf) => (
                <div key={mf.key} className="flex items-center gap-2">
                  <span className="w-48 shrink-0 text-sm text-slate-300">
                    {mf.label}
                    {mf.hint && <span className="ml-1 text-[11px] text-slate-500">({mf.hint})</span>}
                  </span>
                  <select
                    value={config.columnMap[mf.key] ?? ''}
                    onChange={(e) => setColumn(mf.key, e.target.value)}
                    className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-slate-500"
                  >
                    <option value="">Sin asignar</option>
                    {labels.map((label, idx) => (
                      <option key={idx} value={idx}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <div className="flex justify-between pt-1">
              <button
                type="button"
                onClick={reset}
                className="rounded-lg px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
              >
                Atras
              </button>
              <button
                type="button"
                onClick={handlePreview}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
              >
                Previsualizar
              </button>
            </div>
          </div>
        )}

        {step === 'preview' && preview && (
          <div className="space-y-3">
            <p className="text-sm text-slate-300">
              {preview.summary.ok} regla(s) validas · {preview.summary.errors} con errores ·{' '}
              {preview.summary.total} filas.
            </p>
            <div className="max-h-72 divide-y divide-slate-800 overflow-y-auto rounded-lg border border-slate-800">
              {preview.rows.map((r) => (
                <div key={r.rowIndex} className="flex items-start gap-2 px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={r.include}
                    disabled={r.status === 'error'}
                    onChange={() => toggleRow(r.rowIndex)}
                    className="mt-0.5 h-4 w-4 shrink-0 disabled:opacity-40"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-slate-200">{r.displayName}</p>
                    <p className="truncate text-xs text-slate-500">{r.displaySummary}</p>
                    {r.errors.length > 0 && (
                      <p className="text-xs text-red-400">{r.errors.join(' ')}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-between pt-1">
              <button
                type="button"
                onClick={() => setStep('map')}
                className="rounded-lg px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
              >
                Atras
              </button>
              <button
                type="button"
                onClick={handleCommit}
                disabled={busy || includedCount === 0}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {busy ? 'Importando...' : `Importar ${includedCount}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
