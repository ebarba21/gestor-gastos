// Apartado "Ahorro e inversion" del dashboard: KPIs, insights y dos graficos sobre la
// ventana de evolucion (aportaciones mensuales y acumulado). Solo presentacion: todo el
// calculo (totales, medias, mejores meses, rachas, acumulados) vive en statsService.
//
// Vocabulario cuidado para no confundir conceptos ya definidos en la app:
//  - "Aportado a ahorro/inversion": traspasos explicitos a categorias de Ahorros o
//    Inversion (netos de retiradas). Es lo que miden las barras y los acumulados.
//  - "Ahorro neto": ingresos menos gastos del mes (lo que no consumiste), como en el
//    resto del dashboard. Las rachas y la tasa se miden sobre el.
import type { SavingsInvestmentAnalysis } from '../../services/statsService';
import { formatCents } from '../../lib/money';
import { longMonthLabel } from './chartTheme';
import { SavingsContributionsChart } from './SavingsContributionsChart';
import { SavingsCumulativeChart } from './SavingsCumulativeChart';

interface SavingsInvestmentSectionProps {
  analysis: SavingsInvestmentAnalysis;
  // Pulsar un mes en los graficos lo fija como periodo del dashboard.
  onSelectMonth?: (monthKey: string) => void;
}

// Tarjeta KPI local, mismo lenguaje visual que StatTiles.
function Tile({
  label,
  value,
  hint,
  valueClass = 'text-slate-100',
}: {
  label: string;
  value: string;
  hint?: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-semibold tabular-nums sm:text-xl ${valueClass}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

// Tarjeta con titulo para envolver un grafico (mismo patron que DashboardSection).
function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
        {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

// Un insight de la lista: icono, texto y dato destacado.
function Insight({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-sm text-slate-400">
      <span aria-hidden className="mt-0.5 text-base leading-none">
        {icon}
      </span>
      <span>{children}</span>
    </li>
  );
}

function rateLabel(perMille: number | null): string {
  if (perMille === null) return 'Sin ingresos';
  return `${(perMille / 10).toFixed(1)}%`;
}

function monthsLabel(n: number): string {
  return n === 1 ? '1 mes' : `${n} meses`;
}

export function SavingsInvestmentSection({ analysis, onSelectMonth }: SavingsInvestmentSectionProps) {
  const windowMonths = analysis.months.length;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold text-slate-100">Ahorro e inversión</h3>
        <p className="text-xs text-slate-500">
          Últimos {windowMonths} meses. Las aportaciones son traspasos a tus categorías de Ahorros
          e Inversión (netos de retiradas); el ahorro neto es todo lo que no consumiste.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          label="Aportado a ahorro"
          value={formatCents(analysis.totalSavingsContribCents)}
          valueClass="text-emerald-400"
          hint={`Histórico: ${formatCents(analysis.allTimeSavingsContribCents)}`}
        />
        <Tile
          label="Aportado a inversión"
          value={formatCents(analysis.totalInvestmentContribCents)}
          valueClass="text-sky-400"
          hint={`Histórico: ${formatCents(analysis.allTimeInvestmentContribCents)}`}
        />
        <Tile
          label="Ahorro neto acumulado"
          value={formatCents(analysis.totalNetSavingsCents)}
          valueClass={analysis.totalNetSavingsCents >= 0 ? 'text-indigo-300' : 'text-red-400'}
          hint={`Tasa media: ${rateLabel(analysis.overallSavingsRatePerMille)}`}
        />
        <Tile
          label="Racha ahorrando"
          value={monthsLabel(analysis.currentStreakMonths)}
          valueClass={analysis.currentStreakMonths > 0 ? 'text-indigo-300' : 'text-slate-400'}
          hint={`Meses seguidos con ahorro neto positivo. Mejor racha: ${monthsLabel(analysis.longestStreakMonths)}`}
        />
      </div>

      {!analysis.hasAnyContrib && (
        <p className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs text-slate-500">
          Aún no hay aportaciones registradas. Crea una categoría llamada
          <span className="text-slate-300"> Ahorros</span> o
          <span className="text-slate-300"> Inversión</span> y asigna a ella tus traspasos: dejarán
          de contar como gasto y este apartado se llenará solo.
        </p>
      )}

      {(analysis.bestNetSavingsMonth !== null ||
        analysis.bestInvestmentMonth !== null ||
        analysis.bestSavingsRateMonth !== null ||
        analysis.activeMonths > 0) && (
        <div className="min-w-0 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <h4 className="mb-2 text-sm font-semibold text-slate-200">Insights del periodo</h4>
          <ul className="space-y-1.5">
            {analysis.bestNetSavingsMonth !== null && (
              <Insight icon="🏆">
                Tu mejor mes de ahorro neto fue{' '}
                <span className="font-medium text-slate-200">
                  {longMonthLabel(analysis.bestNetSavingsMonth.month)}
                </span>{' '}
                con{' '}
                <span className="font-medium tabular-nums text-indigo-300">
                  {formatCents(analysis.bestNetSavingsMonth.cents)}
                </span>
                .
              </Insight>
            )}
            {analysis.bestInvestmentMonth !== null && (
              <Insight icon="📈">
                Donde más invertiste fue en{' '}
                <span className="font-medium text-slate-200">
                  {longMonthLabel(analysis.bestInvestmentMonth.month)}
                </span>{' '}
                (
                <span className="font-medium tabular-nums text-sky-300">
                  {formatCents(analysis.bestInvestmentMonth.cents)}
                </span>
                ).
              </Insight>
            )}
            {analysis.bestSavingsRateMonth !== null && (
              <Insight icon="🎯">
                Tu mejor tasa de ahorro fue del{' '}
                <span className="font-medium tabular-nums text-slate-200">
                  {rateLabel(analysis.bestSavingsRateMonth.perMille)}
                </span>{' '}
                en {longMonthLabel(analysis.bestSavingsRateMonth.month)}.
              </Insight>
            )}
            {analysis.activeMonths > 0 && (
              <Insight icon="📅">
                Media mensual sobre {monthsLabel(analysis.activeMonths)} con actividad: ahorro neto{' '}
                <span className="font-medium tabular-nums text-slate-200">
                  {formatCents(analysis.avgNetSavingsCents)}
                </span>
                , aportado a ahorro{' '}
                <span className="font-medium tabular-nums text-slate-200">
                  {formatCents(analysis.avgSavingsContribCents)}
                </span>{' '}
                e inversión{' '}
                <span className="font-medium tabular-nums text-slate-200">
                  {formatCents(analysis.avgInvestmentContribCents)}
                </span>
                .
              </Insight>
            )}
          </ul>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card
          title="Aportaciones por mes"
          subtitle="Traspasos netos a ahorro e inversión. Pulsa un mes para verlo"
        >
          <SavingsContributionsChart months={analysis.months} onSelectMonth={onSelectMonth} />
        </Card>
        <Card
          title="Acumulado de la ventana"
          subtitle="Aportado neto hasta cada mes (ahorro e inversión apilados)"
        >
          <SavingsCumulativeChart months={analysis.months} onSelectMonth={onSelectMonth} />
        </Card>
      </div>
    </div>
  );
}
