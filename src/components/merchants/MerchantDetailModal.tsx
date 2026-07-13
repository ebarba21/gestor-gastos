// Detalle de un comercio: alias (crear, activar/desactivar, eliminar), movimientos asociados
// (ver y reasignar/desvincular) y aplicacion retroactiva del motor de asociacion. Toda la
// logica vive en merchantService; aqui solo orquestacion de UI.
import { useEffect, useMemo, useState } from 'react';
import type { Merchant, MerchantAlias, MerchantMatchType, Transaction } from '../../db/schema';
import { Modal, ConfirmDialog, type DialogButton } from '../common';
import { useToast } from '../../context/ToastContext';
import { merchantService } from '../../services/merchantService';
import { formatCents } from '../../lib/money';

const inputClass =
  'rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-sm text-slate-100 outline-none focus:border-slate-500';

const MATCH_TYPE_LABELS: Record<MerchantMatchType, string> = {
  exact: 'Exacto',
  contains: 'Contiene',
  startsWith: 'Empieza por',
  regex: 'Regex',
};

interface MerchantDetailModalProps {
  open: boolean;
  onClose: () => void;
  profileId: string;
  merchant: Merchant | null;
  merchants: Merchant[]; // todos, para el selector de reasignacion
  onChanged: () => void | Promise<void>;
}

export function MerchantDetailModal({
  open,
  onClose,
  profileId,
  merchant,
  merchants,
  onChanged,
}: MerchantDetailModalProps) {
  const { showToast } = useToast();
  const [aliases, setAliases] = useState<MerchantAlias[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [deletingAlias, setDeletingAlias] = useState<MerchantAlias | null>(null);
  const [applying, setApplying] = useState(false);

  // Formulario de alta de alias.
  const [rawAlias, setRawAlias] = useState('');
  const [matchType, setMatchType] = useState<MerchantMatchType>('contains');
  const [priority, setPriority] = useState(0);
  const [aliasError, setAliasError] = useState<string | null>(null);
  const [savingAlias, setSavingAlias] = useState(false);

  const load = useMemo(
    () => async () => {
      if (!merchant) return;
      setLoading(true);
      try {
        const [al, tx] = await Promise.all([
          merchantService.listAliases(profileId, merchant.id),
          merchantService.listTransactions(profileId, merchant.id),
        ]);
        setAliases(al.sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt));
        setTransactions(tx.sort((a, b) => (a.date < b.date ? 1 : -1)));
      } catch (e) {
        showToast(e instanceof Error ? e.message : 'No se pudieron cargar los datos del comercio.', 'error');
      } finally {
        setLoading(false);
      }
    },
    [merchant, profileId, showToast],
  );

  useEffect(() => {
    if (open && merchant) {
      setRawAlias('');
      setMatchType('contains');
      setPriority(0);
      setAliasError(null);
      void load();
    }
  }, [open, merchant, load]);

  if (!merchant) return null;

  async function createAlias() {
    setAliasError(null);
    setSavingAlias(true);
    try {
      await merchantService.createAlias(profileId, merchant!.id, { rawAlias, matchType, priority });
      setRawAlias('');
      setPriority(0);
      showToast('Alias creado.', 'success');
      await load();
    } catch (e) {
      setAliasError(e instanceof Error ? e.message : 'No se pudo crear el alias.');
    } finally {
      setSavingAlias(false);
    }
  }

  async function toggleAlias(alias: MerchantAlias) {
    try {
      await merchantService.setAliasEnabled(profileId, alias.id, !alias.enabled);
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'No se pudo cambiar el alias.', 'error');
    }
  }

  async function adjustPriority(alias: MerchantAlias, delta: number) {
    try {
      await merchantService.updateAlias(profileId, alias.id, { priority: alias.priority + delta });
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'No se pudo cambiar la prioridad.', 'error');
    }
  }

  async function reassign(txId: string, merchantId: string | null) {
    try {
      await merchantService.setTransactionMerchant(profileId, txId, merchantId);
      showToast(merchantId === null ? 'Movimiento desvinculado.' : 'Movimiento reasignado.', 'success');
      await load();
      await onChanged();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'No se pudo reasignar el movimiento.', 'error');
    }
  }

  async function applyRetroactive() {
    setApplying(true);
    try {
      const { changed } = await merchantService.applyRetroactive(profileId);
      showToast(`${changed} movimiento(s) actualizados en todo el perfil.`, 'success');
      await load();
      await onChanged();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'No se pudo aplicar la asociacion.', 'error');
    } finally {
      setApplying(false);
    }
  }

  const deleteAliasButtons: DialogButton[] = deletingAlias
    ? [
        { label: 'Cancelar', variant: 'ghost' },
        {
          label: 'Eliminar',
          variant: 'danger',
          onClick: async () => {
            await merchantService.removeAlias(profileId, deletingAlias.id);
            showToast('Alias eliminado.', 'success');
            await load();
          },
        },
      ]
    : [];

  const otherMerchants = merchants.filter((m) => m.id !== merchant.id);

  return (
    <Modal open={open} onClose={onClose} title={`Comercio: ${merchant.canonicalName}`}>
      <div className="max-h-[70vh] space-y-6 overflow-y-auto pr-1">
        {/* Alias */}
        <section>
          <h4 className="text-sm font-semibold text-slate-200">Alias</h4>
          <p className="mt-0.5 text-xs text-slate-500">
            Textos bancarios que se reconocen como este comercio. Se evaluan por prioridad (menor
            numero = mayor prioridad); el exacto siempre tiene preferencia sobre el resto.
          </p>

          <div className="mt-2 flex flex-wrap items-end gap-2">
            <input
              type="text"
              value={rawAlias}
              onChange={(e) => setRawAlias(e.target.value)}
              placeholder="AMZN Mktp ES"
              className={`${inputClass} min-w-[10rem] flex-1`}
            />
            <select
              value={matchType}
              onChange={(e) => setMatchType(e.target.value as MerchantMatchType)}
              className={inputClass}
            >
              {(['exact', 'contains', 'startsWith', 'regex'] as const).map((mt) => (
                <option key={mt} value={mt}>
                  {MATCH_TYPE_LABELS[mt]}
                </option>
              ))}
            </select>
            <div className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-1.5 py-1">
              <button
                type="button"
                onClick={() => setPriority((p) => p - 1)}
                aria-label="Menos prioridad"
                title="Menos prioridad (se evalua mas tarde)"
                className="px-1 text-slate-400 hover:text-slate-100"
              >
                ▼
              </button>
              <span className="w-4 text-center text-sm tabular-nums text-slate-200">{priority}</span>
              <button
                type="button"
                onClick={() => setPriority((p) => p + 1)}
                aria-label="Mas prioridad"
                title="Mas prioridad (se evalua antes)"
                className="px-1 text-slate-400 hover:text-slate-100"
              >
                ▲
              </button>
            </div>
            <button
              type="button"
              onClick={() => void createAlias()}
              disabled={savingAlias || rawAlias.trim().length === 0}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              Anadir
            </button>
          </div>
          {matchType === 'regex' && (
            <p className="mt-1 text-xs text-amber-300/80">
              Avanzado: expresion regular (patron de texto para programadores). Si no estas
              seguro, usa "Contiene" o "Empieza por" en su lugar.
            </p>
          )}
          {aliasError && <p className="mt-1 text-xs text-red-400">{aliasError}</p>}

          <div className="mt-3 space-y-1.5">
            {aliases.length === 0 ? (
              <p className="text-xs text-slate-500">Sin alias todavia.</p>
            ) : (
              aliases.map((a) => (
                <div
                  key={a.id}
                  className={[
                    'flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/60 px-2.5 py-1.5 text-sm',
                    a.enabled ? '' : 'opacity-50',
                  ].join(' ')}
                >
                  <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[11px] text-slate-400">
                    {MATCH_TYPE_LABELS[a.matchType]}
                  </span>
                  <span className="flex-1 truncate text-slate-200">{a.rawAlias}</span>
                  <span className="flex items-center gap-0.5 text-xs text-slate-500">
                    <button
                      type="button"
                      onClick={() => void adjustPriority(a, -1)}
                      aria-label="Menos prioridad"
                      title="Menos prioridad (se evalua mas tarde)"
                      className="px-1 hover:text-slate-100"
                    >
                      ▼
                    </button>
                    prio. {a.priority}
                    <button
                      type="button"
                      onClick={() => void adjustPriority(a, 1)}
                      aria-label="Mas prioridad"
                      title="Mas prioridad (se evalua antes)"
                      className="px-1 hover:text-slate-100"
                    >
                      ▲
                    </button>
                  </span>
                  <button
                    type="button"
                    onClick={() => void toggleAlias(a)}
                    className={a.enabled ? 'text-emerald-400 hover:underline' : 'text-slate-500 hover:underline'}
                  >
                    {a.enabled ? 'Activo' : 'Inactivo'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeletingAlias(a)}
                    className="text-red-400 hover:underline"
                  >
                    Eliminar
                  </button>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Movimientos */}
        <section className="border-t border-slate-800 pt-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-slate-200">
              Movimientos ({transactions.length})
            </h4>
            <button
              type="button"
              onClick={() => void applyRetroactive()}
              disabled={applying}
              title="Revisa todos los movimientos del perfil, no solo los de este comercio"
              className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50"
            >
              {applying ? 'Aplicando...' : 'Aplicar alias a todo el perfil'}
            </button>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Revisa TODOS los movimientos del perfil (no solo los de este comercio) y vincula los
            que casen con algun alias activo. Respeta las asociaciones hechas a mano.
          </p>
          {loading ? (
            <p className="mt-2 text-xs text-slate-500">Cargando...</p>
          ) : transactions.length === 0 ? (
            <p className="mt-2 text-xs text-slate-500">Sin movimientos asociados todavia.</p>
          ) : (
            <div className="mt-2 space-y-1.5">
              {transactions.slice(0, 100).map((t) => (
                <div
                  key={t.id}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/60 px-2.5 py-1.5 text-sm"
                >
                  <span className="text-xs text-slate-500">{t.date}</span>
                  <span className="min-w-0 flex-1 truncate text-slate-200">{t.concept}</span>
                  <span className="text-slate-300">{formatCents(t.amountCents, 'es-ES', 'EUR')}</span>
                  <select
                    value={t.merchantId ?? ''}
                    onChange={(e) => void reassign(t.id, e.target.value || null)}
                    className={`${inputClass} py-1 text-xs`}
                  >
                    <option value="">Sin comercio</option>
                    <option value={merchant.id}>{merchant.canonicalName} (actual)</option>
                    {otherMerchants.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.canonicalName}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
              {transactions.length > 100 && (
                <p className="text-xs text-slate-500">
                  Mostrando los 100 mas recientes de {transactions.length}.
                </p>
              )}
            </div>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={deletingAlias !== null}
        onClose={() => setDeletingAlias(null)}
        title="Eliminar alias"
        message={
          deletingAlias ? (
            <span>
              Vas a eliminar el alias <strong className="text-slate-100">{deletingAlias.rawAlias}</strong>.
              Los movimientos ya asociados no se desvinculan automaticamente.
            </span>
          ) : null
        }
        buttons={deleteAliasButtons}
      />
    </Modal>
  );
}
