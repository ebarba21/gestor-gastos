import { NavLink, Route, Routes } from 'react-router-dom';
import DashboardPage from './pages/DashboardPage';
import TransactionsPage from './pages/TransactionsPage';
import ImportPage from './pages/ImportPage';
import RulesPage from './pages/RulesPage';
import CategoriesPage from './pages/CategoriesPage';
import AccountsPage from './pages/AccountsPage';
import BudgetsPage from './pages/BudgetsPage';
import ExportPage from './pages/ExportPage';
import SettingsPage from './pages/SettingsPage';
import SecurityPage from './pages/SecurityPage';
import AccountPage from './pages/AccountPage';
import SyncPage from './pages/SyncPage';
import { ProfileGate, ProfileSwitcher } from './components/profile';
import { ThemeToggle } from './components/common';
import { SyncBadge } from './components/sync';
import { LockGate } from './components/security';

interface NavItem {
  to: string;
  label: string;
  end?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/movimientos', label: 'Movimientos' },
  { to: '/importar', label: 'Importar' },
  { to: '/reglas', label: 'Reglas' },
  { to: '/categorias', label: 'Categorias' },
  { to: '/cuentas', label: 'Cuentas' },
  { to: '/presupuestos', label: 'Presupuestos' },
  { to: '/exportar', label: 'Exportar' },
  { to: '/cuenta', label: 'Cuenta' },
  { to: '/sincronizacion', label: 'Sincronizacion' },
  { to: '/ajustes', label: 'Ajustes' },
  { to: '/ajustes/seguridad', label: 'Seguridad' },
];

function navLinkClass({ isActive }: { isActive: boolean }): string {
  return [
    'whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors',
    isActive
      ? 'bg-slate-800 text-slate-50'
      : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200',
  ].join(' ');
}

function AppLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100 md:flex-row">
      <aside className="border-b border-slate-800 bg-slate-900 md:w-64 md:shrink-0 md:border-b-0 md:border-r">
        {/* En movil, titulo y selector de perfil comparten fila para ahorrar altura;
            en PC vuelven a apilarse en la barra lateral. */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 md:block md:py-4">
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold">Gestor de Gastos</span>
            {/* Insignia de estado de sincronizacion (solo con cuenta activa). */}
            <SyncBadge />
            {/* Conmutador de tema, accesible desde cualquier seccion. */}
            <ThemeToggle className="md:ml-auto" />
          </div>
          {/* Selector de perfil activo. Cambio/creacion de perfil desde cualquier seccion. */}
          <div className="w-44 shrink-0 md:mt-4 md:w-auto">
            <ProfileSwitcher />
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:overflow-visible">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={navLinkClass}>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* min-w-0 evita que tablas y graficos anchos desborden el layout flex. */}
      <main className="min-w-0 flex-1 p-4 md:p-6">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/movimientos" element={<TransactionsPage />} />
          <Route path="/importar" element={<ImportPage />} />
          <Route path="/reglas" element={<RulesPage />} />
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
