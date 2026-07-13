import { describe, it, expect, beforeEach } from 'vitest';
import { db } from './index';
import { accountsRepo } from './accountsRepo';
import { budgetsRepo } from './budgetsRepo';
import { categoriesRepo } from './categoriesRepo';
import { tagsRepo } from './tagsRepo';
import { transactionsRepo } from './transactionsRepo';
import type { NewTransaction } from './transactionsRepo';
import { settingsRepo, defaultSettingInput } from './settingsRepo';
import { profilesRepo } from './profilesRepo';
import { NotFoundError, ValidationError } from '../lib/validation';

const PROFILE_A = 'profile-a';
const PROFILE_B = 'profile-b';

// Limpia todas las tablas antes de cada test para aislar los casos.
beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

function txInput(overrides: Partial<NewTransaction> = {}): NewTransaction {
  return {
    date: '2026-01-15',
    amountCents: -1000,
    type: 'expense',
    concept: 'Compra',
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
    dedupeHash: 'hash-1',
    rawConcept: 'Compra',
    normalizedConcept: 'compra',
    normalizationVersion: 1,
    merchantId: null,
    merchantMatchSource: 'none',
    merchantMatchConfidence: 0,
    ...overrides,
  };
}

describe('CRUD basico (accountsRepo)', () => {
  it('crea, lee, actualiza y borra fijando id y timestamps', async () => {
    const created = await accountsRepo.create(PROFILE_A, {
      name: 'Banco',
      kind: 'bank',
      currency: 'EUR',
      color: null,
      openingBalanceCents: 10000,
      archivedAt: null,
    });
    expect(created.id).toBeTruthy();
    expect(created.profileId).toBe(PROFILE_A);
    expect(created.createdAt).toBeGreaterThan(0);
    expect(created.updatedAt).toBe(created.createdAt);

    const read = await accountsRepo.getById(PROFILE_A, created.id);
    expect(read?.name).toBe('Banco');

    const updated = await accountsRepo.update(PROFILE_A, created.id, { name: 'Banco Principal' });
    expect(updated.name).toBe('Banco Principal');
    expect(updated.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);

    await accountsRepo.remove(PROFILE_A, created.id);
    expect(await accountsRepo.getById(PROFILE_A, created.id)).toBeUndefined();
  });

  it('exige profileId no vacio', async () => {
    await expect(
      accountsRepo.create('', {
        name: 'X',
        kind: 'cash',
        currency: 'EUR',
        color: null,
        openingBalanceCents: 0,
        archivedAt: null,
      }),
    ).rejects.toThrow(ValidationError);
  });

  it('listActive excluye cuentas archivadas', async () => {
    await accountsRepo.create(PROFILE_A, {
      name: 'Activa',
      kind: 'bank',
      currency: 'EUR',
      color: null,
      openingBalanceCents: 0,
      archivedAt: null,
    });
    await accountsRepo.create(PROFILE_A, {
      name: 'Archivada',
      kind: 'bank',
      currency: 'EUR',
      color: null,
      openingBalanceCents: 0,
      archivedAt: Date.now(),
    });
    const active = await accountsRepo.listActive(PROFILE_A);
    expect(active).toHaveLength(1);
    expect(active[0]?.name).toBe('Activa');
  });
});

describe('Validacion de campos monetarios (*Cents enteros)', () => {
  it('rechaza openingBalanceCents no entero al crear cuenta', async () => {
    await expect(
      accountsRepo.create(PROFILE_A, {
        name: 'X',
        kind: 'bank',
        currency: 'EUR',
        color: null,
        openingBalanceCents: 100.5,
        archivedAt: null,
      }),
    ).rejects.toThrow(ValidationError);
  });

  it('rechaza limitCents no entero al crear presupuesto', async () => {
    await expect(
      budgetsRepo.create(PROFILE_A, {
        name: 'Comida',
        scope: 'overall',
        scopeId: null,
        direction: 'expense',
        limitCents: 20000.5,
        period: 'monthly',
        customStart: null,
        customEnd: null,
        rollover: false,
        archivedAt: null,
      }),
    ).rejects.toThrow(ValidationError);
  });
});

describe('Aislamiento por perfil (invariante 4)', () => {
  it('list solo devuelve datos del perfil solicitado', async () => {
    await accountsRepo.create(PROFILE_A, {
      name: 'A',
      kind: 'bank',
      currency: 'EUR',
      color: null,
      openingBalanceCents: 0,
      archivedAt: null,
    });
    await accountsRepo.create(PROFILE_B, {
      name: 'B',
      kind: 'bank',
      currency: 'EUR',
      color: null,
      openingBalanceCents: 0,
      archivedAt: null,
    });

    const aList = await accountsRepo.list(PROFILE_A);
    const bList = await accountsRepo.list(PROFILE_B);
    expect(aList).toHaveLength(1);
    expect(bList).toHaveLength(1);
    expect(aList[0]?.name).toBe('A');
    expect(bList[0]?.name).toBe('B');
  });

  it('getById con id de otro perfil se comporta como inexistente', async () => {
    const a = await accountsRepo.create(PROFILE_A, {
      name: 'A',
      kind: 'bank',
      currency: 'EUR',
      color: null,
      openingBalanceCents: 0,
      archivedAt: null,
    });
    expect(await accountsRepo.getById(PROFILE_B, a.id)).toBeUndefined();
  });

  it('update y remove de otro perfil lanzan NotFoundError (no cruzan perfiles)', async () => {
    const a = await accountsRepo.create(PROFILE_A, {
      name: 'A',
      kind: 'bank',
      currency: 'EUR',
      color: null,
      openingBalanceCents: 0,
      archivedAt: null,
    });
    await expect(accountsRepo.update(PROFILE_B, a.id, { name: 'hack' })).rejects.toThrow(
      NotFoundError,
    );
    await expect(accountsRepo.remove(PROFILE_B, a.id)).rejects.toThrow(NotFoundError);
    // El dato original no se ha tocado.
    expect((await accountsRepo.getById(PROFILE_A, a.id))?.name).toBe('A');
  });

  it('las queries de movimientos por indice filtran por profileId', async () => {
    await transactionsRepo.create(PROFILE_A, txInput({ dedupeHash: 'h', tagIds: ['t1'] }));
    await transactionsRepo.create(PROFILE_B, txInput({ dedupeHash: 'h', tagIds: ['t1'] }));

    expect(await transactionsRepo.list(PROFILE_A)).toHaveLength(1);
    expect(await transactionsRepo.listByDateRange(PROFILE_A, '2026-01-01', '2026-12-31')).toHaveLength(
      1,
    );
    expect(await transactionsRepo.listByDedupeHash(PROFILE_A, 'h')).toHaveLength(1);
    expect(await transactionsRepo.listByTag(PROFILE_A, 't1')).toHaveLength(1);
    expect(await transactionsRepo.listForStats(PROFILE_A)).toHaveLength(1);
  });
});

describe('Integridad de Transaction', () => {
  it('deriva statsFlag como espejo de excludedFromStats', async () => {
    const included = await transactionsRepo.create(PROFILE_A, txInput({ excludedFromStats: false }));
    const excluded = await transactionsRepo.create(
      PROFILE_A,
      txInput({ excludedFromStats: true, dedupeHash: 'h2' }),
    );
    expect(included.statsFlag).toBe(0);
    expect(excluded.statsFlag).toBe(1);

    const reincluded = await transactionsRepo.update(PROFILE_A, excluded.id, {
      excludedFromStats: false,
    });
    expect(reincluded.statsFlag).toBe(0);
  });

  it('listForStats solo trae los movimientos que cuentan (statsFlag = 0)', async () => {
    await transactionsRepo.create(PROFILE_A, txInput({ dedupeHash: 'a', excludedFromStats: false }));
    await transactionsRepo.create(PROFILE_A, txInput({ dedupeHash: 'b', excludedFromStats: true }));
    const stats = await transactionsRepo.listForStats(PROFILE_A);
    expect(stats).toHaveLength(1);
    expect(stats[0]?.excludedFromStats).toBe(false);
  });

  it('rechaza signo incoherente con el tipo', async () => {
    await expect(
      transactionsRepo.create(PROFILE_A, txInput({ type: 'expense', amountCents: 500 })),
    ).rejects.toThrow(ValidationError);
    await expect(
      transactionsRepo.create(PROFILE_A, txInput({ type: 'income', amountCents: -500 })),
    ).rejects.toThrow(ValidationError);
  });

  it('rechaza importes no enteros', async () => {
    await expect(
      transactionsRepo.create(PROFILE_A, txInput({ amountCents: -10.5 })),
    ).rejects.toThrow(ValidationError);
  });

  it('rechaza fechas que no sean YYYY-MM-DD reales', async () => {
    for (const bad of ['15/01/2026', '2026-13-01', '2026-02-30', '']) {
      await expect(transactionsRepo.create(PROFILE_A, txInput({ date: bad }))).rejects.toThrow(
        ValidationError,
      );
    }
  });

  it('exige coherencia entre categorizedBy y ruleId', async () => {
    await expect(
      transactionsRepo.create(PROFILE_A, txInput({ categorizedBy: 'rule', ruleId: null })),
    ).rejects.toThrow(ValidationError);
    await expect(
      transactionsRepo.create(PROFILE_A, txInput({ categorizedBy: 'manual', ruleId: 'r1' })),
    ).rejects.toThrow(ValidationError);
    // Combinacion valida.
    const ok = await transactionsRepo.create(
      PROFILE_A,
      txInput({ categorizedBy: 'rule', ruleId: 'r1' }),
    );
    expect(ok.ruleId).toBe('r1');
  });
});

describe('categoriesRepo: anidamiento de un solo nivel', () => {
  it('permite subcategoria bajo una categoria raiz', async () => {
    const root = await categoriesRepo.create(PROFILE_A, {
      name: 'Hogar',
      parentId: null,
      kind: 'expense',
      color: null,
      icon: null,
      archivedAt: null,
      sortOrder: 0,
    });
    const sub = await categoriesRepo.create(PROFILE_A, {
      name: 'Luz',
      parentId: root.id,
      kind: 'expense',
      color: null,
      icon: null,
      archivedAt: null,
      sortOrder: 0,
    });
    expect(sub.parentId).toBe(root.id);
    expect(await categoriesRepo.listRoots(PROFILE_A)).toHaveLength(1);
    expect(await categoriesRepo.listChildren(PROFILE_A, root.id)).toHaveLength(1);
  });

  it('rechaza subcategoria colgando de otra subcategoria', async () => {
    const root = await categoriesRepo.create(PROFILE_A, {
      name: 'Hogar',
      parentId: null,
      kind: 'expense',
      color: null,
      icon: null,
      archivedAt: null,
      sortOrder: 0,
    });
    const sub = await categoriesRepo.create(PROFILE_A, {
      name: 'Luz',
      parentId: root.id,
      kind: 'expense',
      color: null,
      icon: null,
      archivedAt: null,
      sortOrder: 0,
    });
    await expect(
      categoriesRepo.create(PROFILE_A, {
        name: 'Nieta',
        parentId: sub.id,
        kind: 'expense',
        color: null,
        icon: null,
        archivedAt: null,
        sortOrder: 0,
      }),
    ).rejects.toThrow(ValidationError);
  });

  it('rechaza padre de otro perfil', async () => {
    const rootB = await categoriesRepo.create(PROFILE_B, {
      name: 'Hogar',
      parentId: null,
      kind: 'expense',
      color: null,
      icon: null,
      archivedAt: null,
      sortOrder: 0,
    });
    await expect(
      categoriesRepo.create(PROFILE_A, {
        name: 'Luz',
        parentId: rootB.id,
        kind: 'expense',
        color: null,
        icon: null,
        archivedAt: null,
        sortOrder: 0,
      }),
    ).rejects.toThrow(ValidationError);
  });
});

describe('tagsRepo: nombre unico por perfil', () => {
  it('rechaza nombres duplicados (normalizados) en el mismo perfil', async () => {
    await tagsRepo.create(PROFILE_A, { name: 'Viajes', color: null });
    await expect(tagsRepo.create(PROFILE_A, { name: '  viajes  ', color: null })).rejects.toThrow(
      ValidationError,
    );
    // El mismo nombre en otro perfil si se permite (aislamiento).
    const b = await tagsRepo.create(PROFILE_B, { name: 'Viajes', color: null });
    expect(b.name).toBe('Viajes');
  });
});

describe('settingsRepo: 1:1 por perfil', () => {
  it('crea con defaults y actualiza', async () => {
    const created = await settingsRepo.create(PROFILE_A, defaultSettingInput());
    expect(created.currency).toBe('EUR');
    expect(created.encryptionEnabled).toBe(false);

    const updated = await settingsRepo.update(PROFILE_A, { locale: 'en-GB' });
    expect(updated.locale).toBe('en-GB');
    expect((await settingsRepo.getByProfile(PROFILE_A))?.locale).toBe('en-GB');
  });
});

describe('profilesRepo: borrado en cascada', () => {
  it('removeCascade borra el perfil y todas sus entidades hijas, sin tocar otros perfiles', async () => {
    const a = await profilesRepo.create({ name: 'A', color: '#111', avatarEmoji: null });
    const b = await profilesRepo.create({ name: 'B', color: '#222', avatarEmoji: null });

    await settingsRepo.create(a.id, defaultSettingInput());
    await accountsRepo.create(a.id, {
      name: 'Banco A',
      kind: 'bank',
      currency: 'EUR',
      color: null,
      openingBalanceCents: 0,
      archivedAt: null,
    });
    await transactionsRepo.create(a.id, txInput());

    await settingsRepo.create(b.id, defaultSettingInput());
    await transactionsRepo.create(b.id, txInput({ dedupeHash: 'hb' }));

    await profilesRepo.removeCascade(a.id);

    expect(await profilesRepo.getById(a.id)).toBeUndefined();
    expect(await accountsRepo.count(a.id)).toBe(0);
    expect(await transactionsRepo.count(a.id)).toBe(0);
    expect(await settingsRepo.getByProfile(a.id)).toBeUndefined();

    // El perfil B queda intacto.
    expect(await profilesRepo.getById(b.id)).toBeDefined();
    expect(await transactionsRepo.count(b.id)).toBe(1);
    expect(await settingsRepo.getByProfile(b.id)).toBeDefined();
  });
});
