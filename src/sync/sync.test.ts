// Tests del motor de sincronizacion local-first (fase 2). Dexie real (fake-indexeddb) + un doble
// de Supabase en memoria (src/test/fakeSupabase). Cubren: crear/editar/borrar offline y sincronizar,
// idempotencia, conflictos y su resolucion, migracion de perfiles, reconstruccion de dispositivo,
// aislamiento entre usuarios y perfiles, y volumen (miles de movimientos).
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/index';
import { profilesRepo } from '../db/profilesRepo';
import { accountsRepo } from '../db/accountsRepo';
import { transactionsRepo } from '../db/transactionsRepo';
import type { NewTransaction } from '../db/transactionsRepo';
import { importBatchesRepo } from '../db/importBatchesRepo';
import { FakeRemote } from '../test/fakeSupabase';
import { runSync } from './syncEngine';
import { runPush } from './pushEngine';
import { countPending } from './outboxRepo';
import { countOpen as countOpenConflicts, listOpenByUser as listOpenConflictsByUser } from './conflictsRepo';
import { resolveKeepLocal, resolveKeepRemote } from './conflictResolver';
import { listMigratableProfiles, migrateProfile } from './profileMigration';
import { rebuildDevice } from './deviceRebuild';
import { __resetLockStateForTests, setLockStatus } from '../security/lockState';

const USER = '11111111-1111-1111-1111-111111111111';
const OTHER_USER = '22222222-2222-2222-2222-222222222222';

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  __resetLockStateForTests();
});

async function linkedProfile(userId = USER, name = 'Personal') {
  // profilesRepo.create con ownerUserId crea el perfil ya vinculado y encola su insert.
  return profilesRepo.create({ name, color: '#111', avatarEmoji: null, ownerUserId: userId });
}

async function localProfile(name = 'Local') {
  return profilesRepo.create({ name, color: '#222', avatarEmoji: null });
}

function accountInput(name = 'Banco') {
  return { name, kind: 'bank' as const, currency: 'EUR', color: null, openingBalanceCents: 0, archivedAt: null };
}

function txInput(accountId: string, overrides: Partial<NewTransaction> = {}): NewTransaction {
  return {
    date: '2026-01-15',
    amountCents: -1234,
    type: 'expense',
    concept: 'Compra',
    notes: null,
    accountId,
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
    dedupeHash: `h-${Math.random()}`,
    rawConcept: 'Compra',
    normalizedConcept: 'compra',
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
    ...overrides,
  };
}

describe('sincronizacion local-first (fase 2)', () => {
  it('crear offline y sincronizar sube al remoto y confirma la fila local', async () => {
    const remote = new FakeRemote();
    const client = remote.asClient();
    const profile = await linkedProfile();
    const account = await accountsRepo.create(profile.id, accountInput());

    // Escritura optimista: pendiente, no sincronizada aun.
    expect(account.syncStatus).toBe('pending');
    expect(await countPending(USER)).toBeGreaterThan(0);

    await runSync(client, USER);

    expect(remote.count('profiles')).toBe(1);
    expect(remote.count('accounts')).toBe(1);
    const localAccount = await db.accounts.get(account.id);
    expect(localAccount?.syncStatus).toBe('synced');
    expect(localAccount?.revision).toBe(0);
    expect(await countPending(USER)).toBe(0);
  });

  it('el modo local puro (sin cuenta) no encola mutaciones', async () => {
    const profile = await localProfile();
    const account = await accountsRepo.create(profile.id, accountInput());
    expect(account.syncStatus).toBe('local');
    expect(await countPending(USER)).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });

  it('reenviar la misma mutacion es idempotente (no duplica)', async () => {
    const remote = new FakeRemote();
    const client = remote.asClient();
    const profile = await linkedProfile();
    const account = await accountsRepo.create(profile.id, accountInput());

    await runPush(client, USER);
    expect(remote.count('accounts')).toBe(1);

    // Reejecutar el push tras "perder" la confirmacion: se reencola el insert ya aplicado.
    const mutation = await db.outbox
      .where('[entityType+entityId]')
      .equals(['account', account.id])
      .first();
    if (mutation) {
      await db.outbox.update(mutation.mutationId, { status: 'queued' });
    }
    await runPush(client, USER);

    // Sigue habiendo una sola fila remota (upsert idempotente) y la local queda sincronizada.
    expect(remote.count('accounts')).toBe(1);
    expect((await db.accounts.get(account.id))?.syncStatus).toBe('synced');
    expect(await countPending(USER)).toBe(0);
  });

  it('editar offline y sincronizar sube el cambio y bumpea la revision', async () => {
    const remote = new FakeRemote();
    const client = remote.asClient();
    const profile = await linkedProfile();
    const account = await accountsRepo.create(profile.id, accountInput());
    await runSync(client, USER);

    await accountsRepo.update(profile.id, account.id, { name: 'Banco renombrado' });
    await runSync(client, USER);

    expect(remote.get('accounts', account.id)?.name).toBe('Banco renombrado');
    expect(remote.get('accounts', account.id)?.revision).toBe(1);
    const local = await db.accounts.get(account.id);
    expect(local?.revision).toBe(1);
    expect(local?.syncStatus).toBe('synced');
  });

  it('borrar offline sincroniza el tombstone y la fila deja de leerse', async () => {
    const remote = new FakeRemote();
    const client = remote.asClient();
    const profile = await linkedProfile();
    const account = await accountsRepo.create(profile.id, accountInput());
    await runSync(client, USER);

    await accountsRepo.remove(profile.id, account.id);
    await runSync(client, USER);

    // Remoto: tombstone (deleted_at != null) -> no cuenta como vivo. Local: no se lee.
    expect(remote.get('accounts', account.id)?.deleted_at).toBeTruthy();
    expect(remote.count('accounts')).toBe(0);
    expect(await accountsRepo.getById(profile.id, account.id)).toBeUndefined();
    expect((await accountsRepo.list(profile.id)).length).toBe(0);
  });

  it('dos dispositivos: lo que sube A se reconstruye en B (dispositivo vacio)', async () => {
    const remote = new FakeRemote();
    const client = remote.asClient();
    // Dispositivo A: crea y sube.
    const profile = await linkedProfile();
    const account = await accountsRepo.create(profile.id, accountInput());
    await transactionsRepo.create(profile.id, txInput(account.id));
    await runSync(client, USER);

    // Dispositivo B: Dexie vacio -> reconstruir desde la nube.
    await Promise.all(db.tables.map((t) => t.clear()));
    const result = await rebuildDevice(client, USER);

    expect(result.profiles).toBe(1);
    expect((await db.profiles.get(profile.id))?.ownerUserId).toBe(USER);
    expect((await accountsRepo.list(profile.id)).length).toBe(1);
    expect((await transactionsRepo.list(profile.id)).length).toBe(1);
    // Queda operativo offline (filas sincronizadas, sin pendientes).
    expect(await countPending(USER)).toBe(0);
  });

  it('conflicto: la revision remota cambio -> conflicto explicito, sin merge silencioso', async () => {
    const remote = new FakeRemote();
    const client = remote.asClient();
    const profile = await linkedProfile();
    const account = await accountsRepo.create(profile.id, accountInput());
    await runSync(client, USER);

    // Edita local (queda pendiente, base revision 0).
    await accountsRepo.update(profile.id, account.id, { name: 'Local' });
    // Otro dispositivo cambio el remoto (revision -> 1, otro last_mutation_id).
    remote.simulateRemoteEdit('accounts', account.id, { name: 'Remoto', last_mutation_id: 'otro' });

    await runPush(client, USER);

    expect(await countOpenConflicts(USER)).toBe(1);
    expect((await db.accounts.get(account.id))?.syncStatus).toBe('conflict');
  });

  it('resolver conflicto manteniendo la version remota', async () => {
    const remote = new FakeRemote();
    const client = remote.asClient();
    const profile = await linkedProfile();
    const account = await accountsRepo.create(profile.id, accountInput());
    await runSync(client, USER);
    await accountsRepo.update(profile.id, account.id, { name: 'Local' });
    remote.simulateRemoteEdit('accounts', account.id, { name: 'Remoto', last_mutation_id: 'otro' });
    await runPush(client, USER);

    const [conflict] = await listOpenConflictsByUser(USER);
    await resolveKeepRemote(conflict.id);

    const local = await db.accounts.get(account.id);
    expect(local?.name).toBe('Remoto');
    expect(local?.syncStatus).toBe('synced');
    expect(await countOpenConflicts(USER)).toBe(0);
    // Resolver el conflicto tambien resuelve la tarea de la bandeja de revision que genero
    // (ampliacion fase 6), lo que encola su propia mutacion pendiente hasta el siguiente
    // ciclo de sincronizacion: un push mas la deja en 0.
    await runPush(client, USER);
    expect(await countPending(USER)).toBe(0);
  });

  it('resolver conflicto manteniendo la version local reenvia y gana', async () => {
    const remote = new FakeRemote();
    const client = remote.asClient();
    const profile = await linkedProfile();
    const account = await accountsRepo.create(profile.id, accountInput());
    await runSync(client, USER);
    await accountsRepo.update(profile.id, account.id, { name: 'Local' });
    remote.simulateRemoteEdit('accounts', account.id, { name: 'Remoto', last_mutation_id: 'otro' });
    await runPush(client, USER);

    const [conflict] = await listOpenConflictsByUser(USER);
    await resolveKeepLocal(conflict.id);
    await runSync(client, USER);

    expect(remote.get('accounts', account.id)?.name).toBe('Local');
    expect(await countOpenConflicts(USER)).toBe(0);
    expect(await countPending(USER)).toBe(0);
    expect((await db.accounts.get(account.id))?.syncStatus).toBe('synced');
  });

  it('migracion de un perfil local: conserva UUID, valida recuentos y marca verificado', async () => {
    const remote = new FakeRemote();
    const client = remote.asClient();
    const profile = await localProfile('A migrar');
    const account = await accountsRepo.create(profile.id, accountInput());
    await transactionsRepo.create(profile.id, txInput(account.id));
    await transactionsRepo.create(profile.id, txInput(account.id));

    const migratables = await listMigratableProfiles();
    expect(migratables.map((m) => m.profile.id)).toContain(profile.id);

    const record = await migrateProfile(client, USER, profile.id);

    expect(record.status).toBe('verified');
    expect(remote.count('profiles')).toBe(1);
    expect(remote.count('accounts')).toBe(1);
    expect(remote.count('transactions')).toBe(2);
    // Conserva el UUID local (no remapea) y vincula el perfil.
    expect(remote.get('accounts', account.id)).toBeTruthy();
    expect((await db.profiles.get(profile.id))?.ownerUserId).toBe(USER);
    expect(await countPending(USER)).toBe(0);
  });

  it('migracion: reintenta inserts diferidos por FK antes de verificar (no falso negativo)', async () => {
    const remote = new FakeRemote();
    const client = remote.asClient();
    const profile = await localProfile('FK diferida');
    const account = await accountsRepo.create(profile.id, accountInput());
    await transactionsRepo.create(profile.id, txInput(account.id));
    await transactionsRepo.create(profile.id, txInput(account.id));

    // La primera pasada de push falla los dos inserts de transactions, como si su cuenta/categoria
    // padre aun no estuviera en remoto (FK diferida, 23503). runPush no bloquea: los deja para
    // reintentar. El bucle de migracion debe reintentar hasta drenar y acabar VERIFICADO, no dar
    // un falso negativo por verificar tras una sola pasada.
    remote.failInserts('transactions', 2);

    const record = await migrateProfile(client, USER, profile.id);

    expect(record.status).toBe('verified');
    expect(remote.count('transactions')).toBe(2);
    expect(await countPending(USER)).toBe(0);
  });

  it('la migracion es idempotente: reejecutar no duplica', async () => {
    const remote = new FakeRemote();
    const client = remote.asClient();
    const profile = await localProfile('Idempotente');
    const account = await accountsRepo.create(profile.id, accountInput());
    await transactionsRepo.create(profile.id, txInput(account.id));

    await migrateProfile(client, USER, profile.id);
    const second = await migrateProfile(client, USER, profile.id);

    expect(second.status).toBe('verified');
    expect(remote.count('accounts')).toBe(1);
    expect(remote.count('transactions')).toBe(1);
  });

  it('aislamiento entre usuarios: el pull de otro usuario no ve datos ajenos', async () => {
    const remote = new FakeRemote();
    const client = remote.asClient();
    const profile = await linkedProfile(USER);
    await accountsRepo.create(profile.id, accountInput());
    await runSync(client, USER);

    // Todas las filas remotas pertenecen a USER.
    expect(remote.all('accounts').every((r) => r.owner_user_id === USER)).toBe(true);

    // Otro usuario reconstruye: no obtiene ningun dato (RLS/owner en los filtros del repo).
    await Promise.all(db.tables.map((t) => t.clear()));
    const result = await rebuildDevice(client, OTHER_USER);
    expect(result.profiles).toBe(0);
    expect(await db.accounts.count()).toBe(0);
  });

  it('aislamiento entre perfiles del mismo usuario', async () => {
    const remote = new FakeRemote();
    const client = remote.asClient();
    const p1 = await linkedProfile(USER, 'P1');
    const p2 = await linkedProfile(USER, 'P2');
    const a1 = await accountsRepo.create(p1.id, accountInput('Cuenta P1'));
    const a2 = await accountsRepo.create(p2.id, accountInput('Cuenta P2'));
    await runSync(client, USER);

    await Promise.all(db.tables.map((t) => t.clear()));
    await rebuildDevice(client, USER);

    const p1Accounts = await accountsRepo.list(p1.id);
    const p2Accounts = await accountsRepo.list(p2.id);
    expect(p1Accounts.map((a) => a.id)).toEqual([a1.id]);
    expect(p2Accounts.map((a) => a.id)).toEqual([a2.id]);
  });

  it('importar bajo cuenta sube el lote y sus movimientos; deshacer sincroniza el tombstone', async () => {
    const remote = new FakeRemote();
    const client = remote.asClient();
    const profile = await linkedProfile();
    const account = await accountsRepo.create(profile.id, accountInput());
    const batch = await importBatchesRepo.commitBatch(
      profile.id,
      {
        templateId: null,
        fileName: 'extracto.csv',
        rowsTotal: 3,
        rowsImported: 3,
        rowsSkippedDuplicate: 0,
        rowsLinked: 0,
        sourceFileHash: null,
        sourceFileSize: null,
      },
      [txInput(account.id), txInput(account.id), txInput(account.id)],
    );
    await runSync(client, USER);

    expect(remote.count('import_batches')).toBe(1);
    expect(remote.count('transactions')).toBe(3);

    // Deshacer: borrado logico de los movimientos + lote 'undone', y se sincroniza.
    const removed = await importBatchesRepo.undoBatch(profile.id, batch.id);
    expect(removed).toBe(3);
    await runSync(client, USER);

    expect(remote.count('transactions')).toBe(0); // tombstones (deleted_at)
    expect(remote.get('import_batches', batch.id)?.status).toBe('undone');
    expect((await transactionsRepo.list(profile.id)).length).toBe(0);
  });

  it('miles de movimientos se sincronizan sin duplicar', async () => {
    const remote = new FakeRemote();
    const client = remote.asClient();
    const profile = await linkedProfile();
    const account = await accountsRepo.create(profile.id, accountInput());
    const inputs = Array.from({ length: 1000 }, (_, i) =>
      txInput(account.id, { concept: `Mov ${i}`, dedupeHash: `hash-${i}` }),
    );
    await transactionsRepo.createMany(profile.id, inputs);

    // Se ejercita el PUSH a escala (la parte relevante para volumen). El pull inicial masivo se
    // cubre en 'dos dispositivos'; aqui interesa que subir miles no duplique ni deje pendientes.
    await runPush(client, USER);
    await runPush(client, USER); // reejecutar no duplica (idempotencia a escala).

    expect(remote.count('transactions')).toBe(1000);
    expect(await countPending(USER)).toBe(0);
    // Timeout holgado: subir 1000 movimientos por lotes (dos pasadas) tarda ~50s aislado y mas
    // cuando la suite completa corre en paralelo y carga la CPU. 60s se quedaba justo y hacia
    // fallar el run completo por reloj (no por correctitud). 120s da margen sin enmascarar nada.
  }, 120000);

  it('no sincroniza mientras la app esta bloqueada por PIN (CLOUD_SYNC_SECURITY seccion 6)', async () => {
    const remote = new FakeRemote();
    const client = remote.asClient();
    const profile = await linkedProfile();
    await accountsRepo.create(profile.id, accountInput());
    expect(await countPending(USER)).toBeGreaterThan(0);

    setLockStatus('locked');
    const result = await runSync(client, USER);

    expect(result.skipped).toBe(true);
    expect(remote.count('accounts')).toBe(0);
    expect(await countPending(USER)).toBeGreaterThan(0);

    // Al desbloquear, la sincronizacion vuelve a funcionar con normalidad.
    setLockStatus('unlocked');
    await runSync(client, USER);
    expect(remote.count('accounts')).toBe(1);
  });
});
