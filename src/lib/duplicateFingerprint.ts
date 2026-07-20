// Huellas y hashes de deteccion avanzada de duplicados (ampliacion, fase 5). Ver DATA_MODEL
// seccion 15 y FINANCIAL_ALGORITHMS seccion 5. Funciones PURAS, deterministas y VERSIONADAS
// (FINGERPRINT_VERSION): cambiar el algoritmo exige incrementar la version (los datos
// existentes conservan la version con la que se generaron; el recalculo es explicito, nunca
// silencioso). Todo hash es local (FNV-1a o SubtleCrypto), sin librerias de red ni
// dependencias externas (invariante 3 de CLAUDE.md): nunca se sube el fichero original para
// calcular su hash, se deriva sobre los bytes ya leidos en el navegador.
export const FINGERPRINT_VERSION = 1;

// FNV-1a de 32 bits (mismo algoritmo que lib/dedupe.ts, deliberadamente independiente: el
// dedupeHash de primer nivel y las huellas versionadas de esta seccion se versionan por
// separado, ver FINANCIAL_ALGORITHMS seccion 4 vs seccion 5).
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function rawCellToString(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

// Separador de control entre celdas: evita colisiones por concatenacion ambigua en el limite
// entre dos celdas (p. ej. ['ab','c'] vs ['a','bc'] sin separador producirian la misma cadena
// "abc" y por tanto el mismo hash).
const CELL_SEPARATOR = String.fromCharCode(31); // Unit Separator (US), improbable en datos bancarios

// Hash exacto de la fila de origen: sobre los valores CRUDOS de la fila (antes de interpretar
// fecha/importe), para detectar re-importaciones literales de la misma fila incluso si cambia
// el algoritmo de parseo. Independiente de la posicion de la fila (una fila que se desplaza
// dentro del fichero sigue dando el mismo hash).
export function computeSourceRowHash(rawValues: unknown[]): string {
  const parts = rawValues.map(rawCellToString);
  return fnv1a(parts.join(CELL_SEPARATOR));
}

// Identidad ESTRICTA de un movimiento: cuenta + fecha + importe + moneda + concepto
// normalizado. Dos filas con el mismo exactFingerprint son, con altisima confianza, el mismo
// movimiento bancario (FINANCIAL_ALGORITHMS 5, nivel "exact").
export function computeExactFingerprint(input: {
  accountId: string;
  date: string;
  amountCents: number;
  currency: string;
  normalizedConcept: string;
}): string {
  return fnv1a(
    [
      'exact',
      input.accountId,
      input.date,
      String(input.amountCents),
      input.currency,
      input.normalizedConcept,
    ].join(CELL_SEPARATOR),
  );
}

// Identidad TOLERANTE: cuenta + importe + moneda + comercio (o concepto normalizado si no hay
// comercio asociado). Deliberadamente SIN fecha: la tolerancia de fecha se aplica aparte,
// acotando una ventana temporal sobre las filas que comparten esta huella (duplicateEngine).
// NUNCA se pone restriccion UNIQUE sobre esta huella (DATA_MODEL 15.1): dos compras reales
// identicas en la misma cuenta son legitimas.
export function computeNormalizedFingerprint(input: {
  accountId: string;
  amountCents: number;
  currency: string;
  merchantId: string | null;
  normalizedConcept: string;
}): string {
  const identity = input.merchantId ?? input.normalizedConcept;
  return fnv1a(
    ['norm', input.accountId, String(input.amountCents), input.currency, identity].join(
      CELL_SEPARATOR,
    ),
  );
}

export interface FingerprintInput {
  accountId: string;
  date: string;
  amountCents: number;
  currency: string;
  normalizedConcept: string;
  merchantId: string | null;
}

export interface ComputedFingerprints {
  exactFingerprint: string;
  normalizedFingerprint: string;
}

// Calcula ambas huellas de golpe a partir de los campos ya conocidos de un movimiento (alta
// manual, transferencia, split o migracion). Conveniencia sobre computeExactFingerprint /
// computeNormalizedFingerprint para no repetir la construccion del input en cada llamador.
export function computeFingerprints(input: FingerprintInput): ComputedFingerprints {
  return {
    exactFingerprint: computeExactFingerprint(input),
    normalizedFingerprint: computeNormalizedFingerprint(input),
  };
}

// sourceRowHash sintetico para movimientos que no vienen de una fila de fichero real (alta
// manual, transferencia, split, migracion de esquema): se deriva de los mismos campos
// nucleo para que siga siendo un hash valido, determinista y comparable, documentando que no
// es un hash de fila bancaria original.
export function computeSyntheticRowHash(input: {
  date: string;
  amountCents: number;
  concept: string;
  accountId: string;
}): string {
  return computeSourceRowHash([input.date, input.amountCents, input.concept, input.accountId]);
}

// Hash del fichero de origen completo (SHA-256 via Web Crypto, offline). Detecta la
// reimportacion del mismo fichero aunque cambie de nombre. Se calcula sobre los bytes que el
// navegador ya cargo en memoria al leer el fichero: en ningun momento se envia el fichero a
// ningun servicio externo para calcularlo.
export async function computeSourceFileHash(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
