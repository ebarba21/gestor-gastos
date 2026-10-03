// Servicio de PIN local: activar, cambiar, desactivar, verificar (con espera progresiva),
// bloquear y recuperar via reautenticacion de cuenta (CLOUD_SYNC_SECURITY seccion 9, 14).
// Orquesta pinCrypto (derivacion), deviceSecurityRepo (persistencia del verificador, nunca del
// PIN) y encryptedSessionStorage (cifrado de la sesion de Supabase). No conoce React.
import type { DeviceSecurity } from '../db/schema';
import { db } from '../db/index';
import { authService } from '../auth/authService';
import { KDF_PARAMS_V1, constantTimeEqual, derivePinKeys, generateSalt } from './pinCrypto';
import { deviceSecurityRepo, resetAllLocalData } from './deviceSecurityRepo';
import { backoffForAttempt, SecurityError } from './errors';
import {
  enrollBiometricUnlock,
  unlockWithBiometrics,
  type BiometricDeps,
  type DeviceKeyStore,
} from './biometricUnlock';
import {
  migrateEncryptedToPlain,
  migratePlainToEncrypted,
  reencryptAllSessions,
  setPinActive,
  setSessionKey,
} from './encryptedSessionStorage';

// Verifica que la cuenta reautenticada sea DUEÑA de al menos un perfil de este dispositivo
// (invariante 4 de CLAUDE.md: aislamiento por perfil/propietario en TODAS las capas). Sin esto,
// reautenticarse con CUALQUIER cuenta valida del proyecto (incluida una recien registrada por un
// atacante) bastaria para "recuperar" el PIN de un dispositivo ajeno y ver perfiles que nunca le
// pertenecieron.
async function isAccountLinkedToThisDevice(userId: string): Promise<boolean> {
  const count = await db.profiles
    .where('ownerUserId')
    .equals(userId)
    .filter((p) => p.deletedAt == null)
    .count();
  return count > 0;
}

const MIN_PIN_LENGTH = 6;
const DIGITS_ONLY = /^\d+$/;

// Opciones de bloqueo automatico validas en ms (CLOUD_SYNC_SECURITY seccion 9: inmediato, 1, 5,
// 15, 30 minutos). Fuente unica: la UI (LockContext.tsx) la reexporta para el <select>, pero la
// validacion autoritativa vive aqui, no en el componente.
export const AUTO_LOCK_OPTIONS_MS = [0, 60_000, 300_000, 900_000, 1_800_000] as const;
export type AutoLockOptionMs = (typeof AUTO_LOCK_OPTIONS_MS)[number];

// Bloqueo automatico por defecto al activar el PIN por primera vez (5 minutos). El usuario
// puede cambiarlo de inmediato en Ajustes > Seguridad; las opciones validas son las de
// AUTO_LOCK_OPTIONS_MS (ver LockContext.tsx).
const DEFAULT_AUTO_LOCK_MS = 5 * 60_000;

function assertValidPinFormat(pin: string): void {
  if (pin.length < MIN_PIN_LENGTH) {
    throw new SecurityError('PIN_TOO_SHORT', `El PIN debe tener al menos ${MIN_PIN_LENGTH} digitos.`);
  }
  if (!DIGITS_ONLY.test(pin)) {
    throw new SecurityError('PIN_NOT_DIGITS', 'El PIN solo puede contener digitos (0-9).');
  }
}

function assertConfirmed(pin: string, confirmPin: string): void {
  if (pin !== confirmPin) {
    throw new SecurityError('PIN_MISMATCH', 'La confirmacion no coincide con el PIN.');
  }
}

export function lockoutRemainingMs(security: DeviceSecurity, now = Date.now()): number {
  if (!security.pinLockedUntil) return 0;
  return Math.max(0, security.pinLockedUntil - now);
}

// Sincroniza el modo del storage de sesion (plano/cifrado) con lo persistido en Dexie. Debe
// llamarse UNA vez al arrancar la app, ANTES de montar React (ver main.tsx): si esto se
// retrasara hasta el efecto de un componente, AuthProvider podria intentar restaurar la sesion
// (storage.getItem) antes de saber si hay que descifrarla, arriesgando una lectura equivocada.
// Devuelve la configuracion cargada para fijar el estado de bloqueo inicial (lockState.ts).
export async function hydrateSecurityAtBoot(): Promise<DeviceSecurity> {
  const security = await deviceSecurityRepo.get();
  setPinActive(security.pinEnabled);
  return security;
}

// Almacen de la clave local del modo 'device-key' (CryptoKey no extraible) en la fila de
// seguridad del dispositivo.
export const deviceKeyStore: DeviceKeyStore = {
  async get() {
    return (await deviceSecurityRepo.get()).biometricDeviceKey ?? null;
  },
  async put(key) {
    await deviceSecurityRepo.put({ biometricDeviceKey: key });
  },
  async clear() {
    await deviceSecurityRepo.put({ biometricDeviceKey: null });
  },
};

// Dependencias reales del navegador para el desbloqueo biometrico.
export function browserBiometricDeps(): BiometricDeps {
  if (typeof window === 'undefined' || !window.PublicKeyCredential || !navigator.credentials) {
    throw new SecurityError(
      'BIOMETRIC_UNAVAILABLE',
      'Este navegador no ofrece Face ID, huella ni Windows Hello para la web.',
    );
  }
  return {
    credentials: navigator.credentials,
    subtle: crypto.subtle,
    randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)),
    rpId: window.location.hostname,
    origin: window.location.origin,
    deviceKeyStore,
  };
}

// Quita el desbloqueo biometrico (al cambiar, desactivar o recuperar el PIN el PIN cifrado deja
// de valer, y se borra tambien la clave local).
async function clearBiometric(): Promise<void> {
  await deviceSecurityRepo.put({ biometricUnlock: null, biometricDeviceKey: null });
}

export const pinService = {
  getSecurity(): Promise<DeviceSecurity> {
    return deviceSecurityRepo.get();
  },

  // Activa el PIN por primera vez. Migra cualquier sesion de Supabase existente (en claro en
  // localStorage) al storage cifrado ANTES de activar el modo cifrado, para que nunca quede una
  // copia en claro accesible tras la activacion.
  async enablePin(pin: string, confirmPin: string): Promise<void> {
    const current = await deviceSecurityRepo.get();
    if (current.pinEnabled) {
      throw new SecurityError('PIN_ALREADY_ENABLED', 'Ya hay un PIN activo. Cambialo en su lugar.');
    }
    assertValidPinFormat(pin);
    assertConfirmed(pin, confirmPin);

    const salt = generateSalt();
    const { verifier, encryptionKey } = await derivePinKeys(pin, salt);

    await migratePlainToEncrypted(encryptionKey);
    setPinActive(true);
    setSessionKey(encryptionKey);

    await deviceSecurityRepo.put({
      pinEnabled: true,
      pinSalt: salt,
      pinVerifier: verifier,
      pinKdfParams: KDF_PARAMS_V1,
      pinAttempts: 0,
      pinLockedUntil: null,
      autoLockMs: current.autoLockMs ?? DEFAULT_AUTO_LOCK_MS,
    });
  },

  // Desactiva el PIN: exige el PIN correcto, devuelve la sesion a texto plano en localStorage
  // (comportamiento estandar del SDK, igual que antes de esta fase) y borra el verificador.
  async disablePin(pin: string): Promise<void> {
    const current = await deviceSecurityRepo.get();
    if (!current.pinEnabled) {
      throw new SecurityError('PIN_NOT_ENABLED', 'No hay ningun PIN activo.');
    }
    const { encryptionKey } = await verifyPinWithBackoff(current, pin);

    await migrateEncryptedToPlain(encryptionKey);
    setSessionKey(null);
    setPinActive(false);

    await deviceSecurityRepo.put({
      pinEnabled: false,
      pinSalt: null,
      pinVerifier: null,
      pinKdfParams: null,
      pinAttempts: 0,
      pinLockedUntil: null,
      autoLockMs: null,
      biometricUnlock: null,
      biometricDeviceKey: null,
    });
  },

  // Cambia el PIN: exige el PIN actual, re-cifra la sesion existente bajo la clave nueva sin
  // pasar nunca por texto plano (ver reencryptAllSessions) y persiste el nuevo verificador.
  async changePin(currentPin: string, newPin: string, confirmNewPin: string): Promise<void> {
    const current = await deviceSecurityRepo.get();
    if (!current.pinEnabled) {
      throw new SecurityError('PIN_NOT_ENABLED', 'No hay ningun PIN activo.');
    }
    const { encryptionKey: oldKey } = await verifyPinWithBackoff(current, currentPin);

    assertValidPinFormat(newPin);
    assertConfirmed(newPin, confirmNewPin);
    if (newPin === currentPin) {
      throw new SecurityError('PIN_SAME_AS_CURRENT', 'El PIN nuevo debe ser distinto del actual.');
    }

    const newSalt = generateSalt();
    const { verifier, encryptionKey: newKey } = await derivePinKeys(newPin, newSalt);
    await reencryptAllSessions(oldKey, newKey);
    setSessionKey(newKey);

    await deviceSecurityRepo.put({
      pinSalt: newSalt,
      pinVerifier: verifier,
      pinKdfParams: KDF_PARAMS_V1,
      pinAttempts: 0,
      pinLockedUntil: null,
      // El PIN cifrado para la biometria era el antiguo: hay que volver a activarla.
      biometricUnlock: null,
      biometricDeviceKey: null,
    });
  },

  // Verifica un PIN candidato contra el verificador guardado. Contador de intentos + espera
  // progresiva (CLOUD_SYNC_SECURITY seccion 9). Al acertar, deja la clave de sesion en memoria
  // (desbloqueada) y resetea el contador.
  async verifyPin(pin: string): Promise<void> {
    const current = await deviceSecurityRepo.get();
    if (!current.pinEnabled) {
      throw new SecurityError('PIN_NOT_ENABLED', 'No hay ningun PIN activo.');
    }
    const { encryptionKey } = await verifyPinWithBackoff(current, pin);
    setPinActive(true);
    setSessionKey(encryptionKey);
  },

  // Bloqueo manual/automatico: elimina la clave de memoria. La sesion cifrada sigue intacta en
  // Dexie; no se sincroniza nada mientras no haya clave (ver src/security/lockState.ts).
  lock(): void {
    setSessionKey(null);
  },

  async setAutoLockMs(autoLockMs: number): Promise<void> {
    if (!AUTO_LOCK_OPTIONS_MS.includes(autoLockMs as AutoLockOptionMs)) {
      throw new SecurityError(
        'AUTO_LOCK_INVALID',
        `Valor de bloqueo automatico no valido: ${autoLockMs}.`,
      );
    }
    const current = await deviceSecurityRepo.get();
    if (!current.pinEnabled) {
      throw new SecurityError('PIN_NOT_ENABLED', 'Activa el PIN para configurar el bloqueo automatico.');
    }
    await deviceSecurityRepo.put({ autoLockMs });
  },

  // Activa el desbloqueo con biometria. Exige el PIN actual (con el mismo contador de intentos
  // que el resto de operaciones de PIN) y lo guarda cifrado (ver biometricUnlock.ts).
  async enableBiometricUnlock(pin: string, deps: BiometricDeps = browserBiometricDeps()): Promise<void> {
    const current = await deviceSecurityRepo.get();
    if (!current.pinEnabled) {
      throw new SecurityError('PIN_NOT_ENABLED', 'Activa primero un PIN: es la via de respaldo.');
    }
    await verifyPinWithBackoff(current, pin);
    await clearBiometric();
    const config = await enrollBiometricUnlock(pin, deps);
    await deviceSecurityRepo.put({ biometricUnlock: config });
  },

  async disableBiometricUnlock(): Promise<void> {
    await clearBiometric();
  },

  // Desbloquea con biometria: recupera el PIN cifrado y lo verifica por la via normal.
  async unlockWithBiometrics(deps: BiometricDeps = browserBiometricDeps()): Promise<void> {
    const current = await deviceSecurityRepo.get();
    if (!current.pinEnabled || !current.biometricUnlock) {
      throw new SecurityError('BIOMETRIC_NOT_ENABLED', 'El desbloqueo con biometria no esta activado.');
    }
    const pin = await unlockWithBiometrics(current.biometricUnlock, deps);
    try {
      await pinService.verifyPin(pin);
    } catch (error) {
      if (error instanceof SecurityError && error.code === 'PIN_INCORRECT') {
        // No deberia ocurrir (cambiar el PIN borra la biometria), pero si el PIN guardado ya no
        // vale se desactiva para no sumar intentos fallidos en cada apertura.
        await clearBiometric();
        throw new SecurityError(
          'BIOMETRIC_INVALID',
          'El acceso con biometria ya no es valido. Entra con tu PIN y vuelve a activarlo.',
        );
      }
      throw error;
    }
  },

  async setPasskeysEnabled(enabled: boolean): Promise<void> {
    await deviceSecurityRepo.put({ passkeysEnabled: enabled });
  },

  // Recuperacion de PIN olvidado CON cuenta (CLOUD_SYNC_SECURITY seccion 14): el llamante debe
  // reautenticar con email+contrasena de cuenta ANTES de invocar esto (ver LockScreen). La clave
  // nueva se activa ANTES de reautenticar para que el SDK de Supabase la cifre al vuelo al
  // escribir la sesion recien obtenida; si la reautenticacion falla, no se guarda PIN nuevo.
  //
  // Verificacion de propiedad OBLIGATORIA: reautenticar con credenciales validas no basta, tiene
  // que ser la cuenta DUEÑA de al menos un perfil de este dispositivo (isAccountLinkedToThisDevice).
  // Sin esto, cualquiera podria registrarse con una cuenta nueva en el mismo proyecto Supabase y
  // "recuperar" el PIN de un dispositivo ajeno para ver perfiles/datos que nunca le pertenecieron
  // (viola el invariante 4 de CLAUDE.md). Si no coincide, se descarta la sesion recien obtenida
  // (nunca se persiste cifrada) y se rechaza con un error explicito.
  async recoverPinViaAccountReauth(
    newPin: string,
    confirmNewPin: string,
    reauthenticate: () => Promise<{ userId: string }>,
  ): Promise<void> {
    assertValidPinFormat(newPin);
    assertConfirmed(newPin, confirmNewPin);

    const salt = generateSalt();
    const { verifier, encryptionKey } = await derivePinKeys(newPin, salt);
    setPinActive(true);
    setSessionKey(encryptionKey);

    let userId: string;
    try {
      ({ userId } = await reauthenticate());
    } catch (error) {
      setSessionKey(null);
      throw error;
    }

    if (!(await isAccountLinkedToThisDevice(userId))) {
      setSessionKey(null);
      await deviceSecurityRepo.clearAllEncryptedSessions();
      throw new SecurityError(
        'ACCOUNT_NOT_LINKED_TO_DEVICE',
        'Esta cuenta no esta vinculada a los datos de este dispositivo.',
      );
    }

    await deviceSecurityRepo.put({
      pinEnabled: true,
      pinSalt: salt,
      pinVerifier: verifier,
      pinKdfParams: KDF_PARAMS_V1,
      pinAttempts: 0,
      pinLockedUntil: null,
      biometricUnlock: null,
      biometricDeviceKey: null,
    });
  },

  // Ultimo recurso SIN cuenta (CLOUD_SYNC_SECURITY 14: "sin cuenta y sin PIN, no hay via de
  // recuperacion salvo restablecer los datos locales"). Destructivo: borra TODAS las tablas
  // Dexie de este dispositivo (todos los perfiles). Solo la UI de recuperacion, tras doble
  // confirmacion explicita, debe invocar esto. Intenta cerrar sesion remota primero (best-effort,
  // sin bloquear el borrado si falla por falta de red o de configuracion): evita dejar un token
  // de refresco valido en el servidor una vez que la copia local cifrada ya no existe.
  async resetDeviceAndAllLocalData(): Promise<void> {
    try {
      await authService.signOut();
    } catch {
      // Sin red, sin cuenta configurada, o ya sin sesion: no impide el borrado local, que es el
      // objetivo principal de esta operacion.
    }
    setSessionKey(null);
    setPinActive(false);
    await resetAllLocalData();
  },
};

// Verifica un PIN candidato APLICANDO el contador de intentos y la espera progresiva
// (CLOUD_SYNC_SECURITY seccion 9). Usado por verifyPin, changePin y disablePin: cualquier
// operacion que pida "el PIN actual" pasa por el mismo backoff, no solo el desbloqueo desde la
// pantalla bloqueada (si no, un atacante con la app ya abierta podria fuerza-bruta el PIN vía
// "cambiar PIN"/"desactivar PIN" sin limite de intentos).
async function verifyPinWithBackoff(
  current: DeviceSecurity,
  candidatePin: string,
): Promise<{ encryptionKey: CryptoKey }> {
  const remaining = lockoutRemainingMs(current);
  if (remaining > 0) {
    throw new SecurityError(
      'PIN_LOCKED_OUT',
      `Demasiados intentos. Espera ${Math.ceil(remaining / 1000)} segundos.`,
    );
  }
  try {
    const result = await assertPinCorrectAndConsume(current, candidatePin);
    await deviceSecurityRepo.put({ pinAttempts: 0, pinLockedUntil: null });
    return result;
  } catch (error) {
    const attempts = current.pinAttempts + 1;
    const waitMs = backoffForAttempt(attempts);
    await deviceSecurityRepo.put({
      pinAttempts: attempts,
      pinLockedUntil: waitMs > 0 ? Date.now() + waitMs : null,
    });
    if (error instanceof SecurityError) throw error;
    throw new SecurityError('PIN_INCORRECT', 'PIN incorrecto.');
  }
}

// Deriva las claves para el PIN candidato y compara el verificador en tiempo constante. Lanza
// PIN_INCORRECT si no coincide. No toca el contador de intentos (responsabilidad del llamante,
// verifyPinWithBackoff).
async function assertPinCorrectAndConsume(
  security: DeviceSecurity,
  candidatePin: string,
): Promise<{ encryptionKey: CryptoKey }> {
  if (!security.pinSalt || !security.pinVerifier || !security.pinKdfParams) {
    throw new SecurityError('PIN_NOT_ENABLED', 'No hay ningun PIN activo.');
  }
  const { verifier, encryptionKey } = await derivePinKeys(candidatePin, security.pinSalt, security.pinKdfParams);
  if (!constantTimeEqual(verifier, security.pinVerifier)) {
    throw new SecurityError('PIN_INCORRECT', 'PIN incorrecto.');
  }
  return { encryptionKey };
}
