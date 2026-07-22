// Formulario de crear/editar categoria o subcategoria. Una subcategoria hereda el tipo
// (kind) de su categoria raiz. Delega en categoryService via los handlers.
import { useEffect, useState, type FormEvent } from 'react';
import type { Category, CategoryKind } from '../../db/schema';
import { Modal, ColorPicker, IconPicker } from '../common';
import { ACCENT_COLORS } from '../../lib/colors';
import {
  categoryService,
  MAX_CATEGORY_NAME_LENGTH,
} from '../../services/categoryService';
import { useToast } from '../../context/ToastContext';

const KIND_LABELS: Record<CategoryKind, string> = {
  expense: 'Gasto',
  income: 'Ingreso',
  both: 'Ambos',
};
const KINDS: readonly CategoryKind[] = ['expense', 'income', 'both'];

interface CategoryFormModalProps {
  open: boolean;
  onClose: () => void;
  profileId: string;
  onSaved: () => void | Promise<void>;
  // Editar una categoria existente.
  category?: Category | null;
  // Crear una subcategoria bajo esta raiz (hereda su kind).
  parent?: Category | null;
}

export function CategoryFormModal({
  open,
  onClose,
  profileId,
  onSaved,
  category,
  parent,
}: CategoryFormModalProps) {
  const { showToast } = useToast();
  const isEdit = Boolean(category);
  const isRoot = category ? category.parentId === null : !parent;

  const [name, setName] = useState('');
  const [kind, setKind] = useState<CategoryKind>('expense');
  const [color, setColor] = useState<string>(ACCENT_COLORS[0]!);
  const [icon, setIcon] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSaving(false);
    if (category) {
      setName(category.name);
      setKind(category.kind);
      setColor(category.color ?? ACCENT_COLORS[0]!);
      setIcon(category.icon);
    } else {
      setName('');
      setKind(parent ? parent.kind : 'expense');
      setColor(ACCENT_COLORS[0]!);
      setIcon(null);
    }
  }, [open, category, parent]);

  const title = isEdit
    ? isRoot
      ? 'Editar categoría'
      : 'Editar subcategoría'
    : parent
      ? `Nueva subcategoría de ${parent.name}`
      : 'Nueva categoría';

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    setError(null);
    setSaving(true);
    try {
      if (category) {
        await categoryService.updateCategory(profileId, category.id, {
          name,
          color,
          icon,
          ...(isRoot ? { kind } : {}),
        });
      } else if (parent) {
        await categoryService.createCategory(profileId, {
          name,
          kind: parent.kind,
          color,
          icon,
          parentId: parent.id,
        });
      } else {
        await categoryService.createCategory(profileId, { name, kind, color, icon });
      }
      showToast(isEdit ? 'Categoría actualizada.' : 'Categoría creada.', 'success');
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la categoría.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={title} dismissible={!saving}>
      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label htmlFor="category-name" className="block text-sm font-medium text-slate-300">
            Nombre
          </label>
          <input
            id="category-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={MAX_CATEGORY_NAME_LENGTH}
            autoFocus
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-slate-500"
          />
        </div>

        {isRoot && (
          <div>
            <span className="block text-sm font-medium text-slate-300">Tipo</span>
            <div className="mt-2 flex gap-2">
              {KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  aria-pressed={kind === k}
                  className={[
                    'rounded-lg border px-3 py-1.5 text-sm',
                    kind === k
                      ? 'border-indigo-500 bg-indigo-600/20 text-indigo-200'
                      : 'border-slate-700 text-slate-300',
                  ].join(' ')}
                >
                  {KIND_LABELS[k]}
                </button>
              ))}
            </div>
          </div>
        )}

        <ColorPicker value={color} onChange={setColor} />
        <IconPicker value={icon} onChange={setIcon} />

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
