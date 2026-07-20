// Repositorio de tareas de revision (ReviewItem). Exige profileId. Ver DATA_MODEL seccion 16 y
// ARCHITECTURE seccion 17. La bandeja unifica excepciones de import/reglas/duplicados/
// transferencias/reembolsos/comercios/sync en una unica cola por perfil.
import type { ReviewItem, ReviewItemStatus, ReviewItemType } from './schema';
import { db, now } from './index';
import { createProfileRepo, isAlive } from './baseRepo';
import { requireId, requireProfileId } from '../lib/validation';

const base = createProfileRepo(db.reviewItems, 'ReviewItem', 'reviewItem');

export const reviewItemsRepo = {
  ...base,

  async listOpen(profileId: string): Promise<ReviewItem[]> {
    requireProfileId(profileId);
    return db.reviewItems
      .where('[profileId+status]')
      .equals([profileId, 'open'])
      .filter(isAlive)
      .toArray();
  },

  async listByStatus(profileId: string, status: ReviewItemStatus): Promise<ReviewItem[]> {
    requireProfileId(profileId);
    return db.reviewItems
      .where('[profileId+status]')
      .equals([profileId, status])
      .filter(isAlive)
      .toArray();
  },

  async listByType(profileId: string, type: ReviewItemType): Promise<ReviewItem[]> {
    requireProfileId(profileId);
    return db.reviewItems
      .where('[profileId+type]')
      .equals([profileId, type])
      .filter(isAlive)
      .toArray();
  },

  // Clave de idempotencia (ver reviewService): como mucho una tarea ABIERTA por (profileId,
  // type, entityId). Se usa antes de crear una tarea nueva para decidir si hay que actualizar
  // la existente en vez de duplicarla.
  async findOpenByTypeAndEntity(
    profileId: string,
    type: ReviewItemType,
    entityId: string,
  ): Promise<ReviewItem | undefined> {
    requireProfileId(profileId);
    const rows = await db.reviewItems
      .where('[profileId+type+entityId]')
      .equals([profileId, type, entityId])
      .filter(isAlive)
      .toArray();
    return rows.find((r) => r.status === 'open');
  },

  // Cualquier tarea (de cualquier estado) para (type, entityId); usada para decidir si una
  // tarea resuelta/descartada debe reabrirse tras un cambio relevante (huellas/candidatos
  // distintos), en vez de crear una tarea nueva sobre la misma entidad.
  async findLatestByTypeAndEntity(
    profileId: string,
    type: ReviewItemType,
    entityId: string,
  ): Promise<ReviewItem | undefined> {
    requireProfileId(profileId);
    const rows = await db.reviewItems
      .where('[profileId+type+entityId]')
      .equals([profileId, type, entityId])
      .filter(isAlive)
      .toArray();
    return rows.sort((a, b) => b.createdAt - a.createdAt)[0];
  },

  async countByStatus(profileId: string): Promise<Record<ReviewItemStatus, number>> {
    requireProfileId(profileId);
    const rows = await db.reviewItems.where('profileId').equals(profileId).filter(isAlive).toArray();
    const counts: Record<ReviewItemStatus, number> = { open: 0, snoozed: 0, resolved: 0, dismissed: 0 };
    for (const r of rows) counts[r.status] += 1;
    return counts;
  },

  async countOpenByType(profileId: string): Promise<Partial<Record<ReviewItemType, number>>> {
    requireProfileId(profileId);
    const rows = await db.reviewItems
      .where('[profileId+status]')
      .equals([profileId, 'open'])
      .filter(isAlive)
      .toArray();
    const counts: Partial<Record<ReviewItemType, number>> = {};
    for (const r of rows) counts[r.type] = (counts[r.type] ?? 0) + 1;
    return counts;
  },

  // Resolucion/descarte/aplazamiento/reapertura MASIVA en una unica transaccion Dexie (patron
  // atomico de importBatchesRepo.commitBatch): o se aplican todas las transiciones o ninguna,
  // para que una accion masiva desde la bandeja no deje resoluciones a medias.
  async bulkUpdateStatus(
    profileId: string,
    ids: string[],
    patch: {
      status: ReviewItemStatus;
      resolution?: string | null;
      resolvedAt?: number | null;
    },
  ): Promise<ReviewItem[]> {
    requireProfileId(profileId);
    const results: ReviewItem[] = [];
    await db.transaction('rw', [db.reviewItems, db.profiles, db.outbox], async () => {
      for (const id of ids) {
        requireId(id);
        const updated = await base.update(profileId, id, {
          status: patch.status,
          resolution: patch.resolution ?? null,
          resolvedAt: patch.resolvedAt ?? (patch.status === 'resolved' || patch.status === 'dismissed' ? now() : null),
        });
        results.push(updated);
      }
    });
    return results;
  },
};
