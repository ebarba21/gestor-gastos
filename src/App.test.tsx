import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach } from 'vitest';
import App from './App';
import { db } from './db';
import { ProfileProvider } from './context/ProfileContext';
import { ToastProvider } from './context/ToastContext';
import { ThemeProvider } from './context/ThemeContext';
import { profileService } from './services/profileService';

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  localStorage.clear();
});

function renderApp() {
  return render(
    <ThemeProvider>
      <ToastProvider>
        <ProfileProvider>
          <MemoryRouter initialEntries={['/']}>
            <App />
          </MemoryRouter>
        </ProfileProvider>
      </ToastProvider>
    </ThemeProvider>,
  );
}

describe('App', () => {
  it('sin perfiles muestra la pantalla de creacion de perfil', async () => {
    renderApp();
    // El gate fuerza la creacion del primer perfil; no hay navegacion aun.
    expect(await screen.findByText('Crear primer perfil')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Dashboard' })).not.toBeInTheDocument();
  });

  it('con un perfil activo renderiza la navegacion y el Dashboard', async () => {
    const profile = await profileService.createProfile({ name: 'Personal' });
    profileService.setActiveProfileId(profile.id);

    renderApp();

    // Tras resolver el perfil activo, aparece la navegacion principal.
    expect(await screen.findByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Movimientos' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ajustes' })).toBeInTheDocument();

    // La ruta inicial ("/") renderiza el Dashboard.
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
  });
});
