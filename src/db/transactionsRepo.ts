// Repositorio de movimientos (Transaction). Entidad central. Exige profileId.
// Ver DATA_MODEL 2.6. Responsabilidades propias del repositorio:
//   - mantener statsFlag como espejo indexable de excludedFromStats,
//   - validar la coherencia entre type y signo del importe,
//   - validar la relacion categorizedBy <-> ruleId.
import type { Transaction } from './schema';
import { db, newId, now } from './index';
import {
  NotFoundError,
  ValidationError,
  requireAccountingDate,
  requireId,
  requireProfileId,
} from '../lib/validation';
import { assertCents } from '../lib/money';

// Campos que fija/deriva el repositorio y no forman parte de la entrada del llamante.
export type NewTransaction = Omit<
  Transaction,
  'id' | 'profileId' | 'createdAt' | 'updatedAt' | 'statsFlag'
>;
export type TransactionPatch = Partial<NewTransaction>;

// Valida las reglas de integridad del modelo. Sin errores silenciosos.
function validateIntegrity(t: {
  date: string;
  type: Transaction['type'];
  amountCents: number;
  categorizedBy: Transaction['categorizedBy'];
  ruleId: string | null;
}): void {
  requireAccountingDate(t.date);
  assertCents(t.amountCents);

  // type es la fuente de verdad; el signo debe ser coherente (DATA_MODEL 2.6).
  if (t.type === 'expense' && t.amountCents > 0) {
    throw new ValidationError('Un gasto (expense) no puede tener importe positivo.');
  }
  if (t.type === 'income' && t.amountCents < 0) {
    throw new ValidationError('Un ingreso (income) no puede tener importe negativo.');
  }

  // categorizedBy === 'rule' <-> ruleId no nulo.
  if (t.categorizedBy === 'rule' && t.ruleId === null) {
    throw new ValidationError('categorizedBy="rule" exige un ruleId no nulo.');
  }
  if (t.categorizedBy !== 'rule' && t.ruleId !== null) {
    throw new ValidationError('ruleId debe ser null salvo cuando categorizedBy="rule".');
  }
}

function statsFlagFor(excluded: boolean): 0 | 1 {
  return excluded ? 1 : 0;
}

async function requireOwned(profileId: string, id: string): Promise<Transaction> {
  const row = await db.transactions.get(id);
  if (!row || row.profileId !== profileId) {
    throw new NotFoundError(`Transaction ${id} no existe en el perfil ${profileId}.`);
  }
  return row;
}

export const transactionsRepo = {
  async create(profileId: string, input: NewTransaction): Promise<Transaction> {
    requireProfileId(profileId);
    validateIntegrity(input);
    const ts = now();
    const entity: Transaction = {
      ...input,
      id: newId(),
      profileId,
      statsFlag: statsFlagFor(input.excludedFromStats),
      createdAt: ts,
      updatedAt: ts,
    };
    await db.transactions.add(entity);
    return entity;
  },

  async getById(profileId: string, id: string): Promise<Transaction | undefined> {
    requireProfileId(profileId);
    requireId(id);
    const row = await db.transactions.get(id);
    if (!row || row.profileId !== profileId) return undefined;
    return row;
  },

  async list(profileId: string): Promise<Transaction[]> {
    requireProfileId(profileId);
    return db.transactions.where('profileId').equals(profileId).toArray();
  },

  async update(
    profileId: string,
    id: string,
    patch: TransactionPatch,
  ): Promise<Transaction> {
    requireProfileId(profileId);
    requireId(id);
    const existing = await requireOwned(profileId, id);
    // id y profileId se re-fijan tras el patch como barrera de aislamiento en runtime.
    const merged: Transaction = {
      ...existing,
      ...patch,
      id: existing.id,
      profileId: existing.profileId,
      updatedAt: now(),
    };
    // Mantener el espejo indexable sincronizado en cada escritura.
    merged.statsFlag = statsFlagFor(merged.excludedFromStats);
    validateIntegrity(merged);
    await db.transactions.put(merged);
    return merged;
  },

  async remove(profileId: string, id: string): Promise<void> {
    requireProfileId(profileId);
    requireId(id);
    await requireOwned(profileId, id);
    await db.transactions.delete(id);
  },

  count(profileId: string): Promise<number> {
    requireProfileId(profileId);
    return db.transactions.where('profileId').equals(profileId).count();
  },

  // --- Queries por indice (todas encabezadas por profileId) ---

  // Rango de fechas contables inclusivo (indice de trabajo del dashboard y la lista).
  listByDateRange(profileId: string, from: string, to: string): Promise<Transaction[]> {
    requireProfileId(profileId);
    return db.transactions
      .where('[profileId+date]')
      .between([profileId, from], [profileId, to], true, true)
      .toArray();
  },

  listByAccount(profileId: string, accountId: string): Promise<Transaction[]> {
    requireProfileId(profileId);
    return db.transactions
      .where('[profileId+accountId]')
      .equals([profileId, accountId])
      .toArray();
  },

  // Movimientos que SI cuentan en estadisticas (statsFlag = 0).
  listForStats(profileId: string): Promise<Transaction[]> {
    requireProfileId(profileId);
    return db.transactions.where('[profileId+statsFlag]').equals([profileId, 0]).toArray();
  },

  // Deteccion de duplicados: lookup O(log n) por [profileId+dedupeHash].
  listByDedupeHash(profileId: string, dedupeHash: string): Promise<Transaction[]> {
    requireProfileId(profileId);
    return db.transactions
      .where('[profileId+dedupeHash]')
      .equals([profileId, dedupeHash])
      .toArray();
  },

  listByImportBatch(profileId: string, importBatchId: string): Promise<Transaction[]> {
    requireProfileId(profileId);
    return db.transactions
      .where('[profileId+importBatchId]')
      .equals([profileId, importBatchId])
      .toArray();
  },

  // Movimientos con una etiqueta dada dentro del perfil. multiEntry (*tagIds) no
  // compone con indices compuestos, por eso se filtra el perfil en memoria.
  async listByTag(profileId: string, tagId: string): Promise<Transaction[]> {
    requireProfileId(profileId);
    const rows = await db.transactions.where('tagIds').equals(tagId).toArray();
    return rows.filter((t) => t.profileId === profileId);
  },
};
