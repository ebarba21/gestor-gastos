// Errores de dominio de la capa remota. La UI y los servicios nunca dependen de los tipos
// de error crudos de supabase-js: se traducen a estos errores explicitos (sin errores
// silenciosos, invariante CLAUDE.md). Los mensajes son cortos y no incluyen datos
// financieros completos (CLOUD_SYNC_SECURITY seccion 12).

export type RemoteErrorCode =
  | 'REMOTE_CONFIG' // Supabase no configurado o mal configurado.
  | 'REMOTE_AUTH' // No hay sesion valida (o RLS deniega por falta de autenticacion).
  | 'REMOTE_FORBIDDEN' // Autenticado pero sin permiso (RLS/owner) sobre la fila.
  | 'REMOTE_CONSTRAINT' // Violacion de restriccion (unique, check, FK).
  | 'REMOTE_NOT_FOUND' // Fila inexistente o invisible por RLS.
  | 'REMOTE_UNAVAILABLE' // Red/servidor no disponible.
  | 'REMOTE_UNKNOWN';

export class RemoteError extends Error {
  readonly code: RemoteErrorCode;
  // Codigo original de PostgREST (p. ej. '42501', '23505'), si lo hay. Nunca se muestra crudo
  // al usuario; sirve para diagnostico.
  readonly cause?: string;
  constructor(code: RemoteErrorCode, message: string, cause?: string) {
    super(message);
    this.name = 'RemoteError';
    this.code = code;
    this.cause = cause;
  }
}

// Forma minima de un error de PostgREST/supabase-js (evita depender del tipo exacto del SDK).
interface PostgrestLikeError {
  code?: string | null;
  message?: string | null;
  details?: string | null;
}

function isPostgrestLike(value: unknown): value is PostgrestLikeError {
  return typeof value === 'object' && value !== null && ('code' in value || 'message' in value);
}

// Traduce un error de supabase-js/PostgREST a un RemoteError de dominio. La correspondencia
// de codigos PostgREST/Postgres:
//   - '42501' insufficient_privilege (RLS deniega) -> FORBIDDEN.
//   - '23505' unique_violation, '23503' foreign_key, '23514' check -> CONSTRAINT.
//   - 'PGRST301'/'401' no autenticado -> AUTH.
//   - 'PGRST116' no rows -> NOT_FOUND.
export function toRemoteError(error: unknown, context = 'operacion remota'): RemoteError {
  if (error instanceof RemoteError) return error;

  if (isPostgrestLike(error)) {
    const code = (error.code ?? '').toString();
    const raw = error.message ?? '';
    switch (code) {
      case '42501':
        return new RemoteError(
          'REMOTE_FORBIDDEN',
          `No tienes permiso para esta ${context}.`,
          code,
        );
      case '23505':
        return new RemoteError('REMOTE_CONSTRAINT', 'Ya existe un registro equivalente.', code);
      case '23503':
        return new RemoteError(
          'REMOTE_CONSTRAINT',
          'Referencia a un registro que no existe.',
          code,
        );
      case '23514':
        return new RemoteError('REMOTE_CONSTRAINT', 'Un valor no cumple las restricciones.', code);
      case 'PGRST301':
      case '401':
        return new RemoteError('REMOTE_AUTH', 'Inicia sesion para continuar.', code);
      case 'PGRST116':
        return new RemoteError('REMOTE_NOT_FOUND', 'El registro no existe o no es accesible.', code);
      default:
        if (raw) {
          return new RemoteError('REMOTE_UNKNOWN', `Error en la ${context}.`, code || undefined);
        }
    }
  }

  // Fallo de red (fetch) u otro error no tipado.
  if (error instanceof TypeError) {
    return new RemoteError('REMOTE_UNAVAILABLE', 'No se pudo conectar con el servidor.');
  }
  return new RemoteError('REMOTE_UNKNOWN', `Error en la ${context}.`);
}
