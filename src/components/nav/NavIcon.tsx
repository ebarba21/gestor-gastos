// Iconos de la navegacion lateral. SVG EN LINEA, sin dependencias externas ni fuentes de
// iconos remotas (invariantes 1 y 3 de CLAUDE.md: sin red externa ni CDNs). Estilo trazo,
// 24x24, heredan el color con currentColor y el tamano via className.
import type { ReactNode, SVGProps } from 'react';

export type NavIconName =
  | 'dashboard'
  | 'movimientos'
  | 'importar'
  | 'reglas'
  | 'comercios'
  | 'bandeja'
  | 'conciliación'
  | 'recurrencias'
  | 'deudas'
  | 'categorías'
  | 'cuentas'
  | 'presupuestos'
  | 'exportar'
  | 'cuenta'
  | 'sincronización'
  | 'ajustes'
  | 'seguridad';

// Un path (o grupo de paths) por icono. Trazos simples y reconocibles.
const PATHS: Record<NavIconName, ReactNode> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </>
  ),
  movimientos: (
    <>
      <path d="m8 3-4 4 4 4" />
      <path d="M4 7h16" />
      <path d="m16 21 4-4-4-4" />
      <path d="M20 17H4" />
    </>
  ),
  importar: (
    <>
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </>
  ),
  reglas: <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />,
  comercios: (
    <>
      <path d="m2 7 2-4h16l2 4" />
      <path d="M4 7v13a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V7" />
      <path d="M2 7h20" />
      <path d="M9 21v-6h6v6" />
    </>
  ),
  bandeja: (
    <>
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </>
  ),
  conciliación: (
    <>
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
      <path d="m9 11 3 3L22 4" />
    </>
  ),
  recurrencias: (
    <>
      <path d="m17 2 4 4-4 4" />
      <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
      <path d="m7 22-4-4 4-4" />
      <path d="M21 13v1a4 4 0 0 1-4 4H3" />
    </>
  ),
  deudas: (
    <>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M2 10h20" />
    </>
  ),
  categorías: (
    <>
      <path d="M20.59 13.41 13.42 20.59a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <path d="M7 7h.01" />
    </>
  ),
  cuentas: (
    <>
      <path d="M3 21h18" />
      <path d="m5 6 7-3 7 3" />
      <path d="M4 10h16" />
      <path d="M5 10v11" />
      <path d="M19 10v11" />
      <path d="M9 10v11" />
      <path d="M15 10v11" />
    </>
  ),
  presupuestos: (
    <>
      <path d="M21.21 15.89A10 10 0 1 1 8 2.83" />
      <path d="M22 12A10 10 0 0 0 12 2v10z" />
    </>
  ),
  exportar: (
    <>
      <path d="M12 15V3" />
      <path d="m7 8 5-5 5 5" />
      <path d="M5 21h14a2 2 0 0 0 2-2v-4" />
      <path d="M3 15v4a2 2 0 0 0 2 2" />
    </>
  ),
  cuenta: (
    <>
      <path d="M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" />
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
    </>
  ),
  sincronización: (
    <>
      <path d="M21 2v6h-6" />
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M3 22v-6h6" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
    </>
  ),
  ajustes: (
    <>
      <path d="M21 4h-7" />
      <path d="M10 4H3" />
      <path d="M21 12h-9" />
      <path d="M8 12H3" />
      <path d="M21 20h-5" />
      <path d="M12 20H3" />
      <path d="M14 2v4" />
      <path d="M8 10v4" />
      <path d="M16 18v4" />
    </>
  ),
  seguridad: (
    <>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
};

export function NavIcon({
  name,
  className,
  ...props
}: { name: NavIconName } & SVGProps<SVGSVGElement>): React.ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...props}
    >
      {PATHS[name]}
    </svg>
  );
}
