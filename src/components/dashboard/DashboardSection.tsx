// Seccion Dashboard: selector de periodo y todas las metricas del perfil activo. Toda la
// agregacion vive en statsService (via useDashboard); aqui solo hay presentacion y layout
// responsive. Estados cuidados: cargando, rango invalido, periodo sin datos.
import type { ReactNode } from 'react';
import { useDashboard } from '../../hooks/useDashboard';
import { useForecastRange } from '../../hooks/useForecastRange';
import { useRecurringSeries } from '../../hooks/useRecurringSeries';
import { EmptyState } from '../common';
import { PeriodSelector } from './PeriodSelector';
import { StatTiles } from './StatTiles';
import { ComparisonForecast } from './ComparisonForecast';
import { ForecastRangeCard } from './ForecastRangeCard';
import { MonthlyEvolutionChart } from './MonthlyEvolutionChart';
import { CategorySpendChart } from './CategorySpendChart';
import { IncomeExpenseChart } from './IncomeExpenseChart';
import { TopExpensesCard } from './TopExpensesCard';
import { UpcomingChargesCard } from './UpcomingChargesCard';
import { MerchantSpendCard } from './MerchantSpendCard';
import { SavingsInvestmentSection } from './SavingsInvestmentSection';

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
    selectMonth,
    customFrom,
    customTo,
    setCustomFrom,
    setCustomTo,
    range,
    filter,
    toggleCategoryFilter,
    clearFilter,
    data,
    categoryNames,
    categoryColors,
    accountNames,
    merchantNames,
    loading,
    error,
  } = useDashboard();
  const { forecast, loading: forecastLoading, error: forecastError } = useForecastRange(range);
  const { upcomingCharges, loading: recurringLoading } = useRecurringSeries();

  // Nombre legible de la categoria del filtro activo (para el chip).
  const activeFilterName =
    filter === null
      ? null
      : filter.categoryId === null
        ? 'Sin categoria'
        : categoryNames.get(filter.categoryId) ?? 'Categoria';

  return (
    <section>
      <h2 className="text-xl font-semibold text-slate-100">Dashboard</h2>
      <p className="mt-1 text-sm text-slate-400">
        Metricas del perfil activo. Excluye transferencias y movimientos excluidos; los splits
        cuentan por sus lineas y los reembolsos reducen el gasto. Pulsa una categoria o un mes en
        los graficos para filtrar el resto.
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

      {activeFilterName !== null && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500">Filtrando por:</span>
          <button
            type="button"
            onClick={clearFilter}
            className="inline-flex items-center gap-1.5 rounded-full border border-indigo-500/40 bg-indigo-600/15 px-2.5 py-1 text-xs font-medium text-indigo-300 hover:bg-indigo-600/25"
          >
            {activeFilterName}
            <span aria-hidden className="text-sm leading-none">
              ×
            </span>
            <span className="sr-only">Quitar filtro</span>
          </button>
        </div>
      )}

      {error && (
        <p className="mt-4 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      {loading && !data ? (
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
          <div className="grid gap-3 sm:grid-cols-2">
            <ComparisonForecast comparison={data.comparison} />
            <ForecastRangeCard forecast={forecast} loading={forecastLoading} error={forecastError} />
          </div>

          <Card title="Evolucion mensual" subtitle="Ingresos, gasto neto y ahorro por mes. Pulsa un mes para verlo">
            <MonthlyEvolutionChart
              monthly={data.monthly}
              activeMonth={data.anchorMonth}
              onSelectMonth={selectMonth}
            />
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Gasto por categoria" subtitle="Pulsa una categoria para filtrar el resto">
              <CategorySpendChart
                byCategory={data.byCategory}
                categoryNames={categoryNames}
                categoryColors={categoryColors}
                activeCategoryId={filter?.categoryId}
                onSelectCategory={toggleCategoryFilter}
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
                activeCategoryId={filter?.categoryId}
                onSelectCategory={toggleCategoryFilter}
              />
            </Card>
            <Card title="Proximos cobros" subtitle="Series recurrentes confirmadas">
              <UpcomingChargesCard charges={upcomingCharges} loading={recurringLoading} />
            </Card>
          </div>

          <Card title="Gasto por comercio" subtitle="Ranking de gasto del periodo por comercio asociado">
            <MerchantSpendCard merchantSpend={data.merchantSpend} merchantNames={merchantNames} />
          </Card>

          {/* Apartado de ahorro e inversion: siempre sobre la ventana de evolucion completa,
              sin filtro cruzado (ver DashboardData.savingsInvestment). */}
          <SavingsInvestmentSection analysis={data.savingsInvestment} onSelectMonth={selectMonth} />
        </div>
      )}
    </section>
  );
}
