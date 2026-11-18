// Grafico de patrimonio. Tres vistas sobre la misma serie ya calculada por netWorthService:
//  - total: area con el dinero de todas las cuentas sumado.
//  - byAccount: una linea por cuenta (lineas y no areas apiladas: una tarjeta en negativo
//    apilada deformaria el total y no se leeria).
//  - una cuenta concreta: area de esa cuenta.
// Solo presentacion. Colores de cuenta acompanados siempre de leyenda (nunca solo color).
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Account } from '../../db/schema';
import type { NetWorthResult } from '../../services/netWorthService';
import { pickAccentColor } from '../../lib/colors';
import { formatCompactEuros, useChartColors } from '../dashboard/chartTheme';
import { MoneyTooltip } from '../dashboard/MoneyTooltip';

export type NetWorthView = 'total' | 'byAccount' | { accountId: string };

interface NetWorthChartProps {
  data: NetWorthResult;
  accounts: Account[];
  view: NetWorthView;
  height?: number;
  compact?: boolean; // sin ejes ni leyenda (tarjeta del dashboard)
}

const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

// "18 nov" (diario) o "nov 26" (mensual). Sin construir Date desde el string (zona horaria).
export function netWorthTickLabel(date: string, granularity: 'day' | 'month'): string {
  const [y, m, d] = date.split('-');
  const month = MONTHS_SHORT[Number(m) - 1] ?? m;
  return granularity === 'day' ? `${Number(d)} ${month}` : `${month} ${y?.slice(2)}`;
}

export function netWorthLongLabel(date: string): string {
  const [y, m, d] = date.split('-');
  return `${Number(d)} ${MONTHS_SHORT[Number(m) - 1] ?? m} ${y}`;
}

export function accountColor(account: Account, index: number): string {
  return account.color ?? pickAccentColor(index);
}

export function NetWorthChart({ data, accounts, view, height = 280, compact = false }: NetWorthChartProps) {
  const colors = useChartColors();
  const tick = (d: string) => netWorthTickLabel(d, data.granularity);
  const margin = compact ? { top: 4, right: 0, bottom: 0, left: 0 } : { top: 8, right: 16, bottom: 4, left: 8 };

  // Recharts solo reconoce ejes y rejilla como hijos directos (no dentro de un fragmento):
  // se pasan como array.
  const axes = compact
    ? []
    : [
        <CartesianGrid key="grid" stroke={colors.grid} vertical={false} />,
        <XAxis
          key="x"
          dataKey="date"
          tickFormatter={tick}
          tick={{ fontSize: 11, fill: colors.axis }}
          axisLine={{ stroke: colors.grid }}
          tickLine={false}
          minTickGap={24}
        />,
        <YAxis
          key="y"
          tickFormatter={formatCompactEuros}
          tick={{ fontSize: 11, fill: colors.axis }}
          axisLine={false}
          tickLine={false}
          width={48}
        />,
      ];
  const tooltip = <Tooltip content={<MoneyTooltip labelFormatter={netWorthLongLabel} />} />;

  if (view === 'byAccount') {
    // Solo cuentas que han tenido saldo en algun punto de la ventana (las vacias no aportan).
    const visible = accounts
      .map((a, i) => ({ account: a, color: accountColor(a, i) }))
      .filter(({ account }) => data.points.some((p) => (p.byAccount[account.id] ?? 0) !== 0));
    const rows = data.points.map((p) => {
      const row: Record<string, number | string> = { date: p.date };
      for (const { account } of visible) row[account.id] = p.byAccount[account.id] ?? 0;
      return row;
    });
    return (
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={rows} margin={margin}>
          {axes}
          {tooltip}
          {!compact && <Legend wrapperStyle={{ fontSize: 12 }} />}
          {visible.map(({ account, color }) => (
            <Line
              key={account.id}
              type="monotone"
              dataKey={account.id}
              name={account.name}
              stroke={color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3 }}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    );
  }

  const single = typeof view === 'object' ? accounts.find((a) => a.id === view.accountId) : undefined;
  const stroke = single ? accountColor(single, accounts.indexOf(single)) : colors.savings;
  const name = single ? single.name : 'Patrimonio total';
  const rows = data.points.map((p) => ({
    date: p.date,
    value: single ? (p.byAccount[single.id] ?? 0) : p.totalCents,
  }));
  const gradientId = `nw-${single ? single.id : 'total'}${compact ? '-c' : ''}`;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={rows} margin={margin}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity={0.35} />
            <stop offset="100%" stopColor={stroke} stopOpacity={0.04} />
          </linearGradient>
        </defs>
        {axes}
        {compact && <YAxis hide domain={['dataMin', 'dataMax']} />}
        {tooltip}
        <Area
          type="monotone"
          dataKey="value"
          name={name}
          stroke={stroke}
          strokeWidth={2}
          fill={`url(#${gradientId})`}
          dot={false}
          activeDot={{ r: 3 }}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
