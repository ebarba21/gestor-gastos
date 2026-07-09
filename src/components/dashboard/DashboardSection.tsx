// Seccion Dashboard: selector de periodo y todas las metricas del perfil activo. Toda la
// agregacion vive en statsService (via useDashboard); aqui solo hay presentacion y layout
// responsive. Estados cuidados: cargando, rango invalido, periodo sin datos.
import type { ReactNode } from 'react';
import { useDashboard } from '../../hooks/useDashboard';
import { EmptyState } from '../common';
import { PeriodSelector } from './PeriodSelector';
import { StatTiles } from './StatTiles';
import { ComparisonForecast } from './ComparisonForecast';
import { MonthlyEvolutionChart } from './MonthlyEvolutionChart';
import { CategorySpendChart } from './CategorySpendChart';
import { IncomeExpenseChart } from './IncomeExpenseChart';
import { TopExpensesCard } from './TopExpensesCard';
import { RecurringCard } from './RecurringCard';

// Tarjeta con titulo para envolver un grafico o lista.
function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
        {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

export function DashboardSection() {
  const {
    mode,
    setMode,
    referenceISO,
    setReferenceMonths,
    resetReference,
    customFrom,
    customTo,
    setCustomFrom,
    setCustomTo,
    data,
    categoryNames,
    categoryColors,
    accountNames,
    loading,
    error,
  } = useDashboard();

  return (
    <section>
      <h2 className="text-xl font-semibold text-slate-100">Dashboard</h2>
      <p className="mt-1 text-sm text-slate-400">
        Metricas del perfil activo. Excluye transferencias y movimientos excluidos; los splits
        cuentan por sus lineas y los reembolsos reducen el gasto.
      </p>

      <div className="mt-4">
        <PeriodSelector
          mode={mode}
          setMode={setMode}
          referenceISO={referenceISO}
          setReferenceMonths={setReferenceMonths}
          resetReference={resetReference}
          customFrom={customFrom}
          customTo={customTo}
          setCustomFrom={setCustomFrom}
          setCustomTo={setCustomTo}
        />
      </div>

      {error && (
        <p className="mt-4 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      {loading ? (
        <p className="mt-6 text-sm text-slate-500">Cargando...</p>
      ) : !data ? (
        <div className="mt-6">
          <EmptyState
            icon="🗓️"
            title="Ajusta el periodo"
            description="Selecciona un mes o un rango de fechas valido para ver tus metricas."
          />
        </div>
      ) : !data.hasData ? (
        <div className="mt-6">
          <EmptyState
            icon="📊"
            title="Sin datos en este periodo"
            description="No hay movimientos que cuenten en estadisticas en el periodo seleccionado. Prueba otro mes o importa un extracto."
          />
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          <StatTiles summary={data.summary} />
          <ComparisonForecast comparison={data.comparison} forecast={data.forecast} />

          <Card title="Evolucion mensual" subtitle="Ingresos, gasto neto y ahorro por mes">
            <MonthlyEvolutionChart monthly={data.monthly} />
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Gasto por categoria" subtitle="Gasto neto del periodo por categoria">
              <CategorySpendChart
                byCategory={data.byCategory}
                categoryNames={categoryNames}
                categoryColors={categoryColors}
              />
            </Card>
            <Card title="Ingresos vs gastos" subtitle="Comparativa del periodo seleccionado">
              <IncomeExpenseChart summary={data.summary} />
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Top gastos" subtitle="Mayores gastos individuales del periodo">
              <TopExpensesCard
                topExpenses={data.topExpenses}
                categoryNames={categoryNames}
                accountNames={accountNames}
              />
            </Card>
            <Card title="Gastos recurrentes" subtitle="Conceptos repetidos en los ultimos meses">
              <RecurringCard recurring={data.recurring} />
            </Card>
          </div>
        </div>
      )}
    </section>
  );
}
