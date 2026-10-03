// Seccion Exportaciones: exportar a Excel (movimientos, cuentas, categorias, reglas, metas y
// resumen del dashboard), descargar un backup completo del perfil y restaurar un backup. Toda
// la logica vive en exportService/backupService/statsService/budgetService; aqui solo hay
// orquestacion de UI, estado local y disparo de descargas (lib/download). Ningun dato sale
// del dispositivo (invariantes 2 y 3 de CLAUDE.md).
import { useCallback, useMemo, useRef, useState } from 'react';
import type { Budget } from '../../db/schema';
import { useTransactions } from '../../hooks/useTransactions';
import { useProfiles } from '../../hooks/useProfiles';
import { useToast } from '../../context/ToastContext';
import {
  TransactionFilters,
} from '../transactions/TransactionFilters';
import { ConfirmDialog, type DialogButton } from '../common';
import type { TxFilter, TxSort } from '../../lib/transactionFilters';
import { writeXlsx, type SheetSpec } from '../../lib/csvXlsx';
import { downloadXlsx, downloadJson, timestampedFileName } from '../../lib/download';
import {
  exportService,
  EXPORT_LABELS,
  type NameLookups,
} from '../../services/exportService';
import { ruleService } from '../../services/ruleService';
import { merchantService } from '../../services/merchantService';
import { budgetService } from '../../services/budgetService';
import { debtsService } from '../../services/debtsService';
import { statsService } from '../../services/statsService';
import {
  backupService,
  type ProfileBackup,
  type BackupSummary,
  BackupError,
} from '../../services/backupService';
import { customRange, monthRange, todayISO } from '../../lib/dates';

// Orden por defecto de la exportacion de movimientos: el mismo que la lista (fecha desc).
const DEFAULT_SORT: TxSort = { field: 'date', dir: 'desc' };

interface RestoreState {
  fileName: string;
  backup: ProfileBackup;
  summary: BackupSummary;
}

export function ExportSection() {
  const {
    profileId,
    transactions,
    accounts,
    categories,
    tags,
    loading,
    error,
    reload,
    accountNames,
    categoryNames,
    tagNames,
    merchantNames,
  } = useTransactions();
  const { activeProfile, reload: reloadProfiles, switchProfile } = useProfiles();
  const { showToast } = useToast();

  const [filter, setFilter] = useState<TxFilter>({ hideSplitChildren: true });
  const [busy, setBusy] = useState(false);

  // Rango del resumen del dashboard a exportar (por defecto, el mes en curso).
  const [dashFrom, setDashFrom] = useState<string>(() => monthRange(todayISO()).from);
  const [dashTo, setDashTo] = useState<string>(() => todayISO());

  // Restauracion.
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [restore, setRestore] = useState<RestoreState | null>(null);

  const names: NameLookups = useMemo(
    () => ({ accountNames, categoryNames, tagNames, merchantNames }),
    [accountNames, categoryNames, tagNames, merchantNames],
  );

  // Descarga un libro XLSX (una o varias hojas) con manejo de errores explicito.
  const exportWorkbook = useCallback(
    async (sheets: SheetSpec[], label: string) => {
      if (busy) return;
      setBusy(true);
      try {
        const bytes = await writeXlsx(sheets);
        downloadXlsx(bytes, timestampedFileName(`gestor-${label}`, 'xlsx'));
        showToast('Exportacion generada.', 'success');
      } catch (e) {
        showToast(e instanceof Error ? e.message : 'No se pudo generar la exportacion.', 'error');
      } finally {
        setBusy(false);
      }
    },
    [busy, showToast],
  );

  const exportFilteredTransactions = () =>
    void exportWorkbook(
      [exportService.buildFilteredTransactionsSheet(transactions, filter, DEFAULT_SORT, names)],
      EXPORT_LABELS.filteredTransactions,
    );

  const exportAllTransactions = () =>
    void exportWorkbook(
      [exportService.buildTransactionsSheet(transactions, names)],
      EXPORT_LABELS.allTransactions,
    );

  const exportAccounts = () => {
    const balances = exportService.computeAccountBalances(accounts, transactions);
    void exportWorkbook([exportService.buildAccountsSheet(accounts, balances)], EXPORT_LABELS.accounts);
  };

  const exportCategories = () =>
    void exportWorkbook([exportService.buildCategoriesSheet(categories)], EXPORT_LABELS.categories);

  const exportMerchants = async () => {
    try {
      const [merchants, aliases] = await Promise.all([
        merchantService.list(profileId),
        merchantService.listAllAliases(profileId),
      ]);
      await exportWorkbook(
        [
          exportService.buildMerchantsSheet(merchants, names),
          exportService.buildMerchantAliasesSheet(aliases, merchantNames),
        ],
        EXPORT_LABELS.merchants,
      );
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'No se pudieron cargar los comercios.', 'error');
    }
  };

  const exportRules = async () => {
    try {
      const rules = await ruleService.list(profileId);
      await exportWorkbook([exportService.buildRulesSheet(rules, names)], EXPORT_LABELS.rules);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'No se pudieron cargar las reglas.', 'error');
    }
  };

  const exportDebts = async () => {
    try {
      const { debts, payments } = await debtsService.listAllForExport(profileId);
      const debtNames = new Map(debts.map((d) => [d.id, d.name]));
      await exportWorkbook(
        [
          exportService.buildDebtsSheet(debts, names),
          exportService.buildDebtPaymentsSheet(payments, debtNames),
        ],
        EXPORT_LABELS.debts,
      );
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'No se pudieron cargar las deudas.', 'error');
    }
  };

  // Nombre del ambito de una meta (categoria/subcategoria/cuenta) para la hoja de metas.
  const scopeNameOf = useCallback(
    (budget: Budget): string => {
      if (budget.scope === 'overall' || budget.scopeId === null) return '';
      if (budget.scope === 'account') return accountNames.get(budget.scopeId) ?? budget.scopeId;
      return categoryNames.get(budget.scopeId) ?? budget.scopeId;
    },
    [accountNames, categoryNames],
  );

  const exportBudgets = async () => {
    try {
      const evaluations = await budgetService.evaluateActive(profileId);
      await exportWorkbook(
        [exportService.buildBudgetsSheet(evaluations, scopeNameOf)],
        EXPORT_LABELS.budgets,
      );
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'No se pudieron evaluar las metas.', 'error');
    }
  };

  const exportDashboard = async () => {
    let range;
    try {
      range = customRange(dashFrom, dashTo);
    } catch {
      showToast('El rango del dashboard no es valido: la fecha inicial es posterior a la final.', 'error');
      return;
    }
    try {
      const data = await statsService.computeDashboard(profileId, {
        range,
        anchorISO: range.to,
      });
      await exportWorkbook(exportService.buildDashboardSheets(data, names), EXPORT_LABELS.dashboard);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'No se pudo calcular el dashboard.', 'error');
    }
  };

  // --- Backup ---

  const downloadBackup = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const backup = await backupService.createBackup(profileId);
      const text = backupService.serializeBackup(backup);
      const base = `gestor-backup-${activeProfile?.name ?? 'perfil'}`;
      downloadJson(text, timestampedFileName(base, 'json'));
      showToast('Backup descargado.', 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'No se pudo generar el backup.', 'error');
    } finally {
      setBusy(false);
    }
  };

  // --- Restauracion ---

  const onPickFile = async (file: File | null) => {
    // Reinicia el input para poder volver a elegir el mismo fichero si se cancela.
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const backup = backupService.parseBackup(text);
      const summary = backupService.summarizeBackup(backup);
      setRestore({ fileName: file.name, backup, summary });
    } catch (e) {
      const msg =
        e instanceof BackupError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'No se pudo leer el archivo de backup.';
      showToast(msg, 'error');
    }
  };

  const restoreButtons: DialogButton[] = restore
    ? [
        { label: 'Cancelar', variant: 'ghost' },
        {
          label: 'Crear perfil nuevo',
          variant: 'primary',
          onClick: () => doRestoreWithMode('new'),
        },
        {
          label: 'Sobrescribir este perfil',
          variant: 'danger',
          onClick: () => doRestoreWithMode('overwrite'),
        },
      ]
    : [];

  // Ejecuta la restauracion con un modo concreto. ConfirmDialog cierra al resolver y muestra
  // el error si la promesa rechaza (la restauracion es atomica: no deja el perfil a medias).
  async function doRestoreWithMode(mode: 'overwrite' | 'new') {
    if (!restore) return;
    if (mode === 'overwrite') {
      await backupService.restoreIntoActiveProfile(profileId, restore.backup);
      await reload();
      await reloadProfiles();
      showToast('Backup restaurado en este perfil.', 'success');
    } else {
      const created = await backupService.restoreAsNewProfile(restore.backup);
      await reloadProfiles();
      switchProfile(created.id);
      showToast(`Perfil "${created.name}" creado desde el backup.`, 'success');
    }
    setRestore(null);
  }

  const exportBtn =
    'rounded-lg border border-slate-700 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50';

  return (
    <section className="max-w-3xl space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-slate-100">Exportaciones y backup</h2>
        <p className="mt-1 text-sm text-slate-400">
          El backup se genera en este dispositivo. Ningun archivo bancario original ni dato del
          backup se sube de forma automatica: eres tu quien decide donde guardarlo.
        </p>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {loading && <p className="text-sm text-slate-500">Cargando datos del perfil...</p>}

      {/* Exportar a Excel */}
      <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Exportar a Excel
        </h3>

        <div>
          <p className="mb-2 text-sm text-slate-300">
            Movimientos filtrados. Ajusta los filtros y exporta exactamente lo que muestran.
          </p>
          <TransactionFilters
            filter={filter}
            onChange={(next) => setFilter({ ...next, hideSplitChildren: true })}
            accounts={accounts}
            categories={categories}
            tags={tags}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={exportFilteredTransactions} className={exportBtn}>
              Exportar movimientos filtrados
            </button>
            <button type="button" disabled={busy} onClick={exportAllTransactions} className={exportBtn}>
              Exportar todos los movimientos
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 border-t border-slate-800 pt-4">
          <button type="button" disabled={busy} onClick={exportAccounts} className={exportBtn}>
            Cuentas
          </button>
          <button type="button" disabled={busy} onClick={exportCategories} className={exportBtn}>
            Categorias
          </button>
          <button type="button" disabled={busy} onClick={() => void exportRules()} className={exportBtn}>
            Reglas
          </button>
          <button type="button" disabled={busy} onClick={() => void exportMerchants()} className={exportBtn}>
            Comercios
          </button>
          <button type="button" disabled={busy} onClick={() => void exportBudgets()} className={exportBtn}>
            Metas
          </button>
          <button type="button" disabled={busy} onClick={() => void exportDebts()} className={exportBtn}>
            Deudas
          </button>
        </div>

        <div className="border-t border-slate-800 pt-4">
          <p className="mb-2 text-sm text-slate-300">Resumen del dashboard (periodo):</p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-slate-400">
              Desde
              <input
                type="date"
                value={dashFrom}
                onChange={(e) => setDashFrom(e.target.value)}
                className="mt-1 block rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
              />
            </label>
            <label className="text-xs text-slate-400">
              Hasta
              <input
                type="date"
                value={dashTo}
                onChange={(e) => setDashTo(e.target.value)}
                className="mt-1 block rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
              />
            </label>
            <button type="button" disabled={busy} onClick={() => void exportDashboard()} className={exportBtn}>
              Exportar resumen del dashboard
            </button>
          </div>
        </div>
      </div>

      {/* Backup completo */}
      <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Copia de seguridad del perfil
        </h3>
        <p className="text-sm text-slate-400">
          Un unico archivo JSON con todos los datos de este perfil. Sirve para guardarlo a buen
          recaudo o moverlo a otro dispositivo.
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => void downloadBackup()}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          Descargar backup de este perfil
        </button>
      </div>

      {/* Restaurar */}
      <div className="space-y-3 rounded-2xl border border-amber-900/50 bg-amber-950/10 p-5">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-amber-400">
          Restaurar un backup
        </h3>
        <p className="text-sm text-slate-400">
          Elige un archivo de backup. Antes de aplicar nada te pediremos confirmacion y podras
          decidir si sobrescribes este perfil o creas uno nuevo.
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          onChange={(e) => void onPickFile(e.target.files?.[0] ?? null)}
          className="block w-full min-w-0 max-w-full text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-700 file:px-4 file:py-2 file:text-sm file:font-medium file:text-slate-100 hover:file:bg-slate-600"
        />
      </div>

      <ConfirmDialog
        open={restore !== null}
        onClose={() => setRestore(null)}
        title="Restaurar backup"
        message={
          restore ? (
            <div className="space-y-2">
              <p>
                Archivo <strong className="text-slate-100">{restore.fileName}</strong>, perfil{' '}
                <strong className="text-slate-100">{restore.summary.profileName}</strong>.
              </p>
              <p className="text-slate-400">
                Contiene {restore.summary.counts.transactions} movimientos,{' '}
                {restore.summary.counts.accounts} cuentas, {restore.summary.counts.categories}{' '}
                categorias, {restore.summary.counts.merchants} comercios (
                {restore.summary.counts.merchantAliases} alias), {restore.summary.counts.rules}{' '}
                reglas, {restore.summary.counts.budgets} metas y {restore.summary.counts.debts}{' '}
                deudas.
              </p>
              <p className="text-amber-300">
                <strong>Sobrescribir este perfil</strong> borra por completo los datos actuales de{' '}
                <strong className="text-slate-100">{activeProfile?.name}</strong> y los reemplaza por
                los del backup. <strong>Crear perfil nuevo</strong> deja este perfil intacto. Haz un
                backup previo si tienes dudas. Esta accion no se puede deshacer.
              </p>
            </div>
          ) : null
        }
        buttons={restoreButtons}
      />
    </section>
  );
}
