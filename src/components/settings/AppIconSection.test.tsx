import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../../context/ToastContext';
import { AppIconSection } from './AppIconSection';
import { APP_ICONS, getStoredAppIcon } from '../../pwa/appIcon';

function renderSection() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <AppIconSection />
      </ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => localStorage.clear());

describe('AppIconSection', () => {
  it('muestra todas las opciones con la actual marcada', () => {
    renderSection();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(APP_ICONS.length);
    expect(screen.getByRole('radio', { name: 'Cartera clasica' })).toHaveAttribute('aria-checked', 'true');
  });

  it('al elegir otro icono lo guarda y explica como reinstalar avisando de los datos', async () => {
    renderSection();
    expect(screen.queryByText(/se borran sus datos/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Hucha' }));
    expect(getStoredAppIcon()).toBe('hucha');
    expect(screen.getByRole('radio', { name: 'Hucha' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(/se borran sus datos/)).toBeInTheDocument();
    expect(screen.getByText(/\?icono=hucha$/)).toBeInTheDocument();
  });
});
