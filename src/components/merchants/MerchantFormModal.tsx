// Formulario de crear/editar un comercio: nombre canonico y defaults (categoria, subcategoria,
// etiquetas) que se sugieren al asociar un movimiento a este comercio. Toda la logica vive en
// merchantService; aqui solo orquestacion de UI.
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { Category, Merchant, Tag } from '../../db/schema';
import { Modal } from '../common';
import { useToast } from '../../context/ToastContext';
import { merchantService } from '../../services/merchantService';

const inputClass =
  'mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-slate-500';

interface MerchantFormModalProps {
  open: boolean;
  onClose: () => void;
  profileId: string;
  categories: Category[];
  tags: Tag[];
  onSaved: () => void | Promise<void>;
  merchant?: Merchant | null;
}

export function MerchantFormModal({
  open,
  onClose,
  profileId,
  categories,
  tags,
  onSaved,
  merchant,
}: MerchantFormModalProps) {
  const { showToast } = useToast();
  const isEdit = Boolean(merchant);

  const [canonicalName, setCanonicalName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [subcategoryId, setSubcategoryId] = useState('');
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const rootCategories = useMemo(
    () =>
      categories
        .filter((c) => c.parentId === null)
        .filter((c) => c.archivedAt === null || c.id === categoryId)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    [categories, categoryId],
  );
  const subCategories = useMemo(
    () =>
      categories
        .filter((c) => c.parentId === categoryId)
        .filter((c) => c.archivedAt === null || c.id === subcategoryId)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    [categories, categoryId, subcategoryId],
  );

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSaving(false);
    if (merchant) {
      setCanonicalName(merchant.canonicalName);
      setCategoryId(merchant.defaultCategoryId ?? '');
      setSubcategoryId(merchant.defaultSubcategoryId ?? '');
      setTagIds(merchant.defaultTagIds);
      setNotes(merchant.notes ?? '');
    } else {
      setCanonicalName('');
      setCategoryId('');
      setSubcategoryId('');
      setTagIds([]);
      setNotes('');
    }
  }, [open, merchant]);

  function toggleTag(id: string) {
    setTagIds((cur) => (cur.includes(id) ? cur.filter((t) => t !== id) : [...cur, id]));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    setError(null);
    setSaving(true);
    try {
      const input = {
        canonicalName,
        defaultCategoryId: categoryId || null,
        defaultSubcategoryId: categoryId && subcategoryId ? subcategoryId : null,
        defaultTagIds: tagIds,
        notes: notes.trim().length > 0 ? notes.trim() : null,
      };
      if (merchant) await merchantService.update(profileId, merchant.id, input);
      else await merchantService.create(profileId, input);
      showToast(isEdit ? 'Comercio actualizado.' : 'Comercio creado.', 'success');
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el comercio.');
    } finally {
      setSaving(false);
    }
  }

  const title = isEdit ? 'Editar comercio' : 'Nuevo comercio';

  return (
    <Modal open={open} onClose={onClose} title={title} dismissible={!saving}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="merchant-name" className="block text-sm font-medium text-slate-300">
            Nombre
          </label>
          <input
            id="merchant-name"
            type="text"
            value={canonicalName}
            onChange={(e) => setCanonicalName(e.target.value)}
            autoFocus
            className={inputClass}
            placeholder="Amazon"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-300">Categoría por defecto</label>
            <select
              value={categoryId}
              onChange={(e) => {
                setCategoryId(e.target.value);
                setSubcategoryId('');
              }}
              className={inputClass}
            >
              <option value="">Sin categoría</option>
              {rootCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300">Subcategoría</label>
            <select
              value={subcategoryId}
              onChange={(e) => setSubcategoryId(e.target.value)}
              disabled={categoryId === ''}
              className={inputClass}
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

        {tags.length > 0 && (
          <div>
            <span className="block text-sm font-medium text-slate-300">Etiquetas por defecto</span>
            <div className="mt-1 flex flex-wrap gap-2">
              {tags.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => toggleTag(t.id)}
                  className={[
                    'rounded-full border px-2.5 py-1 text-xs',
                    tagIds.includes(t.id)
                      ? 'border-indigo-500 bg-indigo-600/20 text-indigo-200'
                      : 'border-slate-700 text-slate-400 hover:bg-slate-800',
                  ].join(' ')}
                >
                  {t.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <label htmlFor="merchant-notes" className="block text-sm font-medium text-slate-300">
            Notas
          </label>
          <textarea
            id="merchant-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className={inputClass}
          />
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving || canonicalName.trim().length === 0}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {saving ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
