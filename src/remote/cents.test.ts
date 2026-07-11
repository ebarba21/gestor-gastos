import { describe, it, expect } from 'vitest';
import {
  serializeCents,
  deserializeCents,
  deserializeCentsNullable,
  assertIntegerCents,
} from './cents';
import { RemoteError } from './errors';

describe('serializacion de centimos (frontera dominio <-> transporte)', () => {
  it('serializa enteros (positivos, negativos y cero) sin alterarlos', () => {
    expect(serializeCents(0)).toBe(0);
    expect(serializeCents(1234)).toBe(1234);
    expect(serializeCents(-999)).toBe(-999);
  });

  it('rechaza importes con decimales (nunca floats para dinero)', () => {
    expect(() => serializeCents(12.34)).toThrow(RemoteError);
    expect(() => serializeCents(0.1)).toThrow(RemoteError);
  });

  it('rechaza NaN e infinitos', () => {
    expect(() => serializeCents(Number.NaN)).toThrow(RemoteError);
    expect(() => serializeCents(Number.POSITIVE_INFINITY)).toThrow(RemoteError);
  });

  it('deserializa un number entero', () => {
    expect(deserializeCents(1234)).toBe(1234);
  });

  it('deserializa un BIGINT que llega como string numerico', () => {
    expect(deserializeCents('1234')).toBe(1234);
    expect(deserializeCents('-50')).toBe(-50);
  });

  it('rechaza strings no enteras o no numericas', () => {
    expect(() => deserializeCents('12.34')).toThrow(RemoteError);
    expect(() => deserializeCents('abc')).toThrow(RemoteError);
  });

  it('deserializeCentsNullable respeta null', () => {
    expect(deserializeCentsNullable(null)).toBeNull();
    expect(deserializeCentsNullable('77')).toBe(77);
  });

  it('assertIntegerCents es un type guard que solo pasa enteros seguros', () => {
    expect(() => assertIntegerCents(10)).not.toThrow();
    expect(() => assertIntegerCents(Number.MAX_SAFE_INTEGER + 2)).toThrow(RemoteError);
  });
});
