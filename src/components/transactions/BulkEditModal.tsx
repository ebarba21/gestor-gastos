// Edicion masiva de movimientos. Cada campo se aplica solo si su casilla esta activada,
// para poder cambiar (por ejemplo) solo la categoria sin tocar el resto. Confirma con el
// recuento de movimientos afectados. Delega en transactionService.bulkEdit.
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { Account, Category, Tag, TransactionStatus } from '../../db/schema';
import { Modal } from '../common';
import { useToast } from '../../context/ToastContext';
import { transactionService, type BulkEdit } from '../../services/transactionService';

interface BulkEditModalProps {
  open: boolean;
  onClose: () => void;
  profileId: string;
  ids: string[];
  accounts: Account[];
  categories: Category[];
  tags: Tag[];
  onSaved: () => void | Promise<void>;
}

const controlClass =
  'mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-slate-500';

const STATUS_LABELS: Record<TransactionStatus, string> = {
  cleared: 'Confirmado',
  pending: 'Pendiente',
  reconciled: 'Conciliado',
};

export function BulkEditModal({
  open,
  onClose,
  profileId,
  ids,
  accounts,
  categories,
  tags,
  onSaved,
}: BulkEditModalProps) {
  const { showToast } = useToast();

  const [doAccount, setDoAccount] = useState(false);
  const [accountId, setAccountId] = useState('');
  const [doCategory, setDoCategory] = useState(false);
  const [categoryId, setCategoryId] = useState('');
  const [subcategoryId, setSubcategoryId] = useState('');
  const [doStatus, setDoStatus] = useState(false);
  const [status, setStatus] = useState<TransactionStatus>('cleared');
  const [doExcluded, setDoExcluded] = useState(false);
  const [excluded, setExcluded] = useState(false);
  const [doTags, setDoTags] = useState(false);
  const [tagMode, setTagMode] = useState<'add' | 'remove' | 'replace'>('add');
  const [tagIds, setTagIds] = useState<string[]>([]);

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const roots = useMemo(
    () => categories.filter((c) => c.parentId === null && c.archivedAt === null),
    [categories],
  );
  const subs = useMemo(
    () => categories.filter((c) => c.parentId === categoryId && c.archivedAt === null),
    [categories, categoryId],
  );
  const activeAccounts = useMemo(() => accounts.filter((a) => a.archivedAt === null), [accounts]);

  useEffect(() => {
    if (!open) return;
    setDoAccount(false);
    setAccountId(activeAccounts[0]?.id ?? '');
    setDoCategory(false);
    setCategoryId('');
    setSubcategoryId('');
    setDoStatus(false);
    setStatus('cleared');
    setDoExcluded(false);
    setExcluded(false);
    setDoTags(false);
    setTagMode('add');
    setTagIds([]);
    setError(null);
    setSaving(false);
  }, [open, activeAccounts]);

  function toggleTag(id: string) {
    setTagIds((cur) => (cur.includes(id) ? cur.filter((t) => t !== id) : [...cur, id]));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    setError(null);

    const edit: BulkEdit = {};
    if (doAccount) {
      if (!accountId) {
        setError('Selecciona una cuenta.');
        return;
      }
      edit.setAccountId = accountId;
    }
    if (doCategory) {
      edit.setCategory = {
        categoryId: categoryId || null,
        subcategoryId: categoryId && subcategoryId ? subcategoryId : null,
      };
    }
    if (doStatus) edit.setStatus = status;
    if (doExcluded) edit.setExcludedFromStats = excluded;
    if (doTags) {
      if (tagMode !== 'replace' && tagIds.length === 0) {
        setError('Selecciona al menos una etiqueta para anadir o quitar.');
        return;
      }
      edit.tags = { mode: tagMode, tagIds };
    }

    setSaving(true);
    try {
      const n = await transactionService.bulkEdit(profileId, ids, edit);
      showToast(`${n} movimiento(s) actualizados.`, 'success');
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo aplicar la edicion masiva.');
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Editar ${ids.length} movimiento(s)`} dismissible={!saving}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-xs text-slate-400">
          Marca los campos que quieras cambiar. Los no marcados se dejan intactos.
        </p>

        {/* Cuenta */}
        <Row checked={doAccount} onCheck={setDoAccount} label="Cuenta">
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            disabled={!doAccount}
            className={`${controlClass} disabled:opacity-50`}
          >
            {activeAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Row>

        {/* Categoria */}
        <Row checked={doCategory} onCheck={setDoCategory} label="Categoria">
          <div className="grid grid-cols-2 gap-2">
            <select
              value={categoryId}
              onChange={(e) => {
                setCategoryId(e.target.value);
                setSubcategoryId('');
              }}
              disabled={!doCategory}
              className={`${controlClass} disabled:opacity-50`}
            >
              <option value="">Sin categoria</option>
              {roots.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              value={subcategoryId}
              onChange={(e) => setSubcategoryId(e.target.value)}
              disabled={!doCategory || !categoryId || subs.length === 0}
              className={`${controlClass} disabled:opacity-50`}
            >
              <option value="">Sin subcategoria</option>
              {subs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </Row>

        {/* Estado */}
        <Row checked={doStatus} onCheck={setDoStatus} label="Estado">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as TransactionStatus)}
            disabled={!doStatus}
            className={`${controlClass} disabled:opacity-50`}
          >
            {(['cleared', 'pending', 'reconciled'] as const).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </Row>

        {/* Exclusion */}
        <Row checked={doExcluded} onCheck={setDoExcluded} label="Exclusion de estadisticas">
          <select
            value={excluded ? 'yes' : 'no'}
            onChange={(e) => setExcluded(e.target.value === 'yes')}
            disabled={!doExcluded}
            className={`${controlClass} disabled:opacity-50`}
          >
            <option value="no">Incluir en estadisticas</option>
            <option value="yes">Excluir de estadisticas</option>
          </select>
        </Row>

        {/* Etiquetas */}
        {tags.length > 0 && (
          <Row checked={doTags} onCheck={setDoTags} label="Etiquetas">
            <div className={doTags ? '' : 'opacity-50'}>
              <div className="mb-2 flex gap-1.5">
                {(['add', 'remove', 'replace'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    disabled={!doTags}
                    onClick={() => setTagMode(m)}
                    aria-pressed={tagMode === m}
                    className={[
                      'rounded-lg border px-2.5 py-1 text-xs',
                      tagMode === m
                        ? 'border-indigo-500 bg-indigo-600/20 text-indigo-200'
                        : 'border-slate-700 text-slate-300',
                    ].join(' ')}
                  >
                    {m === 'add' ? 'Anadir' : m === 'remove' ? 'Quitar' : 'Reemplazar'}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {tags.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    disabled={!doTags}
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
              {tagMode === 'replace' && (
                <p className="mt-1 text-xs text-slate-500">
                  Reemplazar con ninguna etiqueta quita todas las etiquetas de los movimientos.
                </p>
              )}
            </div>
          </Row>
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
            {saving ? 'Aplicando...' : `Aplicar a ${ids.length}`}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Row({
  checked,
  onCheck,
  label,
  children,
}: {
  checked: boolean;
  onCheck: (v: boolean) => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-800 p-3">
      <label className="flex items-center gap-2 text-sm font-medium text-slate-300">
        <input type="checkbox" checked={checked} onChange={(e) => onCheck(e.target.checked)} className="h-4 w-4" />
        {label}
      </label>
      <div className="mt-2">{children}</div>
    </div>
  );
}
