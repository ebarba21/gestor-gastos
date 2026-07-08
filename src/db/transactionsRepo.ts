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

// Construye la entidad Transaction completa (id, profileId, statsFlag y timestamps) a
// partir de la entrada del llamante, validando integridad. NO escribe en la base: lo usan
// tanto los metodos de este repositorio como las operaciones atomicas de otros repos
// (p. ej. commitBatch de importBatchesRepo) para compartir la misma validacion.
export function buildTransactionEntity(profileId: string, input: NewTransaction): Transaction {
  validateIntegrity(input);
  const ts = now();
  return {
    ...input,
    id: newId(),
    profileId,
    statsFlag: statsFlagFor(input.excludedFromStats),
    createdAt: ts,
    updatedAt: ts,
  };
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
    const entity = buildTransactionEntity(profileId, input);
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

  // Conjunto de todos los dedupeHash del perfil, para deteccion de duplicados en lote
  // (importacion) sin hacer una consulta por fila. Escaneo solo de indice
  // ([profileId+dedupeHash]): no deserializa los registros completos, asi escala a decenas
  // de miles de movimientos. Aislamiento: solo el perfil indicado.
  async collectDedupeHashes(profileId: string): Promise<Set<string>> {
    requireProfileId(profileId);
    const keys = await db.transactions
      .where('[profileId+dedupeHash]')
      .between([profileId, ''], [profileId, '￿'], true, true)
      .keys();
    const set = new Set<string>();
    for (const key of keys as unknown as Array<[string, string]>) {
      set.add(key[1]);
    }
    return set;
  },

  listByImportBatch(profileId: string, importBatchId: string): Promise<Transaction[]> {
    requireProfileId(profileId);
    return db.transactions
      .where('[profileId+importBatchId]')
      .equals([profileId, importBatchId])
      .toArray();
  },

  // Lineas hijas de un split (parentId apunta al padre). Indice [profileId+parentId].
  listChildren(profileId: string, parentId: string): Promise<Transaction[]> {
    requireProfileId(profileId);
    return db.transactions
      .where('[profileId+parentId]')
      .equals([profileId, parentId])
      .toArray();
  },

  // Las dos patas de una transferencia interna (mismo transferGroupId).
  listByTransferGroup(profileId: string, transferGroupId: string): Promise<Transaction[]> {
    requireProfileId(profileId);
    return db.transactions
      .where('[profileId+transferGroupId]')
      .equals([profileId, transferGroupId])
      .toArray();
  },

  // Movimientos con una etiqueta dada dentro del perfil. multiEntry (*tagIds) no
  // compone con indices compuestos, por eso se filtra el perfil en memoria.
  async listByTag(profileId: string, tagId: string): Promise<Transaction[]> {
    requireProfileId(profileId);
    const rows = await db.transactions.where('tagIds').equals(tagId).toArray();
    return rows.filter((t) => t.profileId === profileId);
  },

  // --- Contadores de uso (reglas de integridad al borrar cuentas/categorias/etiquetas) ---

  // Movimientos que usan una cuenta (indice [profileId+accountId]).
  countByAccount(profileId: string, accountId: string): Promise<number> {
    requireProfileId(profileId);
    return db.transactions.where('[profileId+accountId]').equals([profileId, accountId]).count();
  },

  // Movimientos cuya categoria (raiz o sub) es categoryId (indice [profileId+categoryId]).
  countByCategory(profileId: string, categoryId: string): Promise<number> {
    requireProfileId(profileId);
    return db.transactions.where('[profileId+categoryId]').equals([profileId, categoryId]).count();
  },

  // Movimientos que referencian una subcategoria en el campo subcategoryId. Ese campo no
  // esta indexado (DATA_MODEL seccion 3), asi que se escanea el perfil y se filtra en
  // memoria. Uso puntual (solo al borrar una categoria), no en caliente.
  async countBySubcategory(profileId: string, subcategoryId: string): Promise<number> {
    requireProfileId(profileId);
    const rows = await db.transactions.where('profileId').equals(profileId).toArray();
    return rows.filter((t) => t.subcategoryId === subcategoryId).length;
  },

  // Numero de movimientos del perfil que llevan una etiqueta.
  async countByTag(profileId: string, tagId: string): Promise<number> {
    const rows = await transactionsRepo.listByTag(profileId, tagId);
    return rows.length;
  },

  // --- Operaciones masivas atomicas (una unica transaccion Dexie) ---

  // Crea varios movimientos de golpe (splits, par de transferencia). Valida integridad de
  // cada uno y mantiene statsFlag. Todos comparten el mismo profileId (aislamiento).
  async createMany(profileId: string, inputs: NewTransaction[]): Promise<Transaction[]> {
    requireProfileId(profileId);
    const entities: Transaction[] = inputs.map((input) =>
      buildTransactionEntity(profileId, input),
    );
    await db.transaction('rw', db.transactions, async () => {
      await db.transactions.bulkAdd(entities);
    });
    return entities;
  },

  // Aplica una mutacion a un conjunto de movimientos del perfil, en una unica transaccion.
  // `mutate` recibe el movimiento actual y devuelve el patch a aplicar. Se re-fijan id y
  // profileId, se mantiene statsFlag y se valida integridad. Ignora ids de otro perfil o
  // inexistentes (no rompe el lote). Devuelve cuantos se modificaron.
  async applyToMany(
    profileId: string,
    ids: string[],
    mutate: (t: Transaction) => TransactionPatch,
  ): Promise<number> {
    requireProfileId(profileId);
    if (ids.length === 0) return 0;
    let changed = 0;
    await db.transaction('rw', db.transactions, async () => {
      for (const id of ids) {
        const existing = await db.transactions.get(id);
        // Aislamiento: un id de otro perfil se ignora como si no existiera.
        if (!existing || existing.profileId !== profileId) continue;
        const merged: Transaction = {
          ...existing,
          ...mutate(existing),
          id: existing.id,
          profileId: existing.profileId,
          updatedAt: now(),
        };
        merged.statsFlag = statsFlagFor(merged.excludedFromStats);
        validateIntegrity(merged);
        await db.transactions.put(merged);
        changed += 1;
      }
    });
    return changed;
  },

  // Borra un conjunto de movimientos del perfil en una unica transaccion. Ignora ids de
  // otro perfil o inexistentes. Devuelve cuantos se borraron realmente.
  async removeMany(profileId: string, ids: string[]): Promise<number> {
    requireProfileId(profileId);
    if (ids.length === 0) return 0;
    let removed = 0;
    await db.transaction('rw', db.transactions, async () => {
      for (const id of ids) {
        const existing = await db.transactions.get(id);
        if (!existing || existing.profileId !== profileId) continue;
        await db.transactions.delete(id);
        removed += 1;
      }
    });
    return removed;
  },

  // Desvincula una etiqueta de todos los movimientos del perfil que la llevan, en una
  // unica transaccion Dexie. Devuelve cuantos movimientos se modificaron. Solo toca el
  // perfil indicado (aislamiento). No borra movimientos: solo quita la etiqueta.
  async detachTagFromAll(profileId: string, tagId: string): Promise<number> {
    requireProfileId(profileId);
    const affected = await transactionsRepo.listByTag(profileId, tagId);
    if (affected.length === 0) return 0;
    const ts = now();
    await db.transaction('rw', db.transactions, async () => {
      for (const t of affected) {
        await db.transactions.update(t.id, {
          tagIds: t.tagIds.filter((x) => x !== tagId),
          updatedAt: ts,
        });
      }
    });
    return affected.length;
  },
};
