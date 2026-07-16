import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db';
import type { Account, Category, Tag } from '../db/schema';
import type { ParsedFile } from './importService';
import type { CellValue } from '../lib/csvXlsx';
import {
  ruleImportService,
  emptyRuleColumnMap,
  type RuleImportColumnMap,
  type RuleImportContext,
} from './ruleImportService';
import { rulesRepo } from '../db/rulesRepo';

const A = 'perfil-a';

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  localStorage.clear();
});

function cat(over: Partial<Category>): Category {
  return {
    id: over.id ?? crypto.randomUUID(),
    profileId: A,
    name: over.name ?? 'Cat',
    parentId: over.parentId ?? null,
    kind: over.kind ?? 'expense',
    color: null,
    icon: null,
    archivedAt: null,
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
  };
}
function tag(over: Partial<Tag>): Tag {
  return { id: over.id ?? crypto.randomUUID(), profileId: A, name: over.name ?? 'tag', color: null, createdAt: 0, updatedAt: 0 };
}
function acc(over: Partial<Account>): Account {
  return {
    id: over.id ?? crypto.randomUUID(),
    profileId: A,
    name: over.name ?? 'Cuenta',
    kind: 'bank',
    currency: 'EUR',
    color: null,
    openingBalanceCents: 0,
    archivedAt: null,
    createdAt: 0,
    updatedAt: 0,
  };
}

const alimentacion = cat({ id: 'cat-ali', name: 'Alimentacion' });
const supermercado = cat({ id: 'cat-super', name: 'Supermercado', parentId: 'cat-ali' });
const tagFijo = tag({ id: 'tag-fijo', name: 'Fijo' });
const cuentaBanco = acc({ id: 'acc-banco', name: 'Banco Principal' });

const context: RuleImportContext = {
  categories: [alimentacion, supermercado],
  tags: [tagFijo],
  accounts: [cuentaBanco],
};

function parsed(rows: CellValue[][]): ParsedFile {
  const columnCount = rows.reduce((m, r) => Math.max(m, r.length), 0);
  return {
    fileName: 'reglas.csv',
    sourceFormat: 'csv',
    rows,
    columnCount,
    sourceFileHash: 'hash-reglas',
    sourceFileSize: 0,
  };
}

function mapWith(over: Partial<RuleImportColumnMap>): RuleImportColumnMap {
  return { ...emptyRuleColumnMap(), ...over };
}

describe('ruleImportService.buildPreview', () => {
  it('construye una regla de concepto->categoria por defecto', () => {
    const file = parsed([
      ['valor', 'categoria'],
      ['MERCADONA', 'Alimentacion'],
    ]);
    const preview = ruleImportService.buildPreview(
      A,
      file,
      { columnMap: mapWith({ value: 0, category: 1 }), hasHeaderRow: true },
      context,
    );
    expect(preview.summary.ok).toBe(1);
    const rule = preview.rows[0].rule!;
    expect(rule.conditions[0].field).toBe('concept');
    expect(rule.conditions[0].operator).toBe('contains');
    expect(rule.conditions[0].value).toBe('MERCADONA');
    expect(rule.action.setCategoryId).toBe('cat-ali');
  });

  it('resuelve subcategoria y etiquetas por nombre', () => {
    const file = parsed([
      ['MERCADONA', 'Alimentacion', 'Supermercado', 'Fijo'],
    ]);
    const preview = ruleImportService.buildPreview(
      A,
      file,
      { columnMap: mapWith({ value: 0, category: 1, subcategory: 2, tags: 3 }), hasHeaderRow: false },
      context,
    );
    const rule = preview.rows[0].rule!;
    expect(rule.action.setSubcategoryId).toBe('cat-super');
    expect(rule.action.addTagIds).toEqual(['tag-fijo']);
  });

  it('parsea condicion de importe en euros a centimos', () => {
    const file = parsed([
      ['50', 'Alimentacion', 'importe', 'mayor'],
    ]);
    const preview = ruleImportService.buildPreview(
      A,
      file,
      { columnMap: mapWith({ value: 0, category: 1, field: 2, operator: 3 }), hasHeaderRow: false },
      context,
    );
    const rule = preview.rows[0].rule!;
    expect(rule.conditions[0].field).toBe('amount');
    expect(rule.conditions[0].operator).toBe('gt');
    expect(rule.conditions[0].value).toBe(5000);
  });

  it('resuelve cuenta por nombre en condicion de cuenta', () => {
    const file = parsed([['Banco Principal', 'Alimentacion', 'cuenta']]);
    const preview = ruleImportService.buildPreview(
      A,
      file,
      { columnMap: mapWith({ value: 0, category: 1, field: 2 }), hasHeaderRow: false },
      context,
    );
    const rule = preview.rows[0].rule!;
    expect(rule.conditions[0].field).toBe('account');
    expect(rule.conditions[0].value).toBe('acc-banco');
  });

  it('marca error si la categoria no existe (sin errores silenciosos)', () => {
    const file = parsed([['MERCADONA', 'Inexistente']]);
    const preview = ruleImportService.buildPreview(
      A,
      file,
      { columnMap: mapWith({ value: 0, category: 1 }), hasHeaderRow: false },
      context,
    );
    expect(preview.rows[0].status).toBe('error');
    expect(preview.rows[0].rule).toBeNull();
    expect(preview.rows[0].errors.join(' ')).toMatch(/Categoria no encontrada/);
  });

  it('marca error si una etiqueta no existe', () => {
    const file = parsed([['MERCADONA', 'Alimentacion', 'NoExiste']]);
    const preview = ruleImportService.buildPreview(
      A,
      file,
      { columnMap: mapWith({ value: 0, category: 1, tags: 2 }), hasHeaderRow: false },
      context,
    );
    expect(preview.rows[0].status).toBe('error');
    expect(preview.rows[0].errors.join(' ')).toMatch(/Etiquetas no encontradas/);
  });
});

describe('ruleImportService aislamiento', () => {
  it('rechaza un contexto con entidades de otro perfil (defensa en profundidad)', () => {
    const foreign: RuleImportContext = {
      categories: [{ ...alimentacion, profileId: 'otro' }],
      tags: [],
      accounts: [],
    };
    const file = parsed([['MERCADONA', 'Alimentacion']]);
    expect(() =>
      ruleImportService.buildPreview(
        A,
        file,
        { columnMap: mapWith({ value: 0, category: 1 }), hasHeaderRow: false },
        foreign,
      ),
    ).toThrow(/otro perfil/);
  });
});

describe('ruleImportService.commit', () => {
  it('crea solo las reglas incluidas y validas, en orden', async () => {
    const file = parsed([
      ['MERCADONA', 'Alimentacion'],
      ['SUELDO', 'Inexistente'], // error: no se crea
      ['LIDL', 'Alimentacion'],
    ]);
    const preview = ruleImportService.buildPreview(
      A,
      file,
      { columnMap: mapWith({ value: 0, category: 1 }), hasHeaderRow: false },
      context,
    );
    const { created } = await ruleImportService.commit(A, preview);
    expect(created).toBe(2);
    const rules = await rulesRepo.listByPriority(A);
    expect(rules.map((r) => r.conditions[0].value)).toEqual(['MERCADONA', 'LIDL']);
    expect(rules.map((r) => r.priority)).toEqual([0, 1]);
  });

  it('configProblems exige valor y categoria/etiquetas', () => {
    const problems = ruleImportService.configProblems(
      { columnMap: emptyRuleColumnMap(), hasHeaderRow: true },
      3,
    );
    expect(problems.length).toBeGreaterThan(0);
  });
});
