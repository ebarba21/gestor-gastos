import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/index';
import { derivePinKeys, generateSalt } from './pinCrypto';
import {
  __resetForTests,
  consumeDecryptFailure,
  encryptedSessionStorage,
  isUnlocked,
  migrateEncryptedToPlain,
  migratePlainToEncrypted,
  reencryptAllSessions,
  setPinActive,
  setSessionKey,
} from './encryptedSessionStorage';

const STORAGE_KEY = 'sb-fake-project-auth-token';
const SESSION_JSON = JSON.stringify({ access_token: 'abc', refresh_token: 'def' });

async function makeKey(pin = '123456'): Promise<CryptoKey> {
  const salt = generateSalt();
  const { encryptionKey } = await derivePinKeys(pin, salt);
  return encryptionKey;
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  localStorage.clear();
  __resetForTests();
});

afterEach(() => {
  __resetForTests();
  localStorage.clear();
});

describe('encryptedSessionStorage — sin PIN activo (passthrough)', () => {
  it('usa localStorage directamente, sin tocar Dexie', async () => {
    await encryptedSessionStorage.setItem(STORAGE_KEY, SESSION_JSON);
    expect(localStorage.getItem(STORAGE_KEY)).toEqual(SESSION_JSON);
    expect(await db.encryptedSession.get(STORAGE_KEY)).toBeUndefined();

    const read = await encryptedSessionStorage.getItem(STORAGE_KEY);
    expect(read).toEqual(SESSION_JSON);

    await encryptedSessionStorage.removeItem(STORAGE_KEY);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});

describe('encryptedSessionStorage — con PIN activo', () => {
  it('cifra en Dexie y nunca deja una copia en claro en localStorage', async () => {
    const key = await makeKey();
    setPinActive(true);
    setSessionKey(key);

    await encryptedSessionStorage.setItem(STORAGE_KEY, SESSION_JSON);

    // Requisito critico: sin copia sin cifrar en otro storage.
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    const row = await db.encryptedSession.get(STORAGE_KEY);
    expect(row).toBeDefined();
    expect(row?.ciphertextBase64).not.toContain('access_token');

    const read = await encryptedSessionStorage.getItem(STORAGE_KEY);
    expect(read).toEqual(SESSION_JSON);
  });

  it('getItem devuelve null cuando esta bloqueada (sin clave en memoria), sin tocar el dato', async () => {
    const key = await makeKey();
    setPinActive(true);
    setSessionKey(key);
    await encryptedSessionStorage.setItem(STORAGE_KEY, SESSION_JSON);

    // Se bloquea: se elimina la clave de memoria.
    setSessionKey(null);
    expect(isUnlocked()).toBe(false);
    const readWhileLocked = await encryptedSessionStorage.getItem(STORAGE_KEY);
    expect(readWhileLocked).toBeNull();

    // El dato cifrado sigue intacto: al desbloquear con la misma clave, se lee bien.
    setSessionKey(key);
    const readAfterUnlock = await encryptedSessionStorage.getItem(STORAGE_KEY);
    expect(readAfterUnlock).toEqual(SESSION_JSON);
  });

  it('un error de descifrado (clave incorrecta) se trata explicitamente, sin degradar a texto plano', async () => {
    const key = await makeKey('123456');
    const wrongKey = await makeKey('654321');
    setPinActive(true);
    setSessionKey(key);
    await encryptedSessionStorage.setItem(STORAGE_KEY, SESSION_JSON);

    setSessionKey(wrongKey);
    const read = await encryptedSessionStorage.getItem(STORAGE_KEY);
    expect(read).toBeNull();
    expect(consumeDecryptFailure()).toBe(true);
    // consumeDecryptFailure se resetea tras leerse una vez.
    expect(consumeDecryptFailure()).toBe(false);
  });

  it('removeItem limpia la fila cifrada (usado al cerrar sesion)', async () => {
    const key = await makeKey();
    setPinActive(true);
    setSessionKey(key);
    await encryptedSessionStorage.setItem(STORAGE_KEY, SESSION_JSON);

    await encryptedSessionStorage.removeItem(STORAGE_KEY);
    expect(await db.encryptedSession.get(STORAGE_KEY)).toBeUndefined();
  });
});

describe('migracion plano <-> cifrado (activar/desactivar PIN)', () => {
  it('migratePlainToEncrypted mueve el valor y borra el origen en claro', async () => {
    setPinActive(false);
    await encryptedSessionStorage.setItem(STORAGE_KEY, SESSION_JSON);
    expect(localStorage.getItem(STORAGE_KEY)).toEqual(SESSION_JSON);

    const key = await makeKey();
    await migratePlainToEncrypted(key);

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    const row = await db.encryptedSession.get(STORAGE_KEY);
    expect(row).toBeDefined();

    setPinActive(true);
    setSessionKey(key);
    expect(await encryptedSessionStorage.getItem(STORAGE_KEY)).toEqual(SESSION_JSON);
  });

  it('migrateEncryptedToPlain mueve el valor de vuelta y borra la fila cifrada', async () => {
    const key = await makeKey();
    setPinActive(true);
    setSessionKey(key);
    await encryptedSessionStorage.setItem(STORAGE_KEY, SESSION_JSON);

    await migrateEncryptedToPlain(key);

    expect(await db.encryptedSession.get(STORAGE_KEY)).toBeUndefined();
    expect(localStorage.getItem(STORAGE_KEY)).toEqual(SESSION_JSON);
  });
});

describe('reencryptAllSessions (cambio de PIN)', () => {
  it('re-cifra bajo la clave nueva sin pasar nunca por localStorage', async () => {
    const oldKey = await makeKey('123456');
    const newKey = await makeKey('654321');
    setPinActive(true);
    setSessionKey(oldKey);
    await encryptedSessionStorage.setItem(STORAGE_KEY, SESSION_JSON);

    await reencryptAllSessions(oldKey, newKey);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    setSessionKey(newKey);
    expect(await encryptedSessionStorage.getItem(STORAGE_KEY)).toEqual(SESSION_JSON);

    // La clave antigua ya no descifra la fila (fue re-cifrada bajo la nueva).
    setSessionKey(oldKey);
    const readWithOldKey = await encryptedSessionStorage.getItem(STORAGE_KEY);
    expect(readWithOldKey).toBeNull();
  });
});
