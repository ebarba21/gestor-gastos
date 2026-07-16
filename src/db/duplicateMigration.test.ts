import { describe, it, expect } from 'vitest';
import {
  backfillDuplicateFields,
  backfillImportBatchFields,
  type LegacyTransactionRowV6,
} from './duplicateMigration';
import { computeExactFingerprint, computeNormalizedFingerprint } from '../lib/duplicateFingerprint';

function legacyRow(overrides: Partial<LegacyTransactionRowV6> = {}): LegacyTransactionRowV6 {
  return {
    id: 't1',
    profileId: 'p1',
    accountId: 'acc-1',
    date: '2026-01-15',
    amountCents: -1234,
    concept: 'Compra',
    normalizedConcept: 'compra',
    merchantId: null,
    ...overrides,
  };
}

describe('backfillDuplicateFields', () => {
  it('rellena todos los campos nuevos con sus defaults documentados', () => {
    const row = legacyRow();
    const touched = backfillDuplicateFields(row);
    expect(touched).toBe(true);
    expect(row.bankTransactionId).toBeNull();
    expect(row.bookingDate).toBeNull();
    expect(row.valueDate).toBeNull();
    expect(row.pending).toBe(false);
    expect(row.currency).toBe('EUR');
    expect(row.balanceAfterCents).toBeNull();
    expect(row.bankReference).toBeNull();
    expect(row.operationType).toBeNull();
    expect(row.sourceFileHash).toBeNull();
    expect(row.sourceFileSize).toBeNull();
    expect(row.duplicateStatus).toBe('unique');
    expect(row.duplicateConfidence).toBe(0);
    expect(row.duplicateReasonCodes).toEqual([]);
    expect(row.duplicateCandidateIds).toEqual([]);
    expect(row.pendingReplacementId).toBeNull();
    expect(typeof row.sourceRowHash).toBe('string');
    expect((row.sourceRowHash as string).length).toBeGreaterThan(0);
  });

  it('calcula exactFingerprint y normalizedFingerprint coherentes con las funciones puras', () => {
    const row = legacyRow();
    backfillDuplicateFields(row);
    const expectedExact = computeExactFingerprint({
      accountId: 'acc-1',
      date: '2026-01-15',
      amountCents: -1234,
      currency: 'EUR',
      normalizedConcept: 'compra',
    });
    const expectedNorm = computeNormalizedFingerprint({
      accountId: 'acc-1',
      amountCents: -1234,
      currency: 'EUR',
      merchantId: null,
      normalizedConcept: 'compra',
    });
    expect(row.exactFingerprint).toBe(expectedExact);
    expect(row.normalizedFingerprint).toBe(expectedNorm);
    expect(row.fingerprintVersion).toBe(1);
  });

  it('usa el merchantId existente para la huella normalizada si ya esta asociado', () => {
    const row = legacyRow({ merchantId: 'merch-1' });
    backfillDuplicateFields(row);
    const expectedNorm = computeNormalizedFingerprint({
      accountId: 'acc-1',
      amountCents: -1234,
      currency: 'EUR',
      merchantId: 'merch-1',
      normalizedConcept: 'compra',
    });
    expect(row.normalizedFingerprint).toBe(expectedNorm);
  });

  it('es idempotente: no toca una fila que ya tiene todos los campos', () => {
    const row = legacyRow();
    backfillDuplicateFields(row);
    const touchedAgain = backfillDuplicateFields(row);
    expect(touchedAgain).toBe(false);
  });

  it('devuelve false si la fila ya tenia todo (no rompe filas de una migracion futura)', () => {
    const row = legacyRow({
      bankTransactionId: null,
      bookingDate: null,
      valueDate: null,
      pending: false,
      currency: 'USD',
      balanceAfterCents: null,
      bankReference: null,
      operationType: null,
      sourceFileHash: null,
      sourceFileSize: null,
      duplicateStatus: 'unique',
      duplicateConfidence: 0,
      duplicateReasonCodes: [],
      duplicateCandidateIds: [],
      pendingReplacementId: null,
      sourceRowHash: 'x',
      exactFingerprint: 'y',
      normalizedFingerprint: 'z',
      fingerprintVersion: 1,
    });
    expect(backfillDuplicateFields(row)).toBe(false);
    expect(row.currency).toBe('USD');
  });
});

describe('backfillImportBatchFields', () => {
  it('rellena sourceFileHash, sourceFileSize y rowsLinked con sus defaults', () => {
    const row: Record<string, unknown> = { id: 'b1' };
    const touched = backfillImportBatchFields(row);
    expect(touched).toBe(true);
    expect(row.sourceFileHash).toBeNull();
    expect(row.sourceFileSize).toBeNull();
    expect(row.rowsLinked).toBe(0);
  });

  it('es idempotente', () => {
    const row: Record<string, unknown> = {
      id: 'b1',
      sourceFileHash: 'h',
      sourceFileSize: 10,
      rowsLinked: 0,
    };
    expect(backfillImportBatchFields(row)).toBe(false);
  });
});
