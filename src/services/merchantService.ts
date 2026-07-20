// Servicio de comercios normalizados (DATA_MODEL seccion 14, IMPLEMENTATION_ROADMAP fase 4).
//
// Estructura del modulo (mismo patron que ruleService.ts):
//  1. MOTOR PURO (sin acceso a datos ni React): casacion de un alias contra un concepto y
//     sugerencia por similitud cuando no hay alias que case. Deterministico y testeado
//     exhaustivamente. Un alias con regex invalida NUNCA rompe el motor: simplemente no casa
//     (la validacion al guardar el alias si la rechaza, con mensaje claro).
//  2. VALIDACION Y CRUD: comercios y sus alias (nombre no vacio, regex valida al guardar,
//     comercio no duplicado por nombre normalizado).
//  3. ORQUESTACION (async, exige profileId): aplicar el motor a un movimiento o
//     retroactivamente a los existentes (respeta la asociacion manual), reasignacion manual,
//     agrupacion de movimientos sin comercio para revisar candidatos, y fusion (delegada al
//     repositorio, que la hace transaccional).
import type {
  Merchant,
  MerchantAlias,
  MerchantMatchSource,
  MerchantMatchType,
  Transaction,
} from '../db/schema';
import { merchantsRepo } from '../db/merchantsRepo';
import type { MerchantMergeResult, MerchantMergeSnapshot } from '../db/merchantsRepo';
import { merchantAliasesRepo } from '../db/merchantAliasesRepo';
import { transactionsRepo } from '../db/transactionsRepo';
import type { TransactionPatch } from '../db/transactionsRepo';
import { normalizeConceptV1 } from '../lib/normalization';
import { ValidationError, assert, requireId, requireProfileId } from '../lib/validation';

export const MAX_MERCHANT_NAME_LENGTH = 80;
export const MAX_ALIAS_LENGTH = 200;

// Confianza (por mil, 0..1000) a partir de la cual una sugerencia por similitud se anota
// (merchantMatchSource='suggested'). Por debajo, el motor NO asocia (queda 'none'): nunca se
// convierte una sugerencia de baja confianza en una asociacion definitiva.
export const SUGGESTION_THRESHOLD = 600;

// ---------------------------------------------------------------------------
// 1. MOTOR PURO
// ---------------------------------------------------------------------------

function safeCompileAliasRegex(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, 'i');
  } catch {
    return null;
  }
}

// Compila una regex de alias para VALIDACION al guardar: lanza ValidationError con el
// motivo si el patron es invalido (sin errores silenciosos).
export function compileAliasRegex(pattern: string): RegExp {
  try {
    return new RegExp(pattern, 'i');
  } catch (e) {
    throw new ValidationError(
      `Expresion regular de alias invalida: ${e instanceof Error ? e.message : String(e)}.`,
    );
  }
}

// Evalua un alias contra un movimiento. exact/contains/startsWith comparan sobre el concepto
// NORMALIZADO (tolerante a mayusculas, acentos, espacios y signos), igual que normalizedAlias.
// regex se compila SIEMPRE del texto original del alias (rawAlias): normalizar antes
// destruiria la sintaxis regex (p. ej. corchetes o puntos). Se evalua sobre el concepto
// ORIGINAL del movimiento (rawConcept) para no perder informacion (mayusculas/signos que el
// patron pudiera necesitar); el flag 'i' la hace insensible a mayusculas igualmente.
export function aliasMatches(alias: MerchantAlias, normalizedConcept: string, rawConcept: string): boolean {
  switch (alias.matchType) {
    case 'exact':
      return alias.normalizedAlias === normalizedConcept;
    case 'contains':
      return alias.normalizedAlias.length > 0 && normalizedConcept.includes(alias.normalizedAlias);
    case 'startsWith':
      return alias.normalizedAlias.length > 0 && normalizedConcept.startsWith(alias.normalizedAlias);
    case 'regex': {
      const re = safeCompileAliasRegex(alias.rawAlias);
      // Regex invalida (o vaciada tras editar): la condicion no casa, no rompe el motor.
      if (re === null) return false;
      return re.test(rawConcept);
    }
    default:
      return false;
  }
}

function tokenize(s: string): string[] {
  return s.split(' ').filter((t) => t.length > 0);
}

// Similitud heuristica orientativa, por mil (0..1000). NO es una probabilidad real:
//  - coincidencia exacta de las dos cadenas normalizadas -> 1000;
//  - una contiene literalmente a la otra -> 800 (fuerte pero no exacta);
//  - en otro caso, proporcion de palabras del nombre del comercio presentes en el concepto.
export function computeMerchantSimilarity(normalizedConcept: string, normalizedMerchantName: string): number {
  if (normalizedConcept.length === 0 || normalizedMerchantName.length === 0) return 0;
  if (normalizedConcept === normalizedMerchantName) return 1000;
  if (normalizedConcept.includes(normalizedMerchantName) || normalizedMerchantName.includes(normalizedConcept)) {
    return 800;
  }
  const conceptTokens = new Set(tokenize(normalizedConcept));
  const nameTokens = tokenize(normalizedMerchantName);
  if (nameTokens.length === 0) return 0;
  const matched = nameTokens.filter((t) => conceptTokens.has(t)).length;
  return Math.round((matched / nameTokens.length) * 1000);
}

export interface MerchantMatchInput {
  normalizedConcept: string;
  rawConcept: string;
}

export interface MerchantMatchResult {
  merchantId: string | null;
  // El motor solo produce 'alias', 'suggested' o 'none'. 'manual'/'import'/'rule' los deciden
  // las capas que llaman al motor (el llamante nunca invoca el motor sobre un movimiento ya
  // asociado a mano).
  source: MerchantMatchSource;
  confidence: number;
  aliasId: string | null;
}

const NO_MATCH: MerchantMatchResult = { merchantId: null, source: 'none', confidence: 0, aliasId: null };

// Motor de asociacion determinista (DATA_MODEL 14.3, orden de asociacion):
//   1. manual: decidido FUERA del motor (el llamante no lo invoca sobre un movimiento manual);
//   2. identificador de comercio del banco: no existe en esta fase (campo reservado a fase 5);
//   3. alias EXACTO, por prioridad (menor numero = mayor prioridad);
//   4. alias CONFIGURABLE (contains/startsWith/regex), por prioridad;
//   5. regla: reservado (RuleAction no asigna comercio en esta fase; RuleConditionField
//      'merchant' permite CONDICIONAR una regla por comercio, no asignarlo);
//   6. sugerencia por similitud sobre comercios activos, nunca por debajo del umbral;
//   7. sin comercio.
// Solo considera alias habilitados (ya filtrados por el llamante) y comercios no archivados.
export function matchMerchant(
  input: MerchantMatchInput,
  merchants: Merchant[],
  aliases: MerchantAlias[],
): MerchantMatchResult {
  const activeMerchantIds = new Set(merchants.filter((m) => m.archivedAt === null).map((m) => m.id));
  // Desempate determinista ante prioridades iguales: por antiguedad (createdAt), igual
  // convencion que ruleService.byPriority. Sin este criterio, dos alias con la misma
  // prioridad quedarian en un orden dependiente del almacen (no reproducible a ojos del
  // usuario aunque tecnicamente estable).
  const byPriority = [...aliases].sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt);

  const exact = byPriority.find(
    (a) =>
      a.matchType === 'exact' &&
      activeMerchantIds.has(a.merchantId) &&
      aliasMatches(a, input.normalizedConcept, input.rawConcept),
  );
  if (exact) return { merchantId: exact.merchantId, source: 'alias', confidence: 1000, aliasId: exact.id };

  const configurable = byPriority.find(
    (a) =>
      a.matchType !== 'exact' &&
      activeMerchantIds.has(a.merchantId) &&
      aliasMatches(a, input.normalizedConcept, input.rawConcept),
  );
  if (configurable) {
    return { merchantId: configurable.merchantId, source: 'alias', confidence: 900, aliasId: configurable.id };
  }

  let best: { merchantId: string; confidence: number } | null = null;
  for (const m of merchants) {
    if (m.archivedAt !== null) continue;
    const score = computeMerchantSimilarity(input.normalizedConcept, m.normalizedName);
    if (best === null || score > best.confidence) best = { merchantId: m.id, confidence: score };
  }
  if (best !== null && best.confidence >= SUGGESTION_THRESHOLD) {
    return { merchantId: best.merchantId, source: 'suggested', confidence: best.confidence, aliasId: null };
  }
  return NO_MATCH;
}

// Movimientos elegibles para asociacion de comercio: las transferencias no tienen comercio
// (mueven dinero propio) y los padres de split delegan la asociacion en sus lineas hijas
// (mismo criterio que ruleService.isRuleEligible).
export function isMerchantEligible(tx: Transaction): boolean {
  if (tx.transferGroupId !== null) return false;
  if (tx.isSplitParent) return false;
  return true;
}

// Deriva el patch a aplicar a un movimiento a partir del resultado del motor. null si no hay
// NINGUN cambio efectivo (idempotente: aplicar dos veces no genera un segundo cambio).
function patchFromMatch(tx: Transaction, result: MerchantMatchResult): TransactionPatch | null {
  if (
    result.merchantId === tx.merchantId &&
    result.source === tx.merchantMatchSource &&
    result.confidence === tx.merchantMatchConfidence
  ) {
    return null;
  }
  return {
    merchantId: result.merchantId,
    merchantMatchSource: result.source,
    merchantMatchConfidence: result.confidence,
  };
}

// ---------------------------------------------------------------------------
// 2. VALIDACION Y CRUD
// ---------------------------------------------------------------------------

export function normalizeMerchantName(name: string): string {
  const trimmed = (name ?? '').trim().replace(/\s+/g, ' ');
  if (trimmed.length === 0) {
    throw new ValidationError('El nombre del comercio no puede estar vacio.');
  }
  if (trimmed.length > MAX_MERCHANT_NAME_LENGTH) {
    throw new ValidationError(
      `El nombre del comercio no puede superar ${MAX_MERCHANT_NAME_LENGTH} caracteres.`,
    );
  }
  return trimmed;
}

export function normalizeAliasText(raw: string): string {
  const trimmed = (raw ?? '').trim();
  if (trimmed.length === 0) {
    throw new ValidationError('El alias no puede estar vacio.');
  }
  if (trimmed.length > MAX_ALIAS_LENGTH) {
    throw new ValidationError(`El alias no puede superar ${MAX_ALIAS_LENGTH} caracteres.`);
  }
  return trimmed;
}

export interface MerchantInput {
  canonicalName: string;
  defaultCategoryId?: string | null;
  defaultSubcategoryId?: string | null;
  defaultTagIds?: string[];
  notes?: string | null;
}

export interface MerchantAliasInput {
  rawAlias: string;
  matchType: MerchantMatchType;
  priority?: number;
  enabled?: boolean;
}

// Agrupacion de movimientos sin comercio por concepto normalizado (candidatos de comercio).
export interface MerchantConceptGroup {
  normalizedConcept: string;
  sampleRawConcept: string;
  count: number;
  totalAmountCents: number;
}

// ---------------------------------------------------------------------------
// 3. ORQUESTACION (async, exige profileId)
// ---------------------------------------------------------------------------

export const merchantService = {
  list(profileId: string): Promise<Merchant[]> {
    requireProfileId(profileId);
    return merchantsRepo.listActive(profileId);
  },

  listArchived(profileId: string): Promise<Merchant[]> {
    requireProfileId(profileId);
    return merchantsRepo.listArchived(profileId);
  },

  getById(profileId: string, id: string): Promise<Merchant | undefined> {
    requireProfileId(profileId);
    requireId(id);
    return merchantsRepo.getById(profileId, id);
  },

  async create(profileId: string, input: MerchantInput): Promise<Merchant> {
    requireProfileId(profileId);
    const canonicalName = normalizeMerchantName(input.canonicalName);
    const normalizedName = normalizeConceptV1(canonicalName);
    const existing = await merchantsRepo.findByNormalizedName(profileId, normalizedName);
    assert(existing === undefined, `Ya existe un comercio equivalente a "${canonicalName}".`);
    return merchantsRepo.create(profileId, {
      canonicalName,
      normalizedName,
      defaultCategoryId: input.defaultCategoryId ?? null,
      defaultSubcategoryId: input.defaultSubcategoryId ?? null,
      defaultTagIds: input.defaultTagIds ?? [],
      notes: input.notes ?? null,
      archivedAt: null,
    });
  },

  async update(profileId: string, id: string, input: Partial<MerchantInput>): Promise<Merchant> {
    requireProfileId(profileId);
    requireId(id);
    const canonicalName =
      input.canonicalName !== undefined ? normalizeMerchantName(input.canonicalName) : undefined;
    return merchantsRepo.update(profileId, id, {
      ...(canonicalName !== undefined
        ? { canonicalName, normalizedName: normalizeConceptV1(canonicalName) }
        : {}),
      ...(input.defaultCategoryId !== undefined ? { defaultCategoryId: input.defaultCategoryId } : {}),
      ...(input.defaultSubcategoryId !== undefined
        ? { defaultSubcategoryId: input.defaultSubcategoryId }
        : {}),
      ...(input.defaultTagIds !== undefined ? { defaultTagIds: input.defaultTagIds } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    });
  },

  archive(profileId: string, id: string): Promise<Merchant> {
    requireProfileId(profileId);
    requireId(id);
    return merchantsRepo.update(profileId, id, { archivedAt: Date.now() });
  },

  unarchive(profileId: string, id: string): Promise<Merchant> {
    requireProfileId(profileId);
    requireId(id);
    return merchantsRepo.update(profileId, id, { archivedAt: null });
  },

  // Nota: no se expone un `remove` de comercio. Un borrado directo (fisico o logico) dejaria
  // alias/movimientos con un merchantId colgante en local sin la cascada transaccional que si
  // aplica `mergeMerchants` (mueve todo antes de archivar). La unica via soportada para retirar
  // un comercio es archivar (`archive`), que no rompe ninguna referencia existente.

  // --- Alias ---

  listAliases(profileId: string, merchantId: string): Promise<MerchantAlias[]> {
    requireProfileId(profileId);
    return merchantAliasesRepo.listByMerchant(profileId, merchantId);
  },

  // Todos los alias del perfil (de cualquier comercio), para exportacion/backup.
  listAllAliases(profileId: string): Promise<MerchantAlias[]> {
    requireProfileId(profileId);
    return merchantAliasesRepo.list(profileId);
  },

  async createAlias(profileId: string, merchantId: string, input: MerchantAliasInput): Promise<MerchantAlias> {
    requireProfileId(profileId);
    requireId(merchantId);
    const rawAlias = normalizeAliasText(input.rawAlias);
    if (input.matchType === 'regex') compileAliasRegex(rawAlias);
    return merchantAliasesRepo.create(profileId, {
      merchantId,
      rawAlias,
      normalizedAlias: normalizeConceptV1(rawAlias),
      matchType: input.matchType,
      priority: input.priority ?? 0,
      enabled: input.enabled ?? true,
    });
  },

  async updateAlias(
    profileId: string,
    id: string,
    input: Partial<MerchantAliasInput>,
  ): Promise<MerchantAlias> {
    requireProfileId(profileId);
    requireId(id);
    const current = await merchantAliasesRepo.getById(profileId, id);
    assert(current !== undefined, 'El alias no existe en el perfil.');
    const rawAlias = input.rawAlias !== undefined ? normalizeAliasText(input.rawAlias) : current!.rawAlias;
    const matchType = input.matchType ?? current!.matchType;
    if (matchType === 'regex') compileAliasRegex(rawAlias);
    return merchantAliasesRepo.update(profileId, id, {
      ...(input.rawAlias !== undefined
        ? { rawAlias, normalizedAlias: normalizeConceptV1(rawAlias) }
        : {}),
      ...(input.matchType !== undefined ? { matchType: input.matchType } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    });
  },

  setAliasEnabled(profileId: string, id: string, enabled: boolean): Promise<MerchantAlias> {
    requireProfileId(profileId);
    requireId(id);
    return merchantAliasesRepo.update(profileId, id, { enabled });
  },

  removeAlias(profileId: string, id: string): Promise<void> {
    requireProfileId(profileId);
    requireId(id);
    return merchantAliasesRepo.remove(profileId, id);
  },

  // --- Motor: aplicar a un movimiento / retroactivamente ---

  // Aplica el motor a un movimiento recien creado o editado. No hace nada si no es elegible o
  // ya esta asociado a mano (la asociacion manual siempre prevalece). Devuelve el movimiento
  // actualizado, o null si no hubo cambios.
  async applyToTransaction(profileId: string, txId: string): Promise<Transaction | null> {
    requireProfileId(profileId);
    requireId(txId);
    const tx = await transactionsRepo.getById(profileId, txId);
    if (!tx || !isMerchantEligible(tx) || tx.merchantMatchSource === 'manual') return null;
    const [merchants, aliases] = await Promise.all([
      merchantsRepo.list(profileId),
      merchantAliasesRepo.listEnabledByPriority(profileId),
    ]);
    const result = matchMerchant({ normalizedConcept: tx.normalizedConcept, rawConcept: tx.rawConcept }, merchants, aliases);
    const patch = patchFromMatch(tx, result);
    if (patch === null) return null;
    return transactionsRepo.update(profileId, txId, patch);
  },

  // Aplica el motor a los movimientos existentes del perfil (p. ej. tras crear/editar un
  // alias). Respeta las asociaciones manuales salvo overrideManual. Escribe en una unica
  // transaccion Dexie (transactionsRepo.applyToMany). Devuelve cuantos cambiaron.
  async applyRetroactive(
    profileId: string,
    options: { overrideManual?: boolean } = {},
  ): Promise<{ changed: number }> {
    requireProfileId(profileId);
    const overrideManual = options.overrideManual ?? false;
    const [merchants, aliases, transactions] = await Promise.all([
      merchantsRepo.list(profileId),
      merchantAliasesRepo.listEnabledByPriority(profileId),
      transactionsRepo.list(profileId),
    ]);
    const patchById = new Map<string, TransactionPatch>();
    for (const tx of transactions) {
      if (!isMerchantEligible(tx)) continue;
      if (!overrideManual && tx.merchantMatchSource === 'manual') continue;
      const result = matchMerchant(
        { normalizedConcept: tx.normalizedConcept, rawConcept: tx.rawConcept },
        merchants,
        aliases,
      );
      const patch = patchFromMatch(tx, result);
      if (patch !== null) patchById.set(tx.id, patch);
    }
    if (patchById.size === 0) return { changed: 0 };
    const changed = await transactionsRepo.applyToMany(
      profileId,
      [...patchById.keys()],
      (tx) => patchById.get(tx.id) ?? {},
    );
    return { changed };
  },

  // Reasignacion/desvinculacion MANUAL explicita. Ambas quedan marcadas 'manual' (incluso al
  // desvincular a "sin comercio"): es una decision humana y, como tal, prevalece sobre el
  // motor para siempre (applyToTransaction/applyRetroactive nunca tocan un movimiento
  // 'manual' salvo overrideManual explicito). Si se marcara 'none', el motor volveria a
  // sugerir un comercio en la siguiente pasada, deshaciendo la decision del usuario.
  setTransactionMerchant(profileId: string, txId: string, merchantId: string | null): Promise<Transaction> {
    requireProfileId(profileId);
    requireId(txId);
    return transactionsRepo.update(profileId, txId, {
      merchantId,
      merchantMatchSource: 'manual',
      merchantMatchConfidence: merchantId === null ? 0 : 1000,
    });
  },

  // Movimientos asociados a un comercio (para la vista de detalle en la UI).
  listTransactions(profileId: string, merchantId: string): Promise<Transaction[]> {
    requireProfileId(profileId);
    return transactionsRepo.listByMerchant(profileId, merchantId);
  },

  countTransactions(profileId: string, merchantId: string): Promise<number> {
    requireProfileId(profileId);
    return transactionsRepo.countByMerchant(profileId, merchantId);
  },

  // --- Candidatos de comercio (revision de movimientos sin asociar) ---

  // Agrupa los movimientos SIN comercio por concepto normalizado, para que el usuario revise
  // y decida crear un comercio (con su alias) a partir de un grupo. Nunca fusiona ni crea
  // nada por si solo: solo agrupa y ordena por frecuencia. Igual de "reanudable" en cada
  // llamada (no hay estado a medias: es una lectura agrupada, no una escritura por lotes).
  async listUnlinkedConceptGroups(
    profileId: string,
    options: { limit?: number } = {},
  ): Promise<MerchantConceptGroup[]> {
    requireProfileId(profileId);
    const unlinked = await transactionsRepo.listWithoutMerchant(profileId);
    const groups = new Map<string, MerchantConceptGroup>();
    for (const tx of unlinked) {
      if (!isMerchantEligible(tx)) continue;
      if (tx.normalizedConcept.length === 0) continue;
      let g = groups.get(tx.normalizedConcept);
      if (!g) {
        g = { normalizedConcept: tx.normalizedConcept, sampleRawConcept: tx.rawConcept, count: 0, totalAmountCents: 0 };
        groups.set(tx.normalizedConcept, g);
      }
      g.count += 1;
      g.totalAmountCents += Math.abs(tx.amountCents);
    }
    const limit = options.limit ?? 50;
    return [...groups.values()]
      .sort((a, b) => b.count - a.count || a.normalizedConcept.localeCompare(b.normalizedConcept))
      .slice(0, limit);
  },

  // Crea un comercio a partir de un candidato revisado por el usuario (grupo de conceptos sin
  // comercio): anade un alias EXACTO para ese concepto normalizado y aplica el motor de
  // inmediato para vincular esos movimientos. Combina create+createAlias+applyRetroactive en
  // una unica operacion de servicio para no dejar la secuencia de reglas de negocio en la UI.
  async createFromCandidate(
    profileId: string,
    canonicalName: string,
    sampleRawConcept: string,
  ): Promise<{ merchant: Merchant; changed: number }> {
    requireProfileId(profileId);
    const created = await merchantService.create(profileId, { canonicalName });
    await merchantService.createAlias(profileId, created.id, {
      rawAlias: sampleRawConcept,
      matchType: 'exact',
    });
    const { changed } = await merchantService.applyRetroactive(profileId);
    return { merchant: created, changed };
  },

  // --- Fusion (transaccional, delegada al repositorio) ---

  previewMerge(profileId: string, sourceId: string): Promise<{ aliases: number; transactions: number }> {
    requireProfileId(profileId);
    return merchantsRepo.previewMerge(profileId, sourceId);
  },

  mergeMerchants(profileId: string, sourceId: string, targetId: string): Promise<MerchantMergeResult> {
    requireProfileId(profileId);
    return merchantsRepo.mergeMerchants(profileId, sourceId, targetId);
  },

  undoMerge(profileId: string, snapshot: MerchantMergeSnapshot): Promise<void> {
    requireProfileId(profileId);
    return merchantsRepo.undoMerge(profileId, snapshot);
  },
};
