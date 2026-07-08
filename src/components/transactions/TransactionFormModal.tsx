// Formulario de crear/editar un movimiento. Delega en transactionService.
//  - Crear y editar movimientos normales (gasto/ingreso): edicion completa.
//  - Editar movimientos especiales (transferencia, padre o linea de split): edicion
//    "segura" (fecha, concepto, notas, estado, etiquetas) para no romper sus invariantes;
//    el importe/tipo/cuenta se muestran de solo lectura y se gestionan desde sus acciones.
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { Account, Category, Tag, Transaction, TransactionStatus, TransactionType } from '../../db/schema';
import { Modal } from '../common';
import { useToast } from '../../context/ToastContext';
import {
  transactionService,
  signedAmountFor,
  MAX_CONCEPT_LENGTH,
  MAX_NOTES_LENGTH,
} from '../../services/transactionService';
import { ruleService } from '../../services/ruleService';
import { eurosToCents } from '../../lib/money';

const TYPE_LABELS: Record<'expense' | 'income', string> = {
  expense: 'Gasto',
  income: 'Ingreso',
};
const STATUS_LABELS: Record<TransactionStatus, string> = {
  cleared: 'Confirmado',
  pending: 'Pendiente',
  reconciled: 'Conciliado',
};
const STATUSES: readonly TransactionStatus[] = ['cleared', 'pending', 'reconciled'];

function isSpecial(tx: Transaction): boolean {
  return tx.type === 'transfer' || tx.isSplitParent || tx.parentId !== null;
}

interface TransactionFormModalProps {
  open: boolean;
  onClose: () => void;
  profileId: string;
  accounts: Account[];
  categories: Category[];
  tags: Tag[];
  onSaved: () => void | Promise<void>;
  // Editar un movimiento existente; null/undefined para crear.
  tx?: Transaction | null;
}

const inputClass =
  'mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-slate-500';

export function TransactionFormModal({
  open,
  onClose,
  profileId,
  accounts,
  categories,
  tags,
  onSaved,
  tx,
}: TransactionFormModalProps) {
  const { showToast } = useToast();
  const isEdit = Boolean(tx);
  const special = tx ? isSpecial(tx) : false;
  // En modo especial solo se editan campos no financieros.
  const limited = isEdit && special;

  const [date, setDate] = useState('');
  const [type, setType] = useState<TransactionType>('expense');
  const [amountEuros, setAmountEuros] = useState('');
  const [concept, setConcept] = useState('');
  const [notes, setNotes] = useState('');
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [subcategoryId, setSubcategoryId] = useState('');
  const [status, setStatus] = useState<TransactionStatus>('cleared');
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [excluded, setExcluded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Categorias raiz aplicables al tipo (o todas si el tipo es transfer). Se incluye la
  // categoria actual aunque este archivada para no perderla al editar.
  const rootCategories = useMemo(() => {
    const wantedKind = type === 'income' ? 'income' : 'expense';
    return categories
      .filter((c) => c.parentId === null)
      .filter((c) => c.archivedAt === null || c.id === categoryId)
      .filter((c) => c.kind === 'both' || c.kind === wantedKind || c.id === categoryId)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }, [categories, type, categoryId]);

  const subCategories = useMemo(
    () =>
      categories
        .filter((c) => c.parentId === categoryId)
        .filter((c) => c.archivedAt === null || c.id === subcategoryId)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    [categories, categoryId, subcategoryId],
  );

  const activeAccounts = useMemo(
    () => accounts.filter((a) => a.archivedAt === null || a.id === accountId),
    [accounts, accountId],
  );

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSaving(false);
    if (tx) {
      setDate(tx.date);
      setType(tx.type === 'income' ? 'income' : 'expense');
      setAmountEuros((Math.abs(tx.amountCents) / 100).toFixed(2));
      setConcept(tx.concept);
      setNotes(tx.notes ?? '');
      setAccountId(tx.accountId);
      setCategoryId(tx.categoryId ?? '');
      setSubcategoryId(tx.subcategoryId ?? '');
      setStatus(tx.status);
      setTagIds(tx.tagIds);
      setExcluded(tx.excludedFromStats);
    } else {
      const today = new Date().toISOString().slice(0, 10);
      setDate(today);
      setType('expense');
      setAmountEuros('');
      setConcept('');
      setNotes('');
      setAccountId(accounts.find((a) => a.archivedAt === null)?.id ?? '');
      setCategoryId('');
      setSubcategoryId('');
      setStatus('cleared');
      setTagIds([]);
      setExcluded(false);
    }
  }, [open, tx, accounts]);

  function toggleTag(id: string) {
    setTagIds((cur) => (cur.includes(id) ? cur.filter((t) => t !== id) : [...cur, id]));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    setError(null);
    setSaving(true);
    try {
      if (limited && tx) {
        await transactionService.updateDetails(profileId, tx.id, {
          date,
          concept,
          notes,
          status,
          tagIds,
        });
      } else {
        const amountNumber = Number(amountEuros);
        if (amountEuros.trim() === '' || !Number.isFinite(amountNumber)) {
          throw new Error('Introduce un importe valido.');
        }
        const magnitude = eurosToCents(amountNumber);
        if (magnitude <= 0) throw new Error('El importe debe ser mayor que cero.');
        if (!accountId) throw new Error('Selecciona una cuenta.');
        const payload = {
          date,
          amountCents: signedAmountFor(type, magnitude),
          type,
          concept,
          notes,
          accountId,
          categoryId: categoryId || null,
          subcategoryId: categoryId && subcategoryId ? subcategoryId : null,
          tagIds,
          status,
          excludedFromStats: excluded,
        };
        if (tx) {
          await transactionService.update(profileId, tx.id, payload);
        } else {
          const created = await transactionService.create(profileId, payload);
          // Autocategorizacion por reglas al crear a mano: solo actua si el movimiento no se
          // categorizo manualmente (sin categoria elegida en el alta). Si ninguna regla casa,
          // no cambia nada. La categorizacion manual del usuario siempre prevalece.
          await ruleService.applyToTransaction(profileId, created.id);
        }
      }
      showToast(isEdit ? 'Movimiento actualizado.' : 'Movimiento creado.', 'success');
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el movimiento.');
    } finally {
      setSaving(false);
    }
  }

  const title = isEdit ? (limited ? 'Editar detalles del movimiento' : 'Editar movimiento') : 'Nuevo movimiento';

  return (
    <Modal open={open} onClose={onClose} title={title} dismissible={!saving}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {limited && (
          <p className="rounded-lg bg-slate-800 px-3 py-2 text-xs text-slate-400">
            Este es un movimiento especial (transferencia o split). Aqui solo puedes editar
            fecha, concepto, notas, estado y etiquetas. El importe y la cuenta se gestionan
            desde sus acciones.
          </p>
        )}

        {!limited && (
          <div>
            <span className="block text-sm font-medium text-slate-300">Tipo</span>
            <div className="mt-2 flex gap-2">
              {(['expense', 'income'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    setType(k);
                    setCategoryId('');
                    setSubcategoryId('');
                  }}
                  aria-pressed={type === k}
                  className={[
                    'rounded-lg border px-3 py-1.5 text-sm',
                    type === k
                      ? 'border-indigo-500 bg-indigo-600/20 text-indigo-200'
                      : 'border-slate-700 text-slate-300',
                  ].join(' ')}
                >
                  {TYPE_LABELS[k]}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="tx-date" className="block text-sm font-medium text-slate-300">
              Fecha
            </label>
            <input
              id="tx-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="tx-amount" className="block text-sm font-medium text-slate-300">
              Importe (EUR)
            </label>
            <input
              id="tx-amount"
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              value={amountEuros}
              onChange={(e) => setAmountEuros(e.target.value)}
              disabled={limited}
              className={`${inputClass} disabled:opacity-50`}
            />
          </div>
        </div>

        <div>
          <label htmlFor="tx-concept" className="block text-sm font-medium text-slate-300">
            Concepto
          </label>
          <input
            id="tx-concept"
            type="text"
            value={concept}
            onChange={(e) => setConcept(e.target.value)}
            maxLength={MAX_CONCEPT_LENGTH}
            autoFocus
            className={inputClass}
          />
        </div>

        {!limited && (
          <>
            <div>
              <label htmlFor="tx-account" className="block text-sm font-medium text-slate-300">
                Cuenta
              </label>
              <select
                id="tx-account"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className={inputClass}
              >
                <option value="">Selecciona una cuenta</option>
                {activeAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                    {a.archivedAt !== null ? ' (archivada)' : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="tx-category" className="block text-sm font-medium text-slate-300">
                  Categoria
                </label>
                <select
                  id="tx-category"
                  value={categoryId}
                  onChange={(e) => {
                    setCategoryId(e.target.value);
                    setSubcategoryId('');
                  }}
                  className={inputClass}
                >
                  <option value="">Sin categoria</option>
                  {rootCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="tx-subcategory" className="block text-sm font-medium text-slate-300">
                  Subcategoria
                </label>
                <select
                  id="tx-subcategory"
                  value={subcategoryId}
                  onChange={(e) => setSubcategoryId(e.target.value)}
                  disabled={!categoryId || subCategories.length === 0}
                  className={`${inputClass} disabled:opacity-50`}
                >
                  <option value="">Ninguna</option>
                  {subCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </>
        )}

        <div>
          <span className="block text-sm font-medium text-slate-300">Estado</span>
          <div className="mt-2 flex flex-wrap gap-2">
            {STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                aria-pressed={status === s}
                className={[
                  'rounded-lg border px-3 py-1.5 text-sm',
                  status === s
                    ? 'border-indigo-500 bg-indigo-600/20 text-indigo-200'
                    : 'border-slate-700 text-slate-300',
                ].join(' ')}
              >
                {STATUS_LABELS[s]}
              </button>
            ))}
          </div>
        </div>

        {tags.length > 0 && (
          <div>
            <span className="block text-sm font-medium text-slate-300">Etiquetas</span>
            <div className="mt-2 flex flex-wrap gap-2">
              {tags.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => toggleTag(t.id)}
                  aria-pressed={tagIds.includes(t.id)}
                  className={[
                    'rounded-full border px-2.5 py-1 text-xs',
                    tagIds.includes(t.id)
                      ? 'border-indigo-500 bg-indigo-600/20 text-indigo-200'
                      : 'border-slate-700 text-slate-300',
                  ].join(' ')}
                >
                  {t.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <label htmlFor="tx-notes" className="block text-sm font-medium text-slate-300">
            Notas
          </label>
          <textarea
            id="tx-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={MAX_NOTES_LENGTH}
            rows={2}
            className={inputClass}
          />
        </div>

        {!limited && (
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={excluded}
              onChange={(e) => setExcluded(e.target.checked)}
              className="h-4 w-4"
            />
            Excluir de las estadisticas
          </label>
        )}

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
