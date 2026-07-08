// Seccion Importar datos: wizard fichero -> mapeo/plantilla -> previsualizacion/duplicados
// -> commit atomico, mas el historial de lotes con "deshacer". Orquestacion de UI; toda la
// logica (parseo, mapeo, duplicados, atomicidad, aislamiento) vive en importService.
import { useCallback, useRef, useState } from 'react';
import { useImport } from '../../hooks/useImport';
import { useToast } from '../../context/ToastContext';
import {
  importService,
  type ImportMappingConfig,
  type ImportPreview,
  type ParsedFile,
} from '../../services/importService';
import type { ImportBatch } from '../../db/schema';
import { EmptyState, ConfirmDialog, type DialogButton } from '../common';
import { MappingStep } from './MappingStep';
import { PreviewStep } from './PreviewStep';

const LOCALE = 'es-ES';
const CURRENCY = 'EUR';

type Step = 'select' | 'map' | 'preview';

export function ImportSection() {
  const { profileId, accounts, templates, batches, loading, error, reload, accountNames } =
    useImport();
  const { showToast } = useToast();

  const [step, setStep] = useState<Step>('select');
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [config, setConfig] = useState<ImportMappingConfig | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [undoTarget, setUndoTarget] = useState<ImportBatch | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetWizard = useCallback(() => {
    setStep('select');
    setParsed(null);
    setConfig(null);
    setPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  async function handleFile(file: File) {
    setBusy(true);
    try {
      const parsedFile = await importService.parseFile(file);
      const suggested = importService.suggestConfig(parsedFile, accounts[0]?.id ?? null);
      setParsed(parsedFile);
      setConfig(suggested);
      setPreview(null);
      setStep('map');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'No se pudo leer el fichero.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handlePreview() {
    if (!parsed || !config) return;
    setBusy(true);
    try {
      const result = await importService.buildPreview(profileId, parsed, config, accounts);
      setPreview(result);
      setStep('preview');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'No se pudo previsualizar.', 'error');
    } finally {
      setBusy(false);
    }
  }

  function toggleRow(rowIndex: number) {
    setPreview((prev) =>
      prev
        ? {
            ...prev,
            rows: prev.rows.map((r) =>
              r.rowIndex === rowIndex ? { ...r, include: !r.include } : r,
            ),
          }
        : prev,
    );
  }

  function includeAllValid() {
    setPreview((prev) =>
      prev
        ? { ...prev, rows: prev.rows.map((r) => ({ ...r, include: r.status !== 'error' })) }
        : prev,
    );
  }

  function excludeDuplicates() {
    setPreview((prev) =>
      prev
        ? {
            ...prev,
            rows: prev.rows.map((r) => (r.duplicate ? { ...r, include: false } : r)),
          }
        : prev,
    );
  }

  async function handleCommit() {
    if (!parsed || !preview) return;
    setBusy(true);
    try {
      const { imported } = await importService.commit(profileId, {
        parsed,
        preview,
        templateId: null,
      });
      showToast(`${imported} movimiento(s) importados.`, 'success');
      resetWizard();
      await reload();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'No se pudo completar la importacion.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveTemplate(name: string) {
    if (!parsed || !config) return;
    try {
      await importService.saveTemplate(profileId, name, parsed.sourceFormat, config);
      showToast(`Plantilla "${name}" guardada.`, 'success');
      await reload();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'No se pudo guardar la plantilla.', 'error');
    }
  }

  async function handleDeleteTemplate(id: string) {
    try {
      await importService.deleteTemplate(profileId, id);
      showToast('Plantilla borrada.', 'info');
      await reload();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'No se pudo borrar la plantilla.', 'error');
    }
  }

  const undoButtons: DialogButton[] = undoTarget
    ? [
        { label: 'Cancelar', variant: 'ghost' },
        {
          label: 'Deshacer importacion',
          variant: 'danger',
          onClick: async () => {
            try {
              const removed = await importService.undo(profileId, undoTarget.id);
              showToast(`Importacion deshecha: ${removed} movimiento(s) borrados.`, 'success');
              await reload();
            } catch (e) {
              showToast(
                e instanceof Error ? e.message : 'No se pudo deshacer la importacion.',
                'error',
              );
            }
          },
        },
      ]
    : [];

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-100">Importar datos</h2>
        <p className="mt-1 text-sm text-slate-400">
          Sube un extracto CSV o XLSX. Se procesa por completo en tu dispositivo; ningun dato
          sale de aqui.
        </p>
      </div>

      {accounts.length === 0 ? (
        <EmptyState
          icon="🏦"
          title="Necesitas una cuenta"
          description="Crea al menos una cuenta antes de importar movimientos: sera el destino de la importacion."
        />
      ) : (
        <>
          {/* Paso 1: seleccion de fichero */}
          {step === 'select' && (
            <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/40 p-10 text-center">
              <p className="text-4xl">📄</p>
              <p className="mt-3 text-sm text-slate-300">
                Selecciona un fichero CSV o XLSX de tu banco
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                className="sr-only"
                id="import-file-input"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleFile(file);
                }}
              />
              <label
                htmlFor="import-file-input"
                className="mt-4 inline-block cursor-pointer rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
              >
                {busy ? 'Leyendo...' : 'Elegir fichero'}
              </label>
            </div>
          )}

          {/* Paso 2: mapeo */}
          {step === 'map' && parsed && config && (
            <MappingStep
              parsed={parsed}
              config={config}
              onConfigChange={setConfig}
              accounts={accounts}
              templates={templates}
              onPreview={handlePreview}
              onBack={resetWizard}
              onSaveTemplate={handleSaveTemplate}
              onDeleteTemplate={handleDeleteTemplate}
              busy={busy}
            />
          )}

          {/* Paso 3: previsualizacion */}
          {step === 'preview' && preview && (
            <PreviewStep
              preview={preview}
              accountNames={accountNames}
              onToggleRow={toggleRow}
              onIncludeAllValid={includeAllValid}
              onExcludeDuplicates={excludeDuplicates}
              onCommit={handleCommit}
              onBack={() => setStep('map')}
              busy={busy}
              locale={LOCALE}
              currency={CURRENCY}
            />
          )}
        </>
      )}

      {/* Historial de lotes */}
      {error && <p className="text-sm text-red-400">{error}</p>}
      {!loading && batches.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-300">Importaciones recientes</h3>
          <div className="divide-y divide-slate-800 rounded-xl border border-slate-800">
            {batches.map((b) => (
              <div
                key={b.id}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate text-slate-200">{b.fileName}</p>
                  <p className="text-xs text-slate-500">
                    {new Date(b.importedAt).toLocaleString(LOCALE)} · {b.rowsImported} importados
                    {b.rowsSkippedDuplicate > 0
                      ? ` · ${b.rowsSkippedDuplicate} duplicados omitidos`
                      : ''}
                  </p>
                </div>
                {b.status === 'committed' ? (
                  <button
                    type="button"
                    onClick={() => setUndoTarget(b)}
                    className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
                  >
                    Deshacer
                  </button>
                ) : (
                  <span className="text-xs text-slate-500">Deshecha</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={undoTarget !== null}
        onClose={() => setUndoTarget(null)}
        title="Deshacer importacion"
        message={
          undoTarget ? (
            <span>
              Se borraran los <strong className="text-slate-100">{undoTarget.rowsImported}</strong>{' '}
              movimientos importados desde{' '}
              <strong className="text-slate-100">{undoTarget.fileName}</strong>. Esta accion no
              afecta a movimientos creados o editados despues.
            </span>
          ) : null
        }
        buttons={undoButtons}
      />
    </section>
  );
}
