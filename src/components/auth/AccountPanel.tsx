// Panel de cuenta autenticada (ruta /cuenta). Cubre todos los estados de la fase 1:
//   - sin configuracion (modo local puro): explica el estado real, sin prometer sincronizacion;
//   - cargando: resolviendo la sesion;
//   - recuperacion: tras un enlace de recuperacion, pide nueva contrasena;
//   - con sesion: muestra el usuario, el estado de verificacion, cambio de contrasena y cierre;
//   - sin sesion: iniciar sesion / crear cuenta / recuperar contrasena.
//
// La cuenta es OPCIONAL (local-first). Ningun texto promete privacidad total ni coste cero
// perpetuo (invariante 14 de CLAUDE.md). Diseno coherente con el resto de la app.
import { useState, type FormEvent } from 'react';
import { useAuth } from '../../auth';

type SignedOutMode = 'signIn' | 'signUp' | 'recover';

const CARD = 'rounded-2xl border border-slate-800 bg-slate-900 p-5';
const LABEL = 'block text-sm font-medium text-slate-300';
const INPUT =
  'mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-500';
const PRIMARY_BTN =
  'w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60';
const LINK_BTN = 'text-sm font-medium text-indigo-400 hover:text-indigo-300';
const MIN_PASSWORD = 8;

export function AccountPanel() {
  const auth = useAuth();

  if (auth.status === 'loading') {
    return (
      <div className={CARD}>
        <p className="text-sm text-slate-400">Comprobando tu sesión...</p>
      </div>
    );
  }

  if (auth.status === 'unconfigured') {
    return <UnconfiguredNotice />;
  }

  if (auth.recoveryMode) {
    // Tras un enlace de recuperacion, la identidad ya se probo por correo: no se pide la
    // contrasena anterior (precisamente porque el usuario la ha olvidado).
    return <UpdatePasswordForm heading="Elige una nueva contraseña" requireCurrentPassword={false} />;
  }

  if (auth.status === 'signed-in') {
    return <SignedInPanel />;
  }

  return <SignedOutPanel />;
}

// --- Estado: sin configuracion (modo local) ---
function UnconfiguredNotice() {
  const { configError } = useAuth();
  return (
    <div className={CARD}>
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Cuenta</h3>
      {configError && (
        <div className="mt-3 rounded-lg border border-amber-800/60 bg-amber-950/30 p-3">
          <p className="text-sm text-amber-300">
            La configuración de la cuenta esta incompleta o es incorrecta, así que la app sigue en
            modo local. Detalle: {configError}
          </p>
        </div>
      )}
      <p className="mt-3 text-sm text-slate-300">
        Esta instalacion funciona en <strong className="text-slate-100">modo local</strong>: tus
        datos se guardan en este dispositivo. La cuenta con sincronización privada es opcional y
        aun no esta configurada aquí.
      </p>
      <p className="mt-2 text-sm text-slate-400">
        La sincronización, cuando se activa, guarda una copia privada protegida por tu cuenta y por
        seguridad a nivel de fila. No es privacidad total ni coste cero perpetuo: depende de los
        límites del proveedor. Para habilitarla, configura Supabase segun el README.
      </p>
    </div>
  );
}

// --- Estado: con sesion ---
function SignedInPanel() {
  const { user, emailPending, signOut, signOutOthers, resendConfirmation } = useAuth();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [othersBusy, setOthersBusy] = useState(false);
  const [othersNotice, setOthersNotice] = useState<string | null>(null);
  const [othersError, setOthersError] = useState<string | null>(null);

  async function handleSignOutOthers() {
    setOthersError(null);
    setOthersNotice(null);
    setOthersBusy(true);
    try {
      await signOutOthers();
      setOthersNotice('Se han cerrado las sesiones de tus otros dispositivos.');
    } catch (err) {
      setOthersError(messageOf(err));
    } finally {
      setOthersBusy(false);
    }
  }

  async function handleResend() {
    if (!user?.email) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await resendConfirmation(user.email);
      setNotice('Te hemos reenviado el correo de verificación.');
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className={CARD}>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Cuenta activa
        </h3>
        <p className="mt-3 text-sm text-slate-300">
          Sesión iniciada como{' '}
          <strong className="text-slate-100">{user?.email ?? 'usuario'}</strong>.
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Una cuenta identifica a la persona; tus perfiles financieros organizan los datos y pueden
          ser varios dentro de la misma cuenta.
        </p>

        {emailPending && (
          <div className="mt-4 rounded-lg border border-amber-800/60 bg-amber-950/30 p-3">
            <p className="text-sm text-amber-300">
              Tu correo aun no esta verificado. Revisa tu bandeja de entrada.
            </p>
            <button
              type="button"
              onClick={handleResend}
              disabled={busy}
              className="mt-2 text-sm font-medium text-amber-300 underline hover:text-amber-200 disabled:opacity-60"
            >
              Reenviar correo de verificación
            </button>
          </div>
        )}
        {notice && <p className="mt-3 text-sm text-emerald-400">{notice}</p>}
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void signOut()}
            className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800"
          >
            Cerrar sesión
          </button>
          <button
            type="button"
            onClick={() => void handleSignOutOthers()}
            disabled={othersBusy}
            className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-60"
          >
            {othersBusy ? 'Cerrando otras sesiones...' : 'Cerrar otras sesiones'}
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Cierra la sesión en tus demás dispositivos y pestañas, conservando esta.
        </p>
        {othersNotice && <p className="mt-2 text-sm text-emerald-400">{othersNotice}</p>}
        {othersError && <p className="mt-2 text-sm text-red-400">{othersError}</p>}
      </div>

      <UpdatePasswordForm heading="Cambiar contraseña" requireCurrentPassword />
    </div>
  );
}

// --- Estado: sin sesion (login / registro / recuperar) ---
function SignedOutPanel() {
  const [mode, setMode] = useState<SignedOutMode>('signIn');
  return (
    <div className={CARD}>
      <div className="flex gap-2">
        <TabButton active={mode === 'signIn'} onClick={() => setMode('signIn')}>
          Iniciar sesión
        </TabButton>
        <TabButton active={mode === 'signUp'} onClick={() => setMode('signUp')}>
          Crear cuenta
        </TabButton>
      </div>
      <div className="mt-5">
        {mode === 'signIn' && <SignInForm onRecover={() => setMode('recover')} />}
        {mode === 'signUp' && <SignUpForm />}
        {mode === 'recover' && <RecoverForm onBack={() => setMode('signIn')} />}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
        active ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-200',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function SignInForm({ onRecover }: { onRecover: () => void }) {
  const { signIn } = useAuth();
  const { form, submit } = useAuthForm(async () => {
    await signIn(form.email, form.password);
  });

  return (
    <form onSubmit={submit.handle} className="space-y-4" noValidate>
      <EmailField value={form.email} onChange={form.setEmail} />
      <PasswordField value={form.password} onChange={form.setPassword} label="Contraseña" />
      <FormFeedback error={submit.error} notice={null} />
      <button type="submit" disabled={submit.busy} className={PRIMARY_BTN}>
        {submit.busy ? 'Entrando...' : 'Iniciar sesión'}
      </button>
      <button type="button" onClick={onRecover} className={LINK_BTN}>
        He olvidado mi contraseña
      </button>
    </form>
  );
}

function SignUpForm() {
  const { signUp } = useAuth();
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const { form, submit } = useAuthForm(async () => {
    if (form.password.length < MIN_PASSWORD) {
      throw new Error(`La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`);
    }
    const result = await signUp(form.email, form.password);
    if (result.status === 'needs-confirmation') setPendingEmail(form.email);
  });

  if (pendingEmail) {
    return (
      <div className="rounded-lg border border-emerald-800/50 bg-emerald-950/20 p-4">
        <p className="text-sm text-emerald-300">
          Cuenta creada. Te hemos enviado un correo de verificación a{' '}
          <strong>{pendingEmail}</strong>. Confirma tu correo para completar el alta.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit.handle} className="space-y-4" noValidate>
      <EmailField value={form.email} onChange={form.setEmail} />
      <PasswordField
        value={form.password}
        onChange={form.setPassword}
        label={`Contraseña (min. ${MIN_PASSWORD})`}
        autoComplete="new-password"
      />
      <FormFeedback error={submit.error} notice={null} />
      <button type="submit" disabled={submit.busy} className={PRIMARY_BTN}>
        {submit.busy ? 'Creando...' : 'Crear cuenta'}
      </button>
      <p className="text-xs text-slate-500">
        Al crear una cuenta aceptas que se guarde una copia privada de tus datos sincronizados en el
        proveedor, protegida por tu sesión y por seguridad a nivel de fila.
      </p>
    </form>
  );
}

function RecoverForm({ onBack }: { onBack: () => void }) {
  const { requestPasswordReset } = useAuth();
  const [sent, setSent] = useState(false);
  const { form, submit } = useAuthForm(async () => {
    await requestPasswordReset(form.email);
    setSent(true);
  });

  if (sent) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-slate-300">
          Si existe una cuenta con ese correo, te hemos enviado instrucciones para recuperar la
          contraseña.
        </p>
        <button type="button" onClick={onBack} className={LINK_BTN}>
          Volver a iniciar sesión
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit.handle} className="space-y-4" noValidate>
      <p className="text-sm text-slate-400">
        Introduce tu correo y te enviaremos un enlace para restablecer la contraseña.
      </p>
      <EmailField value={form.email} onChange={form.setEmail} />
      <FormFeedback error={submit.error} notice={null} />
      <button type="submit" disabled={submit.busy} className={PRIMARY_BTN}>
        {submit.busy ? 'Enviando...' : 'Enviar enlace'}
      </button>
      <button type="button" onClick={onBack} className={LINK_BTN}>
        Volver
      </button>
    </form>
  );
}

function UpdatePasswordForm({
  heading,
  requireCurrentPassword = false,
}: {
  heading: string;
  // Reautenticacion para accion sensible (CLOUD_SYNC_SECURITY seccion 1): cuando la cuenta ya
  // esta en sesion (no viene de un enlace de recuperacion), se exige la contrasena actual antes
  // de aceptar la nueva.
  requireCurrentPassword?: boolean;
}) {
  const { updatePassword, reauthenticate } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handle(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (requireCurrentPassword && currentPassword.length === 0) {
      setError('Introduce tu contraseña actual.');
      return;
    }
    if (password.length < MIN_PASSWORD) {
      setError(`La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`);
      return;
    }
    if (password !== confirmPassword) {
      setError('Las dos contraseñas nuevas no coinciden.');
      return;
    }
    setBusy(true);
    try {
      if (requireCurrentPassword) {
        await reauthenticate(currentPassword);
      }
      await updatePassword(password);
      setDone(true);
      setCurrentPassword('');
      setPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handle} className={CARD + ' space-y-4'} noValidate>
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">{heading}</h3>
      {requireCurrentPassword && (
        <PasswordField
          value={currentPassword}
          onChange={setCurrentPassword}
          label="Contraseña actual"
          autoComplete="current-password"
        />
      )}
      <PasswordField
        value={password}
        onChange={setPassword}
        label={`Nueva contraseña (min. ${MIN_PASSWORD})`}
        autoComplete="new-password"
      />
      <PasswordField
        value={confirmPassword}
        onChange={setConfirmPassword}
        label="Confirma la nueva contraseña"
        autoComplete="new-password"
      />
      <FormFeedback error={error} notice={done ? 'Contraseña actualizada.' : null} />
      <button type="submit" disabled={busy} className={PRIMARY_BTN}>
        {busy ? 'Guardando...' : 'Guardar contraseña'}
      </button>
    </form>
  );
}

// --- Piezas reutilizables ---

function EmailField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className={LABEL} htmlFor="auth-email">
        Correo electronico
      </label>
      <input
        id="auth-email"
        type="email"
        autoComplete="email"
        required
        className={INPUT}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function PasswordField({
  value,
  onChange,
  label,
  autoComplete = 'current-password',
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  autoComplete?: string;
}) {
  // Id estable y valido en HTML (sin espacios ni parentesis) derivado del label, para que la
  // asociacion label<->input funcione correctamente (accesibilidad, movil).
  const fieldId = `auth-pwd-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <div>
      <label className={LABEL} htmlFor={fieldId}>
        {label}
      </label>
      <input
        id={fieldId}
        type="password"
        autoComplete={autoComplete}
        required
        className={INPUT}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function FormFeedback({ error, notice }: { error: string | null; notice: string | null }) {
  if (error) {
    return (
      <p className="text-sm text-red-400" role="alert">
        {error}
      </p>
    );
  }
  if (notice) {
    return <p className="text-sm text-emerald-400">{notice}</p>;
  }
  return null;
}

// Hook compartido de estado de formulario (email/password) + submit con carga y error.
function useAuthForm(action: () => Promise<void>) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handle(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await action();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  return {
    form: { email, setEmail, password, setPassword },
    submit: { busy, error, handle },
  };
}

function messageOf(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return 'No se pudo completar la operación. Intentalo de nuevo.';
}
