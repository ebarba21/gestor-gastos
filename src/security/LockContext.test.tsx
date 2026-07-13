// Test de regresion: la recuperacion de PIN desde la pantalla bloqueada NO puede depender de
// una sesion ya conocida (auth.reauthenticate), porque en ese punto normalmente NO hay sesion
// viva (auth.status suele ser 'signed-out': es precisamente por eso que esta bloqueada). Debe
// usar auth.signIn(email, password) en su lugar. Se mockea useAuth para poder comprobar
// exactamente que metodo se invoca, sin depender de un backend Supabase real.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { db } from '../db/index';
import { SecurityProvider, useLock } from './LockContext';
import { __resetLockStateForTests } from './lockState';
import { __resetForTests as __resetSessionStorageForTests } from './encryptedSessionStorage';

// Vitest exige el prefijo "mock" en variables referenciadas dentro de vi.mock (hoisting).
const mockSignIn = vi.fn();
const mockReauthenticate = vi.fn();

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    status: 'signed-out',
    signIn: mockSignIn,
    reauthenticate: mockReauthenticate,
  }),
}));

function RecoverButton() {
  const lock = useLock();
  return (
    <button
      type="button"
      onClick={() => void lock.recoverPinViaAccountReauth('a@test.local', 'password123', '222222', '222222')}
    >
      recover
    </button>
  );
}

const RECOVERED_USER_ID = 'user-recovered-1111-1111-111111111111';

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  __resetLockStateForTests();
  __resetSessionStorageForTests();
  mockSignIn.mockReset().mockResolvedValue({ user: { id: RECOVERED_USER_ID } });
  mockReauthenticate.mockReset();
});

describe('LockContext.recoverPinViaAccountReauth', () => {
  it('usa auth.signIn(email, password), nunca auth.reauthenticate', async () => {
    // La cuenta reautenticada debe ser dueña de un perfil de este dispositivo (pinService
    // rechaza si no: ver pinService.test.ts "rechaza la recuperacion si la cuenta... ajena").
    await db.profiles.add({
      id: 'p1',
      ownerUserId: RECOVERED_USER_ID,
      name: 'Test',
      color: '#000',
      avatarEmoji: null,
      createdAt: 0,
      updatedAt: 0,
      archivedAt: null,
    });

    render(
      <SecurityProvider>
        <RecoverButton />
      </SecurityProvider>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'recover' }));

    // La derivacion PBKDF2 del PIN (210k iteraciones) tarda mas que un microtask: se espera a
    // que el mock reciba la llamada en vez de asumir que ya ocurrio tras el click.
    await waitFor(() => expect(mockSignIn).toHaveBeenCalledWith('a@test.local', 'password123'));
    expect(mockReauthenticate).not.toHaveBeenCalled();
  });
});
