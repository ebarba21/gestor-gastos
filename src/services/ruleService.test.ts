import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db';
import type { Rule, RuleAction, RuleCondition } from '../db/schema';
import { transactionsRepo, type NewTransaction } from '../db/transactionsRepo';
import { rulesRepo } from '../db/rulesRepo';
import { ValidationError } from '../lib/validation';
import {
  conditionMatches,
  ruleMatches,
  evaluateRules,
  categorizationFrom,
  simulateOnTransactions,
  validateRuleInput,
  validateCondition,
  isRuleEligible,
  applyRulesToDraft,
  ruleService,
  type EvaluableTransaction,
  type RuleInput,
} from './ruleService';

const A = 'perfil-a';
const B = 'perfil-b';

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  localStorage.clear();
});

// --- Factorias ---

function cond(over: Partial<RuleCondition> = {}): RuleCondition {
  return { field: 'concept', operator: 'contains', value: '', value2: null, caseSensitive: false, ...over };
}

function action(over: Partial<RuleAction> = {}): RuleAction {
  return { setCategoryId: 'cat-1', setSubcategoryId: null, addTagIds: [], setExcludedFromStats: null, ...over };
}

function makeRule(over: Partial<Rule> = {}): Rule {
  return {
    id: over.id ?? crypto.randomUUID(),
    profileId: over.profileId ?? A,
    name: over.name ?? 'regla',
    enabled: over.enabled ?? true,
    priority: over.priority ?? 0,
    matchMode: over.matchMode ?? 'all',
    conditions: over.conditions ?? [cond({ value: 'MERCADONA' })],
    action: over.action ?? action(),
    stopOnMatch: over.stopOnMatch ?? true,
    createdAt: over.createdAt ?? 0,
    updatedAt: over.updatedAt ?? 0,
  };
}

function etx(over: Partial<EvaluableTransaction> = {}): EvaluableTransaction {
  return {
    concept: 'COMPRA MERCADONA MADRID',
    amountCents: -5000,
    date: '2026-03-15',
    accountId: 'acc-1',
    type: 'expense',
    ...over,
  };
}

let hashCounter = 0;
function newTx(over: Partial<NewTransaction> = {}): NewTransaction {
  hashCounter += 1;
  return {
    date: '2026-03-15',
    amountCents: -5000,
    type: 'expense',
    concept: 'COMPRA MERCADONA',
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
    dedupeHash: `hash-${hashCounter}`,
    ...over,
  };
}

function ruleInput(over: Partial<RuleInput> = {}): RuleInput {
  return {
    name: 'Mercadona',
    enabled: true,
    matchMode: 'all',
    conditions: [cond({ value: 'MERCADONA' })],
    action: action(),
    stopOnMatch: true,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// 1. Condiciones por tipo
// ---------------------------------------------------------------------------

describe('conditionMatches - concepto (texto)', () => {
  it('contains / notContains', () => {
    expect(conditionMatches(cond({ operator: 'contains', value: 'mercadona' }), etx())).toBe(true);
    expect(conditionMatches(cond({ operator: 'contains', value: 'lidl' }), etx())).toBe(false);
    expect(conditionMatches(cond({ operator: 'notContains', value: 'lidl' }), etx())).toBe(true);
    expect(conditionMatches(cond({ operator: 'notContains', value: 'mercadona' }), etx())).toBe(false);
  });

  it('startsWith / endsWith / equals', () => {
    expect(conditionMatches(cond({ operator: 'startsWith', value: 'compra' }), etx())).toBe(true);
    expect(conditionMatches(cond({ operator: 'endsWith', value: 'madrid' }), etx())).toBe(true);
    expect(
      conditionMatches(cond({ operator: 'equals', value: 'compra mercadona madrid' }), etx()),
    ).toBe(true);
    expect(conditionMatches(cond({ operator: 'equals', value: 'mercadona' }), etx())).toBe(false);
  });

  it('respeta caseSensitive', () => {
    expect(
      conditionMatches(cond({ operator: 'contains', value: 'MERCADONA', caseSensitive: true }), etx()),
    ).toBe(true);
    expect(
      conditionMatches(cond({ operator: 'contains', value: 'mercadona', caseSensitive: true }), etx()),
    ).toBe(false);
  });

  it('regex valida casa', () => {
    expect(
      conditionMatches(cond({ operator: 'regex', value: 'merc.?dona' }), etx()),
    ).toBe(true);
    expect(
      conditionMatches(cond({ operator: 'regex', value: '^LIDL' }), etx()),
    ).toBe(false);
  });

  it('regex invalida no casa y no rompe el motor', () => {
    expect(() => conditionMatches(cond({ operator: 'regex', value: '(' }), etx())).not.toThrow();
    expect(conditionMatches(cond({ operator: 'regex', value: '(' }), etx())).toBe(false);
  });
});

describe('conditionMatches - importe (centimos con signo)', () => {
  const c = (operator: RuleCondition['operator'], value: number, value2: number | null = null) =>
    cond({ field: 'amount', operator, value, value2 });

  it('gt / lt / gte / lte / eq sobre importe con signo', () => {
    const gasto = etx({ amountCents: -5000 });
    expect(conditionMatches(c('lt', 0), gasto)).toBe(true);
    expect(conditionMatches(c('gt', 0), gasto)).toBe(false);
    expect(conditionMatches(c('lt', -4000), gasto)).toBe(true);
    expect(conditionMatches(c('gte', -5000), gasto)).toBe(true);
    expect(conditionMatches(c('lte', -5000), gasto)).toBe(true);
    expect(conditionMatches(c('eq', -5000), gasto)).toBe(true);
    const ingreso = etx({ amountCents: 12000, type: 'income' });
    expect(conditionMatches(c('gt', 10000), ingreso)).toBe(true);
  });

  it('between usa value..value2 inclusivo sin importar el orden', () => {
    const gasto = etx({ amountCents: -5000 });
    expect(conditionMatches(c('between', -6000, -4000), gasto)).toBe(true);
    expect(conditionMatches(c('between', -4000, -6000), gasto)).toBe(true);
    expect(conditionMatches(c('between', -4000, -1000), gasto)).toBe(false);
  });
});

describe('conditionMatches - fecha', () => {
  const c = (operator: RuleCondition['operator'], value: string, value2: string | null = null) =>
    cond({ field: 'date', operator, value, value2 });

  it('before / after', () => {
    const t = etx({ date: '2026-03-15' });
    expect(conditionMatches(c('before', '2026-04-01'), t)).toBe(true);
    expect(conditionMatches(c('before', '2026-01-01'), t)).toBe(false);
    expect(conditionMatches(c('after', '2026-01-01'), t)).toBe(true);
    expect(conditionMatches(c('after', '2026-04-01'), t)).toBe(false);
  });

  it('between rango inclusivo', () => {
    const t = etx({ date: '2026-03-15' });
    expect(conditionMatches(c('between', '2026-01-01', '2026-12-31'), t)).toBe(true);
    expect(conditionMatches(c('between', '2026-04-01', '2026-12-31'), t)).toBe(false);
  });
});

describe('conditionMatches - cuenta y tipo', () => {
  it('account equals compara accountId', () => {
    expect(
      conditionMatches(cond({ field: 'account', operator: 'equals', value: 'acc-1' }), etx()),
    ).toBe(true);
    expect(
      conditionMatches(cond({ field: 'account', operator: 'equals', value: 'acc-2' }), etx()),
    ).toBe(false);
  });

  it('type equals compara el tipo', () => {
    expect(
      conditionMatches(cond({ field: 'type', operator: 'equals', value: 'expense' }), etx()),
    ).toBe(true);
    expect(
      conditionMatches(cond({ field: 'type', operator: 'equals', value: 'income' }), etx()),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Combinacion de condiciones (matchMode)
// ---------------------------------------------------------------------------

describe('ruleMatches - combinaciones', () => {
  it('matchMode all exige todas las condiciones', () => {
    const rule = makeRule({
      matchMode: 'all',
      conditions: [cond({ value: 'MERCADONA' }), cond({ field: 'amount', operator: 'lt', value: 0 })],
    });
    expect(ruleMatches(rule, etx({ amountCents: -5000 }))).toBe(true);
    expect(ruleMatches(rule, etx({ amountCents: 5000, type: 'income' }))).toBe(false);
  });

  it('matchMode any exige al menos una', () => {
    const rule = makeRule({
      matchMode: 'any',
      conditions: [cond({ value: 'LIDL' }), cond({ field: 'account', operator: 'equals', value: 'acc-1' })],
    });
    expect(ruleMatches(rule, etx())).toBe(true);
    expect(ruleMatches(rule, etx({ concept: 'CAFE', accountId: 'acc-9' }))).toBe(false);
  });

  it('una regla sin condiciones nunca casa', () => {
    expect(ruleMatches(makeRule({ conditions: [] }), etx())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Prioridad y stopOnMatch
// ---------------------------------------------------------------------------

describe('evaluateRules - prioridad y acumulacion', () => {
  it('la primera regla por prioridad que casa es la propietaria (ruleId)', () => {
    const r1 = makeRule({ id: 'r1', priority: 1, action: action({ setCategoryId: 'cat-B' }) });
    const r2 = makeRule({ id: 'r2', priority: 0, action: action({ setCategoryId: 'cat-A' }) });
    const res = evaluateRules([r1, r2], etx());
    expect(res.matched).toBe(true);
    expect(res.ruleId).toBe('r2'); // priority 0 va primero
    expect(res.setCategoryId).toBe('cat-A');
  });

  it('stopOnMatch=true detiene la evaluacion en la primera que casa', () => {
    const r1 = makeRule({ id: 'r1', priority: 0, stopOnMatch: true, action: action({ addTagIds: ['t1'] }) });
    const r2 = makeRule({ id: 'r2', priority: 1, action: action({ addTagIds: ['t2'] }) });
    const res = evaluateRules([r1, r2], etx());
    expect(res.matchedRuleIds).toEqual(['r1']);
    expect(res.addTagIds).toEqual(['t1']);
  });

  it('stopOnMatch=false acumula etiquetas de varias reglas y la primera categoria gana', () => {
    const r1 = makeRule({
      id: 'r1',
      priority: 0,
      stopOnMatch: false,
      action: action({ setCategoryId: 'cat-A', addTagIds: ['t1'] }),
    });
    const r2 = makeRule({
      id: 'r2',
      priority: 1,
      stopOnMatch: false,
      action: action({ setCategoryId: 'cat-B', addTagIds: ['t2'] }),
    });
    const res = evaluateRules([r1, r2], etx());
    expect(res.matchedRuleIds).toEqual(['r1', 'r2']);
    expect(res.setCategoryId).toBe('cat-A'); // la primera que aporta categoria
    expect(res.addTagIds).toEqual(['t1', 't2']);
    expect(res.ruleId).toBe('r1');
  });

  it('ignora reglas desactivadas', () => {
    const r1 = makeRule({ id: 'r1', enabled: false, priority: 0 });
    const r2 = makeRule({ id: 'r2', enabled: true, priority: 1, action: action({ setCategoryId: 'cat-Z' }) });
    const res = evaluateRules([r1, r2], etx());
    expect(res.ruleId).toBe('r2');
  });

  it('sin coincidencias, matched=false', () => {
    const res = evaluateRules([makeRule({ conditions: [cond({ value: 'LIDL' })] })], etx());
    expect(res.matched).toBe(false);
    expect(res.ruleId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. Derivacion de categorizacion (idempotencia, merge de etiquetas)
// ---------------------------------------------------------------------------

describe('categorizationFrom', () => {
  const current = {
    categoryId: null,
    subcategoryId: null,
    tagIds: [] as string[],
    excludedFromStats: false,
    categorizedBy: 'none' as const,
    ruleId: null,
  };

  it('aplica categoria y marca categorizedBy=rule con ruleId', () => {
    const ev = evaluateRules([makeRule({ id: 'r1', action: action({ setCategoryId: 'cat-A', setSubcategoryId: 'sub-A' }) })], etx());
    const cat = categorizationFrom(current, ev);
    expect(cat).not.toBeNull();
    expect(cat!.categoryId).toBe('cat-A');
    expect(cat!.subcategoryId).toBe('sub-A');
    expect(cat!.categorizedBy).toBe('rule');
    expect(cat!.ruleId).toBe('r1');
  });

  it('anade etiquetas sin borrar las existentes', () => {
    const ev = evaluateRules([makeRule({ action: action({ setCategoryId: null, addTagIds: ['t2'] }) })], etx());
    const cat = categorizationFrom({ ...current, tagIds: ['t1'] }, ev);
    expect(cat!.tagIds).toEqual(['t1', 't2']);
  });

  it('es idempotente: aplicar dos veces no genera un segundo cambio', () => {
    const ev = evaluateRules([makeRule({ id: 'r1', action: action({ setCategoryId: 'cat-A' }) })], etx());
    const first = categorizationFrom(current, ev)!;
    const second = categorizationFrom(
      { ...current, categoryId: first.categoryId, categorizedBy: first.categorizedBy, ruleId: first.ruleId },
      ev,
    );
    expect(second).toBeNull();
  });

  it('sin coincidencias devuelve null', () => {
    const ev = evaluateRules([makeRule({ conditions: [cond({ value: 'LIDL' })] })], etx());
    expect(categorizationFrom(current, ev)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. Validacion
// ---------------------------------------------------------------------------

describe('validacion de reglas', () => {
  it('rechaza regex invalida al guardar', () => {
    expect(() =>
      validateCondition(cond({ operator: 'regex', value: '(' })),
    ).toThrow(ValidationError);
  });

  it('rechaza condicion de importe sin valor entero en centimos', () => {
    expect(() => validateCondition(cond({ field: 'amount', operator: 'gt', value: 'x' }))).toThrow(
      ValidationError,
    );
  });

  it('rechaza between de importe sin segundo valor', () => {
    expect(() =>
      validateCondition(cond({ field: 'amount', operator: 'between', value: 100, value2: null })),
    ).toThrow(ValidationError);
  });

  it('rechaza fecha invalida', () => {
    expect(() => validateCondition(cond({ field: 'date', operator: 'after', value: '2026-13-40' }))).toThrow(
      ValidationError,
    );
  });

  it('rechaza operador no valido para el campo', () => {
    expect(() => validateCondition(cond({ field: 'account', operator: 'contains', value: 'x' }))).toThrow(
      ValidationError,
    );
  });

  it('rechaza accion sin ningun efecto', () => {
    expect(() =>
      validateRuleInput(
        ruleInput({ action: { setCategoryId: null, setSubcategoryId: null, addTagIds: [], setExcludedFromStats: null } }),
      ),
    ).toThrow(ValidationError);
  });

  it('rechaza subcategoria sin categoria', () => {
    expect(() =>
      validateRuleInput(
        ruleInput({ action: { setCategoryId: null, setSubcategoryId: 'sub', addTagIds: ['t1'], setExcludedFromStats: null } }),
      ),
    ).toThrow(ValidationError);
  });

  it('rechaza regla sin condiciones', () => {
    expect(() => validateRuleInput(ruleInput({ conditions: [] }))).toThrow(ValidationError);
  });

  it('normaliza el nombre y deduplica etiquetas', () => {
    const clean = validateRuleInput(
      ruleInput({ name: '  Mi   regla ', action: action({ setCategoryId: 'c', addTagIds: ['t1', 't1', 't2'] }) }),
    );
    expect(clean.name).toBe('Mi regla');
    expect(clean.action.addTagIds).toEqual(['t1', 't2']);
  });
});

// ---------------------------------------------------------------------------
// 6. Elegibilidad (movimientos especiales)
// ---------------------------------------------------------------------------

describe('isRuleEligible', () => {
  it('excluye transferencias y padres de split', async () => {
    const [normal] = await transactionsRepo.createMany(A, [newTx()]);
    const [transfer] = await transactionsRepo.createMany(A, [
      newTx({ type: 'transfer', transferGroupId: 'g1', excludedFromStats: true }),
    ]);
    const [parent] = await transactionsRepo.createMany(A, [newTx({ isSplitParent: true, excludedFromStats: true })]);
    expect(isRuleEligible(normal!)).toBe(true);
    expect(isRuleEligible(transfer!)).toBe(false);
    expect(isRuleEligible(parent!)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. Simulacion sobre transacciones (pura)
// ---------------------------------------------------------------------------

describe('simulateOnTransactions', () => {
  it('cuenta afectados y respeta manuales por defecto', async () => {
    const txs = [
      { ...newTx({ concept: 'MERCADONA 1' }), id: 'x1', profileId: A, statsFlag: 0 as const, createdAt: 0, updatedAt: 0 },
      { ...newTx({ concept: 'MERCADONA 2', categorizedBy: 'manual', categoryId: 'yo' }), id: 'x2', profileId: A, statsFlag: 0 as const, createdAt: 0, updatedAt: 0 },
      { ...newTx({ concept: 'LIDL' }), id: 'x3', profileId: A, statsFlag: 0 as const, createdAt: 0, updatedAt: 0 },
    ];
    const rules = [makeRule({ conditions: [cond({ value: 'MERCADONA' })], action: action({ setCategoryId: 'cat-A' }) })];
    const sim = simulateOnTransactions(rules, txs);
    expect(sim.changed).toBe(1); // solo MERCADONA 1 (el manual se respeta, LIDL no casa)
    expect(sim.skippedManual).toBe(1);
    const simOverride = simulateOnTransactions(rules, txs, { overrideManual: true });
    expect(simOverride.changed).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 8. Orquestacion CRUD + prioridad
// ---------------------------------------------------------------------------

describe('ruleService CRUD y prioridad', () => {
  it('create asigna prioridades incrementales y list ordena por prioridad', async () => {
    const r1 = await ruleService.create(A, ruleInput({ name: 'A' }));
    const r2 = await ruleService.create(A, ruleInput({ name: 'B' }));
    const r3 = await ruleService.create(A, ruleInput({ name: 'C' }));
    expect([r1.priority, r2.priority, r3.priority]).toEqual([0, 1, 2]);
    const list = await ruleService.list(A);
    expect(list.map((r) => r.name)).toEqual(['A', 'B', 'C']);
  });

  it('move reordena las prioridades', async () => {
    await ruleService.create(A, ruleInput({ name: 'A' }));
    const b = await ruleService.create(A, ruleInput({ name: 'B' }));
    await ruleService.create(A, ruleInput({ name: 'C' }));
    await ruleService.move(A, b.id, 'up');
    const list = await ruleService.list(A);
    expect(list.map((r) => r.name)).toEqual(['B', 'A', 'C']);
  });
});

// ---------------------------------------------------------------------------
// 9. Aplicacion retroactiva y auto-aplicacion
// ---------------------------------------------------------------------------

describe('aplicacion retroactiva', () => {
  it('aplica reglas activas y es idempotente en una segunda pasada', async () => {
    await ruleService.create(A, ruleInput({ conditions: [cond({ value: 'MERCADONA' })], action: action({ setCategoryId: 'cat-A' }) }));
    await transactionsRepo.createMany(A, [newTx({ concept: 'MERCADONA CENTRO' }), newTx({ concept: 'LIDL' })]);

    const sim = await ruleService.simulateAll(A);
    expect(sim.changed).toBe(1);

    const first = await ruleService.applyAllRetroactive(A);
    expect(first.changed).toBe(1);

    const affected = (await transactionsRepo.list(A)).find((t) => t.concept === 'MERCADONA CENTRO')!;
    expect(affected.categorizedBy).toBe('rule');
    expect(affected.categoryId).toBe('cat-A');
    expect(affected.ruleId).not.toBeNull();

    const second = await ruleService.applyAllRetroactive(A);
    expect(second.changed).toBe(0); // ya categorizado, no vuelve a cambiar
  });

  it('respeta la categorizacion manual salvo overrideManual', async () => {
    await ruleService.create(A, ruleInput({ conditions: [cond({ value: 'MERCADONA' })], action: action({ setCategoryId: 'cat-A' }) }));
    await transactionsRepo.createMany(A, [
      newTx({ concept: 'MERCADONA', categorizedBy: 'manual', categoryId: 'mia' }),
    ]);
    const noOverride = await ruleService.applyAllRetroactive(A);
    expect(noOverride.changed).toBe(0);
    const withOverride = await ruleService.applyAllRetroactive(A, { overrideManual: true });
    expect(withOverride.changed).toBe(1);
  });

  it('una regla de solo-exclusion marca excludedFromStats y sincroniza statsFlag', async () => {
    await ruleService.create(
      A,
      ruleInput({
        conditions: [cond({ value: 'MERCADONA' })],
        action: action({ setCategoryId: null, setExcludedFromStats: true }),
      }),
    );
    await transactionsRepo.createMany(A, [newTx({ concept: 'MERCADONA', excludedFromStats: false })]);
    const { changed } = await ruleService.applyAllRetroactive(A);
    expect(changed).toBe(1);
    const tx = (await transactionsRepo.list(A))[0];
    expect(tx.excludedFromStats).toBe(true);
    expect(tx.statsFlag).toBe(1);
    expect(tx.categorizedBy).toBe('rule');
  });

  it('la aplicacion retroactiva no toca transferencias ni padres de split', async () => {
    // Regla que casaria por concepto para cualquier tipo.
    await ruleService.create(
      A,
      ruleInput({ conditions: [cond({ value: 'MERCADONA' })], action: action({ setCategoryId: 'cat-A', setExcludedFromStats: false }) }),
    );
    await transactionsRepo.createMany(A, [
      newTx({ concept: 'MERCADONA TRANSFER', type: 'transfer', transferGroupId: 'g1', excludedFromStats: true }),
      newTx({ concept: 'MERCADONA PADRE', isSplitParent: true, excludedFromStats: true }),
    ]);
    const { changed } = await ruleService.applyAllRetroactive(A);
    expect(changed).toBe(0);
    const txs = await transactionsRepo.list(A);
    for (const tx of txs) {
      expect(tx.categorizedBy).toBe('none');
      expect(tx.ruleId).toBeNull();
      expect(tx.excludedFromStats).toBe(true); // no se les revierte la exclusion
    }
  });

  it('applyRulesToDraft no autocategoriza un borrador de transferencia', () => {
    const rules = [makeRule({ conditions: [cond({ value: 'MERCADONA' })], action: action({ setCategoryId: 'cat-A' }) })];
    const draft = newTx({ concept: 'MERCADONA', type: 'transfer', transferGroupId: 'g1', excludedFromStats: true });
    applyRulesToDraft(rules, draft);
    expect(draft.categorizedBy).toBe('none');
    expect(draft.categoryId).toBeNull();
    expect(draft.excludedFromStats).toBe(true);
  });

  it('applyToTransaction autocategoriza un movimiento nuevo no manual', async () => {
    await ruleService.create(A, ruleInput({ conditions: [cond({ value: 'MERCADONA' })], action: action({ setCategoryId: 'cat-A' }) }));
    const [tx] = await transactionsRepo.createMany(A, [newTx({ concept: 'MERCADONA' })]);
    const updated = await ruleService.applyToTransaction(A, tx!.id);
    expect(updated).not.toBeNull();
    expect(updated!.categorizedBy).toBe('rule');
    expect(updated!.categoryId).toBe('cat-A');
  });

  it('applyRulesToDraft autocategoriza un borrador importado (categorizedBy import->rule)', () => {
    const rules = [makeRule({ id: 'r1', conditions: [cond({ value: 'MERCADONA' })], action: action({ setCategoryId: 'cat-A' }) })];
    const draft = newTx({ concept: 'MERCADONA', categorizedBy: 'import' });
    applyRulesToDraft(rules, draft);
    expect(draft.categorizedBy).toBe('rule');
    expect(draft.categoryId).toBe('cat-A');
    expect(draft.ruleId).toBe('r1');
  });

  it('applyRulesToDraft respeta un borrador categorizado a mano', () => {
    const rules = [makeRule({ id: 'r1', conditions: [cond({ value: 'MERCADONA' })], action: action({ setCategoryId: 'cat-A' }) })];
    const draft = newTx({ concept: 'MERCADONA', categorizedBy: 'manual', categoryId: 'mia' });
    applyRulesToDraft(rules, draft);
    expect(draft.categorizedBy).toBe('manual');
    expect(draft.categoryId).toBe('mia');
  });

  it('applyToTransaction no toca un movimiento categorizado a mano', async () => {
    await ruleService.create(A, ruleInput({ conditions: [cond({ value: 'MERCADONA' })], action: action({ setCategoryId: 'cat-A' }) }));
    const [tx] = await transactionsRepo.createMany(A, [
      newTx({ concept: 'MERCADONA', categorizedBy: 'manual', categoryId: 'mia' }),
    ]);
    expect(await ruleService.applyToTransaction(A, tx!.id)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 10. Aislamiento por perfil
// ---------------------------------------------------------------------------

describe('aislamiento por perfil', () => {
  it('las reglas y la aplicacion de un perfil no afectan a otro', async () => {
    await ruleService.create(A, ruleInput({ conditions: [cond({ value: 'MERCADONA' })], action: action({ setCategoryId: 'cat-A' }) }));
    // Mismo concepto en ambos perfiles.
    await transactionsRepo.createMany(A, [newTx({ concept: 'MERCADONA' })]);
    await transactionsRepo.createMany(B, [newTx({ concept: 'MERCADONA' })]);

    // El perfil B no tiene reglas: su simulacion no afecta a nadie.
    expect((await ruleService.list(B)).length).toBe(0);
    const simB = await ruleService.simulateAll(B);
    expect(simB.changed).toBe(0);

    // Aplicar en A no toca los movimientos de B.
    await ruleService.applyAllRetroactive(A);
    const bTx = (await transactionsRepo.list(B))[0];
    expect(bTx.categorizedBy).toBe('none');
    expect(bTx.ruleId).toBeNull();
  });

  it('requireProfileId: rechaza operaciones sin perfil', async () => {
    // list valida de forma sincrona (no es async); simulateAll es async y rechaza.
    expect(() => ruleService.list('')).toThrow(ValidationError);
    await expect(ruleService.simulateAll('')).rejects.toThrow(ValidationError);
  });

  it('rulesRepo.listByPriority solo devuelve reglas del perfil', async () => {
    await ruleService.create(A, ruleInput({ name: 'de A' }));
    await ruleService.create(B, ruleInput({ name: 'de B' }));
    const listA = await rulesRepo.listByPriority(A);
    expect(listA.map((r) => r.name)).toEqual(['de A']);
  });
});
