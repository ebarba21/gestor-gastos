// Storage de sesion de Supabase Auth, cifrado cuando el PIN esta activo (CLOUD_SYNC_SECURITY
// seccion 10). Implementa la forma estructural de `SupportedStorage` del SDK (getItem/setItem/
// removeItem, async) sin importar el tipo interno de @supabase/auth-js: es un tipo estructural,
// no nominal, y esta forma es la unica que el cliente necesita (ver src/lib/supabase/client.ts).
//
// Modos:
//   - SIN PIN activo: pasa a traves de localStorage, EXACTAMENTE el comportamiento por defecto
//     del SDK (sin cambios respecto a fase 1/2).
//   - CON PIN activo y DESBLOQUEADA (hay clave en memoria): cifra/descifra contra la tabla Dexie
//     `encryptedSession` con AES-GCM.
//   - CON PIN activo y BLOQUEADA (sin clave en memoria): `getItem` devuelve `null` SIN tocar el
//     dato cifrado. Esto evita que el SDK opere una sesion que no puede leer (y de paso corta el
//     auto-refresh en segundo plano mientras esta bloqueada, ver ARCHITECTURE seccion 13).
//
// No hay nunca una copia sin cifrar en otro storage mientras el PIN esta activo: al activar/
// desactivar el PIN, `migratePlainToEncrypted`/`migrateEncryptedToPlain` mueven el valor entre
// storages y BORRAN el origen en el mismo paso (ver pinService.ts).
import { deviceSecurityRepo } from './deviceSecurityRepo';
import { base64ToBytes, bytesToBase64 } from './base64';

export interface AuthStorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

// Claves de storage que el SDK ha pedido alguna vez en esta sesion de la app. Se usa SOLO para
// la migracion plano<->cifrado: no hace falta adivinar el formato interno de la clave de
// Supabase (p. ej. `sb-<ref>-auth-token`), basta con observar que claves pide el propio SDK.
const seenKeys = new Set<string>();

let pinActive = false;
let sessionKey: CryptoKey | null = null;
let lastDecryptFailed = false;

// --- Control de modo/clave, invocado exclusivamente por pinService.ts ---

export function setPinActive(active: boolean): void {
  pinActive = active;
}

export function setSessionKey(key: CryptoKey | null): void {
  sessionKey = key;
}

export function isUnlocked(): boolean {
  return sessionKey !== null;
}

export function getSeenStorageKeys(): string[] {
  return [...seenKeys];
}

// Se consulta tras un intento de desbloqueo: si el PIN verifico correctamente pero la sesion
// guardada no se pudo descifrar (dato corrupto), se debe informar explicitamente en vez de
// tratarlo como "sin sesion" (CLOUD_SYNC_SECURITY seccion 10: "nunca se degrada a texto plano").
export function consumeDecryptFailure(): boolean {
  const failed = lastDecryptFailed;
  lastDecryptFailed = false;
  return failed;
}

export function __resetForTests(): void {
  seenKeys.clear();
  pinActive = false;
  sessionKey = null;
  lastDecryptFailed = false;
}

// --- Adaptador que consume el SDK de Supabase Auth ---

export const encryptedSessionStorage: AuthStorageAdapter = {
  async getItem(key) {
    seenKeys.add(key);
    if (!pinActive) return safeLocalStorageGet(key);
    if (!sessionKey) return null; // Bloqueada: no se toca el dato cifrado.
    const row = await deviceSecurityRepo.getEncryptedSession(key);
    if (!row) return null;
    try {
      return await decryptString(sessionKey, row.ivBase64, row.ciphertextBase64);
    } catch {
      lastDecryptFailed = true;
      return null;
    }
  },

  async setItem(key, value) {
    seenKeys.add(key);
    if (!pinActive) {
      safeLocalStorageSet(key, value);
      return;
    }
    // Sin clave (bloqueada): normalmente no ocurre, porque getItem ya devolvio null y el SDK no
    // deberia tener una sesion viva que refrescar. Excepcion posible: un refresh de token en
    // vuelo justo cuando se bloquea. En ese caso se descarta esta escritura en vez de arriesgar
    // texto plano o lanzar dentro del storage del SDK; no es una perdida de datos: el proximo
    // desbloqueo sigue teniendo la sesion (pre-refresh) cifrada, y el SDK volvera a refrescarla.
    if (!sessionKey) return;
    const { ivBase64, ciphertextBase64 } = await encryptString(sessionKey, value);
    await deviceSecurityRepo.putEncryptedSession(key, ivBase64, ciphertextBase64);
  },

  async removeItem(key) {
    seenKeys.add(key);
    if (!pinActive) {
      safeLocalStorageRemove(key);
      return;
    }
    await deviceSecurityRepo.removeEncryptedSession(key);
  },
};

// --- Migracion plano <-> cifrado (usada por pinService al activar/desactivar el PIN) ---

export async function migratePlainToEncrypted(key: CryptoKey): Promise<void> {
  for (const storageKey of seenKeys) {
    const value = safeLocalStorageGet(storageKey);
    if (value == null) continue;
    const { ivBase64, ciphertextBase64 } = await encryptString(key, value);
    await deviceSecurityRepo.putEncryptedSession(storageKey, ivBase64, ciphertextBase64);
    safeLocalStorageRemove(storageKey);
  }
}

export async function migrateEncryptedToPlain(key: CryptoKey): Promise<void> {
  for (const storageKey of seenKeys) {
    const row = await deviceSecurityRepo.getEncryptedSession(storageKey);
    if (!row) continue;
    const value = await decryptString(key, row.ivBase64, row.ciphertextBase64);
    safeLocalStorageSet(storageKey, value);
    await deviceSecurityRepo.removeEncryptedSession(storageKey);
  }
}

// Re-cifra todas las filas cifradas conocidas bajo una clave nueva (cambio de PIN). A
// diferencia de migrar plano<->cifrado, esto NUNCA pasa por localStorage: descifra con la
// clave antigua y cifra con la nueva directamente, sin dejar ninguna copia intermedia sin
// cifrar en ningun storage (ni siquiera transitoriamente).
export async function reencryptAllSessions(oldKey: CryptoKey, newKey: CryptoKey): Promise<void> {
  for (const storageKey of seenKeys) {
    const row = await deviceSecurityRepo.getEncryptedSession(storageKey);
    if (!row) continue;
    const value = await decryptString(oldKey, row.ivBase64, row.ciphertextBase64);
    const { ivBase64, ciphertextBase64 } = await encryptString(newKey, value);
    await deviceSecurityRepo.putEncryptedSession(storageKey, ivBase64, ciphertextBase64);
  }
}

// --- Cifrado AES-GCM sobre un string (IV aleatorio de 12 bytes por operacion) ---

async function encryptString(
  key: CryptoKey,
  plaintext: string,
): Promise<{ ivBase64: string; ciphertextBase64: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    new TextEncoder().encode(plaintext),
  );
  return { ivBase64: bytesToBase64(iv), ciphertextBase64: bytesToBase64(new Uint8Array(ciphertext)) };
}

async function decryptString(key: CryptoKey, ivBase64: string, ciphertextBase64: string): Promise<string> {
  const iv = base64ToBytes(ivBase64);
  const ciphertext = base64ToBytes(ciphertextBase64);
  const plainBits = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    ciphertext as BufferSource,
  );
  return new TextDecoder().decode(plainBits);
}

// --- localStorage con manejo explicito de fallos (modo privado, cuota, etc.) ---

function safeLocalStorageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalStorageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Sin storage disponible (modo privado/cuota): se ignora, igual que el resto de la app
    // (ver SyncContext.writeLastSynced). No es un dato financiero critico.
  }
}

function safeLocalStorageRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Ver nota anterior.
  }
}
