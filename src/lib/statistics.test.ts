import { describe, it, expect } from 'vitest';
import { medianAbsoluteDeviation, medianCents, medianNumber, mode } from './statistics';

describe('medianCents', () => {
  it('numero impar de elementos: el valor central', () => {
    expect(medianCents([300, 100, 200])).toBe(200);
  });

  it('numero par de elementos: media de los dos centrales, half-up', () => {
    expect(medianCents([100, 200, 300, 400])).toBe(250);
    // Media de los dos centrales termina en ,50 exacto -> Math.round redondea al par superior.
    expect(medianCents([101, 200])).toBe(151);
  });

  it('numero par de elementos con valores negativos: half-up en valor absoluto', () => {
    // Media de -100 y -101 es -100,5; half-up en valor absoluto -> -101 (no -100).
    expect(medianCents([-100, -101])).toBe(-101);
    expect(medianCents([-300, -100])).toBe(-200);
  });

  it('un unico valor', () => {
    expect(medianCents([500])).toBe(500);
  });

  it('lanza con lista vacia (sin silenciar el caso)', () => {
    expect(() => medianCents([])).toThrow();
  });
});

describe('medianAbsoluteDeviation', () => {
  it('todos los valores identicos: dispersion 0', () => {
    expect(medianAbsoluteDeviation([1000, 1000, 1000, 1000])).toBe(0);
  });

  it('un unico valor: dispersion 0', () => {
    expect(medianAbsoluteDeviation([1000])).toBe(0);
  });

  it('valores dispersos: MAD refleja la desviacion tipica sin verse arrastrado por un outlier', () => {
    // Mediana de [100,100,100,100,10000] = 100; desviaciones = [0,0,0,0,9900]; MAD = 0.
    expect(medianAbsoluteDeviation([100, 100, 100, 100, 10000])).toBe(0);
  });

  it('lanza con lista vacia', () => {
    expect(() => medianAbsoluteDeviation([])).toThrow();
  });
});

describe('medianNumber', () => {
  it('funciona con separaciones en dias (no monetarias), redondeando half-up igual que medianCents', () => {
    expect(medianNumber([7, 7, 14, 14])).toBe(11); // (7+14)/2 = 10,5 -> half-up -> 11
    expect(medianNumber([7, 9])).toBe(8);
  });

  it('lanza con lista vacia', () => {
    expect(() => medianNumber([])).toThrow();
  });
});

describe('mode', () => {
  it('devuelve el valor mas frecuente', () => {
    expect(mode([1, 2, 2, 3, 2])).toBe(2);
  });

  it('en caso de empate, gana el valor mas pequeno (determinista)', () => {
    expect(mode([5, 5, 1, 1])).toBe(1);
    expect(mode([1, 1, 5, 5])).toBe(1);
  });

  it('lanza con lista vacia', () => {
    expect(() => mode([])).toThrow();
  });
});
