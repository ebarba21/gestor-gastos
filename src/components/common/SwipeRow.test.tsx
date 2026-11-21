import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SwipeRow, swipeOutcome } from './SwipeRow';

describe('swipeOutcome', () => {
  it('dispara la accion solo al pasar el umbral', () => {
    expect(swipeOutcome(79)).toBeNull();
    expect(swipeOutcome(80)).toBe('leading');
    expect(swipeOutcome(-80)).toBe('trailing');
    expect(swipeOutcome(-20)).toBeNull();
  });
});

describe('SwipeRow', () => {
  function setup() {
    const leading = vi.fn();
    const trailing = vi.fn();
    const click = vi.fn();
    render(
      <SwipeRow
        leading={{ label: 'Resolver', className: '', onTrigger: leading }}
        trailing={{ label: 'Descartar', className: '', onTrigger: trailing }}
      >
        <button type="button" onClick={click}>
          fila
        </button>
      </SwipeRow>,
    );
    const surface = screen.getByText('fila').parentElement!;
    return { leading, trailing, click, surface };
  }

  it('un deslizamiento tactil a la derecha ejecuta la accion principal y no el toque', () => {
    const { leading, trailing, click, surface } = setup();
    fireEvent.pointerDown(surface, { pointerType: 'touch', pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(surface, { pointerType: 'touch', pointerId: 1, clientX: 60, clientY: 12 });
    fireEvent.pointerMove(surface, { pointerType: 'touch', pointerId: 1, clientX: 120, clientY: 12 });
    fireEvent.pointerUp(surface, { pointerType: 'touch', pointerId: 1, clientX: 120, clientY: 12 });
    fireEvent.click(screen.getByText('fila'));
    expect(leading).toHaveBeenCalledTimes(1);
    expect(trailing).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
  });

  it('un desplazamiento vertical no dispara nada', () => {
    const { leading, trailing, surface } = setup();
    fireEvent.pointerDown(surface, { pointerType: 'touch', pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(surface, { pointerType: 'touch', pointerId: 1, clientX: 30, clientY: 120 });
    fireEvent.pointerMove(surface, { pointerType: 'touch', pointerId: 1, clientX: 120, clientY: 130 });
    fireEvent.pointerUp(surface, { pointerType: 'touch', pointerId: 1 });
    expect(leading).not.toHaveBeenCalled();
    expect(trailing).not.toHaveBeenCalled();
  });

  it('con raton la fila se comporta como siempre', () => {
    const { leading, click, surface } = setup();
    fireEvent.pointerDown(surface, { pointerType: 'mouse', pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(surface, { pointerType: 'mouse', pointerId: 1, clientX: 150, clientY: 10 });
    fireEvent.pointerUp(surface, { pointerType: 'mouse', pointerId: 1 });
    fireEvent.click(screen.getByText('fila'));
    expect(leading).not.toHaveBeenCalled();
    expect(click).toHaveBeenCalledTimes(1);
  });
});
