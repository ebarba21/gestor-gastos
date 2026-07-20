import { describe, it, expect, beforeEach } from 'vitest';
import { db } from './index';
import { reviewItemsRepo } from './reviewItemsRepo';
import { reconciliationsRepo } from './reconciliationsRepo';
import { NotFoundError } from '../lib/validation';

const PROFILE_A = 'profile-a';
const PROFILE_B = 'profile-b';

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe('reviewItemsRepo', () => {
  it('crea, lee y actualiza fijando profileId, timestamps y defaults de sync', async () => {
    const created = await reviewItemsRepo.create(PROFILE_A, {
      type: 'uncategorized',
      entityType: 'transaction',
      entityId: 'tx-1',
      confidence: 0,
      reasonCodes: [],
      metadata: {},
      status: 'open',
      resolution: null,
      resolvedAt: null,
    });
    expect(created.profileId).toBe(PROFILE_A);
    expect(created.syncStatus).toBe('local');
    expect(created.revision).toBe(0);

    const read = await reviewItemsRepo.getById(PROFILE_A, created.id);
    expect(read?.type).toBe('uncategorized');

    const updated = await reviewItemsRepo.update(PROFILE_A, created.id, { status: 'resolved' });
    expect(updated.status).toBe('resolved');
  });

  it('aisla por perfil: un id de otro perfil se comporta como inexistente', async () => {
    const created = await reviewItemsRepo.create(PROFILE_A, {
      type: 'uncategorized',
      entityType: 'transaction',
      entityId: 'tx-1',
      confidence: 0,
      reasonCodes: [],
      metadata: {},
      status: 'open',
      resolution: null,
      resolvedAt: null,
    });
    const readFromOther = await reviewItemsRepo.getById(PROFILE_B, created.id);
    expect(readFromOther).toBeUndefined();
    await expect(reviewItemsRepo.update(PROFILE_B, created.id, { status: 'resolved' })).rejects.toThrow(
      NotFoundError,
    );
  });

  it('bulkUpdateStatus aplica el patch a todos los ids en una sola operacion', async () => {
    const a = await reviewItemsRepo.create(PROFILE_A, {
      type: 'uncategorized',
      entityType: 'transaction',
      entityId: 'tx-1',
      confidence: 0,
      reasonCodes: [],
      metadata: {},
      status: 'open',
      resolution: null,
      resolvedAt: null,
    });
    const b = await reviewItemsRepo.create(PROFILE_A, {
      type: 'newMerchant',
      entityType: 'transaction',
      entityId: 'tx-2',
      confidence: 0,
      reasonCodes: [],
      metadata: {},
      status: 'open',
      resolution: null,
      resolvedAt: null,
    });
    const updated = await reviewItemsRepo.bulkUpdateStatus(PROFILE_A, [a.id, b.id], {
      status: 'dismissed',
      resolution: 'bulk:dismissed',
    });
    expect(updated).toHaveLength(2);
    expect(updated.every((r) => r.status === 'dismissed' && r.resolvedAt !== null)).toBe(true);
  });

  it('findOpenByTypeAndEntity solo encuentra tareas en estado open', async () => {
    const created = await reviewItemsRepo.create(PROFILE_A, {
      type: 'stalePending',
      entityType: 'transaction',
      entityId: 'tx-3',
      confidence: 0,
      reasonCodes: [],
      metadata: {},
      status: 'open',
      resolution: null,
      resolvedAt: null,
    });
    await reviewItemsRepo.update(PROFILE_A, created.id, { status: 'resolved' });
    const open = await reviewItemsRepo.findOpenByTypeAndEntity(PROFILE_A, 'stalePending', 'tx-3');
    expect(open).toBeUndefined();
    const latest = await reviewItemsRepo.findLatestByTypeAndEntity(PROFILE_A, 'stalePending', 'tx-3');
    expect(latest?.id).toBe(created.id);
  });
});

describe('reconciliationsRepo', () => {
  it('crea y lista por cuenta, aislado por perfil', async () => {
    await reconciliationsRepo.create(PROFILE_A, {
      accountId: 'acc-1',
      statementDate: '2026-01-15',
      statementBalanceCents: 1000,
      computedBalanceCents: 1000,
      differenceCents: 0,
      status: 'balanced',
      notes: null,
    });
    await reconciliationsRepo.create(PROFILE_B, {
      accountId: 'acc-1',
      statementDate: '2026-01-15',
      statementBalanceCents: 500,
      computedBalanceCents: 500,
      differenceCents: 0,
      status: 'balanced',
      notes: null,
    });
    const listA = await reconciliationsRepo.listByAccount(PROFILE_A, 'acc-1');
    expect(listA).toHaveLength(1);
    expect(listA[0].statementBalanceCents).toBe(1000);
  });

  it('listRecent ordena por fecha de extracto descendente', async () => {
    await reconciliationsRepo.create(PROFILE_A, {
      accountId: 'acc-1',
      statementDate: '2026-01-01',
      statementBalanceCents: 0,
      computedBalanceCents: 0,
      differenceCents: 0,
      status: 'balanced',
      notes: null,
    });
    await reconciliationsRepo.create(PROFILE_A, {
      accountId: 'acc-1',
      statementDate: '2026-03-01',
      statementBalanceCents: 0,
      computedBalanceCents: 0,
      differenceCents: 0,
      status: 'balanced',
      notes: null,
    });
    const recent = await reconciliationsRepo.listRecent(PROFILE_A);
    expect(recent[0].statementDate).toBe('2026-03-01');
    expect(recent[1].statementDate).toBe('2026-01-01');
  });

  it('latestForAccount devuelve la mas reciente o undefined si no hay ninguna', async () => {
    expect(await reconciliationsRepo.latestForAccount(PROFILE_A, 'acc-x')).toBeUndefined();
    await reconciliationsRepo.create(PROFILE_A, {
      accountId: 'acc-x',
      statementDate: '2026-02-01',
      statementBalanceCents: 0,
      computedBalanceCents: 0,
      differenceCents: 0,
      status: 'balanced',
      notes: null,
    });
    const latest = await reconciliationsRepo.latestForAccount(PROFILE_A, 'acc-x');
    expect(latest?.statementDate).toBe('2026-02-01');
  });
});
