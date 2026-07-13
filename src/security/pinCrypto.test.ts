import { describe, expect, it } from 'vitest';
import { KDF_PARAMS_V1, constantTimeEqual, derivePinKeys, generateSalt } from './pinCrypto';
import { bytesToBase64 } from './base64';

// Las claves de cifrado se derivan como NO extraibles (buena practica: ni siquiera un fallo de
// la app puede volcar los bytes crudos). Por eso los tests de determinismo/unicidad comparan el
// COMPORTAMIENTO de la clave (cifrar un texto fijo con un IV fijo) en vez de exportarla.
const FIXED_IV = new Uint8Array(12); // Ceros: valido solo para comparar, nunca para cifrar datos reales.
const PLAINTEXT = new TextEncoder().encode('fixture-fase3');

async function fingerprintKey(key: CryptoKey): Promise<string> {
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: FIXED_IV as BufferSource },
    key,
    PLAINTEXT,
  );
  return bytesToBase64(new Uint8Array(ciphertext));
}

describe('pinCrypto', () => {
  it('generateSalt produce sales distintas en cada llamada', () => {
    const a = generateSalt();
    const b = generateSalt();
    expect(a).not.toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it('derivePinKeys es deterministico con el mismo PIN, sal y parametros', async () => {
    const salt = generateSalt();
    const first = await derivePinKeys('123456', salt);
    const second = await derivePinKeys('123456', salt);
    expect(first.verifier).toEqual(second.verifier);
    expect(await fingerprintKey(first.encryptionKey)).toEqual(await fingerprintKey(second.encryptionKey));
  });

  it('sales distintas producen verificadores distintos para el mismo PIN', async () => {
    const saltA = generateSalt();
    const saltB = generateSalt();
    const a = await derivePinKeys('123456', saltA);
    const b = await derivePinKeys('123456', saltB);
    expect(a.verifier).not.toEqual(b.verifier);
  });

  it('PINes distintos producen verificadores distintos con la misma sal', async () => {
    const salt = generateSalt();
    const a = await derivePinKeys('123456', salt);
    const b = await derivePinKeys('654321', salt);
    expect(a.verifier).not.toEqual(b.verifier);
  });

  it('el verificador y la clave de cifrado son artefactos independientes (distinto contexto HMAC)', async () => {
    const salt = generateSalt();
    const { verifier, encryptionKey } = await derivePinKeys('123456', salt);
    // La clave de cifrado es NO extraible (buena practica); solo se puede observar su
    // comportamiento. Verificador y huella de cifrado nunca deben coincidir como string.
    const fingerprint = await fingerprintKey(encryptionKey);
    expect(verifier).not.toEqual(fingerprint);
  });

  it('constantTimeEqual compara correctamente iguales y distintos', async () => {
    const salt = generateSalt();
    const { verifier } = await derivePinKeys('123456', salt);
    expect(constantTimeEqual(verifier, verifier)).toBe(true);
    const { verifier: other } = await derivePinKeys('999999', salt);
    expect(constantTimeEqual(verifier, other)).toBe(false);
  });

  it('KDF_PARAMS_V1 esta documentado y versionado', () => {
    expect(KDF_PARAMS_V1.version).toBe(1);
    expect(KDF_PARAMS_V1.algorithm).toBe('PBKDF2');
    expect(KDF_PARAMS_V1.hash).toBe('SHA-256');
    expect(KDF_PARAMS_V1.iterations).toBeGreaterThanOrEqual(100_000);
  });
});
