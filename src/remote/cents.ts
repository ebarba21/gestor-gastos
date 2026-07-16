// Serializacion de importes en la frontera dominio <-> transporte (Supabase/Postgres).
//
// Invariante monetario (CLAUDE.md 6, DATA_MODEL seccion 1): el dinero SIEMPRE es un entero de
// centimos. Nunca floats. En Postgres los centimos son BIGINT. PostgREST puede devolver un
// BIGINT como number (JSON) o, en algunas configuraciones, como string. Estas funciones son la
// unica puerta por la que pasan los importes: validan que son enteros y normalizan el tipo,
// para que ningun float ni valor corrupto entre o salga del sistema.

import { RemoteError } from './errors';

// Dominio -> transporte. Exige un entero seguro (evita floats y NaN). Devuelve el mismo number
// (los centimos caben de sobra en un entero seguro de JS para importes personales).
export function serializeCents(cents: number): number {
  assertIntegerCents(cents);
  return cents;
}

// Transporte -> dominio. Acepta number o string numerico (segun como PostgREST serialice el
// BIGINT) y garantiza un entero seguro. Lanza RemoteError si el valor no es un entero valido.
export function deserializeCents(value: number | string): number {
  const n = typeof value === 'string' ? Number(value) : value;
  assertIntegerCents(n);
  return n;
}

// Igual que deserializeCents pero admite null (columnas de centimos nullables, p. ej.
// balanceAfterCents desde fase 5).
export function deserializeCentsNullable(value: number | string | null): number | null {
  if (value === null) return null;
  return deserializeCents(value);
}

// Dominio -> transporte para columnas de centimos NULLABLE (p. ej. balanceAfterCents: el
// fichero bancario puede no traer saldo posterior). null se conserva; un numero se valida
// igual que serializeCents.
export function serializeCentsNullable(cents: number | null): number | null {
  if (cents === null) return null;
  return serializeCents(cents);
}

// Valida que un valor es un entero seguro utilizable como centimos. No positivo/negativo: los
// centimos pueden ser negativos (gasto) o positivos (ingreso); solo se exige integridad entera.
export function assertIntegerCents(value: number): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RemoteError('REMOTE_CONSTRAINT', 'Importe no numerico: se esperan centimos enteros.');
  }
  if (!Number.isInteger(value)) {
    throw new RemoteError(
      'REMOTE_CONSTRAINT',
      `Importe con decimales (${value}): el dinero solo se representa en centimos enteros.`,
    );
  }
  if (!Number.isSafeInteger(value)) {
    throw new RemoteError('REMOTE_CONSTRAINT', 'Importe fuera del rango entero seguro.');
  }
}
