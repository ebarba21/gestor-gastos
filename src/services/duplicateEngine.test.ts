import { describe, it, expect } from 'vitest';
import {
  scoreCandidate,
  evaluateDuplicates,
  evaluateDuplicatesWithDecisions,
  isPairDecidedNotDuplicate,
  STRONG_DATE_WINDOW_DAYS,
  POSSIBLE_DATE_WINDOW_DAYS,
  WEAK_DATE_WINDOW_DAYS,
  type DuplicateEvaluationInput,
  type ExistingTxForDuplicate,
} from './duplicateEngine';
import {
  computeExactFingerprint,
  computeNormalizedFingerprint,
} from '../lib/duplicateFingerprint';

function fp(accountId: string, date: string, amountCents: number, normalizedConcept: string, merchantId: string | null = null) {
  return {
    exactFingerprint: computeExactFingerprint({ accountId, date, amountCents, currency: 'EUR', normalizedConcept }),
    normalizedFingerprint: computeNormalizedFingerprint({ accountId, amountCents, currency: 'EUR', merchantId, normalizedConcept }),
  };
}

function draft(overrides: Partial<DuplicateEvaluationInput> = {}): DuplicateEvaluationInput {
  const base = {
    accountId: 'acc-1',
    currency: 'EUR',
    amountCents: -1234,
    date: '2026-01-15',
    normalizedConcept: 'mercadona',
    merchantId: null as string | null,
    bankTransactionId: null as string | null,
    pending: false,
  };
  const merged = { ...base, ...overrides };
  const hashes = fp(merged.accountId, merged.date, merged.amountCents, merged.normalizedConcept, merged.merchantId);
  return { ...merged, ...hashes };
}

function existing(overrides: Partial<ExistingTxForDuplicate> = {}): ExistingTxForDuplicate {
  const base = {
    id: 'tx-existing',
    accountId: 'acc-1',
    currency: 'EUR',
    amountCents: -1234,
    date: '2026-01-15',
    normalizedConcept: 'mercadona',
    merchantId: null as string | null,
    bankTransactionId: null as string | null,
    pending: false,
  };
  const merged = { ...base, ...overrides };
  const hashes = fp(merged.accountId, merged.date, merged.amountCents, merged.normalizedConcept, merged.merchantId);
  return { ...merged, ...hashes };
}

describe('scoreCandidate: fuera de alcance', () => {
  it('devuelve null si la cuenta, moneda o importe difieren', () => {
    expect(scoreCandidate(draft(), existing({ accountId: 'acc-2' }))).toBeNull();
    expect(scoreCandidate(draft(), existing({ currency: 'USD' }))).toBeNull();
    expect(scoreCandidate(draft(), existing({ amountCents: -1235 }))).toBeNull();
  });

  it('devuelve null si la fecha esta fuera de la ventana debil (mas de 14 dias)', () => {
    const d = draft({ date: '2026-01-01' });
    const e = existing({ date: '2026-01-20' }); // 19 dias
    expect(scoreCandidate(d, e)).toBeNull();
  });
});

describe('scoreCandidate: nivel exact', () => {
  it('mismo bankTransactionId -> exact, confianza 1000', () => {
    const d = draft({ bankTransactionId: 'BANK-1', normalizedConcept: 'otro concepto' });
    const e = existing({ bankTransactionId: 'BANK-1', date: '2026-02-20' }); // fecha muy distinta, igual gana por id
    const score = scoreCandidate(d, e);
    expect(score?.status).toBe('exact');
    expect(score?.confidence).toBe(1000);
    expect(score?.reasonCodes).toContain('sameBankTransactionId');
  });

  it('mismo exactFingerprint (misma fila exacta) -> exact, confianza 950', () => {
    const d = draft();
    const e = existing();
    const score = scoreCandidate(d, e);
    expect(score?.status).toBe('exact');
    expect(score?.confidence).toBe(950);
    expect(score?.reasonCodes).toContain('sameExactFingerprint');
  });

  it('mismo fichero re-importado con otro nombre produce el mismo exactFingerprint', () => {
    // El nombre del fichero no participa en exactFingerprint (fila identica -> mismo resultado
    // sin importar de que fichero venga ni como se llame).
    const d = draft();
    const e = existing();
    expect(d.exactFingerprint).toBe(e.exactFingerprint);
  });
});

describe('scoreCandidate: nivel strongNormalized', () => {
  it('mismo comercio + importe/cuenta + fecha dentro de la ventana estricta', () => {
    const d = draft({ merchantId: 'm1', date: '2026-01-16' });
    const e = existing({ merchantId: 'm1', date: '2026-01-15' }); // 1 dia
    const score = scoreCandidate(d, e);
    expect(score?.status).toBe('strongNormalized');
    expect(score?.reasonCodes).toContain('sameMerchant');
    expect(score!.confidence).toBeGreaterThanOrEqual(750);
  });

  it('mismo concepto normalizado (sin comercio) dentro de la ventana estricta', () => {
    const d = draft({ date: '2026-01-15' });
    const e = existing({ date: '2026-01-17' }); // 2 dias, STRONG_DATE_WINDOW_DAYS=3
    const score = scoreCandidate(d, e);
    expect(score?.status).toBe('strongNormalized');
    expect(score?.reasonCodes).toContain('sameNormalizedConcept');
  });

  it('la confianza decae con la distancia de dias pero no baja de 750 dentro de la ventana', () => {
    const near = scoreCandidate(draft({ date: '2026-01-15' }), existing({ date: '2026-01-15' }));
    const far = scoreCandidate(
      draft({ date: '2026-01-15' }),
      existing({ date: '2026-01-18' }), // 3 dias = borde de STRONG_DATE_WINDOW_DAYS
    );
    expect(near!.confidence).toBeGreaterThan(far!.confidence);
    expect(far!.confidence).toBeGreaterThanOrEqual(750);
  });

  it('justo fuera de la ventana estricta (con identidad compartida) cae a possible', () => {
    const d = draft({ date: '2026-01-15' });
    const e = existing({ date: '2026-01-19' }); // 4 dias > STRONG_DATE_WINDOW_DAYS(3)
    const score = scoreCandidate(d, e);
    expect(score?.status).toBe('possible');
  });
});

describe('scoreCandidate: nivel possible y weak (dos compras reales identicas)', () => {
  it('mismo importe/cuenta, concepto DISTINTO, fecha próxima -> possible', () => {
    const d = draft({ normalizedConcept: 'compra 1', date: '2026-01-15' });
    const e = existing({ normalizedConcept: 'compra 2', date: '2026-01-18' }); // 3 dias
    const score = scoreCandidate(d, e);
    expect(score?.status).toBe('possible');
    expect(score?.reasonCodes).not.toContain('sameMerchant');
    expect(score?.reasonCodes).not.toContain('sameNormalizedConcept');
  });

  it('mismo importe/cuenta, concepto distinto, fecha lejana (dentro de la ventana debil) -> weak', () => {
    const d = draft({ normalizedConcept: 'compra 1', date: '2026-01-01' });
    const e = existing({ normalizedConcept: 'compra 2', date: '2026-01-12' }); // 11 dias
    const score = scoreCandidate(d, e);
    expect(score?.status).toBe('weak');
  });

  it('dos compras reales identicas (mismo dia, importe, comercio y concepto) puntuan como "exact": el motor no puede distinguirlas de un duplicado real, solo avisa (nunca bloquea)', () => {
    // Con datos identicos en todos los campos que forman la huella, el nivel es el mas alto
    // (exact via exactFingerprint), pero SIGUE siendo un aviso: el usuario decide "no
    // duplicado" (markNotDuplicate) o "importar de todos modos" si sabe que son legitimas.
    const d = draft({ merchantId: 'm1', date: '2026-01-15' });
    const e = existing({ merchantId: 'm1', date: '2026-01-15' });
    const score = scoreCandidate(d, e);
    expect(score?.status).toBe('exact');
    expect(score?.confidence).toBeLessThan(1000); // nunca se afirma certeza absoluta
    expect(score?.actions).toContain('markNotDuplicate');
  });

  it('dos compras reales con el mismo comercio e importe pero CONCEPTO distinto puntuan como "strongNormalized" (no "exact")', () => {
    // Cuando el texto bancario difiere (aunque sea el mismo comercio, p. ej. dos recibos con
    // referencias distintas), el exactFingerprint ya no coincide: el nivel baja a
    // strongNormalized, coherente con FINANCIAL_ALGORITHMS seccion 5.
    const d = draft({ merchantId: 'm1', date: '2026-01-15', normalizedConcept: 'compra tienda a' });
    const e = existing({ merchantId: 'm1', date: '2026-01-15', normalizedConcept: 'compra tienda b' });
    const score = scoreCandidate(d, e);
    expect(score?.status).toBe('strongNormalized');
    expect(score?.confidence).toBeLessThan(950);
  });
});

describe('scoreCandidate: pendiente -> confirmado', () => {
  it('un confirmado que coincide con un pendiente produce pendingReplaced, no exact', () => {
    const d = draft({ bankTransactionId: 'BANK-9', pending: false });
    const e = existing({ bankTransactionId: 'BANK-9', pending: true });
    const score = scoreCandidate(d, e);
    expect(score?.status).toBe('pendingReplaced');
    expect(score?.reasonCodes).toContain('pendingConfirmedMatch');
    expect(score?.actions).toContain('replacePending');
  });

  it('si el borrador tambien esta pendiente, NO se propone sustitucion (ambos pendientes)', () => {
    const d = draft({ bankTransactionId: 'BANK-9', pending: true });
    const e = existing({ bankTransactionId: 'BANK-9', pending: true });
    const score = scoreCandidate(d, e);
    expect(score?.status).toBe('exact');
    expect(score?.actions).not.toContain('replacePending');
  });

  it('un pendiente no ofrece replacePending si el candidato NO esta pendiente', () => {
    const d = draft({ bankTransactionId: 'BANK-9', pending: false });
    const e = existing({ bankTransactionId: 'BANK-9', pending: false });
    const score = scoreCandidate(d, e);
    expect(score?.actions).not.toContain('replacePending');
  });
});

describe('scoreCandidate: acciones siempre disponibles', () => {
  it('toda coincidencia ofrece skip, import, link y markNotDuplicate', () => {
    const score = scoreCandidate(draft(), existing())!;
    expect(score.actions).toEqual(expect.arrayContaining(['skip', 'import', 'link', 'markNotDuplicate']));
  });
});

describe('evaluateDuplicates', () => {
  it('sin candidatos devuelve unique', () => {
    const result = evaluateDuplicates(draft(), []);
    expect(result.status).toBe('unique');
    expect(result.confidence).toBe(0);
    expect(result.candidateIds).toEqual([]);
    expect(result.best).toBeNull();
    expect(result.pendingReplacementCandidateId).toBeNull();
  });

  it('elige el candidato de mayor nivel entre varios (exact > strongNormalized > possible > weak)', () => {
    const d = draft({ merchantId: 'm1', date: '2026-01-15' });
    const weakMatch = existing({ id: 'weak-1', normalizedConcept: 'otro', date: '2026-01-05' });
    const strongMatch = existing({ id: 'strong-1', merchantId: 'm1', date: '2026-01-16' });
    const result = evaluateDuplicates(d, [weakMatch, strongMatch]);
    expect(result.status).toBe('strongNormalized');
    expect(result.best?.candidateId).toBe('strong-1');
    expect(result.candidateIds).toEqual(expect.arrayContaining(['weak-1', 'strong-1']));
  });

  it('descarta candidatos fuera de alcance (otra cuenta) sin fallar', () => {
    const d = draft();
    const result = evaluateDuplicates(d, [existing({ accountId: 'acc-otra' })]);
    expect(result.status).toBe('unique');
  });

  it('pendingReplacementCandidateId apunta al pendiente cuando el mejor nivel es pendingReplaced', () => {
    const d = draft({ bankTransactionId: 'BANK-9', pending: false });
    const pendingTx = existing({ id: 'pending-1', bankTransactionId: 'BANK-9', pending: true });
    const result = evaluateDuplicates(d, [pendingTx]);
    expect(result.status).toBe('pendingReplaced');
    expect(result.pendingReplacementCandidateId).toBe('pending-1');
  });

  it('es determinista: el orden de entrada de los candidatos no cambia el resultado', () => {
    const d = draft({ merchantId: 'm1', date: '2026-01-15' });
    const a = existing({ id: 'a', merchantId: 'm1', date: '2026-01-15' });
    const b = existing({ id: 'b', normalizedConcept: 'otro', date: '2026-01-16' });
    const r1 = evaluateDuplicates(d, [a, b]);
    const r2 = evaluateDuplicates(d, [b, a]);
    expect(r1.status).toBe(r2.status);
    expect(r1.best?.candidateId).toBe(r2.best?.candidateId);
  });
});

describe('isPairDecidedNotDuplicate', () => {
  it('reconoce la pareja en ambos ordenes (simetrico)', () => {
    const decisions = [{ leftFingerprint: 'x', rightFingerprint: 'y' }];
    expect(isPairDecidedNotDuplicate('x', 'y', decisions)).toBe(true);
    expect(isPairDecidedNotDuplicate('y', 'x', decisions)).toBe(true);
    expect(isPairDecidedNotDuplicate('x', 'z', decisions)).toBe(false);
  });
});

describe('evaluateDuplicatesWithDecisions', () => {
  it('suprime un nivel heuristico (strongNormalized) cuando la pareja fue marcada no-duplicado, sin exigir el id exacto', () => {
    const d = draft({ merchantId: 'm1', date: '2026-01-15', normalizedConcept: 'compra tienda a' });
    const decidedTx = existing({
      id: 'decided',
      merchantId: 'm1',
      date: '2026-01-15',
      normalizedConcept: 'compra tienda b',
    });
    const otherTx = existing({ id: 'other', normalizedConcept: 'otro', date: '2026-01-16' });
    const decisions = [
      {
        leftFingerprint: d.normalizedFingerprint,
        rightFingerprint: decidedTx.normalizedFingerprint,
        leftTxId: null,
        rightTxId: null,
      },
    ];
    const result = evaluateDuplicatesWithDecisions(d, [decidedTx, otherTx], decisions);
    // El candidato decidido desaparece del resultado; el otro (huella distinta) se conserva.
    expect(result.candidateIds).toEqual(['other']);
  });

  it('NUNCA suprime un nivel de identidad fuerte (exact) por una decision que NO referencia el id de ESE candidato', () => {
    // Caso critico (riesgo de falso negativo / duplicar saldo, invariante 11 de CLAUDE.md):
    // el usuario marco "no duplicado" para una pareja con la misma huella tolerante, pero la
    // decision no referencia a ESTE candidato. Eso NUNCA debe silenciar un candidato que
    // ademas coincide por identificador bancario exacto: esa es una senal de identidad mucho
    // mas fuerte y solo se suprime si la decision se tomo explicitamente sobre el.
    const d = draft({ bankTransactionId: 'BANK-1', merchantId: 'm1' });
    const same = existing({ id: 'x', bankTransactionId: 'BANK-1', merchantId: 'm1' });
    const decisions = [
      {
        leftFingerprint: d.normalizedFingerprint,
        rightFingerprint: same.normalizedFingerprint,
        leftTxId: null,
        rightTxId: 'algun-otro-id', // no es 'x'
      },
    ];
    const result = evaluateDuplicatesWithDecisions(d, [same], decisions);
    expect(result.status).toBe('exact');
    expect(result.candidateIds).toEqual(['x']);
  });

  it('SI suprime un nivel exact cuando la decision referencia explicitamente el id de ese candidato (dos compras reales identicas ya revisadas)', () => {
    const d = draft({ merchantId: 'm1' });
    const same = existing({ id: 'x', merchantId: 'm1' });
    const decisions = [
      {
        leftFingerprint: d.normalizedFingerprint,
        rightFingerprint: same.normalizedFingerprint,
        leftTxId: null,
        rightTxId: 'x',
      },
    ];
    const result = evaluateDuplicatesWithDecisions(d, [same], decisions);
    expect(result.status).toBe('unique');
  });

  it('NUNCA suprime pendingReplaced sin referencia explicita al id del pendiente', () => {
    const d = draft({ bankTransactionId: 'BANK-9', pending: false, merchantId: 'm1' });
    const pendingTx = existing({ id: 'p1', bankTransactionId: 'BANK-9', pending: true, merchantId: 'm1' });
    const decisions = [
      {
        leftFingerprint: d.normalizedFingerprint,
        rightFingerprint: pendingTx.normalizedFingerprint,
        leftTxId: null,
        rightTxId: null,
      },
    ];
    const result = evaluateDuplicatesWithDecisions(d, [pendingTx], decisions);
    expect(result.status).toBe('pendingReplaced');
  });

  it('sin decisiones, se comporta igual que evaluateDuplicates', () => {
    const d = draft({ merchantId: 'm1', date: '2026-01-15' });
    const e = existing({ id: 'a', merchantId: 'm1', date: '2026-01-16' });
    expect(evaluateDuplicatesWithDecisions(d, [e], [])).toEqual(evaluateDuplicates(d, [e]));
  });
});

describe('constantes de ventana', () => {
  it('estan ordenadas de forma creciente', () => {
    expect(STRONG_DATE_WINDOW_DAYS).toBeLessThan(POSSIBLE_DATE_WINDOW_DAYS);
    expect(POSSIBLE_DATE_WINDOW_DAYS).toBeLessThan(WEAK_DATE_WINDOW_DAYS);
  });
});
