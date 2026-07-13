import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSupabaseClient } from '../lib/supabase/client';
import {
  createWebAuthnService,
  isPlatformAuthenticatorAvailable,
  isWebAuthnSupported,
  webauthnService,
} from './webauthn';

// Construye un cliente Supabase simulado con solo el sub-API `auth.passkey*` que usa el
// servicio. Mismo patron que src/auth/authService.test.ts.
function makePasskeyClient(overrides: Partial<FakeAuth> = {}) {
  const base: FakeAuth = {
    registerPasskey: async () => ({
      data: { id: 'pk1', friendly_name: 'iCloud Keychain', created_at: '2026-01-01T00:00:00Z' },
      error: null,
    }),
    signInWithPasskey: async () => ({
      data: { session: { access_token: 't' }, user: { id: 'u1' } },
      error: null,
    }),
    passkey: {
      list: async () => ({ data: [], error: null }),
      update: async () => ({ data: null, error: null }),
      delete: async () => ({ data: null, error: null }),
    },
  };
  const auth = { ...base, ...overrides, passkey: { ...base.passkey, ...overrides.passkey } };
  return { auth } as unknown as AppSupabaseClient;
}

interface FakeAuth {
  registerPasskey: () => Promise<{ data: unknown; error: unknown }>;
  signInWithPasskey: () => Promise<{ data: unknown; error: unknown }>;
  passkey: {
    list: () => Promise<{ data: unknown; error: unknown }>;
    update: (args: unknown) => Promise<{ data: unknown; error: unknown }>;
    delete: (args: unknown) => Promise<{ data: unknown; error: unknown }>;
  };
}

const originalPublicKeyCredential = (
  window as unknown as { PublicKeyCredential?: unknown }
).PublicKeyCredential;

afterEach(() => {
  (window as unknown as { PublicKeyCredential?: unknown }).PublicKeyCredential =
    originalPublicKeyCredential;
});

describe('isWebAuthnSupported', () => {
  it('false cuando el navegador no expone PublicKeyCredential', () => {
    delete (window as unknown as { PublicKeyCredential?: unknown }).PublicKeyCredential;
    expect(isWebAuthnSupported()).toBe(false);
  });

  it('true cuando el navegador expone PublicKeyCredential', () => {
    (window as unknown as { PublicKeyCredential?: unknown }).PublicKeyCredential = class {};
    expect(isWebAuthnSupported()).toBe(true);
  });
});

describe('isPlatformAuthenticatorAvailable', () => {
  it('false sin soporte de WebAuthn (no se llama a ninguna API)', async () => {
    delete (window as unknown as { PublicKeyCredential?: unknown }).PublicKeyCredential;
    expect(await isPlatformAuthenticatorAvailable()).toBe(false);
  });

  it('refleja el resultado de isUserVerifyingPlatformAuthenticatorAvailable', async () => {
    (window as unknown as { PublicKeyCredential?: unknown }).PublicKeyCredential = {
      isUserVerifyingPlatformAuthenticatorAvailable: vi.fn().mockResolvedValue(true),
    };
    expect(await isPlatformAuthenticatorAvailable()).toBe(true);
  });

  it('false si la comprobacion del navegador falla', async () => {
    (window as unknown as { PublicKeyCredential?: unknown }).PublicKeyCredential = {
      isUserVerifyingPlatformAuthenticatorAvailable: vi.fn().mockRejectedValue(new Error('boom')),
    };
    expect(await isPlatformAuthenticatorAvailable()).toBe(false);
  });
});

describe('createWebAuthnService — registro y uso', () => {
  it('registerPasskey devuelve el resumen de la credencial nueva', async () => {
    const client = makePasskeyClient();
    const result = await createWebAuthnService(client).registerPasskey();
    expect(result).toEqual({
      id: 'pk1',
      friendlyName: 'iCloud Keychain',
      createdAt: '2026-01-01T00:00:00Z',
      lastUsedAt: null,
    });
  });

  it('signInWithPasskey devuelve true cuando hay sesion', async () => {
    const client = makePasskeyClient();
    expect(await createWebAuthnService(client).signInWithPasskey()).toBe(true);
  });

  it('listPasskeys mapea los campos snake_case a camelCase', async () => {
    const client = makePasskeyClient({
      passkey: {
        list: async () => ({
          data: [
            { id: 'pk1', friendly_name: 'Movil', created_at: '2026-01-01', last_used_at: '2026-02-01' },
          ],
          error: null,
        }),
        update: async () => ({ data: null, error: null }),
        delete: async () => ({ data: null, error: null }),
      },
    });
    const result = await createWebAuthnService(client).listPasskeys();
    expect(result).toEqual([
      { id: 'pk1', friendlyName: 'Movil', createdAt: '2026-01-01', lastUsedAt: '2026-02-01' },
    ]);
  });

  it('renamePasskey y deletePasskey delegan en el cliente sin lanzar si no hay error', async () => {
    const client = makePasskeyClient();
    await expect(createWebAuthnService(client).renamePasskey('pk1', 'Portatil')).resolves.toBeUndefined();
    await expect(createWebAuthnService(client).deletePasskey('pk1')).resolves.toBeUndefined();
  });
});

describe('createWebAuthnService — mapeo de errores', () => {
  it('cancelacion del usuario (ERROR_CEREMONY_ABORTED) -> WEBAUTHN_CANCELLED', async () => {
    const client = makePasskeyClient({
      registerPasskey: async () => ({ data: null, error: { code: 'ERROR_CEREMONY_ABORTED' } }),
    });
    await expect(createWebAuthnService(client).registerPasskey()).rejects.toMatchObject({
      code: 'WEBAUTHN_CANCELLED',
    });
  });

  it('NotAllowedError del navegador -> WEBAUTHN_CANCELLED', async () => {
    const client = makePasskeyClient({
      signInWithPasskey: async () => ({
        data: null,
        error: { name: 'NotAllowedError', message: 'The operation was cancelled.' },
      }),
    });
    await expect(createWebAuthnService(client).signInWithPasskey()).rejects.toMatchObject({
      code: 'WEBAUTHN_CANCELLED',
    });
  });

  it('credencial no reconocida -> WEBAUTHN_NOT_REGISTERED', async () => {
    const client = makePasskeyClient({
      signInWithPasskey: async () => ({
        data: null,
        error: { code: 'webauthn_credential_not_found' },
      }),
    });
    await expect(createWebAuthnService(client).signInWithPasskey()).rejects.toMatchObject({
      code: 'WEBAUTHN_NOT_REGISTERED',
    });
  });

  it('autenticador ya registrado -> WEBAUTHN_ALREADY_REGISTERED', async () => {
    const client = makePasskeyClient({
      registerPasskey: async () => ({ data: null, error: { code: 'webauthn_credential_exists' } }),
    });
    await expect(createWebAuthnService(client).registerPasskey()).rejects.toMatchObject({
      code: 'WEBAUTHN_ALREADY_REGISTERED',
    });
  });

  it('error no clasificado -> WEBAUTHN_UNKNOWN', async () => {
    const client = makePasskeyClient({
      registerPasskey: async () => ({ data: null, error: { message: 'algo raro' } }),
    });
    await expect(createWebAuthnService(client).registerPasskey()).rejects.toMatchObject({
      code: 'WEBAUTHN_UNKNOWN',
    });
  });
});

describe('webauthnService (app real) — flag desactivado', () => {
  it('WEBAUTHN_DISABLED sin tocar el navegador cuando VITE_ENABLE_PASSKEYS esta desactivado', async () => {
    // Sin configuracion de Supabase en el entorno de test: isPasskeysFeatureEnabled() es false.
    const spy = vi.fn();
    (window as unknown as { PublicKeyCredential?: unknown }).PublicKeyCredential = spy;
    await expect(webauthnService.registerPasskey()).rejects.toMatchObject({
      code: 'WEBAUTHN_DISABLED',
    });
    expect(spy).not.toHaveBeenCalled();
  });
});
