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
  }
}

// Version del esquema de datos (Dexie). Fuente unica: la usan los backups para saber con
// que version se generaron y decidir si son restaurables (DATA_MODEL seccion 7). Debe
// coincidir con la ultima db.version(n) declarada arriba.
export const SCHEMA_VERSION = 1;

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
