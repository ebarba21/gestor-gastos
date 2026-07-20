import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db';
import {
  transactionService,
  signedAmountFor,
  assertSplitBalances,
  type TransactionInput,
  type SplitPart,
} from './transactionService';
import { transactionsRepo } from '../db/transactionsRepo';
import { ValidationError } from '../lib/validation';

const A = 'perfil-a';
const B = 'perfil-b';

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  localStorage.clear();
});

function input(overrides: Partial<TransactionInput> = {}): TransactionInput {
  return {
    date: '2026-01-15',
    amountCents: -1000,
    type: 'expense',
    concept: 'Compra',
    accountId: 'acc-1',
    ...overrides,
  };
}

describe('signedAmountFor', () => {
  it('normaliza el signo segun el tipo', () => {
    expect(signedAmountFor('expense', 1000)).toBe(-1000);
    expect(signedAmountFor('expense', -1000)).toBe(-1000);
    expect(signedAmountFor('income', 1000)).toBe(1000);
    expect(signedAmountFor('income', -1000)).toBe(1000);
  });
});

describe('create/update', () => {
  it('crea un movimiento con dedupeHash y categorizedBy manual si hay categoria', async () => {
    const t = await transactionService.create(A, input({ categoryId: 'c1' }));
    expect(t.dedupeHash).toMatch(/^[0-9a-f]{8}$/);
    expect(t.categorizedBy).toBe('manual');
    expect(t.statsFlag).toBe(0);
  });

  it('sin categoria, categorizedBy es none', async () => {
    const t = await transactionService.create(A, input());
    expect(t.categorizedBy).toBe('none');
  });

  it('rechaza gasto con importe positivo (coherencia type<->signo)', async () => {
    await expect(
      transactionService.create(A, input({ type: 'expense', amountCents: 500 })),
    ).rejects.toThrow(ValidationError);
  });

  it('rechaza concepto vacio', async () => {
    await expect(transactionService.create(A, input({ concept: '   ' }))).rejects.toThrow(
      ValidationError,
    );
  });

  it('recalcula dedupeHash y categorizedBy al editar', async () => {
    const t = await transactionService.create(A, input());
    const before = t.dedupeHash;
    const updated = await transactionService.update(
      A,
      t.id,
      input({ concept: 'Otro concepto', categoryId: 'c9' }),
    );
    expect(updated.dedupeHash).not.toBe(before);
    expect(updated.categorizedBy).toBe('manual');
  });
});

describe('edicion masiva', () => {
  it('cambia cuenta, categoria, estado y exclusion en varios movimientos', async () => {
    const t1 = await transactionService.create(A, input());
    const t2 = await transactionService.create(A, input({ concept: 'Otra' }));
    const n = await transactionService.bulkEdit(A, [t1.id, t2.id], {
      setAccountId: 'acc-9',
      setCategory: { categoryId: 'cat-1', subcategoryId: 'sub-1' },
      setStatus: 'reconciled',
      setExcludedFromStats: true,
    });
    expect(n).toBe(2);
    const r1 = await transactionsRepo.getById(A, t1.id);
    expect(r1?.accountId).toBe('acc-9');
    expect(r1?.categoryId).toBe('cat-1');
    expect(r1?.subcategoryId).toBe('sub-1');
    expect(r1?.categorizedBy).toBe('manual');
    expect(r1?.status).toBe('reconciled');
    expect(r1?.excludedFromStats).toBe(true);
    expect(r1?.statsFlag).toBe(1);
  });

  it('recalcula dedupeHash al cambiar la cuenta en masa', async () => {
    const t1 = await transactionService.create(A, input());
    const before = (await transactionsRepo.getById(A, t1.id))!.dedupeHash;
    await transactionService.bulkEdit(A, [t1.id], { setAccountId: 'otra-cuenta' });
    const after = (await transactionsRepo.getById(A, t1.id))!.dedupeHash;
    expect(after).not.toBe(before);
  });

  it('anade, quita y reemplaza etiquetas en masa', async () => {
    const t1 = await transactionService.create(A, input({ tagIds: ['x'] }));
    await transactionService.bulkEdit(A, [t1.id], { tags: { mode: 'add', tagIds: ['y', 'z'] } });
    expect((await transactionsRepo.getById(A, t1.id))!.tagIds.sort()).toEqual(['x', 'y', 'z']);
    await transactionService.bulkEdit(A, [t1.id], { tags: { mode: 'remove', tagIds: ['x'] } });
    expect((await transactionsRepo.getById(A, t1.id))!.tagIds.sort()).toEqual(['y', 'z']);
    await transactionService.bulkEdit(A, [t1.id], { tags: { mode: 'replace', tagIds: ['solo'] } });
    expect((await transactionsRepo.getById(A, t1.id))!.tagIds).toEqual(['solo']);
  });

  it('rechaza una edicion masiva vacia', async () => {
    const t1 = await transactionService.create(A, input());
    await expect(transactionService.bulkEdit(A, [t1.id], {})).rejects.toThrow(ValidationError);
  });
});

describe('borrado individual y masivo', () => {
  it('borra un movimiento normal', async () => {
    const t = await transactionService.create(A, input());
    const n = await transactionService.remove(A, t.id);
    expect(n).toBe(1);
    expect(await transactionsRepo.getById(A, t.id)).toBeUndefined();
  });

  it('el borrado masivo cuenta los movimientos afectados', async () => {
    const t1 = await transactionService.create(A, input());
    const t2 = await transactionService.create(A, input({ concept: 'Dos' }));
    const ids = await transactionService.collectDeletionIds(A, [t1.id, t2.id]);
    expect(ids).toHaveLength(2);
    const n = await transactionService.removeMany(A, [t1.id, t2.id]);
    expect(n).toBe(2);
    expect(await transactionsRepo.count(A)).toBe(0);
  });
});

describe('splits', () => {
  it('assertSplitBalances valida suma exacta, signo y minimo de partes', () => {
    const ok: SplitPart[] = [
      { amountCents: -600, categoryId: 'c1' },
      { amountCents: -400, categoryId: 'c2' },
    ];
    expect(() => assertSplitBalances(-1000, ok)).not.toThrow();
    // Suma incorrecta.
    expect(() =>
      assertSplitBalances(-1000, [
        { amountCents: -600, categoryId: 'c1' },
        { amountCents: -300, categoryId: 'c2' },
      ]),
    ).toThrow(ValidationError);
    // Signo mezclado.
    expect(() =>
      assertSplitBalances(-1000, [
        { amountCents: -1200, categoryId: 'c1' },
        { amountCents: 200, categoryId: 'c2' },
      ]),
    ).toThrow(ValidationError);
    // Menos de dos partes.
    expect(() => assertSplitBalances(-1000, [{ amountCents: -1000, categoryId: 'c1' }])).toThrow(
      ValidationError,
    );
  });

  it('divide un movimiento: padre excluido y dividido, hijas suman el total', async () => {
    const parent = await transactionService.create(A, input({ amountCents: -1000 }));
    const children = await transactionService.splitTransaction(A, parent.id, [
      { amountCents: -700, categoryId: 'cA' },
      { amountCents: -300, categoryId: 'cB' },
    ]);
    expect(children).toHaveLength(2);
    const p = await transactionsRepo.getById(A, parent.id);
    expect(p?.isSplitParent).toBe(true);
    expect(p?.excludedFromStats).toBe(true);
    const sum = children.reduce((acc, c) => acc + c.amountCents, 0);
    expect(sum).toBe(parent.amountCents);
    children.forEach((c) => {
      expect(c.parentId).toBe(parent.id);
      expect(c.excludedFromStats).toBe(false);
    });
  });

  it('rechaza un split cuya suma no cuadra', async () => {
    const parent = await transactionService.create(A, input({ amountCents: -1000 }));
    await expect(
      transactionService.splitTransaction(A, parent.id, [
        { amountCents: -700, categoryId: 'cA' },
        { amountCents: -200, categoryId: 'cB' },
      ]),
    ).rejects.toThrow(ValidationError);
  });

  it('re-dividir reemplaza las hijas anteriores', async () => {
    const parent = await transactionService.create(A, input({ amountCents: -1000 }));
    await transactionService.splitTransaction(A, parent.id, [
      { amountCents: -700, categoryId: 'cA' },
      { amountCents: -300, categoryId: 'cB' },
    ]);
    await transactionService.splitTransaction(A, parent.id, [
      { amountCents: -500, categoryId: 'cA' },
      { amountCents: -500, categoryId: 'cB' },
    ]);
    const kids = await transactionsRepo.listChildren(A, parent.id);
    expect(kids).toHaveLength(2);
    expect(kids.reduce((acc, c) => acc + c.amountCents, 0)).toBe(-1000);
  });

  it('deshacer split borra hijas y reincluye el padre', async () => {
    const parent = await transactionService.create(A, input({ amountCents: -1000 }));
    await transactionService.splitTransaction(A, parent.id, [
      { amountCents: -600, categoryId: 'cA' },
      { amountCents: -400, categoryId: 'cB' },
    ]);
    await transactionService.unsplitTransaction(A, parent.id);
    expect(await transactionsRepo.listChildren(A, parent.id)).toHaveLength(0);
    const p = await transactionsRepo.getById(A, parent.id);
    expect(p?.isSplitParent).toBe(false);
    expect(p?.excludedFromStats).toBe(false);
  });

  it('si el padre estaba excluido, las hijas heredan la exclusion', async () => {
    const parent = await transactionService.create(A, input({ amountCents: -1000 }));
    await transactionService.setExcludedFromStats(A, parent.id, true);
    const children = await transactionService.splitTransaction(A, parent.id, [
      { amountCents: -600, categoryId: 'cA' },
      { amountCents: -400, categoryId: 'cB' },
    ]);
    children.forEach((c) => expect(c.excludedFromStats).toBe(true));
  });

  it('el ciclo dividir/deshacer es neutro respecto a la exclusion del padre', async () => {
    // Padre incluido: tras split+unsplit sigue incluido.
    const incluido = await transactionService.create(A, input({ amountCents: -1000 }));
    await transactionService.splitTransaction(A, incluido.id, [
      { amountCents: -600, categoryId: 'cA' },
      { amountCents: -400, categoryId: 'cB' },
    ]);
    let restored = await transactionService.unsplitTransaction(A, incluido.id);
    expect(restored.excludedFromStats).toBe(false);

    // Padre excluido: tras split+unsplit vuelve a estar excluido.
    const excluido = await transactionService.create(A, input({ amountCents: -1000 }));
    await transactionService.setExcludedFromStats(A, excluido.id, true);
    await transactionService.splitTransaction(A, excluido.id, [
      { amountCents: -600, categoryId: 'cA' },
      { amountCents: -400, categoryId: 'cB' },
    ]);
    restored = await transactionService.unsplitTransaction(A, excluido.id);
    expect(restored.excludedFromStats).toBe(true);
  });

  it('borrar una hija suelta arrastra el split completo (padre + hermanas)', async () => {
    const parent = await transactionService.create(A, input({ amountCents: -1000 }));
    const children = await transactionService.splitTransaction(A, parent.id, [
      { amountCents: -600, categoryId: 'cA' },
      { amountCents: -400, categoryId: 'cB' },
    ]);
    const oneChildId = children[0]!.id;
    const ids = await transactionService.collectDeletionIds(A, [oneChildId]);
    expect(ids).toHaveLength(3); // padre + 2 hijas
    const n = await transactionService.remove(A, oneChildId);
    expect(n).toBe(3);
    expect(await transactionsRepo.count(A)).toBe(0);
  });

  it('borrar el padre de un split arrastra las hijas', async () => {
    const parent = await transactionService.create(A, input({ amountCents: -1000 }));
    await transactionService.splitTransaction(A, parent.id, [
      { amountCents: -600, categoryId: 'cA' },
      { amountCents: -400, categoryId: 'cB' },
    ]);
    const n = await transactionService.remove(A, parent.id);
    expect(n).toBe(3); // padre + 2 hijas
    expect(await transactionsRepo.count(A)).toBe(0);
  });
});

describe('transferencias', () => {
  it('crea un par enlazado, excluido de stats y con signos opuestos', async () => {
    const [out, income] = await transactionService.createTransfer(A, {
      fromAccountId: 'origen',
      toAccountId: 'destino',
      amountCents: 5000,
      date: '2026-01-20',
    });
    expect(out.amountCents).toBe(-5000);
    expect(income.amountCents).toBe(5000);
    expect(out.transferGroupId).toBe(income.transferGroupId);
    expect(out.excludedFromStats).toBe(true);
    expect(income.excludedFromStats).toBe(true);
    expect(out.type).toBe('transfer');
  });

  it('rechaza transferencia a la misma cuenta o importe no positivo', async () => {
    await expect(
      transactionService.createTransfer(A, {
        fromAccountId: 'x',
        toAccountId: 'x',
        amountCents: 100,
        date: '2026-01-20',
      }),
    ).rejects.toThrow(ValidationError);
    await expect(
      transactionService.createTransfer(A, {
        fromAccountId: 'x',
        toAccountId: 'y',
        amountCents: 0,
        date: '2026-01-20',
      }),
    ).rejects.toThrow(ValidationError);
  });

  it('marca un gasto como transferencia y crea la pata espejo', async () => {
    const gasto = await transactionService.create(A, input({ amountCents: -3000 }));
    const [updated, mirror] = await transactionService.markAsTransfer(A, gasto.id, 'cuenta-destino');
    expect(updated.type).toBe('transfer');
    expect(updated.excludedFromStats).toBe(true);
    expect(updated.transferGroupId).not.toBeNull();
    expect(mirror.amountCents).toBe(3000);
    expect(mirror.accountId).toBe('cuenta-destino');
    expect(mirror.transferGroupId).toBe(updated.transferGroupId);
  });

  it('borrar una pata arrastra la otra', async () => {
    const [out] = await transactionService.createTransfer(A, {
      fromAccountId: 'o',
      toAccountId: 'd',
      amountCents: 5000,
      date: '2026-01-20',
    });
    const n = await transactionService.remove(A, out.id);
    expect(n).toBe(2);
    expect(await transactionsRepo.count(A)).toBe(0);
  });

  it('deshacer transferencia borra la espejo y restaura el tipo por el signo', async () => {
    const gasto = await transactionService.create(A, input({ amountCents: -3000 }));
    const [updated] = await transactionService.markAsTransfer(A, gasto.id, 'destino');
    const restored = await transactionService.unmarkTransfer(A, updated.id);
    expect(restored.type).toBe('expense');
    expect(restored.excludedFromStats).toBe(false);
    expect(restored.transferGroupId).toBeNull();
    expect(await transactionsRepo.count(A)).toBe(1);
  });

  // linkAsTransfer (ampliacion fase 6): vincula DOS movimientos YA EXISTENTES (p. ej.
  // detectados por la bandeja de revision como "transferencia candidata"), sin crear ninguno
  // nuevo ni reescribir concepto/fecha/importe/comercio de ninguno de los dos.
  describe('linkAsTransfer', () => {
    it('vincula dos movimientos existentes sin tocar concept/date/amountCents', async () => {
      const out = await transactionService.create(
        A,
        input({ accountId: 'acc-1', amountCents: -5000, concept: 'Salida banco' }),
      );
      const inTx = await transactionService.create(
        A,
        input({ accountId: 'acc-2', amountCents: 5000, type: 'income', concept: 'Entrada banco' }),
      );
      const [updatedOut, updatedIn] = await transactionService.linkAsTransfer(A, out.id, inTx.id);
      expect(updatedOut.type).toBe('transfer');
      expect(updatedIn.type).toBe('transfer');
      expect(updatedOut.transferGroupId).toBe(updatedIn.transferGroupId);
      expect(updatedOut.excludedFromStats).toBe(true);
      expect(updatedIn.excludedFromStats).toBe(true);
      // Concepto/fecha/importe originales intactos (a diferencia de createTransfer).
      expect(updatedOut.concept).toBe('Salida banco');
      expect(updatedIn.concept).toBe('Entrada banco');
      expect(updatedOut.amountCents).toBe(-5000);
      expect(updatedIn.amountCents).toBe(5000);
    });

    it('rechaza vincular movimientos de la misma cuenta', async () => {
      const a = await transactionService.create(A, input({ accountId: 'acc-1', amountCents: -5000 }));
      const b = await transactionService.create(
        A,
        input({ accountId: 'acc-1', amountCents: 5000, type: 'income' }),
      );
      await expect(transactionService.linkAsTransfer(A, a.id, b.id)).rejects.toThrow(ValidationError);
    });

    it('rechaza vincular si el importe absoluto no coincide', async () => {
      const a = await transactionService.create(A, input({ accountId: 'acc-1', amountCents: -5000 }));
      const b = await transactionService.create(
        A,
        input({ accountId: 'acc-2', amountCents: 4000, type: 'income' }),
      );
      await expect(transactionService.linkAsTransfer(A, a.id, b.id)).rejects.toThrow(ValidationError);
    });

    it('rechaza vincular si ya pertenece a otra transferencia', async () => {
      const [out, income] = await transactionService.createTransfer(A, {
        fromAccountId: 'o',
        toAccountId: 'd',
        amountCents: 5000,
        date: '2026-01-20',
      });
      const c = await transactionService.create(
        A,
        input({ accountId: 'acc-3', amountCents: 5000, type: 'income' }),
      );
      await expect(transactionService.linkAsTransfer(A, out.id, c.id)).rejects.toThrow(ValidationError);
      await expect(transactionService.linkAsTransfer(A, income.id, c.id)).rejects.toThrow(ValidationError);
    });
  });
});

describe('reembolsos', () => {
  it('marca un ingreso como reembolso de un gasto existente', async () => {
    const gasto = await transactionService.create(A, input({ type: 'expense', amountCents: -2000 }));
    const ingreso = await transactionService.create(
      A,
      input({ type: 'income', amountCents: 500, concept: 'Devolucion' }),
    );
    const marked = await transactionService.markAsRefund(A, ingreso.id, gasto.id);
    expect(marked.refundOfId).toBe(gasto.id);
  });

  it('rechaza reembolso de si mismo o de un no-gasto', async () => {
    const ingreso = await transactionService.create(A, input({ type: 'income', amountCents: 500 }));
    await expect(transactionService.markAsRefund(A, ingreso.id, ingreso.id)).rejects.toThrow(
      ValidationError,
    );
    const otroIngreso = await transactionService.create(
      A,
      input({ type: 'income', amountCents: 100 }),
    );
    await expect(
      transactionService.markAsRefund(A, ingreso.id, otroIngreso.id),
    ).rejects.toThrow(ValidationError);
  });
});

describe('aislamiento por perfil', () => {
  it('la edicion masiva no toca movimientos de otro perfil', async () => {
    const a = await transactionService.create(A, input());
    const b = await transactionService.create(B, input());
    // Se pasan ambos ids pero con el perfil A: el de B se ignora.
    const n = await transactionService.bulkEdit(A, [a.id, b.id], { setStatus: 'pending' });
    expect(n).toBe(1);
    expect((await transactionsRepo.getById(A, a.id))?.status).toBe('pending');
    expect((await transactionsRepo.getById(B, b.id))?.status).toBe('cleared');
  });

  it('el borrado masivo no borra movimientos de otro perfil', async () => {
    const a = await transactionService.create(A, input());
    const b = await transactionService.create(B, input());
    const n = await transactionService.removeMany(A, [a.id, b.id]);
    expect(n).toBe(1);
    expect(await transactionsRepo.getById(B, b.id)).toBeDefined();
  });

  it('splitTransaction de A no puede dividir un movimiento de B', async () => {
    const b = await transactionService.create(B, input({ amountCents: -1000 }));
    await expect(
      transactionService.splitTransaction(A, b.id, [
        { amountCents: -500, categoryId: 'c1' },
        { amountCents: -500, categoryId: 'c2' },
      ]),
    ).rejects.toThrow(ValidationError);
  });

  it('collectDeletionIds solo devuelve ids del perfil pedido', async () => {
    const a = await transactionService.create(A, input());
    const b = await transactionService.create(B, input());
    const ids = await transactionService.collectDeletionIds(A, [a.id, b.id]);
    expect(ids).toEqual([a.id]);
  });
});
