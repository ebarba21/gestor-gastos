import { NavLink, Route, Routes } from 'react-router-dom';
import DashboardPage from './pages/DashboardPage';
import NetWorthPage from './pages/NetWorthPage';
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
import MonthClosePage from './pages/MonthClosePage';
import TagReportPage from './pages/TagReportPage';
import { ProfileGate, ProfileSwitcher } from './components/profile';
import { PrivacyToggle, ThemeToggle } from './components/common';
import { usePrivacy } from './context/PrivacyContext';
import { SyncBadge } from './components/sync';
import { ReviewBadge } from './components/review';
import { LockGate } from './components/security';
import { MobileNav, NAV_ITEMS } from './components/layout';
import { MOBILE_QUERY, useMediaQuery } from './hooks/useMediaQuery';
import { useActiveProfileId } from './hooks/useProfiles';

function navLinkClass({ isActive }: { isActive: boolean }): string {
  return [
    'whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors',
    isActive
      ? 'bg-slate-800 text-slate-50'
      : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200',
  ].join(' ');
}

function AppLayout() {
  // En movil la navegacion pasa a una barra inferior (MobileNav) y la cabecera queda compacta.
  // En PC se mantiene la barra lateral con todas las secciones.
  const isMobile = useMediaQuery(MOBILE_QUERY);
  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100 md:flex-row">
      <aside className="border-b border-slate-800 bg-slate-900 md:w-64 md:shrink-0 md:border-b-0 md:border-r">
        {/* En movil, titulo y selector de perfil comparten fila para ahorrar altura;
            en PC vuelven a apilarse en la barra lateral. */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 md:block md:py-4">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate whitespace-nowrap text-base font-bold md:text-lg">Gestor de Gastos</span>
            {/* Insignia de estado de sincronizacion (solo con cuenta activa). */}
            <SyncBadge />
            {/* Insignia discreta de la bandeja de revision (oculta si no hay tareas). */}
            <ReviewBadge />
            {/* Ocultar importes (modo privado) y conmutador de tema, desde cualquier seccion. */}
            <PrivacyToggle className="md:ml-auto" />
            <ThemeToggle />
          </div>
          {/* Selector de perfil activo. Cambio/creacion de perfil desde cualquier seccion. */}
          <div className="w-36 shrink-0 sm:w-44 md:mt-4 md:w-auto">
            <ProfileSwitcher />
          </div>
        </div>
        {!isMobile && (
          <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:overflow-visible">
            {NAV_ITEMS.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={navLinkClass}>
                {item.label}
              </NavLink>
            ))}
          </nav>
        )}
      </aside>

      {/* min-w-0 evita que tablas y graficos anchos desborden el layout flex. */}
      {/* En movil se reserva espacio inferior para la barra de navegacion fija y el indicador
          de inicio del iPhone. */}
      <main
        className="min-w-0 flex-1 p-4 md:p-6"
        style={isMobile ? { paddingBottom: 'calc(5.5rem + env(safe-area-inset-bottom))' } : undefined}
      >
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/patrimonio" element={<NetWorthPage />} />
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
          <Route path="/cierre" element={<MonthClosePage />} />
          <Route path="/etiquetas" element={<TagReportPage />} />
          <Route path="/exportar" element={<ExportPage />} />
          <Route path="/cuenta" element={<AccountPage />} />
          <Route path="/sincronizacion" element={<SyncPage />} />
          <Route path="/ajustes" element={<SettingsPage />} />
          <Route path="/ajustes/seguridad" element={<SecurityPage />} />
        </Routes>
      </main>
      {isMobile && <MobileNav />}
    </div>
  );
}

// Al cambiar de perfil se monta de nuevo todo el layout: ningun estado (dashboard, patrimonio,
// insights) del perfil anterior puede quedar visible mientras carga el nuevo (invariante 4).
// Al ocultar o mostrar los importes tambien se vuelve a montar: las cifras ya formateadas en
// avisos y resumenes se recalculan con o sin mascara.
function ProfileScopedLayout() {
  const profileId = useActiveProfileId();
  const { revision } = usePrivacy();
  return <AppLayout key={`${profileId}:${revision}`} />;
}

export default function App() {
  // LockGate va POR FUERA de ProfileGate: mientras la app esta bloqueada por PIN, ni siquiera el
  // selector de perfil es visible (CLOUD_SYNC_SECURITY seccion 4, ARCHITECTURE seccion 4). El
  // gate de perfil garantiza ademas que solo se renderiza la app cuando hay un perfil activo:
  // asi ninguna seccion de datos accede sin profileId (aislamiento por diseno).
  return (
    <LockGate>
      <ProfileGate>
        <ProfileScopedLayout />
      </ProfileGate>
    </LockGate>
  );
}
