// Modal accesible minimo: overlay + panel centrado. Cierra con Escape y con click en
// el fondo. Solo presentacion; sin logica de negocio.
//
// Scroll: el que se desplaza es el overlay a pantalla completa, no el panel. En iOS (sobre
// todo con la PWA instalada) un panel con overflow propio dentro de una capa fija no recibia
// el gesto y no se podia hacer scroll en listas largas. Ademas se bloquea el scroll del fondo
// y se respetan las zonas seguras para que el titulo no quede bajo la hora y la bateria.
import { useEffect, type ReactNode } from 'react';
import { lockDocumentScroll } from '../../lib/scrollLock';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  // Deshabilita cerrar por Escape/fondo cuando hay una operacion en curso.
  dismissible?: boolean;
}

export function Modal({ open, onClose, title, children, dismissible = true }: ModalProps) {
  useEffect(() => {
    if (!open || !dismissible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, dismissible, onClose]);

  useEffect(() => {
    if (!open) return;
    return lockDocumentScroll();
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-40 overflow-y-auto overscroll-contain bg-black/60"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
        WebkitOverflowScrolling: 'touch',
      }}
      onClick={dismissible ? onClose : undefined}
      role="presentation"
    >
      <div className="flex min-h-full items-center justify-center p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-4 shadow-2xl sm:p-6"
          onClick={(e) => e.stopPropagation()}
        >
          <h3 className="text-lg font-semibold text-slate-100">{title}</h3>
          <div className="mt-4">{children}</div>
        </div>
      </div>
    </div>
  );
}
