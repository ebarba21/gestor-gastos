import { describe, it, expect } from 'vitest';
import { eurosTextToCents } from './RuleFormModal';

// Cobertura del parseo de importes del formulario de reglas. El caso critico es la cadena
// vacia: Number('') es 0 en JS, por lo que sin la guarda explicita se crearia en silencio una
// condicion "importe = 0". eurosTextToCents debe devolver NaN para que la validacion la rechace.
describe('eurosTextToCents', () => {
  it('convierte euros a centimos con separador , o .', () => {
    expect(eurosTextToCents('50')).toBe(5000);
    expect(eurosTextToCents('12,34')).toBe(1234);
    expect(eurosTextToCents('12.34')).toBe(1234);
    expect(eurosTextToCents('-50')).toBe(-5000);
  });

  it('devuelve NaN para cadena vacia o solo espacios', () => {
    expect(Number.isNaN(eurosTextToCents(''))).toBe(true);
    expect(Number.isNaN(eurosTextToCents('   '))).toBe(true);
  });

  it('devuelve NaN para texto no numerico', () => {
    expect(Number.isNaN(eurosTextToCents('abc'))).toBe(true);
  });
});
