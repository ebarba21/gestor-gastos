// Logica PURA de la migracion de esquema v5 (fase 4, comercios normalizados): rellena los
// campos de comercio de un Transaction preexistente con sus valores por defecto. Separada de
// `db/index.ts` para poder testearla sin simular una apertura de IndexedDB en una version
// anterior (ver merchantMigration.test.ts). La usa el `.upgrade()` de `db.version(5)`.
import { normalizeConceptV1, NORMALIZATION_VERSION } from '../lib/normalization';

// Forma minima de una fila de `transactions` tal como la ve el `.modify()` de Dexie durante el
// upgrade: un objeto mutable de negocio (no tipado como Transaction porque, viniendo de una
// version anterior del esquema, puede carecer de los campos nuevos).
export type LegacyTransactionRow = Record<string, unknown> & { concept: string; profileId: string };

// Rellena en `row` (mutandolo in situ, como exige `Table.modify`) los campos de comercio que
// falten, con sus defaults documentados en DATA_MODEL 14.3. Devuelve `true` si se toco algun
// campo (para decidir si la fila necesita subir de nuevo si ya estaba sincronizada).
export function backfillMerchantFields(row: LegacyTransactionRow): boolean {
  let touched = false;
  if (row.rawConcept === undefined) {
    row.rawConcept = row.concept;
    touched = true;
  }
  if (row.normalizedConcept === undefined) {
    row.normalizedConcept = normalizeConceptV1(String(row.concept ?? ''));
    touched = true;
  }
  if (row.normalizationVersion === undefined) {
    row.normalizationVersion = NORMALIZATION_VERSION;
    touched = true;
  }
  if (row.merchantId === undefined) {
    row.merchantId = null;
    touched = true;
  }
  if (row.merchantMatchSource === undefined) {
    row.merchantMatchSource = 'none';
    touched = true;
  }
  if (row.merchantMatchConfidence === undefined) {
    row.merchantMatchConfidence = 0;
    touched = true;
  }
  return touched;
}
