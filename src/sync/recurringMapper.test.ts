// Round-trip del mapper (local camelCase <-> fila remota snake_case) para las entidades de
// recurrencias anadidas en fase 7, y comprobacion de que quedan registradas en ENTITY_REGISTRY
// con el orden de dependencias correcto (recurringSeries despues de merchants/accounts;
// recurringOccurrence despues de recurringSeries y de transactions, que puede referenciar).
import { describe, it, expect } from 'vitest';
import { toRow, fromRow } from './mapper';
import { ENTITY_REGISTRY, PUSH_ORDER } from './entityRegistry';

describe('entityRegistry: recurrencias (fase 7)', () => {
  it('recurringSeries y recurringOccurrence estan registrados con su tabla remota', () => {
    expect(ENTITY_REGISTRY.recurringSeries.remoteTable).toBe('recurring_series');
    expect(ENTITY_REGISTRY.recurringSeries.localTable).toBe('recurringSeries');
    expect(ENTITY_REGISTRY.recurringOccurrence.remoteTable).toBe('recurring_occurrences');
    expect(ENTITY_REGISTRY.recurringOccurrence.localTable).toBe('recurringOccurrences');
  });

  it('recurringSeries se sube DESPUES de merchant y de transaction (puede referenciarlos)', () => {
    const order = PUSH_ORDER;
    expect(order.indexOf('merchant')).toBeLessThan(order.indexOf('recurringSeries'));
    expect(order.indexOf('recurringSeries')).toBeGreaterThan(order.indexOf('transaction'));
  });

  it('recurringOccurrence se sube DESPUES de recurringSeries y de transaction', () => {
    const order = PUSH_ORDER;
    expect(order.indexOf('recurringSeries')).toBeLessThan(order.indexOf('recurringOccurrence'));
    expect(order.indexOf('transaction')).toBeLessThan(order.indexOf('recurringOccurrence'));
  });
});

describe('mapper: recurringSeries', () => {
  const local = {
    id: 's1',
    merchantId: 'm1',
    accountId: 'acc-1',
    name: 'Netflix',
    direction: 'expense',
    frequency: 'monthly',
    interval: 1,
    expectedAmountCents: 1500,
    amountToleranceCents: 100,
    amountTolerancePpm: 50_000,
    expectedDayOfWeek: null,
    expectedDayOfMonth: 5,
    dateToleranceDays: 3,
    nextExpectedDate: '2026-07-05',
    status: 'active',
    confidence: 900,
    detectionVersion: 1,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    deletedAt: null,
  };

  it('toRow produce las columnas remotas esperadas, con importes en centimos intactos', () => {
    const row = toRow('recurringSeries', local);
    expect(row.merchant_id).toBe('m1');
    expect(row.account_id).toBe('acc-1');
    expect(row.direction).toBe('expense');
    expect(row.frequency).toBe('monthly');
    expect(row.interval).toBe(1);
    expect(row.expected_amount_cents).toBe(1500);
    expect(row.amount_tolerance_cents).toBe(100);
    expect(row.amount_tolerance_ppm).toBe(50_000);
    expect(row.expected_day_of_month).toBe(5);
    expect(row.next_expected_date).toBe('2026-07-05');
    expect(row.status).toBe('active');
    expect(row.confidence).toBe(900);
  });

  it('fromRow reconstruye la entidad local y marca synced, sin perder centimos', () => {
    const row = toRow('recurringSeries', local);
    const remoteRow = { ...row, profile_id: 'p1', revision: 2 };
    const back = fromRow('recurringSeries', remoteRow);
    expect(back.expectedAmountCents).toBe(1500);
    expect(back.amountToleranceCents).toBe(100);
    expect(back.amountTolerancePpm).toBe(50_000);
    expect(back.accountId).toBe('acc-1');
    expect(back.profileId).toBe('p1');
    expect(back.revision).toBe(2);
    expect(back.syncStatus).toBe('synced');
  });
});

describe('mapper: recurringOccurrence', () => {
  it('toRow/fromRow conservan seriesId, transactionId, fecha esperada e importe', () => {
    const local = {
      id: 'o1',
      seriesId: 's1',
      transactionId: 't1',
      expectedDate: '2026-07-05',
      expectedAmountCents: 1500,
      status: 'matched',
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
      deletedAt: null,
    };
    const row = toRow('recurringOccurrence', local);
    expect(row.series_id).toBe('s1');
    expect(row.transaction_id).toBe('t1');
    expect(row.expected_date).toBe('2026-07-05');
    expect(row.expected_amount_cents).toBe(1500);
    expect(row.status).toBe('matched');

    const back = fromRow('recurringOccurrence', { ...row, profile_id: 'p1', revision: 0 });
    expect(back.seriesId).toBe('s1');
    expect(back.transactionId).toBe('t1');
    expect(back.expectedAmountCents).toBe(1500);
  });
});
