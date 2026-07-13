// Passkeys (WebAuthn) via la API oficial y experimental de Supabase Auth (CLOUD_SYNC_SECURITY
// seccion 11). Solo envuelve `supabase.auth.registerPasskey/signInWithPasskey/passkey.*`; no se
// llama a `navigator.credentials` directamente ni se construye ningun servidor WebAuthn propio
// (el SDK gestiona la ceremonia completa). Gateado por VITE_ENABLE_PASSKEYS (env.ts): si esta
// desactivado, ninguna funcion de aqui toca el SDK ni `navigator.credentials`.
//
// Mismo patron que src/auth/authService.ts: un nucleo puro inyectable (createWebAuthnService,
// testeable con un cliente simulado) y un servicio para la app real que resuelve el cliente
// configurado en cada llamada.
//
// Terminologia (invariante del enunciado): la UI dice "passkey" cuando el sistema puede pedir
// biometria, PIN del dispositivo o llave fisica. Solo dice "biometria" cuando
// isPlatformAuthenticatorAvailable() es true, y aun asi aclara que la app nunca recibe esos
// datos (los gestiona el sistema operativo/autenticador).
import type { AppSupabaseClient } from '../lib/supabase/client';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabase/client';
import { resolveSupabaseConfig } from '../lib/supabase/env';
import { SecurityError, type SecurityErrorCode } from './errors';

export interface PasskeySummary {
  id: string;
  friendlyName: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface WebAuthnService {
  registerPasskey(): Promise<PasskeySummary>;
  signInWithPasskey(): Promise<boolean>;
  listPasskeys(): Promise<PasskeySummary[]>;
  renamePasskey(passkeyId: string, friendlyName: string): Promise<void>;
  deletePasskey(passkeyId: string): Promise<void>;
}

export function isPasskeysFeatureEnabled(): boolean {
  const result = resolveSupabaseConfig();
  return result.status === 'configured' && result.config.enablePasskeys;
}

export function isWebAuthnSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.PublicKeyCredential !== 'undefined';
}

// true solo si el navegador confirma un autenticador de PLATAFORMA disponible (Face ID, Touch
// ID, Windows Hello, huella del movil...). Es la unica condicion bajo la que la UI puede usar la
// palabra "biometria"; en cualquier otro caso (llave fisica, gestor de contrasenas) se dice
// "passkey" a secas.
export async function isPlatformAuthenticatorAvailable(): Promise<boolean> {
  if (!isWebAuthnSupported()) return false;
  try {
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

function toSecurityError(error: unknown): SecurityError {
  if (error instanceof SecurityError) return error;
  const code = (error as { code?: string } | null)?.code ?? '';
  const name = (error as { name?: string } | null)?.name ?? '';

  const map: Record<string, SecurityErrorCode> = {
    ERROR_CEREMONY_ABORTED: 'WEBAUTHN_CANCELLED',
    passkey_disabled: 'WEBAUTHN_DISABLED',
    webauthn_credential_not_found: 'WEBAUTHN_NOT_REGISTERED',
    webauthn_credential_exists: 'WEBAUTHN_ALREADY_REGISTERED',
  };
  const mapped = map[code];
  const MESSAGES: Record<SecurityErrorCode, string> = {
    WEBAUTHN_CANCELLED: 'Has cancelado la verificacion del passkey.',
    WEBAUTHN_NOT_REGISTERED: 'Esa credencial no esta registrada.',
    WEBAUTHN_ALREADY_REGISTERED: 'Este autenticador ya tiene un passkey registrado.',
    WEBAUTHN_DISABLED: 'Los passkeys no estan activados en esta instalacion.',
  } as Record<SecurityErrorCode, string>;
  if (mapped) return new SecurityError(mapped, MESSAGES[mapped]);

  // NotAllowedError es el error DOM estandar cuando el usuario cancela el dialogo del
  // autenticador o este expira; el SDK lo puede propagar tal cual en vez de envolverlo.
  if (name === 'NotAllowedError') {
    return new SecurityError('WEBAUTHN_CANCELLED', 'Has cancelado la verificacion del passkey.');
  }
  return new SecurityError('WEBAUTHN_UNKNOWN', 'No se pudo completar la operacion con el passkey.');
}

// Nucleo puro sobre un cliente concreto (ya configurado con auth.experimental.passkey: true).
// No comprueba el feature flag ni el soporte del navegador: eso es responsabilidad del llamante
// (ver el servicio de mas abajo), para que este nucleo se pueda testear de forma aislada.
export function createWebAuthnService(client: AppSupabaseClient): WebAuthnService {
  return {
    async registerPasskey() {
      const { data, error } = await client.auth.registerPasskey();
      if (error) throw toSecurityError(error);
      if (!data) throw new SecurityError('WEBAUTHN_UNKNOWN', 'No se pudo registrar el passkey.');
      return {
        id: data.id,
        friendlyName: data.friendly_name ?? null,
        createdAt: data.created_at,
        lastUsedAt: null,
      };
    },

    async signInWithPasskey() {
      const { data, error } = await client.auth.signInWithPasskey();
      if (error) throw toSecurityError(error);
      return Boolean(data?.session);
    },

    async listPasskeys() {
      const { data, error } = await client.auth.passkey.list();
      if (error) throw toSecurityError(error);
      return (data ?? []).map((item) => ({
        id: item.id,
        friendlyName: item.friendly_name ?? null,
        createdAt: item.created_at,
        lastUsedAt: item.last_used_at ?? null,
      }));
    },

    async renamePasskey(passkeyId, friendlyName) {
      const { error } = await client.auth.passkey.update({ passkeyId, friendlyName });
      if (error) throw toSecurityError(error);
    },

    async deletePasskey(passkeyId) {
      const { error } = await client.auth.passkey.delete({ passkeyId });
      if (error) throw toSecurityError(error);
    },
  };
}

// Resuelve el nucleo sobre el cliente real, comprobando ANTES el feature flag y el soporte del
// navegador (sin flag/soporte, no se toca el SDK ni navigator.credentials en absoluto).
function requireService(): WebAuthnService {
  if (!isPasskeysFeatureEnabled()) {
    throw new SecurityError('WEBAUTHN_DISABLED', 'Los passkeys no estan activados en esta instalacion.');
  }
  if (!isWebAuthnSupported()) {
    throw new SecurityError('WEBAUTHN_UNSUPPORTED', 'Este navegador no soporta passkeys (WebAuthn).');
  }
  const client = getSupabaseClient();
  if (!client || !isSupabaseConfigured()) {
    throw new SecurityError(
      'WEBAUTHN_DISABLED',
      'Los passkeys requieren una cuenta configurada en esta instalacion.',
    );
  }
  return createWebAuthnService(client);
}

// Servicio para la app real: resuelve el nucleo (con las comprobaciones previas) en cada
// llamada. Todas marcadas `async` a proposito: si requireService() lanza de forma sincrona (p.
// ej. WEBAUTHN_DISABLED), debe llegar como promesa rechazada, no como excepcion sincrona.
export const webauthnService: WebAuthnService = {
  registerPasskey: async () => requireService().registerPasskey(),
  signInWithPasskey: async () => requireService().signInWithPasskey(),
  listPasskeys: async () => requireService().listPasskeys(),
  renamePasskey: async (id, name) => requireService().renamePasskey(id, name),
  deletePasskey: async (id) => requireService().deletePasskey(id),
};
