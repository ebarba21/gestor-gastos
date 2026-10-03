// Desbloqueo con biometria del dispositivo (Face ID, Touch ID, huella, Windows Hello) como
// alternativa rapida a teclear el PIN en la pantalla bloqueada.
//
// Como funciona (todo LOCAL, sin servidor y sin red):
//   - Al activarlo se crea una credencial WebAuthn de PLATAFORMA con verificacion de usuario
//     obligatoria. El sistema operativo pide la biometria; la app nunca recibe datos biometricos
//     (invariante 13): solo una firma y, si el autenticador la soporta, una salida PRF.
//   - Se guarda el PIN CIFRADO (AES-GCM), nunca en claro. La clave de cifrado sale de:
//       * modo 'prf' (preferido): la extension PRF de WebAuthn. El autenticador devuelve 32 bytes
//         secretos SOLO tras verificar al usuario; de ahi se deriva la clave (HKDF). Sin la cara o
//         la huella, el PIN cifrado es ilegible.
//       * modo 'device-key' (cuando el autenticador no soporta PRF): una clave AES no extraible
//         generada y guardada en este navegador. El acceso se condiciona a una asercion WebAuthn
//         con verificacion de usuario cuya firma se comprueba con la clave publica registrada.
//         Es una barrera de la interfaz equivalente al propio PIN (los datos financieros locales
//         no estan cifrados en IndexedDB): protege frente a quien coge el dispositivo, no frente
//         a quien controla el navegador.
//   - Al desbloquear se recupera el PIN y se verifica por la via normal (pinService.verifyPin),
//     asi que el contador de intentos, el cifrado de la sesion y el resto de reglas del PIN no
//     cambian. El PIN sigue siendo siempre la via de respaldo.
//
// Nucleo puro con dependencias inyectables (credenciales, crypto, almacen de la clave) para
// poder probarlo con un autenticador simulado.
import { base64ToBytes, bytesToBase64 } from './base64';
import { SecurityError } from './errors';

export type BiometricMode = 'prf' | 'device-key';

export interface BiometricUnlockConfig {
  version: 1;
  mode: BiometricMode;
  rpId: string;
  credentialId: string; // base64
  // Clave publica SPKI (base64) y algoritmo COSE (-7 ES256, -257 RS256) para verificar la firma
  // de cada asercion. null si el navegador no la expone (se exige igualmente la verificacion).
  publicKeySpki: string | null;
  publicKeyAlg: number | null;
  prfSalt: string; // base64, 32 bytes
  ivBase64: string;
  ciphertextBase64: string; // el PIN, cifrado
  createdAt: number;
}

export interface DeviceKeyStore {
  get(): Promise<CryptoKey | null>;
  put(key: CryptoKey): Promise<void>;
  clear(): Promise<void>;
}

export interface BiometricDeps {
  credentials: Pick<CredentialsContainer, 'create' | 'get'>;
  subtle: SubtleCrypto;
  randomBytes: (length: number) => Uint8Array;
  rpId: string;
  origin: string;
  deviceKeyStore: DeviceKeyStore;
  now?: () => number;
}

const HKDF_INFO = new TextEncoder().encode('gestor-gastos/desbloqueo-biometrico/v1');
const UP_FLAG = 0x01;
const UV_FLAG = 0x04;

interface PrfExtensionResults {
  prf?: { enabled?: boolean; results?: { first?: ArrayBuffer | ArrayBufferView } };
}

// --- Utilidades ---

function toBytes(data: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return new Uint8Array(data);
}

function base64UrlEncode(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

// Firma ECDSA en DER (lo que devuelve WebAuthn) -> r||s de 64 bytes (lo que espera WebCrypto).
export function derEcdsaToRaw(der: Uint8Array): Uint8Array {
  const fail = (): never => {
    throw new SecurityError('BIOMETRIC_INVALID', 'La firma del autenticador no es valida.');
  };
  if (der[0] !== 0x30) fail();
  let offset = 2;
  if (der[1] & 0x80) offset = 2 + (der[1] & 0x7f);
  const readInt = (): Uint8Array => {
    if (der[offset] !== 0x02) fail();
    const len = der[offset + 1];
    let value = der.slice(offset + 2, offset + 2 + len);
    offset += 2 + len;
    while (value.length > 32 && value[0] === 0) value = value.slice(1);
    if (value.length > 32) fail();
    const padded = new Uint8Array(32);
    padded.set(value, 32 - value.length);
    return padded;
  };
  const r = readInt();
  const s = readInt();
  return concat(r, s);
}

function mapCeremonyError(error: unknown): SecurityError {
  if (error instanceof SecurityError) return error;
  const name = (error as { name?: string } | null)?.name ?? '';
  if (name === 'NotAllowedError' || name === 'AbortError') {
    return new SecurityError(
      'BIOMETRIC_CANCELLED',
      'No se completo la verificacion. Vuelve a intentarlo o usa tu PIN.',
    );
  }
  if (name === 'SecurityError') {
    return new SecurityError(
      'BIOMETRIC_UNAVAILABLE',
      'Este navegador no permite la biometria en esta direccion.',
    );
  }
  if (name === 'NotSupportedError') {
    return new SecurityError(
      'BIOMETRIC_UNAVAILABLE',
      'Este dispositivo no ofrece Face ID, huella ni Windows Hello para la web.',
    );
  }
  return new SecurityError('BIOMETRIC_INVALID', 'No se pudo completar la verificacion biometrica.');
}

async function deriveKeyFromPrf(subtle: SubtleCrypto, prfOutput: Uint8Array, salt: Uint8Array): Promise<CryptoKey> {
  const base = await subtle.importKey('raw', prfOutput as BufferSource, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: HKDF_INFO as BufferSource },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function encryptPin(subtle: SubtleCrypto, key: CryptoKey, pin: string, iv: Uint8Array): Promise<string> {
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, new TextEncoder().encode(pin));
  return bytesToBase64(new Uint8Array(ct));
}

async function decryptPin(subtle: SubtleCrypto, key: CryptoKey, config: BiometricUnlockConfig): Promise<string> {
  try {
    const plain = await subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(config.ivBase64) as BufferSource },
      key,
      base64ToBytes(config.ciphertextBase64) as BufferSource,
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new SecurityError(
      'BIOMETRIC_INVALID',
      'No se pudo recuperar el acceso con biometria. Usa tu PIN y vuelve a activarla.',
    );
  }
}

// Verifica una asercion WebAuthn: tipo, reto, origen, rpId, presencia + verificacion de usuario
// y, si se conoce la clave publica, la firma.
async function verifyAssertion(
  deps: BiometricDeps,
  config: BiometricUnlockConfig,
  credential: PublicKeyCredential,
  challenge: Uint8Array,
): Promise<void> {
  const invalid = (detail: string): never => {
    throw new SecurityError('BIOMETRIC_INVALID', `Verificacion biometrica no valida (${detail}).`);
  };
  if (!bytesEqual(toBytes(credential.rawId), base64ToBytes(config.credentialId))) invalid('credencial');

  const response = credential.response as AuthenticatorAssertionResponse;
  const clientDataBytes = toBytes(response.clientDataJSON);
  let clientData: { type?: string; challenge?: string; origin?: string };
  try {
    clientData = JSON.parse(new TextDecoder().decode(clientDataBytes)) as typeof clientData;
  } catch {
    return invalid('datos de cliente');
  }
  if (clientData.type !== 'webauthn.get') invalid('tipo');
  if (clientData.challenge !== base64UrlEncode(challenge)) invalid('reto');
  if (clientData.origin !== deps.origin) invalid('origen');

  const authData = toBytes(response.authenticatorData);
  if (authData.length < 37) invalid('datos del autenticador');
  const rpIdHash = new Uint8Array(
    await deps.subtle.digest('SHA-256', new TextEncoder().encode(config.rpId) as BufferSource),
  );
  if (!bytesEqual(authData.slice(0, 32), rpIdHash)) invalid('dominio');
  const flags = authData[32];
  if ((flags & UP_FLAG) === 0 || (flags & UV_FLAG) === 0) invalid('sin verificacion de usuario');

  if (config.publicKeySpki && (config.publicKeyAlg === -7 || config.publicKeyAlg === -257)) {
    const clientHash = new Uint8Array(await deps.subtle.digest('SHA-256', clientDataBytes as BufferSource));
    const signed = concat(authData, clientHash);
    const spki = base64ToBytes(config.publicKeySpki);
    const signature = toBytes(response.signature);
    let ok = false;
    if (config.publicKeyAlg === -7) {
      const key = await deps.subtle.importKey('spki', spki as BufferSource, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
      ok = await deps.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, derEcdsaToRaw(signature) as BufferSource, signed as BufferSource);
    } else {
      const key = await deps.subtle.importKey('spki', spki as BufferSource, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
      ok = await deps.subtle.verify('RSASSA-PKCS1-v1_5', key, signature as BufferSource, signed as BufferSource);
    }
    if (!ok) invalid('firma');
  }
}

async function assert(
  deps: BiometricDeps,
  config: BiometricUnlockConfig,
  withPrf: boolean,
): Promise<{ prfOutput: Uint8Array | null }> {
  const challenge = deps.randomBytes(32);
  let credential: PublicKeyCredential;
  try {
    const result = await deps.credentials.get({
      publicKey: {
        challenge: challenge as BufferSource,
        rpId: config.rpId,
        allowCredentials: [{ type: 'public-key', id: base64ToBytes(config.credentialId) as BufferSource }],
        userVerification: 'required',
        timeout: 60_000,
        ...(withPrf
          ? { extensions: { prf: { eval: { first: base64ToBytes(config.prfSalt) as BufferSource } } } as AuthenticationExtensionsClientInputs }
          : {}),
      },
    });
    if (!result) throw new SecurityError('BIOMETRIC_CANCELLED', 'No se completo la verificacion.');
    credential = result as PublicKeyCredential;
  } catch (error) {
    throw mapCeremonyError(error);
  }
  await verifyAssertion(deps, config, credential, challenge);
  const ext = credential.getClientExtensionResults() as PrfExtensionResults;
  const first = ext.prf?.results?.first;
  return { prfOutput: first ? toBytes(first) : null };
}

// --- API ---

// Registra la biometria de este dispositivo y guarda el PIN cifrado. Puede pedir la biometria
// dos veces (crear la credencial y leer su PRF), segun el navegador.
export async function enrollBiometricUnlock(pin: string, deps: BiometricDeps): Promise<BiometricUnlockConfig> {
  const prfSalt = deps.randomBytes(32);
  const challenge = deps.randomBytes(32);
  const userId = deps.randomBytes(16);
  let credential: PublicKeyCredential;
  try {
    const result = await deps.credentials.create({
      publicKey: {
        challenge: challenge as BufferSource,
        rp: { id: deps.rpId, name: 'Gestor de Gastos' },
        user: { id: userId as BufferSource, name: 'Desbloqueo de Gestor de Gastos', displayName: 'Gestor de Gastos' },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'preferred',
        },
        attestation: 'none',
        timeout: 60_000,
        extensions: { prf: { eval: { first: prfSalt as BufferSource } } } as AuthenticationExtensionsClientInputs,
      },
    });
    if (!result) throw new SecurityError('BIOMETRIC_CANCELLED', 'No se completo la verificacion.');
    credential = result as PublicKeyCredential;
  } catch (error) {
    throw mapCeremonyError(error);
  }

  const attestation = credential.response as AuthenticatorAttestationResponse;
  let publicKeySpki: string | null = null;
  let publicKeyAlg: number | null = null;
  try {
    const spki = typeof attestation.getPublicKey === 'function' ? attestation.getPublicKey() : null;
    const alg = typeof attestation.getPublicKeyAlgorithm === 'function' ? attestation.getPublicKeyAlgorithm() : null;
    if (spki && (alg === -7 || alg === -257)) {
      publicKeySpki = bytesToBase64(toBytes(spki));
      publicKeyAlg = alg;
    }
  } catch {
    // Navegador sin getPublicKey: se exige igualmente verificacion de usuario en cada asercion.
  }

  const ext = credential.getClientExtensionResults() as PrfExtensionResults;
  const config: BiometricUnlockConfig = {
    version: 1,
    mode: ext.prf?.enabled || ext.prf?.results?.first ? 'prf' : 'device-key',
    rpId: deps.rpId,
    credentialId: bytesToBase64(toBytes(credential.rawId)),
    publicKeySpki,
    publicKeyAlg,
    prfSalt: bytesToBase64(prfSalt),
    ivBase64: '',
    ciphertextBase64: '',
    createdAt: (deps.now ?? Date.now)(),
  };

  let key: CryptoKey;
  if (config.mode === 'prf') {
    let prfOutput = ext.prf?.results?.first ? toBytes(ext.prf.results.first) : null;
    if (!prfOutput) prfOutput = (await assert(deps, config, true)).prfOutput;
    if (!prfOutput) {
      // El navegador anuncio PRF pero no lo entrega al usar la credencial: se usa la clave local.
      config.mode = 'device-key';
    } else {
      key = await deriveKeyFromPrf(deps.subtle, prfOutput, prfSalt);
    }
  }
  if (config.mode === 'device-key') {
    key = (await deps.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])) as CryptoKey;
    await deps.deviceKeyStore.put(key);
  }

  const iv = deps.randomBytes(12);
  config.ivBase64 = bytesToBase64(iv);
  config.ciphertextBase64 = await encryptPin(deps.subtle, key!, pin, iv);
  return config;
}

// Pide la biometria y devuelve el PIN guardado (para verificarlo por la via normal).
export async function unlockWithBiometrics(config: BiometricUnlockConfig, deps: BiometricDeps): Promise<string> {
  if (config.rpId !== deps.rpId) {
    throw new SecurityError(
      'BIOMETRIC_INVALID',
      'La biometria se activo en otra direccion de la app. Usa tu PIN y vuelve a activarla.',
    );
  }
  const { prfOutput } = await assert(deps, config, config.mode === 'prf');
  let key: CryptoKey | null;
  if (config.mode === 'prf') {
    if (!prfOutput) {
      throw new SecurityError(
        'BIOMETRIC_INVALID',
        'El autenticador no devolvio la clave de desbloqueo. Usa tu PIN y vuelve a activar la biometria.',
      );
    }
    key = await deriveKeyFromPrf(deps.subtle, prfOutput, base64ToBytes(config.prfSalt));
  } else {
    key = await deps.deviceKeyStore.get();
    if (!key) {
      throw new SecurityError(
        'BIOMETRIC_INVALID',
        'Falta la clave local de desbloqueo. Usa tu PIN y vuelve a activar la biometria.',
      );
    }
  }
  return decryptPin(deps.subtle, key, config);
}

// Nombre que el usuario reconoce para la biometria de su dispositivo.
export function biometricLabel(userAgent: string = typeof navigator !== 'undefined' ? navigator.userAgent : ''): string {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'Face ID / Touch ID';
  if (/Macintosh|Mac OS X/i.test(userAgent)) return 'Touch ID';
  if (/Windows/i.test(userAgent)) return 'Windows Hello';
  if (/Android/i.test(userAgent)) return 'huella o cara';
  return 'biometria';
}
