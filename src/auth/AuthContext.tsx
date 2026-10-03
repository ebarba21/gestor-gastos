// Contexto de autenticacion de CUENTA (opcional). Fuente unica del estado de sesion en la UI.
//
// La app es local-first: sin cuenta funciona por completo. Este contexto nunca bloquea el uso
// local; solo habilita las funciones de sincronizacion cuando hay sesion. Ver ARCHITECTURE
// seccion 4 (la cuenta es OPCIONAL) y CLOUD_SYNC_SECURITY seccion 3.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { resolveSupabaseConfig } from '../lib/supabase';
import { authService, type SignUpResult } from './authService';

// 'loading'      : resolviendo la sesion inicial.
// 'unconfigured' : Supabase no configurado en esta instalacion (modo local puro).
// 'signed-out'   : configurado, sin sesion.
// 'signed-in'    : sesion activa.
export type AuthStatus = 'loading' | 'unconfigured' | 'signed-out' | 'signed-in';

interface AuthContextValue {
  status: AuthStatus;
  session: Session | null;
  user: User | null;
  // Motivo cuando la configuracion de Supabase esta a medias o mal formada. Se expone en la UI
  // en vez de caer en silencio a "modo local" (sin errores silenciosos, invariante CLAUDE.md).
  configError: string | null;
  // true cuando hay usuario pero el email aun no esta verificado.
  emailPending: boolean;
  // true tras seguir un enlace de recuperacion: la UI debe pedir nueva contrasena.
  recoveryMode: boolean;
  // Devuelve la Session (no solo void): la recuperacion de PIN (LockContext) necesita el
  // user.id resultante para verificar que la cuenta reautenticada es dueña de datos de este
  // dispositivo, no solo que las credenciales son validas para alguna cuenta del proyecto.
  signIn: (email: string, password: string) => Promise<Session>;
  signUp: (email: string, password: string) => Promise<SignUpResult>;
  signOut: () => Promise<void>;
  // Cierra las sesiones de otros dispositivos, conservando la actual (CLOUD_SYNC_SECURITY 1).
  signOutOthers: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  updatePassword: (newPassword: string) => Promise<void>;
  // Reautenticacion para acciones sensibles (cambio de contrasena, recuperacion de PIN).
  reauthenticate: (password: string) => Promise<void>;
  resendConfirmation: (email: string) => Promise<void>;
  clearRecoveryMode: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// URL a la que Supabase redirige tras verificar email o recuperar contrasena. Debe estar
// registrada en el Dashboard (Authentication > URL configuration) y en supabase/config.toml.
function redirectUrl(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  // Respeta la ruta base de publicacion (p. ej. /gestor-gastos/ en GitHub Pages).
  return `${window.location.origin}${import.meta.env.BASE_URL}cuenta`;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [session, setSession] = useState<Session | null>(null);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const config = resolveSupabaseConfig();
    if (config.status === 'unconfigured') {
      // Sin configuracion: modo local puro. Estado normal, no error.
      setStatus('unconfigured');
      return;
    }
    if (config.status === 'invalid') {
      // Configuracion a medias o mal formada: se informa en vez de caer en silencio a local.
      setConfigError(config.reason);
      setStatus('unconfigured');
      return;
    }
    let cancelled = false;

    // Restauracion de sesion al arrancar.
    authService
      .getSession()
      .then((current) => {
        if (cancelled) return;
        setSession(current);
        setStatus(current ? 'signed-in' : 'signed-out');
      })
      .catch(() => {
        if (cancelled) return;
        setStatus('signed-out');
      });

    // Suscripcion a cambios (login, logout, refresh, recuperacion de contrasena).
    unsubscribeRef.current = authService.onAuthStateChange((next, event) => {
      if (cancelled) return;
      if (event === 'PASSWORD_RECOVERY') setRecoveryMode(true);
      setSession(next);
      setStatus(next ? 'signed-in' : 'signed-out');
    });

    return () => {
      cancelled = true;
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const next = await authService.signIn(email, password);
    setSession(next);
    setStatus('signed-in');
    return next;
  }, []);

  const signUp = useCallback(
    (email: string, password: string) => authService.signUp(email, password, redirectUrl()),
    [],
  );

  const signOut = useCallback(async () => {
    await authService.signOut();
    setSession(null);
    setStatus('signed-out');
    setRecoveryMode(false);
  }, []);

  const signOutOthers = useCallback(async () => {
    await authService.signOutOthers();
  }, []);

  const reauthenticate = useCallback(async (password: string) => {
    const next = await authService.reauthenticate(password);
    setSession(next);
    setStatus('signed-in');
  }, []);

  const requestPasswordReset = useCallback(
    (email: string) => authService.requestPasswordReset(email, redirectUrl()),
    [],
  );

  const updatePassword = useCallback(async (newPassword: string) => {
    await authService.updatePassword(newPassword);
    setRecoveryMode(false);
  }, []);

  const resendConfirmation = useCallback(
    (email: string) => authService.resendConfirmation(email, redirectUrl()),
    [],
  );

  const clearRecoveryMode = useCallback(() => setRecoveryMode(false), []);

  const user = session?.user ?? null;
  const emailPending = Boolean(user && !user.email_confirmed_at);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      session,
      user,
      configError,
      emailPending,
      recoveryMode,
      signIn,
      signUp,
      signOut,
      signOutOthers,
      requestPasswordReset,
      updatePassword,
      reauthenticate,
      resendConfirmation,
      clearRecoveryMode,
    }),
    [
      status,
      session,
      user,
      configError,
      emailPending,
      recoveryMode,
      signIn,
      signUp,
      signOut,
      signOutOthers,
      requestPasswordReset,
      updatePassword,
      reauthenticate,
      resendConfirmation,
      clearRecoveryMode,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth debe usarse dentro de <AuthProvider>.');
  }
  return ctx;
}

// Variante tolerante: devuelve null si no hay AuthProvider (p. ej. tests que montan solo una parte
// del arbol, o el modo local puro). La usa ProfileProvider para acotar la lista de perfiles al
// propietario de la sesion sin exigir que AuthProvider este montado.
export function useAuthOptional(): AuthContextValue | null {
  return useContext(AuthContext);
}
