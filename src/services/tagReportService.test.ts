import { describe, expect, it } from 'vitest';
import { makeCategory, makeTx } from '../test/txFixtures';
import { computeTagReport } from './tagReportService';

const cats = [
  makeCategory({ id: 'vac', name: 'Vacaciones' }),
  makeCategory({ id: 'vac-comida', name: 'Comida', parentId: 'vac' }),
  makeCategory({ id: 'vac-aloj', name: 'Alojamiento', parentId: 'vac' }),
  makeCategory({ id: 'transp', name: 'Transporte' }),
  makeCategory({ id: 'ahorro', name: 'Ahorro' }),
];
const TAG = { id: 'lisboa', name: 'Viaje Lisboa' };

describe('informe por etiqueta', () => {
  it('suma el gasto neto del viaje en todas sus categorias, con dias y coste por dia', () => {
    const cena = makeTx({ date: '2026-07-03', amountCents: -8000, categoryId: 'vac', subcategoryId: 'vac-comida', tagIds: ['lisboa'], concept: 'Restaurante', normalizedConcept: 'restaurante' });
    const txs = [
      makeTx({ date: '2026-07-01', amountCents: -24000, categoryId: 'transp', tagIds: ['lisboa'], concept: 'Vueling', merchantId: 'm-vueling' }),
      makeTx({ date: '2026-07-01', amountCents: -36000, categoryId: 'vac', subcategoryId: 'vac-aloj', tagIds: ['lisboa'], concept: 'Hotel', normalizedConcept: 'hotel' }),
      cena,
      // Bizum de un amigo por su mitad de la cena: sin etiqueta pero enlazado a la cena.
      makeTx({ date: '2026-07-04', amountCents: 4000, type: 'income', refundOfId: cena.id, concept: 'Bizum Marta' }),
      // Otro gasto de vacaciones de otro viaje: no cuenta.
      makeTx({ date: '2026-08-01', amountCents: -9999, categoryId: 'vac', subcategoryId: 'vac-comida' }),
    ];
    const r = computeTagReport(TAG, txs, cats, new Map([['m-vueling', 'Vueling']]));
    expect(r.netCents).toBe(24000 + 36000 + 8000 - 4000);
    expect(r.grossCents).toBe(68000);
    expect(r.returnedCents).toBe(4000);
    expect(r.movementCount).toBe(4);
    expect(r.firstDate).toBe('2026-07-01');
    expect(r.lastDate).toBe('2026-07-04');
    expect(r.days).toBe(4);
    expect(r.perDayCents).toBe(16000);
    expect(r.byCategory).toEqual([
      { id: 'vac', label: 'Vacaciones', cents: 40000 },
      { id: 'transp', label: 'Transporte', cents: 24000 },
    ]);
    expect(r.bySubcategory.find((l) => l.id === 'vac-comida')!.cents).toBe(4000);
    expect(r.byMerchant[0]).toEqual({ id: null, label: 'Hotel', cents: 36000 });
    expect(r.byMerchant[1]).toEqual({ id: 'm-vueling', label: 'Vueling', cents: 24000 });
  });

  it('una etiqueta sin gastos da un informe vacio', () => {
    const r = computeTagReport(TAG, [makeTx({ amountCents: -100, categoryId: 'transp' })], cats);
    expect(r.movementCount).toBe(0);
    expect(r.netCents).toBe(0);
    expect(r.perDayCents).toBeNull();
  });
});
