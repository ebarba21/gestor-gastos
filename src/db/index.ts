// Instancia Dexie y definicion de stores. Unico punto que abre IndexedDB.
// Esquema segun specs/DATA_MODEL.md seccion 3. Regla: todo indice de datos empieza
// por profileId para que el filtrado por perfil sea barato y por diseno.
import Dexie from 'dexie';
import type { Table } from 'dexie';
import type {
  Profile,
  Setting,
  Account,
  Category,
  Tag,
  Transaction,
  Rule,
  Budget,
  ImportTemplate,
  ImportBatch,
  Merchant,
  MerchantAlias,
  NoDuplicateDecision,
  SyncMeta,
  OutboxMutation,
  Conflict,
  ProfileMigration,
  SyncState,
  DeviceSecurity,
  EncryptedSessionRow,
  WebAuthnCredentialRef,
} from './schema';
import { backfillMerchantFields, type LegacyTransactionRow } from './merchantMigration';
import {
  backfillDuplicateFields,
  backfillImportBatchFields,
  type LegacyTransactionRowV6,
} from './duplicateMigration';

export class GestorGastosDB extends Dexie {
  profiles!: Table<Profile, string>;
  settings!: Table<Setting, string>;
  accounts!: Table<Account, string>;
  categories!: Table<Category, string>;
  tags!: Table<Tag, string>;
  transactions!: Table<Transaction, string>;
  rules!: Table<Rule, string>;
  budgets!: Table<Budget, string>;
  importTemplates!: Table<ImportTemplate, string>;
  importBatches!: Table<ImportBatch, string>;
  // Comercios normalizados (ampliacion, fase 4).
  merchants!: Table<Merchant, string>;
  merchantAliases!: Table<MerchantAlias, string>;
  // Deteccion avanzada de duplicados (ampliacion, fase 5).
  noDuplicateDecisions!: Table<NoDuplicateDecision, string>;
  // Tablas device-local de la ampliacion (fase 2). NO se sincronizan ni entran en backups.
  outbox!: Table<OutboxMutation, string>;
  conflicts!: Table<Conflict, string>;
  profileMigrations!: Table<ProfileMigration, string>;
  syncState!: Table<SyncState, [string, string]>;
  // Tablas device-local de la ampliacion (fase 3). NO se sincronizan ni entran en backups.
  deviceSecurity!: Table<DeviceSecurity, string>;
  encryptedSession!: Table<EncryptedSessionRow, string>;
  webauthnCredentials!: Table<WebAuthnCredentialRef, string>;

  constructor() {
    super('gestor-gastos');
    // Version 1: esquema local vigente (DATA_MODEL secciones 1 a 8).
    this.version(1).stores({
      profiles: 'id, archivedAt, name',
      settings: 'id, &profileId',
      accounts: 'id, profileId, [profileId+kind], [profileId+archivedAt]',
      categories:
        'id, profileId, [profileId+parentId], [profileId+kind], [profileId+archivedAt]',
      tags: 'id, profileId, [profileId+name]',
      transactions:
        'id, profileId, ' +
        '[profileId+date], [profileId+accountId], [profileId+categoryId], ' +
        '[profileId+type], [profileId+statsFlag], [profileId+transferGroupId], ' +
        '[profileId+parentId], [profileId+refundOfId], [profileId+importBatchId], ' +
        '[profileId+dedupeHash], *tagIds',
      rules: 'id, profileId, [profileId+enabled], [profileId+priority]',
      budgets: 'id, profileId, [profileId+scope], [profileId+archivedAt]',
      importTemplates: 'id, profileId, [profileId+name]',
      importBatches: 'id, profileId, [profileId+importedAt], [profileId+status]',
    });

    // Version 2 (ampliacion, fase 1): anade de forma ADITIVA los campos de sincronizacion
    // (DATA_MODEL seccion 9) a todas las entidades y ownerUserId a Profile, con valores por
    // defecto. No cambia indices existentes ni semantica de negocio; la logica de
    // sincronizacion llega en la fase 2. Los mismos indices se redeclaran (Dexie lo exige
    // al declarar una version nueva) y el upgrade rellena los defaults en las filas ya
    // existentes para que ninguna quede sin los campos nuevos.
    this.version(2)
      .stores({
        profiles: 'id, archivedAt, name, ownerUserId',
        settings: 'id, &profileId',
        accounts: 'id, profileId, [profileId+kind], [profileId+archivedAt]',
        categories:
          'id, profileId, [profileId+parentId], [profileId+kind], [profileId+archivedAt]',
        tags: 'id, profileId, [profileId+name]',
        transactions:
          'id, profileId, ' +
          '[profileId+date], [profileId+accountId], [profileId+categoryId], ' +
          '[profileId+type], [profileId+statsFlag], [profileId+transferGroupId], ' +
          '[profileId+parentId], [profileId+refundOfId], [profileId+importBatchId], ' +
          '[profileId+dedupeHash], *tagIds',
        rules: 'id, profileId, [profileId+enabled], [profileId+priority]',
        budgets: 'id, profileId, [profileId+scope], [profileId+archivedAt]',
        importTemplates: 'id, profileId, [profileId+name]',
        importBatches: 'id, profileId, [profileId+importedAt], [profileId+status]',
      })
      .upgrade(async (tx) => {
        const defaults = syncDefaults();
        const syncableTables = [
          'settings',
          'accounts',
          'categories',
          'tags',
          'transactions',
          'rules',
          'budgets',
          'importTemplates',
          'importBatches',
        ];
        for (const name of syncableTables) {
          await tx
            .table(name)
            .toCollection()
            .modify((row: Record<string, unknown>) => {
              if (row.deletedAt === undefined) row.deletedAt = defaults.deletedAt;
              if (row.revision === undefined) row.revision = defaults.revision;
              if (row.syncStatus === undefined) row.syncStatus = defaults.syncStatus;
              if (row.lastSyncedAt === undefined) row.lastSyncedAt = defaults.lastSyncedAt;
            });
        }
        // Profile ademas gana ownerUserId (null: perfil local sin cuenta vinculada).
        await tx
          .table('profiles')
          .toCollection()
          .modify((row: Record<string, unknown>) => {
            if (row.ownerUserId === undefined) row.ownerUserId = null;
            if (row.deletedAt === undefined) row.deletedAt = defaults.deletedAt;
            if (row.revision === undefined) row.revision = defaults.revision;
            if (row.syncStatus === undefined) row.syncStatus = defaults.syncStatus;
            if (row.lastSyncedAt === undefined) row.lastSyncedAt = defaults.lastSyncedAt;
          });
      });

    // Version 3 (ampliacion, fase 2): motor de sincronizacion local-first. Aditiva:
    //   - Anade indices por syncStatus para localizar rapido filas 'pending'/'conflict'.
    //   - Crea tablas DEVICE-LOCAL (outbox, conflicts, profileMigrations, syncState) que NO se
    //     sincronizan ni entran en backups. No transforma datos financieros (solo crea tablas
    //     vacias e indices); el upgrade no necesita tocar filas existentes.
    // El resto de indices se mantiene igual que en la version 2.
    this.version(3).stores({
      profiles: 'id, archivedAt, name, ownerUserId, syncStatus',
      settings: 'id, &profileId, [profileId+syncStatus]',
      accounts:
        'id, profileId, [profileId+kind], [profileId+archivedAt], [profileId+syncStatus]',
      categories:
        'id, profileId, [profileId+parentId], [profileId+kind], [profileId+archivedAt], ' +
        '[profileId+syncStatus]',
      tags: 'id, profileId, [profileId+name], [profileId+syncStatus]',
      transactions:
        'id, profileId, ' +
        '[profileId+date], [profileId+accountId], [profileId+categoryId], ' +
        '[profileId+type], [profileId+statsFlag], [profileId+transferGroupId], ' +
        '[profileId+parentId], [profileId+refundOfId], [profileId+importBatchId], ' +
        '[profileId+dedupeHash], [profileId+syncStatus], *tagIds',
      rules:
        'id, profileId, [profileId+enabled], [profileId+priority], [profileId+syncStatus]',
      budgets:
        'id, profileId, [profileId+scope], [profileId+archivedAt], [profileId+syncStatus]',
      importTemplates: 'id, profileId, [profileId+name], [profileId+syncStatus]',
      importBatches:
        'id, profileId, [profileId+importedAt], [profileId+status], [profileId+syncStatus]',
      // Cola de salida: idempotencia por mutationId (PK). Indices para el planificador de push
      // (por usuario+estado), agrupacion por perfil/entidad, coalescing/rebase por entidad y
      // orden por creacion (respeta dependencias).
      outbox:
        'mutationId, [userId+status], [profileId+entityType], [entityType+entityId], ' +
        'status, createdAt',
      conflicts: 'id, [profileId+status], [userId+status], entityId, status',
      profileMigrations: 'id, [userId+profileId], profileId, status',
      // Cursor de descarga por (profileId, entityType). Clave primaria compuesta.
      syncState: '[profileId+entityType], profileId',
    });

    // Version 4 (ampliacion, fase 3): seguridad de acceso local (PIN, sesion cifrada,
    // passkeys). Aditiva: crea tres tablas DEVICE-LOCAL nuevas y vacias (DATA_MODEL seccion
    // 10.2). No transforma ninguna tabla existente ni datos financieros; no necesita .upgrade().
    // Estas tablas NUNCA se sincronizan ni entran en backups (no se anaden a childTables ni a
    // ProfileDataTables/backupRepo.ts).
    this.version(4).stores({
      // Fila unica de configuracion de seguridad del dispositivo (PIN, bloqueo automatico).
      deviceSecurity: 'id',
      // Sesion de Supabase cifrada; key = la clave de storage que pide el SDK de Auth.
      encryptedSession: 'key',
      // Referencias locales a passkeys registradas (la credencial vive en el autenticador/SO).
      webauthnCredentials: 'id, credentialId',
    });

    // Version 5 (ampliacion, fase 4): comercios normalizados (DATA_MODEL seccion 14). Aditiva:
    //   - Crea las tablas nuevas merchants/merchantAliases (sincronizables, entran en backup).
    //   - transactions gana los campos de comercio (rawConcept, normalizedConcept,
    //     normalizationVersion, merchantId, merchantMatchSource, merchantMatchConfidence) y los
    //     indices [profileId+merchantId] y [profileId+normalizedConcept]. El upgrade rellena los
    //     defaults en las filas existentes: rawConcept = concept actual, normalizedConcept
    //     calculado con la version vigente del algoritmo, sin comercio asociado (el motor de
    //     asociacion y la revision de candidatos son un paso posterior explicito del usuario,
    //     nunca una fusion automatica silenciosa).
    this.version(5)
      .stores({
        merchants: 'id, profileId, [profileId+normalizedName], [profileId+archivedAt], [profileId+syncStatus]',
        merchantAliases:
          'id, profileId, merchantId, [profileId+normalizedAlias], [profileId+enabled], ' +
          '[profileId+syncStatus]',
        transactions:
          'id, profileId, ' +
          '[profileId+date], [profileId+accountId], [profileId+categoryId], ' +
          '[profileId+type], [profileId+statsFlag], [profileId+transferGroupId], ' +
          '[profileId+parentId], [profileId+refundOfId], [profileId+importBatchId], ' +
          '[profileId+dedupeHash], [profileId+syncStatus], [profileId+merchantId], ' +
          '[profileId+normalizedConcept], *tagIds',
      })
      .upgrade(async (tx) => {
        const profiles = await tx.table('profiles').toArray();
        const ownerByProfile = new Map<string, string | null>(
          profiles.map((p: { id: string; ownerUserId: string | null }) => [p.id, p.ownerUserId ?? null]),
        );
        const ts = now();
        const toEnqueue: Array<{ userId: string; profileId: string; entityId: string; entity: Record<string, unknown> }> = [];
        await tx
          .table('transactions')
          .toCollection()
          .modify((row: LegacyTransactionRow) => {
            const touched = backfillMerchantFields(row);
            // Los campos nuevos son datos de negocio: si la fila ya estaba confirmada en
            // remoto (syncStatus 'synced') y el perfil esta vinculado a una cuenta, hay que
            // subir la correccion para no perder la normalizacion en otros dispositivos.
            const userId = ownerByProfile.get(row.profileId) ?? null;
            if (touched && userId && row.syncStatus === 'synced') {
              row.syncStatus = 'pending';
              toEnqueue.push({
                userId,
                profileId: row.profileId,
                entityId: row.id as string,
                entity: { ...row },
              });
            }
          });
        for (const item of toEnqueue) {
          await tx.table('outbox').add({
            mutationId: newId(),
            userId: item.userId,
            profileId: item.profileId,
            entityType: 'transaction',
            entityId: item.entityId,
            operation: 'update',
            payload: item.entity,
            baseRevision: (item.entity.revision as number) ?? 0,
            createdAt: ts,
            attempts: 0,
            lastAttemptAt: null,
            lastError: null,
            status: 'queued',
          });
        }
      });

    // Version 6 (ampliacion, fase 5): deteccion avanzada de duplicados (DATA_MODEL seccion
    // 15). Aditiva:
    //   - Crea la tabla nueva noDuplicateDecisions (sincronizable, entra en backup).
    //   - transactions gana los metadatos bancarios y huellas versionadas (bankTransactionId,
    //     fechas contable/valor, pendiente, moneda, saldo posterior, referencia, tipo de
    //     operacion, sourceRowHash, exactFingerprint, normalizedFingerprint,
    //     fingerprintVersion, sourceFileHash, sourceFileSize, duplicateStatus,
    //     duplicateConfidence, duplicateReasonCodes, duplicateCandidateIds,
    //     pendingReplacementId) y los indices [profileId+bankTransactionId],
    //     [profileId+normalizedFingerprint], [profileId+exactFingerprint] y
    //     [profileId+duplicateStatus]. NUNCA se declara `&` (unico) sobre la huella
    //     normalizada: dos compras reales identicas son legitimas (DATA_MODEL 15.1).
    //   - importBatches gana sourceFileHash/sourceFileSize (detectar "archivo repetido") y su
    //     indice [profileId+sourceFileHash].
    //   - El upgrade rellena los defaults en las filas existentes: sin metadatos bancarios,
    //     huellas calculadas con el algoritmo vigente, duplicateStatus='unique' (no se
    //     re-evalua el historico contra el motor en la migracion; el recalculo es explicito,
    //     nunca en silencio).
    this.version(6)
      .stores({
        noDuplicateDecisions:
          'id, profileId, [profileId+leftFingerprint], [profileId+rightFingerprint], ' +
          '[profileId+syncStatus]',
        transactions:
          'id, profileId, ' +
          '[profileId+date], [profileId+accountId], [profileId+categoryId], ' +
          '[profileId+type], [profileId+statsFlag], [profileId+transferGroupId], ' +
          '[profileId+parentId], [profileId+refundOfId], [profileId+importBatchId], ' +
          '[profileId+dedupeHash], [profileId+syncStatus], [profileId+merchantId], ' +
          '[profileId+normalizedConcept], [profileId+bankTransactionId], ' +
          '[profileId+normalizedFingerprint], [profileId+exactFingerprint], ' +
          '[profileId+duplicateStatus], *tagIds',
        importBatches:
          'id, profileId, [profileId+importedAt], [profileId+status], ' +
          '[profileId+syncStatus], [profileId+sourceFileHash]',
      })
      .upgrade(async (tx) => {
        const profiles = await tx.table('profiles').toArray();
        const ownerByProfile = new Map<string, string | null>(
          profiles.map((p: { id: string; ownerUserId: string | null }) => [
            p.id,
            p.ownerUserId ?? null,
          ]),
        );
        const ts = now();
        const toEnqueue: Array<{
          userId: string;
          profileId: string;
          entityId: string;
          entity: Record<string, unknown>;
        }> = [];
        await tx
          .table('transactions')
          .toCollection()
          .modify((row: LegacyTransactionRowV6 & { id: string; profileId: string; syncStatus?: string }) => {
            const touched = backfillDuplicateFields(row);
            const userId = ownerByProfile.get(row.profileId) ?? null;
            if (touched && userId && row.syncStatus === 'synced') {
              row.syncStatus = 'pending';
              toEnqueue.push({
                userId,
                profileId: row.profileId,
                entityId: row.id,
                entity: { ...row },
              });
            }
          });
        await tx
          .table('importBatches')
          .toCollection()
          .modify((row: Record<string, unknown>) => {
            backfillImportBatchFields(row);
          });
        for (const item of toEnqueue) {
          await tx.table('outbox').add({
            mutationId: newId(),
            userId: item.userId,
            profileId: item.profileId,
            entityType: 'transaction',
            entityId: item.entityId,
            operation: 'update',
            payload: item.entity,
            baseRevision: (item.entity.revision as number) ?? 0,
            createdAt: ts,
            attempts: 0,
            lastAttemptAt: null,
            lastError: null,
            status: 'queued',
          });
        }
      });
  }
}

// Version del esquema de datos (Dexie). Fuente unica: la usan los backups para saber con
// que version se generaron y decidir si son restaurables (DATA_MODEL seccion 7). Debe
// coincidir con la ultima db.version(n) declarada arriba.
export const SCHEMA_VERSION = 6;

// Singleton de la base de datos usado por todos los repositorios.
export const db = new GestorGastosDB();

// Tablas hijas que se barren en cascada al borrar un perfil (todas menos profiles).
export const childTables: readonly Table<{ profileId: string }, string>[] = [
  db.settings,
  db.accounts,
  db.categories,
  db.tags,
  db.merchants,
  db.merchantAliases,
  db.transactions,
  db.rules,
  db.budgets,
  db.importTemplates,
  db.importBatches,
  db.noDuplicateDecisions,
];

// Helpers de identidad y tiempo. Claves primarias no autoincrementales para que los
// backups sean portables entre dispositivos sin colisiones (DATA_MODEL seccion 1).
export const newId = (): string => crypto.randomUUID();
export const now = (): number => Date.now();

// Valores por defecto de los campos de sincronizacion (DATA_MODEL seccion 9) para una fila
// nueva en modo local: solo local, sin revision remota ni confirmacion. Los repositorios los
// aplican al crear; el motor de sincronizacion (fase 2) los actualiza. Fuente unica para no
// repetir los defaults por cada repositorio.
export const syncDefaults = (): SyncMeta => ({
  deletedAt: null,
  revision: 0,
  syncStatus: 'local',
  lastSyncedAt: null,
});
