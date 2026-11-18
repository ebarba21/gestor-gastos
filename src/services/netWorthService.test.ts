import { describe, it, expect } from 'vitest';
import { balancesAtDates, computeNetWorth, samplingDates } from './netWorthService';
import { makeAccount, makeTx } from '../test/txFixtures';

const ibercaja = makeAccount({ id: 'ibercaja', name: 'Ibercaja', openingBalanceCents: 100000 });
const revolut = makeAccount({ id: 'revolut', name: 'Revolut', openingBalanceCents: 20000 });

describe('samplingDates', () => {
  it('genera cierres de mes y termina siempre en hoy', () => {
    expect(samplingDates('2026-08-31', '2026-11-18', 'month')).toEqual([
      '2026-08-31',
      '2026-09-30',
      '2026-10-31',
      '2026-11-18',
    ]);
  });

  it('genera un punto por dia en granularidad diaria', () => {
    expect(samplingDates('2026-11-15', '2026-11-18', 'day')).toEqual([
      '2026-11-15',
      '2026-11-16',
      '2026-11-17',
      '2026-11-18',
    ]);
  });

  it('si el inicio es posterior a hoy devuelve solo hoy', () => {
    expect(samplingDates('2026-12-01', '2026-11-18', 'month')).toEqual(['2026-11-18']);
  });
});

describe('balancesAtDates', () => {
  it('acumula saldo inicial y movimientos hasta cada fecha, por cuenta y en total', () => {
    const txs = [
      makeTx({ accountId: 'ibercaja', date: '2026-10-05', amountCents: 250000, type: 'income' }),
      makeTx({ accountId: 'ibercaja', date: '2026-10-20', amountCents: -30000 }),
      makeTx({ accountId: 'revolut', date: '2026-11-02', amountCents: -5000 }),
    ];
    const points = balancesAtDates([ibercaja, revolut], txs, ['2026-09-30', '2026-10-31', '2026-11-18']);
    expect(points.map((p) => p.totalCents)).toEqual([120000, 340000, 335000]);
    expect(points[2]!.byAccount).toEqual({ ibercaja: 320000, revolut: 15000 });
  });

  it('incluye transferencias y excluidos, pero no las lineas hijas de un split', () => {
    const parent = makeTx({ id: 'p', accountId: 'ibercaja', date: '2026-11-01', amountCents: -6000, isSplitParent: true, excludedFromStats: true });
    const txs = [
      parent,
      makeTx({ accountId: 'ibercaja', date: '2026-11-01', amountCents: -4000, parentId: 'p' }),
      makeTx({ accountId: 'ibercaja', date: '2026-11-01', amountCents: -2000, parentId: 'p' }),
      // Transferencia Ibercaja -> Revolut: no cambia el total, si el reparto.
      makeTx({ accountId: 'ibercaja', date: '2026-11-03', amountCents: -10000, type: 'transfer', excludedFromStats: true }),
      makeTx({ accountId: 'revolut', date: '2026-11-03', amountCents: 10000, type: 'transfer', excludedFromStats: true }),
    ];
    const [p] = balancesAtDates([ibercaja, revolut], txs, ['2026-11-18']);
    expect(p!.byAccount).toEqual({ ibercaja: 84000, revolut: 30000 });
    expect(p!.totalCents).toBe(114000);
  });

  it('ignora movimientos de cuentas que no se le pasan (aislamiento por cuenta)', () => {
    const txs = [makeTx({ accountId: 'otra', date: '2026-11-01', amountCents: 999999 })];
    const [p] = balancesAtDates([ibercaja], txs, ['2026-11-18']);
    expect(p!.totalCents).toBe(100000);
  });

  it('rechaza fechas con formato invalido', () => {
    expect(() => balancesAtDates([ibercaja], [], ['18/11/2026'])).toThrow();
  });
});

describe('computeNetWorth', () => {
  const history = [
    makeTx({ accountId: 'ibercaja', date: '2025-06-28', amountCents: 200000, type: 'income' }),
    makeTx({ accountId: 'ibercaja', date: '2026-09-28', amountCents: 200000, type: 'income' }),
    makeTx({ accountId: 'ibercaja', date: '2026-10-15', amountCents: -50000 }),
    makeTx({ accountId: 'revolut', date: '2026-11-10', amountCents: -10000 }),
  ];

  it('calcula el patrimonio actual y las variaciones a 1 y 12 meses', () => {
    const r = computeNetWorth([ibercaja, revolut], history, { window: '1y', today: '2026-11-18' });
    expect(r.summary.currentCents).toBe(460000);
    // Hace un mes (2026-10-18): 120000 + 200000 + 200000 - 50000 = 470000
    expect(r.summary.changeMonthCents).toBe(-10000);
    // Hace un ano (2025-11-18): 320000
    expect(r.summary.changeYearCents).toBe(140000);
    expect(r.granularity).toBe('month');
    expect(r.points.at(-1)!.date).toBe('2026-11-18');
  });

  it('usa puntos diarios en ventanas cortas', () => {
    const r = computeNetWorth([ibercaja, revolut], history, { window: '1m', today: '2026-11-18' });
    expect(r.granularity).toBe('day');
    expect(r.points[0]!.date).toBe('2026-10-18');
    expect(r.points.at(-1)!.date).toBe('2026-11-18');
  });

  it('en "Todo" empieza en el mes del primer movimiento', () => {
    const r = computeNetWorth([ibercaja, revolut], history, { window: 'all', today: '2026-11-18' });
    expect(r.points[0]!.date).toBe('2025-05-31');
    expect(r.points[0]!.totalCents).toBe(120000);
    expect(r.firstMovementDate).toBe('2025-06-28');
  });

  it('no inventa variaciones si el historico no llega tan atras', () => {
    const r = computeNetWorth([ibercaja], [makeTx({ accountId: 'ibercaja', date: '2026-11-05', amountCents: -100 })], {
      window: '1y',
      today: '2026-11-18',
    });
    expect(r.summary.changeMonthCents).toBeNull();
    expect(r.summary.changeYearCents).toBeNull();
  });

  it('reparte el peso solo sobre saldos positivos y ordena las cuentas por saldo', () => {
    const tarjeta = makeAccount({ id: 'tarjeta', openingBalanceCents: -30000, kind: 'card' });
    const r = computeNetWorth([ibercaja, revolut, tarjeta], [], { window: '6m', today: '2026-11-18' });
    expect(r.summary.currentCents).toBe(90000);
    expect(r.accounts.map((a) => a.accountId)).toEqual(['ibercaja', 'revolut', 'tarjeta']);
    expect(r.accounts[0]!.sharePerMille).toBe(833);
    expect(r.accounts[2]!.sharePerMille).toBeNull();
  });

  it('marca el maximo de la ventana', () => {
    const r = computeNetWorth([ibercaja, revolut], history, { window: '6m', today: '2026-11-18' });
    expect(r.summary.peakCents).toBe(520000);
    expect(r.summary.peakDate).toBe('2026-09-30');
  });

  it('el saldo de hoy no incluye movimientos con fecha futura y los informa aparte', () => {
    const acc = makeAccount({ id: 'a', openingBalanceCents: 100000 });
    const txs = [
      makeTx({ accountId: 'a', date: '2026-11-01', amountCents: -1000 }),
      makeTx({ accountId: 'a', date: '2026-11-25', amountCents: -50000 }),
    ];
    const r = computeNetWorth([acc], txs, { window: '1y', today: '2026-11-18' });
    expect(r.summary.currentCents).toBe(99000);
    expect(r.futureCount).toBe(1);
    expect(r.futureCents).toBe(-50000);
  });

  it('el maximo se busca dentro de la ventana, no en la base anterior', () => {
    const acc = makeAccount({ id: 'a', openingBalanceCents: 500000 });
    const txs = [makeTx({ accountId: 'a', date: '2026-01-10', amountCents: -100000 })];
    const r = computeNetWorth([acc], txs, { window: '1y', today: '2026-11-18' });
    // Base = cierre anterior al primer movimiento (500.000), fuera del maximo de la ventana.
    expect(r.points[0]!.date).toBe('2025-12-31');
    expect(r.points[0]!.totalCents).toBe(500000);
    expect(r.summary.peakCents).toBe(400000);
  });

  it('el reparto por cuenta suma exactamente 1000', () => {
    const accs = ['x', 'y', 'z'].map((id) => makeAccount({ id, openingBalanceCents: 1000 }));
    const r = computeNetWorth(accs, [], { window: '6m', today: '2026-11-18' });
    expect(r.accounts.reduce((s, a) => s + (a.sharePerMille ?? 0), 0)).toBe(1000);
  });

  it('sin cuentas no hay datos y el total es 0', () => {
    const r = computeNetWorth([], [], { window: '1y', today: '2026-11-18' });
    expect(r.hasData).toBe(false);
    expect(r.summary.currentCents).toBe(0);
  });

  it('rechaza una ventana desconocida', () => {
    // @ts-expect-error ventana invalida a proposito
    expect(() => computeNetWorth([ibercaja], [], { window: '7y', today: '2026-11-18' })).toThrow();
  });
});
