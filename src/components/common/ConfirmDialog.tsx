// Dialogo de confirmacion reutilizable con una o varias acciones. Cada boton ejecuta su
// onClick (posible async); si lanza, se muestra el error y el dialogo permanece abierto;
// si va bien, se cierra. Sirve para borrar (destructivo), archivar como alternativa, etc.
import { useEffect, useState, type ReactNode } from 'react';
import { Modal } from './Modal';

export interface DialogButton {
  label: string;
  variant?: 'danger' | 'primary' | 'ghost';
  // Si se omite onClick, el boton solo cierra el dialogo.
  onClick?: () => Promise<void> | void;
}

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  message: ReactNode;
  buttons: DialogButton[];
}

const VARIANT_CLASSES: Record<NonNullable<DialogButton['variant']>, string> = {
  danger: 'bg-red-600 text-white hover:bg-red-500',
  primary: 'bg-indigo-600 text-white hover:bg-indigo-500',
  ghost: 'text-slate-300 hover:bg-slate-800',
};

export function ConfirmDialog({ open, onClose, title, message, buttons }: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setBusy(false);
      setError(null);
    }
  }, [open]);

  async function run(button: DialogButton) {
    if (busy) return;
    if (!button.onClick) {
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await button.onClick();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'La operación ha fallado.');
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={title} dismissible={!busy}>
      <div className="space-y-4">
        <div className="text-sm text-slate-300">{message}</div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          {buttons.map((button) => (
            <button
              key={button.label}
              type="button"
              disabled={busy}
              onClick={() => run(button)}
              className={`rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50 ${
                VARIANT_CLASSES[button.variant ?? 'ghost']
              }`}
            >
              {button.label}
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
