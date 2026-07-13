import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db';
import { profilesRepo } from '../db/profilesRepo';
import { settingsRepo } from '../db/settingsRepo';
import { accountsRepo } from '../db/accountsRepo';
import { categoriesRepo } from '../db/categoriesRepo';
import { tagsRepo } from '../db/tagsRepo';
import { transactionsRepo } from '../db/transactionsRepo';
import type { NewTransaction } from '../db/transactionsRepo';
import { rulesRepo } from '../db/rulesRepo';
import { budgetsRepo } from '../db/budgetsRepo';
import { importTemplatesRepo } from '../db/importTemplatesRepo';
import { importBatchesRepo } from '../db/importBatchesRepo';
import { backupRepo } from '../db/backupRepo';
import {
  backupService,
  parseBackup,
  remapProfileData,
  BackupError,
  BACKUP_APP,
  BACKUP_KIND,
  BACKUP_FORMAT_VERSION,
} from './backupService';
import { SCHEMA_VERSION } from '../db/index';
import { pinService } from '../security/pinService';
import { __resetForTests as __resetSessionStorageForTests } from '../security/encryptedSessionStorage';

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  __resetSessionStorageForTests();
});

function txInput(overrides: Partial<NewTransaction> = {}): NewTransaction {
  return {
    date: '2026-01-15',
    amountCents: -1000,
    type: 'expense',
    concept: 'Compra',
    notes: null,
    accountId: 'acc-x',
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
    dedupeHash: 'hash',
    ...overrides,
  };
}

// Siembra un perfil con datos ricos en referencias cruzadas: transferencia (2 patas), split
// (padre + hijas), reembolso, movimiento categorizado por regla y etiquetado, presupuesto,
// plantilla y lote de importacion. Devuelve el profileId y algunas referencias para asertar.
async function seedRichProfile(name: string) {
  const profile = await profilesRepo.create({ name, color: '#123456', avatarEmoji: null });
  const pid = profile.id;

  const acc1 = await accountsRepo.create(pid, {
    name: 'Banco',
    kind: 'bank',
    currency: 'EUR',
    color: null,
    openingBalanceCents: 10000,
    archivedAt: null,
  });
  const acc2 = await accountsRepo.create(pid, {
    name: 'Efectivo',
    kind: 'cash',
    currency: 'EUR',
    color: null,
    openingBalanceCents: 0,
    archivedAt: null,
  });

  await settingsRepo.create(pid, {
    currency: 'EUR',
    locale: 'es-ES',
    weekStart: 'monday',
    defaultAccountId: acc1.id,
    encryptionEnabled: false,
  });

  const catRoot = await categoriesRepo.create(pid, {
    name: 'Alimentacion',
    parentId: null,
    kind: 'expense',
    color: null,
    icon: null,
    archivedAt: null,
    sortOrder: 0,
  });
  const catSub = await categoriesRepo.create(pid, {
    name: 'Supermercado',
    parentId: catRoot.id,
    kind: 'expense',
    color: null,
    icon: null,
    archivedAt: null,
    sortOrder: 0,
  });

  const tag1 = await tagsRepo.create(pid, { name: 'basico', color: null });

  const rule1 = await rulesRepo.create(pid, {
    name: 'Regla super',
    enabled: true,
    priority: 1,
    matchMode: 'all',
    conditions: [
      { field: 'concept', operator: 'contains', value: 'super', value2: null, caseSensitive: false },
      { field: 'account', operator: 'equals', value: acc1.id, value2: null, caseSensitive: false },
    ],
    action: {
      setCategoryId: catRoot.id,
      setSubcategoryId: catSub.id,
      addTagIds: [tag1.id],
      setExcludedFromStats: null,
    },
    stopOnMatch: true,
  });

  const tplt = await importTemplatesRepo.create(pid, {
    name: 'Banco X',
    sourceFormat: 'csv',
    columnMap: { date: 0, concept: 1, amount: 2, debit: null, credit: null, account: null, notes: null },
    dateFormat: 'dd/MM/yyyy',
    decimalSeparator: ',',
    thousandSeparator: '.',
    amountStrategy: 'signed',
    defaultAccountId: acc1.id,
    hasHeaderRow: true,
  });
  const batch = await importBatchesRepo.create(pid, {
    templateId: tplt.id,
    fileName: 'extracto.csv',
    importedAt: Date.now(),
    rowsTotal: 5,
    rowsImported: 4,
    rowsSkippedDuplicate: 1,
    status: 'committed',
  });

  // Movimiento categorizado por regla, etiquetado y de un lote de importacion.
  const txRule = await transactionsRepo.create(
    pid,
    txInput({
      concept: 'Compra super',
      accountId: acc1.id,
      categoryId: catRoot.id,
      subcategoryId: catSub.id,
      tagIds: [tag1.id],
      categorizedBy: 'rule',
      ruleId: rule1.id,
      importBatchId: batch.id,
      amountCents: -2500,
    }),
  );

  // Transferencia interna: dos patas con el mismo transferGroupId (aqui un valor cualquiera).
  const grp = 'transfer-group-original';
  const txOut = await transactionsRepo.create(
    pid,
    txInput({
      concept: 'Traspaso salida',
      accountId: acc1.id,
      type: 'transfer',
      amountCents: -5000,
      transferGroupId: grp,
      excludedFromStats: true,
    }),
  );
  const txIn = await transactionsRepo.create(
    pid,
    txInput({
      concept: 'Traspaso entrada',
      accountId: acc2.id,
      type: 'transfer',
      amountCents: 5000,
      transferGroupId: grp,
      excludedFromStats: true,
    }),
  );

  // Split: padre excluido + dos hijas que suman el importe del padre.
  const parent = await transactionsRepo.create(
    pid,
    txInput({ concept: 'Compra grande', accountId: acc1.id, amountCents: -3000, isSplitParent: true, excludedFromStats: true }),
  );
  const child1 = await transactionsRepo.create(
    pid,
    txInput({ concept: 'Parte A', accountId: acc1.id, amountCents: -1000, categoryId: catRoot.id, parentId: parent.id }),
  );
  const child2 = await transactionsRepo.create(
    pid,
    txInput({ concept: 'Parte B', accountId: acc1.id, amountCents: -2000, categoryId: catSub.id, parentId: parent.id }),
  );

  // Reembolso de un gasto original.
  const orig = await transactionsRepo.create(
    pid,
    txInput({ concept: 'Gasto reembolsable', accountId: acc1.id, amountCents: -2000, categoryId: catRoot.id }),
  );
  const refund = await transactionsRepo.create(
    pid,
    txInput({ concept: 'Devolucion', accountId: acc1.id, type: 'income', amountCents: 500, refundOfId: orig.id }),
  );

  await budgetsRepo.create(pid, {
    name: 'Limite alimentacion',
    scope: 'category',
    scopeId: catRoot.id,
    direction: 'expense',
    limitCents: 30000,
    period: 'monthly',
    customStart: null,
    customEnd: null,
    rollover: false,
    archivedAt: null,
  });

  return {
    pid,
    acc1,
    acc2,
    catRoot,
    catSub,
    tag1,
    rule1,
    tplt,
    batch,
    ids: {
      txRule: txRule.id,
      txOut: txOut.id,
      txIn: txIn.id,
      parent: parent.id,
      child1: child1.id,
      child2: child2.id,
      orig: orig.id,
      refund: refund.id,
    },
    grp,
  };
}

describe('createBackup y aislamiento por perfil', () => {
  it('un backup contiene SOLO datos del perfil activo', async () => {
    const a = await seedRichProfile('Perfil A');
    const b = await seedRichProfile('Perfil B');

    const backup = await backupService.createBackup(a.pid);

    // El envelope apunta al perfil A.
    expect(backup.app).toBe(BACKUP_APP);
    expect(backup.kind).toBe(BACKUP_KIND);
    expect(backup.schemaVersion).toBe(SCHEMA_VERSION);
    expect(backup.profile.id).toBe(a.pid);

    // Toda fila del backup pertenece a A; ninguna a B.
    const allRows = [
      ...backup.data.settings,
      ...backup.data.accounts,
      ...backup.data.categories,
      ...backup.data.tags,
      ...backup.data.transactions,
      ...backup.data.rules,
      ...backup.data.budgets,
      ...backup.data.importTemplates,
      ...backup.data.importBatches,
    ];
    expect(allRows.length).toBeGreaterThan(0);
    for (const row of allRows) {
      expect(row.profileId).toBe(a.pid);
      expect(row.profileId).not.toBe(b.pid);
    }

    // Los recuentos coinciden con los del perfil A (no arrastran nada de B).
    expect(backup.data.transactions).toHaveLength(8);
    expect(backup.data.accounts).toHaveLength(2);
    expect(backup.data.categories).toHaveLength(2);
    expect(backup.data.rules).toHaveLength(1);
    expect(backup.data.budgets).toHaveLength(1);
    expect(backup.data.settings).toHaveLength(1);
    expect(backup.data.importTemplates).toHaveLength(1);
    expect(backup.data.importBatches).toHaveLength(1);
  });
});

describe('ida y vuelta: backup + restauracion dejan los datos identicos', () => {
  it('restaura en un perfil nuevo preservando importes, relaciones y semantica', async () => {
    const a = await seedRichProfile('Perfil A');
    const backup = await backupService.createBackup(a.pid);
    // Pasa por serializacion/parseo, como haria un fichero real.
    const parsed = backupService.parseBackup(backupService.serializeBackup(backup));

    const newProfile = await backupService.restoreAsNewProfile(parsed);
    expect(newProfile.id).not.toBe(a.pid);
    expect(newProfile.name).toContain('(restaurado)');

    const snap = await backupRepo.readProfileData(newProfile.id);
    const d = snap.data;

    // Recuentos identicos por tabla.
    expect(d.transactions).toHaveLength(8);
    expect(d.accounts).toHaveLength(2);
    expect(d.categories).toHaveLength(2);
    expect(d.tags).toHaveLength(1);
    expect(d.rules).toHaveLength(1);
    expect(d.budgets).toHaveLength(1);
    expect(d.settings).toHaveLength(1);
    expect(d.importTemplates).toHaveLength(1);
    expect(d.importBatches).toHaveLength(1);

    // Todo pertenece al perfil nuevo; los ids se regeneraron (no colisionan con el original).
    for (const t of d.transactions) {
      expect(t.profileId).toBe(newProfile.id);
      expect(t.id).not.toBe(a.ids.txRule);
    }

    // Suma total de importes preservada.
    const totalA = backup.data.transactions.reduce((s, t) => s + t.amountCents, 0);
    const totalB = d.transactions.reduce((s, t) => s + t.amountCents, 0);
    expect(totalB).toBe(totalA);

    // Los flags financieros sobreviven al ciclo: multiconjunto de (type, excluido, statsFlag,
    // isSplitParent) identico entre origen y restaurado (independiente de ids).
    const signature = (t: (typeof d.transactions)[number]) =>
      `${t.amountCents}|${t.type}|${t.excludedFromStats}|${t.statsFlag}|${t.isSplitParent}`;
    const sigA = backup.data.transactions.map(signature).sort();
    const sigB = d.transactions.map(signature).sort();
    expect(sigB).toEqual(sigA);
    // Coherencia del espejo indexable: statsFlag = 1 exactamente cuando excluido.
    for (const t of d.transactions) {
      expect(t.statsFlag).toBe(t.excludedFromStats ? 1 : 0);
    }

    // Subcategoria: su parentId apunta a la categoria raiz restaurada.
    const rootB = d.categories.find((c) => c.parentId === null)!;
    const subB = d.categories.find((c) => c.parentId !== null)!;
    expect(subB.parentId).toBe(rootB.id);

    // Ajuste: defaultAccountId apunta a una cuenta existente del perfil restaurado.
    const accountIds = new Set(d.accounts.map((acc) => acc.id));
    expect(accountIds.has(d.settings[0]!.defaultAccountId!)).toBe(true);

    // Transferencia: exactamente 2 patas con el mismo grupo (nuevo), importes opuestos.
    const grouped = d.transactions.filter((t) => t.transferGroupId !== null);
    expect(grouped).toHaveLength(2);
    const groups = new Set(grouped.map((t) => t.transferGroupId));
    expect(groups.size).toBe(1);
    expect([...groups][0]).not.toBe(a.grp); // el grupo se remapeo
    expect(grouped.reduce((s, t) => s + t.amountCents, 0)).toBe(0);

    // Split: el padre tiene 2 hijas que suman su importe.
    const parentB = d.transactions.find((t) => t.isSplitParent)!;
    const childrenB = d.transactions.filter((t) => t.parentId === parentB.id);
    expect(childrenB).toHaveLength(2);
    expect(childrenB.reduce((s, t) => s + t.amountCents, 0)).toBe(parentB.amountCents);

    // Reembolso: refundOfId apunta a un movimiento existente del perfil restaurado.
    const refundB = d.transactions.find((t) => t.refundOfId !== null)!;
    const txIds = new Set(d.transactions.map((t) => t.id));
    expect(txIds.has(refundB.refundOfId!)).toBe(true);

    // Regla: el movimiento categorizado por regla apunta a una regla existente y con etiqueta.
    const ruleTxB = d.transactions.find((t) => t.categorizedBy === 'rule')!;
    expect(d.rules.some((r) => r.id === ruleTxB.ruleId)).toBe(true);
    const tagIds = new Set(d.tags.map((t) => t.id));
    expect(ruleTxB.tagIds.every((id) => tagIds.has(id))).toBe(true);

    // Regla: la condicion de cuenta y la accion apuntan a entidades restauradas.
    const ruleB = d.rules[0]!;
    const accCond = ruleB.conditions.find((c) => c.field === 'account')!;
    expect(accountIds.has(accCond.value as string)).toBe(true);
    const categoryIds = new Set(d.categories.map((c) => c.id));
    expect(categoryIds.has(ruleB.action.setCategoryId!)).toBe(true);

    // Presupuesto: su scopeId apunta a la categoria raiz restaurada.
    expect(d.budgets[0]!.scope).toBe('category');
    expect(categoryIds.has(d.budgets[0]!.scopeId!)).toBe(true);

    // Lote de importacion: templateId y el movimiento importado apuntan a entidades restauradas.
    const templateIds = new Set(d.importTemplates.map((t) => t.id));
    expect(templateIds.has(d.importBatches[0]!.templateId!)).toBe(true);
    const batchIds = new Set(d.importBatches.map((b) => b.id));
    const importedTx = d.transactions.find((t) => t.importBatchId !== null)!;
    expect(batchIds.has(importedTx.importBatchId!)).toBe(true);
  });

  it('el perfil original queda intacto tras restaurar como perfil nuevo', async () => {
    const a = await seedRichProfile('Perfil A');
    const backup = await backupService.createBackup(a.pid);
    await backupService.restoreAsNewProfile(backup);
    const original = await backupRepo.readProfileData(a.pid);
    expect(original.data.transactions).toHaveLength(8);
    // Los ids del original no cambian.
    expect(original.data.transactions.some((t) => t.id === a.ids.txRule)).toBe(true);
  });

  it('sobrescribe el perfil activo reemplazando por completo sus datos', async () => {
    const a = await seedRichProfile('Perfil A');
    const backup = await backupService.createBackup(a.pid);

    // Perfil destino con datos propios distintos.
    const dest = await profilesRepo.create({ name: 'Destino', color: '#999999', avatarEmoji: null });
    const destAcc = await accountsRepo.create(dest.id, {
      name: 'Otra cuenta',
      kind: 'bank',
      currency: 'EUR',
      color: null,
      openingBalanceCents: 0,
      archivedAt: null,
    });
    await transactionsRepo.create(dest.id, txInput({ accountId: destAcc.id, concept: 'Basura previa' }));

    await backupService.restoreIntoActiveProfile(dest.id, backup);

    const snap = await backupRepo.readProfileData(dest.id);
    // Se conserva la identidad del perfil destino (nombre/color).
    expect(snap.profile.name).toBe('Destino');
    // Los datos son ahora los del backup (no queda nada del destino previo).
    expect(snap.data.transactions).toHaveLength(8);
    expect(snap.data.transactions.some((t) => t.concept === 'Basura previa')).toBe(false);
    for (const row of snap.data.transactions) {
      expect(row.profileId).toBe(dest.id);
    }
  });
});

describe('validacion de archivos corruptos o de version incompatible', () => {
  it('rechaza un JSON invalido', () => {
    expect(() => parseBackup('esto no es json {')).toThrow(BackupError);
  });

  it('rechaza un archivo que no es un backup de la app', () => {
    const text = JSON.stringify({ app: 'otra-cosa', kind: 'algo' });
    expect(() => parseBackup(text)).toThrow(BackupError);
  });

  it('rechaza un formato de backup incompatible', () => {
    const text = JSON.stringify({
      app: BACKUP_APP,
      kind: BACKUP_KIND,
      backupFormatVersion: BACKUP_FORMAT_VERSION + 1,
      schemaVersion: SCHEMA_VERSION,
      profile: { id: 'p', name: 'X' },
      data: {},
    });
    expect(() => parseBackup(text)).toThrow(/formato de backup incompatible/i);
  });

  it('rechaza un backup de una version de esquema mas reciente', () => {
    const text = JSON.stringify({
      app: BACKUP_APP,
      kind: BACKUP_KIND,
      backupFormatVersion: BACKUP_FORMAT_VERSION,
      schemaVersion: SCHEMA_VERSION + 1,
      profile: { id: 'p', name: 'X' },
      data: {},
    });
    expect(() => parseBackup(text)).toThrow(/version mas reciente/i);
  });

  it('rechaza un backup sin bloque de datos', () => {
    const text = JSON.stringify({
      app: BACKUP_APP,
      kind: BACKUP_KIND,
      backupFormatVersion: BACKUP_FORMAT_VERSION,
      schemaVersion: SCHEMA_VERSION,
      profile: { id: 'p', name: 'X' },
    });
    expect(() => parseBackup(text)).toThrow(BackupError);
  });

  it('rechaza un backup con una tabla corrupta (no es lista)', () => {
    const text = JSON.stringify({
      app: BACKUP_APP,
      kind: BACKUP_KIND,
      backupFormatVersion: BACKUP_FORMAT_VERSION,
      schemaVersion: SCHEMA_VERSION,
      profile: { id: 'p', name: 'X' },
      data: { transactions: 'no soy una lista' },
    });
    expect(() => parseBackup(text)).toThrow(/corrupto/i);
  });

  it('acepta un backup valido con tablas ausentes (se asumen vacias)', () => {
    const text = JSON.stringify({
      app: BACKUP_APP,
      kind: BACKUP_KIND,
      backupFormatVersion: BACKUP_FORMAT_VERSION,
      schemaVersion: SCHEMA_VERSION,
      exportedAt: 123,
      profile: { id: 'p', name: 'X', color: '#fff', avatarEmoji: null, createdAt: 1, updatedAt: 1, archivedAt: null },
      data: { accounts: [] },
    });
    const parsed = parseBackup(text);
    expect(parsed.data.transactions).toEqual([]);
    expect(parsed.data.accounts).toEqual([]);
  });
});

describe('el backup NUNCA incluye seguridad local (PIN, sesion cifrada, passkeys)', () => {
  it('createBackup no expone deviceSecurity/encryptedSession/webauthnCredentials aunque existan', async () => {
    const a = await seedRichProfile('Perfil A');
    // Activa PIN de verdad: hay verificador, sal y (potencialmente) sesion cifrada en Dexie.
    await pinService.enablePin('123456', '123456');
    expect((await db.deviceSecurity.toArray()).length).toBeGreaterThan(0);

    const backup = await backupService.createBackup(a.pid);
    const serialized = backupService.serializeBackup(backup);

    // Ninguna clave de las tablas device-local aparece en el objeto de datos del backup.
    expect(Object.keys(backup.data)).not.toContain('deviceSecurity');
    expect(Object.keys(backup.data)).not.toContain('encryptedSession');
    expect(Object.keys(backup.data)).not.toContain('webauthnCredentials');

    // Ni el verificador del PIN ni nada relacionado aparece en el JSON serializado.
    const security = await pinService.getSecurity();
    expect(security.pinVerifier).toBeTruthy();
    expect(serialized).not.toContain(security.pinVerifier as string);
    expect(serialized.toLowerCase()).not.toContain('pinverifier');
    expect(serialized.toLowerCase()).not.toContain('pinsalt');
  });
});

describe('remapProfileData (funcion pura)', () => {
  it('regenera ids y remapea referencias de forma consistente', async () => {
    const a = await seedRichProfile('Perfil A');
    const snap = await backupRepo.readProfileData(a.pid);

    // idFactory determinista para comprobar el remapeo sin depender de UUIDs.
    let counter = 0;
    const makeId = () => `new-${counter++}`;
    const remapped = remapProfileData(snap.data, 'target-profile', makeId);

    // Todo apunta al nuevo perfil y ningun id conserva el valor original.
    for (const acc of remapped.accounts) {
      expect(acc.profileId).toBe('target-profile');
      expect(acc.id.startsWith('new-')).toBe(true);
    }
    // La subcategoria sigue apuntando a su raiz (ya remapeada).
    const root = remapped.categories.find((c) => c.parentId === null)!;
    const sub = remapped.categories.find((c) => c.parentId !== null)!;
    expect(sub.parentId).toBe(root.id);

    // El grupo de transferencia se remapeo de forma consistente para ambas patas.
    const patas = remapped.transactions.filter((t) => t.transferGroupId !== null);
    expect(new Set(patas.map((t) => t.transferGroupId)).size).toBe(1);
    expect(patas[0]!.transferGroupId).not.toBe(a.grp);
  });
});
