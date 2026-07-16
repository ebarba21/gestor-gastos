import { describe, it, expect } from 'vitest';
import type { Account, Budget, Category, Rule, Transaction } from '../db/schema';
import type { BudgetEvaluation } from './budgetService';
import { computeDashboard } from './statsService';
import type { NameLookups } from './exportService';
import {
  computeAccountBalances,
  buildTransactionsSheet,
  buildFilteredTransactionsSheet,
  buildAccountsSheet,
  buildCategoriesSheet,
  buildRulesSheet,
  buildBudgetsSheet,
  buildDashboardSheets,
} from './exportService';
import { monthRange } from '../lib/dates';

const PID = 'p1';

function tx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx-' + Math.random().toString(36).slice(2),
    profileId: PID,
    date: '2026-01-10',
    amountCents: -1000,
    type: 'expense',
    concept: 'Compra',
    notes: null,
    accountId: 'acc1',
    categoryId: null,
    subcategoryId: null,
    tagIds: [],
    status: 'cleared',
    categorizedBy: 'none',
    ruleId: null,
    transferGroupId: null,
    parentId: null,
    isSplitParent: false,
    refundOfId: null,
    excludedFromStats: false,
    statsFlag: 0,
    importBatchId: null,
    dedupeHash: 'h',
    rawConcept: 'Compra',
    normalizedConcept: 'compra',
    normalizationVersion: 1,
    merchantId: null,
    merchantMatchSource: 'none',
    merchantMatchConfidence: 0,
    bankTransactionId: null,
    bookingDate: null,
    valueDate: null,
    pending: false,
    currency: 'EUR',
    balanceAfterCents: null,
    bankReference: null,
    operationType: null,
    sourceRowHash: 'row-hash',
    exactFingerprint: 'exact-fp',
    normalizedFingerprint: 'norm-fp',
    fingerprintVersion: 1,
    sourceFileHash: null,
    sourceFileSize: null,
    duplicateStatus: 'unique',
    duplicateConfidence: 0,
    duplicateReasonCodes: [],
    duplicateCandidateIds: [],
    pendingReplacementId: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

const names: NameLookups = {
  accountNames: new Map([
    ['acc1', 'Banco'],
    ['acc2', 'Efectivo'],
  ]),
  categoryNames: new Map([
    ['cat1', 'Alimentacion'],
    ['sub1', 'Supermercado'],
  ]),
  tagNames: new Map([['tag1', 'basico']]),
  merchantNames: new Map([['merch1', 'Amazon']]),
};

describe('computeAccountBalances', () => {
  it('suma importes con signo al saldo inicial y excluye las lineas hijas de split', () => {
    const accounts: Account[] = [
      { id: 'acc1', profileId: PID, name: 'Banco', kind: 'bank', currency: 'EUR', color: null, openingBalanceCents: 10000, archivedAt: null, createdAt: 1, updatedAt: 1 },
      { id: 'acc2', profileId: PID, name: 'Efectivo', kind: 'cash', currency: 'EUR', color: null, openingBalanceCents: 0, archivedAt: null, createdAt: 1, updatedAt: 1 },
    ];
    const transactions: Transaction[] = [
      tx({ accountId: 'acc1', amountCents: -2500 }), // gasto
      tx({ accountId: 'acc1', type: 'income', amountCents: 5000 }), // ingreso
      // Split: el padre aporta el importe real; las hijas NO deben sumar (doble conteo).
      tx({ id: 'p', accountId: 'acc1', amountCents: -3000, isSplitParent: true, excludedFromStats: true }),
      tx({ accountId: 'acc1', amountCents: -1000, parentId: 'p' }),
      tx({ accountId: 'acc1', amountCents: -2000, parentId: 'p' }),
      // Transferencia: ambas patas afectan al saldo aunque esten excluidas de estadisticas.
      tx({ accountId: 'acc1', type: 'transfer', amountCents: -3000, excludedFromStats: true }), // salida
      tx({ accountId: 'acc2', type: 'transfer', amountCents: 3000, excludedFromStats: true }), // entrada
    ];
    const balances = computeAccountBalances(accounts, transactions);
    // acc1: 10000 - 2500 + 5000 - 3000 (padre) - 3000 (pata salida) = 6500. Las hijas quedan fuera.
    expect(balances.get('acc1')).toBe(6500);
    // acc2: 0 + 3000 (pata entrada) = 3000.
    expect(balances.get('acc2')).toBe(3000);
  });
});

describe('buildTransactionsSheet', () => {
  it('escribe cabecera, importes en euros con signo y nombres resueltos', () => {
    const transactions = [
      tx({ amountCents: -2500, categoryId: 'cat1', subcategoryId: 'sub1', accountId: 'acc1', tagIds: ['tag1'] }),
      tx({ type: 'income', amountCents: 12000, accountId: 'acc2' }),
    ];
    const sheet = buildTransactionsSheet(transactions, names);
    expect(sheet.rows[0]).toContain('Importe (EUR)');
    // Fila 1: gasto en euros negativo, categoria y cuenta por nombre.
    const row1 = sheet.rows[1]!;
    expect(row1[3]).toBe(-25); // -2500 centimos -> -25 euros, signo preservado
    expect(row1[4]).toBe('Gasto');
    expect(row1[5]).toBe('Alimentacion');
    expect(row1[6]).toBe('Supermercado');
    expect(row1[7]).toBe('Banco');
    expect(row1[9]).toBe('basico');
    // Fila 2: ingreso en euros positivo.
    expect(sheet.rows[2]![3]).toBe(120);
    expect(sheet.rows[2]![4]).toBe('Ingreso');
  });
});

describe('buildFilteredTransactionsSheet', () => {
  it('aplica el mismo filtrado que la UI (filterTransactions)', () => {
    const transactions = [
      tx({ concept: 'Gasto A', type: 'expense', amountCents: -1000 }),
      tx({ concept: 'Ingreso B', type: 'income', amountCents: 2000 }),
      tx({ concept: 'Gasto C', type: 'expense', amountCents: -3000 }),
    ];
    const sheet = buildFilteredTransactionsSheet(
      transactions,
      { types: ['expense'] },
      { field: 'amount', dir: 'asc' },
      names,
    );
    // Cabecera + 2 gastos (el ingreso queda fuera del filtro).
    expect(sheet.rows).toHaveLength(3);
    // Orden por importe ascendente: -3000 antes que -1000.
    expect(sheet.rows[1]![1]).toBe('Gasto C');
    expect(sheet.rows[2]![1]).toBe('Gasto A');
  });
});

describe('buildAccountsSheet', () => {
  it('incluye saldo inicial y saldo actual en euros', () => {
    const accounts: Account[] = [
      { id: 'acc1', profileId: PID, name: 'Banco', kind: 'bank', currency: 'EUR', color: null, openingBalanceCents: 10000, archivedAt: null, createdAt: 1, updatedAt: 1 },
    ];
    const balances = new Map([['acc1', 7500]]);
    const sheet = buildAccountsSheet(accounts, balances);
    const row = sheet.rows[1]!;
    expect(row[0]).toBe('Banco');
    expect(row[1]).toBe('Banco'); // etiqueta del tipo bank
    expect(row[3]).toBe(100); // saldo inicial 10000 -> 100
    expect(row[4]).toBe(75); // saldo actual 7500 -> 75
  });
});

describe('buildCategoriesSheet', () => {
  it('resuelve el nombre de la categoria padre', () => {
    const categories: Category[] = [
      { id: 'cat1', profileId: PID, name: 'Alimentacion', parentId: null, kind: 'expense', color: null, icon: null, archivedAt: null, sortOrder: 0, createdAt: 1, updatedAt: 1 },
      { id: 'sub1', profileId: PID, name: 'Supermercado', parentId: 'cat1', kind: 'expense', color: null, icon: null, archivedAt: null, sortOrder: 0, createdAt: 1, updatedAt: 1 },
    ];
    const sheet = buildCategoriesSheet(categories);
    expect(sheet.rows[1]![2]).toBe(''); // raiz sin padre
    expect(sheet.rows[2]![2]).toBe('Alimentacion'); // subcategoria referencia a su raiz por nombre
  });
});

describe('buildRulesSheet', () => {
  it('describe condiciones y resuelve la accion por nombre', () => {
    const rules: Rule[] = [
      {
        id: 'r1',
        profileId: PID,
        name: 'Super',
        enabled: true,
        priority: 1,
        matchMode: 'all',
        conditions: [
          { field: 'concept', operator: 'contains', value: 'super', value2: null, caseSensitive: false },
          { field: 'account', operator: 'equals', value: 'acc1', value2: null, caseSensitive: false },
        ],
        action: { setCategoryId: 'cat1', setSubcategoryId: null, addTagIds: ['tag1'], setExcludedFromStats: null },
        stopOnMatch: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    const sheet = buildRulesSheet(rules, names);
    const row = sheet.rows[1]!;
    expect(row[0]).toBe('Super');
    expect(String(row[4])).toContain('concept contains super');
    expect(String(row[4])).toContain('Banco'); // la condicion de cuenta se resuelve por nombre
    expect(row[5]).toBe('Alimentacion');
    expect(row[7]).toBe('basico');
  });
});

describe('buildBudgetsSheet', () => {
  it('vuelca la evaluacion (limite, consumo, restante, estado) en euros', () => {
    const budget: Budget = {
      id: 'b1',
      profileId: PID,
      name: 'Limite alimentacion',
      scope: 'category',
      scopeId: 'cat1',
      direction: 'expense',
      limitCents: 30000,
      period: 'monthly',
      customStart: null,
      customEnd: null,
      rollover: false,
      archivedAt: null,
      createdAt: 1,
      updatedAt: 1,
    };
    const evaluation: BudgetEvaluation = {
      budget,
      range: { from: '2026-01-01', to: '2026-01-31' },
      limitCents: 30000,
      grossCents: 12000,
      refundCents: 0,
      consumedCents: 12000,
      remainingCents: 18000,
      percent: 40,
      status: 'ok',
    };
    const sheet = buildBudgetsSheet([evaluation], () => 'Alimentacion');
    const row = sheet.rows[1]!;
    expect(row[0]).toBe('Limite alimentacion');
    expect(row[2]).toBe('Alimentacion');
    expect(row[7]).toBe(300); // limite 30000 -> 300
    expect(row[8]).toBe(120); // consumido 12000 -> 120
    expect(row[9]).toBe(180); // restante 18000 -> 180
    expect(row[10]).toBe('40%');
  });
});

describe('buildDashboardSheets', () => {
  it('genera las hojas del resumen reutilizando computeDashboard', () => {
    const categories: Category[] = [
      { id: 'cat1', profileId: PID, name: 'Alimentacion', parentId: null, kind: 'expense', color: null, icon: null, archivedAt: null, sortOrder: 0, createdAt: 1, updatedAt: 1 },
    ];
    const transactions = [
      tx({ date: '2026-01-05', type: 'income', amountCents: 200000 }),
      tx({ date: '2026-01-06', amountCents: -50000, categoryId: 'cat1' }),
    ];
    const data = computeDashboard(transactions, categories, {
      range: monthRange('2026-01-15'),
      anchorISO: '2026-01-15',
      today: '2026-01-15',
    });
    const sheets = buildDashboardSheets(data, names);
    const sheetNames = sheets.map((s) => s.name);
    expect(sheetNames).toContain('Resumen');
    expect(sheetNames).toContain('Gasto por categoria');
    expect(sheetNames).toContain('Evolucion mensual');

    // El resumen refleja los importes en euros (ingresos 2000, gasto neto 500).
    const resumen = sheets.find((s) => s.name === 'Resumen')!;
    const ingresos = resumen.rows.find((r) => r[0] === 'Ingresos')!;
    expect(ingresos[1]).toBe(2000);
    const gastoNeto = resumen.rows.find((r) => r[0] === 'Gasto neto')!;
    expect(gastoNeto[1]).toBe(500);
  });
});
