import { describe, it, expect } from 'vitest';
import {
  classifyFrequency,
  detectRecurringSeriesCandidates,
  groupKeyOf,
  MIN_OCCURRENCES_FOR_DETECTION,
  RECURRING_DETECTION_VERSION,
  scoreRecurringGroup,
  type DetectableTransaction,
} from './recurringDetectionEngine';

function tx(overrides: Partial<DetectableTransaction> = {}): DetectableTransaction {
  return {
    id: `tx-${Math.random().toString(36).slice(2)}`,
    date: '2026-01-01',
    amountCents: -1000,
    type: 'expense',
    concept: 'Netflix',
    accountId: 'acc-1',
    merchantId: 'merch-netflix',
    normalizedConcept: 'netflix',
    excludedFromStats: false,
    isSplitParent: false,
    pending: false,
    ...overrides,
  };
}

describe('classifyFrequency', () => {
  it('clasifica separaciones de ~7 dias como semanal', () => {
    expect(classifyFrequency(7)).toEqual({ frequency: 'weekly', interval: 1 });
  });
  it('clasifica separaciones de ~14 dias como semanal interval 2', () => {
    expect(classifyFrequency(14)).toEqual({ frequency: 'weekly', interval: 2 });
  });
  it('clasifica separaciones de ~30 dias como mensual', () => {
    expect(classifyFrequency(30)).toEqual({ frequency: 'monthly', interval: 1 });
  });
  it('clasifica separaciones de ~60 dias como mensual interval 2', () => {
    expect(classifyFrequency(60)).toEqual({ frequency: 'monthly', interval: 2 });
  });
  it('clasifica separaciones de ~91 dias como trimestral', () => {
    expect(classifyFrequency(91)).toEqual({ frequency: 'quarterly', interval: 1 });
  });
  it('clasifica separaciones de ~365 dias como anual', () => {
    expect(classifyFrequency(365)).toEqual({ frequency: 'yearly', interval: 1 });
  });
});

describe('scoreRecurringGroup - series semanal', () => {
  it('detecta una serie semanal regular (mismo importe, mismo dia de la semana)', () => {
    const txs = [
      tx({ id: 't1', date: '2026-06-01', amountCents: -500 }), // lunes
      tx({ id: 't2', date: '2026-06-08', amountCents: -500 }),
      tx({ id: 't3', date: '2026-06-15', amountCents: -500 }),
      tx({ id: 't4', date: '2026-06-22', amountCents: -500 }),
    ];
    const candidate = scoreRecurringGroup(txs);
    expect(candidate).not.toBeNull();
    expect(candidate!.frequency).toBe('weekly');
    expect(candidate!.interval).toBe(1);
    expect(candidate!.expectedAmountCents).toBe(500);
    expect(candidate!.direction).toBe('expense');
    expect(candidate!.expectedDayOfWeek).toBe(1); // lunes
    expect(candidate!.detectionVersion).toBe(RECURRING_DETECTION_VERSION);
    expect(candidate!.confidence).toBeGreaterThan(700);
    expect(candidate!.transactionIds).toEqual(['t1', 't2', 't3', 't4']);
  });
});

describe('scoreRecurringGroup - series mensual con importe variable', () => {
  it('usa la mediana del importe y una tolerancia coherente con la dispersion', () => {
    const txs = [
      tx({ id: 't1', date: '2026-01-05', amountCents: -4500 }),
      tx({ id: 't2', date: '2026-02-05', amountCents: -4700 }),
      tx({ id: 't3', date: '2026-03-05', amountCents: -4600 }),
      tx({ id: 't4', date: '2026-04-05', amountCents: -4800 }),
    ];
    const candidate = scoreRecurringGroup(txs);
    expect(candidate).not.toBeNull();
    expect(candidate!.frequency).toBe('monthly');
    expect(candidate!.interval).toBe(1);
    // mediana de [4500,4600,4700,4800] (par) = media de los dos centrales = 4650
    expect(candidate!.expectedAmountCents).toBe(4650);
    expect(candidate!.amountToleranceCents).toBeGreaterThan(0);
    expect(candidate!.expectedDayOfMonth).toBe(5);
    expect(candidate!.nextExpectedDate).toBe('2026-05-05');
  });

  it('principio y fin de mes: ajusta el dia sin desbordar meses cortos', () => {
    const txs = [
      tx({ id: 't1', date: '2026-01-31', amountCents: -1000 }),
      tx({ id: 't2', date: '2026-02-28', amountCents: -1000 }),
      tx({ id: 't3', date: '2026-03-31', amountCents: -1000 }),
      tx({ id: 't4', date: '2026-04-30', amountCents: -1000 }),
    ];
    const candidate = scoreRecurringGroup(txs);
    expect(candidate).not.toBeNull();
    expect(candidate!.frequency).toBe('monthly');
    // shiftMonths ajusta al ultimo dia del mes destino cuando el dia no existe.
    expect(candidate!.nextExpectedDate).toBe('2026-05-30');
  });
});

describe('scoreRecurringGroup - series trimestral y anual', () => {
  it('detecta una serie trimestral (impuesto/seguro cada 3 meses)', () => {
    const txs = [
      tx({ id: 't1', date: '2026-01-15', amountCents: -12000 }),
      tx({ id: 't2', date: '2026-04-15', amountCents: -12000 }),
      tx({ id: 't3', date: '2026-07-15', amountCents: -12000 }),
    ];
    const candidate = scoreRecurringGroup(txs);
    expect(candidate).not.toBeNull();
    expect(candidate!.frequency).toBe('quarterly');
    expect(candidate!.interval).toBe(1);
    expect(candidate!.nextExpectedDate).toBe('2026-10-15');
  });

  it('detecta una serie anual (seguro anual del coche) cruzando cambio de ano', () => {
    const txs = [
      tx({ id: 't1', date: '2024-03-10', amountCents: -35000 }),
      tx({ id: 't2', date: '2025-03-10', amountCents: -35000 }),
      tx({ id: 't3', date: '2026-03-10', amountCents: -35000 }),
    ];
    const candidate = scoreRecurringGroup(txs);
    expect(candidate).not.toBeNull();
    expect(candidate!.frequency).toBe('yearly');
    expect(candidate!.interval).toBe(1);
    expect(candidate!.nextExpectedDate).toBe('2027-03-10');
  });
});

describe('scoreRecurringGroup - outlier y poco historico', () => {
  it('un outlier de importe no arrastra la mediana ni dispara la tolerancia de forma desmedida', () => {
    const txs = [
      tx({ id: 't1', date: '2026-01-05', amountCents: -1000 }),
      tx({ id: 't2', date: '2026-02-05', amountCents: -1000 }),
      tx({ id: 't3', date: '2026-03-05', amountCents: -1000 }),
      tx({ id: 't4', date: '2026-04-05', amountCents: -9000 }), // outlier
      tx({ id: 't5', date: '2026-05-05', amountCents: -1000 }),
    ];
    const candidate = scoreRecurringGroup(txs);
    expect(candidate).not.toBeNull();
    // La mediana ignora el outlier (mediana de 5 valores ordenados: 1000).
    expect(candidate!.expectedAmountCents).toBe(1000);
  });

  it('devuelve null con menos ocurrencias que el minimo (poco historico)', () => {
    const txs = [
      tx({ id: 't1', date: '2026-01-05', amountCents: -1000 }),
      tx({ id: 't2', date: '2026-02-05', amountCents: -1000 }),
    ];
    expect(txs.length).toBeLessThan(MIN_OCCURRENCES_FOR_DETECTION);
    expect(scoreRecurringGroup(txs)).toBeNull();
  });
});

describe('detectRecurringSeriesCandidates - agrupacion y exclusiones', () => {
  it('distingue dos series del mismo comercio en cuentas distintas (no las mezcla)', () => {
    const txs = [
      tx({ id: 't1', date: '2026-01-05', accountId: 'acc-1', amountCents: -1000 }),
      tx({ id: 't2', date: '2026-02-05', accountId: 'acc-1', amountCents: -1000 }),
      tx({ id: 't3', date: '2026-03-05', accountId: 'acc-1', amountCents: -1000 }),
      tx({ id: 't4', date: '2026-01-20', accountId: 'acc-2', amountCents: -500 }),
      tx({ id: 't5', date: '2026-02-20', accountId: 'acc-2', amountCents: -500 }),
      tx({ id: 't6', date: '2026-03-20', accountId: 'acc-2', amountCents: -500 }),
    ];
    const candidates = detectRecurringSeriesCandidates(txs);
    expect(candidates).toHaveLength(2);
    const byAccount = new Map(candidates.map((c) => [c.accountId, c]));
    expect(byAccount.get('acc-1')!.expectedAmountCents).toBe(1000);
    expect(byAccount.get('acc-2')!.expectedAmountCents).toBe(500);
  });

  it('agrupa por concepto normalizado cuando no hay comercio asociado', () => {
    const txs = [
      tx({ id: 't1', date: '2026-01-05', merchantId: null, normalizedConcept: 'gimnasio', concept: 'GIMNASIO SA' }),
      tx({ id: 't2', date: '2026-02-05', merchantId: null, normalizedConcept: 'gimnasio', concept: 'GIMNASIO SA' }),
      tx({ id: 't3', date: '2026-03-05', merchantId: null, normalizedConcept: 'gimnasio', concept: 'GIMNASIO SA' }),
    ];
    const candidates = detectRecurringSeriesCandidates(txs);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.merchantId).toBeNull();
    expect(candidates[0]!.groupKey).toBe(groupKeyOf(txs[0]!));
  });

  it('excluye transferencias, padres de split y movimientos pendientes de la deteccion', () => {
    const txs = [
      tx({ id: 't1', date: '2026-01-05', type: 'transfer', excludedFromStats: true }),
      tx({ id: 't2', date: '2026-01-06', isSplitParent: true, excludedFromStats: true }),
      tx({ id: 't3', date: '2026-01-07', pending: true }),
    ];
    expect(detectRecurringSeriesCandidates(txs)).toEqual([]);
  });

  it('detecta ingresos recurrentes (nomina) por separado de gastos', () => {
    const txs = [
      tx({ id: 't1', date: '2026-01-30', type: 'income', amountCents: 150000, merchantId: 'merch-employer' }),
      tx({ id: 't2', date: '2026-02-27', type: 'income', amountCents: 150000, merchantId: 'merch-employer' }),
      tx({ id: 't3', date: '2026-03-31', type: 'income', amountCents: 150000, merchantId: 'merch-employer' }),
    ];
    const candidates = detectRecurringSeriesCandidates(txs);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.direction).toBe('income');
  });
});
