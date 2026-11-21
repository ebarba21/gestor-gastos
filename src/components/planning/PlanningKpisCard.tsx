// KPIs de resiliencia: meses de colchon, recibos fijos al mes, peso de los fijos en tus
// ingresos, tasa de ahorro a 3 y 12 meses y lo pendiente de recuperar de gastos compartidos.
// Cada cifra lleva su explicacion: no hay un "score" opaco.
import type { PlanningKpis } from '../../services/planningService';
import { formatCents } from '../../lib/money';

function Tile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg border border-slate-800 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums text-slate-100">{value}</p>
      <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{hint}</p>
    </div>
  );
}

function perMilleLabel(v: number | null): string {
  return v === null ? 'Sin datos' : `${(v / 10).toLocaleString('es-ES', { maximumFractionDigits: 1 })} %`;
}

export function PlanningKpisCard({ kpis }: { kpis: PlanningKpis }) {
  const runway =
    kpis.runwayMonthsX10 === null
      ? 'Sin datos'
      : `${(kpis.runwayMonthsX10 / 10).toLocaleString('es-ES', { maximumFractionDigits: 1 })} meses`;
  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
      <Tile
        label="Meses de colchón"
        value={runway}
        hint={
          kpis.typicalMonthlySpendCents !== null
            ? `${formatCents(kpis.liquidCents)} ÷ ${formatCents(kpis.typicalMonthlySpendCents)} de gasto mensual típico`
            : 'Necesita al menos un mes con gastos'
        }
      />
      <Tile
        label="Recibos fijos al mes"
        value={formatCents(kpis.recurringMonthlyCents)}
        hint={`${kpis.recurringCount} recurrencias activas; las anuales, divididas entre 12`}
      />
      <Tile
        label="Fijos sobre ingresos"
        value={perMilleLabel(kpis.fixedShareOfIncomePerMille)}
        hint={
          kpis.typicalIncomeCents !== null
            ? `Sobre tu ingreso habitual de ${formatCents(kpis.typicalIncomeCents)}`
            : 'Sin ingresos en los últimos 6 meses'
        }
      />
      <Tile
        label="Tasa de ahorro (3 meses)"
        value={perMilleLabel(kpis.savingsRate3mPerMille)}
        hint={`Últimos ${kpis.savingsRateMonthsUsed.short} meses completos; no la distorsiona un mes raro`}
      />
      <Tile
        label="Tasa de ahorro (12 meses)"
        value={perMilleLabel(kpis.savingsRate12mPerMille)}
        hint={`Últimos ${kpis.savingsRateMonthsUsed.long} meses completos, pagas extra incluidas`}
      />
      <Tile
        label="Pendiente de recuperar"
        value={formatCents(kpis.reimbursablePendingCents)}
        hint={
          kpis.reimbursablePendingCount > 0
            ? `${kpis.reimbursablePendingCount} gastos compartidos sin devolver del todo`
            : 'Marca "a recuperar" en un gasto compartido para seguirlo'
        }
      />
    </div>
  );
}
