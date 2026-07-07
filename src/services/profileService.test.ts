import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db';
import { profileService, normalizeProfileName } from './profileService';
import { settingsRepo } from '../db/settingsRepo';
import { accountsRepo } from '../db/accountsRepo';
import { transactionsRepo } from '../db/transactionsRepo';
import type { NewTransaction } from '../db/transactionsRepo';
import { profilesRepo } from '../db/profilesRepo';
import { ValidationError } from '../lib/validation';

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  localStorage.clear();
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
    ...overrides,
  };
}

describe('normalizeProfileName', () => {
  it('recorta, colapsa espacios y exige contenido', () => {
    expect(normalizeProfileName('  Personal  ')).toBe('Personal');
    expect(normalizeProfileName('Cuenta   conjunta')).toBe('Cuenta conjunta');
    expect(() => normalizeProfileName('   ')).toThrow(ValidationError);
    expect(() => normalizeProfileName('')).toThrow(ValidationError);
  });

  it('rechaza nombres demasiado largos', () => {
    expect(() => normalizeProfileName('x'.repeat(61))).toThrow(ValidationError);
  });
});

describe('createProfile', () => {
  it('crea el perfil y su configuracion por defecto', async () => {
    const profile = await profileService.createProfile({ name: 'Personal' });
    expect(profile.id).toBeTruthy();
    expect(profile.name).toBe('Personal');
    expect(profile.color).toBeTruthy();

    const setting = await settingsRepo.getByProfile(profile.id);
    expect(setting).toBeDefined();
    expect(setting?.currency).toBe('EUR');
    expect(setting?.encryptionEnabled).toBe(false);
  });

  it('normaliza el nombre y rechaza el vacio', async () => {
    const profile = await profileService.createProfile({ name: '  Hogar  ' });
    expect(profile.name).toBe('Hogar');
    await expect(profileService.createProfile({ name: '   ' })).rejects.toThrow(ValidationError);
  });

  it('asigna colores por defecto variados a los primeros perfiles', async () => {
    const a = await profileService.createProfile({ name: 'A' });
    const b = await profileService.createProfile({ name: 'B' });
    expect(a.color).not.toBe(b.color);
  });
});

describe('updateProfile / renameProfile', () => {
  it('renombra validando el nombre', async () => {
    const profile = await profileService.createProfile({ name: 'Viejo' });
    const renamed = await profileService.renameProfile(profile.id, '  Nuevo  ');
    expect(renamed.name).toBe('Nuevo');
    await expect(profileService.renameProfile(profile.id, '')).rejects.toThrow(ValidationError);
  });

  it('edita color y avatar', async () => {
    const profile = await profileService.createProfile({ name: 'X' });
    const updated = await profileService.updateProfile(profile.id, {
      color: '#123456',
      avatarEmoji: '🏠',
    });
    expect(updated.color).toBe('#123456');
    expect(updated.avatarEmoji).toBe('🏠');
  });
});

describe('perfil activo (localStorage)', () => {
  it('set / get / clear', () => {
    expect(profileService.getActiveProfileId()).toBeNull();
    profileService.setActiveProfileId('p1');
    expect(profileService.getActiveProfileId()).toBe('p1');
    profileService.clearActiveProfileId();
    expect(profileService.getActiveProfileId()).toBeNull();
  });

  it('resolveActiveProfile devuelve el perfil guardado si existe', async () => {
    const profile = await profileService.createProfile({ name: 'Personal' });
    profileService.setActiveProfileId(profile.id);
    const resolved = await profileService.resolveActiveProfile();
    expect(resolved?.id).toBe(profile.id);
  });

  it('resolveActiveProfile limpia el id obsoleto si el perfil ya no existe', async () => {
    profileService.setActiveProfileId('inexistente');
    const resolved = await profileService.resolveActiveProfile();
    expect(resolved).toBeNull();
    expect(profileService.getActiveProfileId()).toBeNull();
  });
});

describe('deleteProfile', () => {
  it('borra el perfil en cascada y limpia el id activo si era el activo', async () => {
    const profile = await profileService.createProfile({ name: 'Temporal' });
    await accountsRepo.create(profile.id, {
      name: 'Banco',
      kind: 'bank',
      currency: 'EUR',
      color: null,
      openingBalanceCents: 0,
      archivedAt: null,
    });
    profileService.setActiveProfileId(profile.id);

    await profileService.deleteProfile(profile.id);

    expect(await profilesRepo.getById(profile.id)).toBeUndefined();
    expect(await accountsRepo.count(profile.id)).toBe(0);
    expect(await settingsRepo.getByProfile(profile.id)).toBeUndefined();
    // El id activo se limpia porque el perfil borrado era el activo.
    expect(profileService.getActiveProfileId()).toBeNull();
  });

  it('no toca el id activo si se borra un perfil distinto del activo', async () => {
    const a = await profileService.createProfile({ name: 'A' });
    const b = await profileService.createProfile({ name: 'B' });
    profileService.setActiveProfileId(a.id);
    await profileService.deleteProfile(b.id);
    expect(profileService.getActiveProfileId()).toBe(a.id);
  });
});

describe('aislamiento entre perfiles (invariante 4)', () => {
  it('los datos creados en un perfil no aparecen al consultar el otro', async () => {
    const a = await profileService.createProfile({ name: 'Perfil A' });
    const b = await profileService.createProfile({ name: 'Perfil B' });

    // Datos en A.
    await accountsRepo.create(a.id, {
      name: 'Cuenta A',
      kind: 'bank',
      currency: 'EUR',
      color: null,
      openingBalanceCents: 0,
      archivedAt: null,
    });
    await transactionsRepo.create(a.id, txInput({ concept: 'Gasto A', dedupeHash: 'ha' }));
    await transactionsRepo.create(a.id, txInput({ concept: 'Gasto A2', dedupeHash: 'ha2' }));

    // Datos en B.
    await transactionsRepo.create(b.id, txInput({ concept: 'Gasto B', dedupeHash: 'hb' }));

    // Cada perfil solo ve lo suyo.
    const txA = await transactionsRepo.list(a.id);
    const txB = await transactionsRepo.list(b.id);
    expect(txA).toHaveLength(2);
    expect(txB).toHaveLength(1);
    expect(txA.every((t) => t.profileId === a.id)).toBe(true);
    expect(txB.every((t) => t.profileId === b.id)).toBe(true);
    expect(txA.map((t) => t.concept)).not.toContain('Gasto B');

    // Cuentas: A tiene una, B ninguna.
    expect(await accountsRepo.list(a.id)).toHaveLength(1);
    expect(await accountsRepo.list(b.id)).toHaveLength(0);

    // Un perfil recien creado esta vacio (estado vacio cuidado).
    expect(await transactionsRepo.count(b.id)).toBe(1);
    const c = await profileService.createProfile({ name: 'Perfil C vacio' });
    expect(await transactionsRepo.count(c.id)).toBe(0);
    expect(await accountsRepo.count(c.id)).toBe(0);
  });

  it('borrar un perfil no afecta a los datos de otro', async () => {
    const a = await profileService.createProfile({ name: 'A' });
    const b = await profileService.createProfile({ name: 'B' });
    await transactionsRepo.create(a.id, txInput({ dedupeHash: 'ha' }));
    await transactionsRepo.create(b.id, txInput({ dedupeHash: 'hb' }));

    await profileService.deleteProfile(a.id);

    expect(await transactionsRepo.count(a.id)).toBe(0);
    // B intacto.
    expect(await transactionsRepo.count(b.id)).toBe(1);
    expect(await settingsRepo.getByProfile(b.id)).toBeDefined();
    expect(await profilesRepo.getById(b.id)).toBeDefined();
  });
});
