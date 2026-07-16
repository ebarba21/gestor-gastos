// Logica PURA de la migracion de esquema v6 (fase 5, deteccion avanzada de duplicados):
// rellena los campos nuevos de un Transaction preexistente con sus valores por defecto y
// calcula las huellas versionadas. Separada de `db/index.ts` para poder testearla sin simular
// una apertura de IndexedDB en una version anterior (mismo patron que merchantMigration.ts).
// La usa el `.upgrade()` de `db.version(6)`.
import {
  computeExactFingerprint,
  computeNormalizedFingerprint,
  computeSyntheticRowHash,
  FINGERPRINT_VERSION,
} from '../lib/duplicateFingerprint';

// Moneda por defecto cuando la fila preexistente no la tiene (coherente con Setting.currency).
const DEFAULT_CURRENCY = 'EUR';

// Forma minima de una fila de `transactions` tal como la ve el `.modify()` de Dexie durante el
// upgrade v6: ya tiene los campos de negocio y de comercio (fase 4), pero puede carecer de los
// campos de esta fase.
export type LegacyTransactionRowV6 = Record<string, unknown> & {
  accountId: string;
  date: string;
  amountCents: number;
  concept: string;
};

// Rellena en `row` (mutandolo in situ, como exige `Table.modify`) los campos de metadatos
// bancarios y duplicados avanzados que falten, con sus defaults documentados en DATA_MODEL
// 15.1. Devuelve `true` si se toco algun campo (para decidir si la fila necesita subir de
// nuevo si ya estaba sincronizada).
export function backfillDuplicateFields(row: LegacyTransactionRowV6): boolean {
  let touched = false;

  if (row.bankTransactionId === undefined) {
    row.bankTransactionId = null;
    touched = true;
  }
  if (row.bookingDate === undefined) {
    row.bookingDate = null;
    touched = true;
  }
  if (row.valueDate === undefined) {
    row.valueDate = null;
    touched = true;
  }
  if (row.pending === undefined) {
    row.pending = false;
    touched = true;
  }
  if (row.currency === undefined) {
    row.currency = DEFAULT_CURRENCY;
    touched = true;
  }
  if (row.balanceAfterCents === undefined) {
    row.balanceAfterCents = null;
    touched = true;
  }
  if (row.bankReference === undefined) {
    row.bankReference = null;
    touched = true;
  }
  if (row.operationType === undefined) {
    row.operationType = null;
    touched = true;
  }
  if (row.sourceFileHash === undefined) {
    row.sourceFileHash = null;
    touched = true;
  }
  if (row.sourceFileSize === undefined) {
    row.sourceFileSize = null;
    touched = true;
  }
  if (row.duplicateStatus === undefined) {
    // Los movimientos ya existentes no se re-evaluan contra el motor de duplicados en la
    // migracion (recalculo explicito, nunca en silencio): quedan 'unique' hasta que una
    // importacion futura los compare con nuevas filas.
    row.duplicateStatus = 'unique';
    touched = true;
  }
  if (row.duplicateConfidence === undefined) {
    row.duplicateConfidence = 0;
    touched = true;
  }
  if (row.duplicateReasonCodes === undefined) {
    row.duplicateReasonCodes = [];
    touched = true;
  }
  if (row.duplicateCandidateIds === undefined) {
    row.duplicateCandidateIds = [];
    touched = true;
  }
  if (row.pendingReplacementId === undefined) {
    row.pendingReplacementId = null;
    touched = true;
  }
  if (row.sourceRowHash === undefined) {
    row.sourceRowHash = computeSyntheticRowHash({
      date: row.date,
      amountCents: row.amountCents,
      concept: row.concept,
      accountId: row.accountId,
    });
    touched = true;
  }

  const needsFingerprints =
    row.exactFingerprint === undefined ||
    row.normalizedFingerprint === undefined ||
    row.fingerprintVersion === undefined;
  if (needsFingerprints) {
    const normalizedConcept =
      typeof row.normalizedConcept === 'string' ? row.normalizedConcept : '';
    const currency = typeof row.currency === 'string' ? row.currency : DEFAULT_CURRENCY;
    const merchantId = (row.merchantId as string | null | undefined) ?? null;
    const fpInput = {
      accountId: row.accountId,
      date: row.date,
      amountCents: row.amountCents,
      currency,
      normalizedConcept,
      merchantId,
    };
    if (row.exactFingerprint === undefined) {
      row.exactFingerprint = computeExactFingerprint(fpInput);
      touched = true;
    }
    if (row.normalizedFingerprint === undefined) {
      row.normalizedFingerprint = computeNormalizedFingerprint(fpInput);
      touched = true;
    }
    if (row.fingerprintVersion === undefined) {
      row.fingerprintVersion = FINGERPRINT_VERSION;
      touched = true;
    }
  }

  return touched;
}

// Forma minima de una fila de `importBatches` durante el upgrade v6.
export type LegacyImportBatchRowV6 = Record<string, unknown>;

// Rellena los campos nuevos de ImportBatch (hash/tamano de fichero de origen, contador de
// filas vinculadas).
export function backfillImportBatchFields(row: LegacyImportBatchRowV6): boolean {
  let touched = false;
  if (row.sourceFileHash === undefined) {
    row.sourceFileHash = null;
    touched = true;
  }
  if (row.sourceFileSize === undefined) {
    row.sourceFileSize = null;
    touched = true;
  }
  if (row.rowsLinked === undefined) {
    row.rowsLinked = 0;
    touched = true;
  }
  return touched;
}
