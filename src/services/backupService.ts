// Servicio de backup: exporta e importa TODOS los datos de un perfil en un unico fichero
// JSON versionado, y restaura ese fichero en el perfil activo (sobrescribiendo) o en un
// perfil nuevo. Ver specs (ARCHITECTURE seccion 2, DATA_MODEL seccion 7) y alcance de fase.
//
// Garantias:
//  - Coste 0 y local-first (invariantes 1 a 3 de CLAUDE.md): el backup se genera y se lee
//    en el propio dispositivo; ningun dato sale de el.
//  - Aislamiento por perfil (invariante 4): un backup contiene SOLO los datos del perfil que
//    se exporta; la restauracion escribe SOLO en el perfil destino.
//  - Portabilidad entre dispositivos (PC <-> movil): al restaurar se regeneran todos los
//    identificadores y se remapean las referencias internas, de modo que nunca colisionan
//    con datos de otros perfiles presentes en el dispositivo destino, y la restauracion es
//    idempotente frente a restaurar el mismo backup varias veces.
//  - Atomicidad: la escritura la hace backupRepo en una unica transaccion Dexie.
import type { Profile } from '../db/schema';
import { SCHEMA_VERSION } from '../db/index';
import { newId, syncDefaults } from '../db/index';
import { backupRepo, type ProfileDataTables } from '../db/backupRepo';
import { profilesRepo } from '../db/profilesRepo';
import { normalizeProfileName } from './profileService';
import { requireProfileId } from '../lib/validation';
import { computeFingerprints } from '../lib/duplicateFingerprint';

// Marcadores del envelope. Sirven para reconocer el fichero y rechazar cualquier otro.
export const BACKUP_APP = 'gestor-gastos';
export const BACKUP_KIND = 'profile-backup';
// Version del FORMATO del envelope de backup (independiente de la version del esquema de
// datos). v2 (fase 2): el backup excluye tombstones (bajas logicas) y device-local (outbox,
// conflictos, migracion, cursores), y la restauracion resetea los campos de sincronizacion a
// local (revision 0, syncStatus 'local'). La estructura del envelope no cambia respecto a v1, por
// lo que los backups v1 siguen siendo restaurables.
export const BACKUP_FORMAT_VERSION = 2;
// Version minima de formato que esta app sabe leer (los envelopes v1 y v2 son compatibles).
const MIN_BACKUP_FORMAT_VERSION = 1;

export interface ProfileBackup {
  app: typeof BACKUP_APP;
  kind: typeof BACKUP_KIND;
  backupFormatVersion: number;
  // Version del esquema de datos con el que se genero (DATA_MODEL seccion 7). Determina si
  // el backup es restaurable en esta version de la app.
  schemaVersion: number;
  exportedAt: number; // epoch ms
  profile: Profile;
  data: ProfileDataTables;
}

// Error tipado de backup (fichero no valido, corrupto o de version incompatible). Sin
// errores silenciosos (invariante CLAUDE.md): la UI muestra el mensaje al usuario.
export class BackupError extends Error {
  readonly code = 'BACKUP_ERROR';
  constructor(message: string) {
    super(message);
    this.name = 'BackupError';
  }
}

// Resumen legible de un backup ya validado, para mostrar en la confirmacion de restauracion.
export interface BackupSummary {
  profileName: string;
  exportedAt: number;
  schemaVersion: number;
  counts: {
    transactions: number;
    accounts: number;
    categories: number;
    tags: number;
    merchants: number;
    merchantAliases: number;
    rules: number;
    budgets: number;
    importTemplates: number;
    importBatches: number;
    reviewItems: number;
    reconciliations: number;
    recurringSeries: number;
    recurringOccurrences: number;
    debts: number;
    debtPayments: number;
    debtScenarios: number;
  };
}

const TABLE_KEYS: readonly (keyof ProfileDataTables)[] = [
  'settings',
  'accounts',
  'categories',
  'tags',
  'merchants',
  'merchantAliases',
  'transactions',
  'rules',
  'budgets',
  'importTemplates',
  'importBatches',
  'noDuplicateDecisions',
  'reviewItems',
  'reconciliations',
  'recurringSeries',
  'recurringOccurrences',
  'debts',
  'debtPayments',
  'debtScenarios',
];

// --- Creacion del backup ---

// Lee todos los datos del perfil y construye el envelope versionado. No toca el DOM: el
// disparo de la descarga es responsabilidad de la UI (lib/download).
export async function createBackup(profileId: string): Promise<ProfileBackup> {
  requireProfileId(profileId);
  const snapshot = await backupRepo.readProfileData(profileId);
  return {
    app: BACKUP_APP,
    kind: BACKUP_KIND,
    backupFormatVersion: BACKUP_FORMAT_VERSION,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: Date.now(),
    profile: snapshot.profile,
    data: snapshot.data,
  };
}

// Serializa el backup a texto JSON indentado (legible y diffeable).
export function serializeBackup(backup: ProfileBackup): string {
  return JSON.stringify(backup, null, 2);
}

// --- Validacion / parseo del fichero de backup ---

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Valida la fila Profile de forma minima (los campos que la app necesita para operar).
function isValidProfile(value: unknown): value is Profile {
  if (!isObject(value)) return false;
  return typeof value.id === 'string' && value.id.length > 0 && typeof value.name === 'string';
}

// Comprueba que un valor es una tabla (array) cuyos elementos son objetos con profileId.
function assertTable(name: string, value: unknown): asserts value is { profileId: string }[] {
  if (!Array.isArray(value)) {
    throw new BackupError(`El backup esta corrupto: la tabla "${name}" no es una lista.`);
  }
  for (const row of value) {
    if (!isObject(row) || typeof row.profileId !== 'string') {
      throw new BackupError(`El backup esta corrupto: un registro de "${name}" no es valido.`);
    }
  }
}

// Parsea y valida el texto de un fichero de backup. Lanza BackupError con un mensaje claro
// para: JSON invalido, fichero que no es un backup de la app, formato incompatible, version
// de esquema incompatible o estructura corrupta. Devuelve el envelope tipado.
export function parseBackup(text: string): ProfileBackup {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BackupError('El archivo no es un JSON valido. Parece estar corrupto o no ser un backup.');
  }
  if (!isObject(raw)) {
    throw new BackupError('El archivo no tiene el formato de un backup de Gestor de Gastos.');
  }
  if (raw.app !== BACKUP_APP || raw.kind !== BACKUP_KIND) {
    throw new BackupError('El archivo no es un backup de perfil de Gestor de Gastos.');
  }
  if (
    typeof raw.backupFormatVersion !== 'number' ||
    raw.backupFormatVersion < MIN_BACKUP_FORMAT_VERSION ||
    raw.backupFormatVersion > BACKUP_FORMAT_VERSION
  ) {
    throw new BackupError(
      `Formato de backup incompatible (${String(raw.backupFormatVersion)}). Esta version de la app admite del formato ${MIN_BACKUP_FORMAT_VERSION} al ${BACKUP_FORMAT_VERSION}.`,
    );
  }
  const schemaVersion = raw.schemaVersion;
  if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion) || schemaVersion < 1) {
    throw new BackupError('El backup no indica una version de esquema valida.');
  }
  // Un backup creado con un esquema MAS NUEVO que el de esta app no se restaura: no se degrada
  // el dato (DATA_MODEL seccion 7). El usuario debe actualizar la app.
  if (schemaVersion > SCHEMA_VERSION) {
    throw new BackupError(
      `El backup se creo con una version mas reciente de la app (esquema ${schemaVersion}). Actualiza la app para restaurarlo.`,
    );
  }
  if (!isValidProfile(raw.profile)) {
    throw new BackupError('El backup no contiene un perfil valido.');
  }
  const profile = raw.profile;
  if (!isObject(raw.data)) {
    throw new BackupError('El backup esta corrupto: falta el bloque de datos.');
  }
  // Cada tabla conocida: si esta presente debe ser una lista valida; si falta, se asume vacia.
  const data: ProfileDataTables = {
    settings: [],
    accounts: [],
    categories: [],
    tags: [],
    merchants: [],
    merchantAliases: [],
    transactions: [],
    rules: [],
    budgets: [],
    importTemplates: [],
    importBatches: [],
    noDuplicateDecisions: [],
    reviewItems: [],
    reconciliations: [],
    recurringSeries: [],
    recurringOccurrences: [],
    debts: [],
    debtPayments: [],
    debtScenarios: [],
  };
  const rawData = raw.data as Record<string, unknown>;
  const mutableData = data as unknown as Record<string, unknown[]>;
  for (const key of TABLE_KEYS) {
    const value = rawData[key];
    if (value === undefined) continue; // se queda como lista vacia
    assertTable(key, value);
    // Defensa en profundidad: todas las filas deben pertenecer al perfil del backup. Un
    // fichero manipulado que mezcle profileIds distintos se rechaza (aunque la restauracion
    // reescribe el profileId destino, un backup coherente nunca mezcla perfiles).
    for (const row of value) {
      if (row.profileId !== profile.id) {
        throw new BackupError(
          `El backup esta corrupto: un registro de "${key}" pertenece a otro perfil.`,
        );
      }
    }
    mutableData[key] = value;
  }
  return {
    app: BACKUP_APP,
    kind: BACKUP_KIND,
    backupFormatVersion: BACKUP_FORMAT_VERSION,
    schemaVersion,
    exportedAt: typeof raw.exportedAt === 'number' ? raw.exportedAt : Date.now(),
    profile,
    data,
  };
}

// Resumen legible para la UI de confirmacion.
export function summarizeBackup(backup: ProfileBackup): BackupSummary {
  const d = backup.data;
  return {
    profileName: backup.profile.name,
    exportedAt: backup.exportedAt,
    schemaVersion: backup.schemaVersion,
    counts: {
      transactions: d.transactions.length,
      accounts: d.accounts.length,
      categories: d.categories.length,
      tags: d.tags.length,
      merchants: d.merchants.length,
      merchantAliases: d.merchantAliases.length,
      rules: d.rules.length,
      budgets: d.budgets.length,
      importTemplates: d.importTemplates.length,
      importBatches: d.importBatches.length,
      reviewItems: d.reviewItems.length,
      reconciliations: d.reconciliations.length,
      recurringSeries: d.recurringSeries.length,
      recurringOccurrences: d.recurringOccurrences.length,
      debts: d.debts.length,
      debtPayments: d.debtPayments.length,
      debtScenarios: d.debtScenarios.length,
    },
  };
}

// --- Remapeo de identificadores para la restauracion ---

// Construye un mapa oldId -> newId para una lista de entidades con id.
function buildIdMap(rows: { id: string }[], makeId: () => string): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) map.set(row.id, makeId());
  return map;
}

// Resuelve una referencia a traves de un mapa de ids. null se conserva; un id no presente en
// el mapa (referencia externa o colgante en el propio origen) se conserva tal cual: la
// restauracion no inventa relaciones nuevas ni las pierde respecto al origen.
function remapRef(map: Map<string, string>, id: string | null): string | null {
  if (id === null) return null;
  return map.get(id) ?? id;
}

// Remapea TODOS los datos de un perfil a un nuevo profileId, regenerando cada id y
// reescribiendo todas las referencias internas (cuentas, categorias, etiquetas, reglas,
// lotes, plantillas, grupos de transferencia, splits y reembolsos). Funcion PURA: `makeId`
// es inyectable para tests deterministas. El resultado esta listo para insertar por
// backupRepo sin riesgo de colision de claves primarias.
export function remapProfileData(
  data: ProfileDataTables,
  targetProfileId: string,
  makeId: () => string = newId,
): ProfileDataTables {
  // Mapas de id por entidad.
  const accountMap = buildIdMap(data.accounts, makeId);
  const categoryMap = buildIdMap(data.categories, makeId);
  const tagMap = buildIdMap(data.tags, makeId);
  const merchantMap = buildIdMap(data.merchants, makeId);
  const merchantAliasMap = buildIdMap(data.merchantAliases, makeId);
  const ruleMap = buildIdMap(data.rules, makeId);
  const templateMap = buildIdMap(data.importTemplates, makeId);
  const batchMap = buildIdMap(data.importBatches, makeId);
  const txMap = buildIdMap(data.transactions, makeId);
  const settingMap = buildIdMap(data.settings, makeId);
  const budgetMap = buildIdMap(data.budgets, makeId);
  const noDuplicateDecisionMap = buildIdMap(data.noDuplicateDecisions, makeId);
  const reviewItemMap = buildIdMap(data.reviewItems, makeId);
  const reconciliationMap = buildIdMap(data.reconciliations, makeId);
  const recurringSeriesMap = buildIdMap(data.recurringSeries, makeId);
  const recurringOccurrenceMap = buildIdMap(data.recurringOccurrences, makeId);
  const debtMap = buildIdMap(data.debts, makeId);
  const debtPaymentMap = buildIdMap(data.debtPayments, makeId);
  const debtScenarioMap = buildIdMap(data.debtScenarios, makeId);

  // Los grupos de transferencia no son entidades: son un id compartido por las dos patas.
  // Se remapea de forma consistente (mismo valor origen -> mismo valor destino).
  const transferGroupMap = new Map<string, string>();
  for (const t of data.transactions) {
    if (t.transferGroupId !== null && !transferGroupMap.has(t.transferGroupId)) {
      transferGroupMap.set(t.transferGroupId, makeId());
    }
  }

  const settings = data.settings.map((s) => ({
    ...s,
    id: settingMap.get(s.id)!,
    profileId: targetProfileId,
    defaultAccountId: remapRef(accountMap, s.defaultAccountId),
  }));

  const accounts = data.accounts.map((a) => ({
    ...a,
    id: accountMap.get(a.id)!,
    profileId: targetProfileId,
  }));

  const categories = data.categories.map((c) => ({
    ...c,
    id: categoryMap.get(c.id)!,
    profileId: targetProfileId,
    parentId: remapRef(categoryMap, c.parentId),
  }));

  const tags = data.tags.map((t) => ({
    ...t,
    id: tagMap.get(t.id)!,
    profileId: targetProfileId,
  }));

  const merchants = data.merchants.map((m) => ({
    ...m,
    id: merchantMap.get(m.id)!,
    profileId: targetProfileId,
    defaultCategoryId: remapRef(categoryMap, m.defaultCategoryId),
    defaultSubcategoryId: remapRef(categoryMap, m.defaultSubcategoryId),
    defaultTagIds: m.defaultTagIds.map((id) => tagMap.get(id) ?? id),
  }));

  const merchantAliases = data.merchantAliases.map((a) => ({
    ...a,
    id: merchantAliasMap.get(a.id)!,
    profileId: targetProfileId,
    merchantId: merchantMap.get(a.merchantId) ?? a.merchantId,
  }));

  // Traduccion huella tolerante ANTIGUA -> NUEVA (recalculada tras remapear accountId/
  // merchantId, ver mas abajo), para poder traducir tambien las NoDuplicateDecision ya
  // guardadas (leftFingerprint/rightFingerprint). Si dos transacciones distintas compartian
  // la misma huella antigua, comparten la misma huella nueva (la formula solo depende de
  // ids remapeados de forma consistente), asi que el mapeo nunca pierde informacion.
  const normalizedFingerprintMap = new Map<string, string>();

  const transactions = data.transactions.map((t) => {
    const accountId = remapRef(accountMap, t.accountId) ?? t.accountId;
    const merchantId = remapRef(merchantMap, t.merchantId);
    // exactFingerprint/normalizedFingerprint incluyen literalmente accountId y merchantId
    // como entrada (lib/duplicateFingerprint.ts). Tras remapearlos a ids nuevos hay que
    // RECALCULAR las huellas explicitamente: si se conservaran las antiguas, el nivel
    // "exact" del motor de duplicados dejaria de detectar una reimportacion real de este
    // movimiento tras restaurar el backup (falso negativo que puede duplicar saldo,
    // hallazgo de auditoria financiera).
    const { exactFingerprint, normalizedFingerprint } = computeFingerprints({
      accountId,
      date: t.date,
      amountCents: t.amountCents,
      currency: t.currency,
      normalizedConcept: t.normalizedConcept,
      merchantId,
    });
    normalizedFingerprintMap.set(t.normalizedFingerprint, normalizedFingerprint);
    return {
      ...t,
      id: txMap.get(t.id)!,
      profileId: targetProfileId,
      accountId,
      categoryId: remapRef(categoryMap, t.categoryId),
      subcategoryId: remapRef(categoryMap, t.subcategoryId),
      tagIds: t.tagIds.map((id) => tagMap.get(id) ?? id),
      ruleId: remapRef(ruleMap, t.ruleId),
      transferGroupId:
        t.transferGroupId === null ? null : transferGroupMap.get(t.transferGroupId) ?? t.transferGroupId,
      parentId: remapRef(txMap, t.parentId),
      refundOfId: remapRef(txMap, t.refundOfId),
      importBatchId: remapRef(batchMap, t.importBatchId),
      merchantId,
      // El pendiente que este movimiento sustituyo (si lo hizo) nunca se exporta en el backup
      // (backupRepo filtra los tombstones, y un pendiente sustituido siempre queda
      // logicamente borrado): remapear su id antiguo apuntaria a un id inexistente en el
      // perfil restaurado, violando la FK compuesta en el primer push. Se anula explicitamente
      // (no hay pendiente que restaurar; la trazabilidad de esa sustitucion concreta no
      // sobrevive a un backup, igual que el propio pendiente no sobrevive).
      pendingReplacementId: null,
      exactFingerprint,
      normalizedFingerprint,
    };
  });

  const rules = data.rules.map((r) => ({
    ...r,
    id: ruleMap.get(r.id)!,
    profileId: targetProfileId,
    // Condiciones sobre cuenta/comercio: su value es un id y debe remapearse.
    conditions: r.conditions.map((cond) => {
      if (cond.field === 'account' && typeof cond.value === 'string') {
        return { ...cond, value: accountMap.get(cond.value) ?? cond.value };
      }
      if (cond.field === 'merchant' && typeof cond.value === 'string') {
        return { ...cond, value: merchantMap.get(cond.value) ?? cond.value };
      }
      return { ...cond };
    }),
    action: {
      ...r.action,
      setCategoryId: remapRef(categoryMap, r.action.setCategoryId),
      setSubcategoryId: remapRef(categoryMap, r.action.setSubcategoryId),
      addTagIds: r.action.addTagIds.map((id) => tagMap.get(id) ?? id),
    },
  }));

  const budgets = data.budgets.map((b) => ({
    ...b,
    id: budgetMap.get(b.id)!,
    profileId: targetProfileId,
    scopeId: remapBudgetScopeId(b.scope, b.scopeId, categoryMap, accountMap),
  }));

  const importTemplates = data.importTemplates.map((tpl) => ({
    ...tpl,
    id: templateMap.get(tpl.id)!,
    profileId: targetProfileId,
    defaultAccountId: remapRef(accountMap, tpl.defaultAccountId),
  }));

  const importBatches = data.importBatches.map((batch) => ({
    ...batch,
    id: batchMap.get(batch.id)!,
    profileId: targetProfileId,
    templateId: remapRef(templateMap, batch.templateId),
  }));

  // Las huellas (leftFingerprint/rightFingerprint) son hashes de contenido, no ids, pero
  // incluyen accountId/merchantId como entrada: se traducen con normalizedFingerprintMap
  // (calculado arriba junto con las transacciones remapeadas) para que sigan coincidiendo
  // con las huellas recalculadas de los movimientos restaurados. Si una huella no aparece en
  // el mapa (el movimiento que la origino no esta en este backup, p. ej. ya se habia borrado),
  // se conserva tal cual: no hay mejor opcion sin ese movimiento. Solo se remapean ademas las
  // referencias directas a movimientos (leftTxId/rightTxId).
  const noDuplicateDecisions = data.noDuplicateDecisions.map((d) => ({
    ...d,
    id: noDuplicateDecisionMap.get(d.id)!,
    profileId: targetProfileId,
    leftFingerprint: normalizedFingerprintMap.get(d.leftFingerprint) ?? d.leftFingerprint,
    rightFingerprint: normalizedFingerprintMap.get(d.rightFingerprint) ?? d.rightFingerprint,
    leftTxId: remapRef(txMap, d.leftTxId),
    rightTxId: remapRef(txMap, d.rightTxId),
  }));

  // ReviewItem.entityId es POLIMORFICO segun entityType (DATA_MODEL seccion 16): se remapea
  // contra el mapa de la tabla correspondiente, incluida 'recurringSeries' (fase 7: anomalias
  // recurrentes). 'conflict' no se remapea (los conflictos de sincronizacion son device-local y
  // nunca forman parte del backup, igual que la outbox); la tarea queda con una referencia que
  // ya no resuelve tras restaurar, tal y como ocurriria si el conflicto se hubiera resuelto en
  // otro dispositivo. La UI trata una referencia ausente como "ya no aplica" (ver reviewService),
  // nunca como un error silencioso de datos.
  const reviewItems = data.reviewItems.map((item) => {
    const entityId =
      item.entityType === 'transaction'
        ? txMap.get(item.entityId) ?? item.entityId
        : item.entityType === 'importBatch'
          ? batchMap.get(item.entityId) ?? item.entityId
          : item.entityType === 'recurringSeries'
            ? recurringSeriesMap.get(item.entityId) ?? item.entityId
            : item.entityId;
    return {
      ...item,
      id: reviewItemMap.get(item.id)!,
      profileId: targetProfileId,
      entityId,
    };
  });

  const reconciliations = data.reconciliations.map((r) => ({
    ...r,
    id: reconciliationMap.get(r.id)!,
    profileId: targetProfileId,
    accountId: accountMap.get(r.accountId) ?? r.accountId,
  }));

  const recurringSeries = data.recurringSeries.map((s) => ({
    ...s,
    id: recurringSeriesMap.get(s.id)!,
    profileId: targetProfileId,
    merchantId: remapRef(merchantMap, s.merchantId),
    accountId: remapRef(accountMap, s.accountId),
  }));

  const recurringOccurrences = data.recurringOccurrences.map((o) => ({
    ...o,
    id: recurringOccurrenceMap.get(o.id)!,
    profileId: targetProfileId,
    seriesId: recurringSeriesMap.get(o.seriesId) ?? o.seriesId,
    transactionId: remapRef(txMap, o.transactionId),
  }));

  const debts = data.debts.map((d) => ({
    ...d,
    id: debtMap.get(d.id)!,
    profileId: targetProfileId,
    linkedAccountId: remapRef(accountMap, d.linkedAccountId),
    linkedCategoryId: remapRef(categoryMap, d.linkedCategoryId),
  }));

  const debtPayments = data.debtPayments.map((p) => ({
    ...p,
    id: debtPaymentMap.get(p.id)!,
    profileId: targetProfileId,
    debtId: debtMap.get(p.debtId) ?? p.debtId,
    transactionId: remapRef(txMap, p.transactionId),
  }));

  // oneTimeExtraPayments es un array EMBEBIDO (no una tabla, DATA_MODEL 19.3): cada entrada
  // referencia una deuda por debtId, que hay que remapear igual que cualquier otra referencia.
  const debtScenarios = data.debtScenarios.map((s) => ({
    ...s,
    id: debtScenarioMap.get(s.id)!,
    profileId: targetProfileId,
    oneTimeExtraPayments: s.oneTimeExtraPayments.map((e) => ({
      ...e,
      debtId: debtMap.get(e.debtId) ?? e.debtId,
    })),
  }));

  // Restaurar = datos FRESCOS en local: se resetean los campos de sincronizacion (revision 0,
  // syncStatus 'local', deletedAt null, lastSyncedAt null). Un perfil restaurado es local hasta que
  // el usuario lo migre a una cuenta de forma explicita (fase 2). Ningun tombstone llega aqui (el
  // backup ya los excluye), pero el reset garantiza consistencia aunque el backup fuera v1 synced.
  const resetSync = <T extends object>(rows: T[]): T[] =>
    rows.map((row) => ({ ...row, ...syncDefaults() }));

  return {
    settings: resetSync(settings),
    accounts: resetSync(accounts),
    categories: resetSync(categories),
    tags: resetSync(tags),
    merchants: resetSync(merchants),
    merchantAliases: resetSync(merchantAliases),
    transactions: resetSync(transactions),
    rules: resetSync(rules),
    budgets: resetSync(budgets),
    importTemplates: resetSync(importTemplates),
    importBatches: resetSync(importBatches),
    noDuplicateDecisions: resetSync(noDuplicateDecisions),
    reviewItems: resetSync(reviewItems),
    reconciliations: resetSync(reconciliations),
    recurringSeries: resetSync(recurringSeries),
    recurringOccurrences: resetSync(recurringOccurrences),
    debts: resetSync(debts),
    debtPayments: resetSync(debtPayments),
    debtScenarios: resetSync(debtScenarios),
  };
}

// El scopeId de un presupuesto apunta a una categoria/subcategoria o a una cuenta segun su
// ambito. overall no lleva scopeId.
function remapBudgetScopeId(
  scope: string,
  scopeId: string | null,
  categoryMap: Map<string, string>,
  accountMap: Map<string, string>,
): string | null {
  if (scopeId === null) return null;
  if (scope === 'account') return accountMap.get(scopeId) ?? scopeId;
  if (scope === 'category' || scope === 'subcategory') return categoryMap.get(scopeId) ?? scopeId;
  return scopeId;
}

// --- Restauracion ---

// Restaura un backup en un PERFIL NUEVO. Crea un perfil independiente (id nuevo) con todos
// los datos del backup remapeados. Devuelve el perfil creado. La operacion es atomica.
export async function restoreAsNewProfile(backup: ProfileBackup): Promise<Profile> {
  const newProfileId = newId();
  const data = remapProfileData(backup.data, newProfileId);
  const ts = Date.now();
  // Nombre visible: el del backup, con sufijo para distinguirlo del original si conviven en
  // el mismo dispositivo. Se normaliza (recorta al limite de longitud de perfil).
  const restoredName = deriveRestoredName(backup.profile.name);
  const profile: Profile = {
    ...syncDefaults(),
    id: newProfileId,
    // Un perfil restaurado como nuevo es local (sin cuenta vinculada). La vinculacion a una
    // cuenta es un paso explicito de la fase 2, nunca implicito al restaurar.
    ownerUserId: null,
    name: restoredName,
    color: typeof backup.profile.color === 'string' ? backup.profile.color : '#6366f1',
    avatarEmoji: backup.profile.avatarEmoji ?? null,
    createdAt: ts,
    updatedAt: ts,
    archivedAt: null,
  };
  await backupRepo.restoreIntoNewProfile(profile, data);
  return profile;
}

// Restaura un backup SOBRE el perfil activo, sobrescribiendo por completo sus datos. Conserva
// la identidad del perfil activo (nombre, color, avatar). La operacion es atomica: si algo
// falla, el perfil queda como estaba. Aviso y confirmacion previos son responsabilidad de la
// UI (ARCHITECTURE seccion 8).
export async function restoreIntoActiveProfile(
  activeProfileId: string,
  backup: ProfileBackup,
): Promise<void> {
  requireProfileId(activeProfileId);
  const target = await profilesRepo.getById(activeProfileId);
  if (!target) {
    throw new BackupError('El perfil activo ya no existe. Vuelve a seleccionar un perfil.');
  }
  const data = remapProfileData(backup.data, activeProfileId);
  await backupRepo.restoreIntoExistingProfile(activeProfileId, data);
}

// Nombre para un perfil restaurado como nuevo: sufijo "(restaurado)" salvo que ya lo lleve.
// Se ajusta al limite de longitud de perfil aprovechando normalizeProfileName.
function deriveRestoredName(originalName: string): string {
  const base = (originalName ?? '').trim() || 'Perfil restaurado';
  const withSuffix = /\(restaurado\)\s*$/i.test(base) ? base : `${base} (restaurado)`;
  try {
    return normalizeProfileName(withSuffix);
  } catch {
    // Si el nombre con sufijo excede el limite, se recorta el original y se resufija.
    return normalizeProfileName(`${base.slice(0, 40)} (restaurado)`);
  }
}

export const backupService = {
  createBackup,
  serializeBackup,
  parseBackup,
  summarizeBackup,
  restoreAsNewProfile,
  restoreIntoActiveProfile,
};
