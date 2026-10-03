import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Profile } from '../../db/schema';

const authState: {
  status: string;
  user: { id: string; email: string } | null;
  signOut: () => Promise<void>;
} = { status: 'signed-out', user: null, signOut: vi.fn(async () => undefined) };
let profilesState: Partial<Profile>[] = [];

vi.mock('../../auth', () => ({ useAuthOptional: () => authState }));
vi.mock('../auth', () => ({ AccountPanel: () => <div>panel-de-cuenta</div> }));
vi.mock('../../sync/SyncContext', () => ({ useSyncOptional: () => ({ client: {} }) }));
vi.mock('../../sync', () => ({ rebuildDevice: vi.fn(async () => ({ profiles: 0, rows: 0 })) }));
vi.mock('../../hooks/useProfiles', () => ({
  useProfiles: () => ({ profiles: profilesState, reload: vi.fn(async () => undefined) }),
}));

const { CloudAccessCard } = await import('./CloudAccessCard');

describe('CloudAccessCard (acceso a la cuenta desde el selector de perfil)', () => {
  beforeEach(() => {
    profilesState = [];
  });

  it('no aparece si la app no tiene cuenta configurada', () => {
    authState.status = 'unconfigured';
    const { container } = render(<CloudAccessCard />);
    expect(container).toBeEmptyDOMElement();
  });

  it('sin sesion permite iniciar sesion o crear cuenta sin crear un perfil antes', async () => {
    authState.status = 'signed-out';
    authState.user = null;
    render(<CloudAccessCard />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Iniciar sesion o crear cuenta' }));
    expect(screen.getByText('panel-de-cuenta')).toBeInTheDocument();
  });

  it('con sesion y sin perfiles de la cuenta ofrece descargar los datos', async () => {
    authState.status = 'signed-in';
    authState.user = { id: 'u1', email: 'eric@example.com' };
    profilesState = [{ id: 'p-local', ownerUserId: null }];
    render(<CloudAccessCard />);
    expect(screen.getByText('eric@example.com')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Descargar mis datos' }));
    expect(await screen.findByText(/aun no tiene datos guardados/)).toBeInTheDocument();
  });

  it('con perfiles de la cuenta ya presentes no ofrece descargar, solo cerrar sesion', () => {
    authState.status = 'signed-in';
    authState.user = { id: 'u1', email: 'eric@example.com' };
    profilesState = [{ id: 'p1', ownerUserId: 'u1' }];
    render(<CloudAccessCard />);
    expect(screen.queryByRole('button', { name: 'Descargar mis datos' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cerrar sesion' })).toBeInTheDocument();
  });
});
