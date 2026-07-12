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
  SyncMeta,
} from './schema';

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
  }
}

// Version del esquema de datos (Dexie). Fuente unica: la usan los backups para saber con
// que version se generaron y decidir si son restaurables (DATA_MODEL seccion 7). Debe
// coincidir con la ultima db.version(n) declarada arriba.
export const SCHEMA_VERSION = 2;

// Singleton de la base de datos usado por todos los repositorios.
export const db = new GestorGastosDB();

// Tablas hijas que se barren en cascada al borrar un perfil (todas menos profiles).
export const childTables: readonly Table<{ profileId: string }, string>[] = [
  db.settings,
  db.accounts,
  db.categories,
  db.tags,
  db.transactions,
  db.rules,
  db.budgets,
  db.importTemplates,
  db.importBatches,
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
