import { describe, it, expect } from 'vitest';
import {
  resolveSupabaseConfig,
  assertNoServiceRoleInEnv,
  SupabaseConfigError,
  SUPABASE_URL_ENV,
  SUPABASE_PUBLISHABLE_KEY_ENV,
} from './env';

describe('resolveSupabaseConfig', () => {
  it('modo local: sin variables devuelve unconfigured (no es error)', () => {
    expect(resolveSupabaseConfig({}).status).toBe('unconfigured');
  });

  it('completo y valido devuelve configured con la config', () => {
    const result = resolveSupabaseConfig({
      [SUPABASE_URL_ENV]: 'https://abc.supabase.co',
      [SUPABASE_PUBLISHABLE_KEY_ENV]: 'pk_test_123',
    });
    expect(result.status).toBe('configured');
    if (result.status === 'configured') {
      expect(result.config.url).toBe('https://abc.supabase.co');
      expect(result.config.publishableKey).toBe('pk_test_123');
    }
  });

  it('configuracion a medias (solo clave) es invalida con motivo claro', () => {
    const result = resolveSupabaseConfig({ [SUPABASE_PUBLISHABLE_KEY_ENV]: 'pk_test_123' });
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') expect(result.reason).toContain(SUPABASE_URL_ENV);
  });

  it('configuracion a medias (solo URL) es invalida con motivo claro', () => {
    const result = resolveSupabaseConfig({ [SUPABASE_URL_ENV]: 'https://abc.supabase.co' });
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') expect(result.reason).toContain(SUPABASE_PUBLISHABLE_KEY_ENV);
  });

  it('URL no https se rechaza como invalida', () => {
    const result = resolveSupabaseConfig({
      [SUPABASE_URL_ENV]: 'http://abc.supabase.co',
      [SUPABASE_PUBLISHABLE_KEY_ENV]: 'pk_test_123',
    });
    expect(result.status).toBe('invalid');
  });

  it('ignora espacios en blanco alrededor de los valores', () => {
    const result = resolveSupabaseConfig({
      [SUPABASE_URL_ENV]: '  https://abc.supabase.co  ',
      [SUPABASE_PUBLISHABLE_KEY_ENV]: '  pk  ',
    });
    expect(result.status).toBe('configured');
  });
});

describe('assertNoServiceRoleInEnv', () => {
  it('no lanza cuando solo hay variables VITE_ publicas', () => {
    expect(() =>
      assertNoServiceRoleInEnv({
        [SUPABASE_URL_ENV]: 'https://abc.supabase.co',
        [SUPABASE_PUBLISHABLE_KEY_ENV]: 'pk',
      }),
    ).not.toThrow();
  });

  it('lanza si se expone un service_role al cliente', () => {
    expect(() =>
      assertNoServiceRoleInEnv({ VITE_SUPABASE_SERVICE_ROLE_KEY: 'sr_secret' }),
    ).toThrow(SupabaseConfigError);
  });

  it('lanza ante cualquier VITE_ con SECRET/SERVICE en el nombre', () => {
    expect(() => assertNoServiceRoleInEnv({ VITE_MY_SECRET: 'x' })).toThrow(SupabaseConfigError);
    expect(() => assertNoServiceRoleInEnv({ VITE_DB_SERVICE_KEY: 'x' })).toThrow(
      SupabaseConfigError,
    );
  });

  it('ignora variables no VITE_ (no llegan al bundle)', () => {
    expect(() => assertNoServiceRoleInEnv({ SUPABASE_SERVICE_ROLE_KEY: 'x' })).not.toThrow();
  });
});
