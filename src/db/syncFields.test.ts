import { describe, it, expect, beforeEach } from 'vitest';
import { db, SCHEMA_VERSION, syncDefaults } from './index';
import { profilesRepo } from './profilesRepo';
import { accountsRepo } from './accountsRepo';

// La ampliacion (fase 1) anade campos de sincronizacion de forma ADITIVA. Estos tests fijan
// el comportamiento: los repositorios pueblan los defaults y Profile gana ownerUserId=null.
beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe('campos de sincronizacion (DATA_MODEL seccion 9)', () => {
  it('SCHEMA_VERSION es 3 (esquema con campos de sync + tablas de sincronizacion)', () => {
    expect(SCHEMA_VERSION).toBe(3);
  });

  it('syncDefaults describe una fila solo local sin revision remota', () => {
    expect(syncDefaults()).toEqual({
      deletedAt: null,
      revision: 0,
      syncStatus: 'local',
      lastSyncedAt: null,
    });
  });

  it('un perfil nuevo es local y sin cuenta vinculada (ownerUserId=null)', async () => {
    const profile = await profilesRepo.create({ name: 'A', color: '#111', avatarEmoji: null });
    expect(profile.ownerUserId).toBeNull();
    expect(profile.syncStatus).toBe('local');
    expect(profile.revision).toBe(0);
    expect(profile.deletedAt).toBeNull();
    expect(profile.lastSyncedAt).toBeNull();
  });

  it('una entidad hija creada por repositorio recibe los defaults de sync', async () => {
    const account = await accountsRepo.create('perfil-1', {
      name: 'Banco',
      kind: 'bank',
      currency: 'EUR',
      color: null,
      openingBalanceCents: 0,
      archivedAt: null,
    });
    expect(account.syncStatus).toBe('local');
    expect(account.revision).toBe(0);
    expect(account.deletedAt).toBeNull();
    expect(account.lastSyncedAt).toBeNull();
  });

  it('vincular un perfil a una cuenta actualiza ownerUserId (preparado para fase 2)', async () => {
    const profile = await profilesRepo.create({ name: 'B', color: '#222', avatarEmoji: null });
    const linked = await profilesRepo.update(profile.id, { ownerUserId: 'user-123' });
    expect(linked.ownerUserId).toBe('user-123');
  });
});
