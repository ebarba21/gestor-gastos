// Formulario de crear/editar cuenta o fuente de dinero. El saldo inicial se introduce en
// euros y se convierte a centimos enteros (nunca se persiste como float). Delega en
// accountService.
import { useEffect, useState, type FormEvent } from 'react';
import type { Account, AccountKind } from '../../db/schema';
import { Modal, ColorPicker } from '../common';
import { ACCENT_COLORS } from '../../lib/colors';
import {
  accountService,
  ACCOUNT_KINDS,
  ACCOUNT_KIND_LABELS,
  MAX_ACCOUNT_NAME_LENGTH,
} from '../../services/accountService';
import { centsToEuros, eurosToCents } from '../../lib/money';
import { useToast } from '../../context/ToastContext';

interface AccountFormModalProps {
  open: boolean;
  onClose: () => void;
  profileId: string;
  onSaved: () => void | Promise<void>;
  account?: Account | null;
}

export function AccountFormModal({
  open,
  onClose,
  profileId,
  onSaved,
  account,
}: AccountFormModalProps) {
  const { showToast } = useToast();
  const isEdit = Boolean(account);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<AccountKind>('bank');
  const [balance, setBalance] = useState('0');
  const [color, setColor] = useState<string>(ACCENT_COLORS[0]!);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSaving(false);
    if (account) {
      setName(account.name);
      setKind(account.kind);
      setBalance(String(centsToEuros(account.openingBalanceCents)));
      setColor(account.color ?? ACCENT_COLORS[0]!);
    } else {
      setName('');
      setKind('bank');
      setBalance('0');
      setColor(ACCENT_COLORS[0]!);
    }
  }, [open, account]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    setError(null);
    setSaving(true);
    try {
      const euros = balance.trim() === '' ? 0 : Number(balance.replace(',', '.'));
      if (!Number.isFinite(euros)) {
        throw new Error('El saldo inicial debe ser un número valido.');
      }
      const openingBalanceCents = eurosToCents(euros);
      if (account) {
        await accountService.updateAccount(profileId, account.id, {
          name,
          kind,
          color,
          openingBalanceCents,
        });
      } else {
        await accountService.createAccount(profileId, { name, kind, openingBalanceCents, color });
      }
      showToast(isEdit ? 'Cuenta actualizada.' : 'Cuenta creada.', 'success');
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la cuenta.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Editar cuenta' : 'Nueva cuenta'}
      dismissible={!saving}
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label htmlFor="account-name" className="block text-sm font-medium text-slate-300">
            Nombre
          </label>
          <input
            id="account-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={MAX_ACCOUNT_NAME_LENGTH}
            autoFocus
            placeholder="Banco principal, Tarjeta, Efectivo..."
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-slate-500"
          />
        </div>

        <div>
          <label htmlFor="account-kind" className="block text-sm font-medium text-slate-300">
            Tipo
          </label>
          <select
            id="account-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as AccountKind)}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-slate-500"
          >
            {ACCOUNT_KINDS.map((k) => (
              <option key={k} value={k}>
                {ACCOUNT_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="account-balance" className="block text-sm font-medium text-slate-300">
            Saldo inicial (EUR)
          </label>
          <input
            id="account-balance"
            type="text"
            inputMode="decimal"
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-slate-500"
          />
          <p className="mt-1 text-xs text-slate-500">
            Puede ser negativo (por ejemplo, una tarjeta con deuda).
          </p>
        </div>

        <ColorPicker value={color} onChange={setColor} />

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
            {saving ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
