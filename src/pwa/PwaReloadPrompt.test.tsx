// Tests del ciclo de vida PWA en UI: aviso de nueva version (actualizar/descartar) y
// toast de "offline listo". El modulo virtual del plugin se mockea porque solo existe
// dentro del build de Vite.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '../context/ToastContext';
import { PwaReloadPrompt } from './PwaReloadPrompt';

const updateServiceWorker = vi.fn();
const setOfflineReady = vi.fn();
const setNeedRefresh = vi.fn();
let mockState = { offlineReady: false, needRefresh: false };

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    offlineReady: [mockState.offlineReady, setOfflineReady],
    needRefresh: [mockState.needRefresh, setNeedRefresh],
    updateServiceWorker,
  }),
}));

function renderPrompt() {
  return render(
    <ToastProvider>
      <PwaReloadPrompt />
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockState = { offlineReady: false, needRefresh: false };
});

describe('PwaReloadPrompt', () => {
  it('sin novedades del service worker no muestra nada', () => {
    renderPrompt();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.queryByText(/sin conexion/)).not.toBeInTheDocument();
  });

  it('cuando el precache esta listo avisa con un toast y consume el flag', () => {
    mockState.offlineReady = true;
    renderPrompt();
    expect(screen.getByText('App lista para funcionar sin conexion.')).toBeInTheDocument();
    expect(setOfflineReady).toHaveBeenCalledWith(false);
  });

  it('con una version nueva muestra el aviso y Actualizar aplica el SW nuevo', async () => {
    mockState.needRefresh = true;
    renderPrompt();
    const user = userEvent.setup();

    expect(
      screen.getByRole('alertdialog', { name: 'Nueva version disponible' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Actualizar' }));
    expect(updateServiceWorker).toHaveBeenCalledWith(true);
  });

  it('Ahora no descarta el aviso sin actualizar', async () => {
    mockState.needRefresh = true;
    renderPrompt();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Ahora no' }));
    expect(setNeedRefresh).toHaveBeenCalledWith(false);
    expect(updateServiceWorker).not.toHaveBeenCalled();
  });
});
