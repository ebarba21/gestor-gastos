import { beforeEach, describe, expect, it } from 'vitest';
import {
  derEcdsaToRaw,
  enrollBiometricUnlock,
  unlockWithBiometrics,
  biometricLabel,
} from './biometricUnlock';
import { SecurityError } from './errors';
import { biometricTestDeps as deps, fakeAuthenticator, memoryKeyStore, rawToDer } from '../test/fakeAuthenticator';

describe('desbloqueo biometrico', () => {
  let auth: ReturnType<typeof fakeAuthenticator>;
  beforeEach(() => {
    auth = fakeAuthenticator();
  });

  it('modo PRF: guarda el PIN cifrado (nunca en claro) y lo recupera con la biometria', async () => {
    const config = await enrollBiometricUnlock('482915', deps(auth));
    expect(config.mode).toBe('prf');
    expect(JSON.stringify(config)).not.toContain('482915');
    expect(await unlockWithBiometrics(config, deps(auth))).toBe('482915');
  });

  it('sin PRF usa una clave local no extraible', async () => {
    const noPrf = fakeAuthenticator({ prf: false });
    const store = memoryKeyStore();
    const config = await enrollBiometricUnlock('123456', deps(noPrf, store));
    expect(config.mode).toBe('device-key');
    expect(store.key?.extractable).toBe(false);
    expect(await unlockWithBiometrics(config, deps(noPrf, store))).toBe('123456');
  });

  it('rechaza una asercion sin verificacion de usuario (sin cara ni huella)', async () => {
    const config = await enrollBiometricUnlock('123456', deps(auth));
    auth.options.uv = false;
    await expect(unlockWithBiometrics(config, deps(auth))).rejects.toMatchObject({ code: 'BIOMETRIC_INVALID' });
  });

  it('rechaza una firma manipulada', async () => {
    const noPrf = fakeAuthenticator({ prf: false });
    const store = memoryKeyStore();
    const config = await enrollBiometricUnlock('123456', deps(noPrf, store));
    noPrf.options.tamperSignature = true;
    await expect(unlockWithBiometrics(config, deps(noPrf, store))).rejects.toMatchObject({ code: 'BIOMETRIC_INVALID' });
  });

  it('rechaza una asercion emitida para otro origen', async () => {
    const config = await enrollBiometricUnlock('123456', deps(auth));
    auth.options.origin = 'https://evil.example';
    await expect(unlockWithBiometrics(config, deps(auth))).rejects.toMatchObject({ code: 'BIOMETRIC_INVALID' });
  });

  it('si la persona cancela devuelve un error claro y no desbloquea', async () => {
    const config = await enrollBiometricUnlock('123456', deps(auth));
    auth.options.cancel = true;
    await expect(unlockWithBiometrics(config, deps(auth))).rejects.toMatchObject({ code: 'BIOMETRIC_CANCELLED' });
  });

  it('no funciona con la configuracion de otra direccion de la app', async () => {
    const config = await enrollBiometricUnlock('123456', deps(auth));
    await expect(
      unlockWithBiometrics({ ...config, rpId: 'otro.example' }, deps(auth)),
    ).rejects.toBeInstanceOf(SecurityError);
  });

  it('derEcdsaToRaw normaliza enteros con cero inicial', () => {
    const r = new Uint8Array(32).fill(0x80);
    const s = new Uint8Array(32).fill(0x01);
    s[0] = 0;
    const raw = new Uint8Array([...r, ...s]);
    expect(Array.from(derEcdsaToRaw(rawToDer(raw)))).toEqual(Array.from(raw));
  });

  it('nombra la biometria segun el dispositivo', () => {
    expect(biometricLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe('Face ID / Touch ID');
    expect(biometricLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('Windows Hello');
  });
});

