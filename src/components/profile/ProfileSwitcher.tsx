// Selector de perfil en la navegacion (ARCHITECTURE.md seccion 4): muestra el perfil
// activo y permite cambiar rapidamente a otro, crear uno nuevo o ir a la pantalla de
// seleccion. Vive en el layout, accesible desde cualquier seccion.
import { useEffect, useRef, useState } from 'react';
import { useProfiles } from '../../hooks/useProfiles';
import { ProfileAvatar } from './ProfileAvatar';
import { ProfileFormModal } from './ProfileFormModal';

export function ProfileSwitcher() {
  const { profiles, activeProfile, switchProfile, goToProfileSelection } = useProfiles();
  const [open, setOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Cierra el menu al hacer click fuera.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  if (!activeProfile) return null;

  const others = profiles.filter((p) => p.id !== activeProfile.id);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-left hover:border-slate-600"
      >
        <ProfileAvatar profile={activeProfile} size="sm" />
        <span className="flex-1 truncate text-sm font-medium text-slate-200">
          {activeProfile.name}
        </span>
        <span className="text-slate-500" aria-hidden>
          ▾
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 right-0 z-30 mt-1 rounded-lg border border-slate-700 bg-slate-900 py-1 shadow-xl"
        >
          {others.length > 0 && (
            <>
              <p className="px-3 py-1 text-xs uppercase tracking-wide text-slate-500">
                Cambiar a
              </p>
              {others.map((profile) => (
                <button
                  key={profile.id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    switchProfile(profile.id);
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-300 hover:bg-slate-800"
                >
                  <ProfileAvatar profile={profile} size="sm" />
                  <span className="truncate">{profile.name}</span>
                </button>
              ))}
              <div className="my-1 border-t border-slate-800" />
            </>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setFormOpen(true);
              setOpen(false);
            }}
            className="w-full px-3 py-2 text-left text-sm text-slate-300 hover:bg-slate-800"
          >
            Crear perfil
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              goToProfileSelection();
            }}
            className="w-full px-3 py-2 text-left text-sm text-slate-300 hover:bg-slate-800"
          >
            Cambiar de perfil...
          </button>
        </div>
      )}

      <ProfileFormModal open={formOpen} onClose={() => setFormOpen(false)} />
    </div>
  );
}
