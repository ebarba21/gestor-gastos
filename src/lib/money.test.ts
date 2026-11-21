import { describe, it, expect } from 'vitest';
import { assertCents, centsToEuros, eurosToCents, formatCents, isValidCents } from './money';
import { ValidationError } from './validation';

describe('money: eurosToCents', () => {
  it('convierte euros a centimos enteros', () => {
    expect(eurosToCents(12.34)).toBe(1234);
    expect(eurosToCents(0)).toBe(0);
    expect(eurosToCents(-9.99)).toBe(-999);
  });

  it('redondea al centimo mas cercano sin arrastrar errores de float', () => {
    expect(eurosToCents(19.99)).toBe(1999);
    expect(eurosToCents(0.1 + 0.2)).toBe(30);
    expect(eurosToCents(1234.56)).toBe(123456);
  });

  it('lanza ValidationError con valores no finitos', () => {
    expect(() => eurosToCents(Number.NaN)).toThrow(ValidationError);
    expect(() => eurosToCents(Number.POSITIVE_INFINITY)).toThrow(ValidationError);
  });
});

describe('money: centsToEuros y assertCents', () => {
  it('convierte centimos a euros', () => {
    expect(centsToEuros(1234)).toBe(12.34);
    expect(centsToEuros(-500)).toBe(-5);
  });

  it('rechaza centimos no enteros', () => {
    expect(() => centsToEuros(12.5)).toThrow(ValidationError);
    expect(() => assertCents(0.1)).toThrow(ValidationError);
    expect(isValidCents(10)).toBe(true);
    expect(isValidCents(10.5)).toBe(false);
  });

  it('round trip euros -> centimos -> euros es estable', () => {
    for (const euros of [0, 1, 12.34, 1000.99, -0.01]) {
      expect(centsToEuros(eurosToCents(euros))).toBeCloseTo(euros, 2);
    }
  });
});

describe('money: formatCents', () => {
  it('formatea en es-ES / EUR (presentacion)', () => {
    const out = formatCents(123456);
    // Coma decimal y simbolo de euro. El separador de miles depende del build de ICU,
    // por eso la asercion es tolerante a que aparezca o no.
    expect(out).toMatch(/1[.\s]?234,56/);
    expect(out).toContain('€');
  });

  it('rechaza centimos no enteros', () => {
    expect(() => formatCents(12.34)).toThrow(ValidationError);
  });
});

describe('modo privado (importes ocultos)', () => {
  it('formatCents devuelve la mascara mientras esta activo y la cifra al desactivarlo', async () => {
    const { formatCents, setAmountsMasked, MASKED_AMOUNT, areAmountsMasked } = await import('./money');
    setAmountsMasked(true);
    try {
      expect(areAmountsMasked()).toBe(true);
      expect(formatCents(123456)).toBe(MASKED_AMOUNT);
      expect(formatCents(-500)).toBe(MASKED_AMOUNT);
    } finally {
      setAmountsMasked(false);
    }
    expect(formatCents(123456)).not.toBe(MASKED_AMOUNT);
    expect(formatCents(123456)).toContain('1234,56');
  });

  it('sigue validando que el importe sea entero aunque este oculto', async () => {
    const { formatCents, setAmountsMasked } = await import('./money');
    setAmountsMasked(true);
    try {
      expect(() => formatCents(1.5)).toThrow();
    } finally {
      setAmountsMasked(false);
    }
  });
});
