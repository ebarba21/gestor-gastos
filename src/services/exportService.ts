// Servicio de exportacion a Excel (XLSX). Genera hojas de calculo de movimientos, cuentas,
// categorias, reglas, metas y del resumen del dashboard, todo en el navegador (SheetJS via
// lib/csvXlsx). Ningun dato sale del dispositivo (invariantes 2 y 3 de CLAUDE.md).
//
// Principio clave del alcance: las exportaciones NO reimplementan logica. Reutilizan
//  - filterTransactions / sortTransactions (mismo filtrado y orden que la lista de la UI),
//  - statsService (mismas metricas que el dashboard),
//  - budgetService (misma evaluacion de consumo que la pantalla de presupuestos).
// Aqui solo se da forma tabular a esos resultados. Los importes se escriben en EUROS como
// numero (centsToEuros) para que el usuario pueda operarlos en la hoja; el signo se conserva
// (gasto negativo, ingreso positivo), coherente con el modelo.
import type {
  Account,
  Budget,
  Category,
  Debt,
  DebtPayment,
  Merchant,
  MerchantAlias,
  Rule,
  RuleCondition,
  Transaction,
  TransactionType,
  CategorizedBy,
  TransactionStatus,
} from '../db/schema';
import type { SheetSpec, ExportCell } from '../lib/csvXlsx';
import { centsToEuros } from '../lib/money';
import {
  filterTransactions,
  sortTransactions,
  type TxFilter,
  type TxSort,
  type SortNameLookups,
} from '../lib/transactionFilters';
import { ACCOUNT_KIND_LABELS } from './accountService';
import {
  BUDGET_SCOPE_LABELS,
  BUDGET_PERIOD_LABELS,
  BUDGET_DIRECTION_LABELS,
  type BudgetEvaluation,
} from './budgetService';
import type { DashboardData } from './statsService';

// Mapas id -> nombre que la UI ya tiene calculados (cuentas, categorias, etiquetas).
export interface NameLookups {
  accountNames: Map<string, string>;
  categoryNames: Map<string, string>;
  tagNames: Map<string, string>;
  merchantNames: Map<string, string>;
}

const TX_TYPE_LABELS: Record<TransactionType, string> = {
  expense: 'Gasto',
  income: 'Ingreso',
  transfer: 'Transferencia',
};

const TX_STATUS_LABELS: Record<TransactionStatus, string> = {
  cleared: 'Confirmado',
  pending: 'Pendiente',
  reconciled: 'Conciliado',
};

const CATEGORIZED_BY_LABELS: Record<CategorizedBy, string> = {
  manual: 'Manual',
  rule: 'Regla',
  import: 'Importación',
  none: 'Sin categorizar',
};

// Euros como numero (2 decimales garantizados por el modelo en centimos). Conserva el signo.
function eur(cents: number): number {
  return centsToEuros(cents);
}

function nameOf(map: Map<string, string>, id: string | null): string {
  if (id === null) return '';
  return map.get(id) ?? id;
}

// --- Saldos de cuenta (calculo compartido) ---

// Saldo actual de cada cuenta = saldo inicial + suma de importes de sus movimientos. Se
// excluyen las lineas hijas de un split (parentId != null): el importe real en la cuenta lo
// aporta el movimiento padre; sumar tambien las hijas duplicaria el importe. Transferencias
// y movimientos excluidos de estadísticas SI afectan al saldo (DATA_MODEL seccion 6.4).
export function computeAccountBalances(
  accounts: Account[],
  transactions: Transaction[],
): Map<string, number> {
  const balance = new Map<string, number>();
  for (const a of accounts) balance.set(a.id, a.openingBalanceCents);
  for (const t of transactions) {
    if (t.parentId !== null) continue; // linea hija de split: no suma al saldo
    const current = balance.get(t.accountId);
    if (current === undefined) continue; // cuenta desconocida (no deberia ocurrir)
    balance.set(t.accountId, current + t.amountCents);
  }
  return balance;
}

// --- Hojas por entidad ---

const TX_HEADER: ExportCell[] = [
  'Fecha',
  'Concepto',
  'Concepto original',
  'Importe (EUR)',
  'Tipo',
  'Categoría',
  'Subcategoría',
  'Cuenta',
  'Comercio',
  'Etiquetas',
  'Estado',
  'Notas',
  'Excluido de estadísticas',
  'Categorizado por',
];

function txRow(t: Transaction, names: NameLookups): ExportCell[] {
  return [
    t.date,
    t.concept,
    t.rawConcept,
    eur(t.amountCents),
    TX_TYPE_LABELS[t.type],
    nameOf(names.categoryNames, t.categoryId),
    nameOf(names.categoryNames, t.subcategoryId),
    nameOf(names.accountNames, t.accountId),
    nameOf(names.merchantNames, t.merchantId),
    t.tagIds.map((id) => nameOf(names.tagNames, id)).join(', '),
    TX_STATUS_LABELS[t.status],
    t.notes ?? '',
    t.excludedFromStats ? 'Si' : 'No',
    CATEGORIZED_BY_LABELS[t.categorizedBy],
  ];
}

export function buildTransactionsSheet(
  transactions: Transaction[],
  names: NameLookups,
  sheetName = 'Movimientos',
): SheetSpec {
  return {
    name: sheetName,
    rows: [TX_HEADER, ...transactions.map((t) => txRow(t, names))],
  };
}

// Movimientos filtrados EXACTAMENTE con las mismas funciones que la lista de la UI. El
// filtro y el orden se pasan tal cual los tiene la pantalla; aqui no se reimplementa nada.
export function buildFilteredTransactionsSheet(
  transactions: Transaction[],
  filter: TxFilter,
  sort: TxSort,
  names: NameLookups,
): SheetSpec {
  const lookups: SortNameLookups = {
    categoryNames: names.categoryNames,
    accountNames: names.accountNames,
  };
  const filtered = filterTransactions(transactions, filter);
  const ordered = sortTransactions(filtered, sort, lookups);
  return buildTransactionsSheet(ordered, names, 'Movimientos filtrados');
}

export function buildAccountsSheet(
  accounts: Account[],
  balances: Map<string, number>,
): SheetSpec {
  const header: ExportCell[] = [
    'Nombre',
    'Tipo',
    'Moneda',
    'Saldo inicial (EUR)',
    'Saldo actual (EUR)',
    'Archivada',
  ];
  const rows = accounts.map((a) => [
    a.name,
    ACCOUNT_KIND_LABELS[a.kind],
    a.currency,
    eur(a.openingBalanceCents),
    eur(balances.get(a.id) ?? a.openingBalanceCents),
    a.archivedAt === null ? 'No' : 'Si',
  ]);
  return { name: 'Cuentas', rows: [header, ...rows] };
}

export function buildCategoriesSheet(categories: Category[]): SheetSpec {
  const nameById = new Map(categories.map((c) => [c.id, c.name]));
  const header: ExportCell[] = ['Nombre', 'Tipo', 'Categoría padre', 'Icono', 'Orden', 'Archivada'];
  const kindLabel: Record<Category['kind'], string> = {
    expense: 'Gasto',
    income: 'Ingreso',
    both: 'Ambos',
  };
  const rows = categories.map((c) => [
    c.name,
    kindLabel[c.kind],
    c.parentId === null ? '' : nameById.get(c.parentId) ?? c.parentId,
    c.icon ?? '',
    c.sortOrder,
    c.archivedAt === null ? 'No' : 'Si',
  ]);
  return { name: 'Categorias', rows: [header, ...rows] };
}

// Descripcion legible de una condicion de regla (para la columna de la hoja de reglas).
function describeCondition(cond: RuleCondition, names: NameLookups): string {
  const value =
    cond.field === 'account' && typeof cond.value === 'string'
      ? nameOf(names.accountNames, cond.value)
      : cond.field === 'merchant' && typeof cond.value === 'string'
        ? nameOf(names.merchantNames, cond.value)
        : String(cond.value);
  const value2 = cond.value2 === null ? '' : ` .. ${String(cond.value2)}`;
  return `${cond.field} ${cond.operator} ${value}${value2}`.trim();
}

// --- Comercios (fase 4) ---

const MATCH_TYPE_LABELS: Record<MerchantAlias['matchType'], string> = {
  exact: 'Exacto',
  contains: 'Contiene',
  startsWith: 'Empieza por',
  regex: 'Regex',
};

export function buildMerchantsSheet(merchants: Merchant[], names: NameLookups): SheetSpec {
  const header: ExportCell[] = [
    'Nombre',
    'Categoría por defecto',
    'Subcategoría por defecto',
    'Etiquetas por defecto',
    'Notas',
    'Archivado',
  ];
  const rows = merchants.map((m) => [
    m.canonicalName,
    nameOf(names.categoryNames, m.defaultCategoryId),
    nameOf(names.categoryNames, m.defaultSubcategoryId),
    m.defaultTagIds.map((id) => nameOf(names.tagNames, id)).join(', '),
    m.notes ?? '',
    m.archivedAt === null ? 'No' : 'Si',
  ]);
  return { name: 'Comercios', rows: [header, ...rows] };
}

export function buildMerchantAliasesSheet(
  aliases: MerchantAlias[],
  merchantNames: Map<string, string>,
): SheetSpec {
  const header: ExportCell[] = ['Comercio', 'Alias', 'Tipo de coincidencia', 'Prioridad', 'Activo'];
  const rows = aliases.map((a) => [
    nameOf(merchantNames, a.merchantId),
    a.rawAlias,
    MATCH_TYPE_LABELS[a.matchType],
    a.priority,
    a.enabled ? 'Si' : 'No',
  ]);
  return { name: 'Alias de comercio', rows: [header, ...rows] };
}

// --- Deudas (fase 8) ---

const DEBT_TYPE_LABELS: Record<Debt['type'], string> = {
  personalLoan: 'Prestamo personal',
  mortgageFixed: 'Hipoteca fija',
  card: 'Tarjeta',
  other: 'Otra',
};

const DEBT_STATUS_LABELS: Record<Debt['status'], string> = {
  active: 'Activa',
  paidOff: 'Liquidada',
  archived: 'Archivada',
};

// Tipo de interes en porcentaje legible (annualRatePpm esta en micro-fraccion 1e-6: 50000 ppm ->
// 5%). Solo para presentacion; el calculo financiero nunca usa este valor formateado.
function ppmToPercentLabel(ppm: number): string {
  return `${(ppm / 10000).toFixed(4)}%`;
}

export function buildDebtsSheet(
  debts: Debt[],
  names: Pick<NameLookups, 'accountNames' | 'categoryNames'>,
): SheetSpec {
  const header: ExportCell[] = [
    'Nombre',
    'Tipo',
    'Moneda',
    'Principal original (EUR)',
    'Principal pendiente (EUR)',
    'Tipo de interes anual',
    'Cuota / pago minimo (EUR)',
    'Proxima fecha de pago',
    'Plazo restante (meses)',
    'Cuenta vinculada',
    'Categoría vinculada',
    'Estado',
  ];
  const rows = debts.map((d) => [
    d.name,
    DEBT_TYPE_LABELS[d.type],
    d.currency,
    eur(d.originalPrincipalCents),
    eur(d.outstandingPrincipalCents),
    ppmToPercentLabel(d.annualRatePpm),
    eur(d.minimumPaymentCents),
    d.nextPaymentDate ?? '',
    d.remainingTermMonths ?? '',
    nameOf(names.accountNames, d.linkedAccountId),
    nameOf(names.categoryNames, d.linkedCategoryId),
    DEBT_STATUS_LABELS[d.status],
  ]);
  return { name: 'Deudas', rows: [header, ...rows] };
}

export function buildDebtPaymentsSheet(payments: DebtPayment[], debtNames: Map<string, string>): SheetSpec {
  const header: ExportCell[] = [
    'Deuda',
    'Fecha',
    'Total (EUR)',
    'Principal (EUR)',
    'Interes (EUR)',
    'Comisiones (EUR)',
    'Amortizacion extraordinaria (EUR)',
    'Movimiento vinculado',
  ];
  const rows = payments.map((p) => [
    nameOf(debtNames, p.debtId),
    p.date,
    eur(p.totalCents),
    eur(p.principalCents),
    eur(p.interestCents),
    eur(p.feesCents),
    eur(p.extraPrincipalCents),
    p.transactionId === null ? 'No' : 'Si',
  ]);
  return { name: 'Pagos de deuda', rows: [header, ...rows] };
}

// Calendario de amortizacion descargable (simulador/comparador de la UI de deudas). Genera una
// hoja independiente a partir de las filas YA calculadas por debtAmortizationEngine: no
// reimplementa el calculo (mismo principio que el resto de exportaciones).
export function buildAmortizationScheduleSheet(
  rows: { period: number; date: string; paymentCents: number; interestCents: number; principalCents: number; balanceCents: number }[],
  sheetName = 'Calendario de amortizacion',
): SheetSpec {
  const header: ExportCell[] = ['Periodo', 'Fecha', 'Cuota (EUR)', 'Interes (EUR)', 'Principal (EUR)', 'Saldo (EUR)'];
  const dataRows = rows.map((r) => [r.period, r.date, eur(r.paymentCents), eur(r.interestCents), eur(r.principalCents), eur(r.balanceCents)]);
  return { name: sheetName, rows: [header, ...dataRows] };
}

export function buildRulesSheet(rules: Rule[], names: NameLookups): SheetSpec {
  const header: ExportCell[] = [
    'Nombre',
    'Activa',
    'Prioridad',
    'Modo',
    'Condiciones',
    'Asignar categoria',
    'Asignar subcategoria',
    'Anadir etiquetas',
    'Excluir de estadísticas',
    'Detener al casar',
  ];
  const rows = rules.map((r) => [
    r.name,
    r.enabled ? 'Si' : 'No',
    r.priority,
    r.matchMode === 'all' ? 'Todas' : 'Alguna',
    r.conditions.map((c) => describeCondition(c, names)).join(' | '),
    nameOf(names.categoryNames, r.action.setCategoryId),
    nameOf(names.categoryNames, r.action.setSubcategoryId),
    r.action.addTagIds.map((id) => nameOf(names.tagNames, id)).join(', '),
    r.action.setExcludedFromStats === null ? '' : r.action.setExcludedFromStats ? 'Si' : 'No',
    r.stopOnMatch ? 'Si' : 'No',
  ]);
  return { name: 'Reglas', rows: [header, ...rows] };
}

const BUDGET_STATUS_LABELS: Record<BudgetEvaluation['status'], string> = {
  ok: 'En rango',
  warning: 'Cerca del limite',
  exceeded: 'Superado',
  met: 'Objetivo alcanzado',
};

// Metas/presupuestos: se exportan con su evaluacion de consumo del periodo (misma que la UI
// de presupuestos, calculada por budgetService). Requiere las evaluaciones ya calculadas.
export function buildBudgetsSheet(
  evaluations: BudgetEvaluation[],
  scopeNameOf: (budget: Budget) => string,
): SheetSpec {
  const header: ExportCell[] = [
    'Nombre',
    'Ambito',
    'Objetivo',
    'Dirección',
    'Periodo',
    'Desde',
    'Hasta',
    'Limite (EUR)',
    'Consumido (EUR)',
    'Restante (EUR)',
    'Porcentaje',
    'Estado',
  ];
  const rows = evaluations.map((e) => [
    e.budget.name,
    BUDGET_SCOPE_LABELS[e.budget.scope],
    scopeNameOf(e.budget),
    BUDGET_DIRECTION_LABELS[e.budget.direction],
    BUDGET_PERIOD_LABELS[e.budget.period],
    e.range.from,
    e.range.to,
    eur(e.limitCents),
    eur(e.consumedCents),
    eur(e.remainingCents),
    `${e.percent}%`,
    BUDGET_STATUS_LABELS[e.status],
  ]);
  return { name: 'Metas', rows: [header, ...rows] };
}

// --- Resumen del dashboard (varias hojas) ---

// Convierte el resultado del dashboard (statsService, mismas metricas que la pantalla) en
// varias hojas de calculo. No recalcula nada: solo tabula `data`.
export function buildDashboardSheets(data: DashboardData, names: NameLookups): SheetSpec[] {
  const s = data.summary;
  const ratio =
    s.savingsRatePerMille === null ? '' : `${(s.savingsRatePerMille / 10).toFixed(1)}%`;

  const resumen: SheetSpec = {
    name: 'Resumen',
    rows: [
      ['Periodo desde', data.range.from],
      ['Periodo hasta', data.range.to],
      ['Mes de referencia', data.anchorMonth],
      [],
      ['Metrica', 'Valor (EUR)'],
      ['Ingresos', eur(s.incomeCents)],
      ['Gasto bruto', eur(s.expenseGrossCents)],
      ['Reembolsos', eur(s.refundCents)],
      ['Gasto neto', eur(s.expenseNetCents)],
      ['Ahorro neto', eur(s.netSavingsCents)],
      ['Ahorrado (apartado a Ahorros)', eur(s.savingsContribCents)],
      ['Invertido', eur(s.investmentContribCents)],
      ['Tasa de ahorro', ratio],
    ],
  };

  const porCategoria: SheetSpec = {
    name: 'Gasto por categoria',
    rows: [
      ['Categoría', 'Gasto bruto (EUR)', 'Reembolsos (EUR)', 'Gasto neto (EUR)'],
      ...data.byCategory.map((c) => [
        c.categoryId === null ? 'Sin categoria' : nameOf(names.categoryNames, c.categoryId),
        eur(c.grossCents),
        eur(c.refundCents),
        eur(c.netCents),
      ]),
    ],
  };

  const evolucion: SheetSpec = {
    name: 'Evolucion mensual',
    rows: [
      ['Mes', 'Ingresos (EUR)', 'Gasto neto (EUR)', 'Ahorro neto (EUR)'],
      ...data.monthly.map((m) => [
        m.month,
        eur(m.incomeCents),
        eur(m.expenseNetCents),
        eur(m.netSavingsCents),
      ]),
    ],
  };

  const topGastos: SheetSpec = {
    name: 'Top gastos',
    rows: [
      ['Fecha', 'Concepto', 'Importe (EUR)', 'Categoría', 'Cuenta'],
      ...data.topExpenses.map((t) => [
        t.date,
        t.concept,
        eur(t.amountCents),
        t.categoryId === null ? 'Sin categoria' : nameOf(names.categoryNames, t.categoryId),
        nameOf(names.accountNames, t.accountId),
      ]),
    ],
  };

  const recurrentes: SheetSpec = {
    name: 'Recurrentes',
    rows: [
      ['Concepto', 'Ocurrencias', 'Meses', 'Total (EUR)', 'Media (EUR)', 'Ultima fecha'],
      ...data.recurring.map((r) => [
        r.label,
        r.occurrences,
        r.months,
        eur(r.totalCents),
        eur(r.averageCents),
        r.lastDate,
      ]),
    ],
  };

  const comp = data.comparison;
  const comparativa: SheetSpec = {
    name: 'Comparativa',
    rows: [
      ['Metrica', 'Valor'],
      ['Gasto neto del mes (EUR)', eur(comp.currentExpenseNetCents)],
      ['Media meses previos (EUR)', eur(comp.averageExpenseNetCents)],
      ['Meses comparados', comp.monthsCompared],
      ['Diferencia (EUR)', eur(comp.deltaCents)],
      ['Variacion', comp.deltaPerMille === null ? '' : `${(comp.deltaPerMille / 10).toFixed(1)}%`],
    ],
  };

  const fc = data.forecast;
  const forecast: SheetSpec = {
    name: 'Forecast',
    rows: [
      ['Metrica', 'Valor'],
      ['Aplicable (mes en curso)', fc.applicable ? 'Si' : 'No'],
      ['Gasto hasta hoy (EUR)', eur(fc.spentSoFarCents)],
      ['Proyeccion fin de mes (EUR)', eur(fc.projectedExpenseCents)],
      ['Dias transcurridos', fc.daysElapsed],
      ['Dias del mes', fc.daysInMonth],
    ],
  };

  return [resumen, porCategoria, evolucion, topGastos, recurrentes, comparativa, forecast];
}

// Etiquetas de tipos de exportacion (para nombres de fichero legibles en la UI).
export const EXPORT_LABELS = {
  filteredTransactions: 'movimientos-filtrados',
  allTransactions: 'movimientos',
  accounts: 'cuentas',
  categories: 'categorias',
  rules: 'reglas',
  budgets: 'metas',
  dashboard: 'dashboard',
  merchants: 'comercios',
  debts: 'deudas',
} as const;

export const exportService = {
  computeAccountBalances,
  buildTransactionsSheet,
  buildFilteredTransactionsSheet,
  buildAccountsSheet,
  buildCategoriesSheet,
  buildRulesSheet,
  buildBudgetsSheet,
  buildDashboardSheets,
  buildMerchantsSheet,
  buildMerchantAliasesSheet,
  buildDebtsSheet,
  buildDebtPaymentsSheet,
  buildAmortizationScheduleSheet,
};
