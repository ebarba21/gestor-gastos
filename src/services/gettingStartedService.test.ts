import { describe, expect, it } from 'vitest';
import { computeGettingStarted } from './gettingStartedService';

const empty = { accounts: 0, transactions: 0, committedImports: 0, openReview: 0, rules: 0, activeBudgets: 0 };

describe('primeros pasos', () => {
  it('un perfil recien creado tiene todo pendiente (la bandeja vacia sin datos no cuenta)', () => {
    expect(computeGettingStarted(empty).every((s) => !s.done)).toBe(true);
  });

  it('se van marcando segun los datos', () => {
    const steps = computeGettingStarted({ ...empty, accounts: 2, transactions: 120, openReview: 4, rules: 3 });
    const done = Object.fromEntries(steps.map((s) => [s.id, s.done]));
    expect(done).toEqual({ accounts: true, import: true, review: false, rules: true, budgets: false });
  });

  it('con todo hecho, todos los pasos completos', () => {
    const steps = computeGettingStarted({ accounts: 1, transactions: 10, committedImports: 1, openReview: 0, rules: 1, activeBudgets: 2 });
    expect(steps.every((s) => s.done)).toBe(true);
  });
});
