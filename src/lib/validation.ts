// Validadores y errores tipados. Sin errores silenciosos (invariante CLAUDE.md).

// Error de validacion de datos o de reglas de integridad del modelo.
export class ValidationError extends Error {
  readonly code = 'VALIDATION_ERROR';
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

// Entidad no encontrada, o encontrada pero fuera del perfil solicitado.
export class NotFoundError extends Error {
  readonly code = 'NOT_FOUND';
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

// Lanza ValidationError si la condicion no se cumple.
export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ValidationError(message);
}

// profileId es obligatorio en toda la capa de datos: primer parametro no vacio.
export function requireProfileId(profileId: string): void {
  if (typeof profileId !== 'string' || profileId.length === 0) {
    throw new ValidationError('profileId es obligatorio y no puede estar vacio.');
  }
}

// id de entidad obligatorio y no vacio.
export function requireId(id: string, label = 'id'): void {
  if (typeof id !== 'string' || id.length === 0) {
    throw new ValidationError(`${label} es obligatorio y no puede estar vacio.`);
  }
}

// Comprueba que una fecha contable es un YYYY-MM-DD real (calendario valido, sin hora
// ni zona horaria). Ordenable lexicograficamente. Ver DATA_MODEL seccion 1.
export function isValidAccountingDate(date: string): boolean {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [y, m, d] = date.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  // Reconstruye en UTC y verifica que no hubo desborde (ej. 2026-02-30 -> marzo).
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function requireAccountingDate(date: string): void {
  if (!isValidAccountingDate(date)) {
    throw new ValidationError(`Fecha invalida "${date}": se espera YYYY-MM-DD real.`);
  }
}
