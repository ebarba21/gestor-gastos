// Pagina Ajustes > Seguridad (ruta /ajustes/seguridad). Consolida: cuenta (resumen, enlaza a
// /cuenta para el detalle), PIN local, bloqueo automatico, passkeys y una explicacion honesta
// de cada capa (CLOUD_SYNC_SECURITY seccion 3: contrasena de cuenta != PIN != passkey/biometria).
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth';
import { Modal, ConfirmDialog } from '../components/common';
import {
  AUTO_LOCK_OPTIONS_MS,
  useLock,
  type AutoLockOptionMs,
} from '../security/LockContext';
import {
  isPlatformAuthenticatorAvailable,
  webauthnService,
  type PasskeySummary,
} from '../security/webauthn';
import { biometricLabel } from '../security/biometricUnlock';

const CARD = 'rounded-2xl border border-slate-800 bg-slate-900 p-5';
const LABEL = 'block text-sm font-medium text-slate-300';
const INPUT =
  'mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-500';
const PRIMARY_BTN =
  'rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60';
const GHOST_BTN =
  'rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-60';

const AUTO_LOCK_LABELS: Record<AutoLockOptionMs, string> = {
  0: 'Inmediato',
  60_000: '1 minuto',
  300_000: '5 minutos',
  900_000: '15 minutos',
  1_800_000: '30 minutos',
};

function messageOf(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return 'No se pudo completar la operacion.';
}

export default function SecurityPage() {
  const auth = useAuth();

  return (
    <section className="max-w-2xl space-y-6">
      <h2 className="text-xl font-semibold text-slate-100">Ajustes de seguridad</h2>

      <AccountSummaryCard />
      <PinCard />
      <BiometricCard />
      <AutoLockCard />
      {auth.status === 'signed-in' && <PasskeysCard />}
      <ExplanationCard />
    </section>
  );
}

function AccountSummaryCard() {
  const auth = useAuth();
  return (
    <div className={CARD}>
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Cuenta</h3>
      {auth.status === 'signed-in' ? (
        <>
          <p className="mt-3 text-sm text-slate-300">
            Sesion iniciada como <strong className="text-slate-100">{auth.user?.email}</strong>
            {auth.emailPending ? ' (correo sin verificar)' : ''}.
          </p>
          <p className="mt-2 text-sm text-slate-400">
            Cambiar contrasena, cerrar sesion o cerrar otras sesiones se gestiona en{' '}
            <Link to="/cuenta" className="font-medium text-indigo-400 hover:text-indigo-300">
              Cuenta
            </Link>
            .
          </p>
        </>
      ) : (
        <p className="mt-3 text-sm text-slate-400">
          Esta instalacion funciona en modo local (sin cuenta). El PIN de este dispositivo protege
          igualmente tus datos locales. Activar una{' '}
          <Link to="/cuenta" className="font-medium text-indigo-400 hover:text-indigo-300">
            cuenta
          </Link>{' '}
          es opcional y añade recuperacion de PIN y passkeys.
        </p>
      )}
    </div>
  );
}

function PinCard() {
  const lock = useLock();
  const [mode, setMode] = useState<'idle' | 'enable' | 'change' | 'disable'>('idle');

  if (mode === 'enable') return <EnablePinForm onDone={() => setMode('idle')} />;
  if (mode === 'change') return <ChangePinForm onDone={() => setMode('idle')} />;
  if (mode === 'disable') return <DisablePinForm onDone={() => setMode('idle')} />;

  // Sin PIN activo, esta es la accion de seguridad mas valiosa de toda la pagina: se resalta con
  // un acento (no solo otra tarjeta gris mas) para que destaque frente al resto de secciones.
  const cardClass = lock.security.pinEnabled ? CARD : `${CARD} border-indigo-700/60 bg-indigo-950/10`;

  return (
    <div className={cardClass}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">PIN local</h3>
        {!lock.security.pinEnabled && (
          <span className="rounded-full bg-indigo-600/20 px-2 py-0.5 text-xs font-medium text-indigo-300">
            Recomendado
          </span>
        )}
      </div>
      <p className="mt-2 text-sm text-slate-400">
        Protege el acceso a la app en ESTE dispositivo. Nunca sale de aqui ni se envia a Supabase
        (ver explicacion mas abajo).
      </p>
      {lock.security.pinEnabled ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="rounded-lg border border-emerald-800/60 bg-emerald-950/20 px-3 py-2 text-sm text-emerald-300">
            PIN activo
          </span>
          <button type="button" onClick={() => setMode('change')} className={GHOST_BTN}>
            Cambiar PIN
          </button>
          <button type="button" onClick={() => setMode('disable')} className={GHOST_BTN}>
            Desactivar PIN
          </button>
          <button type="button" onClick={lock.lock} className={GHOST_BTN}>
            Bloquear ahora
          </button>
        </div>
      ) : (
        <div className="mt-4">
          <button type="button" onClick={() => setMode('enable')} className={PRIMARY_BTN}>
            Activar PIN
          </button>
        </div>
      )}
    </div>
  );
}

// Desbloqueo con Face ID / Touch ID / huella / Windows Hello (src/security/biometricUnlock.ts).
// Requiere PIN: la biometria solo evita teclearlo; el PIN sigue siendo la via de respaldo.
function BiometricCard() {
  const lock = useLock();
  const label = biometricLabel();
  const [askingPin, setAskingPin] = useState(false);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleEnable(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await lock.enableBiometricUnlock(pin);
      setPin('');
      setAskingPin(false);
      setNotice(`Listo: al abrir la app se te pedira ${label}.`);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDisable() {
    setError(null);
    setBusy(true);
    try {
      await lock.disableBiometricUnlock();
      setNotice('Desactivado. Para entrar se pedira el PIN.');
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={CARD}>
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
        Entrar con {label}
      </h3>
      <p className="mt-2 text-sm text-slate-400">
        Abre la app con tu cara o tu huella en lugar de teclear el PIN. Lo gestiona el sistema del
        dispositivo: la app nunca recibe datos biometricos. Se activa en cada dispositivo por
        separado.
      </p>
      {!lock.security.pinEnabled ? (
        <p className="mt-3 text-sm text-slate-300">Activa primero un PIN (arriba): es la via de respaldo.</p>
      ) : !lock.platformAuthenticatorAvailable && !lock.biometricEnabled ? (
        <p className="mt-3 text-sm text-amber-300">
          Este navegador no ofrece {label} para la web. En iPhone usa la app instalada desde Safari;
          en Windows, Chrome o Edge con Windows Hello configurado.
        </p>
      ) : lock.biometricEnabled ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="rounded-lg border border-emerald-800/60 bg-emerald-950/20 px-3 py-2 text-sm text-emerald-300">
            Activado en este dispositivo
          </span>
          <button type="button" onClick={() => void handleDisable()} disabled={busy} className={GHOST_BTN}>
            Desactivar
          </button>
        </div>
      ) : askingPin ? (
        <form onSubmit={handleEnable} className="mt-4 space-y-3" noValidate>
          <div>
            <label className={LABEL} htmlFor="bio-pin">
              Tu PIN actual
            </label>
            <input
              id="bio-pin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              className={INPUT}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy || pin.length === 0} className={PRIMARY_BTN}>
              {busy ? 'Esperando a ' + label + '...' : 'Continuar'}
            </button>
            <button type="button" onClick={() => setAskingPin(false)} className={GHOST_BTN}>
              Cancelar
            </button>
          </div>
        </form>
      ) : (
        <div className="mt-4">
          <button type="button" onClick={() => setAskingPin(true)} className={PRIMARY_BTN}>
            Activar {label}
          </button>
        </div>
      )}
      <div role="status" className="mt-3">
        {error && <p className="text-sm text-red-400">{error}</p>}
        {notice && !error && <p className="text-sm text-emerald-400">{notice}</p>}
      </div>
    </div>
  );
}

function PinFields({
  fields,
}: {
  fields: { id: string; label: string; value: string; onChange: (v: string) => void }[];
}) {
  return (
    <>
      {fields.map((f) => (
        <div key={f.id}>
          <label className={LABEL} htmlFor={f.id}>
            {f.label}
          </label>
          <input
            id={f.id}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            required
            className={INPUT}
            value={f.value}
            onChange={(e) => f.onChange(e.target.value.replace(/\D/g, ''))}
          />
        </div>
      ))}
    </>
  );
}

function EnablePinForm({ onDone }: { onDone: () => void }) {
  const lock = useLock();
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handle(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await lock.enablePin(pin, confirmPin);
      onDone();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handle} className={`${CARD} space-y-4`} noValidate>
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Activar PIN</h3>
      <p className="text-sm text-slate-400">Minimo 6 digitos. Solo numeros.</p>
      <PinFields
        fields={[
          { id: 'pin-new', label: 'PIN nuevo', value: pin, onChange: setPin },
          { id: 'pin-confirm', label: 'Confirma el PIN', value: confirmPin, onChange: setConfirmPin },
        ]}
      />
      {error && (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className={PRIMARY_BTN}>
          {busy ? 'Activando...' : 'Activar PIN'}
        </button>
        <button type="button" onClick={onDone} className={GHOST_BTN}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

function ChangePinForm({ onDone }: { onDone: () => void }) {
  const lock = useLock();
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handle(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await lock.changePin(currentPin, newPin, confirmPin);
      onDone();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handle} className={`${CARD} space-y-4`} noValidate>
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Cambiar PIN</h3>
      <PinFields
        fields={[
          { id: 'pin-current', label: 'PIN actual', value: currentPin, onChange: setCurrentPin },
          { id: 'pin-new', label: 'PIN nuevo', value: newPin, onChange: setNewPin },
          { id: 'pin-confirm', label: 'Confirma el PIN nuevo', value: confirmPin, onChange: setConfirmPin },
        ]}
      />
      {error && (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className={PRIMARY_BTN}>
          {busy ? 'Guardando...' : 'Cambiar PIN'}
        </button>
        <button type="button" onClick={onDone} className={GHOST_BTN}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

function DisablePinForm({ onDone }: { onDone: () => void }) {
  const lock = useLock();
  const [currentPin, setCurrentPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handle(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await lock.disablePin(currentPin);
      onDone();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handle} className={`${CARD} space-y-4 border-amber-900/60`} noValidate>
      <h3 className="text-sm font-semibold uppercase tracking-wide text-amber-400">
        Desactivar PIN
      </h3>
      <p className="text-sm text-slate-400">
        Sin PIN, cualquiera que abra este dispositivo vera tus datos financieros. Introduce tu PIN
        para confirmar.
      </p>
      <PinFields fields={[{ id: 'pin-current', label: 'PIN actual', value: currentPin, onChange: setCurrentPin }]} />
      {error && (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="rounded-lg bg-amber-700 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-60">
          {busy ? 'Desactivando...' : 'Desactivar PIN'}
        </button>
        <button type="button" onClick={onDone} className={GHOST_BTN}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

function AutoLockCard() {
  const lock = useLock();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleChange(value: string) {
    setError(null);
    setBusy(true);
    try {
      await lock.setAutoLockMs(Number(value) as AutoLockOptionMs);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={CARD}>
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
        Bloqueo automatico
      </h3>
      <p className="mt-2 text-sm text-slate-400">
        Cuanto tiempo puede estar la app en segundo plano antes de bloquearse sola. Requiere PIN
        activo.
      </p>
      <select
        className={`${INPUT} mt-3 max-w-xs`}
        value={String(lock.security.autoLockMs ?? 300_000)}
        disabled={!lock.security.pinEnabled || busy}
        onChange={(e) => void handleChange(e.target.value)}
        aria-label="Bloqueo automatico"
      >
        {AUTO_LOCK_OPTIONS_MS.map((ms) => (
          <option key={ms} value={ms}>
            {AUTO_LOCK_LABELS[ms]}
          </option>
        ))}
      </select>
      {error && (
        <p className="mt-2 text-sm text-red-400" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function PasskeysCard() {
  const lock = useLock();
  const [platformAvailable, setPlatformAvailable] = useState(false);
  const [passkeys, setPasskeys] = useState<PasskeySummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<PasskeySummary | null>(null);
  const [deleting, setDeleting] = useState<PasskeySummary | null>(null);

  const refresh = useCallback(async () => {
    if (!lock.passkeysFeatureEnabled) return;
    try {
      setPasskeys(await webauthnService.listPasskeys());
    } catch (err) {
      setError(messageOf(err));
    }
  }, [lock.passkeysFeatureEnabled]);

  useEffect(() => {
    void isPlatformAuthenticatorAvailable().then(setPlatformAvailable);
    void refresh();
  }, [refresh]);

  if (!lock.passkeysFeatureEnabled) {
    return (
      <div className={CARD}>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Passkeys</h3>
        <p className="mt-2 text-sm text-slate-400">
          Los passkeys no estan activados en esta instalacion (integracion experimental,
          desactivada por defecto). Sigue disponible la contrasena de cuenta y el PIN local.
        </p>
      </div>
    );
  }

  if (!lock.webAuthnSupported) {
    return (
      <div className={CARD}>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Passkeys</h3>
        <p className="mt-2 text-sm text-slate-400">
          Este navegador no soporta passkeys (WebAuthn). Sigue disponible la contrasena de cuenta y
          el PIN local.
        </p>
      </div>
    );
  }

  async function handleRegister() {
    setError(null);
    setBusy(true);
    try {
      await webauthnService.registerPasskey();
      await refresh();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    await webauthnService.deletePasskey(id);
    await refresh();
  }

  async function handleRename(id: string, newName: string) {
    await webauthnService.renamePasskey(id, newName);
    await refresh();
  }

  return (
    <div className={CARD}>
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Passkeys</h3>
      <p className="mt-2 text-sm text-slate-400">
        {platformAvailable
          ? 'Este dispositivo ofrece biometria (o el PIN del sistema) para los passkeys. La app nunca recibe esos datos: los verifica el sistema operativo.'
          : 'Puedes usar un passkey (biometria, PIN del sistema o llave fisica, segun tu dispositivo/navegador). La app nunca recibe esos datos.'}
      </p>

      <label className="mt-4 flex items-center gap-2 text-sm text-slate-300">
        <input
          type="checkbox"
          checked={lock.security.passkeysEnabled}
          onChange={(e) => void lock.setPasskeysEnabled(e.target.checked)}
        />
        Permitir desbloquear con passkey desde la pantalla bloqueada
      </label>

      <div className="mt-4">
        <button type="button" onClick={() => void handleRegister()} disabled={busy} className={PRIMARY_BTN}>
          {busy ? 'Registrando...' : 'Registrar un passkey en este dispositivo'}
        </button>
      </div>

      {error && (
        <p className="mt-2 text-sm text-red-400" role="alert">
          {error}
        </p>
      )}

      {passkeys.length > 0 && (
        <ul className="mt-4 space-y-2">
          {passkeys.map((pk) => (
            <li
              key={pk.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
            >
              <span className="truncate text-slate-200">{pk.friendlyName ?? 'Passkey sin nombre'}</span>
              {/* Botones con area tactil generosa (no enlaces de texto sueltos): min 40px de alto. */}
              <span className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => setRenaming(pk)}
                  className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-medium text-indigo-300 hover:bg-slate-800"
                >
                  Renombrar
                </button>
                <button
                  type="button"
                  onClick={() => setDeleting(pk)}
                  className="rounded-lg border border-red-900/60 px-3 py-2 text-xs font-medium text-red-300 hover:bg-red-950/40"
                >
                  Eliminar
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-slate-500">
        La contrasena de tu cuenta y el PIN siguen funcionando siempre: nunca te quedas sin forma
        de entrar por depender solo de un passkey.
      </p>

      <RenamePasskeyModal
        passkey={renaming}
        onClose={() => setRenaming(null)}
        onRename={handleRename}
      />
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Eliminar passkey"
        message={
          <>
            Vas a eliminar el passkey{' '}
            <strong className="text-slate-100">{deleting?.friendlyName ?? 'sin nombre'}</strong>.
            Necesitaras tu contrasena de cuenta o tu PIN para volver a entrar desde este metodo.
          </>
        }
        buttons={[
          { label: 'Cancelar' },
          {
            label: 'Eliminar',
            variant: 'danger',
            onClick: () => (deleting ? handleDelete(deleting.id) : undefined),
          },
        ]}
      />
    </div>
  );
}

function RenamePasskeyModal({
  passkey,
  onClose,
  onRename,
}: {
  passkey: PasskeySummary | null;
  onClose: () => void;
  onRename: (id: string, newName: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (passkey) {
      setName(passkey.friendlyName ?? '');
      setError(null);
    }
  }, [passkey]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!passkey) return;
    setError(null);
    setBusy(true);
    try {
      await onRename(passkey.id, name);
      onClose();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={passkey !== null} onClose={onClose} title="Renombrar passkey" dismissible={!busy}>
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div>
          <label className={LABEL} htmlFor="passkey-name">
            Nombre del dispositivo
          </label>
          <input
            id="passkey-name"
            type="text"
            autoFocus
            maxLength={120}
            className={INPUT}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        {error && (
          <p className="text-sm text-red-400" role="alert">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className={GHOST_BTN}>
            Cancelar
          </button>
          <button type="submit" disabled={busy || name.trim().length === 0} className={PRIMARY_BTN}>
            {busy ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ExplanationCard() {
  return (
    <div className={CARD}>
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
        Que protege cada capa
      </h3>
      <dl className="mt-3 space-y-3 text-sm text-slate-400">
        <div>
          <dt className="font-medium text-slate-200">Contrasena de cuenta</dt>
          <dd>Identifica a la persona ante el proveedor de sincronizacion. Viaja cifrada a Supabase; nunca se guarda en claro en la app.</dd>
        </div>
        <div>
          <dt className="font-medium text-slate-200">PIN local</dt>
          <dd>Protege el acceso a la app en ESTE dispositivo. Nunca sale de aqui ni se envia a Supabase; se guarda solo un verificador derivado, nunca el PIN.</dd>
        </div>
        <div>
          <dt className="font-medium text-slate-200">Passkey / biometria</dt>
          <dd>
            Verificacion del sistema operativo o del autenticador (WebAuthn). La app nunca recibe
            huellas, rostro ni datos biometricos: solo el resultado (si o no) de esa verificacion.
          </dd>
        </div>
      </dl>
      <p className="mt-4 text-xs text-slate-500">
        Recuperacion: con cuenta, un PIN olvidado se recupera reautenticando con la contrasena de
        cuenta (tus datos no se pierden). Sin cuenta, un PIN olvidado no tiene recuperacion: la
        unica opcion desde la pantalla bloqueada es restablecer los datos locales de este
        dispositivo (accion irreversible). Por eso conviene activar una cuenta o hacer copias de
        seguridad periodicas desde{' '}
        <Link to="/exportar" className="font-medium text-indigo-400 hover:text-indigo-300">
          Exportar
        </Link>
        .
      </p>
    </div>
  );
}
