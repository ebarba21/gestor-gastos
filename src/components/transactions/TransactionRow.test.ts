import { describe, it, expect } from 'vitest';
import type { Transaction } from '../../db/schema';
import { typeLabelFor } from './TransactionRow';

function t(over: Partial<Transaction>): Transaction {
  return { type: 'income', amountCents: 1000, categoryId: null, subcategoryId: null, refundOfId: null, ...over } as Transaction;
}

describe('typeLabelFor', () => {
  const income = new Set(['c-nom']);
  it('un positivo en categoria de ingreso es Ingreso', () => {
    expect(typeLabelFor(t({ categoryId: 'c-nom' }), income)).toBe('Ingreso');
  });
  it('un positivo fuera de las categorias de ingreso es un gasto positivo', () => {
    expect(typeLabelFor(t({ categoryId: 'c-bizum' }), income)).toBe('Gasto +');
    expect(typeLabelFor(t({ categoryId: null }), income)).toBe('Gasto +');
  });
  it('los gastos, transferencias y reembolsos conservan su etiqueta', () => {
    expect(typeLabelFor(t({ type: 'expense', amountCents: -100 }), income)).toBe('Gasto');
    expect(typeLabelFor(t({ type: 'transfer' }), income)).toBe('Transferencia');
    expect(typeLabelFor(t({ refundOfId: 'g' }), income)).toBe('Ingreso');
  });
  it('sin conjunto de categorias de ingreso muestra el tipo tal cual', () => {
    expect(typeLabelFor(t({ categoryId: 'c-bizum' }))).toBe('Ingreso');
  });
});
