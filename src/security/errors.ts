// Errores de dominio de seguridad local (PIN, sesion cifrada, passkeys). Mismo patron que
// src/auth/errors.ts: codigo tipado + mensaje corto, sin errores silenciosos (invariante
// CLAUDE.md). Ningun mensaje incluye el PIN, la clave derivada ni datos de sesion.

export type SecurityErrorCode =
  | 'PIN_TOO_SHORT' // Menos de 6 digitos.
  | 'PIN_NOT_DIGITS' // Contiene caracteres que no son digitos.
  | 'PIN_MISMATCH' // La confirmacion no coincide con el PIN.
  | 'PIN_SAME_AS_CURRENT' // El PIN nuevo es igual al actual (cambio de PIN).
  | 'PIN_INCORRECT' // El PIN introducido no verifica.
  | 'PIN_LOCKED_OUT' // Espera progresiva activa tras varios intentos fallidos.
  | 'PIN_NOT_ENABLED' // Se ha pedido una operacion de PIN sin tener PIN activo.
  | 'PIN_ALREADY_ENABLED' // Se ha pedido activar un PIN que ya esta activo.
  | 'AUTO_LOCK_INVALID' // Valor de bloqueo automatico fuera de las opciones validas.
  | 'ACCOUNT_NOT_LINKED_TO_DEVICE' // La cuenta reautenticada no es dueña de ningun dato de este dispositivo.
  | 'SESSION_DECRYPT_FAILED' // La sesion cifrada no se pudo descifrar (clave o dato corrupto).
  | 'REAUTH_REQUIRED' // La operacion exige reautenticar con la contrasena de cuenta.
  | 'WEBAUTHN_UNSUPPORTED' // El navegador no implementa WebAuthn/PublicKeyCredential.
  | 'WEBAUTHN_DISABLED' // VITE_ENABLE_PASSKEYS esta desactivado.
  | 'WEBAUTHN_CANCELLED' // El usuario cancelo el dialogo del autenticador.
  | 'WEBAUTHN_NOT_REGISTERED' // No hay ninguna passkey registrada para esta cuenta/credencial.
  | 'WEBAUTHN_ALREADY_REGISTERED' // El autenticador ya tiene una passkey registrada.
  | 'WEBAUTHN_UNKNOWN' // Fallo de la ceremonia WebAuthn no clasificado.
  | 'BIOMETRIC_CANCELLED' // El usuario cancelo o no completo Face ID / huella / Windows Hello.
  | 'BIOMETRIC_UNAVAILABLE' // El dispositivo o navegador no ofrece biometria de plataforma.
  | 'BIOMETRIC_INVALID' // Asercion no valida, credencial desconocida o PIN cifrado ilegible.
  | 'BIOMETRIC_NOT_ENABLED'; // Se pidio desbloquear con biometria sin haberla activado.

export class SecurityError extends Error {
  readonly code: SecurityErrorCode;
  constructor(code: SecurityErrorCode, message: string) {
    super(message);
    this.name = 'SecurityError';
    this.code = code;
  }
}

// Espera progresiva en ms tras N intentos fallidos consecutivos (CLOUD_SYNC_SECURITY seccion 9).
// Indice = pinAttempts tras el fallo (1-based). A partir del indice 6 se mantiene el tope.
const BACKOFF_SCHEDULE_MS = [0, 0, 5_000, 15_000, 30_000, 60_000] as const;
const BACKOFF_MAX_MS = 60_000;

export function backoffForAttempt(attempts: number): number {
  if (attempts <= 0) return 0;
  const idx = attempts - 1;
  return idx < BACKOFF_SCHEDULE_MS.length ? BACKOFF_SCHEDULE_MS[idx] : BACKOFF_MAX_MS;
}
