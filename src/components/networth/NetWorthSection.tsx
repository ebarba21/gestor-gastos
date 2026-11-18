// Seccion Patrimonio: cuanto dinero hay en todas las cuentas (o en cada una) y como ha
// evolucionado. Toda la agregacion vive en netWorthService (via useNetWorth); aqui solo hay
// presentacion: selector de ventana, selector de vista (total, por cuenta o una cuenta),
// KPIs con su variacion, grafico y reparto por cuenta.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useNetWorth } from '../../hooks/useNetWorth';
import { formatCents } from '../../lib/money';
import { NET_WORTH_WINDOWS, NET_WORTH_WINDOW_LABELS } from '../../services/netWorthService';
import { ACCOUNT_KIND_LABELS } from '../../services/accountService';
import { EmptyState } from '../common';
import { DeltaText } from './DeltaText';
import { NetWorthChart, accountColor, netWorthLongLabel, type NetWorthView } from './NetWorthChart';

function chipClass(active: boolean): string {
  return [
    'whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium transition-colors',
    active
      ? 'border-indigo-500/60 bg-indigo-600/20 text-indigo-200'
      : 'border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-slate-200',
  ].join(' ');
}

export function NetWorthSection() {
  const { netWorthWindow, setNetWorthWindow, data, accounts, loading, error } = useNetWorth('1y');
  const [view, setView] = useState<NetWorthView>('total');
  const isView = (v: NetWorthView) =>
    typeof v === 'string' ? view === v : typeof view === 'object' && view.accountId === v.accountId;
  // La vista de una cuenta concreta se descarta si esa cuenta ya no existe.
  const effectiveView: NetWorthView =
    typeof view === 'object' && !accounts.some((a) => a.id === view.accountId) ? 'total' : view;
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const indexById = new Map(accounts.map((a, i) => [a.id, i]));

  return (
    <section>
      <h2 className="text-xl font-semibold text-slate-100">Patrimonio</h2>
      <p className="mt-1 text-sm text-slate-400">
        Dinero total en tus cuentas y su evolución. Suma el saldo inicial y todos los movimientos de
        cada cuenta, incluidas transferencias y excluidos de estadísticas. Las deudas no se restan.
      </p>

      {error && (
        <p className="mt-4 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">{error}</p>
      )}

      {loading && !data ? (
        <p className="mt-6 text-sm text-slate-500">Cargando...</p>
      ) : !data || !data.hasData ? (
        <div className="mt-6">
          <EmptyState
            icon="🏦"
            title="Aún no tienes cuentas"
            description="Crea tus cuentas con su saldo inicial para ver tu patrimonio."
          />
          <Link to="/cuentas" className="mt-3 inline-block text-sm text-indigo-400 hover:underline">
            Ir a Cuentas
          </Link>
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Patrimonio total hoy</p>
            <p className="mt-1 text-3xl font-semibold tabular-nums text-slate-100">
              {formatCents(data.summary.currentCents)}
            </p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums">
              <DeltaText cents={data.summary.changeMonthCents} suffix="en 1 mes" />
              <DeltaText cents={data.summary.changeYearCents} suffix="en 12 meses" />
            </div>
            {data.futureCount > 0 && (
              <p className="mt-2 text-xs text-slate-500">
                No incluye {data.futureCount} {data.futureCount === 1 ? 'movimiento' : 'movimientos'} con fecha futura (
                {formatCents(data.futureCents)}).
              </p>
            )}
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-500">Ver:</span>
              <button type="button" className={chipClass(isView('total'))} onClick={() => setView('total')}>
                Total
              </button>
              <button type="button" className={chipClass(isView('byAccount'))} onClick={() => setView('byAccount')}>
                Por cuenta
              </button>
              {accounts.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className={chipClass(isView({ accountId: a.id }))}
                  onClick={() => setView({ accountId: a.id })}
                >
                  {a.name}
                </button>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-500">Periodo:</span>
              {NET_WORTH_WINDOWS.map((w) => (
                <button key={w} type="button" className={chipClass(netWorthWindow === w)} onClick={() => setNetWorthWindow(w)}>
                  {NET_WORTH_WINDOW_LABELS[w]}
                </button>
              ))}
            </div>
            <div className="mt-4">
              <NetWorthChart data={data} accounts={accounts} view={effectiveView} />
            </div>
            <p className="mt-2 text-xs text-slate-500">
              <DeltaText cents={data.summary.changeWindowCents} suffix="en el periodo" /> · Máximo del periodo{' '}
              {formatCents(data.summary.peakCents)} el {netWorthLongLabel(data.summary.peakDate)}
            </p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <h3 className="text-sm font-semibold text-slate-200">Saldo por cuenta</h3>
            <p className="text-xs text-slate-500">Pulsa una cuenta para ver solo su evolución</p>
            <ul className="mt-3 divide-y divide-slate-800">
              {data.accounts.map((s) => {
                const a = accountById.get(s.accountId);
                if (!a) return null;
                const color = accountColor(a, indexById.get(a.id) ?? 0);
                return (
                  <li key={s.accountId}>
                    <button
                      type="button"
                      onClick={() => setView({ accountId: s.accountId })}
                      className="flex w-full items-center gap-3 py-2.5 text-left hover:bg-slate-800/40"
                    >
                      <span className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: color }} aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-slate-200">
                          {a.name}
                          {s.archived && <span className="ml-1 text-xs text-slate-500">(archivada)</span>}
                        </span>
                        <span className="block text-xs text-slate-500">
                          {ACCOUNT_KIND_LABELS[a.kind]}
                          {s.sharePerMille !== null && ` · ${(s.sharePerMille / 10).toFixed(1)}% del total`}
                        </span>
                      </span>
                      <span className="text-right tabular-nums">
                        <span className="block text-sm font-medium text-slate-100">{formatCents(s.balanceCents)}</span>
                        <span className="block text-xs">
                          <DeltaText cents={s.changeCents} suffix="" />
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}
