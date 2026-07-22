import { NavLink, Route, Routes } from 'react-router-dom';
import DashboardPage from './pages/DashboardPage';
import TransactionsPage from './pages/TransactionsPage';
import ImportPage from './pages/ImportPage';
import RulesPage from './pages/RulesPage';
import MerchantsPage from './pages/MerchantsPage';
import ReviewInboxPage from './pages/ReviewInboxPage';
import ReconciliationPage from './pages/ReconciliationPage';
import RecurringSeriesPage from './pages/RecurringSeriesPage';
import DebtsPage from './pages/DebtsPage';
import CategoriesPage from './pages/CategoriesPage';
import AccountsPage from './pages/AccountsPage';
import BudgetsPage from './pages/BudgetsPage';
import ExportPage from './pages/ExportPage';
import SettingsPage from './pages/SettingsPage';
import SecurityPage from './pages/SecurityPage';
import AccountPage from './pages/AccountPage';
import SyncPage from './pages/SyncPage';
import { ProfileGate, ProfileSwitcher } from './components/profile';
import { NavIcon, type NavIconName } from './components/nav/NavIcon';
import { ThemeToggle } from './components/common';
import { SyncBadge } from './components/sync';
import { ReviewBadge } from './components/review';
import { LockGate } from './components/security';

interface NavItem {
  to: string;
  label: string;
  icon: NavIconName;
  end?: boolean;
}

interface NavGroup {
  heading: string;
  items: NavItem[];
}

// Navegacion agrupada por tarea, con icono por opcion. Agrupar + iconos hace la barra mas
// legible que una lista plana de 17 enlaces. "Cuentas bancarias" y "Mi cuenta" se nombran asi
// (en vez de "Cuentas"/"Cuenta") para no confundir el modulo de cuentas financieras con la
// cuenta de sincronizacion. Las rutas no cambian: solo las etiquetas visibles.
const NAV_GROUPS: NavGroup[] = [
  {
    heading: 'Resumen',
    items: [{ to: '/', label: 'Dashboard', icon: 'dashboard', end: true }],
  },
  {
    heading: 'Día a día',
    items: [
      { to: '/movimientos', label: 'Movimientos', icon: 'movimientos' },
      { to: '/importar', label: 'Importar', icon: 'importar' },
      { to: '/bandeja', label: 'Bandeja de revisión', icon: 'bandeja' },
    ],
  },
  {
    heading: 'Organización',
    items: [
      { to: '/categorias', label: 'Categorías', icon: 'categorías' },
      { to: '/reglas', label: 'Reglas', icon: 'reglas' },
      { to: '/comercios', label: 'Comercios', icon: 'comercios' },
      { to: '/cuentas', label: 'Cuentas bancarias', icon: 'cuentas' },
    ],
  },
  {
    heading: 'Planificación',
    items: [
      { to: '/presupuestos', label: 'Presupuestos', icon: 'presupuestos' },
      { to: '/recurrencias', label: 'Recurrencias', icon: 'recurrencias' },
      { to: '/deudas', label: 'Deudas', icon: 'deudas' },
      { to: '/conciliacion', label: 'Conciliación', icon: 'conciliación' },
    ],
  },
  {
    heading: 'Datos y cuenta',
    items: [
      { to: '/exportar', label: 'Exportar', icon: 'exportar' },
      { to: '/cuenta', label: 'Mi cuenta', icon: 'cuenta' },
      { to: '/sincronizacion', label: 'Sincronización', icon: 'sincronización' },
      { to: '/ajustes', label: 'Ajustes', icon: 'ajustes' },
      { to: '/ajustes/seguridad', label: 'Seguridad', icon: 'seguridad' },
    ],
  },
];

function navLinkClass({ isActive }: { isActive: boolean }): string {
  return [
    'flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors',
    isActive
      ? 'bg-slate-800 text-slate-50'
      : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200',
  ].join(' ');
}

function AppLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100 md:flex-row">
      <aside className="border-b border-slate-800 bg-slate-900 md:w-64 md:shrink-0 md:border-b-0 md:border-r">
        {/* En movil, título y selector de perfil comparten fila para ahorrar altura;
            en PC vuelven a apilarse en la barra lateral. */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 md:block md:py-4">
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold">Gestor de Gastos</span>
            {/* Insignia de estado de sincronización (solo con cuenta activa). */}
            <SyncBadge />
            {/* Insignia discreta de la bandeja de revision (oculta si no hay tareas). */}
            <ReviewBadge />
            {/* Conmutador de tema, accesible desde cualquier sección. */}
            <ThemeToggle className="md:ml-auto" />
          </div>
          {/* Selector de perfil activo. Cambio/creacion de perfil desde cualquier sección. */}
          <div className="w-44 shrink-0 md:mt-4 md:w-auto">
            <ProfileSwitcher />
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:gap-0.5 md:overflow-visible">
          {NAV_GROUPS.map((group) => (
            // display:contents en movil para que los enlaces fluyan en la fila horizontal; en PC
            // el grupo pasa a bloque y muestra su encabezado (oculto en movil para no cortar el
            // scroll horizontal).
            <div key={group.heading} className="contents md:block">
              <p className="hidden px-3 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-slate-500 first:pt-1 md:block">
                {group.heading}
              </p>
              {group.items.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.end} className={navLinkClass}>
                  <NavIcon name={item.icon} className="h-4 w-4 shrink-0" />
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      {/* min-w-0 evita que tablas y gráficos anchos desborden el layout flex. */}
      <main className="min-w-0 flex-1 p-4 md:p-6">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/movimientos" element={<TransactionsPage />} />
          <Route path="/importar" element={<ImportPage />} />
          <Route path="/reglas" element={<RulesPage />} />
          <Route path="/comercios" element={<MerchantsPage />} />
          <Route path="/bandeja" element={<ReviewInboxPage />} />
          <Route path="/conciliacion" element={<ReconciliationPage />} />
          <Route path="/recurrencias" element={<RecurringSeriesPage />} />
          <Route path="/deudas" element={<DebtsPage />} />
          <Route path="/categorias" element={<CategoriesPage />} />
          <Route path="/cuentas" element={<AccountsPage />} />
          <Route path="/presupuestos" element={<BudgetsPage />} />
          <Route path="/exportar" element={<ExportPage />} />
          <Route path="/cuenta" element={<AccountPage />} />
          <Route path="/sincronizacion" element={<SyncPage />} />
          <Route path="/ajustes" element={<SettingsPage />} />
          <Route path="/ajustes/seguridad" element={<SecurityPage />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  // LockGate va POR FUERA de ProfileGate: mientras la app esta bloqueada por PIN, ni siquiera el
  // selector de perfil es visible (CLOUD_SYNC_SECURITY seccion 4, ARCHITECTURE seccion 4). El
  // gate de perfil garantiza ademas que solo se renderiza la app cuando hay un perfil activo:
  // asi ninguna seccion de datos accede sin profileId (aislamiento por diseno).
  return (
    <LockGate>
      <ProfileGate>
        <AppLayout />
      </ProfileGate>
    </LockGate>
  );
}
