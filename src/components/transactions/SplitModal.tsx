// Divide un movimiento en partes (split). Cada parte lleva su importe y categoria. La suma
// de las partes debe ser igual al importe del movimiento (se valida en el servicio y se
// muestra el restante en vivo). Delega en transactionService.splitTransaction.
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { Category, Transaction } from '../../db/schema';
import { Modal } from '../common';
import { useToast } from '../../context/ToastContext';
import { transactionService } from '../../services/transactionService';
import { eurosToCents, formatCents } from '../../lib/money';

interface PartForm {
  key: string;
  amountEuros: string; // magnitud en euros
  categoryId: string;
  subcategoryId: string;
}

interface SplitModalProps {
  open: boolean;
  onClose: () => void;
  profileId: string;
  tx: Transaction | null;
  categories: Category[];
  locale: string;
  currency: string;
  onSaved: () => void | Promise<void>;
}

const controlClass =
  'w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-sm text-slate-100 outline-none focus:border-slate-500';

function newPart(): PartForm {
  return { key: crypto.randomUUID(), amountEuros: '', categoryId: '', subcategoryId: '' };
}

export function SplitModal({
  open,
  onClose,
  profileId,
  tx,
  categories,
  locale,
  currency,
  onSaved,
}: SplitModalProps) {
  const { showToast } = useToast();
  const [parts, setParts] = useState<PartForm[]>([newPart(), newPart()]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Signo del padre: las partes heredan el signo (gasto negativo, ingreso positivo).
  const parentSign = tx && tx.amountCents < 0 ? -1 : 1;
  const parentAmount = tx?.amountCents ?? 0;

  const roots = useMemo(
    () => categories.filter((c) => c.parentId === null && c.archivedAt === null),
    [categories],
  );

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSaving(false);
    setParts([newPart(), newPart()]);
  }, [open, tx]);

  // Suma en centimos (con signo del padre) de lo repartido hasta ahora.
  const assignedCents = parts.reduce((acc, p) => {
    const n = Number(p.amountEuros);
    if (p.amountEuros.trim() === '' || !Number.isFinite(n)) return acc;
    return acc + parentSign * Math.abs(eurosToCents(n));
  }, 0);
  const remaining = parentAmount - assignedCents;

  function updatePart(key: string, patch: Partial<PartForm>) {
    setParts((cur) => cur.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  }
  function addPart() {
    setParts((cur) => [...cur, newPart()]);
  }
  function removePart(key: string) {
    setParts((cur) => (cur.length <= 2 ? cur : cur.filter((p) => p.key !== key)));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving || !tx) return;
    setError(null);
    setSaving(true);
    try {
      const serviceParts = parts.map((p) => {
        const n = Number(p.amountEuros);
        if (p.amountEuros.trim() === '' || !Number.isFinite(n)) {
          throw new Error('Todas las partes deben tener un importe valido.');
        }
        return {
          amountCents: parentSign * Math.abs(eurosToCents(n)),
          categoryId: p.categoryId || null,
          subcategoryId: p.categoryId && p.subcategoryId ? p.subcategoryId : null,
        };
      });
      await transactionService.splitTransaction(profileId, tx.id, serviceParts);
      showToast('Movimiento dividido.', 'success');
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo dividir el movimiento.');
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Dividir movimiento" dismissible={!saving}>
      {tx && (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="rounded-lg bg-slate-800 px-3 py-2 text-sm">
            <span className="text-slate-400">{tx.concept}</span>
            <span className="float-right font-medium text-slate-100">
              {formatCents(parentAmount, locale, currency)}
            </span>
          </div>

          <div className="space-y-2">
            {parts.map((p, i) => {
              const subs = categories.filter(
                (c) => c.parentId === p.categoryId && c.archivedAt === null,
              );
              return (
                <div key={p.key} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder={`Parte ${i + 1} (EUR)`}
                    value={p.amountEuros}
                    onChange={(e) => updatePart(p.key, { amountEuros: e.target.value })}
                    className={controlClass}
                  />
                  <div className="flex gap-1">
                    <select
                      value={p.categoryId}
                      onChange={(e) =>
                        updatePart(p.key, { categoryId: e.target.value, subcategoryId: '' })
                      }
                      className={controlClass}
                    >
                      <option value="">Sin categoría</option>
                      {roots.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    {subs.length > 0 && (
                      <select
                        value={p.subcategoryId}
                        onChange={(e) => updatePart(p.key, { subcategoryId: e.target.value })}
                        className={controlClass}
                      >
                        <option value="">Sub</option>
                        {subs.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => removePart(p.key)}
                    disabled={parts.length <= 2}
                    className="rounded px-2 py-1 text-slate-400 hover:bg-slate-700 disabled:opacity-30"
                    aria-label="Quitar parte"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between text-sm">
            <button
              type="button"
              onClick={addPart}
              className="rounded-lg border border-slate-700 px-2.5 py-1 text-slate-300 hover:bg-slate-800"
            >
              + Añadir parte
            </button>
            <span className={remaining === 0 ? 'text-emerald-400' : 'text-amber-400'}>
              Restante: {formatCents(remaining, locale, currency)}
            </span>
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
              disabled={saving || remaining !== 0}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {saving ? 'Dividiendo...' : 'Dividir'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
