// Navegacion movil (iPhone/Android): barra inferior fija con las secciones de uso diario y un
// panel "Mas" con el resto. Respeta las zonas seguras (notch e indicador de inicio) mediante
// env(safe-area-inset-*). Solo presentacion; sin logica de negocio.
import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { NAV_GROUPS } from './navItems';

interface TabDef {
  to: string;
  label: string;
  end?: boolean;
  icon: ReactNode;
}

function Icon({ d }: { d: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-6 w-6"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

const TABS: TabDef[] = [
  { to: '/', label: 'Inicio', end: true, icon: <Icon d="M3 11.5 12 4l9 7.5M5.5 10v10h13V10" /> },
  {
    to: '/movimientos',
    label: 'Movimientos',
    icon: <Icon d="M4 6h16M4 12h16M4 18h10" />,
  },
  {
    to: '/presupuestos',
    label: 'Presupuestos',
    icon: <Icon d="M12 3a9 9 0 1 0 9 9h-9V3Zm3-.5V9h6.5A9 9 0 0 0 15 2.5Z" />,
  },
  {
    to: '/bandeja',
    label: 'Bandeja',
    icon: <Icon d="M3 13h5l1.5 3h5L16 13h5M5 5h14l2 8v6H3v-6l2-8Z" />,
  },
];

function tabClass({ isActive }: { isActive: boolean }): string {
  return [
    'flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium',
    isActive ? 'text-indigo-400' : 'text-slate-400',
  ].join(' ');
}

export function MobileNav() {
  const [moreOpen, setMoreOpen] = useState(false);
  const location = useLocation();

  // Al navegar a cualquier seccion se cierra el panel "Mas".
  useEffect(() => {
    setMoreOpen(false);
  }, [location.pathname]);

  // Bloquea el scroll del fondo mientras el panel esta abierto.
  useEffect(() => {
    if (!moreOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [moreOpen]);

  return (
    <>
      {moreOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Todas las secciones"
          className="fixed inset-0 z-30 overflow-y-auto bg-slate-950 px-4 pb-28"
          style={{ paddingTop: 'calc(env(safe-area-inset-top) + 1rem)' }}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-100">Todas las secciones</h2>
            <button
              type="button"
              onClick={() => setMoreOpen(false)}
              className="rounded-lg px-3 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800"
            >
              Cerrar
            </button>
          </div>
          {NAV_GROUPS.map((group) => (
            <section key={group.title} className="mt-5">
              <h3 className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {group.title}
              </h3>
              <ul className="mt-2 divide-y divide-slate-800 overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
                {group.items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.end}
                      onClick={() => setMoreOpen(false)}
                      className={({ isActive }) =>
                        [
                          'flex items-center justify-between px-4 py-3 text-base',
                          isActive ? 'text-indigo-400' : 'text-slate-100',
                        ].join(' ')
                      }
                    >
                      {item.label}
                      <span aria-hidden="true" className="text-slate-600">
                        ›
                      </span>
                    </NavLink>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <nav
        aria-label="Navegacion principal"
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-slate-800 bg-slate-900/95 backdrop-blur"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {TABS.map((tab) => (
          <NavLink key={tab.to} to={tab.to} end={tab.end} className={tabClass}>
            {tab.icon}
            <span>{tab.label}</span>
          </NavLink>
        ))}
        <button
          type="button"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((v) => !v)}
          className={tabClass({ isActive: moreOpen })}
        >
          <Icon d="M5 12h.01M12 12h.01M19 12h.01" />
          <span>Mas</span>
        </button>
      </nav>
    </>
  );
}
