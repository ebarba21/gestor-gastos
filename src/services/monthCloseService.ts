// Cierre de mes guiado (noviembre 2026). Un ritual corto para que las cifras del mes sean de
// fiar antes de mirarlas: 1) importar cada cuenta hasta fin de mes, 2) dejar el mes sin
// movimientos sin categoria, 3) bandeja de revision a cero, 4) conciliar cada cuenta con su
// extracto a fin de mes. Despues, el resumen del mes (insightsService).
//
// El estado se DEDUCE de los datos (no se guarda un "mes cerrado" aparte): si importas o
// concilias mas tarde, el cierre se actualiza solo. Funciones puras + un cargador aislado por
// perfil.
import type { Account, Reconciliation, Transaction } from '../db/schema';
import { accountsRepo } from '../db/accountsRepo';
import { reconciliationsRepo } from '../db/reconciliationsRepo';
import { reviewItemsRepo } from '../db/reviewItemsRepo';
import { transactionsRepo } from '../db/transactionsRepo';
import { daysBetweenISO, daysInMonth, shiftDays, shiftMonths, todayISO, toISO } from '../lib/dates';
import { requireProfileId } from '../lib/validation';

// Margen al final del mes: un extracto que llega hasta el dia 28 de un mes sin movimientos los
// ultimos dias se da por completo. Igual para la fecha de una conciliacion.
export const CLOSE_TOLERANCE_DAYS = 3;

export interface AccountCloseStatus {
  accountId: string;
  name: string;
  lastMovementDate: string | null;
  imported: boolean; // tiene movimientos hasta (casi) fin de mes
  lastReconciliationDate: string | null;
  reconciled: boolean; // conciliada con fecha de extracto a fin de mes (o despues)
}

export interface MonthCloseStatus {
  month: string; // YYYY-MM
  monthEnd: string;
  isOpenMonth: boolean; // el mes aun no ha terminado
  accounts: AccountCloseStatus[];
  uncategorizedInMonth: number;
  openReviewCount: number;
  steps: { imported: boolean; categorized: boolean; reviewed: boolean; reconciled: boolean };
  done: boolean; // todos los pasos completados
  // Meses seguidos cerrados hasta este (incluido), mirando importacion, categorias y
  // conciliacion (la bandeja es un estado actual, no historico, y no cuenta para la racha).
  streak: number;
}

export interface MonthCloseInput {
  month: string; // YYYY-MM
  today: string;
  accounts: Account[];
  transactions: Transaction[];
  reconciliations: Reconciliation[];
  openReviewCount: number;
}

function monthEndOf(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return toISO(y, m, daysInMonth(y, m));
}

function monthStartOf(month: string): string {
  return `${month}-01`;
}

// Cuentas que importan para el cierre de un mes: activas o archivadas despues del mes, y con
// algun movimiento hasta fin de ese mes (una cuenta abierta despues no se exige).
function relevantAccounts(accounts: Account[], txs: Transaction[], monthEnd: string): Account[] {
  const withMovements = new Set(txs.filter((t) => t.date <= monthEnd).map((t) => t.accountId));
  return accounts.filter((a) => a.archivedAt === null && withMovements.has(a.id));
}

function checkMonth(input: MonthCloseInput, month: string) {
  const monthEnd = monthEndOf(month);
  const monthStart = monthStartOf(month);
  const lastByAccount = new Map<string, string>();
  for (const t of input.transactions) {
    const prev = lastByAccount.get(t.accountId);
    if (prev === undefined || t.date > prev) lastByAccount.set(t.accountId, t.date);
  }
  const recByAccount = new Map<string, string>();
  for (const r of input.reconciliations) {
    const prev = recByAccount.get(r.accountId);
    // Solo cuentan las conciliaciones a fin de mes o despues (balanceadas o aceptadas). Una
    // posterior tambien avala el mes: el saldo es acumulado y cuadra con todo lo anterior.
    if (r.status === 'discrepancy') continue;
    if (r.statementDate < shiftDays(monthEnd, -CLOSE_TOLERANCE_DAYS)) continue;
    if (prev === undefined || r.statementDate < prev) recByAccount.set(r.accountId, r.statementDate);
  }
  const accounts: AccountCloseStatus[] = relevantAccounts(input.accounts, input.transactions, monthEnd).map((a) => {
    const last = lastByAccount.get(a.id) ?? null;
    const rec = recByAccount.get(a.id) ?? null;
    return {
      accountId: a.id,
      name: a.name,
      lastMovementDate: last,
      imported: last !== null && daysBetweenISO(last, monthEnd) <= CLOSE_TOLERANCE_DAYS,
      lastReconciliationDate: rec,
      reconciled: rec !== null,
    };
  });
  const uncategorizedInMonth = input.transactions.filter(
    (t) =>
      t.date >= monthStart &&
      t.date <= monthEnd &&
      t.type !== 'transfer' &&
      !t.isSplitParent &&
      t.categoryId === null &&
      !t.excludedFromStats,
  ).length;
  return { monthEnd, accounts, uncategorizedInMonth };
}

export function computeMonthClose(input: MonthCloseInput): MonthCloseStatus {
  const { monthEnd, accounts, uncategorizedInMonth } = checkMonth(input, input.month);
  const steps = {
    imported: accounts.length > 0 && accounts.every((a) => a.imported),
    categorized: uncategorizedInMonth === 0,
    reviewed: input.openReviewCount === 0,
    reconciled: accounts.length > 0 && accounts.every((a) => a.reconciled),
  };
  const isOpenMonth = input.today <= monthEnd;
  const done = !isOpenMonth && steps.imported && steps.categorized && steps.reviewed && steps.reconciled;

  // Racha: meses consecutivos (este incluido) con importacion, categorias y conciliacion al dia.
  let streak = 0;
  for (let i = 0; i < 24; i++) {
    const m = shiftMonths(`${input.month}-01`, -i).slice(0, 7);
    if (input.today <= monthEndOf(m)) break; // un mes en curso no puede estar cerrado
    const c = checkMonth(input, m);
    const ok =
      c.accounts.length > 0 &&
      c.accounts.every((a) => a.imported && a.reconciled) &&
      c.uncategorizedInMonth === 0;
    if (!ok) break;
    streak++;
  }

  return {
    month: input.month,
    monthEnd,
    isOpenMonth,
    accounts,
    uncategorizedInMonth,
    openReviewCount: input.openReviewCount,
    steps,
    done,
    streak,
  };
}

// Mes que toca cerrar: el anterior al de hoy.
export function defaultCloseMonth(today: string): string {
  return shiftMonths(today.slice(0, 7) + '-01', -1).slice(0, 7);
}

export const monthCloseService = {
  // Aislamiento por diseno: todos los repositorios exigen profileId.
  async compute(profileId: string, month: string, today: string = todayISO()): Promise<MonthCloseStatus> {
    requireProfileId(profileId);
    const [accounts, transactions, openCounts] = await Promise.all([
      accountsRepo.list(profileId),
      transactionsRepo.list(profileId),
      reviewItemsRepo.countOpenByType(profileId),
    ]);
    const reconciliations = (
      await Promise.all(accounts.map((a) => reconciliationsRepo.listByAccount(profileId, a.id)))
    ).flat();
    const openReviewCount = Object.values(openCounts).reduce((s, n) => s + (n ?? 0), 0);
    return computeMonthClose({ month, today, accounts, transactions, reconciliations, openReviewCount });
  },
};
