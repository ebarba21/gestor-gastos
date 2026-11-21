// Cierre de mes guiado (noviembre 2026): cuatro pasos para que las cifras del mes sean de fiar
// (importar, categorizar, bandeja, conciliar) y, debajo, el resumen del mes. El estado se deduce
// de los datos: no hay que marcar nada a mano.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useActiveProfileId } from '../../hooks/useProfiles';
import { defaultCloseMonth, monthCloseService, type MonthCloseStatus } from '../../services/monthCloseService';
import { insightsService, type MonthInsights } from '../../services/insightsService';
import { shiftMonths, todayISO } from '../../lib/dates';
import { formatCents } from '../../lib/money';
import { categoryService } from '../../services/categoryService';

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// "Octubre de 2026" (solo la primera letra en mayuscula).
function monthLabel(month: string): string {
  const name = MONTHS[Number(month.slice(5, 7)) - 1]!;
  return `${name[0]!.toUpperCase()}${name.slice(1)} de ${month.slice(0, 4)}`;
}

function percentLabel(perMille: number): string {
  return `${(perMille / 10).toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
}

function Step({
  done,
  title,
  detail,
  action,
}: {
  done: boolean;
  title: string;
  detail: ReactNode;
  action?: ReactNode;
}) {
  return (
    <li className="flex gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <span
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
          done ? 'bg-emerald-600 text-white' : 'border border-slate-600 text-slate-400'
        }`}
        aria-hidden="true"
      >
        {done ? '✓' : ''}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-100">
          {title}
          <span className="sr-only">{done ? ' (hecho)' : ' (pendiente)'}</span>
        </p>
        <div className="mt-0.5 text-xs text-slate-400">{detail}</div>
        {!done && action && <div className="mt-2">{action}</div>}
      </div>
    </li>
  );
}

const linkClass = 'inline-block rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800';

export function MonthCloseSection() {
  const profileId = useActiveProfileId();
  const [month, setMonth] = useState(() => defaultCloseMonth(todayISO()));
  const [status, setStatus] = useState<MonthCloseStatus | null>(null);
  const [insights, setInsights] = useState<MonthInsights | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [s, ins] = await Promise.all([
        monthCloseService.compute(profileId, month),
        insightsService.compute(profileId, { anchorISO: `${month}-01` }),
      ]);
      setStatus(s);
      setInsights(ins);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo calcular el cierre del mes.');
    }
  }, [profileId, month]);

  useEffect(() => {
    setStatus(null);
    setInsights(null);
    void load();
  }, [load]);

  const thisMonth = todayISO().slice(0, 7);
  const canGoNext = month < thisMonth;
  const monthName = MONTHS[Number(month.slice(5, 7)) - 1]!;
  const summary = insights?.summary;
  const topCategories = insights ? [...insights.categories].filter((c) => c.currentCents > 0).slice(0, 3) : [];

  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-slate-100">Cierre de mes</h2>
        <p className="mt-1 text-sm text-slate-400">
          Cuatro pasos para que las cifras del mes sean de fiar. Se actualizan solos según tus datos.
        </p>
      </div>

      <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2">
        <button
          type="button"
          onClick={() => setMonth(shiftMonths(`${month}-01`, -1).slice(0, 7))}
          className="min-h-[44px] rounded-lg px-3 text-sm text-slate-300 hover:bg-slate-800"
          aria-label="Mes anterior"
        >
          ‹
        </button>
        <span className="text-sm font-semibold text-slate-100">{monthLabel(month)}</span>
        <button
          type="button"
          onClick={() => setMonth(shiftMonths(`${month}-01`, 1).slice(0, 7))}
          disabled={!canGoNext}
          className="min-h-[44px] rounded-lg px-3 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-30"
          aria-label="Mes siguiente"
        >
          ›
        </button>
      </div>

      {error && <p className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">{error}</p>}
      {!status && !error && <p className="text-sm text-slate-500">Calculando...</p>}

      {status && (
        <>
          <div
            className={`rounded-xl border px-4 py-3 text-sm ${
              status.done ? 'border-emerald-700/60 bg-emerald-950/30 text-emerald-200' : 'border-slate-800 bg-slate-900/60 text-slate-300'
            }`}
          >
            {status.isOpenMonth
              ? `${monthName[0]!.toUpperCase()}${monthName.slice(1)} aún no ha terminado: puedes ir adelantando los pasos.`
              : status.done
                ? `${monthName[0]!.toUpperCase()}${monthName.slice(1)} está cerrado. Las cifras de abajo son de fiar.`
                : `Te faltan ${Object.values(status.steps).filter((v) => !v).length} pasos para cerrar ${monthName}.`}
            {status.streak > 0 && (
              <span className="mt-1 block text-xs text-slate-400">
                {status.streak === 1 ? '1 mes cerrado seguido.' : `${status.streak} meses cerrados seguidos.`}
              </span>
            )}
          </div>

          <ol className="space-y-2">
            <Step
              done={status.steps.imported}
              title="1. Importa cada cuenta hasta fin de mes"
              detail={
                status.accounts.length === 0 ? (
                  'No hay cuentas con movimientos en este mes.'
                ) : (
                  <ul className="space-y-0.5">
                    {status.accounts.map((a) => (
                      <li key={a.accountId}>
                        {a.imported ? '✓' : '·'} {a.name}: último movimiento {a.lastMovementDate ?? 'ninguno'}
                      </li>
                    ))}
                  </ul>
                )
              }
              action={
                <Link to="/importar" className={linkClass}>
                  Importar extracto
                </Link>
              }
            />
            <Step
              done={status.steps.categorized}
              title="2. Ningún movimiento del mes sin categoría"
              detail={
                status.uncategorizedInMonth === 0
                  ? 'Todo categorizado.'
                  : `${status.uncategorizedInMonth} movimiento(s) de ${monthName} sin categoría.`
              }
              action={
                <Link to={`/movimientos?q=${encodeURIComponent(`sin categoría ${monthName} ${month.slice(0, 4)}`)}`} className={linkClass}>
                  Ver los movimientos sin categoría
                </Link>
              }
            />
            <Step
              done={status.steps.reviewed}
              title="3. Bandeja de revisión a cero"
              detail={status.openReviewCount === 0 ? 'Sin tareas abiertas.' : `${status.openReviewCount} tarea(s) abierta(s): duplicados, transferencias, reembolsos...`}
              action={
                <Link to="/bandeja" className={linkClass}>
                  Abrir la bandeja
                </Link>
              }
            />
            <Step
              done={status.steps.reconciled}
              title="4. Concilia cada cuenta con su extracto a fin de mes"
              detail={
                status.accounts.length === 0 ? (
                  'Nada que conciliar.'
                ) : (
                  <ul className="space-y-0.5">
                    {status.accounts.map((a) => (
                      <li key={a.accountId}>
                        {a.reconciled ? '✓' : '·'} {a.name}
                        {a.lastReconciliationDate ? `: conciliada a ${a.lastReconciliationDate}` : ': sin conciliar a fin de mes'}
                      </li>
                    ))}
                  </ul>
                )
              }
              action={
                <Link to="/conciliacion" className={linkClass}>
                  Conciliar
                </Link>
              }
            />
          </ol>
        </>
      )}

      {insights && summary && (
        <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <h3 className="text-sm font-semibold text-slate-200">Resumen de {monthLabel(month).toLowerCase()}</h3>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg border border-slate-800 p-2">
              <p className="text-[11px] text-slate-500">Ingresos</p>
              <p className="text-sm font-semibold tabular-nums text-slate-100">{formatCents(summary.incomeCents)}</p>
            </div>
            <div className="rounded-lg border border-slate-800 p-2">
              <p className="text-[11px] text-slate-500">Gasto neto</p>
              <p className="text-sm font-semibold tabular-nums text-slate-100">{formatCents(summary.expenseNetCents)}</p>
            </div>
            <div className="rounded-lg border border-slate-800 p-2">
              <p className="text-[11px] text-slate-500">Tasa de ahorro</p>
              <p className="text-sm font-semibold tabular-nums text-slate-100">
                {summary.savingsRatePerMille === null ? 'Sin ingresos' : percentLabel(summary.savingsRatePerMille)}
              </p>
            </div>
          </div>
          <ul className="space-y-1 text-sm text-slate-300">
            {insights.narrative.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {topCategories.length > 0 && <TopCategories ins={insights} />}
          <Link to="/" className="inline-block text-xs text-indigo-400 hover:underline">
            Ver el análisis completo en el Dashboard
          </Link>
        </div>
      )}
    </section>
  );
}

// Las 3 categorias con mas gasto del mes y su diferencia con tu media.
function TopCategories({ ins }: { ins: MonthInsights }) {
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const profileId = useActiveProfileId();
  useEffect(() => {
    let cancelled = false;
    categoryService
      .listAll(profileId)
      .then((cats) => {
        if (!cancelled) setNames(new Map(cats.map((c) => [c.id, c.name])));
      })
      .catch(() => {
        // Sin nombres la lista sigue siendo util (se muestra "Categoría").
      });
    return () => {
      cancelled = true;
    };
  }, [profileId]);
  const top = [...ins.categories].filter((c) => c.currentCents > 0).slice(0, 3);
  return (
    <div>
      <p className="text-xs font-medium text-slate-400">Donde más gastaste</p>
      <ul className="mt-1 space-y-1 text-sm">
        {top.map((c) => (
          <li key={c.categoryId ?? 'none'} className="flex justify-between gap-3">
            <span className="text-slate-300">{c.categoryId === null ? 'Sin categoría' : names.get(c.categoryId) ?? 'Categoría'}</span>
            <span className="tabular-nums text-slate-200">
              {formatCents(c.currentCents)}
              {c.averageCents > 0 && (
                <span className="ml-1 text-xs text-slate-500">
                  ({c.currentCents >= c.averageCents ? '+' : ''}
                  {formatCents(c.currentCents - c.averageCents)} vs media)
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
