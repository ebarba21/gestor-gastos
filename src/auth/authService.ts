// Servicio de autenticacion: adaptador fino sobre Supabase Auth (CLOUD_SYNC_SECURITY seccion 3).
//
// Distincion clave (invariante de producto): una CUENTA autenticada identifica a la persona;
// un PERFIL financiero organiza datos dentro de la app. Este servicio solo gestiona la cuenta.
//
// La app funciona en modo LOCAL sin cuenta: por eso el servicio se puede consultar aunque
// Supabase no este configurado (isConfigured() = false) y las operaciones lanzan AuthError con
// codigo 'AUTH_NOT_CONFIGURED' en ese caso, nunca un fallo opaco.
//
// `createAuthService(client)` es el nucleo puro y testeable (se le inyecta un cliente).
// `authService` resuelve el cliente configurado de forma perezosa para la app real.

import type { Session, User } from '@supabase/supabase-js';
import type { AppSupabaseClient } from '../lib/supabase/client';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabase/client';
import { AuthError, toAuthError } from './errors';

export interface SignUpResult {
  // 'signed-in': hay sesion inmediata (confirmacion de email desactivada).
  // 'needs-confirmation': cuenta creada, pendiente de verificar el correo.
  status: 'signed-in' | 'needs-confirmation';
  user: User | null;
}

export interface AuthService {
  signUp(email: string, password: string, emailRedirectTo?: string): Promise<SignUpResult>;
  signIn(email: string, password: string): Promise<Session>;
  signOut(): Promise<void>;
  getSession(): Promise<Session | null>;
  getUser(): Promise<User | null>;
  requestPasswordReset(email: string, redirectTo?: string): Promise<void>;
  updatePassword(newPassword: string): Promise<User>;
  resendConfirmation(email: string, emailRedirectTo?: string): Promise<void>;
  // El evento se propaga para poder detectar PASSWORD_RECOVERY (enlace de recuperacion) y
  // llevar al usuario a la pantalla de cambio de contrasena. Ver AuthContext.
  onAuthStateChange(callback: (session: Session | null, event: AuthChangeEvent) => void): () => void;
}

export type AuthChangeEvent =
  | 'INITIAL_SESSION'
  | 'SIGNED_IN'
  | 'SIGNED_OUT'
  | 'TOKEN_REFRESHED'
  | 'USER_UPDATED'
  | 'PASSWORD_RECOVERY';

// Nucleo puro sobre un cliente concreto. Testeable inyectando un cliente simulado.
export function createAuthService(client: AppSupabaseClient): AuthService {
  return {
    async signUp(email, password, emailRedirectTo) {
      const { data, error } = await client.auth.signUp({
        email,
        password,
        options: emailRedirectTo ? { emailRedirectTo } : undefined,
      });
      if (error) throw toAuthError(error);
      // Con verificacion de email activada, session es null hasta confirmar.
      return {
        status: data.session ? 'signed-in' : 'needs-confirmation',
        user: data.user,
      };
    },

    async signIn(email, password) {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw toAuthError(error);
      if (!data.session) {
        throw new AuthError('AUTH_UNKNOWN', 'No se pudo iniciar sesion.');
      }
      return data.session;
    },

    async signOut() {
      const { error } = await client.auth.signOut();
      if (error) throw toAuthError(error);
    },

    async getSession() {
      const { data, error } = await client.auth.getSession();
      if (error) throw toAuthError(error);
      return data.session;
    },

    async getUser() {
      const { data, error } = await client.auth.getUser();
      if (error) {
        // getUser sin sesion valida devuelve error; en modo "sin sesion" no es un fallo real.
        return null;
      }
      return data.user;
    },

    async requestPasswordReset(email, redirectTo) {
      const { error } = await client.auth.resetPasswordForEmail(
        email,
        redirectTo ? { redirectTo } : undefined,
      );
      // No se distingue si el correo existe o no (anti-enumeracion): salvo error de red/limite,
      // se trata como exito para no revelar la existencia de la cuenta.
      if (error) {
        const mapped = toAuthError(error);
        if (mapped.code === 'AUTH_NETWORK' || mapped.code === 'AUTH_RATE_LIMITED') throw mapped;
      }
    },

    async updatePassword(newPassword) {
      const { data, error } = await client.auth.updateUser({ password: newPassword });
      if (error) throw toAuthError(error);
      if (!data.user) throw new AuthError('AUTH_UNKNOWN', 'No se pudo actualizar la contrasena.');
      return data.user;
    },

    async resendConfirmation(email, emailRedirectTo) {
      const { error } = await client.auth.resend({
        type: 'signup',
        email,
        options: emailRedirectTo ? { emailRedirectTo } : undefined,
      });
      if (error) throw toAuthError(error);
    },

    onAuthStateChange(callback) {
      const { data } = client.auth.onAuthStateChange((event, session) => {
        callback(session, event as AuthChangeEvent);
      });
      return () => data.subscription.unsubscribe();
    },
  };
}

// Resuelve el cliente configurado o lanza AuthError('AUTH_NOT_CONFIGURED'). La UI debe
// comprobar isConfigured() antes de invocar operaciones para mostrar el estado "sin cuenta".
function requireClient(): AppSupabaseClient {
  const client = getSupabaseClient();
  if (!client) {
    throw new AuthError(
      'AUTH_NOT_CONFIGURED',
      'La sincronizacion con cuenta no esta configurada en esta instalacion.',
    );
  }
  return client;
}

// Servicio para la app real: resuelve el cliente configurado en cada llamada.
export const authService: AuthService & { isConfigured(): boolean } = {
  isConfigured: () => isSupabaseConfigured(),
  signUp: (email, password, redirect) => createAuthService(requireClient()).signUp(email, password, redirect),
  signIn: (email, password) => createAuthService(requireClient()).signIn(email, password),
  signOut: () => createAuthService(requireClient()).signOut(),
  getSession: () => createAuthService(requireClient()).getSession(),
  getUser: () => createAuthService(requireClient()).getUser(),
  requestPasswordReset: (email, redirect) =>
    createAuthService(requireClient()).requestPasswordReset(email, redirect),
  updatePassword: (pwd) => createAuthService(requireClient()).updatePassword(pwd),
  resendConfirmation: (email, redirect) =>
    createAuthService(requireClient()).resendConfirmation(email, redirect),
  onAuthStateChange: (cb) => createAuthService(requireClient()).onAuthStateChange(cb),
};
