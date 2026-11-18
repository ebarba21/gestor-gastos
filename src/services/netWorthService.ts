// Patrimonio: evolucion del dinero total del perfil, en todas sus cuentas o en cada una.
//
// Semantica de saldo (la de exportService.computeAccountBalances, la funcion canonica, pero A UNA
// FECHA): saldo de una cuenta en una fecha = saldo inicial + suma de amountCents de sus movimientos
// con fecha <= esa fecha. El patrimonio "de hoy" no incluye movimientos con fecha futura ya
// registrados; se informan aparte (futureCount/futureCents) para que cuadre con el saldo exportado. INCLUYE transferencias y movimientos excluidos de estadisticas (el saldo no
// es lo mismo que las estadisticas) y EXCLUYE las lineas hijas de un split (el cargo real lo
// aporta el movimiento padre). Patrimonio total = suma de los saldos de todas las cuentas,
// archivadas incluidas (si una cuenta archivada aun tiene saldo, ese dinero sigue siendo tuyo).
//
// Funciones puras y deterministas (hoy inyectable). Importes siempre en centimos enteros.
// Las deudas no restan: su saldo pendiente no tiene historico por fecha en el modelo, asi que
// mezclarlo daria una serie inventada hacia atras.
import type { Account, Transaction } from '../db/schema';
import { accountsRepo } from '../db/accountsRepo';
import { transactionsRepo } from '../db/transactionsRepo';
import { daysInMonth, parseISO, shiftDays, shiftMonths, todayISO, toISO } from '../lib/dates';
import { requireProfileId, ValidationError } from '../lib/validation';

// Ventanas disponibles en el selector. 'all' = desde el primer movimiento del perfil.
export type NetWorthWindow = '1m' | '3m' | '6m' | '1y' | '2y' | '5y' | 'all';

export const NET_WORTH_WINDOWS: readonly NetWorthWindow[] = ['1m', '3m', '6m', '1y', '2y', '5y', 'all'];

export const NET_WORTH_WINDOW_LABELS: Record<NetWorthWindow, string> = {
  '1m': '1 mes',
  '3m': '3 meses',
  '6m': '6 meses',
  '1y': '1 año',
  '2y': '2 años',
  '5y': '5 años',
  all: 'Todo',
};

// Meses que cubre cada ventana (null = todo el historico).
const WINDOW_MONTHS: Record<NetWorthWindow, number | null> = {
  '1m': 1,
  '3m': 3,
  '6m': 6,
  '1y': 12,
  '2y': 24,
  '5y': 60,
  all: null,
};

// Punto de la serie: saldo al cierre del dia `date` (fin de mes, o el propio dia en ventanas
// cortas; el ultimo punto siempre es hoy).
export interface NetWorthPoint {
  date: string; // YYYY-MM-DD
  totalCents: number;
  byAccount: Record<string, number>; // accountId -> saldo en centimos
}

export interface AccountBalanceSummary {
  accountId: string;
  balanceCents: number;
  // Peso sobre la suma de saldos POSITIVOS, en tanto por mil (null si la cuenta esta en
  // negativo o no hay saldo positivo). Un saldo negativo (tarjeta) no "pesa" en el reparto.
  sharePerMille: number | null;
  // Variacion frente al primer punto de la ventana.
  changeCents: number;
  archived: boolean;
}

export interface NetWorthSummary {
  currentCents: number;
  // Variacion frente a hace 1 mes / 12 meses. null si el historico no llega tan atras.
  changeMonthCents: number | null;
  changeYearCents: number | null;
  // Variacion frente al primer punto de la ventana visible.
  changeWindowCents: number;
  // Maximo historico dentro de la ventana y su fecha.
  peakCents: number;
  peakDate: string;
}

export interface NetWorthResult {
  window: NetWorthWindow;
  granularity: 'day' | 'month';
  points: NetWorthPoint[];
  accounts: AccountBalanceSummary[]; // ordenadas por saldo descendente
  summary: NetWorthSummary;
  firstMovementDate: string | null;
  hasData: boolean; // hay al menos una cuenta
  // Movimientos con fecha posterior a hoy (ya registrados): no entran en el saldo de hoy.
  futureCount: number;
  futureCents: number;
}

export interface NetWorthParams {
  window: NetWorthWindow;
  today?: string;
}

// Movimientos que cuentan para el saldo: todos menos las lineas hijas de un split.
function balanceMovements(transactions: Transaction[]): Transaction[] {
  return transactions.filter((t) => t.parentId === null);
}

// Ultimo dia del mes de una fecha.
function endOfMonth(iso: string): string {
  const { y, m } = parseISO(iso);
  return toISO(y, m, daysInMonth(y, m));
}

// Fechas de corte de la serie entre `from` y `today` (ambas incluidas). Ventanas de hasta 3
// meses van por dias (se ve el detalle de cada cobro); el resto, por cierres de mes. El ultimo
// punto es siempre hoy.
export function samplingDates(from: string, today: string, granularity: 'day' | 'month'): string[] {
  if (from > today) return [today];
  const dates: string[] = [];
  if (granularity === 'day') {
    for (let d = from; d <= today; d = shiftDays(d, 1)) dates.push(d);
    return dates;
  }
  let cursor = endOfMonth(from);
  while (cursor < today) {
    dates.push(cursor);
    const { y, m } = parseISO(cursor);
    cursor = endOfMonth(toISO(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1));
  }
  dates.push(today);
  return dates;
}

// Saldo de cada cuenta al cierre de cada fecha de corte. Barrido unico: movimientos ordenados
// por fecha y acumulados en orden, sin recorrer la lista una vez por punto.
export function balancesAtDates(
  accounts: Account[],
  transactions: Transaction[],
  dates: readonly string[],
): NetWorthPoint[] {
  for (const d of dates) parseISO(d); // valida el formato
  const running = new Map<string, number>();
  for (const a of accounts) running.set(a.id, a.openingBalanceCents);
  const sorted = balanceMovements(transactions)
    .filter((t) => running.has(t.accountId))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const points: NetWorthPoint[] = [];
  let i = 0;
  for (const date of dates) {
    while (i < sorted.length && sorted[i]!.date <= date) {
      const t = sorted[i]!;
      running.set(t.accountId, running.get(t.accountId)! + t.amountCents);
      i++;
    }
    const byAccount: Record<string, number> = {};
    let total = 0;
    for (const a of accounts) {
      const v = running.get(a.id)!;
      byAccount[a.id] = v;
      total += v;
    }
    points.push({ date, totalCents: total, byAccount });
  }
  return points;
}

// Saldo total en una fecha concreta (para las variaciones a 1 y 12 meses).
function totalAt(accounts: Account[], transactions: Transaction[], date: string): number {
  return balancesAtDates(accounts, transactions, [date])[0]!.totalCents;
}

export function computeNetWorth(
  accounts: Account[],
  transactions: Transaction[],
  params: NetWorthParams,
): NetWorthResult {
  const today = params.today ?? todayISO();
  parseISO(today);
  if (!NET_WORTH_WINDOWS.includes(params.window)) {
    throw new ValidationError(`Ventana de patrimonio desconocida: ${String(params.window)}.`);
  }
  const movements = balanceMovements(transactions).filter((t) => accounts.some((a) => a.id === t.accountId));
  const firstMovementDate = movements.reduce<string | null>(
    (min, t) => (min === null || t.date < min ? t.date : min),
    null,
  );

  const months = WINDOW_MONTHS[params.window];
  const granularity: 'day' | 'month' = months !== null && months <= 3 ? 'day' : 'month';
  // Inicio de la ventana: N meses atras, pero nunca antes del primer movimiento (no se pintan
  // meses vacios previos a tener datos). Sin movimientos, la serie es solo hoy.
  let from: string;
  if (months === null) {
    from = firstMovementDate ?? today;
  } else {
    const windowStart = shiftDays(shiftMonths(today, -months), 1);
    from = firstMovementDate !== null && firstMovementDate > windowStart ? firstMovementDate : windowStart;
  }
  if (from > today) from = today;
  // En granularidad mensual el primer punto es el cierre del mes anterior al inicio, para que
  // la variacion de la ventana incluya el primer mes completo.
  const dates =
    granularity === 'month'
      ? samplingDates(shiftDays(toISO(parseISO(from).y, parseISO(from).m, 1), -1), today, 'month')
      : samplingDates(shiftDays(from, -1), today, 'day');

  const points = balancesAtDates(accounts, transactions, dates);
  const first = points[0]!;
  const last = points[points.length - 1]!;

  const monthAgo = shiftMonths(today, -1);
  const yearAgo = shiftMonths(today, -12);
  const reaches = (date: string) => firstMovementDate !== null && firstMovementDate <= date;
  const changeMonthCents = reaches(monthAgo) ? last.totalCents - totalAt(accounts, transactions, monthAgo) : null;
  const changeYearCents = reaches(yearAgo) ? last.totalCents - totalAt(accounts, transactions, yearAgo) : null;

  // El primer punto es la base (cierre anterior a la ventana): sirve para la variacion del
  // periodo, pero el maximo se busca solo dentro de la ventana.
  const inWindow = points.length > 1 ? points.slice(1) : points;
  let peak = inWindow[0]!;
  for (const p of inWindow) if (p.totalCents > peak.totalCents) peak = p;

  const positiveTotal = accounts.reduce((s, a) => s + Math.max(0, last.byAccount[a.id] ?? 0), 0);
  const accountSummaries: AccountBalanceSummary[] = accounts
    .map((a) => {
      const balance = last.byAccount[a.id] ?? 0;
      return {
        accountId: a.id,
        balanceCents: balance,
        sharePerMille: balance > 0 && positiveTotal > 0 ? Math.round((balance * 1000) / positiveTotal) : null,
        changeCents: balance - (first.byAccount[a.id] ?? 0),
        archived: a.archivedAt !== null,
      };
    })
    .sort((a, b) => b.balanceCents - a.balanceCents);
  // El reparto suma exactamente 1000: el residuo del redondeo va a la cuenta de mayor saldo.
  const shares = accountSummaries.filter((a) => a.sharePerMille !== null);
  if (shares.length > 0) {
    const residue = 1000 - shares.reduce((sum, a) => sum + a.sharePerMille!, 0);
    shares[0]!.sharePerMille = shares[0]!.sharePerMille! + residue;
  }
  const future = movements.filter((t) => t.date > today);

  return {
    window: params.window,
    granularity,
    points,
    accounts: accountSummaries,
    summary: {
      currentCents: last.totalCents,
      changeMonthCents,
      changeYearCents,
      changeWindowCents: last.totalCents - first.totalCents,
      peakCents: peak.totalCents,
      peakDate: peak.date,
    },
    firstMovementDate,
    hasData: accounts.length > 0,
    futureCount: future.length,
    futureCents: future.reduce((sum, t) => sum + t.amountCents, 0),
  };
}

export const netWorthService = {
  // Aislamiento por diseno: ambos repositorios exigen profileId y no cruzan perfiles.
  async compute(profileId: string, params: NetWorthParams): Promise<NetWorthResult> {
    requireProfileId(profileId);
    const [accounts, transactions] = await Promise.all([
      accountsRepo.list(profileId),
      transactionsRepo.list(profileId),
    ]);
    return computeNetWorth(accounts, transactions, params);
  },
};
