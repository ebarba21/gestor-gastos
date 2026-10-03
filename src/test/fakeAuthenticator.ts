// Autenticador WebAuthn de plataforma simulado para tests (criptografia real: ECDSA P-256 para
// firmar las aserciones y HMAC para la extension PRF). Solo para tests.
import type { BiometricDeps, DeviceKeyStore } from '../security/biometricUnlock';
import { bytesToBase64 } from '../security/base64';

export const RP_ID = 'ebarba21.github.io';
export const ORIGIN = 'https://ebarba21.github.io';
export const subtle = globalThis.crypto.subtle;

export function b64url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// r||s (WebCrypto) -> DER (formato WebAuthn), con el 0x00 inicial cuando el bit alto esta activo.
export function rawToDer(raw: Uint8Array): Uint8Array {
  const int = (v: Uint8Array): number[] => {
    let i = 0;
    while (i < v.length - 1 && v[i] === 0) i += 1;
    const body = Array.from(v.slice(i));
    if (body[0] & 0x80) body.unshift(0);
    return [0x02, body.length, ...body];
  };
  const r = int(raw.slice(0, 32));
  const s = int(raw.slice(32));
  return new Uint8Array([0x30, r.length + s.length, ...r, ...s]);
}

interface FakeOptions {
  prf: boolean;
  uv: boolean;
  cancel: boolean;
  origin: string;
  tamperSignature: boolean;
}

// Autenticador de plataforma simulado con criptografia real (ECDSA P-256 + HMAC para PRF).
export function fakeAuthenticator(opts: Partial<FakeOptions> = {}) {
  const o: FakeOptions = { prf: true, uv: true, cancel: false, origin: ORIGIN, tamperSignature: false, ...opts };
  let keyPair: CryptoKeyPair | null = null;
  let prfSecret: CryptoKey | null = null;
  const rawId = crypto.getRandomValues(new Uint8Array(16));
  const calls = { create: 0, get: 0 };

  async function prfFor(input: unknown): Promise<ArrayBuffer | undefined> {
    const salt = (input as { prf?: { eval?: { first?: Uint8Array } } } | undefined)?.prf?.eval?.first;
    if (!o.prf || !salt || !prfSecret) return undefined;
    return subtle.sign('HMAC', prfSecret, salt as BufferSource);
  }

  const credentials: BiometricDeps['credentials'] = {
    async create(options?: CredentialCreationOptions) {
      calls.create += 1;
      if (o.cancel) throw new DOMException('cancelado', 'NotAllowedError');
      keyPair = (await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
      prfSecret = (await subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])) as CryptoKey;
      const spki = await subtle.exportKey('spki', keyPair.publicKey);
      void options;
      return {
        rawId: rawId.buffer,
        response: { getPublicKey: () => spki, getPublicKeyAlgorithm: () => -7 },
        // Como Chrome: anuncia PRF al crear pero no devuelve resultados hasta usar la credencial.
        getClientExtensionResults: () => (o.prf ? { prf: { enabled: true } } : {}),
      } as unknown as Credential;
    },
    async get(options?: CredentialRequestOptions) {
      calls.get += 1;
      if (o.cancel) throw new DOMException('cancelado', 'NotAllowedError');
      const pk = options!.publicKey!;
      const challenge = new Uint8Array(pk.challenge as ArrayBuffer);
      const clientData = new TextEncoder().encode(
        JSON.stringify({ type: 'webauthn.get', challenge: b64url(challenge), origin: o.origin }),
      );
      const rpHash = new Uint8Array(await subtle.digest('SHA-256', new TextEncoder().encode(pk.rpId!)));
      const authData = new Uint8Array(37);
      authData.set(rpHash, 0);
      authData[32] = 0x01 | (o.uv ? 0x04 : 0);
      const clientHash = new Uint8Array(await subtle.digest('SHA-256', clientData));
      const signed = new Uint8Array([...authData, ...clientHash]);
      const raw = new Uint8Array(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keyPair!.privateKey, signed));
      if (o.tamperSignature) raw[5] ^= 0xff;
      const first = await prfFor(pk.extensions);
      return {
        rawId: rawId.buffer,
        response: { clientDataJSON: clientData.buffer, authenticatorData: authData.buffer, signature: rawToDer(raw).buffer },
        getClientExtensionResults: () => (first ? { prf: { results: { first } } } : {}),
      } as unknown as Credential;
    },
  };
  return { credentials, calls, options: o };
}

export function memoryKeyStore(): DeviceKeyStore & { key: CryptoKey | null } {
  const store = {
    key: null as CryptoKey | null,
    async get() {
      return store.key;
    },
    async put(k: CryptoKey) {
      store.key = k;
    },
    async clear() {
      store.key = null;
    },
  };
  return store;
}

export function biometricTestDeps(auth: ReturnType<typeof fakeAuthenticator>, keyStore: DeviceKeyStore = memoryKeyStore()): BiometricDeps {
  return {
    credentials: auth.credentials,
    subtle,
    randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)),
    rpId: RP_ID,
    origin: ORIGIN,
    deviceKeyStore: keyStore,
  };
}

