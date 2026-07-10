// Tarjetas de metrica principales (KPIs) del periodo: ingresos, gasto neto, ahorro neto y
// tasa de ahorro. Solo presentacion: reciben el resumen ya calculado por statsService.
// Los importes se formatean desde centimos enteros; la tasa de ahorro gestiona el caso "sin
// ingresos" (no hay division por cero: se muestra "Sin ingresos").
//
// Debajo de los KPIs, cuando hay inversion en el periodo, se muestra el REPARTO del ahorro
// neto en dos conceptos que suman exactamente el ahorro neto:
//  - Invertido: dinero aportado a categorias de inversion (concepto propio, sigue siendo tuyo).
//  - Ahorrado: TODO lo demas que no consumiste (ahorro neto menos lo invertido). No distingue
//    entre lo que apartaste a una categoria de Ahorros y lo que simplemente quedo libre en tus
//    cuentas: todo lo disponible (ingresos menos gastos, sin invertir) cuenta como ahorro.
import type { IncomeExpenseSummary } from '../../services/statsService';
import { formatCents } from '../../lib/money';

interface StatTilesProps {
  summary: IncomeExpenseSummary;
}

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

// Tasa de ahorro (tanto por mil entero) a porcentaje con un decimal.
function savingsRateLabel(perMille: number | null): string {
  if (perMille === null) return 'Sin ingresos';
  return `${(perMille / 10).toFixed(1)}%`;
}

// --- Reparto del ahorro neto -------------------------------------------------

// Estilos de cada pieza del reparto. Se comparten entre la barra apilada y la leyenda para
// que color y concepto sean lo mismo en ambos sitios.
type Slice = 'savings' | 'investment';
const SLICE_STYLES: Record<Slice, { icon: string; bar: string; text: string }> = {
  savings: { icon: '🐷', bar: 'bg-emerald-400', text: 'text-emerald-300' },
  investment: { icon: '📈', bar: 'bg-sky-400', text: 'text-sky-300' },
};

// Una fila de la leyenda del reparto: punto de color, etiqueta con icono, importe y su peso
// en el ahorro neto (cuando el peso es representable, es decir con ahorro neto positivo).
function LegendRow({
  slice,
  label,
  hint,
  cents,
  share,
}: {
  slice: Slice;
  label: string;
  hint: string;
  cents: number;
  share: string | null;
}) {
  const s = SLICE_STYLES[slice];
  return (
    <div className="flex items-baseline gap-2">
      <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-sm ${s.bar}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
          <span aria-hidden>{s.icon}</span>
          {label}
          {share && <span className="text-slate-500">· {share}</span>}
        </p>
        <p className="text-[11px] leading-tight text-slate-500">{hint}</p>
      </div>
      <p className={`shrink-0 tabular-nums text-sm font-semibold ${s.text}`}>{formatCents(cents)}</p>
    </div>
  );
}

// Bloque que descompone el ahorro neto en Ahorrado + Invertido. "Ahorrado" es todo lo que no
// consumiste y no invertiste (ahorro neto menos lo invertido): incluye tanto lo que apartaste
// a una categoria de Ahorros como lo que simplemente quedo disponible en tus cuentas, sin
// distincion. Solo se renderiza cuando hay inversion en el periodo: sin inversion, el ahorro
// neto ES el ahorro (ya lo muestra su KPI) y el desglose no aportaria nada.
function NetSavingsBreakdown({ summary }: { summary: IncomeExpenseSummary }) {
  const { netSavingsCents, investmentContribCents } = summary;
  const investment = Math.max(investmentContribCents, 0);
  // Ahorrado = ahorro neto menos lo invertido. Absorbe lo disponible: no hay una tercera pieza.
  const saved = netSavingsCents - investment;

  // Porcentaje de cada pieza sobre el ahorro neto. Solo tiene sentido con ahorro neto positivo.
  const shareOf = (cents: number): string | null =>
    netSavingsCents > 0 ? `${Math.round((cents / netSavingsCents) * 100)}%` : null;

  // La barra apilada solo se pinta cuando ambas piezas son >= 0 y el ahorro neto es > 0: ese es
  // el caso en que un reparto proporcional es fiel. Si se invirtio mas que el ahorro neto (o el
  // ahorro neto es <= 0) se omite la barra y se explica con una nota, porque una barra apilada
  // con negativos engana.
  const drawBar = netSavingsCents > 0 && saved >= 0;
  const pct = (cents: number) => (netSavingsCents > 0 ? (cents / netSavingsCents) * 100 : 0);

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-slate-200">Reparto del ahorro neto</h3>
        <p className="text-xs text-slate-500">
          Tu ahorro neto ({formatCents(netSavingsCents)}) es lo que no consumiste: parte lo inviertes y el resto es ahorro.
        </p>
      </div>

      {drawBar && (
        <div
          className="mb-3 flex h-2.5 w-full overflow-hidden rounded-full bg-slate-800"
          role="img"
          aria-label="Reparto proporcional del ahorro neto entre ahorrado e invertido"
        >
          {saved > 0 && <span className={SLICE_STYLES.savings.bar} style={{ width: `${pct(saved)}%` }} />}
          {investment > 0 && (
            <span className={SLICE_STYLES.investment.bar} style={{ width: `${pct(investment)}%` }} />
          )}
        </div>
      )}

      <div className="space-y-2">
        {saved >= 0 ? (
          <LegendRow
            slice="savings"
            label="Ahorrado"
            hint="Lo que no consumiste ni invertiste (apartado o disponible)"
            cents={saved}
            share={shareOf(saved)}
          />
        ) : (
          <p className="rounded-lg border border-amber-900/50 bg-amber-950/30 px-2.5 py-2 text-[11px] leading-snug text-amber-200/90">
            Este periodo invertiste {formatCents(investment)}, mas que tu ahorro neto
            ({formatCents(netSavingsCents)}). La diferencia ({formatCents(investment - netSavingsCents)})
            sale de tu saldo de periodos anteriores.
          </p>
        )}
        <LegendRow
          slice="investment"
          label="Invertido"
          hint="Aportado a Inversion (sigue siendo tuyo)"
          cents={investment}
          share={shareOf(investment)}
        />
      </div>
    </div>
  );
}

export function StatTiles({ summary }: StatTilesProps) {
  const savingsPositive = summary.netSavingsCents >= 0;
  // El reparto solo aporta informacion cuando hay inversion (separa lo invertido del resto del
  // ahorro). Sin inversion, el ahorro neto ya ES el ahorro y su KPI lo muestra: no se desglosa.
  const showBreakdown = summary.investmentContribCents > 0;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Ingresos" value={formatCents(summary.incomeCents)} valueClass="text-emerald-400" />
        <Tile
          label="Gastos"
          value={formatCents(summary.expenseNetCents)}
          valueClass="text-orange-400"
          hint={
            summary.refundCents > 0
              ? `Bruto ${formatCents(summary.expenseGrossCents)} · reembolsos ${formatCents(summary.refundCents)}`
              : undefined
          }
        />
        <Tile
          label="Ahorro neto"
          value={formatCents(summary.netSavingsCents)}
          valueClass={savingsPositive ? 'text-indigo-300' : 'text-red-400'}
          hint="Ingresos menos gastos"
        />
        <Tile
          label="Tasa de ahorro"
          value={savingsRateLabel(summary.savingsRatePerMille)}
          valueClass={
            summary.savingsRatePerMille === null
              ? 'text-slate-400'
              : summary.savingsRatePerMille >= 0
                ? 'text-indigo-300'
                : 'text-red-400'
          }
          hint="Ahorro sobre ingresos"
        />
      </div>
      {showBreakdown && <NetSavingsBreakdown summary={summary} />}
    </div>
  );
}
