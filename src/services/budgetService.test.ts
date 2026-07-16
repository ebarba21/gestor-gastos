import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db';
import { transactionsRepo } from '../db/transactionsRepo';
import type { NewTransaction } from '../db/transactionsRepo';
import { categoryService } from './categoryService';
import { accountService } from './accountService';
import { transactionService } from './transactionService';
import { budgetService, resolveBudgetRange } from './budgetService';
import type { Budget } from '../db/schema';
import { ValidationError } from '../lib/validation';

const A = 'perfil-a';
const B = 'perfil-b';

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

function txInput(overrides: Partial<NewTransaction> = {}): NewTransaction {
  return {
    date: '2026-07-10',
    amountCents: -1000,
    type: 'expense',
    concept: 'Compra',
    notes: null,
    accountId: 'acc-1',
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
    importBatchId: null,
    dedupeHash: `h-${crypto.randomUUID()}`,
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
    ...overrides,
  };
}

// Crea el arbol de categorias base y una cuenta; devuelve sus ids.
async function seed(profileId: string) {
  const food = await categoryService.createCategory(profileId, { name: 'Alimentacion', kind: 'expense' });
  const superM = await categoryService.createCategory(profileId, {
    name: 'Supermercado',
    kind: 'expense',
    parentId: food.id,
  });
  const ocio = await categoryService.createCategory(profileId, { name: 'Ocio', kind: 'expense' });
  const acc = await accountService.createAccount(profileId, {
    name: 'Banco',
    kind: 'bank',
    openingBalanceCents: 0,
  });
  return { foodId: food.id, superId: superM.id, ocioId: ocio.id, accId: acc.id };
}

async function createBudget(profileId: string, overrides: Partial<Parameters<typeof budgetService.create>[1]> = {}): Promise<Budget> {
  return budgetService.create(profileId, {
    name: 'Presupuesto',
    scope: 'overall',
    scopeId: null,
    direction: 'expense',
    limitCents: 50000,
    period: 'monthly',
    ...overrides,
  });
}

describe('validacion de creacion', () => {
  it('rechaza importe cero o negativo', async () => {
    await expect(createBudget(A, { limitCents: 0 })).rejects.toThrow(ValidationError);
    await expect(createBudget(A, { limitCents: -100 })).rejects.toThrow(ValidationError);
  });

  it('rechaza importe no entero (centimos)', async () => {
    await expect(createBudget(A, { limitCents: 100.5 })).rejects.toThrow(ValidationError);
  });

  it('exige scopeId para ambitos no globales y lo prohibe en global', async () => {
    const { foodId } = await seed(A);
    await expect(
      createBudget(A, { scope: 'category', scopeId: null }),
    ).rejects.toThrow(ValidationError);
    await expect(
      createBudget(A, { scope: 'overall', scopeId: foodId }),
    ).rejects.toThrow(ValidationError);
  });

  it('valida existencia y tipo de la referencia de ambito', async () => {
    const { foodId, superId } = await seed(A);
    // Categoria inexistente.
    await expect(
      createBudget(A, { scope: 'category', scopeId: 'no-existe' }),
    ).rejects.toThrow(ValidationError);
    // Ambito subcategoria con una raiz.
    await expect(
      createBudget(A, { scope: 'subcategory', scopeId: foodId }),
    ).rejects.toThrow(ValidationError);
    // Ambito categoria con una subcategoria.
    await expect(
      createBudget(A, { scope: 'category', scopeId: superId }),
    ).rejects.toThrow(ValidationError);
    // Correctos.
    await expect(createBudget(A, { scope: 'category', scopeId: foodId })).resolves.toBeDefined();
    await expect(createBudget(A, { scope: 'subcategory', scopeId: superId })).resolves.toBeDefined();
  });

  it('valida el periodo personalizado (fechas y orden)', async () => {
    await expect(
      createBudget(A, { period: 'custom', customStart: '2026-07-01', customEnd: '2026-06-01' }),
    ).rejects.toThrow();
    await expect(
      createBudget(A, { period: 'custom', customStart: null, customEnd: null }),
    ).rejects.toThrow(ValidationError);
    // Un periodo no personalizado no lleva fechas.
    await expect(
      createBudget(A, { period: 'monthly', customStart: '2026-07-01', customEnd: '2026-07-31' }),
    ).rejects.toThrow(ValidationError);
    const ok = await createBudget(A, {
      period: 'custom',
      customStart: '2026-07-01',
      customEnd: '2026-07-31',
    });
    expect(ok.customStart).toBe('2026-07-01');
    expect(ok.customEnd).toBe('2026-07-31');
  });

  it('normaliza el nombre y guarda scopeId null en global', async () => {
    const b = await createBudget(A, { name: '  Gastos   del mes  ' });
    expect(b.name).toBe('Gastos del mes');
    expect(b.scopeId).toBeNull();
  });
});

describe('resolveBudgetRange', () => {
  it('resuelve cada periodo respecto a la referencia', async () => {
    const monthly = await createBudget(A, { period: 'monthly' });
    expect(resolveBudgetRange(monthly, '2026-07-08')).toEqual({ from: '2026-07-01', to: '2026-07-31' });
    const quarterly = await createBudget(A, { name: 'Q', period: 'quarterly' });
    expect(resolveBudgetRange(quarterly, '2026-07-08')).toEqual({ from: '2026-07-01', to: '2026-09-30' });
    const yearly = await createBudget(A, { name: 'Y', period: 'yearly' });
    expect(resolveBudgetRange(yearly, '2026-07-08')).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    const custom = await createBudget(A, {
      name: 'C',
      period: 'custom',
      customStart: '2026-03-05',
      customEnd: '2026-04-10',
    });
    expect(resolveBudgetRange(custom, '2026-07-08')).toEqual({ from: '2026-03-05', to: '2026-04-10' });
  });
});

describe('evaluacion mensual', () => {
  it('con datos: gasto consumido, restante, porcentaje y estado', async () => {
    await seed(A);
    await createBudget(A, { limitCents: 50000, direction: 'expense', scope: 'overall' });
    await transactionsRepo.create(A, txInput({ amountCents: -20000, date: '2026-07-05' }));
    await transactionsRepo.create(A, txInput({ amountCents: -10000, date: '2026-07-20' }));

    const [ev] = await budgetService.evaluateActive(A, '2026-07-08');
    expect(ev!.consumedCents).toBe(30000);
    expect(ev!.remainingCents).toBe(20000);
    expect(ev!.percent).toBe(60);
    expect(ev!.status).toBe('ok');
  });

  it('sin datos en el periodo: consumo cero', async () => {
    await seed(A);
    await createBudget(A, { limitCents: 50000 });
    // Movimiento fuera del periodo (junio).
    await transactionsRepo.create(A, txInput({ amountCents: -20000, date: '2026-06-30' }));

    const [ev] = await budgetService.evaluateActive(A, '2026-07-08');
    expect(ev!.consumedCents).toBe(0);
    expect(ev!.percent).toBe(0);
    expect(ev!.status).toBe('ok');
  });

  it('estado warning al alcanzar el umbral y exceeded al superar', async () => {
    await seed(A);
    await createBudget(A, { limitCents: 10000 });
    await transactionsRepo.create(A, txInput({ amountCents: -8000, date: '2026-07-05' })); // 80%
    let [ev] = await budgetService.evaluateActive(A, '2026-07-08');
    expect(ev!.status).toBe('warning');

    await transactionsRepo.create(A, txInput({ amountCents: -3000, date: '2026-07-06' })); // 110%
    [ev] = await budgetService.evaluateActive(A, '2026-07-08');
    expect(ev!.consumedCents).toBe(11000);
    expect(ev!.remainingCents).toBe(-1000);
    expect(ev!.status).toBe('exceeded');
  });

  it('objetivo de ingreso: estado met al alcanzar el limite', async () => {
    await seed(A);
    await createBudget(A, {
      name: 'Ahorro',
      direction: 'income',
      scope: 'overall',
      limitCents: 100000,
    });
    await transactionsRepo.create(A, txInput({ type: 'income', amountCents: 60000, date: '2026-07-01' }));
    let [ev] = await budgetService.evaluateActive(A, '2026-07-08');
    expect(ev!.status).toBe('ok');
    expect(ev!.consumedCents).toBe(60000);

    await transactionsRepo.create(A, txInput({ type: 'income', amountCents: 50000, date: '2026-07-02' }));
    [ev] = await budgetService.evaluateActive(A, '2026-07-08');
    expect(ev!.consumedCents).toBe(110000);
    expect(ev!.status).toBe('met');
  });
});

describe('cambio de mes y de ano', () => {
  it('el consumo mensual solo cuenta el mes de la referencia', async () => {
    await seed(A);
    await createBudget(A, { limitCents: 50000, period: 'monthly' });
    await transactionsRepo.create(A, txInput({ amountCents: -10000, date: '2026-07-15' }));
    await transactionsRepo.create(A, txInput({ amountCents: -20000, date: '2026-08-15' }));

    const julio = (await budgetService.evaluateActive(A, '2026-07-08'))[0]!;
    const agosto = (await budgetService.evaluateActive(A, '2026-08-08'))[0]!;
    expect(julio.consumedCents).toBe(10000);
    expect(agosto.consumedCents).toBe(20000);
  });

  it('el consumo anual separa los anos', async () => {
    await seed(A);
    await createBudget(A, { name: 'Anual', limitCents: 500000, period: 'yearly' });
    await transactionsRepo.create(A, txInput({ amountCents: -10000, date: '2025-12-31' }));
    await transactionsRepo.create(A, txInput({ amountCents: -20000, date: '2026-01-01' }));

    const y2025 = (await budgetService.evaluateActive(A, '2025-06-01'))[0]!;
    const y2026 = (await budgetService.evaluateActive(A, '2026-06-01'))[0]!;
    expect(y2025.consumedCents).toBe(10000);
    expect(y2026.consumedCents).toBe(20000);
  });
});

describe('exclusiones, transferencias, splits y reembolsos', () => {
  it('ignora movimientos excluidos y transferencias', async () => {
    const { accId } = await seed(A);
    const acc2 = await accountService.createAccount(A, { name: 'Caja', kind: 'cash', openingBalanceCents: 0 });
    await createBudget(A, { limitCents: 50000 });
    await transactionsRepo.create(A, txInput({ amountCents: -10000, accountId: accId, date: '2026-07-05' }));
    await transactionsRepo.create(A, txInput({ amountCents: -5000, excludedFromStats: true, date: '2026-07-06' }));
    // Transferencia interna: ambas patas excluidas.
    await transactionService.createTransfer(A, {
      fromAccountId: accId,
      toAccountId: acc2.id,
      amountCents: 30000,
      date: '2026-07-07',
    });

    const [ev] = await budgetService.evaluateActive(A, '2026-07-08');
    expect(ev!.consumedCents).toBe(10000);
  });

  it('cuenta las lineas hijas de un split en su categoria', async () => {
    const { foodId, ocioId, accId } = await seed(A);
    const parent = await transactionsRepo.create(
      A,
      txInput({ amountCents: -3000, accountId: accId, date: '2026-07-10' }),
    );
    await transactionService.splitTransaction(A, parent.id, [
      { amountCents: -2000, categoryId: foodId },
      { amountCents: -1000, categoryId: ocioId },
    ]);

    const bFood = await createBudget(A, { name: 'Food', scope: 'category', scopeId: foodId, limitCents: 50000 });
    const bOcio = await createBudget(A, { name: 'Ocio', scope: 'category', scopeId: ocioId, limitCents: 50000 });
    const evs = await budgetService.evaluateActive(A, '2026-07-08');
    const food = evs.find((e) => e.budget.id === bFood.id)!;
    const ocio = evs.find((e) => e.budget.id === bOcio.id)!;
    expect(food.consumedCents).toBe(2000);
    expect(ocio.consumedCents).toBe(1000);
  });

  it('un reembolso reduce el gasto neto de la categoria del gasto original', async () => {
    const { superId, foodId, accId } = await seed(A);
    const original = await transactionsRepo.create(
      A,
      txInput({ amountCents: -5000, accountId: accId, categoryId: superId, date: '2026-07-03' }),
    );
    // Reembolso (ingreso) enlazado al gasto original, sin categoria propia.
    const refund = await transactionsRepo.create(
      A,
      txInput({
        type: 'income',
        amountCents: 2000,
        accountId: accId,
        categoryId: null,
        date: '2026-07-15',
      }),
    );
    await transactionService.markAsRefund(A, refund.id, original.id);

    await createBudget(A, { name: 'Food', scope: 'category', scopeId: foodId, limitCents: 50000 });
    const [ev] = await budgetService.evaluateActive(A, '2026-07-08');
    expect(ev!.grossCents).toBe(5000);
    expect(ev!.refundCents).toBe(2000);
    expect(ev!.consumedCents).toBe(3000);
  });

  it('atribuye el reembolso a la categoria original aunque el gasto sea de otro periodo', async () => {
    const { superId, foodId, accId } = await seed(A);
    // Gasto original en junio.
    const original = await transactionsRepo.create(
      A,
      txInput({ amountCents: -5000, accountId: accId, categoryId: superId, date: '2026-06-20' }),
    );
    // Reembolso en julio.
    const refund = await transactionsRepo.create(
      A,
      txInput({ type: 'income', amountCents: 2000, accountId: accId, categoryId: null, date: '2026-07-10' }),
    );
    await transactionService.markAsRefund(A, refund.id, original.id);

    await createBudget(A, { name: 'Food', scope: 'category', scopeId: foodId, limitCents: 50000 });
    const [ev] = await budgetService.evaluateActive(A, '2026-07-08');
    // En julio el gasto original no cuenta (es de junio), pero el reembolso si reduce.
    expect(ev!.grossCents).toBe(0);
    expect(ev!.refundCents).toBe(2000);
    expect(ev!.consumedCents).toBe(-2000);
    expect(ev!.remainingCents).toBe(52000);
  });
});

describe('aislamiento por perfil', () => {
  it('un presupuesto solo evalua los movimientos de su perfil', async () => {
    await seed(A);
    await seed(B);
    await createBudget(A, { limitCents: 50000 });
    await transactionsRepo.create(A, txInput({ amountCents: -10000, date: '2026-07-05' }));
    // Gasto del perfil B en el mismo periodo: no debe afectar al presupuesto de A.
    await transactionsRepo.create(B, txInput({ amountCents: -99999, date: '2026-07-05' }));

    const [ev] = await budgetService.evaluateActive(A, '2026-07-08');
    expect(ev!.consumedCents).toBe(10000);
    // B no tiene presupuestos.
    expect(await budgetService.evaluateActive(B, '2026-07-08')).toHaveLength(0);
  });

  it('los presupuestos de un perfil no aparecen en otro', async () => {
    await createBudget(A, { name: 'Solo A', limitCents: 1000 });
    expect(await budgetService.list(A)).toHaveLength(1);
    expect(await budgetService.list(B)).toHaveLength(0);
  });
});

describe('archivar y borrar', () => {
  it('archivar oculta de la lista activa y restaurar lo devuelve', async () => {
    const b = await createBudget(A, { limitCents: 1000 });
    await budgetService.archive(A, b.id);
    expect(await budgetService.list(A)).toHaveLength(0);
    expect(await budgetService.listAll(A)).toHaveLength(1);
    await budgetService.unarchive(A, b.id);
    expect(await budgetService.list(A)).toHaveLength(1);
  });

  it('borrar elimina el presupuesto', async () => {
    const b = await createBudget(A, { limitCents: 1000 });
    await budgetService.remove(A, b.id);
    expect(await budgetService.getById(A, b.id)).toBeUndefined();
  });
});

describe('metricas: porcentaje, fronteras de estado y consumo negativo', () => {
  it('redondea el porcentaje al entero mas cercano', async () => {
    await seed(A);
    await createBudget(A, { limitCents: 10000 });
    await transactionsRepo.create(A, txInput({ amountCents: -3350, date: '2026-07-05' })); // 33,5%
    const [ev] = await budgetService.evaluateActive(A, '2026-07-08');
    expect(ev!.percent).toBe(34); // redondeo al alza
  });

  it('en el 100% exacto: percent 100, restante 0 y estado warning (no exceeded)', async () => {
    await seed(A);
    await createBudget(A, { limitCents: 10000 });
    await transactionsRepo.create(A, txInput({ amountCents: -10000, date: '2026-07-05' }));
    const [ev] = await budgetService.evaluateActive(A, '2026-07-08');
    expect(ev!.consumedCents).toBe(10000);
    expect(ev!.remainingCents).toBe(0);
    expect(ev!.percent).toBe(100);
    expect(ev!.status).toBe('warning');
  });

  it('consumo negativo (reembolsos > gasto): percent negativo y estado ok', async () => {
    const { superId, foodId, accId } = await seed(A);
    // Gasto original en junio; reembolso en julio (reduce sin gasto correlativo en julio).
    const original = await transactionsRepo.create(
      A,
      txInput({ amountCents: -5000, accountId: accId, categoryId: superId, date: '2026-06-20' }),
    );
    const refund = await transactionsRepo.create(
      A,
      txInput({ type: 'income', amountCents: 2000, accountId: accId, categoryId: null, date: '2026-07-10' }),
    );
    await transactionService.markAsRefund(A, refund.id, original.id);
    await createBudget(A, { name: 'Food', scope: 'category', scopeId: foodId, limitCents: 50000 });
    const [ev] = await budgetService.evaluateActive(A, '2026-07-08');
    expect(ev!.consumedCents).toBe(-2000);
    expect(ev!.percent).toBe(-4);
    expect(ev!.status).toBe('ok');
  });
});

describe('consumo end-to-end por ambito subcategoria e ingreso con reembolso', () => {
  it('ambito subcategoria: solo cuenta la subcategoria exacta, no la raiz', async () => {
    const { superId, foodId, accId } = await seed(A);
    await transactionsRepo.create(
      A,
      txInput({ amountCents: -4000, accountId: accId, categoryId: superId, date: '2026-07-05' }),
    );
    // Gasto categorizado en la raiz Alimentacion: NO cuenta para el presupuesto de la subcategoria.
    await transactionsRepo.create(
      A,
      txInput({ amountCents: -2000, accountId: accId, categoryId: foodId, date: '2026-07-06' }),
    );
    await createBudget(A, { name: 'Super', scope: 'subcategory', scopeId: superId, limitCents: 50000 });
    const [ev] = await budgetService.evaluateActive(A, '2026-07-08');
    expect(ev!.consumedCents).toBe(4000);
  });

  it('objetivo de ingreso end-to-end: ignora un reembolso presente', async () => {
    const { superId, accId } = await seed(A);
    const original = await transactionsRepo.create(
      A,
      txInput({ amountCents: -5000, accountId: accId, categoryId: superId, date: '2026-07-02' }),
    );
    await transactionsRepo.create(
      A,
      txInput({ type: 'income', amountCents: 60000, accountId: accId, date: '2026-07-03' }),
    );
    const refund = await transactionsRepo.create(
      A,
      txInput({ type: 'income', amountCents: 5000, accountId: accId, categoryId: null, date: '2026-07-15' }),
    );
    await transactionService.markAsRefund(A, refund.id, original.id);
    await createBudget(A, {
      name: 'Ahorro',
      direction: 'income',
      scope: 'overall',
      limitCents: 100000,
    });
    const [ev] = await budgetService.evaluateActive(A, '2026-07-08');
    // Solo la nomina (60000); el reembolso no es ingreso.
    expect(ev!.consumedCents).toBe(60000);
  });
});

describe('consumo dentro de periodos trimestral y personalizado (fronteras incluidas)', () => {
  it('trimestral: cuenta los extremos del trimestre y excluye lo de fuera', async () => {
    await seed(A);
    await createBudget(A, { name: 'Q', period: 'quarterly', limitCents: 500000 });
    await transactionsRepo.create(A, txInput({ amountCents: -1000, date: '2026-07-01' })); // inicio Q3
    await transactionsRepo.create(A, txInput({ amountCents: -2000, date: '2026-09-30' })); // fin Q3
    await transactionsRepo.create(A, txInput({ amountCents: -500, date: '2026-06-30' })); // Q2, fuera
    await transactionsRepo.create(A, txInput({ amountCents: -700, date: '2026-10-01' })); // Q4, fuera
    const [ev] = await budgetService.evaluateActive(A, '2026-08-08');
    expect(ev!.range).toEqual({ from: '2026-07-01', to: '2026-09-30' });
    expect(ev!.consumedCents).toBe(3000);
  });

  it('personalizado: cuenta los extremos del rango y excluye lo de fuera', async () => {
    await seed(A);
    await createBudget(A, {
      name: 'Viaje',
      period: 'custom',
      customStart: '2026-03-05',
      customEnd: '2026-04-10',
      limitCents: 500000,
    });
    await transactionsRepo.create(A, txInput({ amountCents: -1000, date: '2026-03-05' })); // inicio
    await transactionsRepo.create(A, txInput({ amountCents: -2000, date: '2026-04-10' })); // fin
    await transactionsRepo.create(A, txInput({ amountCents: -500, date: '2026-03-04' })); // antes
    await transactionsRepo.create(A, txInput({ amountCents: -700, date: '2026-04-11' })); // despues
    // La referencia no afecta a un periodo personalizado.
    const [ev] = await budgetService.evaluateActive(A, '2026-12-01');
    expect(ev!.consumedCents).toBe(3000);
  });
});
