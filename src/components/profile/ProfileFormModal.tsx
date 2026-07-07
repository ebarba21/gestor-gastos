// Formulario de crear o editar un perfil (nombre, color de acento y emoji opcional).
// Reutiliza el mismo modal para ambos modos. Delega la persistencia en el contexto.
import { useEffect, useState, type FormEvent } from 'react';
import type { Profile } from '../../db/schema';
import { Modal } from '../common';
import { useProfiles } from '../../hooks/useProfiles';
import { useToast } from '../../context/ToastContext';
import {
  MAX_PROFILE_NAME_LENGTH,
  PROFILE_COLORS,
  PROFILE_EMOJIS,
  pickDefaultColor,
} from '../../services/profileService';

interface ProfileFormModalProps {
  open: boolean;
  onClose: () => void;
  // Si se pasa un perfil, el modal edita; si no, crea uno nuevo.
  profile?: Profile | null;
}

export function ProfileFormModal({ open, onClose, profile }: ProfileFormModalProps) {
  const { profiles, createProfile, updateProfile } = useProfiles();
  const { showToast } = useToast();

  const isEdit = Boolean(profile);

  const [name, setName] = useState('');
  const [color, setColor] = useState(PROFILE_COLORS[0]!);
  const [emoji, setEmoji] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Al abrir, precarga los valores (perfil existente) o valores por defecto (nuevo).
  useEffect(() => {
    if (!open) return;
    setError(null);
    setSaving(false);
    if (profile) {
      setName(profile.name);
      setColor(profile.color);
      setEmoji(profile.avatarEmoji);
    } else {
      setName('');
      setColor(pickDefaultColor(profiles.length));
      setEmoji(null);
    }
  }, [open, profile, profiles.length]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    setError(null);
    setSaving(true);
    try {
      if (profile) {
        await updateProfile(profile.id, { name, color, avatarEmoji: emoji });
        showToast('Perfil actualizado.', 'success');
      } else {
        await createProfile({ name, color, avatarEmoji: emoji });
        showToast('Perfil creado.', 'success');
      }
      onClose();
    } catch (err) {
      // Sin errores silenciosos: se muestra el mensaje de validacion al usuario.
      setError(err instanceof Error ? err.message : 'No se pudo guardar el perfil.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Editar perfil' : 'Crear perfil'}
      dismissible={!saving}
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label htmlFor="profile-name" className="block text-sm font-medium text-slate-300">
            Nombre
          </label>
          <input
            id="profile-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={MAX_PROFILE_NAME_LENGTH}
            autoFocus
            placeholder="Personal, Trabajo, Hogar..."
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-slate-500"
          />
        </div>

        <div>
          <span className="block text-sm font-medium text-slate-300">Color</span>
          <div className="mt-2 flex flex-wrap gap-2">
            {PROFILE_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={`Color ${c}`}
                aria-pressed={color === c}
                className={[
                  'h-8 w-8 rounded-full border-2 transition',
                  color === c ? 'border-white' : 'border-transparent',
                ].join(' ')}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>

        <div>
          <span className="block text-sm font-medium text-slate-300">Avatar (opcional)</span>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setEmoji(null)}
              aria-pressed={emoji === null}
              className={[
                'flex h-9 w-9 items-center justify-center rounded-lg border text-xs',
                emoji === null
                  ? 'border-slate-400 bg-slate-700 text-slate-200'
                  : 'border-slate-700 text-slate-400',
              ].join(' ')}
            >
              Sin
            </button>
            {PROFILE_EMOJIS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => setEmoji(e)}
                aria-pressed={emoji === e}
                className={[
                  'flex h-9 w-9 items-center justify-center rounded-lg border text-lg',
                  emoji === e ? 'border-slate-400 bg-slate-700' : 'border-slate-700',
                ].join(' ')}
              >
                {e}
              </button>
            ))}
          </div>
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
            disabled={saving}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {saving ? 'Guardando...' : isEdit ? 'Guardar cambios' : 'Crear perfil'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
