// Repositorio de seguridad LOCAL del dispositivo: unico punto que toca las tablas Dexie
// `deviceSecurity`, `encryptedSession` y `webauthnCredentials` (DATA_MODEL seccion 10.2).
// Deliberadamente SIN outbox/sync: estas tablas nunca salen del dispositivo. Nunca se registran
// en `childTables` (src/db/index.ts) ni en `ProfileDataTables`/`backupRepo.ts` (nunca en backup).
import type { DeviceSecurity, EncryptedSessionRow, WebAuthnCredentialRef } from '../db/schema';
import { db, newId, now } from '../db/index';

// Fila unica: la seguridad de PIN/bloqueo es del DISPOSITIVO, no de un perfil (protege el
// acceso a toda la app, independientemente de que perfil este activo).
const DEVICE_SECURITY_ID = 'device';

function defaultDeviceSecurity(): DeviceSecurity {
  const ts = now();
  return {
    id: DEVICE_SECURITY_ID,
    pinEnabled: false,
    pinSalt: null,
    pinVerifier: null,
    pinKdfParams: null,
    pinAttempts: 0,
    pinLockedUntil: null,
    autoLockMs: null,
    passkeysEnabled: false,
    createdAt: ts,
    updatedAt: ts,
  };
}

export const deviceSecurityRepo = {
  async get(): Promise<DeviceSecurity> {
    const existing = await db.deviceSecurity.get(DEVICE_SECURITY_ID);
    return existing ?? defaultDeviceSecurity();
  },

  async put(patch: Partial<Omit<DeviceSecurity, 'id' | 'createdAt'>>): Promise<DeviceSecurity> {
    const current = await deviceSecurityRepo.get();
    const updated: DeviceSecurity = { ...current, ...patch, updatedAt: now() };
    await db.deviceSecurity.put(updated);
    return updated;
  },

  // Vuelve al estado sin PIN (usado al desactivar el PIN o al restablecer datos locales).
  async reset(): Promise<void> {
    await db.deviceSecurity.put(defaultDeviceSecurity());
  },

  // --- Sesion cifrada (una fila por clave de storage que pide el SDK de Supabase Auth) ---

  async getEncryptedSession(key: string): Promise<EncryptedSessionRow | undefined> {
    return db.encryptedSession.get(key);
  },

  async putEncryptedSession(key: string, ivBase64: string, ciphertextBase64: string): Promise<void> {
    await db.encryptedSession.put({ key, ivBase64, ciphertextBase64, updatedAt: now() });
  },

  async removeEncryptedSession(key: string): Promise<void> {
    await db.encryptedSession.delete(key);
  },

  async clearAllEncryptedSessions(): Promise<void> {
    await db.encryptedSession.clear();
  },

  // --- Referencias locales a passkeys ---

  async listWebAuthnCredentials(): Promise<WebAuthnCredentialRef[]> {
    return db.webauthnCredentials.toArray();
  },

  async addWebAuthnCredential(
    credentialId: string,
    friendlyName: string | null,
  ): Promise<WebAuthnCredentialRef> {
    const ref: WebAuthnCredentialRef = {
      id: newId(),
      credentialId,
      friendlyName,
      createdAt: now(),
      lastUsedAt: null,
    };
    await db.webauthnCredentials.add(ref);
    return ref;
  },

  async renameWebAuthnCredential(id: string, friendlyName: string): Promise<void> {
    await db.webauthnCredentials.update(id, { friendlyName });
  },

  async removeWebAuthnCredential(id: string): Promise<void> {
    await db.webauthnCredentials.delete(id);
  },
};

// Vacia TODAS las tablas Dexie (todos los perfiles y estructuras device-local). Ultimo recurso
// de recuperacion cuando se olvida el PIN sin tener cuenta vinculada (CLOUD_SYNC_SECURITY 14:
// "sin cuenta y sin PIN, no hay via de recuperacion salvo restablecer los datos locales"). NO es
// una operacion de rutina: solo la UI de recuperacion la invoca, tras doble confirmacion.
export async function resetAllLocalData(): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
  });
}
