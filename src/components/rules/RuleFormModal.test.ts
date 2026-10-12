import { describe, it, expect } from 'vitest';
import { eurosTextToCents, toggleSign } from './RuleFormModal';

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

// El teclado decimal de iOS no tiene tecla de menos: el boton ± del formulario usa toggleSign
// para poder escribir importes de gasto (negativos) desde el movil.
describe('toggleSign', () => {
  it('pone y quita el menos', () => {
    expect(toggleSign('78')).toBe('-78');
    expect(toggleSign('-78')).toBe('78');
    expect(toggleSign('12,34')).toBe('-12,34');
    expect(toggleSign('+5')).toBe('-5');
  });

  it('con el campo vacio deja solo el menos para escribir el numero despues', () => {
    expect(toggleSign('')).toBe('-');
    expect(toggleSign('-')).toBe('');
  });

  it('el resultado se convierte a centimos negativos', () => {
    expect(eurosTextToCents(toggleSign('78'))).toBe(-7800);
    expect(Number.isNaN(eurosTextToCents(toggleSign('')))).toBe(true);
  });
});
