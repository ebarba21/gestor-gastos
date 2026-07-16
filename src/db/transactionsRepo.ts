// Repositorio de movimientos (Transaction). Entidad central. Exige profileId.
// Ver DATA_MODEL 2.6. Responsabilidades propias del repositorio:
//   - mantener statsFlag como espejo indexable de excludedFromStats,
//   - validar la coherencia entre type y signo del importe,
//   - validar la relacion categorizedBy <-> ruleId.
import type { Transaction, SyncMeta } from './schema';
import { db, newId, now, syncDefaults } from './index';
import { isAlive } from './baseRepo';
import { enqueueMutation, ownerOfProfile } from './outboxWrite';
import {
  NotFoundError,
  ValidationError,
  requireAccountingDate,
  requireId,
  requireProfileId,
} from '../lib/validation';
import { assertCents } from '../lib/money';

// Encola una mutacion de movimiento (fase 2). baseRevision = la revision local (ultima confirmada;
// la escritura optimista no la altera). Debe llamarse dentro de una transaccion con db.outbox.
async function enqueueTx(
  userId: string,
  profileId: string,
  operation: 'insert' | 'update' | 'delete',
  entity: Transaction,
): Promise<void> {
  await enqueueMutation({
    userId,
    profileId,
    entityType: 'transaction',
    entityId: entity.id,
    operation,
    entity: entity as unknown as Record<string, unknown>,
    baseRevision: entity.revision ?? 0,
  });
}

// Campos que fija/deriva el repositorio y no forman parte de la entrada del llamante:
// id, profileId, timestamps, statsFlag (espejo) y los campos de sincronizacion (SyncMeta).
export type NewTransaction = Omit<
  Transaction,
  'id' | 'profileId' | 'createdAt' | 'updatedAt' | 'statsFlag' | keyof SyncMeta
>;
// rawConcept es INMUTABLE tras crear el movimiento (invariante 12 de CLAUDE.md); normalizedConcept
// y normalizationVersion se derivan de el y solo cambian junto con un recalculo explicito de
// normalizacion (migracion de esquema), nunca via un patch de actualizacion normal. Excluirlos
// del tipo hace el invariante exigible en compilacion, no solo por convencion de los servicios.
export type TransactionPatch = Partial<
  Omit<NewTransaction, 'rawConcept' | 'normalizedConcept' | 'normalizationVersion'>
>;

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
    ...syncDefaults(),
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
    await db.transaction('rw', [db.transactions, db.profiles, db.outbox], async () => {
      const userId = await ownerOfProfile(profileId);
      if (userId) {
        entity.syncStatus = 'pending';
        await db.transactions.add(entity);
        await enqueueTx(userId, profileId, 'insert', entity);
      } else {
        await db.transactions.add(entity);
      }
    });
    return entity;
  },

  async getById(profileId: string, id: string): Promise<Transaction | undefined> {
    requireProfileId(profileId);
    requireId(id);
    const row = await db.transactions.get(id);
    // Aislamiento + tombstone => inexistente.
    if (!row || row.profileId !== profileId || !isAlive(row)) return undefined;
    return row;
  },

  async list(profileId: string): Promise<Transaction[]> {
    requireProfileId(profileId);
    return db.transactions.where('profileId').equals(profileId).filter(isAlive).toArray();
  },

  async update(
    profileId: string,
    id: string,
    patch: TransactionPatch,
  ): Promise<Transaction> {
    requireProfileId(profileId);
    requireId(id);
    // Pertenencia validada antes de la transaccion (error de aislamiento limpio).
    const existing = await requireOwned(profileId, id);
    let merged!: Transaction;
    await db.transaction('rw', [db.transactions, db.profiles, db.outbox], async () => {
      // id y profileId se re-fijan tras el patch como barrera de aislamiento en runtime.
      merged = {
        ...existing,
        ...patch,
        id: existing.id,
        profileId: existing.profileId,
        updatedAt: now(),
      };
      // Mantener el espejo indexable sincronizado en cada escritura.
      merged.statsFlag = statsFlagFor(merged.excludedFromStats);
      validateIntegrity(merged);
      const userId = await ownerOfProfile(profileId);
      if (userId) {
        merged.syncStatus = 'pending';
        await db.transactions.put(merged);
        await enqueueTx(userId, profileId, 'update', merged);
      } else {
        await db.transactions.put(merged);
      }
    });
    return merged;
  },

  async remove(profileId: string, id: string): Promise<void> {
    requireProfileId(profileId);
    requireId(id);
    // Pertenencia validada antes de la transaccion (error de aislamiento limpio).
    const existing = await requireOwned(profileId, id);
    await db.transaction('rw', [db.transactions, db.profiles, db.outbox], async () => {
      const userId = await ownerOfProfile(profileId);
      if (userId) {
        // Borrado LOGICO (tombstone) para propagar la baja sin resucitar.
        const ts = now();
        const tomb: Transaction = {
          ...existing,
          deletedAt: ts,
          updatedAt: ts,
          syncStatus: 'pending',
        };
        await db.transactions.put(tomb);
        await enqueueTx(userId, profileId, 'delete', tomb);
      } else {
        await db.transactions.delete(id);
      }
    });
  },

  count(profileId: string): Promise<number> {
    requireProfileId(profileId);
    return db.transactions.where('profileId').equals(profileId).filter(isAlive).count();
  },

  // --- Queries por indice (todas encabezadas por profileId) ---

  // Rango de fechas contables inclusivo (indice de trabajo del dashboard y la lista).
  listByDateRange(profileId: string, from: string, to: string): Promise<Transaction[]> {
    requireProfileId(profileId);
    return db.transactions
      .where('[profileId+date]')
      .between([profileId, from], [profileId, to], true, true)
      .filter(isAlive)
      .toArray();
  },

  listByAccount(profileId: string, accountId: string): Promise<Transaction[]> {
    requireProfileId(profileId);
    return db.transactions
      .where('[profileId+accountId]')
      .equals([profileId, accountId])
      .filter(isAlive)
      .toArray();
  },

  // Movimientos que SI cuentan en estadisticas (statsFlag = 0). Excluye tombstones.
  listForStats(profileId: string): Promise<Transaction[]> {
    requireProfileId(profileId);
    return db.transactions
      .where('[profileId+statsFlag]')
      .equals([profileId, 0])
      .filter(isAlive)
      .toArray();
  },

  // Deteccion de duplicados: lookup O(log n) por [profileId+dedupeHash]. Excluye tombstones.
  listByDedupeHash(profileId: string, dedupeHash: string): Promise<Transaction[]> {
    requireProfileId(profileId);
    return db.transactions
      .where('[profileId+dedupeHash]')
      .equals([profileId, dedupeHash])
      .filter(isAlive)
      .toArray();
  },

  // Conjunto de todos los dedupeHash del perfil, para deteccion de duplicados en lote
  // (importacion) sin hacer una consulta por fila. Escaneo solo de indice
  // ([profileId+dedupeHash]): no deserializa los registros completos, asi escala a decenas
  // de miles de movimientos. Aislamiento: solo el perfil indicado.
  async collectDedupeHashes(profileId: string): Promise<Set<string>> {
    requireProfileId(profileId);
    // Escaneo solo de indice (no deserializa filas). Un tombstone (fila borrada logicamente) puede
    // aportar su hash; como el dedupe es un AVISO y no un bloqueo, el falso positivo es aceptable y
    // se prioriza el rendimiento a decenas de miles de filas.
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

  // --- Deteccion avanzada de duplicados (fase 5, DATA_MODEL 15) ---

  // Movimientos con el mismo identificador bancario dentro de una cuenta (nivel "exact" mas
  // fiable). Excluye tombstones. La unicidad remota es (profile_id, account_id,
  // bank_transaction_id); localmente se filtra en memoria por cuenta porque el indice solo
  // cubre profileId+bankTransactionId (bankTransactionId ya es suficientemente selectivo).
  async listByBankTransactionId(
    profileId: string,
    accountId: string,
    bankTransactionId: string,
  ): Promise<Transaction[]> {
    requireProfileId(profileId);
    const rows = await db.transactions
      .where('[profileId+bankTransactionId]')
      .equals([profileId, bankTransactionId])
      .filter(isAlive)
      .toArray();
    return rows.filter((t) => t.accountId === accountId);
  },

  // Identidad exacta (cuenta+fecha+importe+moneda+concepto normalizado). Excluye tombstones.
  listByExactFingerprint(profileId: string, exactFingerprint: string): Promise<Transaction[]> {
    requireProfileId(profileId);
    return db.transactions
      .where('[profileId+exactFingerprint]')
      .equals([profileId, exactFingerprint])
      .filter(isAlive)
      .toArray();
  },

  // Identidad tolerante (cuenta+importe+moneda+comercio/concepto, SIN fecha): candidatos para
  // los niveles strongNormalized/possible/weak. El llamante (duplicateEngine) aplica la
  // ventana temporal sobre el resultado. Ya acotado por cuenta+moneda+importe+comercio porque
  // esos campos forman la huella (DATA_MODEL 15.1); nunca se compara todo contra todo.
  listByNormalizedFingerprint(
    profileId: string,
    normalizedFingerprint: string,
  ): Promise<Transaction[]> {
    requireProfileId(profileId);
    return db.transactions
      .where('[profileId+normalizedFingerprint]')
      .equals([profileId, normalizedFingerprint])
      .filter(isAlive)
      .toArray();
  },

  // Movimientos con un nivel de duplicado concreto (API para la bandeja de revision, fase 6).
  listByDuplicateStatus(
    profileId: string,
    status: Transaction['duplicateStatus'],
  ): Promise<Transaction[]> {
    requireProfileId(profileId);
    return db.transactions
      .where('[profileId+duplicateStatus]')
      .equals([profileId, status])
      .filter(isAlive)
      .toArray();
  },

  // Movimientos pendientes (status='pending') de una cuenta, candidatos a ser sustituidos por
  // un confirmado compatible (FINANCIAL_ALGORITHMS seccion 5, "pendiente -> confirmado").
  async listPendingByAccount(profileId: string, accountId: string): Promise<Transaction[]> {
    requireProfileId(profileId);
    const rows = await db.transactions
      .where('[profileId+accountId]')
      .equals([profileId, accountId])
      .filter(isAlive)
      .toArray();
    return rows.filter((t) => t.pending);
  },

  // Movimientos asociados a un comercio (indice [profileId+merchantId]).
  listByMerchant(profileId: string, merchantId: string): Promise<Transaction[]> {
    requireProfileId(profileId);
    return db.transactions
      .where('[profileId+merchantId]')
      .equals([profileId, merchantId])
      .filter(isAlive)
      .toArray();
  },

  // Movimientos SIN comercio asociado (para revisar candidatos de nuevos comercios). Dexie no
  // indexa null en indices compuestos: se escanea el perfil y se filtra en memoria (uso
  // puntual desde la seccion de comercios, no en caliente).
  async listWithoutMerchant(profileId: string): Promise<Transaction[]> {
    requireProfileId(profileId);
    const all = await db.transactions.where('profileId').equals(profileId).filter(isAlive).toArray();
    return all.filter((t) => t.merchantId === null);
  },

  countByMerchant(profileId: string, merchantId: string): Promise<number> {
    requireProfileId(profileId);
    return db.transactions
      .where('[profileId+merchantId]')
      .equals([profileId, merchantId])
      .filter(isAlive)
      .count();
  },

  listByImportBatch(profileId: string, importBatchId: string): Promise<Transaction[]> {
    requireProfileId(profileId);
    return db.transactions
      .where('[profileId+importBatchId]')
      .equals([profileId, importBatchId])
      .filter(isAlive)
      .toArray();
  },

  // Lineas hijas de un split (parentId apunta al padre). Indice [profileId+parentId].
  listChildren(profileId: string, parentId: string): Promise<Transaction[]> {
    requireProfileId(profileId);
    return db.transactions
      .where('[profileId+parentId]')
      .equals([profileId, parentId])
      .filter(isAlive)
      .toArray();
  },

  // Las dos patas de una transferencia interna (mismo transferGroupId).
  listByTransferGroup(profileId: string, transferGroupId: string): Promise<Transaction[]> {
    requireProfileId(profileId);
    return db.transactions
      .where('[profileId+transferGroupId]')
      .equals([profileId, transferGroupId])
      .filter(isAlive)
      .toArray();
  },

  // Movimientos con una etiqueta dada dentro del perfil. multiEntry (*tagIds) no
  // compone con indices compuestos, por eso se filtra el perfil en memoria.
  async listByTag(profileId: string, tagId: string): Promise<Transaction[]> {
    requireProfileId(profileId);
    const rows = await db.transactions.where('tagIds').equals(tagId).toArray();
    return rows.filter((t) => t.profileId === profileId && isAlive(t));
  },

  // --- Contadores de uso (reglas de integridad al borrar cuentas/categorias/etiquetas) ---

  // Movimientos que usan una cuenta (indice [profileId+accountId]). Excluye tombstones para no
  // bloquear el borrado de una cuenta por movimientos ya borrados logicamente.
  countByAccount(profileId: string, accountId: string): Promise<number> {
    requireProfileId(profileId);
    return db.transactions
      .where('[profileId+accountId]')
      .equals([profileId, accountId])
      .filter(isAlive)
      .count();
  },

  // Movimientos cuya categoria (raiz o sub) es categoryId (indice [profileId+categoryId]).
  countByCategory(profileId: string, categoryId: string): Promise<number> {
    requireProfileId(profileId);
    return db.transactions
      .where('[profileId+categoryId]')
      .equals([profileId, categoryId])
      .filter(isAlive)
      .count();
  },

  // Movimientos que referencian una subcategoria en el campo subcategoryId. Ese campo no
  // esta indexado (DATA_MODEL seccion 3), asi que se escanea el perfil y se filtra en
  // memoria. Uso puntual (solo al borrar una categoria), no en caliente.
  async countBySubcategory(profileId: string, subcategoryId: string): Promise<number> {
    requireProfileId(profileId);
    const rows = await db.transactions.where('profileId').equals(profileId).toArray();
    return rows.filter((t) => t.subcategoryId === subcategoryId && isAlive(t)).length;
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
    await db.transaction('rw', [db.transactions, db.profiles, db.outbox], async () => {
      const userId = await ownerOfProfile(profileId);
      if (userId) {
        for (const e of entities) e.syncStatus = 'pending';
        await db.transactions.bulkAdd(entities);
        for (const e of entities) await enqueueTx(userId, profileId, 'insert', e);
      } else {
        await db.transactions.bulkAdd(entities);
      }
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
    await db.transaction('rw', [db.transactions, db.profiles, db.outbox], async () => {
      const userId = await ownerOfProfile(profileId);
      for (const id of ids) {
        const existing = await db.transactions.get(id);
        // Aislamiento: un id de otro perfil (o un tombstone) se ignora como si no existiera.
        if (!existing || existing.profileId !== profileId || !isAlive(existing)) continue;
        const merged: Transaction = {
          ...existing,
          ...mutate(existing),
          id: existing.id,
          profileId: existing.profileId,
          updatedAt: now(),
        };
        merged.statsFlag = statsFlagFor(merged.excludedFromStats);
        validateIntegrity(merged);
        if (userId) {
          merged.syncStatus = 'pending';
          await db.transactions.put(merged);
          await enqueueTx(userId, profileId, 'update', merged);
        } else {
          await db.transactions.put(merged);
        }
        changed += 1;
      }
    });
    return changed;
  },

  // Borra un conjunto de movimientos del perfil en una unica transaccion. Con cuenta el borrado es
  // logico (tombstone + mutacion); en modo local puro, fisico. Ignora ids de otro perfil o
  // inexistentes. Devuelve cuantos se borraron realmente.
  async removeMany(profileId: string, ids: string[]): Promise<number> {
    requireProfileId(profileId);
    if (ids.length === 0) return 0;
    let removed = 0;
    await db.transaction('rw', [db.transactions, db.profiles, db.outbox], async () => {
      const userId = await ownerOfProfile(profileId);
      for (const id of ids) {
        const existing = await db.transactions.get(id);
        if (!existing || existing.profileId !== profileId || !isAlive(existing)) continue;
        if (userId) {
          const ts = now();
          const tomb: Transaction = {
            ...existing,
            deletedAt: ts,
            updatedAt: ts,
            syncStatus: 'pending',
          };
          await db.transactions.put(tomb);
          await enqueueTx(userId, profileId, 'delete', tomb);
        } else {
          await db.transactions.delete(id);
        }
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
    await db.transaction('rw', [db.transactions, db.profiles, db.outbox], async () => {
      const userId = await ownerOfProfile(profileId);
      for (const t of affected) {
        const merged: Transaction = {
          ...t,
          tagIds: t.tagIds.filter((x) => x !== tagId),
          updatedAt: ts,
        };
        if (userId) {
          merged.syncStatus = 'pending';
          await db.transactions.put(merged);
          await enqueueTx(userId, profileId, 'update', merged);
        } else {
          await db.transactions.put(merged);
        }
      }
    });
    return affected.length;
  },
};
