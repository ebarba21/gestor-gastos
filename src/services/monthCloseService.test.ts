import { describe, expect, it } from 'vitest';
import type { Reconciliation } from '../db/schema';
import { makeAccount, makeTx } from '../test/txFixtures';
import { computeMonthClose, defaultCloseMonth } from './monthCloseService';

const IBER = makeAccount({ id: 'iber', name: 'Ibercaja' });
const REV = makeAccount({ id: 'rev', name: 'Revolut' });

function rec(accountId: string, statementDate: string, status: Reconciliation['status'] = 'balanced'): Reconciliation {
  return {
    id: `${accountId}-${statementDate}`,
    profileId: 'perfil-a',
    accountId,
    statementDate,
    statementBalanceCents: 0,
    computedBalanceCents: 0,
    differenceCents: 0,
    status,
    notes: null,
    createdAt: 0,
    updatedAt: 0,
  } as Reconciliation;
}

describe('cierre de mes', () => {
  const base = {
    month: '2026-10',
    today: '2026-11-21',
    accounts: [IBER, REV],
    openReviewCount: 0,
  };

  it('un mes completo: importado, categorizado, bandeja vacia y conciliado', () => {
    const txs = [
      makeTx({ accountId: 'iber', date: '2026-10-30', categoryId: 'super' }),
      makeTx({ accountId: 'rev', date: '2026-10-29', categoryId: 'ocio' }),
    ];
    const c = computeMonthClose({ ...base, transactions: txs, reconciliations: [rec('iber', '2026-10-31'), rec('rev', '2026-11-02')] });
    expect(c.steps).toEqual({ imported: true, categorized: true, reviewed: true, reconciled: true });
    expect(c.done).toBe(true);
    expect(c.streak).toBe(1);
  });

  it('detecta la cuenta sin importar hasta fin de mes y los movimientos sin categoria', () => {
    const txs = [
      makeTx({ accountId: 'iber', date: '2026-10-30', categoryId: null }),
      makeTx({ accountId: 'rev', date: '2026-10-20', categoryId: 'ocio' }),
    ];
    const c = computeMonthClose({ ...base, transactions: txs, reconciliations: [], openReviewCount: 2 });
    expect(c.accounts.find((a) => a.accountId === 'rev')!.imported).toBe(false);
    expect(c.accounts.find((a) => a.accountId === 'iber')!.imported).toBe(true);
    expect(c.uncategorizedInMonth).toBe(1);
    expect(c.steps).toEqual({ imported: false, categorized: false, reviewed: false, reconciled: false });
    expect(c.done).toBe(false);
    expect(c.streak).toBe(0);
  });

  it('una conciliacion con descuadre o anterior a fin de mes no vale', () => {
    const txs = [makeTx({ accountId: 'iber', date: '2026-10-31', categoryId: 'super' })];
    const c = computeMonthClose({
      ...base,
      accounts: [IBER],
      transactions: txs,
      reconciliations: [rec('iber', '2026-10-15'), rec('iber', '2026-10-31', 'discrepancy')],
    });
    expect(c.steps.reconciled).toBe(false);
  });

  it('una cuenta sin movimientos hasta ese mes no se exige', () => {
    const txs = [
      makeTx({ accountId: 'iber', date: '2026-10-30', categoryId: 'super' }),
      makeTx({ accountId: 'rev', date: '2026-11-05', categoryId: 'ocio' }), // abierta en noviembre
    ];
    const c = computeMonthClose({ ...base, transactions: txs, reconciliations: [rec('iber', '2026-10-31')] });
    expect(c.accounts.map((a) => a.accountId)).toEqual(['iber']);
    expect(c.done).toBe(true);
  });

  it('el mes en curso no puede estar cerrado y la racha cuenta meses seguidos', () => {
    const txs = [
      makeTx({ accountId: 'iber', date: '2026-08-31', categoryId: null }), // agosto sin categorizar
      makeTx({ accountId: 'iber', date: '2026-09-30', categoryId: 'super' }),
      makeTx({ accountId: 'iber', date: '2026-10-31', categoryId: 'super' }),
    ];
    // Una conciliacion a fin de un mes (o posterior) avala tambien los meses anteriores: el
    // saldo es acumulado.
    const recs = [rec('iber', '2026-09-30'), rec('iber', '2026-10-31')];
    const oct = computeMonthClose({ ...base, accounts: [IBER], transactions: txs, reconciliations: recs });
    expect(oct.streak).toBe(2);
    const nov = computeMonthClose({ ...base, month: '2026-11', accounts: [IBER], transactions: txs, reconciliations: recs });
    expect(nov.isOpenMonth).toBe(true);
    expect(nov.done).toBe(false);
  });

  it('el mes que toca cerrar es el anterior', () => {
    expect(defaultCloseMonth('2026-11-21')).toBe('2026-10');
    expect(defaultCloseMonth('2026-01-03')).toBe('2025-12');
  });
});
