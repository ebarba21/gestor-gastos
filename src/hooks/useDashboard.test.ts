// Tests del selector de periodo del dashboard frente a los graficos mensuales: elegir un mes
// desde un grafico lo fija como periodo sin desplazar la ventana, y cualquier cambio hecho
// con el selector suelta esa ventana fijada.
import { act, renderHook, waitFor } from '@testing-library/react';
import type { DashboardParams } from '../services/statsService';

const computeDashboard = vi.fn();

vi.mock('./useProfiles', () => ({ useActiveProfileId: () => 'perfil-a' }));
vi.mock('../services/statsService', () => ({
  statsService: {
    computeDashboard: (profileId: string, params: DashboardParams) => computeDashboard(profileId, params),
  },
}));
vi.mock('../services/categoryService', () => ({ categoryService: { listAll: async () => [] } }));
vi.mock('../services/accountService', () => ({ accountService: { listAll: async () => [] } }));
vi.mock('../services/merchantService', () => ({ merchantService: { list: async () => [] } }));
vi.mock('../lib/dates', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/dates')>()),
  todayISO: () => '2026-10-27',
}));

import { useDashboard } from './useDashboard';

function lastParams(): DashboardParams {
  const calls = computeDashboard.mock.calls;
  return calls[calls.length - 1]![1] as DashboardParams;
}

beforeEach(() => {
  computeDashboard.mockReset();
  computeDashboard.mockResolvedValue({ hasData: false });
});

describe('useDashboard: elegir un mes desde un grafico', () => {
  it('fija el mes como periodo y deja la ventana donde estaba', async () => {
    const { result } = renderHook(() => useDashboard());
    await waitFor(() => expect(computeDashboard).toHaveBeenCalled());
    expect(lastParams().windowAnchorISO).toBeUndefined();

    act(() => result.current.selectMonth('2026-06'));
    await waitFor(() => expect(lastParams().anchorISO).toBe('2026-06-15'));
    expect(lastParams().range).toEqual({ from: '2026-06-01', to: '2026-06-30' });
    expect(lastParams().windowAnchorISO).toBe('2026-10-27');

    // Elegir otro mes mantiene la misma ventana (no se encadenan desplazamientos).
    act(() => result.current.selectMonth('2026-03'));
    await waitFor(() => expect(lastParams().anchorISO).toBe('2026-03-15'));
    expect(lastParams().windowAnchorISO).toBe('2026-10-27');
  });

  it('cambiar el periodo con el selector suelta la ventana fijada', async () => {
    const { result } = renderHook(() => useDashboard());
    await waitFor(() => expect(computeDashboard).toHaveBeenCalled());

    act(() => result.current.selectMonth('2026-06'));
    await waitFor(() => expect(lastParams().windowAnchorISO).toBe('2026-10-27'));

    act(() => result.current.setReferenceMonths(-1));
    await waitFor(() => expect(lastParams().anchorISO).toBe('2026-05-15'));
    expect(lastParams().windowAnchorISO).toBeUndefined();

    act(() => result.current.selectMonth('2026-04'));
    await waitFor(() => expect(lastParams().windowAnchorISO).toBe('2026-05-15'));
    act(() => result.current.resetReference());
    await waitFor(() => expect(lastParams().anchorISO).toBe('2026-10-27'));
    expect(lastParams().windowAnchorISO).toBeUndefined();
  });

  it('desde un rango personalizado pasa a modo mes', async () => {
    const { result } = renderHook(() => useDashboard());
    await waitFor(() => expect(computeDashboard).toHaveBeenCalled());
    act(() => result.current.setMode('custom'));
    await waitFor(() => expect(result.current.mode).toBe('custom'));

    act(() => result.current.selectMonth('2026-09'));
    await waitFor(() => expect(result.current.mode).toBe('month'));
    expect(lastParams().range).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  });

  it('ignora claves de mes mal formadas', async () => {
    const { result } = renderHook(() => useDashboard());
    await waitFor(() => expect(computeDashboard).toHaveBeenCalled());
    const before = computeDashboard.mock.calls.length;
    act(() => result.current.selectMonth('junio'));
    expect(computeDashboard.mock.calls.length).toBe(before);
    expect(result.current.referenceISO).toBe('2026-10-27');
  });
});
