// Acceso a la cuenta desde la pantalla de seleccion de perfil.
//
// Sin esta tarjeta, en un dispositivo nuevo (o tras cerrar sesion, cuando los perfiles
// sincronizados quedan ocultos) habria que crear un perfil de relleno solo para llegar a
// "Cuenta". Aqui se puede:
//   - sin sesion: iniciar sesion o crear cuenta;
//   - con sesion y sin perfiles de la cuenta en este dispositivo: descargarlos de la nube;
//   - cerrar sesion (dispositivo compartido).
// Solo aparece si la app tiene Supabase configurado. Sin logica de negocio propia: usa
// AccountPanel, la sincronizacion (rebuildDevice) y el contexto de perfiles.
import { useState } from 'react';
import { useAuthOptional } from '../../auth';
import { AccountPanel } from '../auth';
import { useSyncOptional } from '../../sync/SyncContext';
import { rebuildDevice } from '../../sync';
import { useProfiles } from '../../hooks/useProfiles';

const CARD = 'mt-8 rounded-2xl border border-slate-800 bg-slate-900/60 p-5 text-left';
const BTN_PRIMARY =
  'rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50';
const BTN_GHOST =
  'rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50';

export function CloudAccessCard() {
  const auth = useAuthOptional();
  const sync = useSyncOptional();
  const { profiles, reload } = useProfiles();
  const [showLogin, setShowLogin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!auth || auth.status === 'loading' || auth.status === 'unconfigured') return null;

  if (auth.status === 'signed-out') {
    return (
      <section className={CARD} aria-label="Tu cuenta">
        <h2 className="text-base font-semibold text-slate-100">Tu cuenta</h2>
        <p className="mt-1 text-sm text-slate-400">
          Con cuenta, tus datos se guardan tambien en una copia privada en la nube y los ves en
          todos tus dispositivos. Solo tu puedes verlos.
        </p>
        {!showLogin ? (
          <button type="button" className={`${BTN_PRIMARY} mt-4`} onClick={() => setShowLogin(true)}>
            Iniciar sesion o crear cuenta
          </button>
        ) : (
          <div className="mt-4">
            <AccountPanel />
          </div>
        )}
      </section>
    );
  }

  // Sesion iniciada.
  const userId = auth.user?.id ?? null;
  const hasCloudProfiles = profiles.some((p) => userId !== null && p.ownerUserId === userId);

  const onDownload = async (): Promise<void> => {
    if (!sync?.client || !userId) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await rebuildDevice(sync.client, userId);
      await reload();
      setMessage(
        result.profiles === 0
          ? 'Tu cuenta aun no tiene datos guardados. Crea tu perfil arriba: quedara vinculado a tu cuenta.'
          : `Listo: ${result.profiles} perfil(es) descargado(s). Elige uno arriba.`,
      );
    } catch (e) {
      setMessage(
        `No se pudieron descargar tus datos: ${e instanceof Error ? e.message : 'error desconocido'}. Comprueba la conexion e intentalo de nuevo.`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={CARD} aria-label="Tu cuenta">
      <h2 className="text-base font-semibold text-slate-100">Tu cuenta</h2>
      <p className="mt-1 break-words text-sm text-slate-400">
        Sesion iniciada como <span className="text-slate-200">{auth.user?.email ?? 'tu cuenta'}</span>.
        {hasCloudProfiles
          ? ' Tus perfiles sincronizados aparecen arriba.'
          : ' Si ya usabas la app en otro dispositivo, descarga aqui tus datos. Si es tu primera vez, crea tu perfil arriba: quedara vinculado a tu cuenta.'}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {!hasCloudProfiles && (
          <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => void onDownload()}>
            {busy ? 'Descargando...' : 'Descargar mis datos'}
          </button>
        )}
        <button
          type="button"
          className={BTN_GHOST}
          disabled={busy}
          onClick={() => void auth.signOut()}
        >
          Cerrar sesion
        </button>
      </div>
      {message && <p className="mt-3 text-sm text-slate-300">{message}</p>}
    </section>
  );
}
