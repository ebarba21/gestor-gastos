// Round-trip del mapper (local camelCase <-> fila remota snake_case) para las entidades de
// comercio anadidas en fase 4, y comprobacion de que quedan registradas en ENTITY_REGISTRY con
// el orden de dependencias correcto (comercios y sus alias ANTES que transactions, que puede
// referenciarlos).
import { describe, it, expect } from 'vitest';
import { toRow, fromRow } from './mapper';
import { ENTITY_REGISTRY, PUSH_ORDER } from './entityRegistry';

describe('entityRegistry: comercios (fase 4)', () => {
  it('merchant y merchantAlias estan registrados con su tabla remota', () => {
    expect(ENTITY_REGISTRY.merchant.remoteTable).toBe('merchants');
    expect(ENTITY_REGISTRY.merchant.localTable).toBe('merchants');
    expect(ENTITY_REGISTRY.merchantAlias.remoteTable).toBe('merchant_aliases');
    expect(ENTITY_REGISTRY.merchantAlias.localTable).toBe('merchantAliases');
  });

  it('merchant y merchantAlias se suben ANTES que transaction (orden de dependencias)', () => {
    const order = PUSH_ORDER;
    expect(order.indexOf('merchant')).toBeLessThan(order.indexOf('transaction'));
    expect(order.indexOf('merchantAlias')).toBeLessThan(order.indexOf('transaction'));
  });
});

describe('mapper: merchant', () => {
  const local = {
    id: 'm1',
    canonicalName: 'Amazon',
    normalizedName: 'amazon',
    defaultCategoryId: 'cat-1',
    defaultSubcategoryId: null,
    defaultTagIds: ['tag-1', 'tag-2'],
    notes: 'nota',
    archivedAt: null,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    deletedAt: null,
  };

  it('toRow produce las columnas remotas esperadas', () => {
    const row = toRow('merchant', local);
    expect(row.canonical_name).toBe('Amazon');
    expect(row.normalized_name).toBe('amazon');
    expect(row.default_category_id).toBe('cat-1');
    expect(row.default_subcategory_id).toBeNull();
    expect(row.default_tag_ids).toEqual(['tag-1', 'tag-2']);
    expect(row.deleted_at).toBeNull();
  });

  it('fromRow reconstruye la entidad local y marca synced', () => {
    const row = toRow('merchant', local);
    // fromRow espera tambien profile_id/revision (los fija el pull); se simulan aqui.
    const remoteRow = { ...row, profile_id: 'p1', revision: 3 };
    const back = fromRow('merchant', remoteRow);
    expect(back.canonicalName).toBe('Amazon');
    expect(back.normalizedName).toBe('amazon');
    expect(back.defaultTagIds).toEqual(['tag-1', 'tag-2']);
    expect(back.profileId).toBe('p1');
    expect(back.revision).toBe(3);
    expect(back.syncStatus).toBe('synced');
  });
});

describe('mapper: merchantAlias', () => {
  it('toRow/fromRow conservan matchType, prioridad y estado', () => {
    const local = {
      id: 'a1',
      merchantId: 'm1',
      rawAlias: 'AMZN Mktp ES',
      normalizedAlias: 'amzn mktp es',
      matchType: 'exact',
      priority: 2,
      enabled: true,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
      deletedAt: null,
    };
    const row = toRow('merchantAlias', local);
    expect(row.merchant_id).toBe('m1');
    expect(row.raw_alias).toBe('AMZN Mktp ES');
    expect(row.match_type).toBe('exact');
    expect(row.priority).toBe(2);
    expect(row.enabled).toBe(true);

    const back = fromRow('merchantAlias', { ...row, profile_id: 'p1', revision: 0 });
    expect(back.merchantId).toBe('m1');
    expect(back.matchType).toBe('exact');
    expect(back.priority).toBe(2);
  });
});

describe('mapper: transaction incluye los campos de comercio', () => {
  it('toRow/fromRow conservan rawConcept, normalizedConcept, merchantId y confianza', () => {
    const local = {
      id: 't1',
      date: '2026-03-15',
      amountCents: -1000,
      type: 'expense',
      concept: 'Amazon',
      notes: null,
      accountId: 'acc-1',
      categoryId: null,
      subcategoryId: null,
      tagIds: [],
      status: 'cleared',
      categorizedBy: 'none',
      ruleId: null,
      transferGroupId: null,
      parentId: null,
      isSplitParent: false,
      refundOfId: null,
      excludedFromStats: false,
      statsFlag: 0,
      importBatchId: null,
      dedupeHash: 'h',
      rawConcept: 'AMZN Mktp ES',
      normalizedConcept: 'amzn mktp es',
      normalizationVersion: 1,
      merchantId: 'm1',
      merchantMatchSource: 'alias',
      merchantMatchConfidence: 900,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
      deletedAt: null,
    };
    const row = toRow('transaction', local);
    expect(row.raw_concept).toBe('AMZN Mktp ES');
    expect(row.normalized_concept).toBe('amzn mktp es');
    expect(row.normalization_version).toBe(1);
    expect(row.merchant_id).toBe('m1');
    expect(row.merchant_match_source).toBe('alias');
    expect(row.merchant_match_confidence).toBe(900);

    const back = fromRow('transaction', { ...row, profile_id: 'p1', revision: 0 });
    expect(back.rawConcept).toBe('AMZN Mktp ES');
    expect(back.merchantId).toBe('m1');
    expect(back.merchantMatchConfidence).toBe(900);
  });
});
