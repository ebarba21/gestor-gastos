// Tests de LockGate + LockScreen: sin datos financieros detras del bloqueo, accesible por
// teclado y lector de pantalla, desbloqueo con PIN (correcto/incorrecto), y que funciona
// offline (el desbloqueo con PIN es puramente local, sin red).
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { db } from '../../db/index';
import { AuthProvider } from '../../auth';
import { SecurityProvider } from '../../security/LockContext';
import { __resetLockStateForTests, setLockStatus } from '../../security/lockState';
import { __resetForTests as __resetSessionStorageForTests } from '../../security/encryptedSessionStorage';
import { pinService } from '../../security/pinService';
import { LockGate } from './LockGate';

const FINANCIAL_MARKER = 'SALDO SECRETO 1234,56 EUR';

function renderApp() {
  return render(
    <AuthProvider>
      <SecurityProvider>
        <LockGate>
          <div>{FINANCIAL_MARKER}</div>
        </LockGate>
      </SecurityProvider>
    </AuthProvider>,
  );
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  localStorage.clear();
  __resetLockStateForTests();
  __resetSessionStorageForTests();
});

describe('LockGate — sin PIN activo', () => {
  it('renderiza los hijos directamente (nada que desbloquear)', async () => {
    renderApp();
    expect(await screen.findByText(FINANCIAL_MARKER)).toBeInTheDocument();
  });
});

describe('LockGate — con PIN activo y bloqueada', () => {
  async function setUpLockedApp(pin = '123456') {
    await pinService.enablePin(pin, pin);
    pinService.lock();
    // Simula el arranque de la app: el boot ya fijo el estado antes de montar React.
    setLockStatus('locked');
  }

  it('muestra la pantalla bloqueada y NUNCA los datos financieros', async () => {
    await setUpLockedApp();
    renderApp();

    expect(await screen.findByLabelText('PIN')).toBeInTheDocument();
    expect(screen.queryByText(FINANCIAL_MARKER)).not.toBeInTheDocument();
  });

  it('el campo PIN tiene foco automatico y esta asociado a su label (accesibilidad)', async () => {
    await setUpLockedApp();
    renderApp();

    const input = await screen.findByLabelText('PIN');
    expect(input).toHaveFocus();
  });

  it('el boton de desbloquear esta deshabilitado sin PIN y se habilita al escribir', async () => {
    await setUpLockedApp();
    renderApp();
    const user = userEvent.setup();

    const button = screen.getByRole('button', { name: /desbloquear/i });
    expect(button).toBeDisabled();

    const input = await screen.findByLabelText('PIN');
    await user.type(input, '1');
    expect(button).toBeEnabled();
  });

  it('PIN incorrecto muestra un error accesible (role=alert) y no desbloquea', async () => {
    await setUpLockedApp();
    renderApp();
    const user = userEvent.setup();

    const input = await screen.findByLabelText('PIN');
    await user.type(input, '000000');
    await user.click(screen.getByRole('button', { name: /desbloquear/i }));

    const alert = await screen.findByRole('alert');
    await screen.findByText(/incorrecto/i);
    expect(alert).toHaveTextContent(/incorrecto/i);
    expect(screen.queryByText(FINANCIAL_MARKER)).not.toBeInTheDocument();
  });

  it('PIN correcto desbloquea y revela los hijos (operable enteramente por teclado)', async () => {
    await setUpLockedApp('654321');
    renderApp();
    const user = userEvent.setup();

    const input = await screen.findByLabelText('PIN');
    await user.type(input, '654321');
    await user.keyboard('{Enter}');

    expect(await screen.findByText(FINANCIAL_MARKER)).toBeInTheDocument();
  });

  it('el desbloqueo con PIN funciona offline (no depende de red)', async () => {
    const originalOnLine = window.navigator.onLine;
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
    try {
      await setUpLockedApp('111222');
      renderApp();
      const user = userEvent.setup();

      const input = await screen.findByLabelText('PIN');
      await user.type(input, '111222');
      await user.click(screen.getByRole('button', { name: /desbloquear/i }));

      expect(await screen.findByText(FINANCIAL_MARKER)).toBeInTheDocument();
    } finally {
      Object.defineProperty(window.navigator, 'onLine', {
        value: originalOnLine,
        configurable: true,
      });
    }
  });

  it('"Cerrar sesion de cuenta" y "He olvidado mi PIN" son accesibles desde la pantalla bloqueada', async () => {
    await setUpLockedApp();
    renderApp();

    expect(screen.getByRole('button', { name: /cerrar sesion de cuenta/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /he olvidado mi pin/i })).toBeInTheDocument();
  });
});
