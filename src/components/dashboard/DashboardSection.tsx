// Seccion Dashboard: selector de periodo y todas las metricas del perfil activo. Toda la
// agregacion vive en statsService (via useDashboard); aqui solo hay presentacion y layout
// responsive. Estados cuidados: cargando, rango invalido, periodo sin datos.
import { useCallback, useState, type ReactNode } from 'react';
import { BalanceForecastCard, PlanningKpisCard, SafeToSpendCard, UpcomingWithBalanceCard, VarianceCard } from '../planning';
import type { AlertFeedback } from '../insights/AlertsCard';
import { useDashboard } from '../../hooks/useDashboard';
import { useForecastRange } from '../../hooks/useForecastRange';
import { useMovementEditor } from '../../hooks/useMovementEditor';
import { useToast } from '../../context/ToastContext';
import type { DrillDownKind } from '../../services/statsService';
import { useFrozenDrillDown } from '../../hooks/useFrozenDrillDown';
import { TransactionFormModal } from '../transactions/TransactionFormModal';
import { EmptyState } from '../common';
import { PeriodSelector } from './PeriodSelector';
import { longMonthLabel } from './chartTheme';
import { StatTiles } from './StatTiles';
import { ComparisonForecast } from './ComparisonForecast';
import { ForecastRangeCard } from './ForecastRangeCard';
import { MonthlyEvolutionChart } from './MonthlyEvolutionChart';
import { CategorySpendChart } from './CategorySpendChart';
import { IncomeExpenseChart } from './IncomeExpenseChart';
import { TopExpensesCard } from './TopExpensesCard';
import { MerchantSpendCard } from './MerchantSpendCard';
import { SavingsInvestmentSection } from './SavingsInvestmentSection';
import { MovementsDrillDownModal } from './MovementsDrillDownModal';
import { useInsights } from '../../hooks/useInsights';
import { MOBILE_QUERY, useMediaQuery } from '../../hooks/useMediaQuery';
import {
  AlertsCard,
  CategoryBulletsCard,
  DataHealthCard,
  GettingStartedCard,
  HeatmapCard,
  MoneyFlowCard,
  NetWorthMiniCard,
  PaceCard,
  WaterfallCard,
} from '../insights';

// Tarjeta con titulo para envolver un grafico o lista.
function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
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

export function DashboardSection() {
  const {
    profileId,
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
    categories,
    accounts,
    categoryNames,
    categoryColors,
    accountNames,
    merchantNames,
    loading,
    error,
    reload,
  } = useDashboard();
  const { forecast, loading: forecastLoading, error: forecastError } = useForecastRange(range);
  // Insights del mes seleccionado (sobre el mes entero, sin filtro cruzado). En modo rango no se
  // muestran: serian de un mes y los KPIs del rango, y las cifras no cuadrarian entre si.
  const insightsAnchor = mode === 'month' ? referenceISO : null;
  const {
    insights,
    netWorth,
    planning,
    alerts,
    feedback,
    giveFeedback,
    error: insightsError,
    reload: reloadInsights,
  } = useInsights(insightsAnchor);
  const [view, setView] = useState<'today' | 'analysis'>('today');
  // Mes (AAAA-MM) del ultimo movimiento de tus cuentas, para el atajo del estado vacio.
  const lastDataMonth = planning ? planning.safe.asOf.slice(0, 7) : null;
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const reloadAll = useCallback(async () => {
    await Promise.all([reload(), reloadInsights()]);
  }, [reload, reloadInsights]);
  const scrollToWaterfall = useCallback(() => {
    document.getElementById('cascada-del-mes')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);
  const { showToast } = useToast();
  const onEditorError = useCallback((message: string) => showToast(message, 'error'), [showToast]);
  const editor = useMovementEditor(onEditorError);
  // Desglose abierto (Gastos o Ingresos). Mientras la ficha de un movimiento esta abierta el
  // desglose se oculta (sin perder cual era) y reaparece, ya recalculado, al cerrarla.
  const [drillKind, setDrillKind] = useState<DrillDownKind | null>(null);
  // Orden congelado al abrir el panel: editar un movimiento no lo mueve de sitio.
  const drillDown = useFrozenDrillDown(drillKind, data?.drillDown ?? null);
  // Pulsar un mes en los graficos mensuales (evolucion, aportaciones y acumulado) muestra su
  // tooltip resumen y pasa todo el dashboard a ese mes (se conserva el filtro de categoria).
  // La ventana de los graficos no se mueve: solo cambia el mes marcado. Sin desplegables.
  const openEditor = editor.open;
  const openMovement = useCallback((id: string) => void openEditor(id), [openEditor]);

  // Nombre legible de la categoria del filtro activo (para el chip).
  const activeFilterName =
    filter === null
      ? null
      : filter.categoryId === null
        ? 'Sin categoría'
        : categoryNames.get(filter.categoryId) ?? 'Categoría';

  // En el movil la portada se divide en "Hoy" (decidir) y "Analisis" (entender); en el PC se
  // muestran las dos, "Hoy" primero.
  const showToday = !isMobile || view === 'today';
  const showAnalysis = !isMobile || view === 'analysis';
  const catName = (id: string | null) => (id === null ? 'Sin categoría' : categoryNames.get(id) ?? 'Categoría');
  const atRisk = insights?.pace.isCurrentMonth ? insights.categories.filter((c) => c.status === 'over').slice(0, 3) : [];
  const usefulIds = new Set(feedback.filter((f) => f.useful === true).map((f) => f.alertId));
  const onFeedback = (id: string, kind: AlertFeedback) => void giveFeedback(id, kind);

  return (
    <section>
      <h2 className="text-xl font-semibold text-slate-100">{isMobile ? 'Inicio' : 'Dashboard'}</h2>

      {isMobile && (
        <div className="mt-3 grid grid-cols-2 rounded-lg border border-slate-700 p-0.5 text-sm" role="tablist" aria-label="Vista de la portada">
          {(['today', 'analysis'] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={`rounded-md py-1.5 font-medium ${view === v ? 'bg-slate-700 text-slate-100' : 'text-slate-400'}`}
            >
              {v === 'today' ? 'Hoy' : 'Análisis'}
            </button>
          ))}
        </div>
      )}

      {showToday && (
        <div className="mt-4 space-y-4">
          <GettingStartedCard />
          {/* En PC dos columnas independientes: a la izquierda decidir (disponible y avisos), a la
              derecha el contexto (patrimonio y proximos dias). Cada columna apila sus tarjetas, asi
              una tarjeta alta no deja huecos vacios debajo de su vecina. */}
          <div className="grid items-start gap-4 lg:grid-cols-3">
          <div className="min-w-0 space-y-4 lg:col-span-2">
          {planning ? (
            <SafeToSpendCard safe={planning.safe} />
          ) : (
            loading && <p className="text-sm text-slate-500">Calculando tu disponible...</p>
          )}
            <Card
              title="Necesita atención"
              subtitle={
                insights && insights.health.openReviewCount > 0
                  ? `${insights.health.openReviewCount} tareas abiertas en la bandeja`
                  : 'Lo que tiene dinero en juego, primero'
              }
            >
              <AlertsCard
                alerts={alerts}
                limit={isMobile ? 3 : 5}
                onSelectCategory={toggleCategoryFilter}
                onSelectMovement={openMovement}
                onFeedback={onFeedback}
                usefulIds={usefulIds}
              />
            </Card>
          </div>
          <div className="min-w-0 space-y-4">
            {!isMobile && netWorth && netWorth.hasData && <NetWorthMiniCard netWorth={netWorth} accounts={accounts} />}
            {planning && (
              <Card title="Próximos 14 días" subtitle="Recibos e ingresos esperados y el saldo que quedará">
                <UpcomingWithBalanceCard forecast={planning.forecast} bufferCents={planning.safe.bufferCents} />
              </Card>
            )}
          </div>
          </div>
          {atRisk.length > 0 && (
            <Card title="Categorías en riesgo" subtitle="Por encima de lo que sueles llevar a estas alturas">
              <CategoryBulletsCard
                bullets={atRisk}
                categoryNames={categoryNames}
                activeCategoryId={filter?.categoryId}
                onSelectCategory={toggleCategoryFilter}
              />
            </Card>
          )}
          {isMobile && (
            <button
              type="button"
              onClick={() => setView('analysis')}
              className="w-full rounded-lg border border-slate-700 py-2 text-sm text-slate-300"
            >
              Ver el análisis completo
            </button>
          )}
        </div>
      )}

      {showAnalysis && (
      <>
      {!isMobile && <h3 className="mt-8 text-lg font-semibold text-slate-100">Análisis</h3>}
      <p className="mt-1 hidden text-sm text-slate-400 sm:block">
        Métricas del perfil activo. Excluye transferencias y movimientos excluidos; los splits
        cuentan por sus líneas y los reembolsos reducen el gasto. Pulsa Ingresos o Gastos para ver
        sus movimientos, una categoría para filtrar el resto, y un mes en los gráficos para ver su
        resumen y filtrar el dashboard por ese mes.
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
          {data?.hasData && (
            <button
              type="button"
              onClick={() => setDrillKind('expense')}
              className="rounded-full border border-slate-700 px-2.5 py-1 text-xs font-medium text-slate-300 hover:bg-slate-800"
            >
              Ver sus movimientos
            </button>
          )}
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
            description="Selecciona un mes o un rango de fechas válido para ver tus métricas."
          />
        </div>
      ) : !data.hasData ? (
        <div className="mt-6">
          <EmptyState
            icon="📊"
            title="Sin datos en este periodo"
            description="No hay movimientos que cuenten en estadísticas en el periodo seleccionado. Prueba otro mes o importa un extracto."
            action={
              // Con los extractos sin importar, el mes en curso sale vacio: un toque lleva al
              // ultimo mes con movimientos en lugar de obligar a retroceder mes a mes.
              mode === 'month' && lastDataMonth !== null && lastDataMonth !== referenceISO.slice(0, 7) ? (
                <button
                  type="button"
                  onClick={() => selectMonth(lastDataMonth)}
                  className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
                >
                  Ver {longMonthLabel(lastDataMonth)}, tu último mes con datos
                </button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          {insightsError && (
            <p className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">
              {insightsError}
            </p>
          )}
          {insights && (
            <>
              <div className="grid gap-6 lg:grid-cols-2">
                <PaceCard pace={insights.pace} health={insights.health} onOpenWaterfall={scrollToWaterfall} />
                {insights.variance ? (
                  <Card title="Frente al mes pasado" subtitle="Qué categorías y comercios explican la diferencia a estas alturas">
                    <VarianceCard
                      variance={insights.variance}
                      catName={catName}
                      onSelectCategory={toggleCategoryFilter}
                      merchantNames={merchantNames}
                      yearAgo={insights.yearAgo}
                    />
                  </Card>
                ) : (
                  <div />
                )}
              </div>
              {planning && (
                <div className="grid gap-6 lg:grid-cols-2">
                  <Card title="Previsión de saldo" subtitle="Lo que tendrás en tus cuentas si nada cambia">
                    <BalanceForecastCard forecast={planning.forecast} bufferCents={planning.safe.bufferCents} />
                  </Card>
                  <Card title="Indicadores" subtitle="Resiliencia y ahorro, cada uno con su cálculo">
                    <PlanningKpisCard kpis={planning.kpis} merchantNames={merchantNames} />
                  </Card>
                </div>
              )}
              <div className="grid gap-6 lg:grid-cols-2">
                <Card title="Categorías frente a tu media" subtitle="Pulsa una para filtrar el dashboard">
                  <CategoryBulletsCard
                    bullets={insights.categories}
                    categoryNames={categoryNames}
                    activeCategoryId={filter?.categoryId}
                    onSelectCategory={toggleCategoryFilter}
                  />
                </Card>
                <Card title="Resumen del mes">
                  <ul className="space-y-1.5 text-sm text-slate-300">
                    {insights.narrative.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </Card>
              </div>
            </>
          )}
          <StatTiles
            summary={data.summary}
            onOpenIncome={() => setDrillKind('income')}
            onOpenExpenses={() => setDrillKind('expense')}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <ComparisonForecast comparison={data.comparison} />
            <ForecastRangeCard forecast={forecast} loading={forecastLoading} error={forecastError} />
          </div>

          <Card
            title="Evolución mensual"
            subtitle="Ingresos, gasto neto y ahorro por mes. Pulsa un mes para ver su resumen y filtrar el dashboard por ese mes"
          >
            <MonthlyEvolutionChart
              monthly={data.monthly}
              activeMonth={data.anchorMonth}
              onSelectMonth={selectMonth}
            />
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Gasto por categoría" subtitle="Pulsa una categoría para filtrar el resto">
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
            <Card title="Top gastos" subtitle="Mayores gastos del periodo. Pulsa uno para ver y editar sus detalles">
              <TopExpensesCard
                topExpenses={data.topExpenses}
                categoryNames={categoryNames}
                accountNames={accountNames}
                activeCategoryId={filter?.categoryId}
                onSelectMovement={openMovement}
              />
            </Card>
            {/* Los dos rankings del periodo, lado a lado (antes Top gastos quedaba solo en
                media fila con la otra mitad vacia). */}
            <Card title="Gasto por comercio" subtitle="Ranking de gasto del periodo por comercio asociado">
              <MerchantSpendCard merchantSpend={data.merchantSpend} merchantNames={merchantNames} />
            </Card>
          </div>

          {insights && (
            <div className="grid gap-6 lg:grid-cols-2">
              <div id="cascada-del-mes" className="scroll-mt-4 [&>div]:h-full">
                <Card title="Del ingreso al ahorro" subtitle="Cómo se llega a tu ahorro neto del mes y en qué queda">
                  <WaterfallCard steps={insights.waterfall} />
                </Card>
              </div>
              <Card title="Calendario de gasto" subtitle="Cada día frente a tu media diaria de los 3 meses anteriores">
                <HeatmapCard heatmap={insights.heatmap} />
              </Card>
            </div>
          )}
          {insights && !isMobile && (
            <Card title="Flujo del dinero" subtitle="De dónde viene y a dónde va el dinero del mes">
              <MoneyFlowCard flow={insights.flow} categoryColors={categoryColors} />
            </Card>
          )}

          {/* Apartado de ahorro e inversion: siempre sobre la ventana de evolucion completa,
              sin filtro cruzado (ver DashboardData.savingsInvestment). Pulsar sus graficos
              muestra el resumen del mes y filtra el dashboard por el. */}
          <SavingsInvestmentSection
            analysis={data.savingsInvestment}
            activeMonth={data.anchorMonth}
            onSelectMonth={selectMonth}
          />

          {insights && (
            <Card title="Salud de tus datos" subtitle="Si las cifras de arriba son de fiar">
              <DataHealthCard health={insights.health} accounts={accounts} />
            </Card>
          )}
        </div>
      )}
      </>
      )}

      <MovementsDrillDownModal
        open={drillKind !== null && editor.editing === null}
        onClose={() => setDrillKind(null)}
        kind={drillKind ?? 'expense'}
        drillDown={drillDown}
        filterName={activeFilterName}
        categoryNames={categoryNames}
        accountNames={accountNames}
        onSelectMovement={openMovement}
      />
      <TransactionFormModal
        open={editor.editing !== null}
        onClose={editor.close}
        profileId={profileId}
        accounts={accounts}
        categories={categories}
        tags={editor.tags}
        onSaved={reloadAll}
        tx={editor.editing}
        merchantNames={merchantNames}
      />
    </section>
  );
}
