// Mapeo bidireccional entre el modelo LOCAL (camelCase, Dexie) y la fila de TRANSPORTE remota
// (snake_case, Postgres). Funciones PURAS y probadas. Unica puerta de conversion:
//   - nombres de campo camelCase <-> snake_case;
//   - importes en centimos via cents.ts (nunca floats, invariante 6);
//   - timestamps epoch ms (local) <-> ISO timestamptz (remoto);
//   - tags: `tagIds: string[]` local <-> `tag_ids: uuid[]` remoto (fuente de verdad; la puente
//     transaction_tags la mantiene un trigger).
//
// `toRow` produce las columnas de NEGOCIO + auditoria (id, created_at, updated_at, deleted_at). NO
// incluye owner_user_id/profile_id/revision/last_mutation_id: esos los fija el motor de push (el
// propietario desde la sesion, la revision el servidor, el last_mutation_id la mutacion). `fromRow`
// reconstruye la entidad local marcandola como sincronizada.
import { serializeCents, serializeCentsNullable, deserializeCents, deserializeCentsNullable } from '../remote';
import type { SyncEntityType } from '../db/schema';

type FieldKind = 'plain' | 'cents' | 'centsNull' | 'ms' | 'msNull';

interface FieldSpec {
  local: string;
  remote: string;
  kind: FieldKind;
}

// Campos de auditoria comunes a todas las entidades sincronizables.
const AUDIT_FIELDS: FieldSpec[] = [
  { local: 'id', remote: 'id', kind: 'plain' },
  { local: 'createdAt', remote: 'created_at', kind: 'ms' },
  { local: 'updatedAt', remote: 'updated_at', kind: 'ms' },
  { local: 'deletedAt', remote: 'deleted_at', kind: 'msNull' },
];

// Campos de negocio por entidad (sin owner/profile/revision, que gestiona el push/servidor).
const BUSINESS_FIELDS: Record<SyncEntityType, FieldSpec[]> = {
  profile: [
    { local: 'name', remote: 'name', kind: 'plain' },
    { local: 'color', remote: 'color', kind: 'plain' },
    { local: 'avatarEmoji', remote: 'avatar_emoji', kind: 'plain' },
    { local: 'archivedAt', remote: 'archived_at', kind: 'msNull' },
  ],
  setting: [
    { local: 'currency', remote: 'currency', kind: 'plain' },
    { local: 'locale', remote: 'locale', kind: 'plain' },
    { local: 'weekStart', remote: 'week_start', kind: 'plain' },
    { local: 'defaultAccountId', remote: 'default_account_id', kind: 'plain' },
    { local: 'encryptionEnabled', remote: 'encryption_enabled', kind: 'plain' },
  ],
  account: [
    { local: 'name', remote: 'name', kind: 'plain' },
    { local: 'kind', remote: 'kind', kind: 'plain' },
    { local: 'currency', remote: 'currency', kind: 'plain' },
    { local: 'color', remote: 'color', kind: 'plain' },
    { local: 'openingBalanceCents', remote: 'opening_balance_cents', kind: 'cents' },
    { local: 'archivedAt', remote: 'archived_at', kind: 'msNull' },
  ],
  category: [
    { local: 'name', remote: 'name', kind: 'plain' },
    { local: 'parentId', remote: 'parent_id', kind: 'plain' },
    { local: 'kind', remote: 'kind', kind: 'plain' },
    { local: 'color', remote: 'color', kind: 'plain' },
    { local: 'icon', remote: 'icon', kind: 'plain' },
    { local: 'archivedAt', remote: 'archived_at', kind: 'msNull' },
    { local: 'sortOrder', remote: 'sort_order', kind: 'plain' },
  ],
  tag: [
    { local: 'name', remote: 'name', kind: 'plain' },
    { local: 'color', remote: 'color', kind: 'plain' },
  ],
  transaction: [
    { local: 'date', remote: 'date', kind: 'plain' },
    { local: 'amountCents', remote: 'amount_cents', kind: 'cents' },
    { local: 'type', remote: 'type', kind: 'plain' },
    { local: 'concept', remote: 'concept', kind: 'plain' },
    { local: 'notes', remote: 'notes', kind: 'plain' },
    { local: 'accountId', remote: 'account_id', kind: 'plain' },
    { local: 'categoryId', remote: 'category_id', kind: 'plain' },
    { local: 'subcategoryId', remote: 'subcategory_id', kind: 'plain' },
    { local: 'tagIds', remote: 'tag_ids', kind: 'plain' },
    { local: 'status', remote: 'status', kind: 'plain' },
    { local: 'categorizedBy', remote: 'categorized_by', kind: 'plain' },
    { local: 'ruleId', remote: 'rule_id', kind: 'plain' },
    { local: 'transferGroupId', remote: 'transfer_group_id', kind: 'plain' },
    { local: 'parentId', remote: 'parent_id', kind: 'plain' },
    { local: 'isSplitParent', remote: 'is_split_parent', kind: 'plain' },
    { local: 'refundOfId', remote: 'refund_of_id', kind: 'plain' },
    { local: 'excludedFromStats', remote: 'excluded_from_stats', kind: 'plain' },
    { local: 'statsFlag', remote: 'stats_flag', kind: 'plain' },
    { local: 'importBatchId', remote: 'import_batch_id', kind: 'plain' },
    { local: 'dedupeHash', remote: 'dedupe_hash', kind: 'plain' },
    { local: 'rawConcept', remote: 'raw_concept', kind: 'plain' },
    { local: 'normalizedConcept', remote: 'normalized_concept', kind: 'plain' },
    { local: 'normalizationVersion', remote: 'normalization_version', kind: 'plain' },
    { local: 'merchantId', remote: 'merchant_id', kind: 'plain' },
    { local: 'merchantMatchSource', remote: 'merchant_match_source', kind: 'plain' },
    { local: 'merchantMatchConfidence', remote: 'merchant_match_confidence', kind: 'plain' },
    // --- Ampliacion fase 5 (metadatos bancarios y duplicados avanzados) ---
    { local: 'bankTransactionId', remote: 'bank_transaction_id', kind: 'plain' },
    { local: 'bookingDate', remote: 'booking_date', kind: 'plain' },
    { local: 'valueDate', remote: 'value_date', kind: 'plain' },
    { local: 'pending', remote: 'pending', kind: 'plain' },
    { local: 'currency', remote: 'currency', kind: 'plain' },
    { local: 'balanceAfterCents', remote: 'balance_after_cents', kind: 'centsNull' },
    { local: 'bankReference', remote: 'bank_reference', kind: 'plain' },
    { local: 'operationType', remote: 'operation_type', kind: 'plain' },
    { local: 'sourceRowHash', remote: 'source_row_hash', kind: 'plain' },
    { local: 'exactFingerprint', remote: 'exact_fingerprint', kind: 'plain' },
    { local: 'normalizedFingerprint', remote: 'normalized_fingerprint', kind: 'plain' },
    { local: 'fingerprintVersion', remote: 'fingerprint_version', kind: 'plain' },
    { local: 'sourceFileHash', remote: 'source_file_hash', kind: 'plain' },
    { local: 'sourceFileSize', remote: 'source_file_size', kind: 'plain' },
    { local: 'duplicateStatus', remote: 'duplicate_status', kind: 'plain' },
    { local: 'duplicateConfidence', remote: 'duplicate_confidence', kind: 'plain' },
    { local: 'duplicateReasonCodes', remote: 'duplicate_reason_codes', kind: 'plain' },
    { local: 'duplicateCandidateIds', remote: 'duplicate_candidate_ids', kind: 'plain' },
    { local: 'pendingReplacementId', remote: 'pending_replacement_id', kind: 'plain' },
  ],
  rule: [
    { local: 'name', remote: 'name', kind: 'plain' },
    { local: 'enabled', remote: 'enabled', kind: 'plain' },
    { local: 'priority', remote: 'priority', kind: 'plain' },
    { local: 'matchMode', remote: 'match_mode', kind: 'plain' },
    { local: 'conditions', remote: 'conditions', kind: 'plain' },
    { local: 'action', remote: 'action', kind: 'plain' },
    { local: 'stopOnMatch', remote: 'stop_on_match', kind: 'plain' },
  ],
  budget: [
    { local: 'name', remote: 'name', kind: 'plain' },
    { local: 'scope', remote: 'scope', kind: 'plain' },
    { local: 'scopeId', remote: 'scope_id', kind: 'plain' },
    { local: 'direction', remote: 'direction', kind: 'plain' },
    { local: 'limitCents', remote: 'limit_cents', kind: 'cents' },
    { local: 'period', remote: 'period', kind: 'plain' },
    { local: 'customStart', remote: 'custom_start', kind: 'plain' },
    { local: 'customEnd', remote: 'custom_end', kind: 'plain' },
    { local: 'rollover', remote: 'rollover', kind: 'plain' },
    { local: 'archivedAt', remote: 'archived_at', kind: 'msNull' },
  ],
  importTemplate: [
    { local: 'name', remote: 'name', kind: 'plain' },
    { local: 'sourceFormat', remote: 'source_format', kind: 'plain' },
    { local: 'columnMap', remote: 'column_map', kind: 'plain' },
    { local: 'dateFormat', remote: 'date_format', kind: 'plain' },
    { local: 'decimalSeparator', remote: 'decimal_separator', kind: 'plain' },
    { local: 'thousandSeparator', remote: 'thousand_separator', kind: 'plain' },
    { local: 'amountStrategy', remote: 'amount_strategy', kind: 'plain' },
    { local: 'defaultAccountId', remote: 'default_account_id', kind: 'plain' },
    { local: 'hasHeaderRow', remote: 'has_header_row', kind: 'plain' },
  ],
  importBatch: [
    { local: 'templateId', remote: 'template_id', kind: 'plain' },
    { local: 'fileName', remote: 'file_name', kind: 'plain' },
    { local: 'importedAt', remote: 'imported_at', kind: 'ms' },
    { local: 'rowsTotal', remote: 'rows_total', kind: 'plain' },
    { local: 'rowsImported', remote: 'rows_imported', kind: 'plain' },
    { local: 'rowsSkippedDuplicate', remote: 'rows_skipped_duplicate', kind: 'plain' },
    { local: 'rowsLinked', remote: 'rows_linked', kind: 'plain' },
    { local: 'status', remote: 'status', kind: 'plain' },
    { local: 'sourceFileHash', remote: 'source_file_hash', kind: 'plain' },
    { local: 'sourceFileSize', remote: 'source_file_size', kind: 'plain' },
  ],
  merchant: [
    { local: 'canonicalName', remote: 'canonical_name', kind: 'plain' },
    { local: 'normalizedName', remote: 'normalized_name', kind: 'plain' },
    { local: 'defaultCategoryId', remote: 'default_category_id', kind: 'plain' },
    { local: 'defaultSubcategoryId', remote: 'default_subcategory_id', kind: 'plain' },
    { local: 'defaultTagIds', remote: 'default_tag_ids', kind: 'plain' },
    { local: 'notes', remote: 'notes', kind: 'plain' },
    { local: 'archivedAt', remote: 'archived_at', kind: 'msNull' },
  ],
  merchantAlias: [
    { local: 'merchantId', remote: 'merchant_id', kind: 'plain' },
    { local: 'rawAlias', remote: 'raw_alias', kind: 'plain' },
    { local: 'normalizedAlias', remote: 'normalized_alias', kind: 'plain' },
    { local: 'matchType', remote: 'match_type', kind: 'plain' },
    { local: 'priority', remote: 'priority', kind: 'plain' },
    { local: 'enabled', remote: 'enabled', kind: 'plain' },
  ],
  noDuplicateDecision: [
    { local: 'leftFingerprint', remote: 'left_fingerprint', kind: 'plain' },
    { local: 'rightFingerprint', remote: 'right_fingerprint', kind: 'plain' },
    { local: 'leftTxId', remote: 'left_tx_id', kind: 'plain' },
    { local: 'rightTxId', remote: 'right_tx_id', kind: 'plain' },
    { local: 'reason', remote: 'reason', kind: 'plain' },
  ],
  reviewItem: [
    { local: 'type', remote: 'type', kind: 'plain' },
    { local: 'entityType', remote: 'entity_type', kind: 'plain' },
    { local: 'entityId', remote: 'entity_id', kind: 'plain' },
    { local: 'confidence', remote: 'confidence', kind: 'plain' },
    { local: 'reasonCodes', remote: 'reason_codes', kind: 'plain' },
    { local: 'metadata', remote: 'metadata', kind: 'plain' },
    { local: 'status', remote: 'status', kind: 'plain' },
    { local: 'resolution', remote: 'resolution', kind: 'plain' },
    { local: 'resolvedAt', remote: 'resolved_at', kind: 'msNull' },
  ],
  reconciliation: [
    { local: 'accountId', remote: 'account_id', kind: 'plain' },
    { local: 'statementDate', remote: 'statement_date', kind: 'plain' },
    { local: 'statementBalanceCents', remote: 'statement_balance_cents', kind: 'cents' },
    { local: 'computedBalanceCents', remote: 'computed_balance_cents', kind: 'cents' },
    { local: 'differenceCents', remote: 'difference_cents', kind: 'cents' },
    { local: 'status', remote: 'status', kind: 'plain' },
    { local: 'notes', remote: 'notes', kind: 'plain' },
  ],
  recurringSeries: [
    { local: 'merchantId', remote: 'merchant_id', kind: 'plain' },
    { local: 'accountId', remote: 'account_id', kind: 'plain' },
    { local: 'name', remote: 'name', kind: 'plain' },
    { local: 'direction', remote: 'direction', kind: 'plain' },
    { local: 'frequency', remote: 'frequency', kind: 'plain' },
    { local: 'interval', remote: 'interval', kind: 'plain' },
    { local: 'expectedAmountCents', remote: 'expected_amount_cents', kind: 'cents' },
    { local: 'amountToleranceCents', remote: 'amount_tolerance_cents', kind: 'cents' },
    { local: 'amountTolerancePpm', remote: 'amount_tolerance_ppm', kind: 'plain' },
    { local: 'expectedDayOfWeek', remote: 'expected_day_of_week', kind: 'plain' },
    { local: 'expectedDayOfMonth', remote: 'expected_day_of_month', kind: 'plain' },
    { local: 'dateToleranceDays', remote: 'date_tolerance_days', kind: 'plain' },
    { local: 'nextExpectedDate', remote: 'next_expected_date', kind: 'plain' },
    { local: 'status', remote: 'status', kind: 'plain' },
    { local: 'confidence', remote: 'confidence', kind: 'plain' },
    { local: 'detectionVersion', remote: 'detection_version', kind: 'plain' },
  ],
  recurringOccurrence: [
    { local: 'seriesId', remote: 'series_id', kind: 'plain' },
    { local: 'transactionId', remote: 'transaction_id', kind: 'plain' },
    { local: 'expectedDate', remote: 'expected_date', kind: 'plain' },
    { local: 'expectedAmountCents', remote: 'expected_amount_cents', kind: 'cents' },
    { local: 'status', remote: 'status', kind: 'plain' },
  ],
};

function msToIso(ms: number): string {
  return new Date(ms).toISOString();
}

function isoToMs(iso: string): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    throw new Error(`Timestamp remoto invalido: ${iso}`);
  }
  return ms;
}

function fieldsFor(entityType: SyncEntityType): FieldSpec[] {
  const business = BUSINESS_FIELDS[entityType];
  if (!business) throw new Error(`Entidad sincronizable desconocida: ${entityType}`);
  return [...AUDIT_FIELDS, ...business];
}

// LOCAL -> fila remota (columnas de negocio + auditoria). El push anade owner_user_id, profile_id
// y last_mutation_id; el servidor controla revision. No incluye syncStatus/lastSyncedAt (locales).
export function toRow(
  entityType: SyncEntityType,
  local: Record<string, unknown>,
): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const spec of fieldsFor(entityType)) {
    const value = local[spec.local];
    switch (spec.kind) {
      case 'plain':
        row[spec.remote] = value ?? null;
        break;
      case 'cents':
        row[spec.remote] = serializeCents(value as number);
        break;
      case 'centsNull':
        row[spec.remote] = value == null ? null : serializeCentsNullable(value as number);
        break;
      case 'ms':
        row[spec.remote] = msToIso(value as number);
        break;
      case 'msNull':
        row[spec.remote] = value == null ? null : msToIso(value as number);
        break;
    }
  }
  return row;
}

// Fila remota -> entidad LOCAL, marcada como sincronizada. Copia la revision autoritativa del
// servidor. El llamante (pull/reconstruccion) puede ajustar syncStatus/lastSyncedAt si lo necesita.
export function fromRow(
  entityType: SyncEntityType,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const local: Record<string, unknown> = {};
  for (const spec of fieldsFor(entityType)) {
    const value = row[spec.remote];
    switch (spec.kind) {
      case 'plain':
        local[spec.local] = value ?? null;
        break;
      case 'cents':
        local[spec.local] = deserializeCents(value as number | string);
        break;
      case 'centsNull':
        local[spec.local] = deserializeCentsNullable(value as number | string | null);
        break;
      case 'ms':
        local[spec.local] = isoToMs(value as string);
        break;
      case 'msNull':
        local[spec.local] = value == null ? null : isoToMs(value as string);
        break;
    }
  }

  // profileId (hijas) u ownerUserId (raiz), y campos de sincronizacion locales.
  if (entityType === 'profile') {
    local.ownerUserId = (row.owner_user_id as string) ?? null;
  } else {
    local.profileId = row.profile_id as string;
  }
  // Los movimientos pueden no traer tag_ids si la columna llega vacia; normaliza a array.
  if (entityType === 'transaction' && !Array.isArray(local.tagIds)) {
    local.tagIds = [];
  }
  local.revision = typeof row.revision === 'number' ? row.revision : Number(row.revision ?? 0);
  local.syncStatus = 'synced';
  local.lastSyncedAt = Date.now();
  return local;
}
