import { describe, it, expect } from 'vitest';
import { normalizeConceptV1, NORMALIZATION_VERSION } from './normalization';

describe('normalizeConceptV1', () => {
  it('pasa a minusculas', () => {
    expect(normalizeConceptV1('AMAZON EU')).toBe('amazon eu');
  });

  it('quita acentos y diacriticos (tildes)', () => {
    expect(normalizeConceptV1('Café Nación')).toBe('cafe nacion');
  });

  it('colapsa y recorta espacios', () => {
    expect(normalizeConceptV1('  AMZN   Mktp   ES  ')).toBe('amzn mktp es');
  });

  it('sustituye signos y simbolos de puntuacion por espacio', () => {
    expect(normalizeConceptV1('Amazon.es')).toBe('amazon es');
    expect(normalizeConceptV1('PAYPAL *NETFLIX.COM')).toBe('paypal netflix com');
    expect(normalizeConceptV1('Mercadona, S.A.')).toBe('mercadona s a');
  });

  it('elimina una referencia variable final SOLO cuando va pegada tras un asterisco', () => {
    expect(normalizeConceptV1('Amazon.es*1234')).toBe('amazon es');
    expect(normalizeConceptV1('COMERCIO*AB12CD')).toBe('comercio');
  });

  it('NO elimina numeros en ningun otro contexto (no borra digitos indiscriminadamente)', () => {
    expect(normalizeConceptV1('Netflix 2024')).toBe('netflix 2024');
    expect(normalizeConceptV1('Canal 365')).toBe('canal 365');
    expect(normalizeConceptV1('7Eleven')).toBe('7eleven');
  });

  it('un asterisco en medio del texto (no al final) no se toca como referencia variable', () => {
    // El sufijo tras el ultimo '*' contiene un punto: no es "solo alfanumerico", no se elimina.
    expect(normalizeConceptV1('PAYPAL *NETFLIX.COM')).not.toBe('paypal');
  });

  it('trata null/undefined como cadena vacia', () => {
    expect(normalizeConceptV1(undefined as unknown as string)).toBe('');
    expect(normalizeConceptV1(null as unknown as string)).toBe('');
  });

  it('es determinista: misma entrada, mismo resultado siempre', () => {
    const input = 'AMZN Mktp ES*XY12';
    expect(normalizeConceptV1(input)).toBe(normalizeConceptV1(input));
  });

  it('los tres ejemplos de Amazon se normalizan de forma estable (no identica, requieren alias)', () => {
    const a = normalizeConceptV1('AMZN Mktp ES');
    const b = normalizeConceptV1('AMAZON EU');
    const c = normalizeConceptV1('Amazon.es*1234');
    expect(a).toBe('amzn mktp es');
    expect(b).toBe('amazon eu');
    expect(c).toBe('amazon es');
    // Normalizar no unifica textos de origen distintos por si solo: eso es trabajo del alias.
    expect(a).not.toBe(b);
    expect(b).not.toBe(c);
  });

  it('version de normalizacion vigente es 1', () => {
    expect(NORMALIZATION_VERSION).toBe(1);
  });
});
