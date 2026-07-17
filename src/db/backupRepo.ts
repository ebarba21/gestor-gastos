// Repositorio de backup: lectura completa y restauracion ATOMICA de todos los datos de un
// perfil. Es la unica capa que abre Dexie para estas operaciones (ARCHITECTURE seccion 2).
//
// Aislamiento por perfil (invariante 4 de CLAUDE.md): tanto la lectura como la restauracion
// operan sobre un unico profileId; nunca cruzan perfiles. La restauracion se hace en UNA
// sola transaccion Dexie que abarca la tabla de perfiles y todas las hijas: si algo falla,
// se revierte entera y no queda un perfil a medias (requisito de atomicidad del alcance).
import type {
  Account,
  Budget,
  Category,
  ImportBatch,
  ImportTemplate,
  Merchant,
  MerchantAlias,
  NoDuplicateDecision,
  Profile,
  Reconciliation,
  RecurringOccurrence,
  RecurringSeries,
  ReviewItem,
  Rule,
  Setting,
  Tag,
  Transaction,
} from './schema';
import { childTables, db } from './index';
import { isAlive } from './baseRepo';
import { NotFoundError, requireProfileId } from '../lib/validation';

// Conjunto completo de datos hijos de un perfil (todo menos la fila Profile). El orden de
// las claves refleja el orden de las tablas hijas en db/index.
export interface ProfileDataTables {
  settings: Setting[];
  accounts: Account[];
  categories: Category[];
  tags: Tag[];
  merchants: Merchant[];
  merchantAliases: MerchantAlias[];
  transactions: Transaction[];
  rules: Rule[];
  budgets: Budget[];
  importTemplates: ImportTemplate[];
  importBatches: ImportBatch[];
  noDuplicateDecisions: NoDuplicateDecision[];
  reviewItems: ReviewItem[];
  reconciliations: Reconciliation[];
  recurringSeries: RecurringSeries[];
  recurringOccurrences: RecurringOccurrence[];
}

export interface ProfileSnapshot {
  profile: Profile;
  data: ProfileDataTables;
}

export const backupRepo = {
  // Lee la fila Profile y TODOS sus datos hijos en una transaccion de solo lectura para
  // obtener una instantanea consistente. Solo el perfil indicado (aislamiento).
  async readProfileData(profileId: string): Promise<ProfileSnapshot> {
    requireProfileId(profileId);
    const tables = [db.profiles, ...childTables];
    return db.transaction('r', tables, async () => {
      const profile = await db.profiles.get(profileId);
      if (!profile) {
        throw new NotFoundError(`Profile ${profileId} no existe.`);
      }
      const [
        settings,
        accounts,
        categories,
        tags,
        merchants,
        merchantAliases,
        transactions,
        rules,
        budgets,
        importTemplates,
        importBatches,
        noDuplicateDecisions,
        reviewItems,
        reconciliations,
        recurringSeries,
        recurringOccurrences,
      ] = await Promise.all([
        db.settings.where('profileId').equals(profileId).filter(isAlive).toArray(),
        db.accounts.where('profileId').equals(profileId).filter(isAlive).toArray(),
        db.categories.where('profileId').equals(profileId).filter(isAlive).toArray(),
        db.tags.where('profileId').equals(profileId).filter(isAlive).toArray(),
        db.merchants.where('profileId').equals(profileId).filter(isAlive).toArray(),
        db.merchantAliases.where('profileId').equals(profileId).filter(isAlive).toArray(),
        db.transactions.where('profileId').equals(profileId).filter(isAlive).toArray(),
        db.rules.where('profileId').equals(profileId).filter(isAlive).toArray(),
        db.budgets.where('profileId').equals(profileId).filter(isAlive).toArray(),
        db.importTemplates.where('profileId').equals(profileId).filter(isAlive).toArray(),
        db.importBatches.where('profileId').equals(profileId).filter(isAlive).toArray(),
        db.noDuplicateDecisions.where('profileId').equals(profileId).filter(isAlive).toArray(),
        db.reviewItems.where('profileId').equals(profileId).filter(isAlive).toArray(),
        db.reconciliations.where('profileId').equals(profileId).filter(isAlive).toArray(),
        db.recurringSeries.where('profileId').equals(profileId).filter(isAlive).toArray(),
        db.recurringOccurrences.where('profileId').equals(profileId).filter(isAlive).toArray(),
      ]);

      return {
        profile,
        data: {
          settings,
          accounts,
          categories,
          tags,
          merchants,
          merchantAliases,
          transactions,
          rules,
          budgets,
          importTemplates,
          importBatches,
          noDuplicateDecisions,
          reviewItems,
          reconciliations,
          recurringSeries,
          recurringOccurrences,
        },
      };
    });
  },

  // Restauracion en un PERFIL NUEVO: crea la fila Profile y vuelca todos sus datos en una
  // unica transaccion. Precondicion: profile.id no existe aun y `data` ya esta remapeado a
  // profile.id (responsabilidad del backupService). Atomico: si algo falla, no queda ni el
  // perfil ni datos sueltos.
  async restoreIntoNewProfile(profile: Profile, data: ProfileDataTables): Promise<void> {
    const tables = [db.profiles, ...childTables];
    await db.transaction('rw', tables, async () => {
      const existing = await db.profiles.get(profile.id);
      if (existing) {
        throw new NotFoundError(`El perfil ${profile.id} ya existe; no se puede crear de nuevo.`);
      }
      await db.profiles.add(profile);
      await bulkAddAll(data);
    });
  },

  // Restauracion SOBRE UN PERFIL EXISTENTE (el activo): borra todos los datos hijos del
  // perfil y vuelca los del backup, todo en una unica transaccion. Se conserva la fila
  // Profile (identidad del perfil activo: nombre, color, avatar). Precondicion: `data` ya
  // esta remapeado a profileId. Atomico: si algo falla, el perfil queda como estaba.
  async restoreIntoExistingProfile(profileId: string, data: ProfileDataTables): Promise<void> {
    requireProfileId(profileId);
    const tables = [db.profiles, ...childTables];
    await db.transaction('rw', tables, async () => {
      const profile = await db.profiles.get(profileId);
      if (!profile) {
        throw new NotFoundError(`Profile ${profileId} no existe.`);
      }
      for (const table of childTables) {
        await table.where('profileId').equals(profileId).delete();
      }
      await bulkAddAll(data);
    });
  },
};

// Inserta todos los conjuntos de datos hijos. Se ejecuta siempre dentro de una transaccion
// Dexie abierta por el llamante (por eso no abre transaccion propia).
async function bulkAddAll(data: ProfileDataTables): Promise<void> {
  if (data.settings.length > 0) await db.settings.bulkAdd(data.settings);
  if (data.accounts.length > 0) await db.accounts.bulkAdd(data.accounts);
  if (data.categories.length > 0) await db.categories.bulkAdd(data.categories);
  if (data.tags.length > 0) await db.tags.bulkAdd(data.tags);
  if (data.merchants.length > 0) await db.merchants.bulkAdd(data.merchants);
  if (data.merchantAliases.length > 0) await db.merchantAliases.bulkAdd(data.merchantAliases);
  if (data.transactions.length > 0) await db.transactions.bulkAdd(data.transactions);
  if (data.rules.length > 0) await db.rules.bulkAdd(data.rules);
  if (data.budgets.length > 0) await db.budgets.bulkAdd(data.budgets);
  if (data.importTemplates.length > 0) await db.importTemplates.bulkAdd(data.importTemplates);
  if (data.importBatches.length > 0) await db.importBatches.bulkAdd(data.importBatches);
  if (data.noDuplicateDecisions.length > 0) {
    await db.noDuplicateDecisions.bulkAdd(data.noDuplicateDecisions);
  }
  if (data.reviewItems.length > 0) await db.reviewItems.bulkAdd(data.reviewItems);
  if (data.reconciliations.length > 0) await db.reconciliations.bulkAdd(data.reconciliations);
  if (data.recurringSeries.length > 0) await db.recurringSeries.bulkAdd(data.recurringSeries);
  if (data.recurringOccurrences.length > 0) {
    await db.recurringOccurrences.bulkAdd(data.recurringOccurrences);
  }
}
