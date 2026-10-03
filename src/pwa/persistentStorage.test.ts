import { describe, expect, it, vi } from 'vitest';
import { requestPersistentStorage } from './persistentStorage';

describe('requestPersistentStorage', () => {
  it('devuelve unsupported si no hay StorageManager', async () => {
    expect(await requestPersistentStorage(undefined)).toBe('unsupported');
    expect(await requestPersistentStorage({})).toBe('unsupported');
  });

  it('no vuelve a pedir si ya es persistente', async () => {
    const persist = vi.fn(async () => true);
    const state = await requestPersistentStorage({ persisted: async () => true, persist });
    expect(state).toBe('persisted');
    expect(persist).not.toHaveBeenCalled();
  });

  it('pide persistencia y refleja la respuesta del navegador', async () => {
    expect(
      await requestPersistentStorage({ persisted: async () => false, persist: async () => true }),
    ).toBe('persisted');
    expect(
      await requestPersistentStorage({ persisted: async () => false, persist: async () => false }),
    ).toBe('not-persisted');
  });

  it('nunca lanza aunque la API falle', async () => {
    const state = await requestPersistentStorage({
      persist: async () => {
        throw new Error('boom');
      },
    });
    expect(state).toBe('not-persisted');
  });
});
