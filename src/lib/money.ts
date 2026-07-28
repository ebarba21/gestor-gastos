// Utilidades de dinero. Los importes se almacenan SIEMPRE como enteros en centimos.
// Nunca floats para dinero. La conversion a euros es solo para presentacion.
import { ValidationError } from './validation';

// Comprueba que un valor es un importe valido en centimos (entero finito).
export function assertCents(cents: number): void {
  if (!Number.isInteger(cents)) {
    throw new ValidationError('Los importes en centimos deben ser enteros.');
  }
}

export function isValidCents(cents: number): boolean {
  return Number.isInteger(cents);
}

// Euros (numero) -> centimos (entero). 12,34 euros -> 1234.
// Contrato: la entrada representa un importe monetario con como maximo 2 decimales
// (lo que produce un input de moneda). Redondea al centimo mas cercano el valor
// IEEE-754 recibido; no intenta adivinar terceros decimales que el float ya no guarda.
export function eurosToCents(euros: number): number {
  if (!Number.isFinite(euros)) {
    throw new ValidationError('Importe en euros invalido: debe ser un numero finito.');
  }
  return Math.round(euros * 100);
}

// Centimos (entero) -> euros (numero). Solo para calculo/presentacion, nunca para persistir.
export function centsToEuros(cents: number): number {
  assertCents(cents);
  return cents / 100;
}

// Formatea centimos como texto monetario localizado. Capa de presentacion.
// useGrouping: 'always' fuerza el separador de miles (1.234,56 €) de forma explicita: el
// comportamiento por defecto de Intl depende del build de ICU y podia no agruparlo. Los importes
// se agrupan SIEMPRE en la UI; los inputs editables y las exportaciones CSV NO usan esta funcion
// a proposito (un separador de miles romperia la edicion o el parseo del fichero).
export function formatCents(cents: number, locale = 'es-ES', currency = 'EUR'): string {
  assertCents(cents);
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    useGrouping: 'always',
  }).format(cents / 100);
}

// Nota: el parseo de importes desde texto de extractos bancarios (separadores de miles
// y decimal, signos contables, notacion de adeudo) vive en la importacion (fase 3),
// donde requiere un parser estricto propio. No se implementa aqui de forma prematura.
