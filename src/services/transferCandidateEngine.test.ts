import { describe, it, expect } from 'vitest';
import {
  scoreTransferPair,
  scoreAllTransferCandidates,
  findAutoLinkablePairs,
  AUTO_CONSOLIDATE_WINDOW_DAYS,
  TRANSFER_DATE_WINDOW_DAYS,
  type TransferCandidateTx,
} from './transferCandidateEngine';

function tx(overrides: Partial<TransferCandidateTx> = {}): TransferCandidateTx {
  return {
    id: 'tx-a',
    accountId: 'acc-1',
    amountCents: -5000,
    date: '2026-01-15',
    type: 'expense',
    transferGroupId: null,
    ...overrides,
  };
}

describe('scoreTransferPair: fuera de alcance', () => {
  it('devuelve null si es el mismo movimiento', () => {
    const a = tx({ id: 'same' });
    expect(scoreTransferPair(a, { ...a })).toBeNull();
  });

  it('devuelve null si alguno ya esta vinculado a una transferencia', () => {
    const a = tx();
    const b = tx({ id: 'tx-b', accountId: 'acc-2', amountCents: 5000, transferGroupId: 'grp-1' });
    expect(scoreTransferPair(a, b)).toBeNull();
  });

  it('devuelve null si son de la misma cuenta', () => {
    const a = tx();
    const b = tx({ id: 'tx-b', amountCents: 5000 });
    expect(scoreTransferPair(a, b)).toBeNull();
  });

  it('devuelve null si el importe absoluto difiere', () => {
    const a = tx();
    const b = tx({ id: 'tx-b', accountId: 'acc-2', amountCents: 5001 });
    expect(scoreTransferPair(a, b)).toBeNull();
  });

  it('devuelve null si tienen el mismo signo', () => {
    const a = tx({ amountCents: -5000 });
    const b = tx({ id: 'tx-b', accountId: 'acc-2', amountCents: -5000 });
    expect(scoreTransferPair(a, b)).toBeNull();
  });

  it('devuelve null si algun tipo ya es transfer', () => {
    const a = tx({ type: 'transfer' });
    const b = tx({ id: 'tx-b', accountId: 'acc-2', amountCents: 5000 });
    expect(scoreTransferPair(a, b)).toBeNull();
  });

  it('devuelve null si la fecha excede la ventana', () => {
    const a = tx({ date: '2026-01-01' });
    const b = tx({
      id: 'tx-b',
      accountId: 'acc-2',
      amountCents: 5000,
      date: '2026-01-10', // 9 dias, > TRANSFER_DATE_WINDOW_DAYS (5)
    });
    expect(scoreTransferPair(a, b)).toBeNull();
  });
});

describe('scoreTransferPair: candidato valido', () => {
  it('mismo dia -> confianza maxima (950)', () => {
    const a = tx({ amountCents: -5000, date: '2026-01-15' });
    const b = tx({ id: 'tx-b', accountId: 'acc-2', amountCents: 5000, date: '2026-01-15' });
    const score = scoreTransferPair(a, b);
    expect(score).not.toBeNull();
    expect(score?.confidence).toBe(950);
    expect(score?.counterpartId).toBe('tx-b');
    expect(score?.reasonCodes).toEqual(
      expect.arrayContaining(['sameAbsoluteAmount', 'oppositeSigns', 'differentAccounts']),
    );
    expect(score?.reasonCodes).not.toContain('closeDates');
  });

  it('la confianza decae con la distancia en dias, sin bajar del suelo de la ventana', () => {
    const a = tx({ amountCents: -5000, date: '2026-01-01' });
    const b = tx({
      id: 'tx-b',
      accountId: 'acc-2',
      amountCents: 5000,
      date: '2026-01-06', // 5 dias = limite de la ventana
    });
    const score = scoreTransferPair(a, b);
    expect(score).not.toBeNull();
    expect(score?.dayDiff).toBe(TRANSFER_DATE_WINDOW_DAYS);
    expect(score?.confidence).toBe(500); // suelo
    expect(score?.reasonCodes).toContain('closeDates');
  });

  it('funciona simetricamente (a,b) y (b,a)', () => {
    const a = tx({ id: 'tx-a', amountCents: -5000, date: '2026-01-15' });
    const b = tx({ id: 'tx-b', accountId: 'acc-2', amountCents: 5000, date: '2026-01-16' });
    const scoreAB = scoreTransferPair(a, b);
    const scoreBA = scoreTransferPair(b, a);
    expect(scoreAB?.confidence).toBe(scoreBA?.confidence);
    expect(scoreAB?.counterpartId).toBe('tx-b');
    expect(scoreBA?.counterpartId).toBe('tx-a');
  });
});

describe('scoreAllTransferCandidates', () => {
  it('ordena por confianza descendente de forma determinista', () => {
    const a = tx({ id: 'tx-a', amountCents: -5000, date: '2026-01-15' });
    const closeMatch = tx({ id: 'tx-close', accountId: 'acc-2', amountCents: 5000, date: '2026-01-15' });
    const farMatch = tx({ id: 'tx-far', accountId: 'acc-3', amountCents: 5000, date: '2026-01-18' });
    const results = scoreAllTransferCandidates(a, [farMatch, closeMatch]);
    expect(results.map((r) => r.counterpartId)).toEqual(['tx-close', 'tx-far']);
  });

  it('descarta candidatos fuera de alcance sin romper el resto', () => {
    const a = tx({ id: 'tx-a', amountCents: -5000, date: '2026-01-15' });
    const invalid = tx({ id: 'tx-invalid', accountId: 'acc-1', amountCents: 5000, date: '2026-01-15' });
    const valid = tx({ id: 'tx-valid', accountId: 'acc-2', amountCents: 5000, date: '2026-01-15' });
    const results = scoreAllTransferCandidates(a, [invalid, valid]);
    expect(results).toHaveLength(1);
    expect(results[0].counterpartId).toBe('tx-valid');
  });
});

describe('findAutoLinkablePairs', () => {
  it('vincula un par inequivoco (salida orientada primero)', () => {
    const out = tx({ id: 'ibercaja-out', accountId: 'ibercaja', amountCents: -5000, date: '2026-07-18' });
    const inc = tx({ id: 'revolut-in', accountId: 'revolut', amountCents: 5000, date: '2026-07-18' });
    const pairs = findAutoLinkablePairs([inc, out]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].aId).toBe('ibercaja-out'); // salida (negativo)
    expect(pairs[0].bId).toBe('revolut-in'); // entrada (positivo)
  });

  it('NO vincula si hay ambiguedad (dos posibles contrapartes del mismo importe)', () => {
    const out = tx({ id: 'out', accountId: 'ibercaja', amountCents: -5000, date: '2026-07-18' });
    const in1 = tx({ id: 'in1', accountId: 'revolut', amountCents: 5000, date: '2026-07-18' });
    const in2 = tx({ id: 'in2', accountId: 'bbva', amountCents: 5000, date: '2026-07-19' });
    // 'out' podria emparejar con in1 o in2: ambiguo -> ninguno se auto-vincula.
    expect(findAutoLinkablePairs([out, in1, in2])).toEqual([]);
  });

  it('respeta la ventana estricta de auto-consolidacion', () => {
    const out = tx({ id: 'out', accountId: 'ibercaja', amountCents: -5000, date: '2026-07-01' });
    const inc = tx({ id: 'in', accountId: 'revolut', amountCents: 5000, date: '2026-07-05' });
    // 4 dias > AUTO_CONSOLIDATE_WINDOW_DAYS (3), aunque cabria en la ventana de sugerencia (5).
    expect(AUTO_CONSOLIDATE_WINDOW_DAYS).toBeLessThan(TRANSFER_DATE_WINDOW_DAYS);
    expect(findAutoLinkablePairs([out, inc])).toEqual([]);
    // Con ventana mas amplia explicita, si lo empareja.
    expect(findAutoLinkablePairs([out, inc], 5)).toHaveLength(1);
  });

  it('ignora los ya vinculados o de tipo transfer', () => {
    const out = tx({ id: 'out', accountId: 'ibercaja', amountCents: -5000, transferGroupId: 'g1' });
    const inc = tx({ id: 'in', accountId: 'revolut', amountCents: 5000, type: 'transfer' });
    expect(findAutoLinkablePairs([out, inc])).toEqual([]);
  });

  it('empareja dos traspasos distintos del mismo importe si estan separados en el tiempo', () => {
    // Retroactivo: cada pareja esta aislada temporalmente, asi no hay ambiguedad entre ellas.
    const outA = tx({ id: 'outA', accountId: 'ibercaja', amountCents: -5000, date: '2026-01-10' });
    const inA = tx({ id: 'inA', accountId: 'revolut', amountCents: 5000, date: '2026-01-10' });
    const outB = tx({ id: 'outB', accountId: 'ibercaja', amountCents: -5000, date: '2026-06-10' });
    const inB = tx({ id: 'inB', accountId: 'revolut', amountCents: 5000, date: '2026-06-10' });
    const pairs = findAutoLinkablePairs([outA, inA, outB, inB]);
    expect(pairs).toHaveLength(2);
    expect(pairs.map((p) => [p.aId, p.bId])).toEqual(
      expect.arrayContaining([
        ['outA', 'inA'],
        ['outB', 'inB'],
      ]),
    );
  });
});
