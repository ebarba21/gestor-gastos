// Crea una transferencia interna entre dos cuentas propias (par enlazado, excluido de
// estadisticas). Delega en transactionService.createTransfer.
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { Account } from '../../db/schema';
import { Modal } from '../common';
import { useToast } from '../../context/ToastContext';
import { transactionService } from '../../services/transactionService';
import { eurosToCents } from '../../lib/money';

interface TransferModalProps {
  open: boolean;
  onClose: () => void;
  profileId: string;
  accounts: Account[];
  onSaved: () => void | Promise<void>;
}

const controlClass =
  'mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-slate-500';

export function TransferModal({ open, onClose, profileId, accounts, onSaved }: TransferModalProps) {
  const { showToast } = useToast();
  const activeAccounts = useMemo(() => accounts.filter((a) => a.archivedAt === null), [accounts]);

  const [fromAccountId, setFromAccountId] = useState('');
  const [toAccountId, setToAccountId] = useState('');
  const [amountEuros, setAmountEuros] = useState('');
  const [date, setDate] = useState('');
  const [concept, setConcept] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSaving(false);
    setFromAccountId(activeAccounts[0]?.id ?? '');
    setToAccountId(activeAccounts[1]?.id ?? '');
    setAmountEuros('');
    setDate(new Date().toISOString().slice(0, 10));
    setConcept('');
  }, [open, activeAccounts]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    setError(null);
    setSaving(true);
    try {
      const n = Number(amountEuros);
      if (amountEuros.trim() === '' || !Number.isFinite(n) || n <= 0) {
        throw new Error('Introduce un importe mayor que cero.');
      }
      await transactionService.createTransfer(profileId, {
        fromAccountId,
        toAccountId,
        amountCents: eurosToCents(n),
        date,
        concept: concept.trim() || undefined,
      });
      showToast('Transferencia creada.', 'success');
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear la transferencia.');
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Nueva transferencia interna" dismissible={!saving}>
      {activeAccounts.length < 2 ? (
        <div className="space-y-4">
          <p className="text-sm text-slate-300">
            Necesitas al menos dos cuentas activas para registrar una transferencia interna.
          </p>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800"
            >
              Cerrar
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm font-medium text-slate-300">
              Cuenta origen
              <select
                value={fromAccountId}
                onChange={(e) => setFromAccountId(e.target.value)}
                className={controlClass}
              >
                {activeAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium text-slate-300">
              Cuenta destino
              <select
                value={toAccountId}
                onChange={(e) => setToAccountId(e.target.value)}
                className={controlClass}
              >
                {activeAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm font-medium text-slate-300">
              Importe (EUR)
              <input
                type="number"
                step="0.01"
                min="0"
                value={amountEuros}
                onChange={(e) => setAmountEuros(e.target.value)}
                className={controlClass}
              />
            </label>
            <label className="text-sm font-medium text-slate-300">
              Fecha
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={controlClass}
              />
            </label>
          </div>

          <label className="text-sm font-medium text-slate-300">
            Concepto (opcional)
            <input
              type="text"
              value={concept}
              onChange={(e) => setConcept(e.target.value)}
              placeholder="Transferencia interna"
              className={controlClass}
            />
          </label>

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
              disabled={saving}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {saving ? 'Creando...' : 'Crear transferencia'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
