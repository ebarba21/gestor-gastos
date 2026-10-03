import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MobileNav } from './MobileNav';
import { NAV_GROUPS, NAV_ITEMS } from './navItems';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="*" element={<MobileNav />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('MobileNav', () => {
  it('muestra las pestanas de uso diario y el boton Mas', () => {
    renderAt('/');
    const nav = screen.getByRole('navigation', { name: 'Navegacion principal' });
    for (const label of ['Inicio', 'Movimientos', 'Presupuestos', 'Bandeja']) {
      expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument();
    }
    expect(within(nav).getByRole('button', { name: 'Mas' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('el panel Mas da acceso a todas las secciones y se cierra al navegar', async () => {
    const user = userEvent.setup();
    renderAt('/');
    await user.click(screen.getByRole('button', { name: 'Mas' }));
    const panel = screen.getByRole('dialog', { name: 'Todas las secciones' });
    const links = within(panel).getAllByRole('link');
    expect(links).toHaveLength(NAV_ITEMS.length);
    await user.click(within(panel).getByRole('link', { name: 'Deudas' }));
    expect(screen.queryByRole('dialog', { name: 'Todas las secciones' })).not.toBeInTheDocument();
  });

  it('los grupos cubren exactamente las mismas secciones que la barra lateral', () => {
    const grouped = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.to)).sort();
    const flat = NAV_ITEMS.map((i) => i.to).sort();
    expect(grouped).toEqual(flat);
  });
});
