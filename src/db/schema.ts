// Tipos de entidades del modelo de datos. Fuente unica de tipos (ver specs/DATA_MODEL.md).
// Convenciones: dinero en centimos enteros; id UUID string; timestamps epoch ms;
// enums como uniones de string literales; profileId obligatorio en toda entidad de datos.

// --- Enums (uniones de string literales) ---

export type AccountKind = 'bank' | 'card' | 'cash' | 'wallet' | 'shared' | 'other';
export type CategoryKind = 'expense' | 'income' | 'both';
export type TransactionType = 'expense' | 'income' | 'transfer';
export type TransactionStatus = 'cleared' | 'pending' | 'reconciled';
export type CategorizedBy = 'manual' | 'rule' | 'import' | 'none';
export type WeekStart = 'monday' | 'sunday';
export type StatsFlag = 0 | 1;

// Estado local de una fila respecto al remoto (DATA_MODEL seccion 9). En modo local sin
// cuenta siempre es 'local'.
export type SyncStatus = 'local' | 'pending' | 'synced' | 'conflict';

// Campos de sincronizacion (mixin, DATA_MODEL seccion 9). Los llevan TODAS las entidades
// sincronizables. Se anaden de forma ADITIVA en la version 2 del esquema Dexie con valores
// por defecto (syncStatus='local', revision=0, deletedAt=null, lastSyncedAt=null). Los
// gestiona el repositorio/motor de sincronizacion, nunca la UI. En fase 1 solo se persisten
// con sus defaults: la logica de sincronizacion llega en la fase 2.
// Nota sobre opcionalidad: los campos se declaran OPCIONALES para que la ampliacion sea
// puramente aditiva (fase 1). En tiempo de ejecucion SIEMPRE estan presentes: los rellena el
// repositorio al crear (syncDefaults) y la migracion Dexie v2 (upgrade) para las filas
// preexistentes. La opcionalidad refleja el estado transitorio del modelo, no que una fila
// persistida pueda carecer de ellos. La logica de sincronizacion (fase 2) ya los tratara como
// presentes. Ver DATA_MODEL seccion 9.
export interface SyncMeta {
  // Borrado logico. null = viva. Con sync, propaga la baja sin borrar fisicamente.
  deletedAt?: number | null;
  // Contador de version de la fila. Autoritativo en el servidor (trigger). En local, ultima
  // revision confirmada; 0 mientras la fila solo existe en local.
  revision?: number;
  syncStatus?: SyncStatus;
  // epoch ms de la ultima confirmacion remota, o null.
  lastSyncedAt?: number | null;
}

export type RuleMatchMode = 'all' | 'any';
export type RuleConditionField = 'concept' | 'amount' | 'date' | 'account' | 'type' | 'merchant';
export type RuleConditionOperator =
  // texto (concept)
  | 'contains'
  | 'notContains'
  | 'startsWith'
  | 'endsWith'
  | 'equals'
  | 'regex'
  // numerico (amount)
  | 'gt'
  | 'lt'
  | 'gte'
  | 'lte'
  | 'eq'
  | 'between'
  // fecha (date)
  | 'before'
  | 'after';

export type BudgetScope = 'category' | 'subcategory' | 'account' | 'overall';
export type BudgetDirection = 'expense' | 'income';
export type BudgetPeriod = 'monthly' | 'quarterly' | 'yearly' | 'custom';

export type SourceFormat = 'csv' | 'xlsx';
export type AmountStrategy = 'signed' | 'debitCredit';
export type DecimalSeparator = ',' | '.';
export type ThousandSeparator = ',' | '.' | '';
export type ImportBatchStatus = 'committed' | 'undone';

// Comercios normalizados (ampliacion, fase 4). Ver DATA_MODEL seccion 14.
export type MerchantMatchType = 'exact' | 'contains' | 'startsWith' | 'regex';
// Como se asocio un movimiento a un comercio (orden determinista, DATA_MODEL 14.3):
// manual > alias exacto/configurable > regla > sugerencia por similitud > sin comercio.
export type MerchantMatchSource = 'manual' | 'alias' | 'rule' | 'import' | 'suggested' | 'none';

// Deteccion avanzada de duplicados (ampliacion, fase 5). Ver DATA_MODEL seccion 15 y
// FINANCIAL_ALGORITHMS seccion 5. Niveles de menor a mayor confianza (salvo pendingReplaced,
// que es un caso especial): weak < possible < strongNormalized < exact; pendingReplaced marca
// un confirmado que sustituye a un pendiente ya vinculado.
export type DuplicateStatus =
  | 'unique'
  | 'exact'
  | 'strongNormalized'
  | 'possible'
  | 'weak'
  | 'pendingReplaced';

// --- Entidades ---

export interface Profile extends SyncMeta {
  id: string;
  // Id del usuario Supabase propietario (auth.users.id). null mientras el perfil solo existe
  // en local sin cuenta; al vincular una cuenta pasa a ser el id del usuario (DATA_MODEL 2.1,
  // 10.1). El aislamiento local sigue siendo por profileId; ownerUserId prepara la nube.
  ownerUserId: string | null;
  name: string;
  color: string;
  avatarEmoji: string | null;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
}

export interface Setting extends SyncMeta {
  id: string;
  profileId: string;
  currency: string;
  locale: string;
  weekStart: WeekStart;
  defaultAccountId: string | null;
  // Reservado fase 2 (Web Crypto). En el MVP siempre false.
  encryptionEnabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Account extends SyncMeta {
  id: string;
  profileId: string;
  name: string;
  kind: AccountKind;
  currency: string;
  color: string | null;
  openingBalanceCents: number;
  archivedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface Category extends SyncMeta {
  id: string;
  profileId: string;
  name: string;
  // null = categoria raiz; con valor = subcategoria (un unico nivel en el MVP).
  parentId: string | null;
  kind: CategoryKind;
  color: string | null;
  icon: string | null;
  archivedAt: number | null;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface Tag extends SyncMeta {
  id: string;
  profileId: string;
  name: string;
  color: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Transaction extends SyncMeta {
  id: string;
  profileId: string;
  // Fecha contable YYYY-MM-DD (sin hora ni zona horaria).
  date: string;
  // Entero en centimos. Gasto negativo, ingreso positivo.
  amountCents: number;
  type: TransactionType;
  concept: string;
  notes: string | null;
  accountId: string;
  categoryId: string | null;
  subcategoryId: string | null;
  tagIds: string[];
  status: TransactionStatus;
  categorizedBy: CategorizedBy;
  ruleId: string | null;
  transferGroupId: string | null;
  parentId: string | null;
  isSplitParent: boolean;
  refundOfId: string | null;
  excludedFromStats: boolean;
  // Espejo indexable de excludedFromStats (1 = excluido). Lo mantiene el repositorio.
  statsFlag: StatsFlag;
  importBatchId: string | null;
  dedupeHash: string;
  // --- Comercio normalizado (ampliacion, fase 4; DATA_MODEL seccion 14.3) ---
  // Concepto original del banco. INMUTABLE tras importar (invariante 12 de CLAUDE.md); para
  // altas manuales es igual a `concept`. `concept` sigue siendo el campo editable.
  rawConcept: string;
  // Concepto normalizado (normalizeConceptV1, src/lib/normalization.ts), misma funcion que
  // los alias de comercio.
  normalizedConcept: string;
  // Version del algoritmo de normalizacion con el que se calculo normalizedConcept.
  normalizationVersion: number;
  merchantId: string | null;
  merchantMatchSource: MerchantMatchSource;
  // Confianza orientativa por mil (0..1000). No es una probabilidad real.
  merchantMatchConfidence: number;
  // --- Metadatos bancarios y duplicados avanzados (ampliacion, fase 5; DATA_MODEL 15.1) ---
  // Identificador de operacion del banco, si el fichero lo trae. Fiable para dedupe cuando
  // existe (unicidad remota solo por cuenta, ver DATA_MODEL 21.2).
  bankTransactionId: string | null;
  // Fecha contable YYYY-MM-DD si distinta de `date` (el fichero puede traer ambas).
  bookingDate: string | null;
  // Fecha valor YYYY-MM-DD.
  valueDate: string | null;
  // Operacion pendiente (true) vs confirmada (false).
  pending: boolean;
  // Moneda de la operacion (por defecto la del perfil, DATA_MODEL 1).
  currency: string;
  // Saldo posterior en centimos, si el fichero lo trae.
  balanceAfterCents: number | null;
  // Referencia bancaria libre.
  bankReference: string | null;
  // Tipo de operacion del banco (texto libre del extracto).
  operationType: string | null;
  // Hash exacto de la fila de origen (src/lib/duplicateFingerprint.ts).
  sourceRowHash: string;
  // Huella exacta: accountId+date+amountCents+currency+normalizedConcept.
  exactFingerprint: string;
  // Huella tolerante: accountId+amountCents+currency+(merchantId|normalizedConcept), sin
  // fecha (la ventana temporal se aplica en la generacion de candidatos). NUNCA UNIQUE.
  normalizedFingerprint: string;
  // Version del algoritmo de huellas con el que se calcularon sourceRowHash/exactFingerprint/
  // normalizedFingerprint.
  fingerprintVersion: number;
  // Hash del fichero de origen (detecta reimportacion aunque cambie el nombre), o null si el
  // movimiento no viene de una importacion de fichero.
  sourceFileHash: string | null;
  // Tamano en bytes del fichero de origen, o null.
  sourceFileSize: number | null;
  // Nivel de duplicado resuelto por el motor (FINANCIAL_ALGORITHMS seccion 5).
  duplicateStatus: DuplicateStatus;
  // Confianza orientativa por mil (0..1000). Heuristica, NO es una probabilidad real.
  duplicateConfidence: number;
  // Motivos legibles del nivel asignado (p. ej. "mismo bankTransactionId").
  duplicateReasonCodes: string[];
  // Ids de los candidatos considerados por el motor al resolver el nivel.
  duplicateCandidateIds: string[];
  // Si este movimiento (confirmado) sustituye a un pendiente, apunta al pendiente sustituido
  // (que queda borrado logicamente). Conserva trazabilidad sin duplicar saldo.
  pendingReplacementId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface RuleCondition {
  field: RuleConditionField;
  operator: RuleConditionOperator;
  value: string | number;
  value2: string | number | null;
  caseSensitive: boolean;
}

export interface RuleAction {
  setCategoryId: string | null;
  setSubcategoryId: string | null;
  addTagIds: string[];
  setExcludedFromStats: boolean | null;
}

export interface Rule extends SyncMeta {
  id: string;
  profileId: string;
  name: string;
  enabled: boolean;
  // Menor numero = mayor prioridad.
  priority: number;
  matchMode: RuleMatchMode;
  conditions: RuleCondition[];
  action: RuleAction;
  stopOnMatch: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Budget extends SyncMeta {
  id: string;
  profileId: string;
  name: string;
  scope: BudgetScope;
  scopeId: string | null;
  direction: BudgetDirection;
  limitCents: number;
  period: BudgetPeriod;
  customStart: string | null;
  customEnd: string | null;
  rollover: boolean;
  archivedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

// Mapeo columna->campo del fichero importado. Valor = nombre o indice de columna. Los campos
// de la fase 5 (metadatos bancarios) son opcionales: un fichero puede no traerlos.
export interface ColumnMap {
  date: string | number;
  concept: string | number;
  amount: string | number | null;
  debit: string | number | null;
  credit: string | number | null;
  account: string | number | null;
  notes: string | number | null;
  // --- Ampliacion fase 5 (metadatos bancarios opcionales, DATA_MODEL 15) ---
  bankTransactionId: string | number | null;
  bookingDate: string | number | null;
  valueDate: string | number | null;
  // Columna que marca la operacion como pendiente (su presencia/valor lo decide el parseo).
  pending: string | number | null;
  merchant: string | number | null;
  currency: string | number | null;
  balanceAfter: string | number | null;
  bankReference: string | number | null;
  operationType: string | number | null;
}

export interface ImportTemplate extends SyncMeta {
  id: string;
  profileId: string;
  name: string;
  sourceFormat: SourceFormat;
  columnMap: ColumnMap;
  dateFormat: string;
  decimalSeparator: DecimalSeparator;
  thousandSeparator: ThousandSeparator;
  amountStrategy: AmountStrategy;
  defaultAccountId: string | null;
  hasHeaderRow: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ImportBatch extends SyncMeta {
  id: string;
  profileId: string;
  templateId: string | null;
  fileName: string;
  importedAt: number;
  rowsTotal: number;
  rowsImported: number;
  rowsSkippedDuplicate: number;
  // Filas resueltas con la decision "vincular" (fase 5): no crean un movimiento nuevo, solo
  // actualizan los metadatos bancarios de un movimiento existente que ya coincidia.
  rowsLinked: number;
  status: ImportBatchStatus;
  // Hash del fichero de origen (SHA-256) y su tamano, para detectar "archivo repetido" antes
  // de confirmar una nueva importacion (ampliacion, fase 5). null si no se pudo calcular.
  sourceFileHash: string | null;
  sourceFileSize: number | null;
  createdAt: number;
  updatedAt: number;
}

// Comercio normalizado (ampliacion, fase 4). Reconoce que conceptos bancarios distintos
// ("AMZN Mktp ES", "AMAZON EU", "Amazon.es*1234") son el mismo comercio. Ver DATA_MODEL 14.1.
export interface Merchant extends SyncMeta {
  id: string;
  profileId: string;
  canonicalName: string;
  normalizedName: string;
  defaultCategoryId: string | null;
  defaultSubcategoryId: string | null;
  defaultTagIds: string[];
  notes: string | null;
  archivedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

// Alias de comercio: patron que reconoce un texto bancario concreto como perteneciente a un
// Merchant. Ver DATA_MODEL 14.2.
export interface MerchantAlias extends SyncMeta {
  id: string;
  merchantId: string;
  profileId: string;
  rawAlias: string;
  normalizedAlias: string;
  matchType: MerchantMatchType;
  priority: number;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

// Recuerda que una pareja concreta de movimientos NO es duplicado, para no volver a
// preguntar salvo cambio relevante (ampliacion, fase 5; DATA_MODEL 15.2).
export interface NoDuplicateDecision extends SyncMeta {
  id: string;
  profileId: string;
  leftFingerprint: string;
  rightFingerprint: string;
  leftTxId: string | null;
  rightTxId: string | null;
  reason: string | null;
  createdAt: number;
  updatedAt: number;
}

// Bandeja de revision unificada (ampliacion, fase 6). Ver DATA_MODEL seccion 16 y ARCHITECTURE
// seccion 17. `recurringAnomaly` se lista ya en el enum (fuente unica de tipos) pero ningun
// generador la produce hasta la fase 7 (recurrencias).
export type ReviewItemType =
  | 'uncategorized'
  | 'lowConfidenceRule'
  | 'possibleDuplicate'
  | 'transferCandidate'
  | 'refundCandidate'
  | 'stalePending'
  | 'newMerchant'
  | 'importError'
  | 'syncConflict'
  | 'recurringAnomaly';

// Tabla de la entidad referida por un ReviewItem. Polimorfico: NUNCA se copia la entidad
// entera (DATA_MODEL 16), solo se guarda la referencia. 'recurringSeries' se anade en la fase 7
// para las anomalias recurrentes (subida de precio, ausencia, posible cancelacion, duplicado).
export type ReviewItemEntityType = 'transaction' | 'importBatch' | 'conflict' | 'recurringSeries';

export type ReviewItemStatus = 'open' | 'snoozed' | 'resolved' | 'dismissed';

// Tarea de revision unificada. NO copia la entidad completa: solo referencia (entityType +
// entityId) + metadata minima (referencias, nunca datos financieros completos). La generacion
// es idempotente: como mucho una tarea ABIERTA por (profileId, type, entityId) (ver
// src/services/reviewService.ts y el indice unico parcial remoto).
export interface ReviewItem extends SyncMeta {
  id: string;
  profileId: string;
  type: ReviewItemType;
  entityType: ReviewItemEntityType;
  entityId: string;
  // Confianza orientativa por mil (0..1000) cuando aplique. Heuristica, no probabilidad real.
  confidence: number;
  reasonCodes: string[];
  // Minima; referencias (p. ej. otro id de la pareja candidata), nunca copia de importes u
  // otros datos financieros completos.
  metadata: Record<string, unknown>;
  status: ReviewItemStatus;
  // Codigo corto de la accion aplicada al resolver (p. ej. 'categorized', 'linked:transfer').
  // El detalle de la resolucion vive en metadata, nunca se resuelve en silencio.
  resolution: string | null;
  createdAt: number;
  // Senal de cambio para sync (seccion 9 de DATA_MODEL: todas las entidades sincronizables
  // llevan updatedAt); se actualiza en cada transicion de estado, no solo al resolver.
  updatedAt: number;
  resolvedAt: number | null;
}

// Estado de una conciliacion bancaria (ampliacion, fase 6). Ver FINANCIAL_ALGORITHMS seccion 6.
export type ReconciliationStatus = 'balanced' | 'discrepancy' | 'acceptedWithDifference';

// Conciliacion de una cuenta en una fecha de extracto (DATA_MODEL seccion 17). Guarda el saldo
// del extracto, el saldo calculado por la app y la diferencia, para dejar constancia e
// historial por cuenta.
export interface Reconciliation extends SyncMeta {
  id: string;
  profileId: string;
  accountId: string;
  // YYYY-MM-DD del extracto.
  statementDate: string;
  statementBalanceCents: number;
  computedBalanceCents: number;
  // statementBalanceCents - computedBalanceCents. 0 = cuadra.
  differenceCents: number;
  status: ReconciliationStatus;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
}

// Recurrencias (ampliacion, fase 7). Ver DATA_MODEL seccion 18 y FINANCIAL_ALGORITHMS seccion 7.
export type RecurringFrequency = 'weekly' | 'monthly' | 'quarterly' | 'yearly';
export type RecurringDirection = 'expense' | 'income';
// candidate: sugerida por el motor, sin confirmar. active: confirmada, se sigue. paused: el
// usuario la pausa temporalmente (no genera ausencias ni entra en forecast). possiblyCancelled:
// varias ausencias consecutivas (nunca por un unico retraso). cancelled: confirmada como fin.
export type RecurringSeriesStatus =
  | 'candidate'
  | 'active'
  | 'paused'
  | 'possiblyCancelled'
  | 'cancelled';
export type RecurringOccurrenceStatus =
  | 'expected'
  | 'matched'
  | 'missing'
  | 'skipped'
  | 'manuallyCompleted';

// Serie recurrente detectada o confirmada (DATA_MODEL 18.1). Importe esperado = mediana de
// las ocurrencias; tolerancias absolutas y relativas (ppm); nunca se confirma sola (nace
// 'candidate'). `detectionVersion` versiona el algoritmo que la genero/actualizo por ultima vez.
export interface RecurringSeries extends SyncMeta {
  id: string;
  profileId: string;
  merchantId: string | null;
  // Cuenta de la serie. NO esta en la lista literal de DATA_MODEL 18.1, pero FINANCIAL_ALGORITHMS
  // 7.1 exige agrupar la deteccion "por comercio, direccion y CUENTA", y la seccion "Proximos
  // cobros" exige mostrar la cuenta de cada cobro esperado (incluso antes de que exista un
  // movimiento que la resuelva). Sin este campo ninguna de las dos reglas es satisfacible.
  // Adicion aditiva (nullable) sobre una entidad nueva de esta misma fase; no reinterpreta ni
  // elimina ningun campo existente (regla transversal del roadmap).
  accountId: string | null;
  name: string;
  direction: RecurringDirection;
  frequency: RecurringFrequency;
  // Cada N periodos de `frequency` (p. ej. cada 2 meses).
  interval: number;
  expectedAmountCents: number;
  amountToleranceCents: number;
  // Tolerancia relativa en micro-fraccion 1e-6 (misma escala que los tipos de interes).
  amountTolerancePpm: number;
  expectedDayOfWeek: number | null; // 0..6, solo si frequency='weekly'
  expectedDayOfMonth: number | null; // 1..31, si frequency='monthly'|'quarterly'|'yearly'
  dateToleranceDays: number;
  nextExpectedDate: string | null; // YYYY-MM-DD
  status: RecurringSeriesStatus;
  // Confianza orientativa por mil (0..1000). Heuristica, no probabilidad real.
  confidence: number;
  detectionVersion: number;
  createdAt: number;
  updatedAt: number;
}

// Ocurrencia esperada de una serie (DATA_MODEL 18.2). Registra el resultado de contrastar la
// expectativa contra los movimientos reales: matched (se encontro), missing (no aparecio tras
// la ventana de tolerancia), skipped (el usuario la omite explicitamente), manuallyCompleted
// (el usuario la marca resuelta sin un movimiento vinculado, p. ej. pago en efectivo no
// importado).
export interface RecurringOccurrence extends SyncMeta {
  id: string;
  profileId: string;
  seriesId: string;
  transactionId: string | null;
  expectedDate: string; // YYYY-MM-DD
  expectedAmountCents: number;
  status: RecurringOccurrenceStatus;
  createdAt: number;
  updatedAt: number;
}

// --- Ampliacion fase 2: estructuras de sincronizacion (DATA_MODEL secciones 11-13) ---
//
// Las entidades de esta seccion son DEVICE-LOCAL: viven solo en Dexie, NUNCA se sincronizan a
// Supabase y NUNCA se incluyen en los backups. Registran el estado de la sincronizacion en el
// dispositivo (cola de salida, conflictos, migracion inicial y cursores de descarga).

// Tipo de entidad sincronizable. Une el nombre logico local con su tabla remota (ver src/sync).
export type SyncEntityType =
  | 'profile'
  | 'setting'
  | 'account'
  | 'category'
  | 'tag'
  | 'transaction'
  | 'rule'
  | 'budget'
  | 'importTemplate'
  | 'importBatch'
  | 'merchant'
  | 'merchantAlias'
  | 'noDuplicateDecision'
  | 'reviewItem'
  | 'reconciliation'
  | 'recurringSeries'
  | 'recurringOccurrence';

export type MutationOperation = 'insert' | 'update' | 'delete';

// Estado de una mutacion en la cola de salida.
export type MutationStatus = 'queued' | 'inflight' | 'failed' | 'done' | 'conflict';

// Cola de salida (outbox). Persiste cada mutacion pendiente de enviar (DATA_MODEL seccion 11).
// Garantiza escritura local primero, funcionamiento offline e idempotencia: el `mutationId` es la
// clave de idempotencia y el `entityId` (mismo UUID local y remoto) permite upsert por PK.
export interface OutboxMutation {
  // UUID unico. Clave de idempotencia de la mutacion.
  mutationId: string;
  // Propietario (auth.users.id). La cola nunca mezcla usuarios.
  userId: string;
  profileId: string;
  entityType: SyncEntityType;
  // Id de la fila afectada (UUID reutilizado local y remoto).
  entityId: string;
  operation: MutationOperation;
  // Snapshot local (camelCase) de la entidad tras la escritura. El motor de push lo mapea a la
  // fila remota. Para `delete` incluye `deletedAt`. Nunca contiene PIN, tokens ni secretos.
  payload: Record<string, unknown>;
  // Revision remota conocida al crear la mutacion. Base para detectar conflicto.
  baseRevision: number;
  createdAt: number;
  attempts: number;
  lastAttemptAt: number | null;
  // Mensaje de error corto (sin datos financieros completos).
  lastError: string | null;
  status: MutationStatus;
}

export type ConflictStatus = 'open' | 'resolved';
export type ConflictResolution = 'keepLocal' | 'keepRemote' | 'merged';

// Conflicto de sincronizacion (DATA_MODEL seccion 12). Se materializa cuando el `baseRevision` de
// una mutacion ya no es la revision remota vigente. Ningun conflicto financiero se resuelve en
// silencio: lo decide la persona (invariante 11).
export interface Conflict {
  id: string;
  userId: string;
  profileId: string;
  entityType: SyncEntityType;
  entityId: string;
  // Version local (la que intentaba subir) y version remota vigente (camelCase, tal como las ve
  // la app). Se conservan ambas para mostrar diferencias.
  localPayload: Record<string, unknown>;
  remotePayload: Record<string, unknown>;
  baseRevision: number;
  remoteRevision: number;
  status: ConflictStatus;
  resolution: ConflictResolution | null;
  createdAt: number;
  resolvedAt: number | null;
}

export type MigrationStatus = 'pending' | 'inProgress' | 'verified' | 'failed';

// Estado de la migracion inicial de un perfil local a la cuenta (DATA_MODEL seccion 13.2).
// Idempotente y reanudable: solo `verified` marca el perfil como migrado.
export interface ProfileMigration {
  id: string;
  profileId: string;
  userId: string;
  status: MigrationStatus;
  // Recuentos esperados por entidad (para validar tras subir) y confirmados en remoto.
  counts: Record<string, number>;
  uploadedCounts: Record<string, number>;
  startedAt: number | null;
  finishedAt: number | null;
  lastError: string | null;
}

// Cursor de descarga (PULL) por (profileId, entityType): ultimo `updated_at` remoto ya traido.
// Evita descargar todo en cada sincronizacion (DATA_MODEL seccion 9, CLOUD_SYNC_SECURITY 6).
export interface SyncState {
  profileId: string;
  entityType: SyncEntityType;
  // ISO timestamptz remoto del ultimo cambio descargado, o null si nunca se descargo.
  lastPulledUpdatedAt: string | null;
  // epoch ms local de la ultima descarga.
  lastPulledAt: number | null;
}

// --- Ampliacion fase 3: seguridad de acceso local (PIN, sesion cifrada, passkeys) ---
//
// Las tres entidades de esta seccion son DEVICE-LOCAL (DATA_MODEL seccion 10.2): viven SOLO en
// Dexie, NUNCA se sincronizan a Supabase y NUNCA se incluyen en los backups (ni siquiera el
// verificador del PIN). No llevan SyncMeta a proposito: no son sincronizables.

// Parametros versionados del KDF usado para derivar el verificador del PIN y la clave de
// cifrado de sesion (CLOUD_SYNC_SECURITY seccion 9-10). Cambiar cualquier valor exige una nueva
// version para poder reconocer con que parametros se derivo un verificador ya guardado.
export interface PinKdfParams {
  version: 1;
  algorithm: 'PBKDF2';
  hash: 'SHA-256';
  iterations: number;
  saltBytes: number;
  keyBits: number;
}

// Fila unica (id constante) con la configuracion de seguridad LOCAL del dispositivo. Nunca
// contiene el PIN en claro: solo un verificador derivado (HMAC de la clave base del KDF, no
// invertible a la clave de cifrado) y la sal. La clave de cifrado de sesion NUNCA se persiste
// aqui: vive solo en memoria mientras la app esta desbloqueada (ver src/security).
export interface DeviceSecurity {
  id: string;
  pinEnabled: boolean;
  pinSalt: string | null;
  pinVerifier: string | null;
  pinKdfParams: PinKdfParams | null;
  // Contador de intentos fallidos consecutivos y espera progresiva (CLOUD_SYNC_SECURITY 9).
  pinAttempts: number;
  pinLockedUntil: number | null;
  // Bloqueo automatico en ms (0 = inmediato). null = PIN desactivado, no aplica.
  autoLockMs: number | null;
  passkeysEnabled: boolean;
  createdAt: number;
  updatedAt: number;
}

// Sesion de Supabase cifrada con AES-GCM (clave derivada del PIN, solo en memoria al
// desbloquear). `key` es la clave de storage que pide el SDK de Supabase Auth (permite migrar
// entre localStorage en claro y esta tabla sin adivinar el formato interno del SDK). Nunca hay
// una copia sin cifrar de estos datos en otro storage mientras el PIN esta activo.
export interface EncryptedSessionRow {
  key: string;
  ivBase64: string;
  ciphertextBase64: string;
  updatedAt: number;
}

// Referencia LOCAL a una passkey registrada en Supabase Auth (WebAuthn). La credencial en si
// vive en el autenticador del sistema operativo y en Supabase Auth; aqui solo se guarda una
// referencia para poder listarla/renombrarla sin depender de red.
export interface WebAuthnCredentialRef {
  id: string;
  credentialId: string;
  friendlyName: string | null;
  createdAt: number;
  lastUsedAt: number | null;
}
