// Pagina Ajustes. En la fase 2 alberga la gestion del perfil activo: editar (nombre,
// color, avatar) y eliminar (con doble confirmacion). Moneda/locale llegaran mas
// adelante. Ver ARCHITECTURE.md seccion 4 (ruta /ajustes).
import { useState } from 'react';
import { useActiveProfile } from '../hooks/useProfiles';
import { ProfileAvatar, ProfileFormModal, DeleteProfileModal } from '../components/profile';

export default function SettingsPage() {
  const profile = useActiveProfile();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <section className="max-w-2xl">
      <h2 className="text-xl font-semibold text-slate-100">Ajustes</h2>

      <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Perfil</h3>
        <div className="mt-4 flex items-center gap-4">
          <ProfileAvatar profile={profile} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-semibold text-slate-100">{profile.name}</p>
            <p className="text-sm text-slate-500">
              Los datos de este perfil no se comparten con ningun otro perfil.
            </p>
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800"
          >
            Editar perfil
          </button>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-red-900/60 bg-red-950/20 p-5">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-red-400">
          Zona peligrosa
        </h3>
        <p className="mt-2 text-sm text-slate-400">
          Eliminar el perfil borra de forma permanente todos sus datos en este dispositivo. Esta
          accion no se puede deshacer.
        </p>
        <button
          type="button"
          onClick={() => setDeleteOpen(true)}
          className="mt-4 rounded-lg border border-red-700 px-4 py-2 text-sm font-medium text-red-300 hover:bg-red-950/60"
        >
          Eliminar este perfil
        </button>
      </div>

      <ProfileFormModal open={editOpen} onClose={() => setEditOpen(false)} profile={profile} />
      <DeleteProfileModal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        profile={profile}
      />
    </section>
  );
}
