// Secciones de la app. Fuente unica para la barra lateral (PC) y la navegacion movil.
export interface NavItem {
  to: string;
  label: string;
  end?: boolean;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Día a día',
    items: [
      { to: '/', label: 'Dashboard', end: true },
      { to: '/patrimonio', label: 'Patrimonio' },
      { to: '/movimientos', label: 'Movimientos' },
      { to: '/importar', label: 'Importar' },
      { to: '/bandeja', label: 'Bandeja de revisión' },
      { to: '/presupuestos', label: 'Presupuestos' },
    ],
  },
  {
    title: 'Análisis y planificación',
    items: [
      { to: '/recurrencias', label: 'Recurrencias' },
      { to: '/deudas', label: 'Deudas' },
      { to: '/conciliacion', label: 'Conciliación' },
    ],
  },
  {
    title: 'Organización',
    items: [
      { to: '/categorias', label: 'Categorías' },
      { to: '/cuentas', label: 'Cuentas' },
      { to: '/reglas', label: 'Reglas' },
      { to: '/comercios', label: 'Comercios' },
    ],
  },
  {
    title: 'Datos y cuenta',
    items: [
      { to: '/exportar', label: 'Exportar' },
      { to: '/cuenta', label: 'Cuenta' },
      { to: '/sincronizacion', label: 'Sincronización' },
      { to: '/ajustes', label: 'Ajustes' },
      { to: '/ajustes/seguridad', label: 'Seguridad' },
    ],
  },
];

// Lista plana en el orden historico de la barra lateral de PC.
export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/patrimonio', label: 'Patrimonio' },
  { to: '/movimientos', label: 'Movimientos' },
  { to: '/importar', label: 'Importar' },
  { to: '/reglas', label: 'Reglas' },
  { to: '/comercios', label: 'Comercios' },
  { to: '/bandeja', label: 'Bandeja de revisión' },
  { to: '/conciliacion', label: 'Conciliación' },
  { to: '/recurrencias', label: 'Recurrencias' },
  { to: '/deudas', label: 'Deudas' },
  { to: '/categorias', label: 'Categorías' },
  { to: '/cuentas', label: 'Cuentas' },
  { to: '/presupuestos', label: 'Presupuestos' },
  { to: '/exportar', label: 'Exportar' },
  { to: '/cuenta', label: 'Cuenta' },
  { to: '/sincronizacion', label: 'Sincronización' },
  { to: '/ajustes', label: 'Ajustes' },
  { to: '/ajustes/seguridad', label: 'Seguridad' },
];
