import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db/index';
import { transactionsRepo, type NewTransaction } from '../db/transactionsRepo';
import { merchantsRepo } from '../db/merchantsRepo';
import { merchantAliasesRepo } from '../db/merchantAliasesRepo';
import type { Merchant, MerchantAlias } from '../db/schema';
import { normalizeConceptV1 } from '../lib/normalization';
import { ValidationError, NotFoundError } from '../lib/validation';
import {
  merchantService,
  aliasMatches,
  matchMerchant,
  computeMerchantSimilarity,
  compileAliasRegex,
  isMerchantEligible,
  SUGGESTION_THRESHOLD,
} from './merchantService';

const A = 'perfil-a';
const B = 'perfil-b';

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

// --- Factorias (motor puro, sin base de datos) ---

function merchant(over: Partial<Merchant> = {}): Merchant {
  return {
    id: over.id ?? crypto.randomUUID(),
    profileId: over.profileId ?? A,
    canonicalName: 'Amazon',
    normalizedName: 'amazon',
    defaultCategoryId: null,
    defaultSubcategoryId: null,
    defaultTagIds: [],
    notes: null,
    archivedAt: null,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

function alias(over: Partial<MerchantAlias> = {}): MerchantAlias {
  return {
    id: over.id ?? crypto.randomUUID(),
    merchantId: over.merchantId ?? 'merch-1',
    profileId: over.profileId ?? A,
    rawAlias: 'AMAZON',
    normalizedAlias: 'amazon',
    matchType: 'contains',
    priority: 0,
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

function txInput(over: Partial<NewTransaction> = {}): NewTransaction {
  const concept = (over.concept as string | undefined) ?? 'COMPRA MERCADONA MADRID';
  return {
    date: '2026-03-15',
    amountCents: -1000,
    type: 'expense',
    concept,
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
    importBatchId: null,
    dedupeHash: `hash-${crypto.randomUUID()}`,
    rawConcept: concept,
    normalizedConcept: normalizeConceptV1(concept),
    normalizationVersion: 1,
    merchantId: null,
    merchantMatchSource: 'none',
    merchantMatchConfidence: 0,
    bankTransactionId: null,
    bookingDate: null,
    valueDate: null,
    pending: false,
    currency: 'EUR',
    balanceAfterCents: null,
    bankReference: null,
    operationType: null,
    sourceRowHash: 'row-hash',
    exactFingerprint: 'exact-fp',
    normalizedFingerprint: 'norm-fp',
    fingerprintVersion: 1,
    sourceFileHash: null,
    sourceFileSize: null,
    duplicateStatus: 'unique',
    duplicateConfidence: 0,
    duplicateReasonCodes: [],
    duplicateCandidateIds: [],
    pendingReplacementId: null,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// 1. MOTOR PURO
// ---------------------------------------------------------------------------

describe('aliasMatches', () => {
  it('exact casa solo si el concepto normalizado es identico', () => {
    const a = alias({ matchType: 'exact', normalizedAlias: 'amazon eu' });
    expect(aliasMatches(a, 'amazon eu', 'AMAZON EU')).toBe(true);
    expect(aliasMatches(a, 'amazon eu compra', 'AMAZON EU COMPRA')).toBe(false);
  });

  it('contains casa si el concepto normalizado incluye el alias', () => {
    const a = alias({ matchType: 'contains', normalizedAlias: 'amazon' });
    expect(aliasMatches(a, 'compra amazon es', 'Compra Amazon ES')).toBe(true);
    expect(aliasMatches(a, 'mercadona', 'Mercadona')).toBe(false);
  });

  it('startsWith casa solo si el concepto normalizado empieza por el alias', () => {
    const a = alias({ matchType: 'startsWith', normalizedAlias: 'amzn' });
    expect(aliasMatches(a, 'amzn mktp es', 'AMZN Mktp ES')).toBe(true);
    expect(aliasMatches(a, 'compra amzn', 'Compra AMZN')).toBe(false);
  });

  it('regex casa sobre el concepto ORIGINAL (rawConcept), insensible a mayusculas', () => {
    const a = alias({ matchType: 'regex', rawAlias: '^AMZN.*ES$' });
    expect(aliasMatches(a, 'amzn mktp es', 'amzn Mktp es')).toBe(true);
    expect(aliasMatches(a, 'otra cosa', 'Otra cosa')).toBe(false);
  });

  it('una regex invalida en el alias NO casa y NO rompe el motor', () => {
    const a = alias({ matchType: 'regex', rawAlias: '(' });
    expect(() => aliasMatches(a, 'x', 'x')).not.toThrow();
    expect(aliasMatches(a, 'x', 'x')).toBe(false);
  });
});

describe('compileAliasRegex', () => {
  it('lanza ValidationError con un patron invalido (validacion al guardar)', () => {
    expect(() => compileAliasRegex('(')).toThrow(ValidationError);
  });
  it('compila sin lanzar un patron valido', () => {
    expect(() => compileAliasRegex('^AMZN')).not.toThrow();
  });
});

describe('computeMerchantSimilarity', () => {
  it('coincidencia exacta de las cadenas normalizadas = 1000', () => {
    expect(computeMerchantSimilarity('amazon', 'amazon')).toBe(1000);
  });
  it('una cadena contenida en la otra = 800', () => {
    expect(computeMerchantSimilarity('compra amazon es', 'amazon')).toBe(800);
  });
  it('sin ningun token en comun = 0', () => {
    expect(computeMerchantSimilarity('mercadona super', 'amazon')).toBe(0);
  });
  it('cadena vacia = 0 (no divide por cero)', () => {
    expect(computeMerchantSimilarity('', 'amazon')).toBe(0);
    expect(computeMerchantSimilarity('amazon', '')).toBe(0);
  });
});

describe('matchMerchant (orden de asociacion determinista)', () => {
  const m1 = merchant({ id: 'm1', canonicalName: 'Amazon', normalizedName: 'amazon' });
  const m2 = merchant({ id: 'm2', canonicalName: 'Mercadona', normalizedName: 'mercadona' });

  it('alias EXACTO tiene preferencia sobre alias configurable (aunque tenga menor prioridad)', () => {
    const exact = alias({ merchantId: 'm2', matchType: 'exact', normalizedAlias: 'compra amazon es', priority: 5 });
    const contains = alias({ merchantId: 'm1', matchType: 'contains', normalizedAlias: 'amazon', priority: 0 });
    const result = matchMerchant(
      { normalizedConcept: 'compra amazon es', rawConcept: 'Compra Amazon ES' },
      [m1, m2],
      [exact, contains],
    );
    expect(result.merchantId).toBe('m2');
    expect(result.source).toBe('alias');
    expect(result.confidence).toBe(1000);
    expect(result.aliasId).toBe(exact.id);
  });

  it('entre alias configurables que casan, gana el de menor numero de prioridad', () => {
    const lowPriorityFirst = alias({ id: 'a-1', merchantId: 'm1', matchType: 'contains', normalizedAlias: 'amazon', priority: 1 });
    const highPriorityFirst = alias({ id: 'a-0', merchantId: 'm2', matchType: 'contains', normalizedAlias: 'amazon', priority: 0 });
    const result = matchMerchant(
      { normalizedConcept: 'compra amazon es', rawConcept: 'Compra Amazon ES' },
      [m1, m2],
      [lowPriorityFirst, highPriorityFirst],
    );
    expect(result.merchantId).toBe('m2'); // priority 0 gana
  });

  it('desempate determinista ante misma prioridad: gana el alias mas antiguo (createdAt)', () => {
    const older = alias({ id: 'a-older', merchantId: 'm1', matchType: 'contains', normalizedAlias: 'amazon', priority: 0, createdAt: 100 });
    const newer = alias({ id: 'a-newer', merchantId: 'm2', matchType: 'contains', normalizedAlias: 'amazon', priority: 0, createdAt: 200 });
    const result = matchMerchant(
      { normalizedConcept: 'compra amazon es', rawConcept: 'Compra Amazon ES' },
      [m1, m2],
      [newer, older],
    );
    expect(result.merchantId).toBe('m1');
  });

  it('sin alias que casen, sugiere por similitud si supera el umbral', () => {
    const result = matchMerchant({ normalizedConcept: 'amazon', rawConcept: 'Amazon' }, [m1, m2], []);
    expect(result.merchantId).toBe('m1');
    expect(result.source).toBe('suggested');
    expect(result.confidence).toBeGreaterThanOrEqual(SUGGESTION_THRESHOLD);
  });

  it('una sugerencia de baja confianza NUNCA se convierte en asociacion definitiva (queda sin comercio)', () => {
    const result = matchMerchant({ normalizedConcept: 'factura luz', rawConcept: 'Factura luz' }, [m1, m2], []);
    expect(result.merchantId).toBeNull();
    expect(result.source).toBe('none');
    expect(result.confidence).toBe(0);
  });

  it('ignora alias y sugerencias de comercios ARCHIVADOS', () => {
    const archived = merchant({ id: 'm3', canonicalName: 'Cerrado', normalizedName: 'cerrado', archivedAt: 123 });
    const aliasOfArchived = alias({ merchantId: 'm3', matchType: 'exact', normalizedAlias: 'cerrado' });
    const result = matchMerchant({ normalizedConcept: 'cerrado', rawConcept: 'Cerrado' }, [archived], [aliasOfArchived]);
    expect(result.merchantId).toBeNull();
    expect(result.source).toBe('none');
  });
});

describe('isMerchantEligible', () => {
  it('excluye transferencias y padres de split; incluye el resto', () => {
    const base = txInput();
    expect(isMerchantEligible({ ...base, id: 't1', profileId: A, statsFlag: 0, createdAt: 0, updatedAt: 0 } as never)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2 y 3. VALIDACION, CRUD Y ORQUESTACION (integracion con Dexie/fake-indexeddb)
// ---------------------------------------------------------------------------

describe('merchantService.create', () => {
  it('crea un comercio con nombre normalizado', async () => {
    const m = await merchantService.create(A, { canonicalName: '  Amazon  ' });
    expect(m.canonicalName).toBe('Amazon');
    expect(m.normalizedName).toBe('amazon');
    expect(m.archivedAt).toBeNull();
  });

  it('rechaza un nombre vacio', async () => {
    await expect(merchantService.create(A, { canonicalName: '   ' })).rejects.toThrow(ValidationError);
  });

  it('rechaza crear un comercio equivalente ya existente (mismo nombre normalizado)', async () => {
    await merchantService.create(A, { canonicalName: 'Amazon' });
    await expect(merchantService.create(A, { canonicalName: '  amazon  ' })).rejects.toThrow();
  });

  it('el mismo nombre en perfiles distintos NO colisiona (aislamiento por perfil)', async () => {
    await merchantService.create(A, { canonicalName: 'Amazon' });
    await expect(merchantService.create(B, { canonicalName: 'Amazon' })).resolves.toBeDefined();
  });
});

describe('merchantService.update / archive / unarchive', () => {
  it('renombrar recalcula normalizedName', async () => {
    const m = await merchantService.create(A, { canonicalName: 'Amazon' });
    const updated = await merchantService.update(A, m.id, { canonicalName: 'AMAZON ES' });
    expect(updated.normalizedName).toBe('amazon es');
  });

  it('archivar y desarchivar', async () => {
    const m = await merchantService.create(A, { canonicalName: 'Amazon' });
    const archived = await merchantService.archive(A, m.id);
    expect(archived.archivedAt).not.toBeNull();
    expect(await merchantService.list(A)).toHaveLength(0);
    const unarchived = await merchantService.unarchive(A, m.id);
    expect(unarchived.archivedAt).toBeNull();
    expect(await merchantService.list(A)).toHaveLength(1);
  });
});

describe('merchantService aliases: aislamiento y validacion', () => {
  it('un alias no puede crearse sobre un comercio de otro perfil', async () => {
    const m = await merchantService.create(A, { canonicalName: 'Amazon' });
    await expect(
      merchantService.createAlias(B, m.id, { rawAlias: 'AMAZON', matchType: 'contains' }),
    ).rejects.toThrow();
  });

  it('createAlias con matchType regex y patron invalido lanza ValidationError', async () => {
    const m = await merchantService.create(A, { canonicalName: 'Amazon' });
    await expect(
      merchantService.createAlias(A, m.id, { rawAlias: '(', matchType: 'regex' }),
    ).rejects.toThrow(ValidationError);
  });

  it('updateAlias valida la regex resultante (combinando matchType y rawAlias nuevos)', async () => {
    const m = await merchantService.create(A, { canonicalName: 'Amazon' });
    const a = await merchantService.createAlias(A, m.id, { rawAlias: 'AMAZON', matchType: 'contains' });
    // Cambiar solo el matchType a regex con el rawAlias actual (texto no valido como regex).
    await merchantService.updateAlias(A, a.id, { rawAlias: '[' , matchType: 'contains'});
    await expect(merchantService.updateAlias(A, a.id, { matchType: 'regex' })).rejects.toThrow(ValidationError);
  });
});

describe('merchantService.applyToTransaction / applyRetroactive', () => {
  it('asocia por alias exacto y respeta la asociacion manual existente', async () => {
    const m = await merchantService.create(A, { canonicalName: 'Amazon' });
    await merchantService.createAlias(A, m.id, { rawAlias: 'AMZN Mktp ES', matchType: 'exact' });

    const tx = await transactionsRepo.create(A, txInput({ concept: 'AMZN Mktp ES' }));
    const applied = await merchantService.applyToTransaction(A, tx.id);
    expect(applied?.merchantId).toBe(m.id);
    expect(applied?.merchantMatchSource).toBe('alias');
    expect(applied?.merchantMatchConfidence).toBe(1000);

    // Reasignacion manual a "sin comercio": una nueva pasada del motor NO debe tocarlo.
    await merchantService.setTransactionMerchant(A, tx.id, null);
    const untouched = await merchantService.applyToTransaction(A, tx.id);
    expect(untouched).toBeNull();
    const reloaded = await transactionsRepo.getById(A, tx.id);
    expect(reloaded!.merchantId).toBeNull();
    expect(reloaded!.merchantMatchSource).toBe('manual');
  });

  it('rawConcept permanece intacto tras asociar por el motor', async () => {
    const m = await merchantService.create(A, { canonicalName: 'Amazon' });
    await merchantService.createAlias(A, m.id, { rawAlias: 'AMZN Mktp ES', matchType: 'exact' });
    const tx = await transactionsRepo.create(A, txInput({ concept: 'AMZN Mktp ES' }));
    const applied = await merchantService.applyToTransaction(A, tx.id);
    expect(applied!.rawConcept).toBe('AMZN Mktp ES');
  });

  it('applyRetroactive respeta lo manual salvo overrideManual', async () => {
    const m = await merchantService.create(A, { canonicalName: 'Amazon' });
    await merchantService.createAlias(A, m.id, { rawAlias: 'AMAZON', matchType: 'contains' });
    const manualTx = await transactionsRepo.create(
      A,
      txInput({ concept: 'Amazon compra', merchantId: null, merchantMatchSource: 'manual' }),
    );
    const { changed } = await merchantService.applyRetroactive(A);
    expect(changed).toBe(0);
    const untouched = await transactionsRepo.getById(A, manualTx.id);
    expect(untouched!.merchantId).toBeNull();

    const { changed: changedOverride } = await merchantService.applyRetroactive(A, { overrideManual: true });
    expect(changedOverride).toBe(1);
  });

  it('applyRetroactive es idempotente: aplicar dos veces no cambia nada la segunda vez', async () => {
    const m = await merchantService.create(A, { canonicalName: 'Amazon' });
    await merchantService.createAlias(A, m.id, { rawAlias: 'AMAZON', matchType: 'contains' });
    await transactionsRepo.create(A, txInput({ concept: 'Amazon compra' }));
    const first = await merchantService.applyRetroactive(A);
    const second = await merchantService.applyRetroactive(A);
    expect(first.changed).toBe(1);
    expect(second.changed).toBe(0);
  });

  it('aislamiento: applyRetroactive de un perfil nunca toca movimientos de otro perfil', async () => {
    const m = await merchantService.create(A, { canonicalName: 'Amazon' });
    await merchantService.createAlias(A, m.id, { rawAlias: 'AMAZON', matchType: 'contains' });
    const txB = await transactionsRepo.create(B, txInput({ concept: 'Amazon compra' }));
    await merchantService.applyRetroactive(A);
    const reloadedB = await transactionsRepo.getById(B, txB.id);
    expect(reloadedB!.merchantId).toBeNull();
  });
});

describe('merchantService.listUnlinkedConceptGroups', () => {
  it('agrupa por concepto normalizado y ordena por frecuencia desc', async () => {
    await transactionsRepo.create(A, txInput({ concept: 'Mercadona Centro' }));
    await transactionsRepo.create(A, txInput({ concept: 'Mercadona Centro' }));
    await transactionsRepo.create(A, txInput({ concept: 'Carrefour Norte' }));
    const groups = await merchantService.listUnlinkedConceptGroups(A);
    expect(groups[0].normalizedConcept).toBe(normalizeConceptV1('Mercadona Centro'));
    expect(groups[0].count).toBe(2);
    expect(groups[1].count).toBe(1);
  });

  it('no incluye movimientos ya asociados a un comercio', async () => {
    const m = await merchantService.create(A, { canonicalName: 'Mercadona' });
    await transactionsRepo.create(
      A,
      txInput({ concept: 'Mercadona Centro', merchantId: m.id, merchantMatchSource: 'manual', merchantMatchConfidence: 1000 }),
    );
    const groups = await merchantService.listUnlinkedConceptGroups(A);
    expect(groups).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Fusion de comercios (transaccional) y deshacer
// ---------------------------------------------------------------------------

describe('merchantsRepo.mergeMerchants / undoMerge', () => {
  it('mueve alias y movimientos del origen al destino, y archiva el origen', async () => {
    const source = await merchantService.create(A, { canonicalName: 'AMZN' });
    const target = await merchantService.create(A, { canonicalName: 'Amazon' });
    await merchantService.createAlias(A, source.id, { rawAlias: 'AMZN', matchType: 'contains' });
    const tx = await transactionsRepo.create(
      A,
      txInput({ concept: 'AMZN Mktp', merchantId: source.id, merchantMatchSource: 'manual', merchantMatchConfidence: 1000 }),
    );

    const result = await merchantsRepo.mergeMerchants(A, source.id, target.id);
    expect(result.movedAliases).toBe(1);
    expect(result.movedTransactions).toBe(1);

    const reloadedSource = await merchantsRepo.getById(A, source.id);
    expect(reloadedSource!.archivedAt).not.toBeNull();

    const aliases = await merchantAliasesRepo.listByMerchant(A, target.id);
    expect(aliases).toHaveLength(1);

    const reloadedTx = await transactionsRepo.getById(A, tx.id);
    expect(reloadedTx!.merchantId).toBe(target.id);
    // La fusion no altera como se asocio el movimiento, solo el destino.
    expect(reloadedTx!.merchantMatchSource).toBe('manual');
  });

  it('resuelve los defaults: el destino conserva los suyos; solo hereda del origen lo vacio', async () => {
    const source = await merchantService.create(A, { canonicalName: 'AMZN', defaultCategoryId: 'cat-source' });
    const target = await merchantService.create(A, { canonicalName: 'Amazon' }); // sin categoria
    await merchantsRepo.mergeMerchants(A, source.id, target.id);
    const reloadedTarget = await merchantsRepo.getById(A, target.id);
    expect(reloadedTarget!.defaultCategoryId).toBe('cat-source');
  });

  it('no deja huerfanos: no quedan alias ni movimientos apuntando al origen tras fusionar', async () => {
    const source = await merchantService.create(A, { canonicalName: 'AMZN' });
    const target = await merchantService.create(A, { canonicalName: 'Amazon' });
    await merchantService.createAlias(A, source.id, { rawAlias: 'AMZN', matchType: 'contains' });
    await transactionsRepo.create(
      A,
      txInput({ concept: 'AMZN', merchantId: source.id, merchantMatchSource: 'manual', merchantMatchConfidence: 1000 }),
    );
    await merchantsRepo.mergeMerchants(A, source.id, target.id);
    expect(await merchantAliasesRepo.listByMerchant(A, source.id)).toHaveLength(0);
    expect(await transactionsRepo.listByMerchant(A, source.id)).toHaveLength(0);
  });

  it('es reintentable sin duplicar: fusionar dos veces seguidas no mueve nada la segunda vez', async () => {
    const source = await merchantService.create(A, { canonicalName: 'AMZN' });
    const target = await merchantService.create(A, { canonicalName: 'Amazon' });
    await merchantService.createAlias(A, source.id, { rawAlias: 'AMZN', matchType: 'contains' });
    const first = await merchantsRepo.mergeMerchants(A, source.id, target.id);
    expect(first.movedAliases).toBe(1);
    const second = await merchantsRepo.mergeMerchants(A, source.id, target.id);
    expect(second.movedAliases).toBe(0);
    expect(second.movedTransactions).toBe(0);
  });

  it('deshacer (undoMerge) restaura alias, movimientos, defaults y el archivado del origen', async () => {
    const source = await merchantService.create(A, { canonicalName: 'AMZN', defaultCategoryId: 'cat-source' });
    const target = await merchantService.create(A, { canonicalName: 'Amazon' });
    const sourceAlias = await merchantService.createAlias(A, source.id, { rawAlias: 'AMZN', matchType: 'contains' });
    const tx = await transactionsRepo.create(
      A,
      txInput({ concept: 'AMZN', merchantId: source.id, merchantMatchSource: 'manual', merchantMatchConfidence: 1000 }),
    );

    const result = await merchantsRepo.mergeMerchants(A, source.id, target.id);
    await merchantsRepo.undoMerge(A, result.snapshot);

    const restoredSource = await merchantsRepo.getById(A, source.id);
    expect(restoredSource!.archivedAt).toBeNull();
    const restoredTarget = await merchantsRepo.getById(A, target.id);
    expect(restoredTarget!.defaultCategoryId).toBeNull();
    const restoredAlias = await merchantAliasesRepo.getById(A, sourceAlias.id);
    expect(restoredAlias!.merchantId).toBe(source.id);
    const restoredTx = await transactionsRepo.getById(A, tx.id);
    expect(restoredTx!.merchantId).toBe(source.id);
  });

  it('no permite fusionar un comercio consigo mismo', async () => {
    const m = await merchantService.create(A, { canonicalName: 'Amazon' });
    await expect(merchantsRepo.mergeMerchants(A, m.id, m.id)).rejects.toThrow();
  });

  it('rechaza fusionar un comercio de otro perfil (aislamiento)', async () => {
    const source = await merchantService.create(A, { canonicalName: 'Amazon' });
    const targetOtherProfile = await merchantService.create(B, { canonicalName: 'Amazon' });
    await expect(merchantsRepo.mergeMerchants(A, source.id, targetOtherProfile.id)).rejects.toThrow(NotFoundError);
  });
});
