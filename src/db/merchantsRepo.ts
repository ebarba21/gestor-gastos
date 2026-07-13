// Repositorio de comercios (Merchant). Exige profileId. Ver DATA_MODEL 2.14.1.
//
// La fusion de comercios (mergeMerchants/undoMerge) vive aqui, no en el servicio, porque
// escribe atomicamente en varias tablas (merchants, merchantAliases, transactions) dentro de
// UNA sola transaccion Dexie, siguiendo el mismo patron que importBatchesRepo.commitBatch:
// nunca queda un alias o movimiento "huerfano" apuntando a un comercio ya fusionado.
import type { Table } from 'dexie';
import type { Merchant, MerchantAlias, SyncEntityType, SyncStatus, Transaction } from './schema';
import { db, now } from './index';
import { createProfileRepo, isAlive } from './baseRepo';
import { enqueueMutation, ownerOfProfile } from './outboxWrite';
import { NotFoundError, assert, requireProfileId } from '../lib/validation';

const base = createProfileRepo<Merchant>(db.merchants, 'Merchant', 'merchant');

// Escribe una fila ya modificada y, si el perfil esta vinculado a una cuenta, la marca
// 'pending' y encola su mutacion (misma transaccion). Comun a las escrituras de la fusion.
async function putWithSync<T extends { id: string; revision?: number; syncStatus?: SyncStatus }>(
  table: Table<T, string>,
  entityType: SyncEntityType,
  userId: string | null,
  profileId: string,
  row: T,
): Promise<void> {
  if (userId) {
    row.syncStatus = 'pending';
    await table.put(row);
    await enqueueMutation({
      userId,
      profileId,
      entityType,
      entityId: row.id,
      operation: 'update',
      entity: row as unknown as Record<string, unknown>,
      baseRevision: row.revision ?? 0,
    });
  } else {
    await table.put(row);
  }
}

// Snapshot suficiente para deshacer una fusion: solo cambia `merchantId` en alias/movimientos
// y los defaults/archivado del propio comercio, asi que revertir es reasignar esos mismos ids
// al origen y restaurar los valores anteriores del destino/origen.
export interface MerchantMergeSnapshot {
  sourceId: string;
  targetId: string;
  aliasIds: string[];
  transactionIds: string[];
  targetDefaultsBefore: {
    defaultCategoryId: string | null;
    defaultSubcategoryId: string | null;
    defaultTagIds: string[];
  };
  sourceArchivedAtBefore: number | null;
}

export interface MerchantMergeResult {
  movedAliases: number;
  movedTransactions: number;
  snapshot: MerchantMergeSnapshot;
}

export const merchantsRepo = {
  ...base,

  // Comercios no archivados del perfil.
  async listActive(profileId: string): Promise<Merchant[]> {
    requireProfileId(profileId);
    const all = await db.merchants.where('profileId').equals(profileId).filter(isAlive).toArray();
    return all.filter((m) => m.archivedAt === null);
  },

  // Comercios archivados del perfil (para poder reactivarlos).
  async listArchived(profileId: string): Promise<Merchant[]> {
    requireProfileId(profileId);
    const all = await db.merchants.where('profileId').equals(profileId).filter(isAlive).toArray();
    return all.filter((m) => m.archivedAt !== null);
  },

  // Busca un comercio por su nombre ya normalizado (indice [profileId+normalizedName]).
  // Se usa para evitar duplicar comercios al crear ("Amazon" ya existe).
  async findByNormalizedName(profileId: string, normalizedName: string): Promise<Merchant | undefined> {
    requireProfileId(profileId);
    const rows = await db.merchants
      .where('[profileId+normalizedName]')
      .equals([profileId, normalizedName])
      .filter(isAlive)
      .toArray();
    return rows[0];
  },

  // Recuentos de lo que se moveria al fusionar (para que la UI los muestre ANTES de confirmar).
  async previewMerge(
    profileId: string,
    sourceId: string,
  ): Promise<{ aliases: number; transactions: number }> {
    requireProfileId(profileId);
    const [aliases, transactions] = await Promise.all([
      db.merchantAliases
        .where('merchantId')
        .equals(sourceId)
        .filter((a) => a.profileId === profileId && isAlive(a))
        .count(),
      db.transactions
        .where('[profileId+merchantId]')
        .equals([profileId, sourceId])
        .filter(isAlive)
        .count(),
    ]);
    return { aliases, transactions };
  },

  // Fusiona `sourceId` dentro de `targetId`: mueve todos sus alias y movimientos, resuelve
  // los defaults del destino (solo si estan vacios) y archiva el origen (nunca lo borra: sin
  // huerfanos y reversible). Todo en UNA transaccion Dexie. Idempotente/reintentable: si se
  // llama de nuevo tras un exito parcial, source ya no tiene alias/movimientos que mover y la
  // segunda llamada simplemente no mueve nada mas (no duplica).
  async mergeMerchants(profileId: string, sourceId: string, targetId: string): Promise<MerchantMergeResult> {
    requireProfileId(profileId);
    assert(sourceId !== targetId, 'No se puede fusionar un comercio consigo mismo.');
    const [source, target] = await Promise.all([db.merchants.get(sourceId), db.merchants.get(targetId)]);
    if (!source || source.profileId !== profileId || !isAlive(source)) {
      throw new NotFoundError(`Merchant ${sourceId} no existe en el perfil ${profileId}.`);
    }
    if (!target || target.profileId !== profileId || !isAlive(target)) {
      throw new NotFoundError(`Merchant ${targetId} no existe en el perfil ${profileId}.`);
    }

    const ts = now();
    const aliasIds: string[] = [];
    const transactionIds: string[] = [];
    const targetDefaultsBefore = {
      defaultCategoryId: target.defaultCategoryId,
      defaultSubcategoryId: target.defaultSubcategoryId,
      defaultTagIds: [...target.defaultTagIds],
    };

    await db.transaction(
      'rw',
      [db.merchants, db.merchantAliases, db.transactions, db.profiles, db.outbox],
      async () => {
        const userId = await ownerOfProfile(profileId);

        const aliases = await db.merchantAliases
          .where('merchantId')
          .equals(sourceId)
          .filter((a) => a.profileId === profileId && isAlive(a))
          .toArray();
        for (const a of aliases) {
          await putWithSync<MerchantAlias>(db.merchantAliases, 'merchantAlias', userId, profileId, {
            ...a,
            merchantId: targetId,
            updatedAt: ts,
          });
          aliasIds.push(a.id);
        }

        const txs = await db.transactions
          .where('[profileId+merchantId]')
          .equals([profileId, sourceId])
          .filter(isAlive)
          .toArray();
        for (const t of txs) {
          await putWithSync<Transaction>(db.transactions, 'transaction', userId, profileId, {
            ...t,
            merchantId: targetId,
            updatedAt: ts,
          });
          transactionIds.push(t.id);
        }

        // Defaults: el destino conserva los suyos; solo hereda del origen lo que tuviera vacio.
        await putWithSync<Merchant>(db.merchants, 'merchant', userId, profileId, {
          ...target,
          defaultCategoryId: target.defaultCategoryId ?? source.defaultCategoryId,
          defaultSubcategoryId: target.defaultSubcategoryId ?? source.defaultSubcategoryId,
          defaultTagIds: target.defaultTagIds.length > 0 ? target.defaultTagIds : source.defaultTagIds,
          updatedAt: ts,
        });
        // El origen se archiva (no se borra): conserva historico y permite deshacer.
        await putWithSync<Merchant>(db.merchants, 'merchant', userId, profileId, {
          ...source,
          archivedAt: ts,
          updatedAt: ts,
        });
      },
    );

    return {
      movedAliases: aliasIds.length,
      movedTransactions: transactionIds.length,
      snapshot: {
        sourceId,
        targetId,
        aliasIds,
        transactionIds,
        targetDefaultsBefore,
        sourceArchivedAtBefore: source.archivedAt,
      },
    };
  },

  // Deshace una fusion reciente a partir de su snapshot: reasigna alias y movimientos al
  // origen, restaura los defaults previos del destino y desarchiva el origen. Solo posible
  // mientras el snapshot este disponible (la UI lo ofrece justo tras fusionar, no de forma
  // persistente entre sesiones).
  async undoMerge(profileId: string, snapshot: MerchantMergeSnapshot): Promise<void> {
    requireProfileId(profileId);
    const ts = now();
    await db.transaction(
      'rw',
      [db.merchants, db.merchantAliases, db.transactions, db.profiles, db.outbox],
      async () => {
        const userId = await ownerOfProfile(profileId);

        for (const id of snapshot.aliasIds) {
          const row = await db.merchantAliases.get(id);
          if (!row || row.profileId !== profileId) continue;
          await putWithSync<MerchantAlias>(db.merchantAliases, 'merchantAlias', userId, profileId, {
            ...row,
            merchantId: snapshot.sourceId,
            updatedAt: ts,
          });
        }

        for (const id of snapshot.transactionIds) {
          const row = await db.transactions.get(id);
          if (!row || row.profileId !== profileId) continue;
          await putWithSync<Transaction>(db.transactions, 'transaction', userId, profileId, {
            ...row,
            merchantId: snapshot.sourceId,
            updatedAt: ts,
          });
        }

        const target = await db.merchants.get(snapshot.targetId);
        if (target && target.profileId === profileId) {
          await putWithSync<Merchant>(db.merchants, 'merchant', userId, profileId, {
            ...target,
            ...snapshot.targetDefaultsBefore,
            updatedAt: ts,
          });
        }
        const source = await db.merchants.get(snapshot.sourceId);
        if (source && source.profileId === profileId) {
          await putWithSync<Merchant>(db.merchants, 'merchant', userId, profileId, {
            ...source,
            archivedAt: snapshot.sourceArchivedAtBefore,
            updatedAt: ts,
          });
        }
      },
    );
  },
};
