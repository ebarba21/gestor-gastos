import { describe, it, expect } from 'vitest';
import {
  scoreRefundPair,
  scoreAllRefundCandidates,
  REFUND_DATE_WINDOW_DAYS,
  type RefundOriginalTx,
  type RefundCandidateTx,
} from './refundCandidateEngine';

function original(overrides: Partial<RefundOriginalTx> = {}): RefundOriginalTx {
  return {
    id: 'tx-original',
    amountCents: -10000,
    date: '2026-01-01',
    normalizedConcept: 'zara',
    merchantId: 'merch-zara',
    refundOfId: null,
    ...overrides,
  };
}

function candidate(overrides: Partial<RefundCandidateTx> = {}): RefundCandidateTx {
  return {
    id: 'tx-candidate',
    amountCents: 10000,
    date: '2026-01-10',
    normalizedConcept: 'zara',
    merchantId: 'merch-zara',
    refundOfId: null,
    ...overrides,
  };
}

describe('scoreRefundPair: fuera de alcance', () => {
  it('devuelve null si es el mismo id', () => {
    const o = original({ id: 'same' });
    expect(scoreRefundPair(o, { ...candidate(), id: 'same' })).toBeNull();
  });

  it('devuelve null si alguno ya esta vinculado', () => {
    expect(scoreRefundPair(original({ refundOfId: 'otro' }), candidate())).toBeNull();
    expect(scoreRefundPair(original(), candidate({ refundOfId: 'otro' }))).toBeNull();
  });

  it('devuelve null si el original no es un gasto (amountCents >= 0)', () => {
    expect(scoreRefundPair(original({ amountCents: 0 }), candidate())).toBeNull();
    expect(scoreRefundPair(original({ amountCents: 10000 }), candidate())).toBeNull();
  });

  it('devuelve null si el candidato no es positivo', () => {
    expect(scoreRefundPair(original(), candidate({ amountCents: 0 }))).toBeNull();
    expect(scoreRefundPair(original(), candidate({ amountCents: -10000 }))).toBeNull();
  });

  it('devuelve null si el reembolso supera el gasto original', () => {
    expect(scoreRefundPair(original({ amountCents: -5000 }), candidate({ amountCents: 5001 }))).toBeNull();
  });

  it('devuelve null si la fecha es anterior al gasto original', () => {
    expect(
      scoreRefundPair(original({ date: '2026-01-15' }), candidate({ date: '2026-01-10' })),
    ).toBeNull();
  });

  it('devuelve null si la fecha excede la ventana', () => {
    expect(
      scoreRefundPair(
        original({ date: '2026-01-01' }),
        candidate({ date: '2026-04-15' }), // > 60 dias
      ),
    ).toBeNull();
  });

  it('devuelve null sin comercio ni concepto compartidos', () => {
    expect(
      scoreRefundPair(
        original({ merchantId: 'merch-a', normalizedConcept: 'zara' }),
        candidate({ merchantId: 'merch-b', normalizedConcept: 'mercadona' }),
      ),
    ).toBeNull();
  });
});

describe('scoreRefundPair: candidato valido', () => {
  it('mismo comercio -> confianza base alta (900) en el mismo dia', () => {
    const o = original({ date: '2026-01-01' });
    const c = candidate({ date: '2026-01-01' });
    const score = scoreRefundPair(o, c);
    expect(score).not.toBeNull();
    expect(score?.confidence).toBe(900);
    expect(score?.originalId).toBe('tx-original');
    expect(score?.reasonCodes).toEqual(
      expect.arrayContaining(['oppositeAmounts', 'sameMerchant']),
    );
  });

  it('reembolso parcial valido (menor importe que el original)', () => {
    const o = original({ amountCents: -10000 });
    const c = candidate({ amountCents: 4000 });
    const score = scoreRefundPair(o, c);
    expect(score).not.toBeNull();
  });

  it('solo concepto compartido (sin comercio) -> confianza base menor (700)', () => {
    const o = original({ merchantId: null, normalizedConcept: 'zara online' });
    const c = candidate({ merchantId: null, normalizedConcept: 'zara online', date: '2026-01-01' });
    const score = scoreRefundPair({ ...o, date: '2026-01-01' }, c);
    expect(score?.confidence).toBe(700);
    expect(score?.reasonCodes).toContain('sameNormalizedConcept');
    expect(score?.reasonCodes).not.toContain('sameMerchant');
  });

  it('la confianza decae con la distancia en dias, sin bajar del suelo', () => {
    const o = original({ date: '2026-01-01' });
    const c = candidate({ date: '2026-03-02' }); // 60 dias = limite de ventana
    const score = scoreRefundPair(o, c);
    expect(score).not.toBeNull();
    expect(score?.dayDiff).toBe(REFUND_DATE_WINDOW_DAYS);
    expect(score?.confidence).toBeGreaterThanOrEqual(300);
  });
});

describe('scoreAllRefundCandidates', () => {
  it('ordena por confianza descendente de forma determinista', () => {
    const c = candidate({ date: '2026-01-10' });
    const closeMerchant = original({ id: 'tx-close', date: '2026-01-05' });
    const farConcept = original({ id: 'tx-far', merchantId: null, date: '2026-01-01' });
    const results = scoreAllRefundCandidates(c, [farConcept, closeMerchant]);
    expect(results.map((r) => r.originalId)).toEqual(['tx-close', 'tx-far']);
  });
});
