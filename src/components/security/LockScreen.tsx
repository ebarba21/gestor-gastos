// Pantalla bloqueada (CLOUD_SYNC_SECURITY seccion 4). Es la UNICA cosa en pantalla mientras la
// app esta bloqueada: sin cifras, sin dashboard detras, sin overlay transparente. Permite PIN,
// passkey si esta disponible, cerrar sesion y recuperacion. Accesible por teclado y lector de
// pantalla (labels asociados, foco automatico, aria-live en errores).
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useAuth } from '../../auth';
import { useLock } from '../../security/LockContext';

const WRAP = 'flex min-h-screen flex-col items-center justify-center bg-slate-950 p-6 text-slate-100';
const CARD = 'w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-900 p-6';
const LABEL = 'block text-sm font-medium text-slate-300';
const INPUT =
  'mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-lg tracking-[0.3em] text-slate-100 outline-none focus:border-indigo-500';
const PRIMARY_BTN =
  'w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60';
const GHOST_BTN = 'w-full rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800';
const LINK_BTN = 'text-sm font-medium text-indigo-400 hover:text-indigo-300';

type View = 'pin' | 'recover' | 'reset';

export function LockScreen() {
  const [view, setView] = useState<View>('pin');

  return (
    <div className={WRAP}>
      <div className="mb-6 text-center">
        <h1 className="text-xl font-bold">Gestor de Gastos</h1>
        <p className="mt-1 text-sm text-slate-400">Aplicación bloqueada en este dispositivo.</p>
      </div>
      {view === 'pin' && (
        <PinUnlockCard onForgotten={() => setView('recover')} />
      )}
      {view === 'recover' && <RecoverCard onBack={() => setView('pin')} onReset={() => setView('reset')} />}
      {view === 'reset' && <ResetLocalDataCard onBack={() => setView('recover')} />}
    </div>
  );
}

function PinUnlockCard({ onForgotten }: { onForgotten: () => void }) {
  const lock = useLock();
  const auth = useAuth();
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signOutNotice, setSignOutNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [remainingMs, setRemainingMs] = useState(lock.lockoutRemainingMs);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setRemainingMs(lock.lockoutRemainingMs);
    if (lock.lockoutRemainingMs <= 0) return;
    const id = setInterval(() => {
      setRemainingMs((current) => Math.max(0, current - 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [lock.lockoutRemainingMs]);

  const lockedOut = remainingMs > 0;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await lock.unlockWithPin(pin);
      setPin('');
    } catch (err) {
      setError(messageOf(err));
      setRemainingMs(lock.lockoutRemainingMs);
    } finally {
      setBusy(false);
    }
  }

  async function handlePasskey() {
    setError(null);
    setBusy(true);
    try {
      await lock.unlockWithPasskey();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    setError(null);
    setSignOutNotice(null);
    setBusy(true);
    try {
      await auth.signOut();
      setSignOutNotice('Sesión de cuenta cerrada. El PIN de este dispositivo sigue activo.');
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  const canUsePasskey =
    lock.security.passkeysEnabled && lock.passkeysFeatureEnabled && lock.webAuthnSupported;

  return (
    <div className={CARD}>
      <form onSubmit={handleSubmit} className="space-y-4" noValidate aria-label="Desbloquear con PIN">
        <div>
          <label className={LABEL} htmlFor="lock-pin">
            PIN
          </label>
          <input
            ref={inputRef}
            id="lock-pin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            required
            disabled={busy || lockedOut}
            className={INPUT}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          />
        </div>

        <div role="alert">
          {error && <p className="text-sm text-red-400">{error}</p>}
          {lockedOut && !error && (
            <p className="text-sm text-amber-400">
              Demasiados intentos. Espera {Math.ceil(remainingMs / 1000)} segundos.
            </p>
          )}
          {signOutNotice && <p className="text-sm text-emerald-400">{signOutNotice}</p>}
        </div>

        <button type="submit" disabled={busy || lockedOut || pin.length === 0} className={PRIMARY_BTN}>
          {busy ? 'Comprobando...' : 'Desbloquear'}
        </button>
      </form>

      {canUsePasskey && (
        <button type="button" onClick={() => void handlePasskey()} disabled={busy} className={`${GHOST_BTN} mt-3`}>
          Usar passkey
        </button>
      )}

      <div className="mt-4 flex flex-col items-center gap-2">
        <button type="button" onClick={onForgotten} className={LINK_BTN}>
          He olvidado mi PIN
        </button>
        <button type="button" onClick={() => void handleSignOut()} disabled={busy} className={LINK_BTN}>
          Cerrar sesión de cuenta
        </button>
      </div>
    </div>
  );
}

function RecoverCard({ onBack, onReset }: { onBack: () => void; onReset: () => void }) {
  const auth = useAuth();
  const lock = useLock();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // En la pantalla bloqueada normalmente NO hay sesion viva (auth.status suele ser
  // 'signed-out': es precisamente por eso que esta bloqueada). La unica condicion real para
  // ofrecer recuperacion via cuenta es que exista una cuenta configurada en esta instalacion.
  const hasAccount = auth.status !== 'unconfigured';

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await lock.recoverPinViaAccountReauth(email, password, newPin, confirmPin);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  if (!hasAccount) {
    return (
      <div className={CARD}>
        <p className="text-sm text-slate-300">
          Esta instalacion no tiene una cuenta configurada. Sin cuenta no hay forma de recuperar un
          PIN olvidado: la única opción es restablecer los datos locales de este dispositivo.
        </p>
        <button type="button" onClick={onReset} className={`${GHOST_BTN} mt-4 border-red-800 text-red-300`}>
          Restablecer datos locales
        </button>
        <button type="button" onClick={onBack} className={`${LINK_BTN} mt-4 block`}>
          Volver
        </button>
      </div>
    );
  }

  return (
    <div className={CARD}>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
        Recuperar acceso con tu cuenta
      </h2>
      <p className="mt-2 text-sm text-slate-400">
        Confirma la contraseña de tu cuenta para elegir un PIN nuevo. Tus datos no se pierden.
      </p>
      <form onSubmit={handleSubmit} className="mt-4 space-y-4" noValidate>
        <div>
          <label className={LABEL} htmlFor="recover-email">
            Correo de tu cuenta
          </label>
          <input
            id="recover-email"
            type="email"
            autoComplete="email"
            required
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-500"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div>
          <label className={LABEL} htmlFor="recover-password">
            Contraseña de cuenta
          </label>
          <input
            id="recover-password"
            type="password"
            autoComplete="current-password"
            required
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-500"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div>
          <label className={LABEL} htmlFor="recover-new-pin">
            PIN nuevo (min. 6 digitos)
          </label>
          <input
            id="recover-new-pin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            required
            className={INPUT}
            value={newPin}
            onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
          />
        </div>
        <div>
          <label className={LABEL} htmlFor="recover-confirm-pin">
            Confirma el PIN nuevo
          </label>
          <input
            id="recover-confirm-pin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            required
            className={INPUT}
            value={confirmPin}
            onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
          />
        </div>
        <div role="alert">
          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>
        <button type="submit" disabled={busy} className={PRIMARY_BTN}>
          {busy ? 'Verificando...' : 'Establecer PIN nuevo'}
        </button>
      </form>
      <button type="button" onClick={onBack} className={`${LINK_BTN} mt-4 block`}>
        Volver
      </button>
    </div>
  );
}

function ResetLocalDataCard({ onBack }: { onBack: () => void }) {
  const lock = useLock();
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const CONFIRM_WORD = 'BORRAR';

  async function handleReset() {
    setError(null);
    setBusy(true);
    try {
      await lock.resetDeviceAndAllLocalData();
    } catch (err) {
      setError(messageOf(err));
      setBusy(false);
    }
  }

  return (
    <div className={`${CARD} border-red-900/60`}>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-red-400">
        Restablecer datos locales
      </h2>
      <p className="mt-2 text-sm text-slate-300">
        Esto borra de forma permanente TODOS los perfiles y datos guardados en este dispositivo.
        Es irreversible. Escribe <strong className="text-slate-100">{CONFIRM_WORD}</strong> para
        confirmar.
      </p>
      <label className={`${LABEL} mt-4`} htmlFor="reset-confirm">
        Confirmación
      </label>
      <input
        id="reset-confirm"
        type="text"
        className="mt-1 w-full rounded-lg border border-red-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-red-500"
        value={confirmText}
        onChange={(e) => setConfirmText(e.target.value)}
      />
      <div role="alert">
        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      </div>
      <button
        type="button"
        onClick={() => void handleReset()}
        disabled={busy || confirmText !== CONFIRM_WORD}
        className="mt-4 w-full rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-50"
      >
        {busy ? 'Borrando...' : 'Borrar todos los datos de este dispositivo'}
      </button>
      <button type="button" onClick={onBack} className={`${LINK_BTN} mt-4 block`}>
        Volver
      </button>
    </div>
  );
}

function messageOf(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return 'No se pudo completar la operación.';
}
