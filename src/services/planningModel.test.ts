// Modelo de planificacion (noviembre 2026): marcado explicito de ahorro/inversion, defaults de la
// configuracion de planificacion y conversion de los campos nuevos en el mapper de sync.
import { describe, it, expect } from 'vitest';
import { makeCategory } from '../test/txFixtures';
import {
  automaticStatsRole,
  computeInvestmentCategoryIds,
  computeSavingsCategoryIds,
} from './statsService';
import { DEFAULT_PLANNING_SETTINGS, planningFromSetting, validatePlanningPatch } from './planningSettings';
import { fromRow, toRow } from '../sync/mapper';
import { ValidationError } from '../lib/validation';

describe('papel de las categorias en estadisticas', () => {
  it('sin marcado mantiene la deteccion por nombre (comportamiento previo)', () => {
    const cats = [
      makeCategory({ id: 'ahorro', name: 'Ahorro' }),
      makeCategory({ id: 'inv', name: 'Inversiones', parentId: 'ahorro' }),
      makeCategory({ id: 'super', name: 'Supermercado' }),
    ];
    expect([...computeSavingsCategoryIds(cats)].sort()).toEqual(['ahorro', 'inv']);
    expect([...computeInvestmentCategoryIds(cats)]).toEqual(['inv']);
  });

  it('el marcado explicito manda sobre el nombre', () => {
    const cats = [
      makeCategory({ id: 'hucha', name: 'Hucha Japon', statsRole: 'savings' }),
      makeCategory({ id: 'viaje', name: 'Billetes', parentId: 'hucha' }),
      makeCategory({ id: 'ahorro', name: 'Ahorro', statsRole: 'none' }),
      makeCategory({ id: 'tr', name: 'Trade Republic', statsRole: 'investment' }),
    ];
    expect([...computeSavingsCategoryIds(cats)].sort()).toEqual(['hucha', 'viaje']);
    expect([...computeInvestmentCategoryIds(cats)]).toEqual(['tr']);
  });

  it('una subcategoria marcada como gasto normal no hereda el ahorro del padre', () => {
    const cats = [
      makeCategory({ id: 'ahorro', name: 'Ahorro' }),
      makeCategory({ id: 'irpf', name: 'IRPF', parentId: 'ahorro', statsRole: 'none' }),
    ];
    expect([...computeSavingsCategoryIds(cats)]).toEqual(['ahorro']);
  });

  it('automaticStatsRole explica el papel por nombre', () => {
    expect(automaticStatsRole('Ahorros')).toBe('savings');
    expect(automaticStatsRole('Inversión')).toBe('investment');
    expect(automaticStatsRole('Coche')).toBeNull();
  });
});

describe('configuracion de planificacion', () => {
  it('sin Setting o con campos ausentes usa los defaults', () => {
    expect(planningFromSetting(undefined)).toEqual(DEFAULT_PLANNING_SETTINGS);
  });

  it('valida dia de cobro, colchon y meses de paga extra', () => {
    expect(() => validatePlanningPatch({ payDay: 0 })).toThrow(ValidationError);
    expect(() => validatePlanningPatch({ payDay: 32 })).toThrow(ValidationError);
    expect(() => validatePlanningPatch({ safetyBufferCents: -1 })).toThrow(ValidationError);
    expect(() => validatePlanningPatch({ safetyBufferCents: 10.5 })).toThrow();
    expect(() => validatePlanningPatch({ extraPayMonths: [13] })).toThrow(ValidationError);
    expect(validatePlanningPatch({ extraPayMonths: [12, 6, 6] }).extraPayMonths).toEqual([6, 12]);
  });
});

describe('mapper: campos nuevos', () => {
  it('rellena con defaults los campos que faltan (fila antigua o remoto sin migrar)', () => {
    const now = Date.now();
    const row = toRow('setting', {
      id: 's1',
      currency: 'EUR',
      locale: 'es-ES',
      weekStart: 'monday',
      defaultAccountId: null,
      encryptionEnabled: false,
      createdAt: now,
      updatedAt: now,
    });
    expect(row.safety_buffer_cents).toBe(0);
    expect(row.budget_cycle).toBe('calendar');
    expect(row.extra_pay_months).toEqual([]);
    expect(row.reserve_extra_pay).toBe(true);
    expect(row.pay_day).toBeNull();

    const budgetRow = toRow('budget', { id: 'b1', createdAt: now, updatedAt: now, limitCents: 100 });
    expect(budgetRow.kind).toBe('limit');
  });

  it('una fila remota sin reimbursable_cents se lee como null', () => {
    const local = fromRow('transaction', {
      id: 't1',
      amount_cents: -100,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      deleted_at: null,
    });
    expect(local.reimbursableCents).toBeNull();
  });

  it('ida y vuelta de reimbursable y del papel de categoria', () => {
    const now = Date.now();
    const row = toRow('transaction', {
      id: 't1',
      amountCents: -7200,
      reimbursableCents: 4800,
      createdAt: now,
      updatedAt: now,
    });
    expect(row.reimbursable_cents).toBe(4800);
    expect(fromRow('transaction', row).reimbursableCents).toBe(4800);
    const catRow = toRow('category', { id: 'c1', statsRole: 'savings', createdAt: now, updatedAt: now });
    expect(catRow.stats_role).toBe('savings');
  });
});
