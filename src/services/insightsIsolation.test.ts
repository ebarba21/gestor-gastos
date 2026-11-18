// Aislamiento por perfil de patrimonio e insights sobre IndexedDB real (fake-indexeddb): los
// datos de otro perfil nunca entran en los calculos del perfil activo (invariante 4).
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db';
import { accountService } from './accountService';
import { transactionService } from './transactionService';
import { netWorthService } from './netWorthService';
import { insightsService } from './insightsService';

const A = 'perfil-aislamiento-a';
const B = 'perfil-aislamiento-b';
const TODAY = '2026-11-18';

describe('patrimonio e insights: aislamiento por perfil', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
  });

  async function seed(profileId: string, openingCents: number, expenseCents: number) {
    const acc = await accountService.createAccount(profileId, { name: 'Banco', kind: 'bank', openingBalanceCents: openingCents });
    await transactionService.create(profileId, {
      date: '2026-11-10',
      amountCents: -expenseCents,
      type: 'expense',
      concept: 'Compra',
      accountId: acc.id,
    });
    return acc;
  }

  it('cada perfil solo ve su patrimonio, sus cuentas y su gasto', async () => {
    const accA = await seed(A, 100000, 2000);
    const accB = await seed(B, 999900, 50000);

    const nwA = await netWorthService.compute(A, { window: '1y', today: TODAY });
    expect(nwA.summary.currentCents).toBe(98000);
    expect(nwA.accounts.map((a) => a.accountId)).toEqual([accA.id]);

    const insA = await insightsService.compute(A, { anchorISO: TODAY, today: TODAY });
    expect(insA.summary.expenseNetCents).toBe(2000);
    expect(insA.health.accounts.map((a) => a.accountId)).toEqual([accA.id]);

    const nwB = await netWorthService.compute(B, { window: '1y', today: TODAY });
    expect(nwB.summary.currentCents).toBe(949900);
    expect(nwB.accounts.map((a) => a.accountId)).toEqual([accB.id]);
  });

  it('exige profileId', async () => {
    await expect(netWorthService.compute('', { window: '1y' })).rejects.toThrow();
    await expect(insightsService.compute('', { anchorISO: TODAY })).rejects.toThrow();
  });
});
