import { describe, it, expect } from 'vitest';
import { suggestRule } from './ruleSuggestion';

const tx = (rawConcept: string) => ({ rawConcept, concept: rawConcept });

describe('sugerencia de regla al corregir una categoria', () => {
  it('usa el comercio normalizado si aparece en el concepto', () => {
    expect(suggestRule(tx('COMPRA TARJ MERCADONA 1234 MANRESA'), 'Mercadona', 'super', null, 'Supermercado')).toEqual({
      keyword: 'mercadona',
      categoryId: 'super',
      subcategoryId: null,
      name: 'mercadona → Supermercado',
    });
  });

  it('sin comercio toma la palabra mas distintiva, sin numeros ni ruido', () => {
    expect(suggestRule(tx('TARJ 4521 BONAREA AGROUP'), null, 'coche', 'gasolina', 'Coche')!.keyword).toBe('bonarea');
    expect(suggestRule(tx('VIP SL 0034'), null, 'ocio', null, 'Ocio')!.keyword).toBe('vip');
  });

  it('no sugiere reglas para conceptos genericos ni sin categoria', () => {
    expect(suggestRule(tx('BIZUM ENVIADO A JUAN'), null, 'rest', null, 'Restaurantes')).toBeNull();
    expect(suggestRule(tx('TRANSFERENCIA A FAVOR DE'), null, 'x', null, 'X')).toBeNull();
    expect(suggestRule(tx('MERCADONA'), null, null, null, '')).toBeNull();
    expect(suggestRule(tx('1234 56'), null, 'x', null, 'X')).toBeNull();
  });
});
