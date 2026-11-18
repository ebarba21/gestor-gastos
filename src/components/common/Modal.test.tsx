import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Modal } from './Modal';
import { activeScrollLocks, lockDocumentScroll } from '../../lib/scrollLock';

describe('Modal', () => {
  it('bloquea el scroll del fondo mientras esta abierto y lo restaura al cerrar', () => {
    const { rerender } = render(
      <Modal open onClose={() => {}} title="Prueba">
        contenido
      </Modal>,
    );
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.documentElement.style.overflow).toBe('hidden');

    rerender(
      <Modal open={false} onClose={() => {}} title="Prueba">
        contenido
      </Modal>,
    );
    expect(document.body.style.overflow).toBe('');
    expect(document.documentElement.style.overflow).toBe('');
    expect(activeScrollLocks()).toBe(0);
  });

  it('con modales anidados el fondo sigue bloqueado hasta cerrar el ultimo', () => {
    const { rerender } = render(
      <>
        <Modal open onClose={() => {}} title="A">a</Modal>
        <Modal open onClose={() => {}} title="B">b</Modal>
      </>,
    );
    rerender(
      <>
        <Modal open onClose={() => {}} title="A">a</Modal>
        <Modal open={false} onClose={() => {}} title="B">b</Modal>
      </>,
    );
    expect(document.body.style.overflow).toBe('hidden');
    rerender(
      <>
        <Modal open={false} onClose={() => {}} title="A">a</Modal>
        <Modal open={false} onClose={() => {}} title="B">b</Modal>
      </>,
    );
    expect(document.body.style.overflow).toBe('');
  });

  it('el overlay es el contenedor desplazable y el panel no limita su altura', () => {
    render(
      <Modal open onClose={() => {}} title="Lista larga">
        contenido
      </Modal>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Lista larga' });
    expect(dialog.className).not.toContain('overflow-y-auto');
    expect(dialog.className).not.toContain('max-h-');
    const overlay = screen.getByRole('presentation');
    expect(overlay.className).toContain('overflow-y-auto');
  });

  it('cierra al pulsar el fondo pero no al pulsar dentro del panel', () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Cierre">
        <span>dentro</span>
      </Modal>,
    );
    fireEvent.click(screen.getByText('dentro'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('presentation'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('liberar dos veces el mismo bloqueo no descuadra el contador', () => {
    const release = lockDocumentScroll();
    release();
    release();
    expect(activeScrollLocks()).toBe(0);
  });
});
