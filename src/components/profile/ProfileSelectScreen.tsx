// Pantalla de seleccion de perfil. Se muestra al arrancar (si no hay perfil activo) y
// al "cambiar de perfil". Dos situaciones:
//   - Sin perfiles: se invita a crear el primero (estado vacio cuidado).
//   - Con perfiles: rejilla para elegir uno, editarlo, eliminarlo o crear otro.
// Es la unica pantalla accesible mientras no hay perfil activo (guard en ProfileGate).
import { useState } from 'react';
import type { Profile } from '../../db/schema';
import { useProfiles } from '../../hooks/useProfiles';
import { ProfileAvatar } from './ProfileAvatar';
import { ProfileFormModal } from './ProfileFormModal';
import { DeleteProfileModal } from './DeleteProfileModal';

export function ProfileSelectScreen() {
  const { profiles, switchProfile } = useProfiles();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [deleting, setDeleting] = useState<Profile | null>(null);

  const hasProfiles = profiles.length > 0;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 p-6 text-slate-100">
      <div className="w-full max-w-2xl">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold">Gestor de Gastos</h1>
          <p className="mt-2 text-sm text-slate-400">
            {hasProfiles
              ? 'Elige un perfil para continuar. Cada perfil guarda sus datos por separado en este dispositivo.'
              : 'Crea tu primer perfil para empezar. Todos los datos se quedan en este dispositivo.'}
          </p>
        </div>

        {hasProfiles ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {profiles.map((profile) => (
              <div
                key={profile.id}
                className="group flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4 transition hover:border-slate-600"
              >
                <button
                  type="button"
                  onClick={() => switchProfile(profile.id)}
                  className="flex flex-1 items-center gap-3 text-left"
                >
                  <ProfileAvatar profile={profile} size="lg" />
                  <span className="truncate text-base font-semibold">{profile.name}</span>
                </button>
                <div className="flex flex-col gap-1">
                  <button
                    type="button"
                    onClick={() => setEditing(profile)}
                    className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleting(profile)}
                    className="rounded px-2 py-1 text-xs text-red-400 hover:bg-red-950/60"
                  >
                    Eliminar
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/40 px-6 py-12 text-center">
            <span className="text-4xl" aria-hidden>
              👤
            </span>
            <p className="mt-4 text-sm text-slate-400">Aun no hay ningun perfil.</p>
          </div>
        )}

        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={() => setFormOpen(true)}
            className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-500"
          >
            {hasProfiles ? 'Crear otro perfil' : 'Crear primer perfil'}
          </button>
        </div>
      </div>

      <ProfileFormModal open={formOpen} onClose={() => setFormOpen(false)} />
      <ProfileFormModal
        open={editing !== null}
        onClose={() => setEditing(null)}
        profile={editing}
      />
      <DeleteProfileModal
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        profile={deleting}
      />
    </div>
  );
}
