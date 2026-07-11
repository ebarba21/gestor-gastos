import { describe, it, expect, vi } from 'vitest';
import type { AppSupabaseClient } from '../lib/supabase/client';
import { createAuthService } from './authService';
import { AuthError } from './errors';

// Construye un cliente Supabase simulado con solo el sub-API `auth` que usa el servicio.
function makeAuthClient(overrides: Partial<FakeAuth> = {}) {
  const base: FakeAuth = {
    signUp: async () => ({ data: { user: fakeUser(), session: null }, error: null }),
    signInWithPassword: async () => ({
      data: { user: fakeUser(), session: fakeSession() },
      error: null,
    }),
    signOut: async () => ({ error: null }),
    getSession: async () => ({ data: { session: fakeSession() }, error: null }),
    getUser: async () => ({ data: { user: fakeUser() }, error: null }),
    resetPasswordForEmail: async () => ({ error: null }),
    updateUser: async () => ({ data: { user: fakeUser() }, error: null }),
    resend: async () => ({ error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
  };
  const auth = { ...base, ...overrides };
  return { client: { auth } as unknown as AppSupabaseClient, auth };
}

interface FakeAuth {
  signUp: (args: unknown) => Promise<{ data: { user: unknown; session: unknown }; error: unknown }>;
  signInWithPassword: (
    args: unknown,
  ) => Promise<{ data: { user: unknown; session: unknown }; error: unknown }>;
  signOut: () => Promise<{ error: unknown }>;
  getSession: () => Promise<{ data: { session: unknown }; error: unknown }>;
  getUser: () => Promise<{ data: { user: unknown }; error: unknown }>;
  resetPasswordForEmail: (email: string, opts?: unknown) => Promise<{ error: unknown }>;
  updateUser: (args: unknown) => Promise<{ data: { user: unknown }; error: unknown }>;
  resend: (args: unknown) => Promise<{ error: unknown }>;
  onAuthStateChange: (
    cb: (event: string, session: unknown) => void,
  ) => { data: { subscription: { unsubscribe: () => void } } };
}

const fakeUser = () => ({ id: 'u1', email: 'a@test.local', email_confirmed_at: '2026-01-01' });
const fakeSession = () => ({ access_token: 't', user: fakeUser() });

describe('createAuthService', () => {
  it('signUp devuelve needs-confirmation cuando no hay sesion inmediata', async () => {
    const { client } = makeAuthClient({
      signUp: async () => ({ data: { user: fakeUser(), session: null }, error: null }),
    });
    const result = await createAuthService(client).signUp('a@test.local', 'password123');
    expect(result.status).toBe('needs-confirmation');
  });

  it('signUp devuelve signed-in cuando hay sesion inmediata', async () => {
    const { client } = makeAuthClient({
      signUp: async () => ({ data: { user: fakeUser(), session: fakeSession() }, error: null }),
    });
    const result = await createAuthService(client).signUp('a@test.local', 'password123');
    expect(result.status).toBe('signed-in');
  });

  it('signIn devuelve la sesion en caso correcto', async () => {
    const { client } = makeAuthClient();
    const session = await createAuthService(client).signIn('a@test.local', 'password123');
    expect(session).toBeTruthy();
  });

  it('signIn traduce credenciales invalidas a AuthError sin filtrar detalles', async () => {
    const { client } = makeAuthClient({
      signInWithPassword: async () => ({
        data: { user: null, session: null },
        error: { message: 'Invalid login credentials', status: 400 },
      }),
    });
    await expect(createAuthService(client).signIn('a@test.local', 'bad')).rejects.toMatchObject({
      code: 'AUTH_INVALID_CREDENTIALS',
    });
  });

  it('signIn traduce email sin confirmar', async () => {
    const { client } = makeAuthClient({
      signInWithPassword: async () => ({
        data: { user: null, session: null },
        error: { message: 'Email not confirmed', status: 400 },
      }),
    });
    await expect(createAuthService(client).signIn('a@test.local', 'x')).rejects.toMatchObject({
      code: 'AUTH_EMAIL_NOT_CONFIRMED',
    });
  });

  it('getSession restaura la sesion existente', async () => {
    const { client } = makeAuthClient();
    const session = await createAuthService(client).getSession();
    expect(session).toBeTruthy();
  });

  it('signOut resuelve sin error', async () => {
    const { client } = makeAuthClient();
    await expect(createAuthService(client).signOut()).resolves.toBeUndefined();
  });

  it('updatePassword devuelve el usuario actualizado', async () => {
    const { client } = makeAuthClient();
    const user = await createAuthService(client).updatePassword('newpassword1');
    expect(user).toBeTruthy();
  });

  it('requestPasswordReset NO revela si la cuenta existe (traga error generico)', async () => {
    const { client } = makeAuthClient({
      resetPasswordForEmail: async () => ({
        error: { message: 'User not found', status: 400 },
      }),
    });
    // No debe lanzar por un error generico: anti-enumeracion.
    await expect(
      createAuthService(client).requestPasswordReset('a@test.local'),
    ).resolves.toBeUndefined();
  });

  it('requestPasswordReset SI propaga errores de red o limite', async () => {
    const { client } = makeAuthClient({
      resetPasswordForEmail: async () => ({ error: { message: 'rate limit', status: 429 } }),
    });
    await expect(
      createAuthService(client).requestPasswordReset('a@test.local'),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it('onAuthStateChange propaga sesion y evento, y permite desuscribirse', () => {
    const unsubscribe = vi.fn();
    let captured: { session: unknown; event: string } | null = null;
    const { client } = makeAuthClient({
      onAuthStateChange: (cb) => {
        cb('PASSWORD_RECOVERY', fakeSession());
        return { data: { subscription: { unsubscribe } } };
      },
    });
    const off = createAuthService(client).onAuthStateChange((session, event) => {
      captured = { session, event };
    });
    expect(captured).not.toBeNull();
    expect(captured!.event).toBe('PASSWORD_RECOVERY');
    off();
    expect(unsubscribe).toHaveBeenCalled();
  });
});
