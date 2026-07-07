// Formulario de crear/editar etiqueta (nombre unico por perfil + color). Delega en
// tagService.
import { useEffect, useState, type FormEvent } from 'react';
import type { Tag } from '../../db/schema';
import { Modal, ColorPicker } from '../common';
import { ACCENT_COLORS } from '../../lib/colors';
import { tagService, MAX_TAG_NAME_LENGTH } from '../../services/tagService';
import { useToast } from '../../context/ToastContext';

interface TagFormModalProps {
  open: boolean;
  onClose: () => void;
  profileId: string;
  onSaved: () => void | Promise<void>;
  tag?: Tag | null;
}

export function TagFormModal({ open, onClose, profileId, onSaved, tag }: TagFormModalProps) {
  const { showToast } = useToast();
  const isEdit = Boolean(tag);
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>(ACCENT_COLORS[0]!);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSaving(false);
    setName(tag ? tag.name : '');
    setColor(tag?.color ?? ACCENT_COLORS[0]!);
  }, [open, tag]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    setError(null);
    setSaving(true);
    try {
      if (tag) {
        await tagService.updateTag(profileId, tag.id, { name, color });
      } else {
        await tagService.createTag(profileId, { name, color });
      }
      showToast(isEdit ? 'Etiqueta actualizada.' : 'Etiqueta creada.', 'success');
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la etiqueta.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Editar etiqueta' : 'Nueva etiqueta'}
      dismissible={!saving}
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label htmlFor="tag-name" className="block text-sm font-medium text-slate-300">
            Nombre
          </label>
          <input
            id="tag-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={MAX_TAG_NAME_LENGTH}
            autoFocus
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-slate-500"
          />
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
