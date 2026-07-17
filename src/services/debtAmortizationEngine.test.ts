// Fixtures de FINANCIAL_ALGORITHMS.md seccion 11 (prestamo fijo, cero interes, cuota
// insuficiente) mas fixtures de extras/Snowball/Avalanche congelados con una implementacion de
// referencia independiente (scratchpad/debt-reference.mjs, mismas formulas de 8.2-8.3 y 9,
// verificada por separado con node antes de escribir este motor). Todo en centimos enteros.
import { describe, it, expect } from 'vitest';
import {
  buildAmortizationSchedule,
  detectDegenerate,
  simulateExtraPayments,
  compareExtraPayments,
  simulateMultiDebtStrategy,
  compareStrategies,
  type MultiDebtInput,
} from './debtAmortizationEngine';
import { computeInstallmentCents, monthlyInterestCents } from '../lib/interest';

const START = '2026-01-01';

describe('computeInstallmentCents / monthlyInterestCents', () => {
  it('prestamo fijo: P=1.000.000, 5% anual, 12 meses', () => {
    expect(computeInstallmentCents(1_000_000, 50000, 12)).toBe(85607);
    expect(monthlyInterestCents(1_000_000, 50000)).toBe(4167);
  });

  it('cero interes: cuota = P/n exacta', () => {
    expect(computeInstallmentCents(120_000, 0, 12)).toBe(10000);
    expect(monthlyInterestCents(120_000, 0)).toBe(0);
  });
});

describe('buildAmortizationSchedule: prestamo fijo (fixture congelado)', () => {
  const result = buildAmortizationSchedule({
    principalCents: 1_000_000,
    annualRatePpm: 50000,
    termMonths: 12,
    startDate: START,
  });

  it('cuota = 85607', () => {
    expect(result.installmentCents).toBe(85607);
  });

  it('interes del primer periodo = 4167', () => {
    expect(result.rows[0].interestCents).toBe(4167);
  });

  it('ultimo pago = 85612, principal ultimo = 85257', () => {
    const last = result.rows[result.rows.length - 1];
    expect(last.paymentCents).toBe(85612);
    expect(last.principalCents).toBe(85257);
    expect(last.balanceCents).toBe(0);
  });

  it('intereses totales = 27289', () => {
    expect(result.totalInterestCents).toBe(27289);
  });

  it('exactamente 12 periodos y suma de principales = principal original', () => {
    expect(result.rows).toHaveLength(12);
    const sumPrincipal = result.rows.reduce((s, r) => s + r.principalCents, 0);
    expect(sumPrincipal).toBe(1_000_000);
  });

  it('no es degenerado', () => {
    expect(result.degenerate).toBeNull();
  });
});

describe('buildAmortizationSchedule: cero interes (fixture congelado)', () => {
  const result = buildAmortizationSchedule({
    principalCents: 120_000,
    annualRatePpm: 0,
    termMonths: 12,
    startDate: START,
  });

  it('cuota = 10000, intereses totales = 0, saldo final = 0', () => {
    expect(result.installmentCents).toBe(10000);
    expect(result.totalInterestCents).toBe(0);
    expect(result.rows[result.rows.length - 1].balanceCents).toBe(0);
  });

  it('cada periodo amortiza exactamente 10000 de principal (reparto exacto sin residuo)', () => {
    for (const row of result.rows) {
      expect(row.principalCents).toBe(10000);
      expect(row.interestCents).toBe(0);
    }
  });
});

describe('cuota insuficiente y cuota critica (fixture congelado)', () => {
  it('cuota < interes del primer periodo => insufficientPayment, sin calendario', () => {
    const degenerate = detectDegenerate(1_000_000, 50000, 4000, 12);
    expect(degenerate).toBe('insufficientPayment');
    const result = buildAmortizationSchedule({
      principalCents: 1_000_000,
      annualRatePpm: 50000,
      termMonths: 12,
      installmentCents: 4000,
      startDate: START,
    });
    expect(result.degenerate).toBe('insufficientPayment');
    expect(result.rows).toHaveLength(0);
  });

  it('cuota == interes del primer periodo => criticalPayment (principal 0), sin calendario', () => {
    const degenerate = detectDegenerate(1_000_000, 50000, 4167, 12);
    expect(degenerate).toBe('criticalPayment');
    const result = buildAmortizationSchedule({
      principalCents: 1_000_000,
      annualRatePpm: 50000,
      termMonths: 12,
      installmentCents: 4167,
      startDate: START,
    });
    expect(result.degenerate).toBe('criticalPayment');
    expect(result.rows).toHaveLength(0);
  });

  it('tarjeta type=card no participa: se detecta a nivel de orquestador (fuera de este motor), aqui solo se documenta con un caso degenerate mid-simulacion', () => {
    // El motor no conoce 'card'; el filtrado de tipo vive en debtsService. Aqui solo se
    // verifica que una deuda con cuota insuficiente se excluye de una simulacion multideuda
    // (ver bloque de Snowball/Avalanche mas abajo, degenerateDebtIds).
    expect(true).toBe(true);
  });
});

describe('amortizacion anticipada (fixtures congelados con implementacion de referencia)', () => {
  const baseline = buildAmortizationSchedule({
    principalCents: 1_000_000,
    annualRatePpm: 50000,
    termMonths: 12,
    startDate: START,
  });

  it('extra puntual (200000 en el periodo 3), reducir plazo: 10 meses, intereses 20320', () => {
    const result = simulateExtraPayments({
      principalCents: 1_000_000,
      annualRatePpm: 50000,
      termMonths: 12,
      baseInstallmentCents: 85607,
      startDate: START,
      plan: { recurringExtraCents: 0, oneTime: [{ period: 3, amountCents: 200000 }], mode: 'reduceTerm' },
    });
    expect(result.payoffPeriod).toBe(10);
    expect(result.totalInterestCents).toBe(20320);
    expect(result.rows[result.rows.length - 1].balanceCents).toBe(0);
    expect(result.finalInstallmentCents).toBe(85607); // reduceTerm: la cuota no cambia

    const comparison = compareExtraPayments(baseline, result, 12);
    expect(comparison.monthsSaved).toBe(2);
    expect(comparison.interestSavedCents).toBe(6969);
  });

  it('extra mensual (20000/mes desde el periodo 1), reducir plazo: 10 meses, intereses 22435', () => {
    const result = simulateExtraPayments({
      principalCents: 1_000_000,
      annualRatePpm: 50000,
      termMonths: 12,
      baseInstallmentCents: 85607,
      startDate: START,
      plan: { recurringExtraCents: 20000, oneTime: [], mode: 'reduceTerm' },
    });
    expect(result.payoffPeriod).toBe(10);
    expect(result.totalInterestCents).toBe(22435);
    expect(result.finalInstallmentCents).toBe(85607);

    const comparison = compareExtraPayments(baseline, result, 12);
    expect(comparison.monthsSaved).toBe(2);
    expect(comparison.interestSavedCents).toBe(4854);
  });

  it('extra puntual (200000 en el periodo 1), reducir cuota: mantiene 12 meses, cuota nueva 66968, intereses 22256', () => {
    const result = simulateExtraPayments({
      principalCents: 1_000_000,
      annualRatePpm: 50000,
      termMonths: 12,
      baseInstallmentCents: 85607,
      startDate: START,
      plan: { recurringExtraCents: 0, oneTime: [{ period: 1, amountCents: 200000 }], mode: 'reducePayment' },
    });
    expect(result.payoffPeriod).toBe(12);
    expect(result.totalInterestCents).toBe(22256);
    expect(result.rows[1].paymentCents).toBe(66968); // cuota recalculada desde el periodo 2
    expect(result.rows[result.rows.length - 1].balanceCents).toBe(0);

    const comparison = compareExtraPayments(baseline, result, 12);
    expect(comparison.monthsSaved).toBe(0); // el plazo se mantiene
    expect(comparison.interestSavedCents).toBe(5033);
  });
});

describe('Snowball y Avalanche con 3 deudas (fixture congelado, desempate deterministico)', () => {
  // d1/d2 empiezan con el MISMO saldo (300000): prueba el desempate de Snowball (gana d1 por
  // orden de entrada). d2/d3 comparten la MISMA tasa (80000 ppm): prueba el desempate de
  // Avalanche (gana d2 por orden de entrada).
  const debts: MultiDebtInput[] = [
    { id: 'd1', balanceCents: 300000, annualRatePpm: 50000, minimumPaymentCents: 25682 },
    { id: 'd2', balanceCents: 300000, annualRatePpm: 80000, minimumPaymentCents: 26097 },
    { id: 'd3', balanceCents: 150000, annualRatePpm: 80000, minimumPaymentCents: 19317 },
  ];

  it('minimos calculados a partir de la cuota fija (referencia cruzada)', () => {
    expect(computeInstallmentCents(300000, 50000, 12)).toBe(25682);
    expect(computeInstallmentCents(300000, 80000, 12)).toBe(26097);
    expect(computeInstallmentCents(150000, 80000, 8)).toBe(19317);
  });

  it('baseline (solo minimos, sin redistribuir cuotas liberadas): 13 meses, intereses 25880', () => {
    // El "baseline" es la situacion SIN cambios: cada deuda amortiza de forma independiente a
    // su propio minimo. Redirigir la cuota liberada de una deuda ya pagada a otra YA es una
    // estrategia (snowball/avalanche), no un baseline; por eso el extra pasado aqui (50000) se
    // ignora para 'baseline' (mismo criterio que compareStrategies, que siempre llama a
    // baseline con extra 0).
    const result = simulateMultiDebtStrategy({
      debts,
      strategy: 'baseline',
      recurringExtraCents: 50000,
      startDate: START,
    });
    expect(result.totalMonths).toBe(13);
    expect(result.totalInterestCents).toBe(25880);
    expect(result.payoffOrder.map((p) => p.debtId)).toEqual(['d3', 'd2', 'd1']);
  });

  it('snowball (empate de saldo d1/d2, gana d1 por orden): 7 meses, intereses 15941', () => {
    const result = simulateMultiDebtStrategy({
      debts,
      strategy: 'snowball',
      recurringExtraCents: 50000,
      startDate: START,
    });
    expect(result.totalMonths).toBe(7);
    expect(result.totalInterestCents).toBe(15941);
    expect(result.payoffOrder.map((p) => p.debtId)).toEqual(['d3', 'd1', 'd2']);
    expect(result.payoffOrder.map((p) => p.payoffMonth)).toEqual([3, 5, 7]);
  });

  it('avalanche (empate de tasa d2/d3, gana d2 por orden): 7 meses, intereses 15126', () => {
    const result = simulateMultiDebtStrategy({
      debts,
      strategy: 'avalanche',
      recurringExtraCents: 50000,
      startDate: START,
    });
    expect(result.totalMonths).toBe(7);
    expect(result.totalInterestCents).toBe(15126);
    expect(result.payoffOrder.map((p) => p.debtId)).toEqual(['d2', 'd3', 'd1']);
    expect(result.payoffOrder.map((p) => p.payoffMonth)).toEqual([5, 6, 7]);
  });

  it('avalanche ahorra mas intereses que snowball en este conjunto, sin declarar ninguna universalmente mejor', () => {
    const comparison = compareStrategies({ debts, recurringExtraCents: 50000, startDate: START });
    expect(comparison.cheapestStrategy).toBe('avalanche');
    // En este conjunto ambas estrategias liberan las deudas en el mismo mes (7): la mas rapida
    // no es exclusiva de una, refleja que ninguna estrategia es universalmente mejor.
    expect(comparison.fastestStrategy).toBe('snowball');
  });

  it('deuda con cuota insuficiente se excluye de la simulacion (no participa, se lista)', () => {
    const withBadDebt: MultiDebtInput[] = [
      ...debts,
      { id: 'd4-insuficiente', balanceCents: 1_000_000, annualRatePpm: 50000, minimumPaymentCents: 4000 },
    ];
    const result = simulateMultiDebtStrategy({
      debts: withBadDebt,
      strategy: 'avalanche',
      recurringExtraCents: 50000,
      startDate: START,
    });
    expect(result.degenerateDebtIds).toEqual(['d4-insuficiente']);
    expect(result.payoffOrder.map((p) => p.debtId)).not.toContain('d4-insuficiente');
  });

  it('baseline nunca gana "mas rapida"/"menor coste" aunque empate (es la referencia, no una candidata)', () => {
    const single: MultiDebtInput[] = [
      { id: 'solo', balanceCents: 1_000_000, annualRatePpm: 50000, minimumPaymentCents: 85607 },
    ];
    const comparison = compareStrategies({ debts: single, recurringExtraCents: 0, startDate: START });
    expect(comparison.fastestStrategy).not.toBe('baseline');
    expect(comparison.cheapestStrategy).not.toBe('baseline');
    expect(['snowball', 'avalanche']).toContain(comparison.fastestStrategy);
  });

  it('una amortizacion puntual va a SU deuda objetivo, no al fondo que reparte la estrategia', () => {
    // d1 y d2 con saldos identicos: en snowball puro, el extra recurrente iria a d1 (primero
    // por orden). Una puntual dirigida explicitamente a d2 debe reducir el saldo de d2, no el
    // de d1, aunque la estrategia priorizaria d1.
    const twoDebts: MultiDebtInput[] = [
      { id: 'd1', balanceCents: 100000, annualRatePpm: 0, minimumPaymentCents: 10000 },
      { id: 'd2', balanceCents: 100000, annualRatePpm: 0, minimumPaymentCents: 10000 },
    ];
    const withoutOneTime = simulateMultiDebtStrategy({
      debts: twoDebts,
      strategy: 'snowball',
      recurringExtraCents: 0,
      startDate: START,
    });
    const withOneTime = simulateMultiDebtStrategy({
      debts: twoDebts,
      strategy: 'snowball',
      recurringExtraCents: 0,
      oneTimeExtraPayments: [{ debtId: 'd2', month: 1, amountCents: 50000 }],
      startDate: START,
    });
    // Sin la puntual, ambas terminan el mismo mes (saldos y minimos identicos).
    expect(withoutOneTime.payoffOrder.find((p) => p.debtId === 'd1')?.payoffMonth).toBe(
      withoutOneTime.payoffOrder.find((p) => p.debtId === 'd2')?.payoffMonth,
    );
    // Con 50000 cents dirigidos a d2, d2 debe liquidarse ANTES que d1 (recibio la puntual),
    // nunca al reves (lo que ocurriria si la puntual se redistribuyera por prioridad a d1).
    const d1Payoff = withOneTime.payoffOrder.find((p) => p.debtId === 'd1')!.payoffMonth;
    const d2Payoff = withOneTime.payoffOrder.find((p) => p.debtId === 'd2')!.payoffMonth;
    expect(d2Payoff).toBeLessThan(d1Payoff);
  });

  it('determinismo: dos ejecuciones con los mismos datos dan el mismo resultado exacto', () => {
    const a = simulateMultiDebtStrategy({ debts, strategy: 'snowball', recurringExtraCents: 50000, startDate: START });
    const b = simulateMultiDebtStrategy({ debts, strategy: 'snowball', recurringExtraCents: 50000, startDate: START });
    expect(a).toEqual(b);
  });
});
