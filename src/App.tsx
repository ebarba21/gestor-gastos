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
import { ProfileGate, ProfileSwitcher } from './components/profile';

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
  { to: '/ajustes', label: 'Ajustes' },
];

function navLinkClass({ isActive }: { isActive: boolean }): string {
  return [
    'whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors',
    isActive
      ? 'bg-slate-800 text-white'
      : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200',
  ].join(' ');
}

function AppLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100 md:flex-row">
      <aside className="border-b border-slate-800 bg-slate-900 md:w-64 md:shrink-0 md:border-b-0 md:border-r">
        <div className="px-4 py-4">
          <span className="text-lg font-bold">Gestor de Gastos</span>
        </div>
        <div className="px-4 pb-3">
          {/* Selector de perfil activo. Cambio/creacion de perfil desde cualquier seccion. */}
          <ProfileSwitcher />
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:overflow-visible">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={navLinkClass}>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className="flex-1 p-6">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/movimientos" element={<TransactionsPage />} />
          <Route path="/importar" element={<ImportPage />} />
          <Route path="/reglas" element={<RulesPage />} />
          <Route path="/categorias" element={<CategoriesPage />} />
          <Route path="/cuentas" element={<AccountsPage />} />
          <Route path="/presupuestos" element={<BudgetsPage />} />
          <Route path="/exportar" element={<ExportPage />} />
          <Route path="/ajustes" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  // El gate garantiza que solo se renderiza la app cuando hay un perfil activo:
  // asi ninguna seccion de datos accede sin profileId (aislamiento por diseno).
  return (
    <ProfileGate>
      <AppLayout />
    </ProfileGate>
  );
}
