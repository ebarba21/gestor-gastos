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
import type { DuplicateAction } from '../../services/duplicateEngine';
import { reviewService, type ImportRowError } from '../../services/reviewService';
import { ruleService } from '../../services/ruleService';
import { transactionsRepo } from '../../db/transactionsRepo';
import type { ImportBatch } from '../../db/schema';
import { EmptyState, ConfirmDialog, type DialogButton } from '../common';
import { MappingStep } from './MappingStep';
import { PreviewStep } from './PreviewStep';
import { ImportSummaryStep, type ImportSummaryData } from './ImportSummaryStep';

const LOCALE = 'es-ES';
const CURRENCY = 'EUR';

type Step = 'select' | 'map' | 'preview' | 'summary';

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
  // Aviso de "archivo repetido" (fase 5): lotes previos con el mismo contenido. Pendiente de
  // confirmar/cancelar antes de continuar con el fichero recien leido.
  const [repeatedBatches, setRepeatedBatches] = useState<ImportBatch[]>([]);
  const [pendingFile, setPendingFile] = useState<{ parsed: ParsedFile; fileForConfig: File } | null>(null);
  const [summary, setSummary] = useState<ImportSummaryData | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetWizard = useCallback(() => {
    setStep('select');
    setParsed(null);
    setConfig(null);
    setSummary(null);
    setPreview(null);
    setRepeatedBatches([]);
    setPendingFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  function proceedToMapping(parsedFile: ParsedFile) {
    const suggested = importService.suggestConfig(parsedFile, accounts[0]?.id ?? null);
    setParsed(parsedFile);
    setConfig(suggested);
    setPreview(null);
    setStep('map');
  }

  async function handleFile(file: File) {
    setBusy(true);
    try {
      const parsedFile = await importService.parseFile(file);
      // Aviso de archivo repetido ANTES de avanzar: muestra el lote anterior (fecha, filas) y
      // deja cancelar o continuar explicitamente (alcance fase 5, punto 9).
      const repeated = await importService.checkRepeatedFile(profileId, parsedFile.sourceFileHash);
      if (repeated.length > 0) {
        setRepeatedBatches(repeated);
        setPendingFile({ parsed: parsedFile, fileForConfig: file });
        return;
      }
      proceedToMapping(parsedFile);
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

  function setRowDecision(rowIndex: number, decision: DuplicateAction) {
    setPreview((prev) =>
      prev
        ? {
            ...prev,
            rows: prev.rows.map((r) =>
              // El campo es `decision` (sin tilde): antes se escribia una propiedad `decisión`
              // distinta y por eso el desplegable no aplicaba nada. Ademas, elegir una decision es
              // intencion de importar (el desplegable no incluye "omitir": omitir = casilla sin
              // marcar), asi que se marca la fila para incluirla en la importacion.
              r.rowIndex === rowIndex ? { ...r, decision, include: true } : r,
            ),
          }
        : prev,
    );
  }

  // "Aplicar a filas equivalentes" (alcance fase 5, punto 8): aplica la decision e inclusion
  // de una fila a todas las filas del mismo nivel de duplicado (mismo duplicateStatus). Solo
  // copia la decision de origen si es una opcion valida para la fila destino (p. ej.
  // 'vincular'/'sustituir pendiente' no son honrables contra un candidato del propio fichero
  // aun sin persistir): si no lo es, esa fila conserva su propia decision en vez de heredar
  // una que commit() rechazaria.
  function applyToEquivalents(rowIndex: number) {
    setPreview((prev) => {
      if (!prev) return prev;
      const source = prev.rows.find((r) => r.rowIndex === rowIndex);
      if (!source) return prev;
      return {
        ...prev,
        rows: prev.rows.map((r) => {
          if (r.duplicateStatus !== source.duplicateStatus || r.rowIndex === rowIndex) return r;
          const decision =
            source.decision !== null && r.availableDecisions.includes(source.decision)
              ? source.decision
              : r.decision;
          // Campo `decision` (sin tilde): igual que en setRowDecision, antes se escribia una
          // propiedad `decisión` distinta y la equivalencia no se propagaba de verdad.
          return { ...r, include: source.include, decision };
        }),
      };
    });
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
            rows: prev.rows.map((r) =>
              r.duplicateStatus !== 'unique' ? { ...r, include: false } : r,
            ),
          }
        : prev,
    );
  }

  async function handleCommit() {
    if (!parsed || !preview || busy) return;
    setBusy(true);
    try {
      const { batch, imported, linked } = await importService.commit(profileId, {
        parsed,
        preview,
        templateId: null,
      });

      // Genera las tareas de revision de este lote (sin categorizar, posible duplicado,
      // comercio nuevo, errores de fila) y despues un escaneo completo bajo demanda para
      // transferencias/reembolsos candidatos y pendientes antiguos (ARCHITECTURE seccion 17;
      // ambos idempotentes, nunca duplican tareas ya abiertas).
      const createdTransactions = await transactionsRepo.listByImportBatch(profileId, batch.id);
      const rowErrors: ImportRowError[] = preview.rows
        .filter((r) => r.status === 'error')
        .map((r) => ({
          row: r.rowIndex + 1,
          field: 'fila',
          value: r.raw.map((c) => String(c ?? '')).join(' | '),
          reason: r.errors.join(' '),
        }));
      await reviewService.generateFromImportBatch(profileId, batch.id, createdTransactions, rowErrors);
      const enabledRules = await ruleService.listEnabled(profileId);
      await reviewService.generateFromRuleMatches(profileId, createdTransactions, enabledRules);
      await reviewService.runFullScan(profileId);
      const reviewCounts = await reviewService.countsByType(profileId);

      const netEffectCents = createdTransactions.reduce((sum, t) => sum + t.amountCents, 0);
      setSummary({
        batchId: batch.id,
        fileName: parsed.fileName,
        rowsTotal: preview.summary.total,
        imported,
        linked,
        skippedDuplicate: preview.summary.duplicates,
        errors: preview.summary.errors,
        categorized: createdTransactions.filter((t) => t.categoryId !== null).length,
        merchantsMatched: createdTransactions.filter((t) => t.merchantId !== null).length,
        netEffectCents,
        reviewTotal: reviewCounts.total,
        reviewByType: reviewCounts.byType,
      });
      setStep('summary');
      await reload();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'No se pudo completar la importación.', 'error');
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
          label: 'Deshacer importación',
          variant: 'danger',
          onClick: async () => {
            try {
              const removed = await importService.undo(profileId, undoTarget.id);
              showToast(`Importación deshecha: ${removed} movimiento(s) borrados.`, 'success');
              await reload();
            } catch (e) {
              showToast(
                e instanceof Error ? e.message : 'No se pudo deshacer la importación.',
                'error',
              );
            }
          },
        },
      ]
    : [];

  const repeatedFileButtons: DialogButton[] = [
    {
      label: 'Cancelar',
      variant: 'ghost',
      onClick: () => {
        setRepeatedBatches([]);
        setPendingFile(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
      },
    },
    {
      label: 'Continuar de todos modos',
      variant: 'primary',
      onClick: () => {
        if (pendingFile) proceedToMapping(pendingFile.parsed);
        setRepeatedBatches([]);
        setPendingFile(null);
      },
    },
  ];

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-100">Importar datos</h2>
        <p className="mt-1 text-sm text-slate-400">
          Sube un extracto CSV o XLSX. El fichero se procesa por completo en tu dispositivo y
          nunca se sube: solo su hash y tamaño se guardan para detectar reimportaciones. Si
          tienes una cuenta vinculada, los movimientos procesados se sincronizan de forma
          privada con tu proyecto Supabase.
        </p>
      </div>

      {accounts.length === 0 ? (
        <EmptyState
          icon="🏦"
          title="Necesitas una cuenta"
          description="Crea al menos una cuenta antes de importar movimientos: será el destino de la importación."
        />
      ) : (
        <>
          {/* Paso 1: selección de fichero */}
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
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleFile(file);
                }}
              />
              <label
                htmlFor="import-file-input"
                className="mt-4 inline-block cursor-pointer rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 aria-disabled:pointer-events-none aria-disabled:opacity-40"
                aria-disabled={busy}
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
              onDecisionChange={setRowDecision}
              onApplyToEquivalents={applyToEquivalents}
              onIncludeAllValid={includeAllValid}
              onExcludeDuplicates={excludeDuplicates}
              onCommit={handleCommit}
              onBack={() => setStep('map')}
              busy={busy}
              locale={LOCALE}
              currency={CURRENCY}
            />
          )}

          {/* Paso 4: resumen (flujo posterior a importar, ARCHITECTURE sección 17) */}
          {step === 'summary' && summary && (
            <ImportSummaryStep
              summary={summary}
              locale={LOCALE}
              currency={CURRENCY}
              onImportAnother={resetWizard}
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
                    {b.rowsLinked > 0 ? ` · ${b.rowsLinked} vinculados` : ''}
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
        title="Deshacer importación"
        message={
          undoTarget ? (
            <span>
              Se borraran los <strong className="text-slate-100">{undoTarget.rowsImported}</strong>{' '}
              movimientos importados desde{' '}
              <strong className="text-slate-100">{undoTarget.fileName}</strong>. Esta acción no
              afecta a movimientos creados o editados después.
            </span>
          ) : null
        }
        buttons={undoButtons}
      />

      <ConfirmDialog
        open={repeatedBatches.length > 0}
        onClose={() => {
          setRepeatedBatches([]);
          setPendingFile(null);
        }}
        title="Este fichero ya se importo antes"
        message={
          <div className="space-y-2">
            <p>
              Este mismo fichero (mismo contenido, aunque el nombre pueda variar) ya se importo
              anteriormente:
            </p>
            <ul className="list-inside list-disc text-slate-300">
              {repeatedBatches.map((b) => (
                <li key={b.id}>
                  {b.fileName} · {new Date(b.importedAt).toLocaleString(LOCALE)} ·{' '}
                  {b.rowsImported} movimiento(s)
                  {b.status === 'undone' ? ' (deshecho)' : ''}
                </li>
              ))}
            </ul>
            <p>
              Puedes cancelar, o continuar de todos modos: el detector de duplicados fila a fila
              seguira avisando de cualquier movimiento repetido.
            </p>
          </div>
        }
        buttons={repeatedFileButtons}
      />
    </section>
  );
}
