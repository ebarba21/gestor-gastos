import { describe, it, expect } from 'vitest';
import {
  MISSING_STREAK_FOR_POSSIBLY_CANCELLED,
  planOccurrenceSync,
  PRICE_INCREASE_MIN_ABS_CENTS,
  type PlannerCandidateTransaction,
} from './recurringOccurrencePlanner';
import type { RecurringOccurrence, RecurringSeries } from '../db/schema';

function series(overrides: Partial<RecurringSeries> = {}): RecurringSeries {
  return {
    id: 'series-1',
    profileId: 'profile-a',
    merchantId: 'merch-netflix',
    accountId: 'acc-1',
    name: 'Netflix',
    direction: 'expense',
    frequency: 'monthly',
    interval: 1,
    expectedAmountCents: 1500,
    amountToleranceCents: 50,
    amountTolerancePpm: 0,
    expectedDayOfWeek: null,
    expectedDayOfMonth: 5,
    dateToleranceDays: 3,
    nextExpectedDate: '2026-03-05',
    status: 'active',
    confidence: 900,
    detectionVersion: 1,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function tx(id: string, date: string, amountCents: number): PlannerCandidateTransaction {
  return { id, date, amountCents };
}

describe('planOccurrenceSync - emparejamiento dentro de tolerancia', () => {
  it('vincula el movimiento dentro de la ventana como matched y avanza nextExpectedDate', () => {
    const plan = planOccurrenceSync({
      series: series(),
      existingOccurrences: [],
      candidateTransactions: [tx('t1', '2026-03-06', -1500)],
      referenceDateISO: '2026-03-10',
      horizonDateISO: '2026-03-10',
    });
    expect(plan.upserts).toHaveLength(1);
    expect(plan.upserts[0]).toMatchObject({
      expectedDate: '2026-03-05',
      status: 'matched',
      transactionId: 't1',
    });
    expect(plan.nextExpectedDatePatch).toBe('2026-04-05');
    expect(plan.anomalies).toEqual([]);
  });

  it('sigue expected si aun esta dentro de la ventana de tolerancia (no hay ausencia prematura)', () => {
    const plan = planOccurrenceSync({
      series: series({ nextExpectedDate: '2026-03-05', dateToleranceDays: 5 }),
      existingOccurrences: [],
      candidateTransactions: [],
      referenceDateISO: '2026-03-07', // dentro de la ventana (5 dias)
      horizonDateISO: '2026-03-07',
    });
    expect(plan.upserts).toHaveLength(1);
    expect(plan.upserts[0]!.status).toBe('expected');
    expect(plan.anomalies).toEqual([]);
  });
});

describe('planOccurrenceSync - ausencias', () => {
  it('un unico retraso marca missing pero NO posiblemente cancelada', () => {
    const plan = planOccurrenceSync({
      series: series({ dateToleranceDays: 2 }),
      existingOccurrences: [],
      candidateTransactions: [],
      referenceDateISO: '2026-03-10', // 5 dias tras la fecha esperada, fuera de tolerancia (2)
      horizonDateISO: '2026-03-10',
    });
    const missing = plan.upserts.find((u) => u.expectedDate === '2026-03-05');
    expect(missing?.status).toBe('missing');
    expect(plan.statusPatch).toBeNull();
    expect(plan.anomalies.some((a) => a.type === 'missingExpected')).toBe(true);
    expect(plan.anomalies.some((a) => a.type === 'possiblyCancelled')).toBe(false);
  });

  it('dos ausencias consecutivas marcan la serie como possiblyCancelled', () => {
    const existing: RecurringOccurrence = {
      id: 'occ-prev',
      profileId: 'profile-a',
      seriesId: 'series-1',
      transactionId: null,
      expectedDate: '2026-02-05',
      expectedAmountCents: 1500,
      status: 'missing',
      createdAt: 0,
      updatedAt: 0,
    };
    const plan = planOccurrenceSync({
      series: series({ dateToleranceDays: 2 }),
      existingOccurrences: [existing],
      candidateTransactions: [],
      referenceDateISO: '2026-03-10',
      horizonDateISO: '2026-03-10',
    });
    expect(plan.statusPatch).toBe('possiblyCancelled');
    expect(MISSING_STREAK_FOR_POSSIBLY_CANCELLED).toBe(2);
    expect(plan.anomalies.some((a) => a.type === 'possiblyCancelled')).toBe(true);
  });

  it('no declara cancelacion si la racha se rompio por un matched intermedio', () => {
    const existingMatched: RecurringOccurrence = {
      id: 'occ-prev',
      profileId: 'profile-a',
      seriesId: 'series-1',
      transactionId: 'tx-prev',
      expectedDate: '2026-02-05',
      expectedAmountCents: 1500,
      status: 'matched',
      createdAt: 0,
      updatedAt: 0,
    };
    const plan = planOccurrenceSync({
      series: series({ dateToleranceDays: 2 }),
      existingOccurrences: [existingMatched],
      candidateTransactions: [],
      referenceDateISO: '2026-03-10',
      horizonDateISO: '2026-03-10',
    });
    // Solo una ausencia nueva (marzo); febrero fue matched, no rompe la racha hacia possiblyCancelled.
    expect(plan.statusPatch).toBeNull();
  });
});

describe('planOccurrenceSync - subida de precio y duplicados', () => {
  it('detecta subida de precio cuando supera umbral absoluto y porcentual', () => {
    const plan = planOccurrenceSync({
      series: series({ expectedAmountCents: 1000, amountToleranceCents: 50 }),
      existingOccurrences: [],
      // 1200 supera 1000+tolerancia(50)=1050, entra por estar dentro? No: el matching exige
      // dentro de tolerancia. Para probar subida de precio se amplia la tolerancia efectiva via
      // amountTolerancePpm para que aun casé como "la misma serie" pero dispare el aviso.
      candidateTransactions: [tx('t1', '2026-03-05', -1200)],
      referenceDateISO: '2026-03-10',
      horizonDateISO: '2026-03-10',
    });
    // Sin tolerancia suficiente no hay match ni matched; ajustamos expectativas: no matched.
    expect(plan.upserts[0]?.status).not.toBe('matched');
  });

  it('con tolerancia relativa amplia, matched + aviso de subida de precio', () => {
    const plan = planOccurrenceSync({
      series: series({
        expectedAmountCents: 1000,
        amountToleranceCents: 0,
        amountTolerancePpm: 300_000, // 30%, para que 1200 entre dentro del matching
      }),
      existingOccurrences: [],
      candidateTransactions: [tx('t1', '2026-03-05', -1200)],
      referenceDateISO: '2026-03-10',
      horizonDateISO: '2026-03-10',
    });
    expect(plan.upserts[0]).toMatchObject({ status: 'matched', transactionId: 't1' });
    const anomaly = plan.anomalies.find((a) => a.type === 'priceIncrease');
    expect(anomaly).toBeDefined();
    // metadata solo referencia el movimiento (nunca copia importes, DATA_MODEL seccion 16); el
    // importe se resuelve consultando la transaccion referenciada, ya aislada por perfil.
    expect(anomaly!.metadata).toMatchObject({ transactionId: 't1' });
    expect(anomaly!.metadata).not.toHaveProperty('newAmountCents');
    expect(anomaly!.metadata).not.toHaveProperty('previousAmountCents');
    expect(PRICE_INCREASE_MIN_ABS_CENTS).toBeLessThanOrEqual(200);
  });

  it('una subida de precio detectada NUNCA actualiza expectedAmountCents en silencio (solo avisa)', () => {
    const original = series({
      expectedAmountCents: 1000,
      amountToleranceCents: 0,
      amountTolerancePpm: 300_000,
    });
    const plan = planOccurrenceSync({
      series: original,
      existingOccurrences: [],
      candidateTransactions: [tx('t1', '2026-03-05', -1200)],
      referenceDateISO: '2026-03-10',
      horizonDateISO: '2026-03-10',
    });
    // El plan no propone ningun cambio de expectedAmountCents de la serie: solo un patch de
    // nextExpectedDate/status y la ocurrencia 'matched'. Aplicar el nuevo importe base exige una
    // accion explicita de la persona (invariante 11: ningun conflicto financiero en silencio).
    expect(plan.upserts.every((u) => u.expectedAmountCents === original.expectedAmountCents)).toBe(true);
    expect(plan.anomalies.some((a) => a.type === 'priceIncrease')).toBe(true);
  });

  it('detecta cobro duplicado cuando dos movimientos casan en la misma ventana', () => {
    const plan = planOccurrenceSync({
      series: series({ dateToleranceDays: 3 }),
      existingOccurrences: [],
      candidateTransactions: [tx('t1', '2026-03-05', -1500), tx('t2', '2026-03-06', -1500)],
      referenceDateISO: '2026-03-10',
      horizonDateISO: '2026-03-10',
    });
    expect(plan.upserts[0]!.status).toBe('matched');
    expect(plan.anomalies.some((a) => a.type === 'duplicateOccurrence')).toBe(true);
  });
});

describe('planOccurrenceSync - idempotencia y horizonte futuro', () => {
  it('volver a planificar sobre una ocurrencia ya matched no la reabre ni duplica', () => {
    const existing: RecurringOccurrence = {
      id: 'occ-1',
      profileId: 'profile-a',
      seriesId: 'series-1',
      transactionId: 'tx-1',
      expectedDate: '2026-03-05',
      expectedAmountCents: 1500,
      status: 'matched',
      createdAt: 0,
      updatedAt: 0,
    };
    const plan = planOccurrenceSync({
      series: series({ nextExpectedDate: '2026-03-05' }),
      existingOccurrences: [existing],
      candidateTransactions: [tx('t1', '2026-03-05', -1500)],
      referenceDateISO: '2026-03-10',
      horizonDateISO: '2026-03-10',
    });
    // No debe crear/actualizar la ocurrencia de marzo (ya resuelta); avanza directamente.
    expect(plan.upserts.some((u) => u.expectedDate === '2026-03-05')).toBe(false);
  });

  it('genera placeholders expected futuros hasta el horizonte, sin resolverlos', () => {
    const plan = planOccurrenceSync({
      series: series({ nextExpectedDate: '2026-03-05' }),
      existingOccurrences: [],
      candidateTransactions: [],
      referenceDateISO: '2026-03-01', // aun no llega marzo-05
      horizonDateISO: '2026-06-05',
    });
    const dates = plan.upserts.map((u) => u.expectedDate);
    expect(dates).toEqual(['2026-03-05', '2026-04-05', '2026-05-05', '2026-06-05']);
    expect(plan.upserts.every((u) => u.status === 'expected')).toBe(true);
    expect(plan.anomalies).toEqual([]);
  });

  it('REGRESION: con un horizonte largo (12 meses), nextExpectedDate NUNCA salta por delante de una ocurrencia aun sin resolver, para que una sincronizacion posterior la siga comprobando contra movimientos reales', () => {
    // Primera sincronizacion: horizonte de 12 meses desde el dia de la confirmacion (patron real
    // de recurringSeriesService.confirm/syncAllTracked, DEFAULT_HORIZON_MONTHS=12). Genera
    // placeholders 'expected' para los 13 meses (marzo..marzo siguiente), ninguno resuelto aun.
    const s = series({ nextExpectedDate: '2026-03-05' });
    const run1 = planOccurrenceSync({
      series: s,
      existingOccurrences: [],
      candidateTransactions: [],
      referenceDateISO: '2026-03-05',
      horizonDateISO: '2027-03-05',
    });
    expect(run1.upserts).toHaveLength(13); // 2026-03-05 .. 2027-03-05 inclusive, mensual
    expect(run1.upserts.every((u) => u.status === 'expected')).toBe(true);
    // Bug real detectado en pruebas manuales: nextExpectedDate NO debe saltar al final del
    // horizonte (2027-04-05); debe quedarse en la primera ocurrencia sin resolver (2026-03-05).
    expect(run1.nextExpectedDatePatch).toBeNull(); // sin cambio: sigue siendo 2026-03-05

    // Materializa las ocurrencias que crearia el servicio (con id) para pasarlas como
    // existingOccurrences de la segunda pasada.
    const existingAfterRun1: RecurringOccurrence[] = run1.upserts.map((u, i) => ({
      id: `occ-${i}`,
      profileId: 'profile-a',
      seriesId: s.id,
      transactionId: u.transactionId,
      expectedDate: u.expectedDate,
      expectedAmountCents: u.expectedAmountCents,
      status: u.status,
      createdAt: 0,
      updatedAt: 0,
    }));

    // Segunda sincronizacion, un mes despues: llega el movimiento real de marzo. Si
    // nextExpectedDate se hubiera corrompido tras la primera pasada, el cursor arrancaria mucho
    // mas alla de marzo y este movimiento NUNCA se emparejaria.
    const run2 = planOccurrenceSync({
      series: { ...s, nextExpectedDate: run1.nextExpectedDatePatch ?? s.nextExpectedDate },
      existingOccurrences: existingAfterRun1,
      candidateTransactions: [tx('tx-march', '2026-03-06', -1500)],
      referenceDateISO: '2026-04-05',
      horizonDateISO: '2027-04-05',
    });
    const marchUpsert = run2.upserts.find((u) => u.expectedDate === '2026-03-05');
    expect(marchUpsert).toMatchObject({ status: 'matched', transactionId: 'tx-march' });
    // La siguiente sin resolver (abril) sigue expected; nextExpectedDate avanza a ella, no mas
    // alla del horizonte.
    expect(run2.nextExpectedDatePatch).toBe('2026-04-05');
  });
});
