// Pagina Ajustes. En la fase 2 alberga la gestion del perfil activo: editar (nombre,
// color, avatar) y eliminar (con doble confirmacion). Moneda/locale llegaran mas
// adelante. Ver ARCHITECTURE.md seccion 4 (ruta /ajustes).
import { useState } from 'react';
import { Link } from 'react-router-dom';
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

      <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Mover tus datos entre dispositivos
        </h3>
        <p className="mt-2 text-sm text-slate-400">
          Esta app guarda todo en este dispositivo, sin nube. Para llevar tus datos de un PC a un
          movil (o al reves) usa el backup del perfil:
        </p>
        <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-slate-300">
          <li>
            En el dispositivo de origen, ve a{' '}
            <Link to="/exportar" className="font-medium text-indigo-400 hover:text-indigo-300">
              Exportar
            </Link>{' '}
            y pulsa <strong className="text-slate-100">Descargar backup de este perfil</strong>. Se
            guarda un unico archivo JSON con todos tus datos.
          </li>
          <li>
            Pasa ese archivo al otro dispositivo por el medio que prefieras (cable, memoria USB,
            tu propio correo, un disco compartido...). El archivo es tuyo y no pasa por esta app.
          </li>
          <li>
            En el dispositivo de destino, abre{' '}
            <Link to="/exportar" className="font-medium text-indigo-400 hover:text-indigo-300">
              Exportar
            </Link>
            , elige el archivo en <strong className="text-slate-100">Restaurar un backup</strong> y
            decide si <strong className="text-slate-100">creas un perfil nuevo</strong> (recomendado
            la primera vez) o <strong className="text-slate-100">sobrescribes</strong> un perfil
            existente.
          </li>
        </ol>
        <p className="mt-3 text-sm text-slate-500">
          Consejo: haz un backup cada cierto tiempo. Es tambien tu copia de seguridad si cambias de
          navegador o borras los datos del sitio.
        </p>
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
