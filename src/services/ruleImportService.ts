// Importacion de reglas de autocategorizacion desde CSV/XLSX. Reutiliza la infraestructura
// de importacion de la fase anterior: el lexer de fichero (importService.parseFile ->
// lib/csvXlsx) y el patron de mapeo de columnas + previsualizacion. Cada fila del fichero
// representa UNA regla con UNA condicion (el caso comun: "si el concepto contiene X ->
// Categoria Y"); es el formato de import mas util y directo. Reglas con varias condiciones se
// crean desde la UI.
//
// Todo el trabajo ocurre en el navegador; ningun dato sale del dispositivo (invariantes 2 y 3
// de CLAUDE.md). Aislamiento por perfil: la resolucion de categorias/subcategorias/etiquetas y
// cuentas por nombre se hace SOLO con las entidades del perfil que recibe el servicio, y el
// commit crea las reglas via ruleService (que exige profileId).
import type {
  Account,
  Category,
  RuleAction,
  RuleCondition,
  RuleConditionField,
  RuleConditionOperator,
  Tag,
  TransactionType,
} from '../db/schema';
import type { CellValue } from '../lib/csvXlsx';
import type { ParsedFile } from './importService';
import { OPERATORS_BY_FIELD, ruleService, type RuleInput } from './ruleService';
import { normalizeConcept } from '../lib/dedupe';
import { eurosToCents } from '../lib/money';
import { ValidationError, isValidAccountingDate, requireProfileId, assert } from '../lib/validation';

// Mapeo de columnas del fichero a los campos de una regla. Los valores son indices de columna
// (0-based) o null si la columna no esta presente. Solo `value` y `category` son obligatorios;
// el resto tiene valores por defecto sensatos.
export interface RuleImportColumnMap {
  name: number | null; // nombre de la regla (si falta, se deriva)
  field: number | null; // campo de la condicion (por defecto 'concept')
  operator: number | null; // operador (por defecto segun el campo)
  value: number | null; // valor de la condicion (obligatorio)
  value2: number | null; // segundo valor (rangos)
  caseSensitive: number | null; // sensible a mayusculas (texto)
  matchMode: number | null; // 'all' | 'any' (por defecto 'all')
  category: number | null; // categoria de la accion, por nombre (obligatorio)
  subcategory: number | null; // subcategoria de la accion, por nombre
  tags: number | null; // etiquetas por nombre, separadas por ; o ,
  excludeFromStats: number | null; // forzar exclusion (booleano)
  priority: number | null; // no se usa en el commit (se respeta el orden de fila); reservado
  enabled: number | null; // activa (por defecto true)
  stopOnMatch: number | null; // detener al casar (por defecto true)
}

export interface RuleImportConfig {
  columnMap: RuleImportColumnMap;
  hasHeaderRow: boolean;
}

// Contexto de resolucion por nombre. Todas las entidades pertenecen al perfil (aislamiento).
export interface RuleImportContext {
  categories: Category[];
  tags: Tag[];
  accounts: Account[];
}

export interface RuleImportRow {
  rowIndex: number;
  raw: CellValue[];
  rule: RuleInput | null; // candidato construido (null si la fila tiene errores)
  displayName: string | null;
  displaySummary: string | null;
  errors: string[];
  status: 'ok' | 'error';
  include: boolean;
}

export interface RuleImportPreview {
  rows: RuleImportRow[];
  summary: { total: number; ok: number; errors: number };
}

// Un mapeo por defecto vacio (todas las columnas sin asignar).
export function emptyRuleColumnMap(): RuleImportColumnMap {
  return {
    name: null,
    field: null,
    operator: null,
    value: null,
    value2: null,
    caseSensitive: null,
    matchMode: null,
    category: null,
    subcategory: null,
    tags: null,
    excludeFromStats: null,
    priority: null,
    enabled: null,
    stopOnMatch: null,
  };
}

// Autodeteccion del mapeo por los nombres de cabecera (sin tildes ni mayusculas). Permite
// importar sin tocar nada un fichero con cabeceras reconocibles, como el que genera la propia
// app o la plantilla de reglas; cualquier columna no reconocida queda sin asignar y la persona
// puede ajustarla a mano. Nunca asigna la misma columna a dos campos.
const HEADER_ALIASES: Record<keyof RuleImportColumnMap, string[]> = {
  name: ['nombre', 'nombre de la regla', 'regla', 'name'],
  field: ['campo', 'field'],
  operator: ['operador', 'operator'],
  value: ['valor', 'valor de la condicion', 'texto', 'palabra clave', 'value', 'keyword'],
  value2: ['segundo valor', 'valor 2', 'value2'],
  caseSensitive: ['sensible a mayusculas', 'case sensitive'],
  matchMode: ['modo', 'match mode'],
  category: ['categoria', 'category'],
  subcategory: ['subcategoria', 'subcategory'],
  tags: ['etiquetas', 'tags'],
  excludeFromStats: ['excluir de estadisticas', 'excluido de estadisticas', 'excluir'],
  priority: ['prioridad', 'priority'],
  enabled: ['activa', 'activo', 'enabled'],
  stopOnMatch: ['detener al casar', 'detener', 'stop on match'],
};

function headerKey(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function guessRuleColumnMap(labels: string[]): RuleImportColumnMap {
  const map = emptyRuleColumnMap();
  const used = new Set<number>();
  const keys = labels.map(headerKey);
  for (const field of Object.keys(HEADER_ALIASES) as (keyof RuleImportColumnMap)[]) {
    const idx = keys.findIndex((k, i) => !used.has(i) && HEADER_ALIASES[field].includes(k));
    if (idx >= 0) {
      map[field] = idx;
      used.add(idx);
    }
  }
  return map;
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

function cellAt(row: CellValue[], index: number | null): CellValue {
  if (index === null || index < 0) return null;
  return row[index] ?? null;
}

function textAt(row: CellValue[], index: number | null): string {
  return cellToString(cellAt(row, index)).trim();
}

// Etiquetas de columna para la UI (cabecera real o "Columna N").
export function ruleColumnLabels(parsed: ParsedFile, hasHeaderRow: boolean): string[] {
  const header = hasHeaderRow ? parsed.rows[0] : undefined;
  return Array.from({ length: parsed.columnCount }, (_, i) => {
    const label = header ? cellToString(header[i] ?? null).trim() : '';
    return label.length > 0 ? label : `Columna ${i + 1}`;
  });
}

// --- Parseo de valores ---

const FIELD_ALIASES: Record<string, RuleConditionField> = {
  concept: 'concept',
  concepto: 'concept',
  texto: 'concept',
  amount: 'amount',
  importe: 'amount',
  cantidad: 'amount',
  date: 'date',
  fecha: 'date',
  account: 'account',
  cuenta: 'account',
  type: 'type',
  tipo: 'type',
};

const OPERATOR_ALIASES: Record<string, RuleConditionOperator> = {
  contains: 'contains',
  contiene: 'contains',
  notcontains: 'notContains',
  nocontiene: 'notContains',
  startswith: 'startsWith',
  empiezapor: 'startsWith',
  endswith: 'endsWith',
  terminaen: 'endsWith',
  equals: 'equals',
  igual: 'equals',
  exacto: 'equals',
  regex: 'regex',
  gt: 'gt',
  mayor: 'gt',
  lt: 'lt',
  menor: 'lt',
  gte: 'gte',
  lte: 'lte',
  eq: 'eq',
  between: 'between',
  rango: 'between',
  before: 'before',
  antes: 'before',
  after: 'after',
  despues: 'after',
};

const TYPE_ALIASES: Record<string, TransactionType> = {
  expense: 'expense',
  gasto: 'expense',
  income: 'income',
  ingreso: 'income',
  transfer: 'transfer',
  transferencia: 'transfer',
};

function parseBoolean(raw: string, fallback: boolean): boolean {
  const n = normalizeConcept(raw);
  if (n === '') return fallback;
  if (['si', 'si ', 'true', '1', 'x', 'y', 'yes', 'verdadero'].includes(n)) return true;
  if (['no', 'false', '0', 'n', 'falso'].includes(n)) return false;
  return fallback;
}

// Convierte un importe en euros escrito en texto a centimos enteros. Acepta ',' o '.' como
// separador decimal y '.' o ',' como separador de miles. No redondea en silencio importes
// con mas de dos decimales que provengan de un error grosero: eurosToCents redondea al centimo
// (el umbral de reglas no requiere la estrictez de dos decimales del import de movimientos).
function parseAmountEurosToCents(raw: string): number {
  const s = raw.trim().replace(/\s/g, '').replace(/€/g, '').replace(/−/g, '-');
  if (s.length === 0) throw new ValidationError('Importe de la condicion vacio.');
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  let normalized = s;
  if (hasComma && hasDot) {
    // El ultimo separador que aparece es el decimal; el otro es de miles.
    normalized = s.lastIndexOf(',') > s.lastIndexOf('.')
      ? s.replace(/\./g, '').replace(',', '.')
      : s.replace(/,/g, '');
  } else if (hasComma) {
    normalized = s.replace(',', '.');
  }
  const num = Number(normalized);
  if (!Number.isFinite(num)) {
    throw new ValidationError(`Importe de condicion no numerico: "${raw}".`);
  }
  return eurosToCents(num);
}

// Resuelve una categoria/subcategoria por nombre (normalizado) dentro del perfil.
function resolveCategoryByName(
  name: string,
  categories: Category[],
  parentId: string | null,
): Category | undefined {
  const target = normalizeConcept(name);
  return categories.find(
    (c) => c.parentId === parentId && normalizeConcept(c.name) === target,
  );
}

function resolveTagsByName(raw: string, tags: Tag[]): { ids: string[]; missing: string[] } {
  const names = raw
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const ids: string[] = [];
  const missing: string[] = [];
  for (const name of names) {
    const target = normalizeConcept(name);
    const found = tags.find((t) => normalizeConcept(t.name) === target);
    if (found) ids.push(found.id);
    else missing.push(name);
  }
  return { ids, missing };
}

// --- Construccion de una regla candidata a partir de una fila ---

function buildRuleFromRow(
  raw: CellValue[],
  rowIndex: number,
  config: RuleImportColumnMap,
  context: RuleImportContext,
): RuleImportRow {
  const errors: string[] = [];

  // Campo de la condicion (por defecto concepto).
  const fieldText = textAt(raw, config.field);
  const field: RuleConditionField =
    fieldText.length > 0 ? FIELD_ALIASES[normalizeConcept(fieldText)] ?? 'concept' : 'concept';
  if (fieldText.length > 0 && FIELD_ALIASES[normalizeConcept(fieldText)] === undefined) {
    errors.push(`Campo de condicion no reconocido: "${fieldText}".`);
  }

  // Operador (por defecto el primero valido del campo).
  const operatorText = textAt(raw, config.operator);
  const defaultOperator = OPERATORS_BY_FIELD[field][0];
  let operator: RuleConditionOperator = defaultOperator;
  if (operatorText.length > 0) {
    const resolved = OPERATOR_ALIASES[normalizeConcept(operatorText)];
    if (resolved && OPERATORS_BY_FIELD[field].includes(resolved)) {
      operator = resolved;
    } else {
      errors.push(`Operador no valido para el campo "${field}": "${operatorText}".`);
    }
  }

  const caseSensitive = parseBoolean(textAt(raw, config.caseSensitive), false);
  const rawValue = textAt(raw, config.value);

  // Valor de la condicion segun el campo.
  let value: string | number = rawValue;
  let value2: string | number | null = null;
  const rawValue2 = textAt(raw, config.value2);
  if (rawValue.length === 0) {
    errors.push('Falta el valor de la condicion.');
  } else {
    try {
      if (field === 'amount') {
        value = parseAmountEurosToCents(rawValue);
        if (operator === 'between') value2 = parseAmountEurosToCents(rawValue2);
      } else if (field === 'date') {
        assert(isValidAccountingDate(rawValue), `Fecha invalida: "${rawValue}" (usa YYYY-MM-DD).`);
        value = rawValue;
        if (operator === 'between') {
          assert(
            isValidAccountingDate(rawValue2),
            `Fecha final invalida: "${rawValue2}" (usa YYYY-MM-DD).`,
          );
          value2 = rawValue2;
        }
      } else if (field === 'account') {
        const target = normalizeConcept(rawValue);
        const acc = context.accounts.find((a) => normalizeConcept(a.name) === target);
        if (!acc) errors.push(`Cuenta no encontrada: "${rawValue}".`);
        else value = acc.id;
      } else if (field === 'type') {
        const resolved = TYPE_ALIASES[normalizeConcept(rawValue)];
        if (!resolved) errors.push(`Tipo de movimiento no reconocido: "${rawValue}".`);
        else value = resolved;
      } else {
        // concept: texto tal cual.
        value = rawValue;
      }
    } catch (e) {
      errors.push(e instanceof ValidationError ? e.message : `Valor invalido: "${rawValue}".`);
    }
  }

  // Accion: categoria (obligatoria salvo que haya etiquetas o exclusion), subcategoria, tags.
  const categoryText = textAt(raw, config.category);
  let setCategoryId: string | null = null;
  let setSubcategoryId: string | null = null;
  if (categoryText.length > 0) {
    const cat = resolveCategoryByName(categoryText, context.categories, null);
    if (!cat) {
      errors.push(`Categoria no encontrada: "${categoryText}".`);
    } else {
      setCategoryId = cat.id;
      const subText = textAt(raw, config.subcategory);
      if (subText.length > 0) {
        const sub = resolveCategoryByName(subText, context.categories, cat.id);
        if (!sub) errors.push(`Subcategoria no encontrada bajo "${categoryText}": "${subText}".`);
        else setSubcategoryId = sub.id;
      }
    }
  }

  const tagsText = textAt(raw, config.tags);
  let addTagIds: string[] = [];
  if (tagsText.length > 0) {
    const { ids, missing } = resolveTagsByName(tagsText, context.tags);
    if (missing.length > 0) errors.push(`Etiquetas no encontradas: ${missing.join(', ')}.`);
    addTagIds = ids;
  }

  const excludeText = textAt(raw, config.excludeFromStats);
  const setExcludedFromStats: boolean | null =
    excludeText.length > 0 ? parseBoolean(excludeText, false) : null;

  // Debe haber al menos una accion.
  if (setCategoryId === null && addTagIds.length === 0 && setExcludedFromStats === null) {
    errors.push('La regla no tiene accion: indica categoria, etiquetas o exclusion.');
  }

  const matchModeText = normalizeConcept(textAt(raw, config.matchMode));
  const matchMode = matchModeText === 'any' || matchModeText === 'cualquiera' ? 'any' : 'all';
  const enabled = parseBoolean(textAt(raw, config.enabled), true);
  const stopOnMatch = parseBoolean(textAt(raw, config.stopOnMatch), true);

  const nameText = textAt(raw, config.name);
  const derivedName =
    nameText.length > 0
      ? nameText
      : `${field} ${operator} ${rawValue}`.trim().slice(0, 60) || `Regla ${rowIndex + 1}`;

  const condition: RuleCondition = { field, operator, value, value2, caseSensitive };
  const action: RuleAction = { setCategoryId, setSubcategoryId, addTagIds, setExcludedFromStats };

  let rule: RuleInput | null = null;
  const summary =
    categoryText.length > 0
      ? `${field} ${operator} "${rawValue}" -> ${categoryText}`
      : `${field} ${operator} "${rawValue}"`;

  if (errors.length === 0) {
    rule = {
      name: derivedName,
      enabled,
      matchMode,
      conditions: [condition],
      action,
      stopOnMatch,
    };
  }

  return {
    rowIndex,
    raw,
    rule,
    displayName: derivedName,
    displaySummary: summary,
    errors,
    status: errors.length > 0 ? 'error' : 'ok',
    include: errors.length === 0,
  };
}

export const ruleImportService = {
  // Construye la previsualizacion de reglas: una fila -> una regla candidata (o errores). No
  // escribe nada. La resolucion por nombre usa solo entidades del perfil (aislamiento).
  buildPreview(
    profileId: string,
    parsed: ParsedFile,
    config: RuleImportConfig,
    context: RuleImportContext,
  ): RuleImportPreview {
    requireProfileId(profileId);
    // Barrera de aislamiento (defensa en profundidad): toda entidad con la que se resuelven
    // nombres (categorias, etiquetas, cuentas) debe pertenecer al perfil. Asi el aislamiento no
    // depende solo de que el llamante haya filtrado bien el contexto.
    assert(
      context.categories.every((c) => c.profileId === profileId) &&
        context.tags.every((t) => t.profileId === profileId) &&
        context.accounts.every((a) => a.profileId === profileId),
      'Se han pasado entidades de otro perfil a la importacion de reglas.',
    );
    assert(config.columnMap.value !== null, 'Falta asignar la columna de valor de la condicion.');
    const dataRows = config.hasHeaderRow ? parsed.rows.slice(1) : parsed.rows;
    const rows = dataRows.map((raw, i) => buildRuleFromRow(raw, i, config.columnMap, context));
    return {
      rows,
      summary: {
        total: rows.length,
        ok: rows.filter((r) => r.status === 'ok').length,
        errors: rows.filter((r) => r.status === 'error').length,
      },
    };
  },

  // Problemas de configuracion (vacio = listo para previsualizar).
  configProblems(config: RuleImportConfig, columnCount: number): string[] {
    const problems: string[] = [];
    const inRange = (v: number | null): boolean => v !== null && v >= 0 && v < columnCount;
    if (!inRange(config.columnMap.value)) {
      problems.push('Falta asignar la columna de valor de la condicion.');
    }
    if (!inRange(config.columnMap.category) && !inRange(config.columnMap.tags)) {
      problems.push('Falta asignar la columna de categoria (o de etiquetas) de la accion.');
    }
    return problems;
  },

  // Crea las reglas incluidas de la previsualizacion. Las reglas se crean en el orden de las
  // filas (ruleService.create asigna prioridades incrementales al final). Devuelve cuantas se
  // crearon. Aislamiento: ruleService exige profileId.
  async commit(profileId: string, preview: RuleImportPreview): Promise<{ created: number }> {
    requireProfileId(profileId);
    const included = preview.rows.filter((r) => r.include && r.rule !== null);
    assert(included.length > 0, 'No hay ninguna regla seleccionada para importar.');
    let created = 0;
    for (const row of included) {
      await ruleService.create(profileId, row.rule as RuleInput);
      created += 1;
    }
    return { created };
  },
};
