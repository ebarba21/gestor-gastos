// Confirmacion de borrado de perfil. Accion destructiva e irreversible: se borran TODOS
// los datos del perfil (movimientos, cuentas, categorias, reglas, presupuestos...).
// Doble confirmacion: el usuario debe escribir el nombre exacto del perfil para habilitar
// el boton (ARCHITECTURE.md seccion 8).
import { useEffect, useState } from 'react';
import type { Profile } from '../../db/schema';
import { Modal } from '../common';
import { useProfiles } from '../../hooks/useProfiles';
import { useToast } from '../../context/ToastContext';

interface DeleteProfileModalProps {
  open: boolean;
  onClose: () => void;
  profile: Profile | null;
}

export function DeleteProfileModal({ open, onClose, profile }: DeleteProfileModalProps) {
  const { deleteProfile } = useProfiles();
  const { showToast } = useToast();
  const [confirmText, setConfirmText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (open) {
      setConfirmText('');
      setError(null);
      setDeleting(false);
    }
  }, [open]);

  if (!profile) return null;

  const canDelete = confirmText.trim() === profile.name && !deleting;

  async function handleDelete() {
    if (!profile || !canDelete) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteProfile(profile.id);
      showToast(`Perfil "${profile.name}" eliminado.`, 'success');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar el perfil.');
      setDeleting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Eliminar perfil" dismissible={!deleting}>
      <div className="space-y-4">
        <p className="text-sm text-slate-300">
          Vas a eliminar el perfil <strong className="text-slate-100">{profile.name}</strong>. Se
          borraran de forma permanente <strong>todos sus datos</strong>: movimientos, cuentas,
          categorias, etiquetas, reglas, presupuestos e importaciones.
        </p>
        <p className="rounded-lg border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-300">
          Esta accion no se puede deshacer.
        </p>
        <div>
          <label htmlFor="confirm-name" className="block text-sm text-slate-300">
            Escribe <strong className="text-slate-100">{profile.name}</strong> para confirmar:
          </label>
          <input
            id="confirm-name"
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            autoFocus
            autoComplete="off"
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-red-500"
          />
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={deleting}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={!canDelete}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {deleting ? 'Eliminando...' : 'Eliminar definitivamente'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
