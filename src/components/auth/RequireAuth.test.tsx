import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { RequireAuth } from './RequireAuth';
import type { AuthStatus } from '../../auth';

// Se controla el estado de sesion mockeando el hook de autenticacion.
let mockStatus: AuthStatus = 'loading';
vi.mock('../../auth', () => ({
  useAuth: () => ({ status: mockStatus }),
}));

function renderGuarded() {
  return render(
    <MemoryRouter initialEntries={['/privado']}>
      <Routes>
        <Route
          path="/privado"
          element={
            <RequireAuth>
              <div>CONTENIDO PRIVADO</div>
            </RequireAuth>
          }
        />
        <Route path="/cuenta" element={<div>PANTALLA DE CUENTA</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('RequireAuth (proteccion de rutas privadas)', () => {
  beforeEach(() => {
    mockStatus = 'loading';
  });

  it('muestra un estado de carga mientras se resuelve la sesion', () => {
    mockStatus = 'loading';
    renderGuarded();
    expect(screen.getByText(/comprobando sesion/i)).toBeInTheDocument();
  });

  it('renderiza el contenido cuando hay sesion', () => {
    mockStatus = 'signed-in';
    renderGuarded();
    expect(screen.getByText('CONTENIDO PRIVADO')).toBeInTheDocument();
  });

  it('redirige a /cuenta cuando no hay sesion', () => {
    mockStatus = 'signed-out';
    renderGuarded();
    expect(screen.getByText('PANTALLA DE CUENTA')).toBeInTheDocument();
    expect(screen.queryByText('CONTENIDO PRIVADO')).not.toBeInTheDocument();
  });

  it('redirige a /cuenta cuando Supabase no esta configurado (modo local)', () => {
    mockStatus = 'unconfigured';
    renderGuarded();
    expect(screen.getByText('PANTALLA DE CUENTA')).toBeInTheDocument();
  });
});
