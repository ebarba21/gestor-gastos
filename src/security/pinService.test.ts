import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/index';
import { pinService } from './pinService';
import { SecurityError } from './errors';
import { __resetForTests, isUnlocked } from './encryptedSessionStorage';

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  localStorage.clear();
  __resetForTests();
});

afterEach(() => {
  __resetForTests();
  localStorage.clear();
  vi.useRealTimers();
});

describe('pinService.enablePin', () => {
  it('rechaza un PIN de menos de 6 digitos', async () => {
    await expect(pinService.enablePin('123', '123')).rejects.toMatchObject({ code: 'PIN_TOO_SHORT' });
  });

  it('rechaza un PIN con caracteres no numericos', async () => {
    await expect(pinService.enablePin('12a456', '12a456')).rejects.toMatchObject({
      code: 'PIN_NOT_DIGITS',
    });
  });

  it('rechaza si la confirmacion no coincide', async () => {
    await expect(pinService.enablePin('123456', '654321')).rejects.toMatchObject({
      code: 'PIN_MISMATCH',
    });
  });

  it('activa el PIN, guarda solo un verificador (nunca el PIN) y deja la app desbloqueada', async () => {
    await pinService.enablePin('123456', '123456');
    const security = await pinService.getSecurity();
    expect(security.pinEnabled).toBe(true);
    expect(security.pinVerifier).toBeTruthy();
    expect(security.pinVerifier).not.toContain('123456');
    expect(security.pinSalt).toBeTruthy();
    expect(security.pinKdfParams?.version).toBe(1);
    expect(isUnlocked()).toBe(true);
  });

  it('no permite activar un PIN si ya hay uno activo', async () => {
    await pinService.enablePin('123456', '123456');
    await expect(pinService.enablePin('111111', '111111')).rejects.toMatchObject({
      code: 'PIN_ALREADY_ENABLED',
    });
  });
});

describe('pinService.verifyPin', () => {
  beforeEach(async () => {
    await pinService.enablePin('123456', '123456');
    pinService.lock();
  });

  it('desbloquea con el PIN correcto', async () => {
    expect(isUnlocked()).toBe(false);
    await pinService.verifyPin('123456');
    expect(isUnlocked()).toBe(true);
  });

  it('rechaza un PIN incorrecto y cuenta el intento', async () => {
    await expect(pinService.verifyPin('000000')).rejects.toMatchObject({ code: 'PIN_INCORRECT' });
    const security = await pinService.getSecurity();
    expect(security.pinAttempts).toBe(1);
    expect(isUnlocked()).toBe(false);
  });

  it('aplica espera progresiva tras varios intentos fallidos', async () => {
    // Solo se falsea Date: fake-indexeddb/Dexie dependen de temporizadores reales para
    // resolver sus promesas internas, y vi.useFakeTimers() completo las deja colgadas.
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = new Date('2026-01-01T00:00:00.000Z');
    vi.setSystemTime(start);

    // Los dos primeros fallos no bloquean (backoff 0).
    await expect(pinService.verifyPin('000000')).rejects.toMatchObject({ code: 'PIN_INCORRECT' });
    await expect(pinService.verifyPin('000000')).rejects.toMatchObject({ code: 'PIN_INCORRECT' });
    // El tercer fallo activa espera (5s segun el backoff documentado).
    await expect(pinService.verifyPin('000000')).rejects.toMatchObject({ code: 'PIN_INCORRECT' });

    // Un intento inmediato (aun en espera), incluso con el PIN correcto, se rechaza por lockout.
    await expect(pinService.verifyPin('123456')).rejects.toMatchObject({ code: 'PIN_LOCKED_OUT' });

    // Tras esperar el tiempo suficiente, el PIN correcto ya funciona.
    vi.setSystemTime(new Date(start.getTime() + 6_000));
    await pinService.verifyPin('123456');
    expect(isUnlocked()).toBe(true);

    const security = await pinService.getSecurity();
    expect(security.pinAttempts).toBe(0);
    expect(security.pinLockedUntil).toBeNull();
  });
});

describe('pinService.lock', () => {
  it('bloqueo manual elimina la clave de memoria sin tocar el verificador', async () => {
    await pinService.enablePin('123456', '123456');
    expect(isUnlocked()).toBe(true);
    pinService.lock();
    expect(isUnlocked()).toBe(false);
    const security = await pinService.getSecurity();
    expect(security.pinEnabled).toBe(true);
  });
});

describe('pinService.changePin', () => {
  it('exige el PIN actual correcto', async () => {
    await pinService.enablePin('123456', '123456');
    await expect(pinService.changePin('000000', '111111', '111111')).rejects.toMatchObject({
      code: 'PIN_INCORRECT',
    });
  });

  it('rechaza un PIN nuevo igual al actual', async () => {
    await pinService.enablePin('123456', '123456');
    await expect(pinService.changePin('123456', '123456', '123456')).rejects.toMatchObject({
      code: 'PIN_SAME_AS_CURRENT',
    });
  });

  it('cambia el PIN: el antiguo deja de servir y el nuevo desbloquea', async () => {
    await pinService.enablePin('123456', '123456');
    await pinService.changePin('123456', '654321', '654321');
    pinService.lock();

    await expect(pinService.verifyPin('123456')).rejects.toMatchObject({ code: 'PIN_INCORRECT' });
    await pinService.verifyPin('654321');
    expect(isUnlocked()).toBe(true);
  });
});

describe('pinService.disablePin', () => {
  it('exige el PIN correcto y deja la app sin PIN', async () => {
    await pinService.enablePin('123456', '123456');
    await expect(pinService.disablePin('000000')).rejects.toMatchObject({ code: 'PIN_INCORRECT' });

    await pinService.disablePin('123456');
    const security = await pinService.getSecurity();
    expect(security.pinEnabled).toBe(false);
    expect(security.pinVerifier).toBeNull();
    expect(security.pinSalt).toBeNull();
  });
});

describe('pinService.recoverPinViaAccountReauth', () => {
  const OWNER_ID = 'owner-1111-1111-1111-111111111111';

  async function seedProfileOwnedBy(ownerUserId: string) {
    await db.profiles.add({
      id: `p-${ownerUserId}`,
      ownerUserId,
      name: 'Test',
      color: '#000',
      avatarEmoji: null,
      createdAt: 0,
      updatedAt: 0,
      archivedAt: null,
    });
  }

  it('activa un PIN nuevo si la cuenta reautenticada es dueña de un perfil de este dispositivo', async () => {
    await seedProfileOwnedBy(OWNER_ID);
    const reauthenticate = vi.fn().mockResolvedValue({ userId: OWNER_ID });
    await pinService.recoverPinViaAccountReauth('222222', '222222', reauthenticate);
    expect(reauthenticate).toHaveBeenCalledOnce();
    const security = await pinService.getSecurity();
    expect(security.pinEnabled).toBe(true);
    expect(isUnlocked()).toBe(true);
    await pinService.verifyPin('222222');
  });

  it('no guarda un PIN nuevo si la reautenticacion falla', async () => {
    const reauthenticate = vi.fn().mockRejectedValue(new Error('credenciales invalidas'));
    await expect(
      pinService.recoverPinViaAccountReauth('222222', '222222', reauthenticate),
    ).rejects.toThrow('credenciales invalidas');
    const security = await pinService.getSecurity();
    expect(security.pinEnabled).toBe(false);
    expect(isUnlocked()).toBe(false);
  });

  it('rechaza la recuperacion si la cuenta reautenticada NO es dueña de ningun perfil de este dispositivo (evita robo de dispositivo ajeno)', async () => {
    await seedProfileOwnedBy(OWNER_ID);
    const attackerReauthenticate = vi.fn().mockResolvedValue({ userId: 'attacker-9999' });

    await expect(
      pinService.recoverPinViaAccountReauth('222222', '222222', attackerReauthenticate),
    ).rejects.toMatchObject({ code: 'ACCOUNT_NOT_LINKED_TO_DEVICE' });

    const security = await pinService.getSecurity();
    expect(security.pinEnabled).toBe(false);
    expect(isUnlocked()).toBe(false);
    // No debe quedar ninguna sesion cifrada residual de la cuenta rechazada.
    expect(await db.encryptedSession.count()).toBe(0);
  });
});

describe('pinService.resetDeviceAndAllLocalData', () => {
  it('vacia todas las tablas y desactiva el PIN', async () => {
    await pinService.enablePin('123456', '123456');
    await db.profiles.add({
      id: 'p1',
      ownerUserId: null,
      name: 'Test',
      color: '#000',
      avatarEmoji: null,
      createdAt: 0,
      updatedAt: 0,
      archivedAt: null,
    });

    await pinService.resetDeviceAndAllLocalData();

    expect(await db.profiles.count()).toBe(0);
    expect(await db.deviceSecurity.count()).toBe(0);
    expect(isUnlocked()).toBe(false);
  });
});

describe('errores no filtran informacion sensible', () => {
  it('SecurityError nunca incluye el PIN en el mensaje', async () => {
    try {
      await pinService.enablePin('12a456', '12a456');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(SecurityError);
      expect((error as SecurityError).message).not.toContain('12a456');
    }
  });
});

describe('pinService: desbloqueo con biometria', () => {
  // Biometria simulada sin PRF: ejercita tambien el guardado de la clave local en Dexie.
  async function setup() {
    const { fakeAuthenticator, biometricTestDeps } = await import('../test/fakeAuthenticator');
    const { deviceKeyStore } = await import('./pinService');
    const auth = fakeAuthenticator({ prf: false });
    const deps = biometricTestDeps(auth, deviceKeyStore);
    await pinService.enablePin('123456', '123456');
    return { auth, deps };
  }

  it('exige el PIN correcto para activarla', async () => {
    const { deps } = await setup();
    await expect(pinService.enableBiometricUnlock('000000', deps)).rejects.toMatchObject({
      code: 'PIN_INCORRECT',
    });
    expect((await pinService.getSecurity()).biometricUnlock ?? null).toBeNull();
  });

  it('desbloquea la app sin teclear el PIN y nunca guarda el PIN en claro', async () => {
    const { deps } = await setup();
    await pinService.enableBiometricUnlock('123456', deps);
    const security = await pinService.getSecurity();
    expect(security.biometricUnlock?.mode).toBe('device-key');
    expect(JSON.stringify(security.biometricUnlock)).not.toContain('123456');

    pinService.lock();
    expect(isUnlocked()).toBe(false);
    await pinService.unlockWithBiometrics(deps);
    expect(isUnlocked()).toBe(true);
  });

  it('cambiar el PIN desactiva la biometria (habria guardado el PIN antiguo)', async () => {
    const { deps } = await setup();
    await pinService.enableBiometricUnlock('123456', deps);
    await pinService.changePin('123456', '654321', '654321');
    const security = await pinService.getSecurity();
    expect(security.biometricUnlock ?? null).toBeNull();
    expect(security.biometricDeviceKey ?? null).toBeNull();
    await expect(pinService.unlockWithBiometrics(deps)).rejects.toMatchObject({
      code: 'BIOMETRIC_NOT_ENABLED',
    });
  });

  it('desactivar el PIN quita tambien la biometria', async () => {
    const { deps } = await setup();
    await pinService.enableBiometricUnlock('123456', deps);
    await pinService.disablePin('123456');
    expect((await pinService.getSecurity()).biometricUnlock ?? null).toBeNull();
  });

  it('no se puede activar sin PIN', async () => {
    const { fakeAuthenticator, biometricTestDeps } = await import('../test/fakeAuthenticator');
    await expect(
      pinService.enableBiometricUnlock('123456', biometricTestDeps(fakeAuthenticator())),
    ).rejects.toMatchObject({ code: 'PIN_NOT_ENABLED' });
  });
});
