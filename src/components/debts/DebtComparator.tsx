// Comparador Snowball vs Avalanche vs personalizada, y gestion de escenarios guardados
// (ampliacion, fase 8; FINANCIAL_ALGORITHMS seccion 9). Nunca declara una estrategia
// universalmente mejor: solo muestra fecha de liberacion, meses, intereses y cual es mas rapida
// / de menor coste PARA este conjunto de deudas. Los escenarios son simulaciones guardadas: no
// modifican deudas reales.
import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { DebtScenario } from '../../db/schema';
import { debtsService, type DebtsComparisonResult } from '../../services/debtsService';
import type { MultiDebtStrategy } from '../../services/debtAmortizationEngine';
import { formatCents, eurosToCents } from '../../lib/money';
import { useChartColors, formatCompactEuros } from '../dashboard/chartTheme';
import { MoneyTooltip } from '../dashboard/MoneyTooltip';
import { useToast } from '../../context/ToastContext';

interface DebtComparatorProps {
  profileId: string;
  scenarios: DebtScenario[];
  onScenariosChanged: () => Promise<void>;
}

const STRATEGY_LABELS: Record<MultiDebtStrategy, string> = {
  baseline: 'Base (situación actual)',
  snowball: 'Snowball (menor saldo primero)',
  avalanche: 'Avalanche (mayor interes primero)',
  custom: 'Personalizada',
};

const inputClass =
  'mt-1 block w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100';
const labelClass = 'block text-xs font-medium text-slate-400';

export function DebtComparator({ profileId, scenarios, onScenariosChanged }: DebtComparatorProps) {
  const { showToast } = useToast();
  const colors = useChartColors();
  const [recurringExtraEuros, setRecurringExtraEuros] = useState('0');
  const [result, setResult] = useState<DebtsComparisonResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scenarioName, setScenarioName] = useState('');
  const [staleById, setStaleById] = useState<Record<string, boolean>>({});

  useEffect(() => {
    void runComparison();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      scenarios.map(async (s) => [s.id, await debtsService.isScenarioStale(profileId, s)] as const),
    )
      .then((entries) => {
        if (!cancelled) setStaleById(Object.fromEntries(entries));
      })
      .catch((e) => {
        if (!cancelled) {
          showToast(
            e instanceof Error ? e.message : 'No se pudo comprobar si los escenarios están desactualizados.',
            'error',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [profileId, scenarios, showToast]);

  async function runComparison() {
    setError(null);
    try {
      const comparison = await debtsService.compareDebtStrategies(profileId, {
        recurringExtraCents: eurosToCents(Number(recurringExtraEuros || '0')),
      });
      setResult(comparison);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo calcular el comparador.');
    }
  }

  async function saveScenario(strategy: MultiDebtStrategy) {
    if (scenarioName.trim().length === 0) {
      showToast('Ponle un nombre al escenario antes de guardarlo.', 'error');
      return;
    }
    try {
      await debtsService.createScenario(profileId, {
        name: scenarioName,
        strategy,
        recurringExtraCents: eurosToCents(Number(recurringExtraEuros || '0')),
        oneTimeExtraPayments: [],
      });
      setScenarioName('');
      await onScenariosChanged();
      showToast('Escenario guardado.', 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'No se pudo guardar el escenario.', 'error');
    }
  }

  const chartData =
    result?.results
      .filter((r) => r.freeDate !== null)
      .map((r) => ({
        name: STRATEGY_LABELS[r.strategy],
        interes: r.totalInterestCents,
        meses: r.totalMonths,
        color:
          r.strategy === 'baseline'
            ? colors.expense
            : r.strategy === 'snowball'
              ? colors.bar
              : r.strategy === 'avalanche'
                ? colors.income
                : colors.savings,
      })) ?? [];

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Comparador: base, Snowball y Avalanche
        </h3>
        <p className="text-sm text-slate-400">
          No es asesoramiento financiero personalizado: ninguna estrategia es universalmente mejor,
          solo se compara cual es más rápida y cual tiene menor coste para las deudas registradas.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className={labelClass}>
            Extra mensual compartido (EUR)
            <input
              type="number"
              min="0"
              step="0.01"
              value={recurringExtraEuros}
              onChange={(e) => setRecurringExtraEuros(e.target.value)}
              className={inputClass}
            />
          </label>
          <button
            type="button"
            onClick={() => void runComparison()}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
          >
            Calcular
          </button>
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        {result && result.excludedCardDebtIds.length > 0 && (
          <p className="text-sm text-amber-300">
            {result.excludedCardDebtIds.length} tarjeta(s) excluida(s) del comparador (sin calendario en esta fase).
          </p>
        )}

        {result && Object.keys(result.debtNames).length === 0 && (
          <p className="rounded-lg border border-dashed border-slate-700 px-4 py-6 text-center text-sm text-slate-400">
            No hay deudas activas y amortizables que comparar. Añade una deuda (o revisa que no
            este archivada o sea una tarjeta) en la pestana "Deudas".
          </p>
        )}

        {result && Object.keys(result.debtNames).length > 0 && (
          <>
            {chartData.length > 0 && (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData} margin={{ top: 20, right: 12, bottom: 4, left: 8 }}>
                  <CartesianGrid vertical={false} stroke={colors.grid} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: colors.axis }} axisLine={{ stroke: colors.grid }} tickLine={false} />
                  <YAxis tickFormatter={formatCompactEuros} tick={{ fontSize: 11, fill: colors.axis }} axisLine={false} tickLine={false} width={44} />
                  <Tooltip cursor={{ fill: colors.grid, opacity: 0.4 }} content={<MoneyTooltip />} />
                  <Bar dataKey="interes" name="Intereses totales" radius={[4, 4, 0, 0]} maxBarSize={90}>
                    {chartData.map((d, i) => (
                      <Cell key={i} fill={d.color} />
                    ))}
                    <LabelList dataKey="interes" position="top" formatter={(v: number) => formatCents(v)} style={{ fontSize: 11, fill: colors.axis }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}

            <p className="text-xs text-slate-500 sm:hidden" aria-hidden>
              Desliza la tabla hacia la derecha para ver intereses y ahorro →
            </p>
            <div className="overflow-auto rounded-lg border border-slate-800">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="bg-slate-950 text-xs uppercase tracking-wide text-slate-400">
                  <tr>
                    <th scope="col" className="px-3 py-2">Estrategia</th>
                    <th scope="col" className="px-3 py-2">Fecha libre</th>
                    <th scope="col" className="px-3 py-2">Meses</th>
                    <th scope="col" className="px-3 py-2">Intereses totales</th>
                    <th scope="col" className="px-3 py-2">Ahorro vs base</th>
                    <th scope="col" className="px-3 py-2">Guardar</th>
                  </tr>
                </thead>
                <tbody>
                  {result.results.map((r) => {
                    const baseline = result.results.find((x) => x.strategy === 'baseline');
                    const saving = baseline ? baseline.totalInterestCents - r.totalInterestCents : 0;
                    return (
                      <tr key={r.strategy} className="border-t border-slate-800">
                        <td className="px-3 py-1.5">
                          {STRATEGY_LABELS[r.strategy]}
                          {r.strategy === result.fastestStrategy && (
                            <span className="ml-2 rounded-full bg-emerald-950/60 px-2 py-0.5 text-xs text-emerald-300">más rápida</span>
                          )}
                          {r.strategy === result.cheapestStrategy && (
                            <span className="ml-2 rounded-full bg-sky-950/60 px-2 py-0.5 text-xs text-sky-300">menor coste</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5">{r.freeDate ?? '-'}</td>
                        <td className="px-3 py-1.5">{r.totalMonths}</td>
                        <td className="px-3 py-1.5">{formatCents(r.totalInterestCents)}</td>
                        <td className="px-3 py-1.5">{r.strategy === 'baseline' ? '-' : formatCents(saving)}</td>
                        <td className="px-3 py-1.5">
                          {r.strategy !== 'baseline' && (
                            <button
                              type="button"
                              onClick={() => void saveScenario(r.strategy)}
                              className="rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800"
                            >
                              Guardar como escenario
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <label className={labelClass}>
              Nombre del próximo escenario a guardar
              <input value={scenarioName} onChange={(e) => setScenarioName(e.target.value)} className={inputClass} placeholder="p. ej. Avalanche con 100 EUR extra" />
            </label>
          </>
        )}
      </section>

      <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Escenarios guardados</h3>
        {scenarios.length === 0 && <p className="text-sm text-slate-500">Aun no hay escenarios guardados.</p>}
        <ul className="space-y-2">
          {scenarios.map((s) => (
            <ScenarioRow
              key={s.id}
              profileId={profileId}
              scenario={s}
              stale={staleById[s.id] ?? false}
              onChanged={onScenariosChanged}
            />
          ))}
        </ul>
      </section>
    </div>
  );
}

function ScenarioRow({
  profileId,
  scenario,
  stale,
  onChanged,
}: {
  profileId: string;
  scenario: DebtScenario;
  stale: boolean;
  onChanged: () => Promise<void>;
}) {
  const { showToast } = useToast();
  const [evaluation, setEvaluation] = useState<DebtsComparisonResult | null>(null);
  const [evaluationError, setEvaluationError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void debtsService
      .evaluateScenario(profileId, scenario)
      .then((r) => {
        if (!cancelled) setEvaluation(r);
      })
      .catch((e) => {
        if (!cancelled) {
          setEvaluationError(e instanceof Error ? e.message : 'No se pudo evaluar el escenario.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [profileId, scenario]);

  const own = evaluation?.results.find((r) => r.strategy === scenario.strategy);

  async function handleRefresh() {
    try {
      await debtsService.refreshScenario(profileId, scenario.id);
      await onChanged();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'No se pudo recalcular el escenario.', 'error');
    }
  }

  async function handleDuplicate() {
    try {
      await debtsService.duplicateScenario(profileId, scenario.id, `${scenario.name} (copia)`);
      await onChanged();
      showToast('Escenario duplicado.', 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'No se pudo duplicar el escenario.', 'error');
    }
  }

  async function handleDelete() {
    try {
      await debtsService.deleteScenario(profileId, scenario.id);
      await onChanged();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'No se pudo borrar el escenario.', 'error');
    }
  }

  return (
    <li className="rounded-lg border border-slate-800 bg-slate-950 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium text-slate-100">
            {scenario.name}{' '}
            {stale && (
              <span className="ml-2 rounded-full bg-amber-950/60 px-2 py-0.5 text-xs text-amber-300">
                desactualizado
              </span>
            )}
          </p>
          <p className="text-xs text-slate-500">
            {STRATEGY_LABELS[scenario.strategy]} · extra {formatCents(scenario.recurringExtraCents)}/mes
          </p>
          {own && (
            <p className="mt-1 text-sm text-slate-300">
              {own.freeDate ?? '-'} · {own.totalMonths} meses · {formatCents(own.totalInterestCents)} de intereses
            </p>
          )}
          {evaluationError && <p className="mt-1 text-xs text-amber-300">{evaluationError}</p>}
        </div>
        <div className="flex gap-2">
          {stale && (
            <button
              type="button"
              onClick={() => void handleRefresh()}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
            >
              Recalcular
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleDuplicate()}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
          >
            Duplicar
          </button>
          <button
            type="button"
            onClick={() => void handleDelete()}
            className="rounded-lg border border-red-900/50 px-3 py-1.5 text-xs text-red-300 hover:bg-red-950/30"
          >
            Borrar
          </button>
        </div>
      </div>
    </li>
  );
}
