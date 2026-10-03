import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

const getSession = vi.fn(async () => ({ user: { id: 'u1' } }));
vi.mock('./authService', () => ({
  authService: {
    getSession: () => getSession(),
    onAuthStateChange: () => () => undefined,
  },
}));
vi.mock('../lib/supabase', () => ({
  resolveSupabaseConfig: () => ({ status: 'configured', config: {} }),
}));

const { AuthProvider, useAuth } = await import('./AuthContext');
const { setLockStatus, __resetLockStateForTests } = await import('../security/lockState');

let status = '';
function Probe() {
  status = useAuth().status;
  return null;
}

describe('AuthProvider con PIN', () => {
  beforeEach(() => {
    __resetLockStateForTests();
    getSession.mockClear();
  });

  it('no lee la sesion mientras la app esta bloqueada y la lee al desbloquear', async () => {
    setLockStatus('locked');
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(getSession).not.toHaveBeenCalled();
    expect(status).toBe('loading');

    setLockStatus('unlocked');
    await waitFor(() => expect(status).toBe('signed-in'));
  });

  it('sin PIN lee la sesion al arrancar', async () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(status).toBe('signed-in'));
  });
});
