// Derivacion criptografica del PIN local (CLOUD_SYNC_SECURITY seccion 9-10, DATA_MODEL 10.2).
// Funciones puras sobre Web Crypto: nunca guardan el PIN, nunca lo registran (sin console.log).
//
// Diseno: PBKDF2-SHA256 (sal aleatoria, iteraciones versionadas) deriva una clave base de la
// que se obtienen, via HMAC-SHA256 con distinto contexto, DOS subclaves independientes:
//   - verificador: se persiste (DeviceSecurity.pinVerifier). Permite comprobar un PIN candidato
//     sin guardar nada equivalente a la clave de cifrado (HMAC es de un solo sentido: conocer el
//     verificador no permite reconstruir la clave de sesion).
//   - clave de cifrado de sesion (AES-GCM-256): NUNCA se persiste, solo vive en memoria mientras
//     la app esta desbloqueada (ver LockContext).
import type { PinKdfParams } from '../db/schema';
import { base64ToBytes, bytesToBase64 } from './base64';

// Parametros versionados del KDF (documentado en DATA_MODEL 10.2 y CLOUD_SYNC_SECURITY 9).
// 210 000 iteraciones PBKDF2-HMAC-SHA256: compromiso entre la recomendacion OWASP 2023 para
// este algoritmo y el coste de desbloqueo en el hilo principal en un movil de gama media.
// Cambiar cualquier valor exige subir `version` (nunca se reinterpreta un verificador existente
// con parametros distintos a los que se guardaron junto a el).
export const KDF_PARAMS_V1: PinKdfParams = {
  version: 1,
  algorithm: 'PBKDF2',
  hash: 'SHA-256',
  iterations: 210_000,
  saltBytes: 16,
  keyBits: 256,
};

const VERIFIER_INFO = 'gestor-gastos:pin-verifier:v1';
const SESSION_KEY_INFO = 'gestor-gastos:session-encryption:v1';

const textEncoder = new TextEncoder();

export interface DerivedPinKeys {
  // Base64. Se persiste en DeviceSecurity.pinVerifier.
  verifier: string;
  // Clave AES-GCM lista para cifrar/descifrar la sesion. Nunca se persiste.
  encryptionKey: CryptoKey;
}

export function generateSalt(params: PinKdfParams = KDF_PARAMS_V1): string {
  const bytes = crypto.getRandomValues(new Uint8Array(params.saltBytes));
  return bytesToBase64(bytes);
}

// Deriva el verificador y la clave de cifrado de sesion a partir de un PIN candidato, su sal y
// sus parametros de KDF. Deterministico: mismo PIN + sal + parametros -> mismo resultado.
export async function derivePinKeys(
  pin: string,
  saltBase64: string,
  params: PinKdfParams = KDF_PARAMS_V1,
): Promise<DerivedPinKeys> {
  const pinKeyMaterial = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(pin),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const saltBytes = base64ToBytes(saltBase64);
  const baseBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: params.hash,
      salt: saltBytes as BufferSource,
      iterations: params.iterations,
    },
    pinKeyMaterial,
    params.keyBits,
  );
  const hmacKey = await crypto.subtle.importKey(
    'raw',
    baseBits,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const verifierBits = await crypto.subtle.sign('HMAC', hmacKey, textEncoder.encode(VERIFIER_INFO));
  const encryptionKeyBits = await crypto.subtle.sign(
    'HMAC',
    hmacKey,
    textEncoder.encode(SESSION_KEY_INFO),
  );
  const encryptionKey = await crypto.subtle.importKey(
    'raw',
    encryptionKeyBits,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  );
  return { verifier: bytesToBase64(new Uint8Array(verifierBits)), encryptionKey };
}

// Comparacion en tiempo constante de dos valores base64 (verificador guardado vs derivado).
// Evita fugas de tiempo triviales; el umbral real de proteccion aqui es el backoff progresivo
// (un atacante ya necesitaria acceso al dispositivo para intentar esto).
export function constantTimeEqual(aBase64: string, bBase64: string): boolean {
  const a = base64ToBytes(aBase64);
  const b = base64ToBytes(bBase64);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}
