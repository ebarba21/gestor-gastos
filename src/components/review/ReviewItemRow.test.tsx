// Tests de accesibilidad por teclado y semantica de ReviewItemRow (bandeja de revision,
// ampliacion fase 6): la casilla de seleccion y la apertura del detalle deben operarse sin
// raton (Tab + Espacio/Enter), con etiquetas legibles por lector de pantalla.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReviewItem } from '../../db/schema';
import { ReviewItemRow } from './ReviewItemRow';

function makeItem(overrides: Partial<ReviewItem> = {}): ReviewItem {
  return {
    id: 'item-1',
    profileId: 'profile-a',
    type: 'uncategorized',
    entityType: 'transaction',
    entityId: 'tx-1',
    confidence: 0,
    reasonCodes: [],
    metadata: {},
    status: 'open',
    resolution: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    resolvedAt: null,
    ...overrides,
  };
}

describe('ReviewItemRow: teclado y accesibilidad', () => {
  it('la casilla de seleccion se puede activar con el teclado (Espacio) y tiene etiqueta', async () => {
    const user = userEvent.setup();
    const onToggleSelect = vi.fn();
    render(
      <ul>
        <ReviewItemRow
          item={makeItem()}
          selected={false}
          onToggleSelect={onToggleSelect}
          onOpen={() => {}}
        />
      </ul>,
    );
    const checkbox = screen.getByRole('checkbox', { name: /seleccionar tarea/i });
    await user.tab();
    expect(checkbox).toHaveFocus();
    await user.keyboard(' ');
    expect(onToggleSelect).toHaveBeenCalledTimes(1);
  });

  it('el boton de la fila abre el detalle con Enter, tras Tab desde la casilla', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(
      <ul>
        <ReviewItemRow item={makeItem()} selected={false} onToggleSelect={() => {}} onOpen={onOpen} />
      </ul>,
    );
    await user.tab(); // casilla
    await user.tab(); // boton de la fila
    const button = screen.getByRole('button', { name: /sin categorizar/i });
    expect(button).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('muestra el tipo, la confianza y los motivos de forma legible', () => {
    render(
      <ul>
        <ReviewItemRow
          item={makeItem({
            type: 'possibleDuplicate',
            confidence: 850,
            reasonCodes: ['sameAccountAmountCurrency', 'sameMerchant'],
          })}
          selected={false}
          onToggleSelect={() => {}}
          onOpen={() => {}}
        />
      </ul>,
    );
    expect(screen.getByText('Posible duplicado')).toBeInTheDocument();
    expect(screen.getByText('85%')).toBeInTheDocument();
    expect(screen.getByText(/sameAccountAmountCurrency/)).toBeInTheDocument();
  });
});
