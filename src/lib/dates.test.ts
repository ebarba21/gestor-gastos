import { describe, it, expect } from 'vitest';
import {
  customRange,
  daysInMonth,
  isWithinRange,
  monthRange,
  quarterOfMonth,
  quarterRange,
  shiftMonths,
  shiftYears,
  yearRange,
} from './dates';

describe('daysInMonth', () => {
  it('devuelve la longitud de cada mes, con bisiestos', () => {
    expect(daysInMonth(2026, 1)).toBe(31);
    expect(daysInMonth(2026, 2)).toBe(28); // no bisiesto
    expect(daysInMonth(2024, 2)).toBe(29); // bisiesto
    expect(daysInMonth(2000, 2)).toBe(29); // bisiesto secular
    expect(daysInMonth(1900, 2)).toBe(28); // no bisiesto secular
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });
});

describe('monthRange', () => {
  it('acota al mes de la fecha de referencia', () => {
    expect(monthRange('2026-07-08')).toEqual({ from: '2026-07-01', to: '2026-07-31' });
    expect(monthRange('2026-02-15')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthRange('2024-02-15')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
  });
});

describe('quarterOfMonth y quarterRange', () => {
  it('mapea meses a su trimestre', () => {
    expect(quarterOfMonth(1)).toBe(1);
    expect(quarterOfMonth(3)).toBe(1);
    expect(quarterOfMonth(4)).toBe(2);
    expect(quarterOfMonth(7)).toBe(3);
    expect(quarterOfMonth(12)).toBe(4);
  });

  it('acota al trimestre natural que contiene la referencia', () => {
    expect(quarterRange('2026-07-08')).toEqual({ from: '2026-07-01', to: '2026-09-30' });
    expect(quarterRange('2026-01-31')).toEqual({ from: '2026-01-01', to: '2026-03-31' });
    expect(quarterRange('2026-12-01')).toEqual({ from: '2026-10-01', to: '2026-12-31' });
  });
});

describe('yearRange', () => {
  it('acota al ano natural', () => {
    expect(yearRange('2026-07-08')).toEqual({ from: '2026-01-01', to: '2026-12-31' });
  });
});

describe('customRange', () => {
  it('acepta from <= to y rechaza el orden inverso o fechas invalidas', () => {
    expect(customRange('2026-01-01', '2026-01-31')).toEqual({
      from: '2026-01-01',
      to: '2026-01-31',
    });
    expect(customRange('2026-01-01', '2026-01-01')).toEqual({
      from: '2026-01-01',
      to: '2026-01-01',
    });
    expect(() => customRange('2026-02-01', '2026-01-01')).toThrow();
    expect(() => customRange('2026-13-01', '2026-12-01')).toThrow();
  });
});

describe('isWithinRange', () => {
  const range = { from: '2026-07-01', to: '2026-07-31' };
  it('incluye ambos extremos y excluye fuera', () => {
    expect(isWithinRange('2026-07-01', range)).toBe(true);
    expect(isWithinRange('2026-07-31', range)).toBe(true);
    expect(isWithinRange('2026-07-15', range)).toBe(true);
    expect(isWithinRange('2026-06-30', range)).toBe(false);
    expect(isWithinRange('2026-08-01', range)).toBe(false);
  });
});

describe('shiftMonths', () => {
  it('desplaza meses y ajusta el dia al mes destino', () => {
    expect(shiftMonths('2026-07-08', 1)).toBe('2026-08-08');
    expect(shiftMonths('2026-01-31', 1)).toBe('2026-02-28'); // febrero no bisiesto
    expect(shiftMonths('2024-01-31', 1)).toBe('2024-02-29'); // febrero bisiesto
    expect(shiftMonths('2026-01-15', -1)).toBe('2025-12-15'); // cambio de ano hacia atras
    expect(shiftMonths('2026-12-15', 1)).toBe('2027-01-15'); // cambio de ano hacia delante
    expect(shiftMonths('2026-07-08', -13)).toBe('2025-06-08');
  });
});

describe('shiftYears', () => {
  it('desplaza anos y ajusta 29 de febrero', () => {
    expect(shiftYears('2026-07-08', 1)).toBe('2027-07-08');
    expect(shiftYears('2024-02-29', 1)).toBe('2025-02-28');
    expect(shiftYears('2024-02-29', -1)).toBe('2023-02-28');
  });
});
