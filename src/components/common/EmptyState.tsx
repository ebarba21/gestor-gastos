// Estado vacio reutilizable: icono/emoji, titulo, descripcion y una accion opcional.
// Se usa cuando el perfil activo aun no tiene datos (ARCHITECTURE.md seccion 8, punto 5
// del alcance de fase 2).
import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ icon = '📄', title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-700 bg-slate-900/40 px-6 py-12 text-center">
      <span className="text-4xl" aria-hidden>
        {icon}
      </span>
      <h3 className="mt-4 text-lg font-semibold text-slate-100">{title}</h3>
      {description && <p className="mt-2 max-w-md text-sm text-slate-400">{description}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
