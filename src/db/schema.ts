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

// Mapeo columna->campo del fichero importado. Valor = nombre o indice de columna.
export interface ColumnMap {
  date: string | number;
  concept: string | number;
  amount: string | number | null;
  debit: string | number | null;
  credit: string | number | null;
  account: string | number | null;
  notes: string | number | null;
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
  status: ImportBatchStatus;
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
  | 'merchantAlias';

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
