// Proximos movimientos esperados (recibos, nomina, fondos que vencen) con el saldo que quedara
// despues de cada uno, segun la prevision. Sustituye a una lista de nombres sin contexto.
import { Link } from 'react-router-dom';
import type { BalanceForecast } from '../../services/planningService';
import { formatCents } from '../../lib/money';
import { shiftDays } from '../../lib/dates';
import { weekdayDate } from './format';

export function UpcomingWithBalanceCard({
  forecast,
  bufferCents,
  days = 14,
}: {
  forecast: BalanceForecast;
  bufferCents: number;
  days?: number;
}) {
  const until = shiftDays(forecast.asOf, days);
  const events = forecast.events.filter((e) => e.date <= until);
  const balanceOn = new Map(forecast.days.map((d) => [d.date, d.centralCents] as const));
  if (events.length === 0) {
    return (
      <p className="py-4 text-sm text-slate-500">
        Nada previsto en los próximos {days} días.{' '}
        <Link to="/recurrencias" className="text-indigo-400 hover:underline">
          Confirma tus recibos
        </Link>{' '}
        para verlos aquí.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-slate-800">
      {events.map((e, i) => {
        const balance = balanceOn.get(e.date);
        const low = balance !== undefined && balance < bufferCents;
        return (
          <li key={`${e.date}-${e.name}-${i}`} className="flex items-center gap-3 py-2 text-sm">
            <span className="w-20 shrink-0 text-xs text-slate-500">{weekdayDate(e.date)}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-slate-200">
                {e.name}
                {e.estimated && <span className="ml-1 text-xs text-slate-500">(estimado)</span>}
              </span>
              {balance !== undefined && (
                <span
                  className={`block text-xs tabular-nums ${
                    balance < 0 ? 'text-red-400' : low ? 'text-amber-300' : 'text-slate-500'
                  }`}
                  title="Saldo previsto al final de ese día"
                >
                  {balance < 0 ? '⚠ ' : ''}Saldo después: {formatCents(balance)}
                </span>
              )}
            </span>
            <span className={`shrink-0 tabular-nums ${e.amountCents > 0 ? 'text-emerald-400' : 'text-slate-200'}`}>
              {e.amountCents > 0 ? '+' : ''}
              {formatCents(e.amountCents)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
