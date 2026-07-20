// Cliente Supabase (singleton perezoso). Persistencia remota privada OPCIONAL.
//
// Reglas:
//   - NUNCA lanza en tiempo de import: si no hay configuracion, la app sigue en modo local.
//   - Se crea una unica instancia y se reutiliza (evita multiples canales de auth).
//   - Solo la clave publicable llega aqui (ver env.ts, invariante 7 de CLAUDE.md).
//   - El almacenamiento de sesion (fase 3) pasa SIEMPRE por encryptedSessionStorage: sin PIN
//     activo se comporta igual que el storage por defecto del SDK (localStorage); con PIN
//     activo, cifra (ver src/security/encryptedSessionStorage.ts). El modo lo decide el estado
//     interno de ese modulo, no esta configuracion.
//   - Passkeys (WebAuthn) son un opt-in EXPERIMENTAL del propio SDK: solo se activa si
//     VITE_ENABLE_PASSKEYS=true (ver CLOUD_SYNC_SECURITY seccion 11 y env.ts).
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
import {
  assertNoServiceRoleInEnv,
  resolveSupabaseConfig,
  SupabaseConfigError,
  type SupabaseConfig,
} from './env';
import { encryptedSessionStorage } from '../../security/encryptedSessionStorage';

export type AppSupabaseClient = SupabaseClient<Database>;

let cached: AppSupabaseClient | null = null;
let cachedKey: string | null = null;

// Crea (o reutiliza) el cliente para una configuracion dada. Exportado para tests que
// inyectan una configuracion concreta sin depender del entorno real.
export function createSupabaseClient(config: SupabaseConfig): AppSupabaseClient {
  const key = `${config.url}::${config.publishableKey}::${config.enablePasskeys}`;
  if (cached && cachedKey === key) return cached;
  cached = createClient<Database>(config.url, config.publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: encryptedSessionStorage,
      ...(config.enablePasskeys ? { experimental: { passkey: true } } : {}),
    },
  });
  cachedKey = key;
  return cached;
}

// Devuelve el cliente si Supabase esta configurado; `null` en modo local (sin cuenta).
// Nunca lanza por falta de configuracion; si la configuracion esta a medias/mal formada,
// si lanza SupabaseConfigError con un mensaje claro (no se arranca en estado ambiguo).
export function getSupabaseClient(): AppSupabaseClient | null {
  assertNoServiceRoleInEnv();
  const result = resolveSupabaseConfig();
  if (result.status === 'unconfigured') return null;
  if (result.status === 'invalid') {
    throw new SupabaseConfigError(`Configuracion de Supabase invalida: ${result.reason}`);
  }
  return createSupabaseClient(result.config);
}

// Indica si la sincronizacion remota esta disponible (configuracion completa y valida).
export function isSupabaseConfigured(): boolean {
  return resolveSupabaseConfig().status === 'configured';
}

// Solo para tests: limpia el singleton entre casos.
export function resetSupabaseClientForTests(): void {
  cached = null;
  cachedKey = null;
}
