// Servicio de importacion de movimientos desde CSV/XLSX. Orquesta el lexer de fichero
// (lib/csvXlsx), los parsers de importe/fecha (lib/importParsing), la deteccion de
// duplicados (lib/dedupe + lib/duplicateFingerprint + services/duplicateEngine) y el commit
// atomico (importBatchesRepo). No conoce React. Todo el trabajo ocurre en el navegador; ningun
// dato sale del dispositivo (invariantes 2 y 3 de CLAUDE.md). Aislamiento por perfil: cada
// operacion exige profileId.
//
// Flujo (ARCHITECTURE.md seccion 5.1, ampliado en fase 5):
//   fichero -> parseFile (calcula sourceFileHash) -> checkRepeatedFile (aviso opcional) ->
//   suggestConfig (o plantilla) -> buildPreview (motor de duplicados multinivel) ->
//   el usuario decide fila a fila (omitir/importar/sustituir pendiente/vincular/no duplicado)
//   -> commit (ImportBatch + Transactions atomico) -> undo.
import type {
  Account,
  AmountStrategy,
  Category,
  ColumnMap,
  DecimalSeparator,
  ImportBatch,
  ImportTemplate,
  Merchant,
  MerchantAlias,
  SourceFormat,
  ThousandSeparator,
  Transaction,
} from '../db/schema';
import type { NewTransaction } from '../db/transactionsRepo';
import { transactionsRepo } from '../db/transactionsRepo';
import { importBatchesRepo } from '../db/importBatchesRepo';
import type { CommitLinkOperation, CommitNotDuplicateOperation } from '../db/importBatchesRepo';
import { importTemplatesRepo } from '../db/importTemplatesRepo';
import { noDuplicateDecisionsRepo } from '../db/noDuplicateDecisionsRepo';
import { readImportFile, type CellMatrix, type CellValue } from '../lib/csvXlsx';
import {
  parseAmountToCents,
  parseDateToIso,
  parseDebitCreditToCents,
  parseOptionalText,
  parseOptionalDate,
  parseOptionalAmountCents,
  parsePendingFlag,
  parseOptionalCurrency,
  detectColumnMapping,
  detectDecimalSeparator,
  detectDateFormat,
  isBlankCell,
  type AmountFormat,
} from '../lib/importParsing';
import { computeDedupeHash, normalizeConcept } from '../lib/dedupe';
import { normalizeConceptV1, NORMALIZATION_VERSION } from '../lib/normalization';
import {
  computeFingerprints,
  computeSourceFileHash,
  computeSourceRowHash,
  FINGERPRINT_VERSION,
} from '../lib/duplicateFingerprint';
import {
  evaluateDuplicatesWithDecisions,
  WEAK_DATE_WINDOW_DAYS,
  type DuplicateAction,
  type DuplicateEvaluationInput,
  type DuplicateReasonCode,
  type ExistingTxForDuplicate,
} from './duplicateEngine';
import { shiftDays } from '../lib/dates';
import { ValidationError, requireProfileId, requireId, assert } from '../lib/validation';
import { rulesRepo } from '../db/rulesRepo';
import { categoriesRepo } from '../db/categoriesRepo';
import { categoryService } from './categoryService';
import { applyRulesToDraft } from './ruleService';
import { merchantsRepo } from '../db/merchantsRepo';
import { merchantAliasesRepo } from '../db/merchantAliasesRepo';
import { matchMerchant } from './merchantService';

// Limite de longitud de concepto, coherente con la entrada manual (transactionService).
// Los conceptos de banca pueden ser largos; se truncan en lugar de rechazar la fila.
export const IMPORT_MAX_CONCEPT_LENGTH = 140;

// Prefijo de los ids sinteticos de candidatos que son OTRAS filas del mismo fichero (aun sin
// persistir): permiten detectar "duplicado dentro del propio lote" reutilizando el motor de
// duplicados, pero nunca son ids reales de Transaction (no se pueden "vincular" ni "sustituir"
// contra algo que todavia no existe en la base).
const BATCH_CANDIDATE_PREFIX = '__batch_row__:';

function isBatchCandidateId(id: string): boolean {
  return id.startsWith(BATCH_CANDIDATE_PREFIX);
}

// Configuracion de mapeo e interpretacion de un fichero. Las columnas se referencian por
// indice numerico (mas fiable que por nombre: las cabeceras pueden repetirse o faltar).
export interface ImportMappingConfig {
  columnMap: ColumnMap;
  dateFormat: string;
  decimalSeparator: DecimalSeparator;
  thousandSeparator: ThousandSeparator;
  amountStrategy: AmountStrategy;
  // Cuenta destino por defecto (y respaldo si una fila no resuelve su cuenta). Obligatoria.
  defaultAccountId: string | null;
  hasHeaderRow: boolean;
}

export interface ParsedFile {
  fileName: string;
  sourceFormat: SourceFormat;
  rows: CellMatrix;
  columnCount: number;
  // Hash SHA-256 y tamano del fichero de origen (fase 5): detectan "archivo repetido" aunque
  // cambie de nombre. Se calculan localmente sobre los bytes ya leidos (invariante 3).
  sourceFileHash: string;
  sourceFileSize: number;
}

export type PreviewRowStatus = 'ok' | 'duplicate' | 'error';

export interface PreviewRow {
  // Indice de la fila dentro de las filas de datos (excluida la cabecera).
  rowIndex: number;
  raw: CellValue[];
  // Movimiento candidato ya parseado. null si la fila tiene errores de parseo.
  transaction: NewTransaction | null;
  displayDate: string | null;
  displayConcept: string | null;
  displayAmountCents: number | null;
  displayAccountId: string | null;
  errors: string[];
  // Texto de la columna "comercio" del banco, si se mapeo (DATA_MODEL 14.3 punto 2:
  // identificador de comercio del banco). No se persiste tal cual: en commit() se intenta un
  // cruce exacto contra comercios existentes antes de aplicar el motor general.
  bankMerchantHint: string | null;
  // Categoria indicada por el propio fichero (columnas opcionales Categoria/Subcategoria), por
  // nombre. Se resuelve (y si falta se crea) en commit(); manda sobre las reglas.
  fileCategory: { category: string; subcategory: string | null } | null;
  // Resolucion de la columna de cuenta por nombre (ver buildPreview: si el fichero trae nombres
  // de cuenta, uno que no existe es un error en vez de caer en la cuenta por defecto).
  accountMatchedByName?: boolean;
  unmatchedAccountName?: string | null;
  // --- Resultado del motor de duplicados (fase 5) ---
  duplicateStatus: Transaction['duplicateStatus'];
  duplicateConfidence: number;
  duplicateReasonCodes: DuplicateReasonCode[];
  duplicateDiffs: string[];
  duplicateCandidateIds: string[];
  // Mejor candidato (id real de Transaction, o un id sintetico de otra fila del propio
  // fichero con isBatchCandidateId). null si duplicateStatus === 'unique'.
  bestCandidateId: string | null;
  bestCandidateFingerprint: string | null;
  // Decision elegida por el usuario para esta fila. null cuando duplicateStatus === 'unique'
  // (no hay nada que decidir). Solo tiene efecto si `include` es true.
  decision: DuplicateAction | null;
  // Decisiones ofrecibles para esta fila (sin 'skip': desmarcar `include` ya cubre omitir).
  // La UI construye el selector a partir de esta lista.
  availableDecisions: DuplicateAction[];
  status: PreviewRowStatus;
  // Seleccion por defecto: se importan las filas correctas que no son duplicadas.
  include: boolean;
}

export interface ImportPreview {
  rows: PreviewRow[];
  // Categorias o subcategorias del fichero que aun no existen en el perfil ("Vacaciones",
  // "Vacaciones > Comida"). Se crearan al confirmar la importacion.
  categoriesToCreate?: string[];
  summary: {
    total: number;
    ok: number;
    duplicates: number;
    errors: number;
  };
}

// --- Utilidades de celda ---

function cellToString(cell: CellValue): string {
  if (cell === null) return '';
  if (cell instanceof Date) {
    const y = String(cell.getFullYear()).padStart(4, '0');
    const m = String(cell.getMonth() + 1).padStart(2, '0');
    const d = String(cell.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(cell);
}

// Etiquetas de columna para la UI: cabecera real (si la hay) o "Columna N".
export function columnLabels(parsed: ParsedFile, hasHeaderRow: boolean): string[] {
  const header = hasHeaderRow ? parsed.rows[0] : undefined;
  return Array.from({ length: parsed.columnCount }, (_, i) => {
    const label = header ? cellToString(header[i] ?? null).trim() : '';
    return label.length > 0 ? label : `Columna ${i + 1}`;
  });
}

function normalizeImportConcept(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  return trimmed.slice(0, IMPORT_MAX_CONCEPT_LENGTH);
}

// Heuristica: la primera fila es cabecera si sus celdas nombran una columna de fecha y una
// de importe (o cargo/abono). Es solo una sugerencia editable por el usuario.
function looksLikeHeader(row: CellValue[] | undefined): boolean {
  if (!row) return false;
  const labels = row.map((c) => cellToString(c));
  const m = detectColumnMapping(labels).columnMap;
  const hasAmount = m.amount !== null || m.debit !== null || m.credit !== null;
  const dateNamed = labels.some((l) => {
    const n = normalizeConcept(l);
    return n === 'date' || n.startsWith('fecha');
  });
  return dateNamed && hasAmount;
}

// Convierte un Transaction ya persistido a la forma minima que necesita el motor de
// duplicados (services/duplicateEngine.ts), sin acoplar el motor a Dexie.
function toExistingTxForDuplicate(tx: Transaction): ExistingTxForDuplicate {
  return {
    id: tx.id,
    accountId: tx.accountId,
    currency: tx.currency,
    amountCents: tx.amountCents,
    date: tx.date,
    normalizedConcept: tx.normalizedConcept,
    merchantId: tx.merchantId,
    bankTransactionId: tx.bankTransactionId,
    pending: tx.pending,
    exactFingerprint: tx.exactFingerprint,
    normalizedFingerprint: tx.normalizedFingerprint,
  };
}

// Aplica la asociacion de comercio a un borrador y recalcula su huella tolerante si el
// comercio resuelto cambia la identidad usada por el motor de duplicados
// (normalizedFingerprint usa merchantId cuando existe, ver lib/duplicateFingerprint.ts). Se
// llama DESDE buildPreview (antes de puntuar duplicados, para que el nivel "mismo comercio"
// pueda activarse tambien en filas recien importadas) y de nuevo, de forma idempotente, en
// commit() como red de seguridad. Nunca sobreescribe una asociacion manual (los borradores de
// import nunca la llevan). Orden de asociacion: 1) cruce EXACTO por el identificador de
// comercio del banco si la columna "comercio" se mapeo (DATA_MODEL 14.3 punto 2, mas fiable
// que el concepto); 2) motor general de alias/similitud (merchantService.matchMerchant).
function applyMerchantMatch(
  draft: NewTransaction,
  bankMerchantHint: string | null,
  merchants: Merchant[],
  aliases: MerchantAlias[],
): void {
  let merchantId: string | null = null;
  let source: NewTransaction['merchantMatchSource'] = 'none';
  let confidence = 0;
  if (bankMerchantHint !== null) {
    const normalizedHint = normalizeConceptV1(bankMerchantHint);
    const bankMatch = merchants.find(
      (m) => m.archivedAt === null && m.normalizedName === normalizedHint,
    );
    if (bankMatch) {
      merchantId = bankMatch.id;
      source = 'import';
      confidence = 1000;
    }
  }
  if (merchantId === null) {
    const result = matchMerchant(
      { normalizedConcept: draft.normalizedConcept, rawConcept: draft.rawConcept },
      merchants,
      aliases,
    );
    merchantId = result.merchantId;
    source = result.source;
    confidence = result.confidence;
  }
  if (merchantId === draft.merchantId) return; // sin cambios: no hace falta recalcular huellas
  draft.merchantId = merchantId;
  draft.merchantMatchSource = source;
  draft.merchantMatchConfidence = confidence;
  const { exactFingerprint, normalizedFingerprint } = computeFingerprints({
    accountId: draft.accountId,
    date: draft.date,
    amountCents: draft.amountCents,
    currency: draft.currency,
    normalizedConcept: draft.normalizedConcept,
    merchantId,
  });
  draft.exactFingerprint = exactFingerprint;
  draft.normalizedFingerprint = normalizedFingerprint;
}

// --- Parseo de fichero y sugerencia de configuracion ---

export const importService = {
  // Lee y parsea el fichero en el navegador, y calcula su hash (fase 5). No hay ninguna
  // llamada de red: el hash se deriva sobre los bytes ya cargados en memoria por el propio
  // navegador (invariante 3 de CLAUDE.md); nunca se sube el fichero para calcularlo.
  async parseFile(file: File): Promise<ParsedFile> {
    const [wb, bytes] = await Promise.all([readImportFile(file), file.arrayBuffer()]);
    const columnCount = wb.rows.reduce((max, r) => Math.max(max, r.length), 0);
    assert(columnCount > 0, 'El fichero no contiene columnas legibles.');
    assert(wb.rows.length > 0, 'El fichero no contiene filas.');
    const sourceFileHash = await computeSourceFileHash(bytes);
    return {
      fileName: wb.fileName,
      sourceFormat: wb.sourceFormat,
      rows: wb.rows,
      columnCount,
      sourceFileHash,
      sourceFileSize: bytes.byteLength,
    };
  },

  // Lotes previos con el mismo fichero (mismo contenido, aunque cambie el nombre). Aviso de
  // "archivo repetido" (alcance fase 5, punto 9): la UI lo muestra ANTES de comprometerse a
  // mapear/importar, con fecha, cuenta implicita y filas del lote anterior, y deja cancelar o
  // continuar explicitamente.
  checkRepeatedFile(profileId: string, sourceFileHash: string): Promise<ImportBatch[]> {
    requireProfileId(profileId);
    return importBatchesRepo.listBySourceFileHash(profileId, sourceFileHash);
  },

  // Sugiere una configuracion de mapeo a partir del contenido (deteccion editable por el
  // usuario). Elige la cuenta destino por defecto indicada.
  suggestConfig(parsed: ParsedFile, defaultAccountId: string | null): ImportMappingConfig {
    const hasHeaderRow = looksLikeHeader(parsed.rows[0]);
    const headerLabels = hasHeaderRow
      ? (parsed.rows[0] ?? []).map((c) => cellToString(c))
      : [];
    const detected = detectColumnMapping(headerLabels);
    const dataRows = hasHeaderRow ? parsed.rows.slice(1) : parsed.rows;

    // Muestras para detectar separador decimal y formato de fecha.
    const amountIdx =
      detected.amountStrategy === 'signed'
        ? detected.columnMap.amount
        : detected.columnMap.debit ?? detected.columnMap.credit;
    const amountSamples = collectColumnSamples(dataRows, amountIdx);
    const dateSamples = collectColumnSamples(dataRows, detected.columnMap.date);
    const decimalSeparator = detectDecimalSeparator(amountSamples);

    return {
      columnMap: detected.columnMap,
      amountStrategy: detected.amountStrategy,
      dateFormat: detectDateFormat(dateSamples),
      decimalSeparator,
      // El separador de miles se guarda por coherencia con la plantilla (DATA_MODEL 2.9),
      // pero el parseo deriva el agrupador del separador decimal (ver normalizeDecimalString).
      thousandSeparator: decimalSeparator === ',' ? '.' : ',',
      defaultAccountId,
      hasHeaderRow,
    };
  },

  // Devuelve la lista de problemas de configuracion (vacia = lista para previsualizar).
  // La usa la UI para habilitar/deshabilitar el paso de previsualizacion.
  configProblems(config: ImportMappingConfig, columnCount: number): string[] {
    const problems: string[] = [];
    const inRange = (v: number | string | null): boolean =>
      typeof v === 'number' && v >= 0 && v < columnCount;
    if (!inRange(config.columnMap.date)) problems.push('Falta asignar la columna de fecha.');
    if (!inRange(config.columnMap.concept)) {
      problems.push('Falta asignar la columna de concepto.');
    }
    if (config.amountStrategy === 'signed') {
      if (!inRange(config.columnMap.amount)) {
        problems.push('Falta asignar la columna de importe.');
      }
    } else {
      if (!inRange(config.columnMap.debit) && !inRange(config.columnMap.credit)) {
        problems.push('Falta asignar al menos una columna de cargo o abono.');
      }
    }
    if (!config.defaultAccountId) {
      problems.push('Falta elegir la cuenta destino por defecto.');
    }
    return problems;
  },

  // Construye la previsualizacion completa: parsea cada fila, marca errores fila a fila y
  // ejecuta el motor de duplicados multinivel (services/duplicateEngine.ts) contra los
  // movimientos existentes del perfil (acotados a una ventana temporal) y contra las filas
  // anteriores del propio fichero. No escribe nada.
  async buildPreview(
    profileId: string,
    parsed: ParsedFile,
    config: ImportMappingConfig,
    accounts: Account[],
  ): Promise<ImportPreview> {
    requireProfileId(profileId);
    const problems = importService.configProblems(config, parsed.columnCount);
    assert(problems.length === 0, problems.join(' '));
    assert(config.defaultAccountId !== null, 'Falta la cuenta destino por defecto.');
    // Barrera de aislamiento (defensa en profundidad): toda cuenta con la que se resolvera
    // un accountId debe pertenecer al perfil, no solo la cuenta por defecto. Asi el
    // aislamiento no depende solo de que el llamante haya filtrado las cuentas.
    assert(
      accounts.every((a) => a.profileId === profileId),
      'Se han pasado cuentas de otro perfil a la importacion.',
    );
    // La cuenta destino debe pertenecer al perfil (aislamiento).
    const defaultAccount = accounts.find((a) => a.id === config.defaultAccountId);
    assert(
      defaultAccount !== undefined,
      'La cuenta destino por defecto no existe en el perfil.',
    );
    const accountByName = new Map<string, string>();
    const accountsById = new Map<string, Account>();
    for (const acc of accounts) {
      accountByName.set(normalizeConcept(acc.name), acc.id);
      accountsById.set(acc.id, acc);
    }

    const format: AmountFormat = {
      decimalSeparator: config.decimalSeparator,
      thousandSeparator: config.thousandSeparator,
    };
    const dataRows = config.hasHeaderRow ? parsed.rows.slice(1) : parsed.rows;

    // Primera pasada: parsear cada fila a un candidato o a errores (incluye huellas
    // provisionales, sin comercio: se recalculan en la pasada siguiente).
    const rows: PreviewRow[] = dataRows.map((raw, rowIndex) =>
      buildPreviewRow(
        profileId,
        raw,
        rowIndex,
        config,
        format,
        accountByName,
        accountsById,
        config.defaultAccountId!,
        parsed,
      ),
    );

    // Si la columna de cuenta trae NOMBRES de cuenta (al menos una fila casa con una cuenta del
    // perfil), una fila con un nombre que no existe no se manda en silencio a la cuenta por
    // defecto: mezclaria saldos de cuentas distintas. Se marca con error para crear la cuenta o
    // corregir el fichero. Si ninguna fila casa (la columna trae IBAN o numero de tarjeta), se
    // mantiene el comportamiento de siempre: todo a la cuenta por defecto.
    if (rows.some((r) => r.accountMatchedByName)) {
      for (const row of rows) {
        if (!row.unmatchedAccountName) continue;
        row.errors.push(
          `La cuenta "${row.unmatchedAccountName}" no existe en este perfil. Creala en Cuentas o corrige el fichero.`,
        );
        row.status = 'error';
        row.include = false;
        row.transaction = null;
      }
    }

    // Pasada de comercio (fase 4/5): se aplica AQUI, antes del motor de duplicados, para que
    // el nivel "mismo comercio" (strongNormalized) y la huella tolerante
    // (normalizedFingerprint, que usa merchantId cuando existe) puedan activarse tambien
    // sobre filas recien importadas. Si se dejara para commit() (como en la version anterior
    // de esta fase), toda fila de importacion llegaba al motor de duplicados con
    // merchantId=null, y el criterio "mismo comercio" quedaba muerto en la practica. Se
    // reaplica en commit() como red de seguridad idempotente (p. ej. si el motor de comercios
    // cambia entre buildPreview y commit), sin coste de correccion.
    const [merchantsForPreview, aliasesForPreview] = await Promise.all([
      merchantsRepo.list(profileId),
      merchantAliasesRepo.listEnabledByPriority(profileId),
    ]);
    if (merchantsForPreview.length > 0 || aliasesForPreview.length > 0) {
      for (const row of rows) {
        const draft = row.transaction;
        if (!draft) continue;
        applyMerchantMatch(draft, row.bankMerchantHint, merchantsForPreview, aliasesForPreview);
      }
    }

    // Segunda pasada: motor de duplicados. Se acota la ventana temporal a partir de las
    // fechas del propio fichero (ampliada por WEAK_DATE_WINDOW_DAYS) y se cargan UNA sola vez
    // los movimientos existentes en ese rango + las decisiones de "no duplicado" del perfil
    // (mismo patron que collectDedupeHashes: una consulta acotada, no una por fila).
    const parsedDates = rows
      .map((r) => r.transaction?.date)
      .filter((d): d is string => d !== undefined);
    if (parsedDates.length > 0) {
      const minDate = shiftDays(
        parsedDates.reduce((a, b) => (a < b ? a : b)),
        -WEAK_DATE_WINDOW_DAYS,
      );
      const maxDate = shiftDays(
        parsedDates.reduce((a, b) => (a > b ? a : b)),
        WEAK_DATE_WINDOW_DAYS,
      );
      const [existingInRange, decisions] = await Promise.all([
        transactionsRepo.listByDateRange(profileId, minDate, maxDate),
        noDuplicateDecisionsRepo.list(profileId),
      ]);
      const decisionPairs = decisions.map((d) => ({
        leftFingerprint: d.leftFingerprint,
        rightFingerprint: d.rightFingerprint,
        leftTxId: d.leftTxId,
        rightTxId: d.rightTxId,
      }));

      // Los candidatos se indexan por (cuenta+importe+moneda), no solo por cuenta:
      // `scoreCandidate` exige SIEMPRE el mismo importe (invariante dura, ver
      // duplicateEngine.ts), asi que agrupar por ese trio evita comparar cada fila contra
      // TODOS los movimientos de la cuenta (que degradaria a O(filas * movimientos) o peor,
      // O(filas^2) al acumular candidatos sinteticos del propio fichero). El coste por fila
      // queda acotado por cuantos movimientos comparten exactamente ese importe, que es la
      // comparacion minima imprescindible (CLAUDE.md: escala a decenas de miles).
      const bucketKey = (accountId: string, amountCents: number, currency: string): string =>
        `${accountId} ${amountCents} ${currency}`;
      const candidatesByBucket = new Map<string, ExistingTxForDuplicate[]>();
      for (const tx of existingInRange) {
        const key = bucketKey(tx.accountId, tx.amountCents, tx.currency);
        const arr = candidatesByBucket.get(key) ?? [];
        arr.push(toExistingTxForDuplicate(tx));
        candidatesByBucket.set(key, arr);
      }

      for (const row of rows) {
        const draft = row.transaction;
        if (!draft) continue;
        const input: DuplicateEvaluationInput = {
          accountId: draft.accountId,
          currency: draft.currency,
          amountCents: draft.amountCents,
          date: draft.date,
          normalizedConcept: draft.normalizedConcept,
          merchantId: draft.merchantId,
          bankTransactionId: draft.bankTransactionId,
          pending: draft.pending,
          exactFingerprint: draft.exactFingerprint,
          normalizedFingerprint: draft.normalizedFingerprint,
        };
        const key = bucketKey(draft.accountId, draft.amountCents, draft.currency);
        const pool = candidatesByBucket.get(key) ?? [];
        const evaluation = evaluateDuplicatesWithDecisions(input, pool, decisionPairs);

        row.duplicateStatus = evaluation.status;
        row.duplicateConfidence = evaluation.confidence;
        row.duplicateReasonCodes = evaluation.reasonCodes;
        row.duplicateDiffs = evaluation.best?.diffs ?? [];
        row.duplicateCandidateIds = evaluation.candidateIds;
        row.bestCandidateId = evaluation.best?.candidateId ?? null;
        row.bestCandidateFingerprint =
          evaluation.best !== null
            ? pool.find((c) => c.id === evaluation.best!.candidateId)?.normalizedFingerprint ?? null
            : null;

        // Se persisten en el propio borrador (para consulta futura, DATA_MODEL 15.1). Los
        // candidatos sinteticos del propio lote (aun sin id real) no se guardan como
        // referencia permanente.
        draft.duplicateStatus = evaluation.status;
        draft.duplicateConfidence = evaluation.confidence;
        draft.duplicateReasonCodes = evaluation.reasonCodes;
        draft.duplicateCandidateIds = evaluation.candidateIds.filter((id) => !isBatchCandidateId(id));

        if (evaluation.status !== 'unique') {
          row.status = 'duplicate';
          const bestIsPersisted =
            row.bestCandidateId !== null && !isBatchCandidateId(row.bestCandidateId);
          // 'link' y 'replacePending' solo tienen sentido contra un movimiento YA
          // PERSISTIDO: nunca contra una fila del propio fichero, que todavia no existe en
          // la base en este momento (si lo fuera, la decision quedaria imposible de honrar
          // en commit() y el resultado seria un import silencioso que duplica saldo).
          row.availableDecisions = (evaluation.best?.actions ?? []).filter(
            (a): a is DuplicateAction =>
              a !== 'skip' && ((a !== 'link' && a !== 'replacePending') || bestIsPersisted),
          );
          row.decision =
            evaluation.status === 'pendingReplaced' && bestIsPersisted ? 'replacePending' : 'import';
          // Los posibles duplicados no se importan por defecto: el usuario decide
          // explicitamente (omitir/importar/sustituir/vincular/marcar no duplicado).
          row.include = false;
        }

        // Anade este borrador como candidato SINTETICO para las filas siguientes del mismo
        // fichero: detecta duplicados dentro del propio lote ademas de contra la base.
        const bucketPool = candidatesByBucket.get(key) ?? [];
        bucketPool.push({
          id: `${BATCH_CANDIDATE_PREFIX}${row.rowIndex}`,
          accountId: draft.accountId,
          currency: draft.currency,
          amountCents: draft.amountCents,
          date: draft.date,
          normalizedConcept: draft.normalizedConcept,
          merchantId: draft.merchantId,
          bankTransactionId: draft.bankTransactionId,
          pending: draft.pending,
          exactFingerprint: draft.exactFingerprint,
          normalizedFingerprint: draft.normalizedFingerprint,
        });
        candidatesByBucket.set(key, bucketPool);
      }
    }

    const summary = {
      total: rows.length,
      ok: rows.filter((r) => r.status === 'ok').length,
      duplicates: rows.filter((r) => r.status === 'duplicate').length,
      errors: rows.filter((r) => r.status === 'error').length,
    };
    const categoriesToCreate = missingFileCategories(rows, await categoriesRepo.list(profileId));
    return { rows, summary, categoriesToCreate };
  },

  // Commit atomico de la previsualizacion: crea el ImportBatch, los movimientos incluidos, y
  // aplica las decisiones "vincular" (actualiza el movimiento existente, no crea uno nuevo) y
  // "marcar no duplicado" (registra la decision para no volver a preguntar), TODO dentro de la
  // unica transaccion Dexie de importBatchesRepo.commitBatch. Si algo falla en cualquier punto,
  // se revierte todo entero: un reintento tras un fallo parcial nunca puede duplicar un
  // movimiento (antes estas dos decisiones se aplicaban en bucles separados DESPUES de la
  // transaccion atomica, lo que permitia justo ese escenario — hallazgo critico de auditoria
  // financiera).
  async commit(
    profileId: string,
    params: {
      parsed: ParsedFile;
      preview: ImportPreview;
      templateId: string | null;
    },
  ): Promise<{ batch: ImportBatch; imported: number; linked: number }> {
    requireProfileId(profileId);
    const included = params.preview.rows.filter((r) => r.include && r.transaction !== null);
    assert(included.length > 0, 'No hay ninguna fila seleccionada para importar.');

    const linkRows = included.filter((r) => r.decision === 'link');
    const createRows = included.filter((r) => r.decision !== 'link');
    assert(
      createRows.length > 0 || linkRows.length > 0,
      'No hay ninguna fila seleccionada para importar.',
    );

    // Defensa en profundidad: 'link' y 'replacePending' solo son honrables contra un
    // movimiento YA PERSISTIDO (nunca contra una fila sintetica del propio fichero, que aun
    // no existe en la base). buildPreview ya evita ofrecer estas decisiones en ese caso, pero
    // si por cualquier via (p. ej. "aplicar a equivalentes" en la UI) una fila terminara con
    // una decision imposible de honrar, aqui se rechaza explicitamente en vez de degradarla
    // en silencio a un alta normal (que duplicaria saldo) o descartarla sin avisar.
    for (const r of linkRows) {
      assert(
        r.bestCandidateId !== null && !isBatchCandidateId(r.bestCandidateId),
        `La fila ${r.rowIndex + 1} tiene la decision "vincular" pero no hay ningun movimiento existente al que vincularla.`,
      );
    }
    // Dos filas del mismo fichero no pueden vincularse al MISMO movimiento existente: la
    // segunda operacion sobreescribiria en la base lo que dejo la primera (cada "vincular" es
    // un update por id, nunca crea un movimiento nuevo), perdiendo en silencio el alta que el
    // usuario si selecciono para esa fila (hallazgo de auditoria financiera). Se rechaza
    // explicitamente en vez de perder una fila sin avisar.
    const linkTargets = new Set<string>();
    for (const r of linkRows) {
      const targetId = r.bestCandidateId as string;
      assert(
        !linkTargets.has(targetId),
        `Dos filas del fichero intentan vincularse al mismo movimiento existente; cada movimiento solo puede vincularse una vez (fila ${r.rowIndex + 1}).`,
      );
      linkTargets.add(targetId);
    }
    for (const r of createRows) {
      if (r.decision !== 'replacePending') continue;
      assert(
        r.bestCandidateId !== null && !isBatchCandidateId(r.bestCandidateId),
        `La fila ${r.rowIndex + 1} tiene la decision "sustituir pendiente" pero no hay ningun pendiente existente al que sustituir.`,
      );
    }

    const transactions = createRows.map((r) => {
      const draft: NewTransaction = { ...(r.transaction as NewTransaction) };
      if (r.decision === 'replacePending' && r.bestCandidateId !== null && !isBatchCandidateId(r.bestCandidateId)) {
        draft.pendingReplacementId = r.bestCandidateId;
      }
      return draft;
    });

    // Auto-categorizacion por reglas de los movimientos importados (ARCHITECTURE 5.2): se
    // cargan una vez las reglas activas del perfil y se aplican a cada borrador antes del
    // commit atomico, de modo que quedan categorizados (categorizedBy='rule', ruleId) desde
    // el primer momento y en la misma transaccion. Si no hay reglas, no cambia nada.
    // Categoria indicada en el propio fichero: se resuelve por nombre (creando la categoria o
    // subcategoria si aun no existe) y manda sobre las reglas, que solo se aplican a las filas
    // sin categoria del fichero.
    await applyFileCategories(profileId, createRows, transactions);
    const enabledRules = await rulesRepo.listEnabledByPriority(profileId);
    if (enabledRules.length > 0) {
      for (const draft of transactions) {
        if (draft.categoryId !== null) continue;
        applyRulesToDraft(enabledRules, draft);
      }
    }
    // Asociacion de comercios (fase 4, ampliada en fase 5): red de seguridad idempotente.
    // buildPreview ya la aplica (para que el motor de duplicados pueda usar merchantId, ver
    // applyMerchantMatch), pero se reaplica aqui por si el llamante construyo la previsualizacion
    // sin pasar por buildPreview, o si los comercios cambiaron entre preview y commit. Nunca
    // sobreescribe una asociacion manual (los borradores de import nunca la llevan).
    const [merchants, aliases] = await Promise.all([
      merchantsRepo.list(profileId),
      merchantAliasesRepo.listEnabledByPriority(profileId),
    ]);
    if (merchants.length > 0 || aliases.length > 0) {
      createRows.forEach((row, index) => {
        applyMerchantMatch(transactions[index]!, row.bankMerchantHint, merchants, aliases);
      });
    }

    const rowsSkippedDuplicate = params.preview.rows.filter(
      (r) => r.duplicateStatus !== 'unique' && !r.include,
    ).length;

    // Decision "vincular": actualiza el movimiento EXISTENTE con los metadatos bancarios de
    // esta fila (no crea un movimiento nuevo, evita duplicar saldo). Solo aplica contra
    // candidatos ya persistidos (nunca contra una fila sintetica del propio fichero, ya
    // garantizado por las aserciones anteriores). Se aplica DENTRO de la misma transaccion
    // atomica que commitBatch (ver comentario de commit() mas arriba).
    const linkOps: CommitLinkOperation[] = linkRows.map((row) => {
      const draft = row.transaction as NewTransaction;
      return {
        candidateId: row.bestCandidateId as string,
        patch: {
          bankTransactionId: draft.bankTransactionId,
          bookingDate: draft.bookingDate,
          valueDate: draft.valueDate,
          pending: draft.pending,
          currency: draft.currency,
          balanceAfterCents: draft.balanceAfterCents,
          bankReference: draft.bankReference,
          operationType: draft.operationType,
          sourceFileHash: draft.sourceFileHash,
          sourceFileSize: draft.sourceFileSize,
        },
      };
    });

    // Decision "marcar no duplicado": registra la pareja de huellas para que no vuelva a
    // proponerse salvo cambio relevante (DATA_MODEL 15.2). Tambien dentro de la misma
    // transaccion atomica; commitBatch comprueba alli mismo si la pareja ya estaba decidida.
    const notDuplicateOps: CommitNotDuplicateOperation[] = included
      .filter(
        (r): r is typeof r & { transaction: NewTransaction; bestCandidateFingerprint: string } =>
          r.decision === 'markNotDuplicate' &&
          r.transaction !== null &&
          r.bestCandidateFingerprint !== null,
      )
      .map((row) => ({
        leftFingerprint: row.transaction.normalizedFingerprint,
        rightFingerprint: row.bestCandidateFingerprint,
        leftTxId: null,
        rightTxId:
          row.bestCandidateId !== null && !isBatchCandidateId(row.bestCandidateId)
            ? row.bestCandidateId
            : null,
        reason: null,
      }));

    const batch = await importBatchesRepo.commitBatch(
      profileId,
      {
        templateId: params.templateId,
        fileName: params.parsed.fileName,
        rowsTotal: params.preview.summary.total,
        rowsImported: transactions.length,
        rowsSkippedDuplicate,
        rowsLinked: linkRows.length,
        sourceFileHash: params.parsed.sourceFileHash,
        sourceFileSize: params.parsed.sourceFileSize,
      },
      transactions,
      linkOps,
      notDuplicateOps,
    );

    return { batch, imported: transactions.length, linked: linkRows.length };
  },

  // Deshace un lote completo (borra sus movimientos, restaura los pendientes que hubiera
  // sustituido, y marca el lote como deshecho).
  async undo(profileId: string, batchId: string): Promise<number> {
    requireProfileId(profileId);
    requireId(batchId);
    return importBatchesRepo.undoBatch(profileId, batchId);
  },

  listBatches(profileId: string): Promise<ImportBatch[]> {
    requireProfileId(profileId);
    return importBatchesRepo.listRecent(profileId);
  },

  // --- Plantillas de importacion (CRUD) ---

  listTemplates(profileId: string): Promise<ImportTemplate[]> {
    requireProfileId(profileId);
    return importTemplatesRepo.list(profileId);
  },

  // Guarda la configuracion actual como plantilla reutilizable. Nombre unico por perfil.
  async saveTemplate(
    profileId: string,
    name: string,
    sourceFormat: SourceFormat,
    config: ImportMappingConfig,
  ): Promise<ImportTemplate> {
    requireProfileId(profileId);
    const cleanName = name.trim().replace(/\s+/g, ' ');
    assert(cleanName.length > 0, 'La plantilla necesita un nombre.');
    const existing = await importTemplatesRepo.findByName(profileId, cleanName);
    assert(existing === undefined, `Ya existe una plantilla con el nombre "${cleanName}".`);
    return importTemplatesRepo.create(profileId, {
      name: cleanName,
      sourceFormat,
      columnMap: config.columnMap,
      dateFormat: config.dateFormat,
      decimalSeparator: config.decimalSeparator,
      thousandSeparator: config.thousandSeparator,
      amountStrategy: config.amountStrategy,
      defaultAccountId: config.defaultAccountId,
      hasHeaderRow: config.hasHeaderRow,
    });
  },

  async updateTemplate(
    profileId: string,
    id: string,
    config: ImportMappingConfig,
  ): Promise<ImportTemplate> {
    requireProfileId(profileId);
    requireId(id);
    return importTemplatesRepo.update(profileId, id, {
      columnMap: config.columnMap,
      dateFormat: config.dateFormat,
      decimalSeparator: config.decimalSeparator,
      thousandSeparator: config.thousandSeparator,
      amountStrategy: config.amountStrategy,
      defaultAccountId: config.defaultAccountId,
      hasHeaderRow: config.hasHeaderRow,
    });
  },

  async renameTemplate(profileId: string, id: string, name: string): Promise<ImportTemplate> {
    requireProfileId(profileId);
    requireId(id);
    const cleanName = name.trim().replace(/\s+/g, ' ');
    assert(cleanName.length > 0, 'La plantilla necesita un nombre.');
    const existing = await importTemplatesRepo.findByName(profileId, cleanName);
    assert(
      existing === undefined || existing.id === id,
      `Ya existe una plantilla con el nombre "${cleanName}".`,
    );
    return importTemplatesRepo.update(profileId, id, { name: cleanName });
  },

  deleteTemplate(profileId: string, id: string): Promise<void> {
    requireProfileId(profileId);
    requireId(id);
    return importTemplatesRepo.remove(profileId, id);
  },

  // Convierte una plantilla guardada en una configuracion aplicable. La cuenta destino se
  // puede sobreescribir (p. ej. si la de la plantilla ya no existe en el perfil).
  templateToConfig(
    template: ImportTemplate,
    overrideAccountId?: string | null,
  ): ImportMappingConfig {
    return {
      columnMap: template.columnMap,
      dateFormat: template.dateFormat,
      decimalSeparator: template.decimalSeparator,
      thousandSeparator: template.thousandSeparator,
      amountStrategy: template.amountStrategy,
      defaultAccountId:
        overrideAccountId !== undefined ? overrideAccountId : template.defaultAccountId,
      hasHeaderRow: template.hasHeaderRow,
    };
  },
};

// Recoge muestras (hasta 20) de una columna, ignorando celdas vacias.
function collectColumnSamples(rows: CellMatrix, index: number | string | null): CellValue[] {
  if (typeof index !== 'number' || index < 0) return [];
  const samples: CellValue[] = [];
  for (const row of rows) {
    const cell = row[index] ?? null;
    if (!isBlankCell(cell)) samples.push(cell);
    if (samples.length >= 20) break;
  }
  return samples;
}

// Lee una columna opcional de texto/fecha/etc. si esta mapeada (indice numerico), o null si
// la columna no se mapeo.
function optionalCellAt(raw: CellValue[], index: number | string | null): CellValue | undefined {
  return typeof index === 'number' && index >= 0 ? cellAt(raw, index) : undefined;
}

// Parsea una fila a un candidato de movimiento o registra sus errores. No lanza: acumula
// los errores en la fila para senalarlos en la previsualizacion (sin errores silenciosos:
// cada problema queda visible fila a fila). Los metadatos bancarios opcionales (fase 5) nunca
// bloquean la fila: si faltan o no se interpretan, quedan en null (ver lib/importParsing.ts).
function buildPreviewRow(
  profileId: string,
  raw: CellValue[],
  rowIndex: number,
  config: ImportMappingConfig,
  format: AmountFormat,
  accountByName: Map<string, string>,
  accountsById: Map<string, Account>,
  defaultAccountId: string,
  parsed: ParsedFile,
): PreviewRow {
  const errors: string[] = [];
  const cm = config.columnMap;

  let date: string | null = null;
  try {
    date = parseDateToIso(cellAt(raw, cm.date), config.dateFormat);
  } catch (e) {
    errors.push(messageOf(e, 'Fecha invalida.'));
  }

  let concept: string | null = null;
  const rawConcept = normalizeImportConcept(cellToString(cellAt(raw, cm.concept)));
  if (rawConcept.length === 0) {
    errors.push('Concepto vacio.');
  } else {
    concept = rawConcept;
  }

  let amountCents: number | null = null;
  try {
    amountCents =
      config.amountStrategy === 'signed'
        ? parseAmountToCents(cellAt(raw, cm.amount), format)
        : parseDebitCreditToCents(cellAt(raw, cm.debit), cellAt(raw, cm.credit), format);
    if (amountCents === 0) {
      errors.push('El importe es cero.');
      amountCents = null;
    }
  } catch (e) {
    errors.push(messageOf(e, 'Importe invalido.'));
  }

  // Cuenta: si hay columna de cuenta mapeada y su texto coincide con una cuenta del perfil,
  // se usa esa; si no, la cuenta destino por defecto. Nunca se crean cuentas nuevas.
  let accountId = defaultAccountId;
  let accountMatchedByName = false;
  let unmatchedAccountName: string | null = null;
  if (cm.account !== null && typeof cm.account === 'number') {
    const accountText = cellToString(cellAt(raw, cm.account)).trim();
    const key = normalizeConcept(accountText);
    const match = accountByName.get(key);
    if (match) {
      accountId = match;
      accountMatchedByName = true;
    } else if (accountText.length > 0) {
      unmatchedAccountName = accountText;
    }
  }

  const categoryText =
    cm.category !== undefined && cm.category !== null
      ? cellToString(cellAt(raw, cm.category)).trim()
      : '';
  const subcategoryText =
    cm.subcategory !== undefined && cm.subcategory !== null
      ? cellToString(cellAt(raw, cm.subcategory)).trim()
      : '';
  const fileCategory =
    categoryText.length > 0
      ? { category: categoryText, subcategory: subcategoryText.length > 0 ? subcategoryText : null }
      : null;
  const excludeText =
    cm.excludeFromStats !== undefined && cm.excludeFromStats !== null
      ? normalizeConcept(cellToString(cellAt(raw, cm.excludeFromStats)))
      : '';
  const excludedFromStats = ['si', 'true', '1', 'x', 'yes', 'verdadero'].includes(excludeText);

  const notes =
    cm.notes !== null && typeof cm.notes === 'number'
      ? nullIfEmpty(cellToString(cellAt(raw, cm.notes)).trim())
      : null;

  // --- Metadatos bancarios opcionales (fase 5, DATA_MODEL 15.1) ---
  const bankTxIdCell = optionalCellAt(raw, cm.bankTransactionId);
  const bankTransactionId = bankTxIdCell !== undefined ? parseOptionalText(bankTxIdCell) : null;

  const bookingDateCell = optionalCellAt(raw, cm.bookingDate);
  const bookingDate =
    bookingDateCell !== undefined ? parseOptionalDate(bookingDateCell, config.dateFormat) : null;

  const valueDateCell = optionalCellAt(raw, cm.valueDate);
  const valueDate =
    valueDateCell !== undefined ? parseOptionalDate(valueDateCell, config.dateFormat) : null;

  const pendingCell = optionalCellAt(raw, cm.pending);
  const pending = pendingCell !== undefined ? parsePendingFlag(pendingCell) : false;

  const merchantCell = optionalCellAt(raw, cm.merchant);
  const bankMerchantHint = merchantCell !== undefined ? parseOptionalText(merchantCell) : null;

  const currencyCell = optionalCellAt(raw, cm.currency);
  const columnCurrency = currencyCell !== undefined ? parseOptionalCurrency(currencyCell) : null;

  const balanceAfterCell = optionalCellAt(raw, cm.balanceAfter);
  const balanceAfterCents =
    balanceAfterCell !== undefined ? parseOptionalAmountCents(balanceAfterCell, format) : null;

  const bankReferenceCell = optionalCellAt(raw, cm.bankReference);
  const bankReference = bankReferenceCell !== undefined ? parseOptionalText(bankReferenceCell) : null;

  const operationTypeCell = optionalCellAt(raw, cm.operationType);
  const operationType = operationTypeCell !== undefined ? parseOptionalText(operationTypeCell) : null;

  const currency = columnCurrency ?? accountsById.get(accountId)?.currency ?? 'EUR';

  let transaction: NewTransaction | null = null;
  if (date !== null && concept !== null && amountCents !== null) {
    const type = amountCents < 0 ? 'expense' : 'income';
    const normalizedConcept = normalizeConceptV1(concept);
    const { exactFingerprint, normalizedFingerprint } = computeFingerprints({
      accountId,
      date,
      amountCents,
      currency,
      normalizedConcept,
      merchantId: null,
    });
    transaction = {
      date,
      amountCents,
      type,
      concept,
      notes,
      accountId,
      categoryId: null,
      subcategoryId: null,
      tagIds: [],
      status: 'cleared',
      categorizedBy: 'import',
      ruleId: null,
      transferGroupId: null,
      parentId: null,
      isSplitParent: false,
      refundOfId: null,
      excludedFromStats,
      importBatchId: null,
      dedupeHash: computeDedupeHash({ profileId, accountId, date, amountCents, concept }),
      // El concepto bancario original es inmutable; el motor de asociacion de comercios
      // (aplicado en importService.commit, junto con las reglas) rellena merchantId despues.
      rawConcept: concept,
      normalizedConcept,
      normalizationVersion: NORMALIZATION_VERSION,
      merchantId: null,
      merchantMatchSource: 'none',
      merchantMatchConfidence: 0,
      bankTransactionId,
      bookingDate,
      valueDate,
      pending,
      currency,
      balanceAfterCents,
      bankReference,
      operationType,
      sourceRowHash: computeSourceRowHash(raw),
      exactFingerprint,
      normalizedFingerprint,
      fingerprintVersion: FINGERPRINT_VERSION,
      sourceFileHash: parsed.sourceFileHash,
      sourceFileSize: parsed.sourceFileSize,
      // El motor de duplicados (buildPreview, segunda pasada) rellena estos campos.
      duplicateStatus: 'unique',
      duplicateConfidence: 0,
      duplicateReasonCodes: [],
      duplicateCandidateIds: [],
      pendingReplacementId: null,
    };
  }

  const status: PreviewRowStatus = errors.length > 0 ? 'error' : 'ok';
  return {
    rowIndex,
    raw,
    transaction,
    displayDate: date,
    displayConcept: concept,
    displayAmountCents: amountCents,
    displayAccountId: transaction ? accountId : null,
    errors,
    bankMerchantHint,
    fileCategory,
    accountMatchedByName,
    unmatchedAccountName,
    duplicateStatus: 'unique',
    duplicateConfidence: 0,
    duplicateReasonCodes: [],
    duplicateDiffs: [],
    duplicateCandidateIds: [],
    availableDecisions: [],
    bestCandidateId: null,
    bestCandidateFingerprint: null,
    decision: null,
    status,
    include: status === 'ok',
  };
}

function cellAt(row: CellValue[], index: number | string | null): CellValue {
  if (typeof index !== 'number' || index < 0) return null;
  return row[index] ?? null;
}

function nullIfEmpty(s: string): string | null {
  return s.length === 0 ? null : s;
}

function messageOf(e: unknown, fallback: string): string {
  return e instanceof ValidationError ? e.message : e instanceof Error ? e.message : fallback;
}

function categoryPathKey(category: string, subcategory: string | null): string {
  return subcategory === null
    ? normalizeConcept(category)
    : `${normalizeConcept(category)} > ${normalizeConcept(subcategory)}`;
}

// Categorias y subcategorias del fichero que no existen en el perfil (para avisar en la
// previsualizacion). Solo cuenta filas que se van a importar.
function missingFileCategories(rows: PreviewRow[], categories: Category[]): string[] {
  const roots = new Map<string, Category>();
  for (const c of categories) if (c.parentId === null && c.archivedAt === null) roots.set(normalizeConcept(c.name), c);
  const missing = new Map<string, string>();
  for (const row of rows) {
    const fc = row.fileCategory;
    if (!fc || row.transaction === null) continue;
    const root = roots.get(normalizeConcept(fc.category));
    if (!root) {
      missing.set(categoryPathKey(fc.category, null), fc.category);
    }
    if (fc.subcategory !== null) {
      const exists =
        root !== undefined &&
        categories.some(
          (c) => c.parentId === root.id && c.archivedAt === null && normalizeConcept(c.name) === normalizeConcept(fc.subcategory as string),
        );
      if (!exists) missing.set(categoryPathKey(fc.category, fc.subcategory), `${fc.category} > ${fc.subcategory}`);
    }
  }
  return [...missing.values()];
}

// Resuelve la categoria del fichero de cada fila a importar, creando lo que falte (una sola
// vez por nombre). Marca categorizedBy='import'. Aislamiento: todo con el profileId recibido.
async function applyFileCategories(
  profileId: string,
  rows: PreviewRow[],
  drafts: NewTransaction[],
): Promise<void> {
  if (!rows.some((r) => r.fileCategory !== null)) return;
  const categories = await categoriesRepo.list(profileId);
  const live = categories.filter((c) => c.archivedAt === null);
  const findRoot = (name: string): Category | undefined =>
    live.find((c) => c.parentId === null && normalizeConcept(c.name) === normalizeConcept(name));
  const findChild = (rootId: string, name: string): Category | undefined =>
    live.find((c) => c.parentId === rootId && normalizeConcept(c.name) === normalizeConcept(name));

  for (let i = 0; i < rows.length; i += 1) {
    const fc = rows[i]!.fileCategory;
    const draft = drafts[i]!;
    if (!fc) continue;
    let root = findRoot(fc.category);
    if (!root) {
      root = await categoryService.createCategory(profileId, {
        name: fc.category,
        kind: draft.amountCents < 0 ? 'expense' : 'both',
      });
      live.push(root);
    }
    let sub: Category | undefined;
    if (fc.subcategory !== null) {
      sub = findChild(root.id, fc.subcategory);
      if (!sub) {
        sub = await categoryService.createCategory(profileId, {
          name: fc.subcategory,
          kind: root.kind,
          parentId: root.id,
        });
        live.push(sub);
      }
    }
    draft.categoryId = root.id;
    draft.subcategoryId = sub?.id ?? null;
    draft.categorizedBy = 'import';
    draft.ruleId = null;
  }
}
