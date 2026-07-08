// Marca un movimiento como reembolso de un gasto anterior (enlace simple refundOfId).
// El usuario elige el gasto original entre los gastos del perfil. Delega en
// transactionService.markAsRefund.
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { Transaction } from '../../db/schema';
import { Modal } from '../common';
import { useToast } from '../../context/ToastContext';
import { transactionService } from '../../services/transactionService';
import { formatCents } from '../../lib/money';
import { normalizeConcept } from '../../lib/dedupe';

interface RefundModalProps {
  open: boolean;
  onClose: () => void;
  profileId: string;
  tx: Transaction | null;
  transactions: Transaction[];
  locale: string;
  currency: string;
  onSaved: () => void | Promise<void>;
}

export function RefundModal({
  open,
  onClose,
  profileId,
  tx,
  transactions,
  locale,
  currency,
  onSaved,
}: RefundModalProps) {
  const { showToast } = useToast();
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSearch('');
    setSelectedId(tx?.refundOfId ?? '');
    setError(null);
    setSaving(false);
  }, [open, tx]);

  // Candidatos: gastos del perfil distintos del propio movimiento.
  const candidates = useMemo(() => {
    const q = normalizeConcept(search);
    return transactions
      .filter((t) => t.type === 'expense' && t.id !== tx?.id)
      .filter((t) => (q ? normalizeConcept(t.concept).includes(q) : true))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 50);
  }, [transactions, search, tx]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving || !tx) return;
    if (!selectedId) {
      setError('Selecciona el gasto original.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await transactionService.markAsRefund(profileId, tx.id, selectedId);
      showToast('Movimiento marcado como reembolso.', 'success');
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo marcar el reembolso.');
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Marcar como reembolso" dismissible={!saving}>
      {tx && (
        <form onSubmit={handleSubmit} className="space-y-4">
          {tx.type !== 'income' && (
            <p className="rounded-lg bg-amber-900/30 px-3 py-2 text-xs text-amber-300">
              Normalmente un reembolso es un ingreso. Este movimiento es de tipo {tx.type}.
            </p>
          )}
          <p className="text-sm text-slate-400">
            Enlaza <span className="text-slate-100">{tx.concept}</span> con el gasto que reembolsa.
          </p>

          <input
            type="search"
            placeholder="Buscar gasto por concepto"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-slate-500"
          />

          <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-slate-800 p-1">
            {candidates.length === 0 ? (
              <p className="px-2 py-3 text-sm text-slate-500">No hay gastos que coincidan.</p>
            ) : (
              candidates.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedId(c.id)}
                  className={[
                    'flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm',
                    selectedId === c.id ? 'bg-indigo-600/25 text-indigo-100' : 'hover:bg-slate-800',
                  ].join(' ')}
                >
                  <span className="min-w-0 flex-1 truncate">
                    <span className="text-slate-400">{c.date}</span> · {c.concept}
                  </span>
                  <span className="ml-2 shrink-0 text-red-400">
                    {formatCents(c.amountCents, locale, currency)}
                  </span>
                </button>
              ))
            )}
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-lg px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving || !selectedId}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {saving ? 'Guardando...' : 'Marcar reembolso'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
