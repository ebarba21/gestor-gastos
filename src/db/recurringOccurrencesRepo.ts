// Repositorio de ocurrencias de series recurrentes (RecurringOccurrence). Exige profileId. Ver
// DATA_MODEL seccion 18.2 y FINANCIAL_ALGORITHMS seccion 7.
import type { RecurringOccurrence, RecurringOccurrenceStatus } from './schema';
import { db } from './index';
import { createProfileRepo, isAlive } from './baseRepo';
import { requireProfileId, requireId } from '../lib/validation';

const base = createProfileRepo(db.recurringOccurrences, 'RecurringOccurrence', 'recurringOccurrence');

export const recurringOccurrencesRepo = {
  ...base,

  async listBySeries(profileId: string, seriesId: string): Promise<RecurringOccurrence[]> {
    requireProfileId(profileId);
    requireId(seriesId);
    const rows = await db.recurringOccurrences
      .where('[profileId+seriesId]')
      .equals([profileId, seriesId])
      .filter(isAlive)
      .toArray();
    return rows.sort((a, b) => a.expectedDate.localeCompare(b.expectedDate));
  },

  async listByStatus(
    profileId: string,
    status: RecurringOccurrenceStatus,
  ): Promise<RecurringOccurrence[]> {
    requireProfileId(profileId);
    return db.recurringOccurrences
      .where('[profileId+status]')
      .equals([profileId, status])
      .filter(isAlive)
      .toArray();
  },

  // Proximos cobros/ingresos esperados (status='expected') dentro de una fecha limite (incluida),
  // ordenados por fecha esperada ascendente. Usado por la tarjeta "Proximos cobros".
  async listExpectedUntil(profileId: string, untilDateISO: string): Promise<RecurringOccurrence[]> {
    requireProfileId(profileId);
    const rows = await this.listByStatus(profileId, 'expected');
    return rows.filter((o) => o.expectedDate <= untilDateISO).sort((a, b) => a.expectedDate.localeCompare(b.expectedDate));
  },

  // Ocurrencias expected/missing dentro de un rango de fechas [fromISO, toISO] (ambos incluidos).
  // Usado por el forecast (recurrentes pendientes del periodo) y por el calendario.
  async listByExpectedDateRange(
    profileId: string,
    fromISO: string,
    toISO: string,
  ): Promise<RecurringOccurrence[]> {
    requireProfileId(profileId);
    return db.recurringOccurrences
      .where('[profileId+expectedDate]')
      .between([profileId, fromISO], [profileId, toISO], true, true)
      .filter(isAlive)
      .toArray();
  },

  async findByTransactionId(profileId: string, transactionId: string): Promise<RecurringOccurrence | undefined> {
    requireProfileId(profileId);
    requireId(transactionId);
    const rows = await db.recurringOccurrences
      .where('profileId')
      .equals(profileId)
      .filter((o) => isAlive(o) && o.transactionId === transactionId)
      .toArray();
    return rows[0];
  },

  // Reasigna en UNA sola transaccion Dexie un conjunto de ocurrencias a otra serie (dividir:
  // mover las ocurrencias futuras a una serie nueva; fusionar: mover TODAS las de la serie
  // absorbida a la superviviente). Atomico: o se mueven todas o ninguna, para que un
  // dividir/fusionar nunca deje una ocurrencia huerfana apuntando a una serie que ya no la
  // reclama. Mismo patron que reviewItemsRepo.bulkUpdateStatus.
  async reassignSeries(
    profileId: string,
    occurrenceIds: string[],
    newSeriesId: string,
  ): Promise<RecurringOccurrence[]> {
    requireProfileId(profileId);
    requireId(newSeriesId);
    const results: RecurringOccurrence[] = [];
    await db.transaction('rw', [db.recurringOccurrences, db.profiles, db.outbox], async () => {
      for (const id of occurrenceIds) {
        requireId(id);
        const updated = await base.update(profileId, id, { seriesId: newSeriesId });
        results.push(updated);
      }
    });
    return results;
  },
};
