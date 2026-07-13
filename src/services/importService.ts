// Servicio de importacion de movimientos desde CSV/XLSX. Orquesta el lexer de fichero
// (lib/csvXlsx), los parsers de importe/fecha (lib/importParsing), la deteccion de
// duplicados (lib/dedupe + transactionsRepo) y el commit atomico (importBatchesRepo).
// No conoce React. Todo el trabajo ocurre en el navegador; ningun dato sale del dispositivo
// (invariantes 2 y 3 de CLAUDE.md). Aislamiento por perfil: cada operacion exige profileId.
//
// Flujo (ARCHITECTURE.md seccion 5.1):
//   fichero -> parseFile -> suggestConfig (o plantilla) -> buildPreview (marca duplicados)
//   -> el usuario excluye filas -> commit (ImportBatch + Transactions atomico) -> undo.
import type {
  Account,
  AmountStrategy,
  ColumnMap,
  DecimalSeparator,
  ImportBatch,
  ImportTemplate,
  SourceFormat,
  ThousandSeparator,
} from '../db/schema';
import type { NewTransaction } from '../db/transactionsRepo';
import { transactionsRepo } from '../db/transactionsRepo';
import { importBatchesRepo } from '../db/importBatchesRepo';
import { importTemplatesRepo } from '../db/importTemplatesRepo';
import { readImportFile, type CellMatrix, type CellValue } from '../lib/csvXlsx';
import {
  parseAmountToCents,
  parseDateToIso,
  parseDebitCreditToCents,
  detectColumnMapping,
  detectDecimalSeparator,
  detectDateFormat,
  isBlankCell,
  type AmountFormat,
} from '../lib/importParsing';
import { computeDedupeHash, normalizeConcept } from '../lib/dedupe';
import { normalizeConceptV1, NORMALIZATION_VERSION } from '../lib/normalization';
import { ValidationError, requireProfileId, requireId, assert } from '../lib/validation';
import { rulesRepo } from '../db/rulesRepo';
import { applyRulesToDraft } from './ruleService';
import { merchantsRepo } from '../db/merchantsRepo';
import { merchantAliasesRepo } from '../db/merchantAliasesRepo';
import { matchMerchant } from './merchantService';

// Limite de longitud de concepto, coherente con la entrada manual (transactionService).
// Los conceptos de banca pueden ser largos; se truncan en lugar de rechazar la fila.
export const IMPORT_MAX_CONCEPT_LENGTH = 140;

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
  duplicate: boolean;
  duplicateOf: 'existing' | 'batch' | null;
  status: PreviewRowStatus;
  // Seleccion por defecto: se importan las filas correctas que no son duplicadas.
  include: boolean;
}

export interface ImportPreview {
  rows: PreviewRow[];
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

// --- Parseo de fichero y sugerencia de configuracion ---

export const importService = {
  // Lee y parsea el fichero en el navegador. No hay ninguna llamada de red.
  async parseFile(file: File): Promise<ParsedFile> {
    const wb = await readImportFile(file);
    const columnCount = wb.rows.reduce((max, r) => Math.max(max, r.length), 0);
    assert(columnCount > 0, 'El fichero no contiene columnas legibles.');
    assert(wb.rows.length > 0, 'El fichero no contiene filas.');
    return {
      fileName: wb.fileName,
      sourceFormat: wb.sourceFormat,
      rows: wb.rows,
      columnCount,
    };
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
  // detecta posibles duplicados contra los movimientos existentes del perfil y contra las
  // filas anteriores del propio fichero. No escribe nada.
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
    for (const acc of accounts) accountByName.set(normalizeConcept(acc.name), acc.id);

    const format: AmountFormat = {
      decimalSeparator: config.decimalSeparator,
      thousandSeparator: config.thousandSeparator,
    };
    const dataRows = config.hasHeaderRow ? parsed.rows.slice(1) : parsed.rows;

    // Primera pasada: parsear cada fila a un candidato o a errores.
    const rows: PreviewRow[] = dataRows.map((raw, rowIndex) =>
      buildPreviewRow(profileId, raw, rowIndex, config, format, accountByName, config.defaultAccountId!),
    );

    // Segunda pasada: marcar duplicados. Se carga UNA vez el conjunto de dedupeHash ya
    // existentes en el perfil (escaneo de indice, sin consulta por fila: escala a decenas
    // de miles) y se detectan tambien los duplicados internos del propio fichero.
    const existingHashes = await transactionsRepo.collectDedupeHashes(profileId);
    const seenInBatch = new Set<string>();
    for (const row of rows) {
      if (!row.transaction) continue;
      const hash = row.transaction.dedupeHash;
      const existsInDb = existingHashes.has(hash);
      if (seenInBatch.has(hash)) {
        row.duplicate = true;
        row.duplicateOf = 'batch';
      } else if (existsInDb) {
        row.duplicate = true;
        row.duplicateOf = 'existing';
      }
      seenInBatch.add(hash);
      if (row.duplicate) {
        row.status = 'duplicate';
        // Los duplicados no se importan por defecto (el usuario puede reactivarlos).
        row.include = false;
      }
    }

    const summary = {
      total: rows.length,
      ok: rows.filter((r) => r.status === 'ok').length,
      duplicates: rows.filter((r) => r.status === 'duplicate').length,
      errors: rows.filter((r) => r.status === 'error').length,
    };
    return { rows, summary };
  },

  // Commit atomico de la previsualizacion: crea el ImportBatch y los movimientos incluidos
  // en una sola transaccion Dexie (importBatchesRepo.commitBatch). Si falla a mitad, se
  // revierte todo. Registra en cada movimiento su importBatchId (trazabilidad y deshacer).
  async commit(
    profileId: string,
    params: {
      parsed: ParsedFile;
      preview: ImportPreview;
      templateId: string | null;
    },
  ): Promise<{ batch: ImportBatch; imported: number }> {
    requireProfileId(profileId);
    const included = params.preview.rows.filter((r) => r.include && r.transaction !== null);
    assert(included.length > 0, 'No hay ninguna fila seleccionada para importar.');
    const transactions = included.map((r) => r.transaction as NewTransaction);
    // Auto-categorizacion por reglas de los movimientos importados (ARCHITECTURE 5.2): se
    // cargan una vez las reglas activas del perfil y se aplican a cada borrador antes del
    // commit atomico, de modo que quedan categorizados (categorizedBy='rule', ruleId) desde
    // el primer momento y en la misma transaccion. Si no hay reglas, no cambia nada.
    const enabledRules = await rulesRepo.listEnabledByPriority(profileId);
    if (enabledRules.length > 0) {
      for (const draft of transactions) applyRulesToDraft(enabledRules, draft);
    }
    // Asociacion de comercios (fase 4): se cargan una vez los comercios y alias activos del
    // perfil y se aplica el motor a cada borrador antes del commit atomico. Igual que las
    // reglas, nunca sobreescribe una asociacion manual (los borradores de import nunca la
    // llevan) y respeta el orden de asociacion determinista (alias exacto > configurable >
    // sugerencia por similitud > sin comercio).
    const [merchants, aliases] = await Promise.all([
      merchantsRepo.list(profileId),
      merchantAliasesRepo.listEnabledByPriority(profileId),
    ]);
    if (merchants.length > 0 || aliases.length > 0) {
      for (const draft of transactions) {
        const result = matchMerchant(
          { normalizedConcept: draft.normalizedConcept, rawConcept: draft.rawConcept },
          merchants,
          aliases,
        );
        if (result.merchantId !== null) {
          draft.merchantId = result.merchantId;
          draft.merchantMatchSource = result.source;
          draft.merchantMatchConfidence = result.confidence;
        }
      }
    }
    const rowsSkippedDuplicate = params.preview.rows.filter(
      (r) => r.duplicate && !r.include,
    ).length;

    const batch = await importBatchesRepo.commitBatch(
      profileId,
      {
        templateId: params.templateId,
        fileName: params.parsed.fileName,
        rowsTotal: params.preview.summary.total,
        rowsImported: transactions.length,
        rowsSkippedDuplicate,
      },
      transactions,
    );
    return { batch, imported: transactions.length };
  },

  // Deshace un lote completo (borra sus movimientos y marca el lote como deshecho).
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

// Parsea una fila a un candidato de movimiento o registra sus errores. No lanza: acumula
// los errores en la fila para senalarlos en la previsualizacion (sin errores silenciosos:
// cada problema queda visible fila a fila).
function buildPreviewRow(
  profileId: string,
  raw: CellValue[],
  rowIndex: number,
  config: ImportMappingConfig,
  format: AmountFormat,
  accountByName: Map<string, string>,
  defaultAccountId: string,
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
  if (cm.account !== null && typeof cm.account === 'number') {
    const key = normalizeConcept(cellToString(cellAt(raw, cm.account)));
    const match = accountByName.get(key);
    if (match) accountId = match;
  }

  const notes =
    cm.notes !== null && typeof cm.notes === 'number'
      ? nullIfEmpty(cellToString(cellAt(raw, cm.notes)).trim())
      : null;

  let transaction: NewTransaction | null = null;
  if (date !== null && concept !== null && amountCents !== null) {
    const type = amountCents < 0 ? 'expense' : 'income';
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
      excludedFromStats: false,
      importBatchId: null,
      dedupeHash: computeDedupeHash({ profileId, accountId, date, amountCents, concept }),
      // El concepto bancario original es inmutable; el motor de asociacion de comercios
      // (aplicado en importService.commit, junto con las reglas) rellena merchantId despues.
      rawConcept: concept,
      normalizedConcept: normalizeConceptV1(concept),
      normalizationVersion: NORMALIZATION_VERSION,
      merchantId: null,
      merchantMatchSource: 'none',
      merchantMatchConfidence: 0,
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
    duplicate: false,
    duplicateOf: null,
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
