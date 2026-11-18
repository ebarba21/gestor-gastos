// Salud de los datos: si las cifras de arriba son de fiar. Frescura por cuenta (ultimo
// movimiento y ultima conciliacion), ultima importacion, categorizacion de los ultimos 90 dias y
// tareas abiertas en la bandeja, con enlace a donde se resuelve cada cosa.
import { Link } from 'react-router-dom';
import type { Account } from '../../db/schema';
import type { DataHealth } from '../../services/insightsService';

interface DataHealthCardProps {
  health: DataHealth;
  accounts: Account[];
}

function daysAgo(n: number | null): string {
  if (n === null) return 'sin movimientos';
  if (n <= 0) return 'hoy';
  if (n === 1) return 'ayer';
  return `hace ${n} días`;
}

function shortDate(iso: string): string {
  return `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}/${iso.slice(2, 4)}`;
}

const RECONCILIATION_LABEL = {
  balanced: 'cuadra',
  discrepancy: 'con diferencia',
  acceptedWithDifference: 'aceptada con diferencia',
} as const;

function pctLabel(perMille: number | null): string {
  return perMille === null ? '-' : `${Math.round(perMille / 10)} %`;
}

export function DataHealthCard({ health, accounts }: DataHealthCardProps) {
  const names = new Map(accounts.map((a) => [a.id, a.name]));
  return (
    <div className="space-y-4 text-sm">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-800 p-3">
          <p className="text-xs text-slate-500">Última importación</p>
          <p className="mt-0.5 font-medium text-slate-100">
            {health.daysSinceLastImport === null ? 'Nunca' : daysAgo(health.daysSinceLastImport)}
          </p>
          <Link to="/importar" className="text-xs text-indigo-400 hover:underline">
            Importar extracto
          </Link>
        </div>
        <div className="rounded-lg border border-slate-800 p-3">
          <p className="text-xs text-slate-500">Sin categoría (90 días)</p>
          <p className="mt-0.5 font-medium text-slate-100">
            {health.uncategorizedCount} de {health.recentMovements}
          </p>
          <p className="text-xs text-slate-500">
            Por regla {pctLabel(health.byRulePerMille)} · a mano {pctLabel(health.manualPerMille)}
          </p>
        </div>
        <div className="rounded-lg border border-slate-800 p-3">
          <p className="text-xs text-slate-500">Bandeja de revisión</p>
          <p className="mt-0.5 font-medium text-slate-100">
            {health.openReviewCount === 0 ? 'Vacía' : `${health.openReviewCount} pendientes`}
          </p>
          <Link to="/bandeja" className="text-xs text-indigo-400 hover:underline">
            Abrir bandeja
          </Link>
        </div>
      </div>
      {health.accounts.length > 0 && (
        <div>
          <p className="mb-1 text-xs text-slate-500">Por cuenta</p>
          <ul className="divide-y divide-slate-800">
            {health.accounts.map((a) => (
              <li key={a.accountId} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2">
                <span className="min-w-0 flex-1 truncate text-slate-200">{names.get(a.accountId) ?? 'Cuenta'}</span>
                <span className={`text-xs ${a.stale ? 'text-orange-400' : 'text-slate-400'}`}>
                  {a.stale ? '! ' : ''}Último movimiento {daysAgo(a.daysSinceLastMovement)}
                </span>
                <span className="text-xs text-slate-500">
                  {a.lastReconciliationDate
                    ? `Conciliada el ${shortDate(a.lastReconciliationDate)} (${RECONCILIATION_LABEL[a.lastReconciliationStatus!]})`
                    : 'Sin conciliar'}
                </span>
              </li>
            ))}
          </ul>
          <Link to="/conciliacion" className="text-xs text-indigo-400 hover:underline">
            Conciliar saldos
          </Link>
        </div>
      )}
    </div>
  );
}
