// Errores de autenticacion de dominio. Traducen los errores de Supabase Auth a mensajes
// cortos y redactados: NO se revela innecesariamente si una cuenta existe (CLOUD_SYNC_SECURITY
// seccion 3 y 12). Sin errores silenciosos (invariante CLAUDE.md).

export type AuthErrorCode =
  | 'AUTH_NOT_CONFIGURED' // Supabase no configurado: modo local.
  | 'AUTH_INVALID_CREDENTIALS' // Email/contrasena incorrectos (mensaje generico).
  | 'AUTH_EMAIL_NOT_CONFIRMED' // Falta verificar el email.
  | 'AUTH_WEAK_PASSWORD' // Contrasena que no cumple los requisitos.
  | 'AUTH_RATE_LIMITED' // Demasiados intentos.
  | 'AUTH_NETWORK' // Sin conexion con el servidor.
  | 'AUTH_UNKNOWN';

export class AuthError extends Error {
  readonly code: AuthErrorCode;
  constructor(code: AuthErrorCode, message: string) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

interface SupabaseAuthLikeError {
  message?: string | null;
  code?: string | null;
  status?: number | null;
}

function isAuthLike(value: unknown): value is SupabaseAuthLikeError {
  return typeof value === 'object' && value !== null && 'message' in value;
}

// Traduce un error de Supabase Auth a AuthError. Los mensajes son deliberadamente genericos
// para no facilitar la enumeracion de cuentas.
export function toAuthError(error: unknown): AuthError {
  if (error instanceof AuthError) return error;

  if (isAuthLike(error)) {
    const message = (error.message ?? '').toLowerCase();
    const code = (error.code ?? '').toString();
    const status = error.status ?? 0;

    // Orden: primero los casos ESPECIFICOS (por codigo/mensaje). El generico de credenciales
    // se evalua al final y NO se dispara por un status 400 a secas: un 400 puede ser un email
    // invalido o una contrasena rechazada en el registro, no unas credenciales de login malas.
    if (message.includes('email not confirmed') || code === 'email_not_confirmed') {
      return new AuthError(
        'AUTH_EMAIL_NOT_CONFIRMED',
        'Tu correo aun no esta verificado. Revisa tu bandeja de entrada.',
      );
    }
    if (message.includes('weak password') || code === 'weak_password') {
      return new AuthError(
        'AUTH_WEAK_PASSWORD',
        'La contrasena es demasiado debil. Usa al menos 8 caracteres.',
      );
    }
    if (status === 429 || code === 'over_request_rate_limit' || message.includes('rate limit')) {
      return new AuthError(
        'AUTH_RATE_LIMITED',
        'Demasiados intentos. Espera un momento e intentalo de nuevo.',
      );
    }
    if (message.includes('invalid login credentials') || code === 'invalid_credentials') {
      return new AuthError('AUTH_INVALID_CREDENTIALS', 'Correo o contrasena incorrectos.');
    }
  }

  if (error instanceof TypeError) {
    return new AuthError('AUTH_NETWORK', 'No se pudo conectar con el servidor de cuentas.');
  }
  return new AuthError('AUTH_UNKNOWN', 'No se pudo completar la operacion. Intentalo de nuevo.');
}
