// Lectura y validacion de la configuracion de Supabase (sincronizacion OPCIONAL).
//
// Invariantes (CLAUDE.md 7 y CLOUD_SYNC_SECURITY.md seccion 5):
//   - El frontend SOLO usa `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY`.
//   - Prohibido cualquier `service_role`/secreto de servicio en el cliente.
//
// La app funciona sin cuenta y sin red: por eso la ausencia de configuracion NO es un
// error fatal, es un estado valido ("modo local"). La validacion solo falla de forma
// explicita cuando la configuracion esta a medias o es claramente invalida, para no
// arrancar en un estado ambiguo.

// Nombres de las variables de entorno. Fuente unica para docs y validacion.
export const SUPABASE_URL_ENV = 'VITE_SUPABASE_URL';
export const SUPABASE_PUBLISHABLE_KEY_ENV = 'VITE_SUPABASE_PUBLISHABLE_KEY';

// Prefijos de nombres de variable que jamas deben aparecer en el bundle del cliente.
// Se usa como barrera defensiva en desarrollo (ver assertNoServiceRoleInEnv).
const FORBIDDEN_ENV_SUBSTRINGS = ['SERVICE_ROLE', 'SERVICE_KEY', 'SECRET'] as const;

// Configuracion valida y completa de Supabase.
export interface SupabaseConfig {
  url: string;
  publishableKey: string;
}

// Resultado de resolver la configuracion:
//   - 'configured': ambos valores presentes y con forma valida -> se puede crear el cliente.
//   - 'unconfigured': ninguno presente -> modo local, sin cuenta. Estado normal, no error.
//   - 'invalid': configuracion a medias o mal formada -> se informa con un mensaje claro.
export type SupabaseConfigResult =
  | { status: 'configured'; config: SupabaseConfig }
  | { status: 'unconfigured' }
  | { status: 'invalid'; reason: string };

// Error de configuracion de Supabase. Sin errores silenciosos (invariante CLAUDE.md).
export class SupabaseConfigError extends Error {
  readonly code = 'SUPABASE_CONFIG_ERROR';
  constructor(message: string) {
    super(message);
    this.name = 'SupabaseConfigError';
  }
}

function normalize(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

// Comprueba que la URL tiene forma de endpoint https de Supabase (sin exigir el dominio
// exacto, para permitir self-hosting del propio usuario). No hace ninguna peticion de red.
function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname.length > 0;
  } catch {
    return false;
  }
}

// Resuelve la configuracion a partir de un objeto de entorno (por defecto import.meta.env).
// Es pura respecto al env que recibe: facilita tests deterministas sin tocar el entorno real.
export function resolveSupabaseConfig(
  env: Record<string, unknown> = import.meta.env as unknown as Record<string, unknown>,
): SupabaseConfigResult {
  const url = normalize(env[SUPABASE_URL_ENV]);
  const publishableKey = normalize(env[SUPABASE_PUBLISHABLE_KEY_ENV]);

  const anyPresent = url.length > 0 || publishableKey.length > 0;
  if (!anyPresent) {
    return { status: 'unconfigured' };
  }

  // A partir de aqui el usuario intento configurar Supabase: los errores se reportan.
  if (url.length === 0) {
    return {
      status: 'invalid',
      reason: `Falta ${SUPABASE_URL_ENV}. Define tambien la URL del proyecto, no solo la clave.`,
    };
  }
  if (publishableKey.length === 0) {
    return {
      status: 'invalid',
      reason: `Falta ${SUPABASE_PUBLISHABLE_KEY_ENV}. Usa la clave PUBLICABLE del proyecto (nunca service_role).`,
    };
  }
  if (!isValidUrl(url)) {
    return {
      status: 'invalid',
      reason: `${SUPABASE_URL_ENV} no es una URL https valida: "${url}".`,
    };
  }

  return { status: 'configured', config: { url, publishableKey } };
}

// Barrera defensiva: si por error se filtra una clave de servicio a las variables VITE_*
// (que Vite inyecta en el bundle del cliente), se aborta con un mensaje explicito en lugar
// de exponer el secreto. Solo revisa nombres, nunca imprime valores.
export function assertNoServiceRoleInEnv(
  env: Record<string, unknown> = import.meta.env as unknown as Record<string, unknown>,
): void {
  for (const key of Object.keys(env)) {
    if (!key.startsWith('VITE_')) continue;
    const upper = key.toUpperCase();
    if (FORBIDDEN_ENV_SUBSTRINGS.some((frag) => upper.includes(frag))) {
      throw new SupabaseConfigError(
        `La variable ${key} parece un secreto de servicio expuesto al cliente. ` +
          `El frontend solo puede usar la clave publicable. Elimina cualquier service_role/secret de las variables VITE_*.`,
      );
    }
  }
}
