// Verifica un fichero de reglas contra un backup real usando el codigo de la app: restaura el
// backup, importa las reglas con el importador de Reglas (autodeteccion de columnas incluida) y
// mide cuantos movimientos del historico categorizarian igual que estaban.
//
//   BACKUP=backup.json REGLAS=reglas.xlsx npx vitest run --config vitest.gen.config.ts scripts/verificarReglas.gen.ts
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { backupService, parseBackup } from '../src/services/backupService';
import { importService } from '../src/services/importService';
import { guessRuleColumnMap, ruleColumnLabels, ruleImportService } from '../src/services/ruleImportService';
import { ruleService, evaluateRules } from '../src/services/ruleService';
import { categoryService } from '../src/services/categoryService';
import { tagService } from '../src/services/tagService';
import { accountService } from '../src/services/accountService';
import { transactionService } from '../src/services/transactionService';

test('reglas importables y precision sobre el historico', async () => {
  const backup = parseBackup(readFileSync(process.env.BACKUP ?? '', 'utf8'));
  const profile = await backupService.restoreAsNewProfile(backup);
  const pid = profile.id;

  const bytes = readFileSync(process.env.REGLAS ?? '');
  const file = new File([bytes], 'reglas.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const parsed = await importService.parseFile(file);
  const columnMap = guessRuleColumnMap(ruleColumnLabels(parsed, true));
  const context = {
    categories: await categoryService.listAll(pid),
    tags: await tagService.listTags(pid),
    accounts: await accountService.listAll(pid),
  };
  const preview = ruleImportService.buildPreview(pid, parsed, { columnMap, hasHeaderRow: true }, context);
  const errors = preview.rows.filter((r) => r.status === 'error');
  for (const e of errors.slice(0, 10)) console.log('ERROR fila', e.rowIndex, e.errors.join(' '));
  expect(errors).toHaveLength(0);
  const { created } = await ruleImportService.commit(pid, preview);

  const rules = await ruleService.list(pid);
  const txs = await transactionService.list(pid);
  let labeled = 0, covered = 0, exact = 0, sameCategory = 0;
  for (const t of txs) {
    if (t.categoryId === null) continue;
    labeled += 1;
    const r = evaluateRules(rules, { concept: t.rawConcept || t.concept, amountCents: t.amountCents, date: t.date, accountId: t.accountId, type: t.type, merchantId: null });
    if (!r.matched || r.setCategoryId === null) continue;
    covered += 1;
    if (r.setCategoryId === t.categoryId) {
      sameCategory += 1;
      if (r.setSubcategoryId === null || r.setSubcategoryId === t.subcategoryId) exact += 1;
    }
  }
  console.log(JSON.stringify({ reglas: created, conCategoria: labeled, cubiertos: covered, mismaCategoria: sameCategory, exactos: exact }));
  expect(created).toBe(preview.rows.length);
});
