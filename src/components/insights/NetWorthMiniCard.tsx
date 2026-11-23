// Tarjeta de patrimonio en el dashboard: total de hoy, variacion a un mes y tendencia de 12
// meses. Lleva a la pagina de Patrimonio para el detalle por cuenta.
import { Link } from 'react-router-dom';
import type { Account } from '../../db/schema';
import type { NetWorthResult } from '../../services/netWorthService';
import { formatCents } from '../../lib/money';
import { NetWorthChart } from '../networth/NetWorthChart';
import { DeltaText } from '../networth/DeltaText';

interface NetWorthMiniCardProps {
  netWorth: NetWorthResult;
  accounts: Account[];
}

export function NetWorthMiniCard({ netWorth, accounts }: NetWorthMiniCardProps) {
  const names = new Map(accounts.map((a) => [a.id, a.name]));
  return (
    <Link
      to="/patrimonio"
      className="block min-w-0 rounded-xl border border-slate-800 bg-slate-900/60 p-4 transition-colors hover:border-slate-600"
    >
      <p className="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-slate-500">
        Patrimonio total
        <span aria-hidden className="text-sm normal-case">›</span>
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-100">{formatCents(netWorth.summary.currentCents)}</p>
      <p className="mt-0.5 text-xs tabular-nums">
        <DeltaText cents={netWorth.summary.changeMonthCents} suffix="en el último mes" />
      </p>
      <div className="mt-2" aria-hidden>
        <NetWorthChart data={netWorth} accounts={accounts} view="total" height={70} compact />
      </div>
      <p className="text-xs text-slate-500">Últimos 12 meses</p>
      <ul className="mt-3 space-y-1 border-t border-slate-800 pt-3 text-sm">
        {netWorth.accounts
          .filter((a) => !a.archived || a.balanceCents !== 0)
          .slice(0, 4)
          .map((a) => (
            <li key={a.accountId} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-slate-300">{names.get(a.accountId) ?? 'Cuenta'}</span>
              <span className="tabular-nums text-slate-100">{formatCents(a.balanceCents)}</span>
            </li>
          ))}
      </ul>
    </Link>
  );
}
