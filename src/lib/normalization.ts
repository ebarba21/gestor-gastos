// Normalizacion de conceptos y alias de comercio (DATA_MODEL seccion 14, FINANCIAL_ALGORITHMS
// seccion 20: normalizationVersion). Funcion PURA, determinista y VERSIONADA: cambiar el
// algoritmo exige incrementar NORMALIZATION_VERSION (los datos existentes conservan la
// version con la que se generaron; el recalculo es explicito, nunca silencioso).
//
// Objetivo: comparar conceptos bancarios de forma tolerante (mayusculas, acentos, espacios,
// signos) sin inventar coincidencias entre comercios distintos. Distinto de `normalizeConcept`
// de lib/dedupe.ts (que solo colapsa espacios/mayusculas/acentos para el hash de duplicados):
// esta version ademas retira signos de puntuacion y una referencia variable final SEGURA
// (p. ej. el codigo de autorizacion "*1234" que anaden los procesadores de pago), sin borrar
// digitos de forma indiscriminada en ningun otro contexto.
export const NORMALIZATION_VERSION = 1;

// Marcas diacriticas combinantes que deja la descomposicion NFD (acentos, tildes, etc.).
const DIACRITICS = /[̀-ͯ]/g;

// Sufijo de referencia variable seguro de eliminar: un asterisco seguido SOLO de caracteres
// alfanumericos hasta el final del texto (p. ej. "Amazon.es*1234", "COMERCIO*AB12CD"). Se
// elimina porque es un patron especifico y bien definido (codigo de autorizacion/pedido
// pegado al final tras un separador explicito), no una eliminacion generica de digitos: un
// numero en medio del concepto ("Netflix 2024", "Canal 365") nunca se toca.
const TRAILING_VARIABLE_REF = /\*[A-Za-z0-9]+$/;

function stripTrailingVariableReference(raw: string): string {
  return raw.replace(TRAILING_VARIABLE_REF, '');
}

// Normaliza un concepto (o un alias) para comparacion tolerante: quita la referencia variable
// final si la hay, descompone Unicode y retira diacriticos, pasa a minusculas, sustituye
// cualquier signo/simbolo (todo lo que no sea letra, digito o espacio) por un espacio, y
// colapsa/recorta espacios. Siempre produce el mismo resultado para la misma entrada.
export function normalizeConceptV1(concept: string): string {
  const source = concept ?? '';
  const withoutVariableRef = stripTrailingVariableReference(source);
  const withoutDiacritics = withoutVariableRef.normalize('NFD').replace(DIACRITICS, '');
  const lowered = withoutDiacritics.toLowerCase();
  // Unicode-aware: conserva letras y digitos de cualquier idioma; el resto (puntuacion,
  // simbolos) se convierte en espacio para no pegar palabras entre si.
  const lettersDigitsSpaces = lowered.replace(/[^\p{L}\p{N} ]+/gu, ' ');
  return lettersDigitsSpaces.trim().replace(/\s+/g, ' ');
}
