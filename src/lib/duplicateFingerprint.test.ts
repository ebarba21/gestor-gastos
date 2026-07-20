import { describe, it, expect } from 'vitest';
import {
  computeSourceRowHash,
  computeExactFingerprint,
  computeNormalizedFingerprint,
  computeSourceFileHash,
  FINGERPRINT_VERSION,
} from './duplicateFingerprint';

describe('FINGERPRINT_VERSION', () => {
  it('es un entero positivo', () => {
    expect(Number.isInteger(FINGERPRINT_VERSION)).toBe(true);
    expect(FINGERPRINT_VERSION).toBeGreaterThan(0);
  });
});

describe('computeSourceRowHash', () => {
  it('es determinista y devuelve 8 hex', () => {
    const row = ['15/01/2026', 'Mercadona', '-12,34'];
    const h1 = computeSourceRowHash(row);
    const h2 = computeSourceRowHash(row);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{8}$/);
  });

  it('cambia si cambia cualquier celda', () => {
    const h = computeSourceRowHash(['a', 'b', 'c']);
    expect(computeSourceRowHash(['a', 'b', 'd'])).not.toBe(h);
    expect(computeSourceRowHash(['x', 'b', 'c'])).not.toBe(h);
  });

  it('trata null y undefined como celda vacia (misma huella)', () => {
    expect(computeSourceRowHash(['a', null, 'c'])).toBe(computeSourceRowHash(['a', undefined, 'c']));
  });

  it('serializa fechas de forma determinista', () => {
    const d = new Date('2026-01-15T10:00:00.000Z');
    expect(computeSourceRowHash([d])).toBe(computeSourceRowHash([new Date(d.getTime())]));
  });

  it('no colisiona por desplazamiento del limite entre celdas', () => {
    // ['ab','c'] y ['a','bc'] concatenarian a la misma cadena "abc" sin un separador entre
    // celdas; el separador de control evita que colisionen.
    const a = computeSourceRowHash(['ab', 'c']);
    const b = computeSourceRowHash(['a', 'bc']);
    expect(a).not.toBe(b);
  });
});

describe('computeExactFingerprint', () => {
  const base = {
    accountId: 'acc-1',
    date: '2026-01-15',
    amountCents: -1234,
    currency: 'EUR',
    normalizedConcept: 'mercadona',
  };

  it('es determinista', () => {
    expect(computeExactFingerprint(base)).toBe(computeExactFingerprint(base));
  });

  it('cambia si cambia cuenta, fecha, importe, moneda o concepto normalizado', () => {
    const h = computeExactFingerprint(base);
    expect(computeExactFingerprint({ ...base, accountId: 'acc-2' })).not.toBe(h);
    expect(computeExactFingerprint({ ...base, date: '2026-01-16' })).not.toBe(h);
    expect(computeExactFingerprint({ ...base, amountCents: -1235 })).not.toBe(h);
    expect(computeExactFingerprint({ ...base, currency: 'USD' })).not.toBe(h);
    expect(computeExactFingerprint({ ...base, normalizedConcept: 'carrefour' })).not.toBe(h);
  });

  it('distingue de computeNormalizedFingerprint (namespaces distintos)', () => {
    const exact = computeExactFingerprint(base);
    const norm = computeNormalizedFingerprint({ ...base, merchantId: null });
    expect(exact).not.toBe(norm);
  });
});

describe('computeNormalizedFingerprint', () => {
  const base = {
    accountId: 'acc-1',
    amountCents: -1234,
    currency: 'EUR',
    merchantId: null as string | null,
    normalizedConcept: 'mercadona',
  };

  it('es independiente de la fecha (misma huella con distinta fecha)', () => {
    // La huella normalizada deliberadamente no incluye fecha: la ventana temporal se aplica
    // aparte en la generacion de candidatos (FINANCIAL_ALGORITHMS seccion 5).
    const h = computeNormalizedFingerprint(base);
    expect(h).toMatch(/^[0-9a-f]{8}$/);
    expect(computeNormalizedFingerprint(base)).toBe(h);
  });

  it('usa merchantId cuando esta presente en vez del concepto normalizado', () => {
    const withMerchant = computeNormalizedFingerprint({ ...base, merchantId: 'm1' });
    const withOtherConcept = computeNormalizedFingerprint({
      ...base,
      merchantId: 'm1',
      normalizedConcept: 'otro concepto cualquiera',
    });
    // Si hay merchantId, el concepto normalizado no influye en la huella.
    expect(withMerchant).toBe(withOtherConcept);
  });

  it('cambia si cambia cuenta, importe, moneda o identidad (comercio/concepto)', () => {
    const h = computeNormalizedFingerprint(base);
    expect(computeNormalizedFingerprint({ ...base, accountId: 'acc-2' })).not.toBe(h);
    expect(computeNormalizedFingerprint({ ...base, amountCents: -1235 })).not.toBe(h);
    expect(computeNormalizedFingerprint({ ...base, currency: 'USD' })).not.toBe(h);
    expect(computeNormalizedFingerprint({ ...base, normalizedConcept: 'carrefour' })).not.toBe(h);
    expect(computeNormalizedFingerprint({ ...base, merchantId: 'm1' })).not.toBe(h);
  });
});

describe('computeSourceFileHash', () => {
  it('es determinista y devuelve 64 hex (SHA-256)', async () => {
    const bytes = new TextEncoder().encode('contenido de prueba').buffer;
    const h1 = await computeSourceFileHash(bytes as ArrayBuffer);
    const h2 = await computeSourceFileHash(bytes as ArrayBuffer);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('el mismo contenido con distinto nombre de fichero produce el mismo hash', async () => {
    // El hash se calcula sobre los BYTES, nunca sobre el nombre: renombrar el fichero antes
    // de reimportarlo no debe evitar la deteccion de "archivo repetido".
    const content = 'a,b,c\n1,2,3\n';
    const bytesA = new TextEncoder().encode(content).buffer;
    const bytesB = new TextEncoder().encode(content).buffer;
    expect(await computeSourceFileHash(bytesA as ArrayBuffer)).toBe(
      await computeSourceFileHash(bytesB as ArrayBuffer),
    );
  });

  it('cambia si cambia el contenido', async () => {
    const a = await computeSourceFileHash(new TextEncoder().encode('uno').buffer as ArrayBuffer);
    const b = await computeSourceFileHash(new TextEncoder().encode('dos').buffer as ArrayBuffer);
    expect(a).not.toBe(b);
  });
});
