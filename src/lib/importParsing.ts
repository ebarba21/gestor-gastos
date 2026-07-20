// Parseo estricto de importes y fechas de extractos bancarios, y deteccion automatica de
// columnas. Logica pura y determinista (sin acceso a datos ni red), de test obligatorio
// (ARCHITECTURE.md seccion 11). Los importes se normalizan SIEMPRE a centimos enteros;
// nunca floats para dinero (invariante CLAUDE.md y DATA_MODEL seccion 1).
import type {
  AmountStrategy,
  ColumnMap,
  DecimalSeparator,
  ThousandSeparator,
} from '../db/schema';
import { ValidationError, isValidAccountingDate } from './validation';
import { normalizeConcept } from './dedupe';
import type { CellValue } from './csvXlsx';

// Configuracion de formato numerico de un fichero.
export interface AmountFormat {
  decimalSeparator: DecimalSeparator;
  thousandSeparator: ThousandSeparator;
}

// Una celda esta "vacia" si es null, o string en blanco. Los ceros numericos NO son vacios.
export function isBlankCell(value: CellValue): boolean {
  if (value === null) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  return false;
}

// --- Importes ---

// Parsea un importe a centimos enteros con signo. Soporta:
//  - celdas numericas de XLSX (ya en unidades de moneda): 12.34 -> 1234.
//  - texto con separador decimal ',' o '.' y separador de miles configurable.
//  - signo negativo por '-' inicial/final o por parentesis contables "(12,34)".
//  - simbolos de moneda y espacios (incluido el espacio fino de miles), que se ignoran.
// Lanza ValidationError si el valor no representa un numero. El signo es responsabilidad
// de quien llama para decidir el 'type'; aqui se respeta el signo textual del importe.
export function parseAmountToCents(value: CellValue, format: AmountFormat): number {
  if (isBlankCell(value)) {
    throw new ValidationError('Importe vacio.');
  }
  if (value instanceof Date) {
    throw new ValidationError('Se esperaba un importe pero la celda es una fecha.');
  }
  if (typeof value === 'boolean') {
    throw new ValidationError('Se esperaba un importe pero la celda es un booleano.');
  }
  // Celda numerica de XLSX: ya viene en unidades de moneda (euros), no en texto. Los
  // separadores configurados aplican solo al texto, por eso aqui no intervienen.
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new ValidationError('Importe numerico no finito.');
    }
    return centsFromEuros(value, value);
  }

  // Aqui value solo puede ser string (los demas tipos ya han retornado o lanzado).
  if (typeof value !== 'string') {
    throw new ValidationError('Importe no reconocido.');
  }
  // Normaliza el signo menos Unicode (U+2212) al ASCII antes de analizar.
  let str = value.trim().replace(/−/g, '-');
  // Signo por parentesis contables: (1.234,56) es negativo.
  let negative = false;
  if (/^\(.*\)$/.test(str)) {
    negative = true;
    str = str.slice(1, -1);
  }
  // Signo explicito en cualquier posicion (algunos bancos lo ponen al final).
  if (str.includes('-')) negative = true;

  // Deja solo digitos y los separadores conocidos. Elimina simbolos de moneda, letras,
  // signos y espacios (incluido el espacio fino U+00A0 usado como separador de miles).
  const cleaned = str.replace(/[^0-9.,]/g, '');
  if (cleaned.length === 0) {
    throw new ValidationError(`Importe no numerico: "${value}".`);
  }

  const normalized = normalizeDecimalString(cleaned, format.decimalSeparator);
  const num = Number(normalized);
  if (!Number.isFinite(num)) {
    throw new ValidationError(`Importe no numerico: "${value}".`);
  }
  const cents = centsFromEuros(Math.abs(num), value);
  return negative ? -cents : cents;
}

// Convierte euros (numero) a centimos enteros exigiendo como maximo 2 decimales. Si el
// importe tiene mas de dos decimales significativos, NO se redondea en silencio: se lanza
// ValidationError (sin errores silenciosos, invariante CLAUDE.md). Asi un separador decimal
// mal configurado (que deja p. ej. "1.23456") se convierte en un error visible fila a fila
// en la previsualizacion, en vez de un importe erroneo. La tolerancia 1e-6 absorbe el ruido
// IEEE-754 de valores legitimos de 2 decimales (19,99 -> 1998.9999... -> 1999).
function centsFromEuros(euros: number, original: CellValue): number {
  const scaled = euros * 100;
  const rounded = Math.round(scaled);
  if (Math.abs(scaled - rounded) > 1e-6) {
    throw new ValidationError(`El importe tiene mas de dos decimales: "${String(original)}".`);
  }
  return rounded;
}

// Convierte un string ya limpio (solo digitos y separadores) a notacion con punto decimal
// apto para Number(). El separador que NO es el decimal solo puede ser agrupador de miles,
// asi que se elimina siempre (haya o no separador de miles declarado en la plantilla). Si
// quedan varios separadores decimales, los previos se tratan como agrupadores.
function normalizeDecimalString(cleaned: string, decimal: DecimalSeparator): string {
  const grouping = decimal === ',' ? '.' : ',';
  let out = cleaned.split(grouping).join('');
  const parts = out.split(decimal);
  if (parts.length > 1) {
    const dec = parts.pop() as string;
    out = parts.join('') + '.' + dec;
  }
  return out;
}

// Parsea un importe a partir de dos columnas separadas de cargo (debito, gasto) y abono
// (credito, ingreso). El debito produce un importe negativo; el abono, positivo. El signo lo
// fija SIEMPRE la columna (cargo=negativo, abono=positivo): un signo presente en la propia
// celda se descarta con Math.abs. Una y solo una de las dos debe traer valor distinto de cero.
export function parseDebitCreditToCents(
  debit: CellValue,
  credit: CellValue,
  format: AmountFormat,
): number {
  const hasDebit = !isBlankCell(debit);
  const hasCredit = !isBlankCell(credit);
  const debitCents = hasDebit ? Math.abs(parseAmountToCents(debit, format)) : 0;
  const creditCents = hasCredit ? Math.abs(parseAmountToCents(credit, format)) : 0;

  if (debitCents !== 0 && creditCents !== 0) {
    throw new ValidationError('La fila tiene importe en cargo y abono a la vez.');
  }
  if (debitCents !== 0) return -debitCents;
  if (creditCents !== 0) return creditCents;
  throw new ValidationError('La fila no tiene importe en cargo ni en abono.');
}

// --- Fechas ---

// Deriva el orden de los campos (dia, mes, anio) de un formato como 'dd/MM/yyyy'.
function fieldOrder(dateFormat: string): ('d' | 'M' | 'y')[] {
  const tokens = dateFormat.match(/y+|M+|d+/g) ?? [];
  return tokens.map((t) => t[0] as 'd' | 'M' | 'y');
}

// Formatea componentes numericos a YYYY-MM-DD (con relleno de ceros).
function toIso(year: number, month: number, day: number): string {
  const y = String(year).padStart(4, '0');
  const m = String(month).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Convierte un numero de serie de fecha de Excel a YYYY-MM-DD. Epoch de Excel: 1899-12-30
// (incluye el bug historico del anio bisiesto 1900). Se calcula en UTC para evitar desfases.
function excelSerialToIso(serial: number): string {
  const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);
  // Se trunca (floor) la parte fraccionaria: un serial de fecha-hora (p. ej. 46037.75)
  // representa un dia con hora; la fecha contable es ese dia, no el siguiente.
  const ms = EXCEL_EPOCH_UTC + Math.floor(serial) * 86400000;
  const dt = new Date(ms);
  return toIso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

// Parsea una celda de fecha a fecha contable YYYY-MM-DD. Soporta:
//  - objetos Date (celdas de fecha de XLSX): se toman sus componentes locales.
//  - numeros (serie de fecha de Excel).
//  - texto con formato configurable (dd/MM/yyyy, d/M/yy, yyyy-MM-dd, dd.MM.yyyy, ...): se
//    extraen los numeros en orden segun el formato, tolerando 1 o 2 digitos y cualquier
//    separador. Un anio de 2 digitos se interpreta como 20xx.
// Lanza ValidationError si no se obtiene una fecha de calendario valida.
export function parseDateToIso(value: CellValue, dateFormat: string): string {
  if (isBlankCell(value)) {
    throw new ValidationError('Fecha vacia.');
  }
  if (value instanceof Date) {
    const iso = toIso(value.getFullYear(), value.getMonth() + 1, value.getDate());
    assertIso(iso, value);
    return iso;
  }
  if (typeof value === 'number') {
    const iso = excelSerialToIso(value);
    assertIso(iso, value);
    return iso;
  }
  if (typeof value !== 'string') {
    throw new ValidationError('Se esperaba una fecha en texto.');
  }

  const nums = value.match(/\d+/g);
  const order = fieldOrder(dateFormat);
  if (!nums || nums.length < order.length || order.length < 3) {
    throw new ValidationError(`Fecha no reconocida: "${value}" (formato ${dateFormat}).`);
  }
  let day = 0;
  let month = 0;
  let year = 0;
  order.forEach((field, i) => {
    const n = Number(nums[i]);
    if (field === 'd') day = n;
    else if (field === 'M') month = n;
    else year = n;
  });
  if (year < 100) year += 2000;
  const iso = toIso(year, month, day);
  assertIso(iso, value);
  return iso;
}

function assertIso(iso: string, original: CellValue): void {
  if (!isValidAccountingDate(iso)) {
    throw new ValidationError(`Fecha invalida "${String(original)}" -> "${iso}".`);
  }
}

// --- Metadatos bancarios opcionales (fase 5) ---
//
// A diferencia de fecha/concepto/importe (obligatorios: un fallo bloquea la fila), estos
// campos son metadatos SUPLEMENTARIOS: si la celda esta vacia o no se puede interpretar, el
// campo queda en null sin bloquear la fila ni marcarla como error (serian falsos positivos
// que impedirian importar movimientos legitimos por un dato accesorio mal formado).

// Texto libre opcional: recorta espacios; cadena vacia -> null.
export function parseOptionalText(value: CellValue): string | null {
  if (isBlankCell(value)) return null;
  const text = value instanceof Date ? '' : String(value).trim();
  return text.length > 0 ? text : null;
}

// Fecha opcional (fecha contable/valor): igual que parseDateToIso pero nunca lanza. Vacia o
// no interpretable -> null.
export function parseOptionalDate(value: CellValue, dateFormat: string): string | null {
  if (isBlankCell(value)) return null;
  try {
    return parseDateToIso(value, dateFormat);
  } catch {
    return null;
  }
}

// Importe opcional (p. ej. saldo posterior): igual que parseAmountToCents pero nunca lanza.
export function parseOptionalAmountCents(value: CellValue, format: AmountFormat): number | null {
  if (isBlankCell(value)) return null;
  try {
    return parseAmountToCents(value, format);
  } catch {
    return null;
  }
}

// Palabras que, en la columna de "pendiente", indican una operacion NO confirmada. Se compara
// contra el texto ya normalizado (minusculas, sin acentos).
const PENDING_WORDS = new Set([
  'pendiente',
  'pending',
  'no confirmado',
  'sin confirmar',
  'provisional',
  'p',
  'si',
  'sí',
  'yes',
  'true',
  '1',
]);

// Interpreta la columna "pendiente" como booleano. Vacia o no reconocida -> false (confirmado
// por defecto, coherente con el valor por defecto de altas manuales).
export function parsePendingFlag(value: CellValue): boolean {
  if (isBlankCell(value)) return false;
  if (typeof value === 'boolean') return value;
  const text = String(value).trim().toLowerCase();
  return PENDING_WORDS.has(text);
}

// Codigo de moneda opcional (ISO 4217, 3 letras). Texto no reconocible -> null (el llamante
// aplica un valor por defecto, p. ej. la moneda de la cuenta destino).
export function parseOptionalCurrency(value: CellValue): string | null {
  const text = parseOptionalText(value);
  if (text === null) return null;
  const code = text.toUpperCase().replace(/[^A-Z]/g, '');
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

// --- Deteccion automatica de columnas y formato (sugerencia editable) ---

// Palabras clave por campo interno (normalizadas: minusculas, sin acentos).
const FIELD_KEYWORDS: Record<keyof ColumnMap, string[]> = {
  date: ['fecha', 'date', 'f valor', 'fecha valor', 'fecha operacion', 'f operacion'],
  concept: ['concepto', 'descripcion', 'description', 'detalle', 'movimiento', 'referencia'],
  amount: ['importe', 'amount', 'cantidad', 'monto', 'euros', 'saldo importe'],
  debit: ['cargo', 'debe', 'adeudo', 'debito', 'gasto', 'salida', 'pago'],
  credit: ['abono', 'haber', 'credito', 'ingreso', 'entrada', 'cobro'],
  account: ['cuenta', 'account', 'tarjeta', 'iban'],
  notes: ['nota', 'notas', 'observaciones', 'observacion', 'comentario'],
  // --- Ampliacion fase 5: metadatos bancarios opcionales ---
  bankTransactionId: [
    'id operacion',
    'id de operacion',
    'identificador operacion',
    'transaction id',
    'numero operacion',
    'num operacion',
  ],
  bookingDate: ['fecha contable', 'f contable', 'booking date'],
  valueDate: ['fecha valor operacion', 'value date'],
  pending: ['pendiente', 'estado operacion', 'status'],
  merchant: ['comercio', 'merchant', 'beneficiario', 'payee'],
  currency: ['moneda', 'currency', 'divisa'],
  balanceAfter: ['saldo', 'balance', 'saldo posterior', 'saldo disponible', 'saldo despues'],
  bankReference: ['referencia bancaria', 'ref bancaria', 'numero referencia'],
  operationType: ['tipo operacion', 'tipo de operacion', 'operation type', 'tipo movimiento'],
};

// Orden de campos a resolver. amount y debit/credit son excluyentes (segun la estrategia). Los
// campos obligatorios van primero; los metadatos opcionales de fase 5 al final para no
// competir por una columna con los campos nucleo si hay ambiguedad.
const DETECT_ORDER: (keyof ColumnMap)[] = [
  'date',
  'debit',
  'credit',
  'amount',
  'concept',
  'account',
  'notes',
  'bankTransactionId',
  'bookingDate',
  'valueDate',
  'pending',
  'merchant',
  'currency',
  'balanceAfter',
  'bankReference',
  'operationType',
];

export interface DetectedMapping {
  columnMap: ColumnMap;
  amountStrategy: AmountStrategy;
}

// Sugiere un mapeo de columnas a partir de las cabeceras. Devuelve indices de columna.
// Si detecta columnas de cargo y abono, propone estrategia 'debitCredit'; si detecta una
// columna de importe con signo, 'signed'. Los campos no reconocidos quedan sin asignar.
export function detectColumnMapping(headers: string[]): DetectedMapping {
  const normalized = headers.map((h) => normalizeConcept(h ?? ''));
  const used = new Set<number>();
  const found: Partial<Record<keyof ColumnMap, number>> = {};

  for (const field of DETECT_ORDER) {
    const keywords = FIELD_KEYWORDS[field];
    let bestIndex = -1;
    let bestScore = 0;
    normalized.forEach((header, index) => {
      if (used.has(index) || header.length === 0) return;
      for (const kw of keywords) {
        // Coincidencia exacta puntua mas que contencion, para preferir "fecha" sobre
        // "fecha valor" cuando ambas existen, etc.
        const score = header === kw ? 3 : header.includes(kw) ? 2 : 0;
        if (score > bestScore) {
          bestScore = score;
          bestIndex = index;
        }
      }
    });
    if (bestIndex >= 0) {
      found[field] = bestIndex;
      used.add(bestIndex);
    }
  }

  const hasDebitCredit = found.debit !== undefined || found.credit !== undefined;
  const amountStrategy: AmountStrategy = hasDebitCredit ? 'debitCredit' : 'signed';

  const columnMap: ColumnMap = {
    date: found.date ?? 0,
    concept: found.concept ?? 0,
    amount: amountStrategy === 'signed' ? found.amount ?? null : null,
    debit: amountStrategy === 'debitCredit' ? found.debit ?? null : null,
    credit: amountStrategy === 'debitCredit' ? found.credit ?? null : null,
    account: found.account ?? null,
    notes: found.notes ?? null,
    bankTransactionId: found.bankTransactionId ?? null,
    bookingDate: found.bookingDate ?? null,
    valueDate: found.valueDate ?? null,
    pending: found.pending ?? null,
    merchant: found.merchant ?? null,
    currency: found.currency ?? null,
    balanceAfter: found.balanceAfter ?? null,
    bankReference: found.bankReference ?? null,
    operationType: found.operationType ?? null,
  };

  return { columnMap, amountStrategy };
}

// Detecta el separador decimal a partir de una muestra de importes en texto. Si algun
// valor tiene una coma seguida de 1-2 digitos al final, se asume decimal ','. Por defecto
// ',' (convencion espanola).
export function detectDecimalSeparator(samples: CellValue[]): DecimalSeparator {
  for (const s of samples) {
    if (typeof s !== 'string') continue;
    const t = s.trim();
    // Decimal por punto: "1234.56" o "1,234.56" (coma como miles).
    if (/^-?\(?\d{1,3}(,\d{3})*(\.\d{1,2})\)?$/.test(t) || /^-?\d+\.\d{1,2}$/.test(t)) {
      return '.';
    }
  }
  return ',';
}

// Detecta el formato de fecha a partir de una muestra de valores en texto.
export function detectDateFormat(samples: CellValue[]): string {
  for (const s of samples) {
    if (typeof s !== 'string') continue;
    const t = s.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(t)) return 'yyyy-MM-dd';
    if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(t)) return 'dd/MM/yyyy';
    if (/^\d{1,2}\/\d{1,2}\/\d{2}\b/.test(t)) return 'dd/MM/yy';
    if (/^\d{1,2}-\d{1,2}-\d{4}/.test(t)) return 'dd-MM-yyyy';
    if (/^\d{1,2}\.\d{1,2}\.\d{4}/.test(t)) return 'dd.MM.yyyy';
  }
  return 'dd/MM/yyyy';
}
