import { describe, it, expect } from 'vitest';
import { backfillMerchantFields, type LegacyTransactionRow } from './merchantMigration';
import { normalizeConceptV1, NORMALIZATION_VERSION } from '../lib/normalization';

// Simula una fila de `transactions` tal como llegaria del esquema anterior a la fase 4 (sin
// los campos de comercio), para probar la migracion v5 sin abrir IndexedDB.
function legacyRow(overrides: Partial<LegacyTransactionRow> = {}): LegacyTransactionRow {
  const row: LegacyTransactionRow = {
    id: 'tx-1',
    profileId: 'perfil-a',
    concept: 'AMZN Mktp ES',
    syncStatus: 'local',
    ...overrides,
  };
  return row;
}

describe('backfillMerchantFields (migracion de esquema v5)', () => {
  it('rellena rawConcept con el concepto actual cuando falta', () => {
    const row = legacyRow();
    backfillMerchantFields(row);
    expect(row.rawConcept).toBe('AMZN Mktp ES');
  });

  it('calcula normalizedConcept con el algoritmo vigente', () => {
    const row = legacyRow();
    backfillMerchantFields(row);
    expect(row.normalizedConcept).toBe(normalizeConceptV1('AMZN Mktp ES'));
    expect(row.normalizationVersion).toBe(NORMALIZATION_VERSION);
  });

  it('no asocia comercio automaticamente (merchantId null, source none, confianza 0)', () => {
    const row = legacyRow();
    backfillMerchantFields(row);
    expect(row.merchantId).toBeNull();
    expect(row.merchantMatchSource).toBe('none');
    expect(row.merchantMatchConfidence).toBe(0);
  });

  it('NUNCA sobreescribe un campo ya presente (idempotente / reanudable)', () => {
    const row = legacyRow({
      rawConcept: 'ya migrado',
      normalizedConcept: 'ya normalizado',
      normalizationVersion: 7,
      merchantId: 'merch-1',
      merchantMatchSource: 'manual',
      merchantMatchConfidence: 1000,
    });
    const touched = backfillMerchantFields(row);
    expect(touched).toBe(false);
    expect(row.rawConcept).toBe('ya migrado');
    expect(row.merchantId).toBe('merch-1');
  });

  it('aplicar dos veces seguidas produce el mismo resultado (reanudable sin duplicar)', () => {
    const row = legacyRow();
    backfillMerchantFields(row);
    const snapshot = { ...row };
    const touchedSecondTime = backfillMerchantFields(row);
    expect(touchedSecondTime).toBe(false);
    expect(row).toEqual(snapshot);
  });

  it('devuelve true solo cuando modifico algo', () => {
    expect(backfillMerchantFields(legacyRow())).toBe(true);
    expect(backfillMerchantFields(legacyRow({ rawConcept: 'x' }))).toBe(true); // otros campos siguen faltando
  });

  it('conserva rawConcept intacto aunque concept cambie despues (rawConcept es una copia, no una referencia viva)', () => {
    const row = legacyRow({ concept: 'Concepto original banco' });
    backfillMerchantFields(row);
    row.concept = 'Concepto editado por el usuario';
    expect(row.rawConcept).toBe('Concepto original banco');
  });
});
