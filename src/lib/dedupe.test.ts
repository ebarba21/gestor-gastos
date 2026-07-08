import { describe, it, expect } from 'vitest';
import { computeDedupeHash, normalizeConcept } from './dedupe';

describe('normalizeConcept', () => {
  it('pasa a minusculas, quita acentos, recorta y colapsa espacios', () => {
    expect(normalizeConcept('  COMPRA   Mercadóna  ')).toBe('compra mercadona');
    expect(normalizeConcept('Café  con   Leche')).toBe('cafe con leche');
  });

  it('trata null/undefined como cadena vacia', () => {
    expect(normalizeConcept(undefined as unknown as string)).toBe('');
  });
});

describe('computeDedupeHash', () => {
  const base = {
    profileId: 'p1',
    accountId: 'a1',
    date: '2026-01-15',
    amountCents: -1234,
    concept: 'Mercadona',
  };

  it('es determinista y devuelve 8 hex', () => {
    const h1 = computeDedupeHash(base);
    const h2 = computeDedupeHash(base);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{8}$/);
  });

  it('es estable ante variaciones de mayusculas/acentos/espacios del concepto', () => {
    expect(computeDedupeHash({ ...base, concept: '  MERCADÓNA ' })).toBe(
      computeDedupeHash(base),
    );
  });

  it('cambia si cambia el importe, la cuenta, la fecha o el perfil', () => {
    const h = computeDedupeHash(base);
    expect(computeDedupeHash({ ...base, amountCents: -1235 })).not.toBe(h);
    expect(computeDedupeHash({ ...base, accountId: 'a2' })).not.toBe(h);
    expect(computeDedupeHash({ ...base, date: '2026-01-16' })).not.toBe(h);
    expect(computeDedupeHash({ ...base, profileId: 'p2' })).not.toBe(h);
  });

  it('no colisiona por concatenacion ambigua de importe y concepto', () => {
    const a = computeDedupeHash({ ...base, amountCents: 12, concept: '34x' });
    const b = computeDedupeHash({ ...base, amountCents: 1, concept: '234x' });
    expect(a).not.toBe(b);
  });
});
