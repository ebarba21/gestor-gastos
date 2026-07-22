// Menu de acciones de un movimiento (transferencia, reembolso, split, exclusion, borrado).
// Las acciones directas (sin datos extra) se ejecutan aqui contra transactionService; las
// que necesitan input (editar, dividir, elegir gasto de reembolso, borrar con confirmacion)
// se delegan al padre. Aisla la complejidad de "movimientos especiales" en un solo sitio.
import { useEffect, useState } from 'react';
import type { Account, Merchant, Transaction } from '../../db/schema';
import { Modal } from '../common';
import { useToast } from '../../context/ToastContext';
import { transactionService } from '../../services/transactionService';
import { merchantService } from '../../services/merchantService';

interface RowActionsModalProps {
  open: boolean;
  onClose: () => void;
  profileId: string;
  tx: Transaction | null;
  accounts: Account[];
  merchants: Merchant[];
  merchantNames: Map<string, string>;
  onEdit: (tx: Transaction) => void;
  onSplit: (tx: Transaction) => void;
  onMarkRefund: (tx: Transaction) => void;
  onDelete: (tx: Transaction) => void;
  onChanged: () => void | Promise<void>;
}

const actionClass =
  'w-full rounded-lg px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-40';

export function RowActionsModal({
  open,
  onClose,
  profileId,
  tx,
  accounts,
  merchants,
  merchantNames,
  onEdit,
  onSplit,
  onMarkRefund,
  onDelete,
  onChanged,
}: RowActionsModalProps) {
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transferPicker, setTransferPicker] = useState(false);
  const [counterAccountId, setCounterAccountId] = useState('');
  const [merchantPicker, setMerchantPicker] = useState(false);
  const [pickedMerchantId, setPickedMerchantId] = useState('');

  useEffect(() => {
    if (!open) return;
    setBusy(false);
    setError(null);
    setTransferPicker(false);
    setCounterAccountId(accounts.find((a) => a.archivedAt === null && a.id !== tx?.accountId)?.id ?? '');
    setMerchantPicker(false);
    setPickedMerchantId(tx?.merchantId ?? '');
  }, [open, tx, accounts]);

  if (!tx) return null;

  const isTransfer = tx.transferGroupId !== null;
  const isSplitParent = tx.isSplitParent;
  const isSplitChild = tx.parentId !== null;
  const isRefund = tx.refundOfId !== null;
  const isSpecial = isTransfer || isSplitParent || isSplitChild;

  // Ejecuta una accion directa contra el servicio con manejo de error y recarga.
  async function run(action: () => Promise<unknown>, successMsg: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
      showToast(successMsg, 'success');
      await onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'La operación ha fallado.');
      setBusy(false);
    }
  }

  const activeCounterAccounts = accounts.filter(
    (a) => a.archivedAt === null && a.id !== tx.accountId,
  );

  return (
    <Modal open={open} onClose={onClose} title="Acciones del movimiento" dismissible={!busy}>
      <div className="space-y-1">
        <button type="button" className={actionClass} disabled={busy} onClick={() => onEdit(tx)}>
          {isSpecial ? 'Editar detalles' : 'Editar'}
        </button>

        {/* Split: solo movimientos normales (no transferencias ni ya divididos/hijos). */}
        {!isSpecial && (
          <button type="button" className={actionClass} disabled={busy} onClick={() => onSplit(tx)}>
            Dividir en partes (split)
          </button>
        )}
        {isSplitParent && (
          <button
            type="button"
            className={actionClass}
            disabled={busy}
            onClick={() => run(() => transactionService.unsplitTransaction(profileId, tx.id), 'Division deshecha.')}
          >
            Deshacer division
          </button>
        )}

        {/* Transferencia */}
        {!isSpecial && !transferPicker && (
          <button
            type="button"
            className={actionClass}
            disabled={busy || activeCounterAccounts.length === 0}
            onClick={() => setTransferPicker(true)}
          >
            Marcar como transferencia
          </button>
        )}
        {!isSpecial && transferPicker && (
          <div className="rounded-lg border border-slate-800 p-2">
            <p className="mb-1 text-xs text-slate-400">Cuenta espejo (destino del dinero):</p>
            <div className="flex gap-2">
              <select
                value={counterAccountId}
                onChange={(e) => setCounterAccountId(e.target.value)}
                className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-slate-100"
              >
                {activeCounterAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={busy || !counterAccountId}
                onClick={() =>
                  run(
                    () => transactionService.markAsTransfer(profileId, tx.id, counterAccountId),
                    'Marcado como transferencia.',
                  )
                }
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                Confirmar
              </button>
            </div>
          </div>
        )}
        {isTransfer && (
          <button
            type="button"
            className={actionClass}
            disabled={busy}
            onClick={() => run(() => transactionService.unmarkTransfer(profileId, tx.id), 'Transferencia deshecha.')}
          >
            Deshacer transferencia (borra la pata espejo)
          </button>
        )}

        {/* Reembolso */}
        {!isSpecial && !isRefund && (
          <button type="button" className={actionClass} disabled={busy} onClick={() => onMarkRefund(tx)}>
            Marcar como reembolso
          </button>
        )}
        {isRefund && (
          <button
            type="button"
            className={actionClass}
            disabled={busy}
            onClick={() => run(() => transactionService.unmarkRefund(profileId, tx.id), 'Reembolso desvinculado.')}
          >
            Quitar marca de reembolso
          </button>
        )}

        {/* Comercio: no aplica a transferencias ni a padres de split (sin comercio propio;
            la asociacion vive en las líneas hijas de un split). */}
        {!isSpecial && !merchantPicker && (
          <button type="button" className={actionClass} disabled={busy} onClick={() => setMerchantPicker(true)}>
            Comercio: {tx.merchantId ? (merchantNames.get(tx.merchantId) ?? '—') : 'Sin comercio'}
          </button>
        )}
        {!isSpecial && merchantPicker && (
          <div className="rounded-lg border border-slate-800 p-2">
            <p className="mb-1 text-xs text-slate-400">Reasignar a otro comercio (o quitar):</p>
            <div className="flex gap-2">
              <select
                value={pickedMerchantId}
                onChange={(e) => setPickedMerchantId(e.target.value)}
                className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-slate-100"
              >
                <option value="">Sin comercio</option>
                {merchants.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.canonicalName}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  run(
                    () => merchantService.setTransactionMerchant(profileId, tx.id, pickedMerchantId || null),
                    pickedMerchantId ? 'Comercio reasignado.' : 'Comercio desvinculado.',
                  )
                }
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                Confirmar
              </button>
            </div>
          </div>
        )}

        {/* Exclusion de estadisticas: no aplica a transferencias (siempre excluidas) ni a
            padres de split (excluidos por definicion). */}
        {!isTransfer && !isSplitParent && (
          <button
            type="button"
            className={actionClass}
            disabled={busy}
            onClick={() =>
              run(
                () => transactionService.setExcludedFromStats(profileId, tx.id, !tx.excludedFromStats),
                tx.excludedFromStats ? 'Incluido en estadisticas.' : 'Excluido de estadisticas.',
              )
            }
          >
            {tx.excludedFromStats ? 'Incluir en estadisticas' : 'Excluir de estadisticas'}
          </button>
        )}

        <button
          type="button"
          className="w-full rounded-lg px-3 py-2 text-left text-sm text-red-400 hover:bg-red-950/50 disabled:opacity-40"
          disabled={busy}
          onClick={() => onDelete(tx)}
        >
          Eliminar
        </button>

        {error && <p className="px-3 pt-1 text-sm text-red-400">{error}</p>}
      </div>
    </Modal>
  );
}
