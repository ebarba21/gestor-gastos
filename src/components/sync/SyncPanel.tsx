// Panel de sincronizacion (ruta /sincronizacion). Muestra el estado, la ultima sincronizacion,
// las mutaciones pendientes, los conflictos (con resolucion manual), los errores y un boton de
// reintento. Tambien ofrece migrar perfiles locales a la cuenta y reconstruir el dispositivo.
// Nunca expone secretos ni datos financieros completos.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useProfiles } from '../../hooks/useProfiles';
import { useSync } from '../../sync/SyncContext';
import {
  listOpenConflictsByUser,
  listPendingMutations,
  resolveKeepLocal,
  resolveKeepRemote,
  listMigratableProfiles,
  migrateProfile,
  rebuildDevice,
  type MigratableProfile,
} from '../../sync';
import type { Conflict, OutboxMutation } from '../../db/schema';

function formatDate(ts: number | null): string {
  if (!ts) return 'nunca';
  return new Date(ts).toLocaleString('es-ES');
}

export function SyncPanel(): React.ReactElement {
  const sync = useSync();
  const { userId, client, enabled } = sync;
  // La reconstruccion y la migracion crean/vinculan perfiles: hay que recargar la lista del
  // contexto para que el selector de perfil se actualice en vivo (sin recargar la pagina).
  const { reload: reloadProfiles } = useProfiles();

  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [pending, setPending] = useState<OutboxMutation[]>([]);
  const [migratable, setMigratable] = useState<MigratableProfile[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!userId) {
      setConflicts([]);
      setPending([]);
      setMigratable([]);
      return;
    }
    setConflicts(await listOpenConflictsByUser(userId));
    setPending(await listPendingMutations(userId));
    setMigratable(await listMigratableProfiles());
    await sync.refresh();
  }, [userId, sync]);

  useEffect(() => {
    void reload();
  }, [reload, sync.pendingCount, sync.conflictCount, sync.status]);

  const onResolve = async (
    conflictId: string,
    resolver: (id: string) => Promise<void>,
  ): Promise<void> => {
    setBusy(conflictId);
    try {
      await resolver(conflictId);
      await sync.syncNow();
    } finally {
      setBusy(null);
      await reload();
    }
  };

  const onMigrate = async (profileId: string): Promise<void> => {
    if (!client || !userId) return;
    setBusy(profileId);
    setNotice(
      'Consejo: exporta un backup del perfil (Exportar) antes de migrar. La migracion no borra tus datos locales.',
    );
    try {
      const result = await migrateProfile(client, userId, profileId);
      setNotice(
        result.status === 'verified'
          ? 'Perfil migrado y verificado.'
          : `La migracion no se pudo verificar: ${result.lastError ?? 'reintenta'}.`,
      );
    } finally {
      setBusy(null);
      await reload();
      // Migrar vincula el perfil a la cuenta; refrescar el selector para reflejar el cambio.
      await reloadProfiles();
    }
  };

  const onRebuild = async (): Promise<void> => {
    if (!client || !userId) return;
    setBusy('rebuild');
    try {
      const result = await rebuildDevice(client, userId);
      setNotice(`Reconstruccion: ${result.profiles} perfiles, ${result.rows} registros descargados.`);
    } finally {
      setBusy(null);
      await reload();
      // El selector de perfil vive en otro contexto: recargarlo para que aparezcan los perfiles
      // reconstruidos sin necesidad de refrescar la pagina.
      await reloadProfiles();
    }
  };

  if (!enabled) {
    return (
      <section className="space-y-3">
        <h1 className="text-xl font-bold">Sincronizacion</h1>
        <p className="text-slate-400">
          La sincronizacion es opcional. Para copiar tus perfiles de forma privada entre
          dispositivos, activa una cuenta en{' '}
          <Link to="/cuenta" className="text-sky-400 underline">
            Cuenta
          </Link>
          . Sin cuenta, la app funciona 100% en local.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">Sincronizacion</h1>
        <button
          type="button"
          onClick={() => void sync.syncNow()}
          disabled={sync.status === 'syncing'}
          className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
        >
          {sync.status === 'syncing' ? 'Sincronizando...' : 'Sincronizar ahora'}
        </button>
      </header>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Estado" value={sync.status} />
        <Stat label="Ultima sincronizacion" value={formatDate(sync.lastSyncedAt)} />
        <Stat label="Cambios pendientes" value={String(sync.pendingCount)} />
        <Stat label="Conflictos" value={String(sync.conflictCount)} />
      </dl>

      {!sync.online && (
        <p className="rounded-lg border border-slate-700 bg-slate-900 p-3 text-sm text-slate-300">
          Sin conexion. Tus cambios se guardan en local y se sincronizaran al recuperar la red.
        </p>
      )}
      {sync.lastError && (
        <p className="rounded-lg border border-rose-800 bg-rose-950/40 p-3 text-sm text-rose-200">
          Error: {sync.lastError}
        </p>
      )}
      {notice && (
        <p className="rounded-lg border border-slate-700 bg-slate-900 p-3 text-sm text-slate-300">
          {notice}
        </p>
      )}

      {conflicts.length > 0 && (
        <div className="space-y-2">
          <h2 className="font-semibold">Conflictos ({conflicts.length})</h2>
          <p className="text-sm text-slate-400">
            Otro dispositivo cambio estos registros. Elige que version conservar. Los importes nunca
            se combinan de forma automatica.
          </p>
          <ul className="space-y-2">
            {conflicts.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-800 bg-amber-950/30 p-3 text-sm"
              >
                <span className="text-slate-200">
                  {c.entityType} · {c.entityId.slice(0, 8)}…
                </span>
                <span className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy === c.id}
                    onClick={() => void onResolve(c.id, resolveKeepLocal)}
                    className="rounded bg-slate-700 px-2 py-1 text-xs hover:bg-slate-600 disabled:opacity-50"
                  >
                    Mantener local
                  </button>
                  <button
                    type="button"
                    disabled={busy === c.id}
                    onClick={() => void onResolve(c.id, resolveKeepRemote)}
                    className="rounded bg-slate-700 px-2 py-1 text-xs hover:bg-slate-600 disabled:opacity-50"
                  >
                    Mantener remota
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {migratable.length > 0 && (
        <div className="space-y-2">
          <h2 className="font-semibold">Perfiles locales sin migrar</h2>
          <p className="text-sm text-slate-400">
            Estos perfiles aun no estan vinculados a tu cuenta. Al migrarlos se suben a tu copia
            remota privada; tus datos locales no se borran.
          </p>
          <ul className="space-y-2">
            {migratable.map(({ profile, counts }) => (
              <li
                key={profile.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-700 bg-slate-900 p-3 text-sm"
              >
                <span className="text-slate-200">
                  {profile.name} · {counts.transaction ?? 0} movimientos, {counts.account ?? 0}{' '}
                  cuentas
                </span>
                <button
                  type="button"
                  disabled={busy === profile.id}
                  onClick={() => void onMigrate(profile.id)}
                  className="rounded bg-emerald-700 px-2 py-1 text-xs hover:bg-emerald-600 disabled:opacity-50"
                >
                  {busy === profile.id ? 'Migrando…' : 'Migrar'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-2">
        <h2 className="font-semibold">Otro dispositivo</h2>
        <p className="text-sm text-slate-400">
          Si este dispositivo esta vacio, puedes descargar y reconstruir tus perfiles remotos.
        </p>
        <button
          type="button"
          disabled={busy === 'rebuild'}
          onClick={() => void onRebuild()}
          className="rounded-lg border border-slate-600 px-3 py-2 text-sm hover:bg-slate-800 disabled:opacity-50"
        >
          {busy === 'rebuild' ? 'Descargando…' : 'Reconstruir desde la nube'}
        </button>
      </div>

      {pending.length > 0 && (
        <details className="rounded-lg border border-slate-700 bg-slate-900 p-3 text-sm">
          <summary className="cursor-pointer text-slate-300">
            Detalle de {pending.length} cambios pendientes
          </summary>
          <ul className="mt-2 space-y-1 text-slate-400">
            {pending.slice(0, 50).map((m) => (
              <li key={m.mutationId}>
                {m.operation} · {m.entityType} · {m.entityId.slice(0, 8)}… ·{' '}
                {m.status}
                {m.lastError ? ` · ${m.lastError}` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900 p-3">
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd className="mt-1 font-medium text-slate-100">{value}</dd>
    </div>
  );
}
