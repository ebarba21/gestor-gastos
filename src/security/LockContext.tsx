// Contexto de bloqueo de acceso local (PIN, bloqueo automatico, passkeys). Fuente unica del
// estado de bloqueo en la UI (mismo patron que AuthContext/SyncContext). La clave de sesion en
// memoria NUNCA se expone aqui: solo vive dentro de encryptedSessionStorage.ts, controlada por
// pinService. Este contexto solo expone el ESTADO (bloqueada/desbloqueada) y ACCIONES.
//
// Debe montarse dentro de AuthProvider (necesita reautenticar con la cuenta para la recuperacion
// de PIN) y por FUERA de ProfileProvider/SyncProvider/App (para poder bloquear todo lo de
// dentro). Ver main.tsx y App.tsx (LockGate).
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { DeviceSecurity } from '../db/schema';
import { useAuth } from '../auth/AuthContext';
import {
  pinService,
  lockoutRemainingMs,
  AUTO_LOCK_OPTIONS_MS,
  type AutoLockOptionMs,
} from './pinService';
import { deviceSecurityRepo } from './deviceSecurityRepo';
import { getLockStatus, setLockStatus, subscribeLockStatus, type LockStatus } from './lockState';
import { SecurityError } from './errors';
import { consumeDecryptFailure } from './encryptedSessionStorage';
import {
  isPasskeysFeatureEnabled,
  isPlatformAuthenticatorAvailable,
  isWebAuthnSupported,
  webauthnService,
} from './webauthn';

// Reexportadas para que la UI (SecurityPage.tsx) no importe directamente de pinService.ts: la
// validacion autoritativa de estos valores vive en pinService.setAutoLockMs.
export { AUTO_LOCK_OPTIONS_MS, type AutoLockOptionMs };

function defaultSecurity(): DeviceSecurity {
  const ts = Date.now();
  return {
    id: 'device',
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

interface LockContextValue {
  // 'no-pin' (no hay nada que desbloquear), 'locked' o 'unlocked'.
  status: LockStatus;
  loading: boolean;
  security: DeviceSecurity;
  // true justo despues de un desbloqueo cuyo PIN era correcto pero cuya sesion guardada no se
  // pudo descifrar (dato corrupto): se informa explicitamente, nunca se degrada en silencio.
  decryptFailure: boolean;
  clearDecryptFailure: () => void;
  webAuthnSupported: boolean;
  platformAuthenticatorAvailable: boolean;
  passkeysFeatureEnabled: boolean;
  lockoutRemainingMs: number;

  lock: () => void;
  unlockWithPin: (pin: string) => Promise<void>;
  unlockWithPasskey: () => Promise<void>;
  // Desbloqueo con Face ID / huella / Windows Hello (biometricUnlock.ts). biometricEnabled =
  // activado en este dispositivo; platformAuthenticatorAvailable dice si el dispositivo lo ofrece.
  biometricEnabled: boolean;
  unlockWithBiometrics: () => Promise<void>;
  enableBiometricUnlock: (pin: string) => Promise<void>;
  disableBiometricUnlock: () => Promise<void>;
  enablePin: (pin: string, confirmPin: string) => Promise<void>;
  disablePin: (pin: string) => Promise<void>;
  changePin: (currentPin: string, newPin: string, confirmNewPin: string) => Promise<void>;
  setAutoLockMs: (ms: AutoLockOptionMs) => Promise<void>;
  setPasskeysEnabled: (enabled: boolean) => Promise<void>;
  // Recuperacion desde la pantalla bloqueada: en este punto normalmente NO hay sesion viva
  // (auth.status suele ser 'signed-out', es precisamente por eso que esta bloqueada). Por eso
  // pide email+password y usa signIn (no reauthenticate, que exige una sesion ya conocida).
  recoverPinViaAccountReauth: (
    email: string,
    password: string,
    newPin: string,
    confirmNewPin: string,
  ) => Promise<void>;
  resetDeviceAndAllLocalData: () => Promise<void>;
  refresh: () => Promise<DeviceSecurity>;
}

const LockContext = createContext<LockContextValue | null>(null);

export function SecurityProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const [security, setSecurity] = useState<DeviceSecurity>(defaultSecurity());
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<LockStatus>(getLockStatus());
  const [decryptFailure, setDecryptFailure] = useState(false);
  const [webAuthnSupported, setWebAuthnSupported] = useState(false);
  const [platformAuthenticatorAvailable, setPlatformAuthenticatorAvailable] = useState(false);

  // Se suscribe al store no-React de estado de bloqueo (fuente de verdad compartida con
  // syncEngine.ts) para mantenerse sincronizado si algo mas lo cambia.
  useEffect(() => subscribeLockStatus(setStatus), []);

  const refresh = useCallback(async () => {
    const current = await deviceSecurityRepo.get();
    setSecurity(current);
    return current;
  }, []);

  // Carga inicial. El modo del storage (plano/cifrado) y el estado de bloqueo inicial ya se
  // fijaron en main.tsx ANTES de montar React (hydrateSecurityAtBoot); aqui solo se completa el
  // resto del estado para la UI.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const current = await refresh();
      if (cancelled) return;
      if (!current.pinEnabled) setLockStatus('no-pin');
      setWebAuthnSupported(isWebAuthnSupported());
      setPlatformAuthenticatorAvailable(await isPlatformAuthenticatorAvailable());
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lock = useCallback(() => {
    pinService.lock();
    setLockStatus('locked');
  }, []);

  const unlockWithPin = useCallback(
    async (pin: string) => {
      await pinService.verifyPin(pin);
      setLockStatus('unlocked');
      if (consumeDecryptFailure()) setDecryptFailure(true);
      await refresh();
    },
    [refresh],
  );

  // Desbloquea probando identidad via passkey (WebAuthn a traves de Supabase Auth). Nota
  // honesta: el passkey prueba identidad y entrega una sesion valida en memoria para esta
  // pestaña, pero no revela la clave derivada del PIN. La sesion cifrada guardada en este
  // dispositivo NO se actualiza por esta via (no hay como, sin el PIN); para que persista entre
  // recargas hace falta desbloquear al menos una vez con el PIN. No es una degradacion
  // silenciosa ni una copia sin cifrar: simplemente esta sesion de passkey no se persiste aqui.
  const unlockWithPasskey = useCallback(async () => {
    // La UI oculta el boton si esto no se cumple, pero la funcion en si NUNCA debe depender
    // solo de eso (invariante: la UI nunca es la unica barrera). Si alguien la invoca igualmente
    // (p. ej. desde la consola) con los passkeys desactivados para este dispositivo, se rechaza
    // aqui tambien, sin llegar a tocar el SDK/navigator.credentials.
    if (!security.passkeysEnabled || !isPasskeysFeatureEnabled() || !isWebAuthnSupported()) {
      throw new SecurityError('WEBAUTHN_DISABLED', 'Los passkeys no estan habilitados para desbloquear.');
    }
    const ok = await webauthnService.signInWithPasskey();
    if (ok) setLockStatus('unlocked');
  }, [security.passkeysEnabled]);

  const unlockWithBiometrics = useCallback(async () => {
    try {
      await pinService.unlockWithBiometrics();
      setLockStatus('unlocked');
      if (consumeDecryptFailure()) setDecryptFailure(true);
    } finally {
      await refresh();
    }
  }, [refresh]);

  const enableBiometricUnlock = useCallback(
    async (pin: string) => {
      await pinService.enableBiometricUnlock(pin);
      await refresh();
    },
    [refresh],
  );

  const disableBiometricUnlock = useCallback(async () => {
    await pinService.disableBiometricUnlock();
    await refresh();
  }, [refresh]);

  const enablePin = useCallback(
    async (pin: string, confirmPin: string) => {
      await pinService.enablePin(pin, confirmPin);
      setLockStatus('unlocked');
      await refresh();
    },
    [refresh],
  );

  const disablePin = useCallback(
    async (pin: string) => {
      await pinService.disablePin(pin);
      setLockStatus('no-pin');
      await refresh();
    },
    [refresh],
  );

  const changePin = useCallback(
    async (currentPin: string, newPin: string, confirmNewPin: string) => {
      await pinService.changePin(currentPin, newPin, confirmNewPin);
      await refresh();
    },
    [refresh],
  );

  const setAutoLockMs = useCallback(
    async (ms: AutoLockOptionMs) => {
      await pinService.setAutoLockMs(ms);
      await refresh();
    },
    [refresh],
  );

  const setPasskeysEnabled = useCallback(
    async (enabled: boolean) => {
      await pinService.setPasskeysEnabled(enabled);
      await refresh();
    },
    [refresh],
  );

  const recoverPinViaAccountReauth = useCallback(
    async (email: string, password: string, newPin: string, confirmNewPin: string) => {
      await pinService.recoverPinViaAccountReauth(newPin, confirmNewPin, async () => {
        const session = await auth.signIn(email, password);
        return { userId: session.user.id };
      });
      setLockStatus('unlocked');
      await refresh();
    },
    [auth, refresh],
  );

  const resetDeviceAndAllLocalData = useCallback(async () => {
    await pinService.resetDeviceAndAllLocalData();
    setLockStatus('no-pin');
    await refresh();
  }, [refresh]);

  const clearDecryptFailure = useCallback(() => setDecryptFailure(false), []);

  // --- Bloqueo automatico: al ocultar la pestaña se arma un temporizador (mejor esfuerzo,
  // los navegadores limitan temporizadores en segundo plano); al volver a mostrarse, el tiempo
  // transcurrido es la comprobacion autoritativa (no depende de que el temporizador disparara).
  const hiddenAtRef = useRef<number | null>(null);
  const bgTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (status !== 'unlocked' || security.autoLockMs == null) return;
    const autoLockMs = security.autoLockMs;

    function onVisibilityChange(): void {
      if (document.visibilityState === 'hidden') {
        hiddenAtRef.current = Date.now();
        if (bgTimerRef.current) clearTimeout(bgTimerRef.current);
        bgTimerRef.current = setTimeout(() => lock(), autoLockMs);
      } else if (document.visibilityState === 'visible') {
        if (bgTimerRef.current) {
          clearTimeout(bgTimerRef.current);
          bgTimerRef.current = null;
        }
        const hiddenAt = hiddenAtRef.current;
        hiddenAtRef.current = null;
        if (hiddenAt != null && Date.now() - hiddenAt >= autoLockMs) {
          lock();
        }
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (bgTimerRef.current) clearTimeout(bgTimerRef.current);
    };
  }, [status, security.autoLockMs, lock]);

  const value = useMemo<LockContextValue>(
    () => ({
      status,
      loading,
      security,
      decryptFailure,
      clearDecryptFailure,
      webAuthnSupported,
      platformAuthenticatorAvailable,
      passkeysFeatureEnabled: isPasskeysFeatureEnabled(),
      lockoutRemainingMs: lockoutRemainingMs(security),
      lock,
      unlockWithPin,
      unlockWithPasskey,
      biometricEnabled: Boolean(security.pinEnabled && security.biometricUnlock),
      unlockWithBiometrics,
      enableBiometricUnlock,
      disableBiometricUnlock,
      enablePin,
      disablePin,
      changePin,
      setAutoLockMs,
      setPasskeysEnabled,
      recoverPinViaAccountReauth,
      resetDeviceAndAllLocalData,
      refresh,
    }),
    [
      status,
      loading,
      security,
      decryptFailure,
      clearDecryptFailure,
      webAuthnSupported,
      platformAuthenticatorAvailable,
      lock,
      unlockWithPin,
      unlockWithPasskey,
      unlockWithBiometrics,
      enableBiometricUnlock,
      disableBiometricUnlock,
      enablePin,
      disablePin,
      changePin,
      setAutoLockMs,
      setPasskeysEnabled,
      recoverPinViaAccountReauth,
      resetDeviceAndAllLocalData,
      refresh,
    ],
  );

  return <LockContext.Provider value={value}>{children}</LockContext.Provider>;
}

export function useLock(): LockContextValue {
  const ctx = useContext(LockContext);
  if (!ctx) throw new Error('useLock debe usarse dentro de <SecurityProvider>.');
  return ctx;
}

// Variante tolerante para componentes que pueden montarse sin SecurityProvider (tests parciales).
export function useLockOptional(): LockContextValue | null {
  return useContext(LockContext);
}
