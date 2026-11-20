// La hoja "Reglas reimportables" se puede volver a importar con la importacion de reglas.
import { describe, it, expect } from 'vitest';
import type { Rule } from '../db/schema';
import { makeCategory } from '../test/txFixtures';
import { exportService } from './exportService';
import { guessRuleColumnMap, ruleImportService } from './ruleImportService';
import type { ParsedFile } from './importService';

const categories = [
  makeCategory({ id: 'coche', name: 'Coche' }),
  makeCategory({ id: 'gasolina', name: 'Gasolina', parentId: 'coche' }),
  makeCategory({ id: 'loteria', name: 'Loteria' }),
];

function rule(overrides: Partial<Rule>): Rule {
  return {
    id: crypto.randomUUID(),
    profileId: 'perfil-a',
    name: 'Regla',
    enabled: true,
    priority: 0,
    matchMode: 'all',
    conditions: [{ field: 'concept', operator: 'contains', value: 'bonarea', value2: null, caseSensitive: false }],
    action: { setCategoryId: 'coche', setSubcategoryId: 'gasolina', addTagIds: [], setExcludedFromStats: null },
    stopOnMatch: true,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe('exportar e importar reglas', () => {
  it('la hoja reimportable reconstruye las reglas de concepto', () => {
    const rules = [
      rule({ name: 'bonArea' }),
      rule({
        name: 'TuLotero',
        conditions: [{ field: 'concept', operator: 'startsWith', value: 'tulotero', value2: null, caseSensitive: false }],
        action: { setCategoryId: 'loteria', setSubcategoryId: null, addTagIds: [], setExcludedFromStats: null },
      }),
      rule({
        name: 'Grandes',
        conditions: [{ field: 'amount', operator: 'gt', value: 100000, value2: null, caseSensitive: false }],
      }),
    ];
    const names = {
      categoryNames: new Map(categories.map((c) => [c.id, c.name])),
      tagNames: new Map<string, string>(),
      accountNames: new Map<string, string>(),
      merchantNames: new Map<string, string>(),
    };
    const sheet = exportService.buildImportableRulesSheet(rules, names as never);
    expect(sheet.rows).toHaveLength(3); // cabecera + 2 reglas de concepto
    const parsed = { fileName: 'reglas.xlsx', sourceFormat: 'xlsx', rows: sheet.rows, columnCount: 12 } as unknown as ParsedFile;
    const columnMap = guessRuleColumnMap(sheet.rows[0]!.map(String));
    const preview = ruleImportService.buildPreview('perfil-a', parsed, { columnMap, hasHeaderRow: true }, {
      categories,
      tags: [],
      accounts: [],
    });
    expect(preview.summary).toEqual({ total: 2, ok: 2, errors: 0 });
    const [first, second] = preview.rows.map((r) => r.rule!);
    expect(first!.conditions[0]).toMatchObject({ field: 'concept', operator: 'contains', value: 'bonarea' });
    expect(first!.action).toMatchObject({ setCategoryId: 'coche', setSubcategoryId: 'gasolina' });
    expect(second!.conditions[0]).toMatchObject({ operator: 'startsWith', value: 'tulotero' });
  });
});
