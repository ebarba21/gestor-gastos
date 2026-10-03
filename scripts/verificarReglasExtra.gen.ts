// Comprueba un fichero de reglas ADICIONAL (importado con prioridad) sobre el perfil completo:
// historico + reglas base + movimientos nuevos. Mide el acierto de TODAS las reglas sobre el
// historico y sobre los movimientos nuevos, antes y despues de anadir las reglas extra.
//   BACKUP=... REGLAS=base.xlsx REGLAS_EXTRA=extra.xlsx FICHERO=movs.xlsx CUENTAS_NUEVAS="Revolut conjunta" \
//     npx vitest run --config vitest.gen.config.ts scripts/verificarReglasExtra.gen.ts
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
import type { Transaction } from '../src/db/schema';

const fileFrom = (p: string) => new File([readFileSync(p)], p.split('/').pop() ?? 'f.xlsx');

async function importRules(pid: string, path: string, placeFirst: boolean) {
  const parsed = await importService.parseFile(fileFrom(path));
  const ctx = { categories: await categoryService.listAll(pid), tags: await tagService.listTags(pid), accounts: await accountService.listAll(pid) };
  const p = ruleImportService.buildPreview(pid, parsed, { columnMap: guessRuleColumnMap(ruleColumnLabels(parsed, true)), hasHeaderRow: true }, ctx);
  const errs = p.rows.filter((r) => r.status === 'error');
  for (const e of errs) console.log('ERROR regla fila', e.rowIndex + 2, e.errors.join(' '));
  expect(errs).toHaveLength(0);
  return ruleImportService.commit(pid, p, { placeFirst });
}

async function score(pid: string, txs: Transaction[], label: string) {
  const rules = await ruleService.list(pid);
  const cats = await categoryService.listAll(pid);
  const nm = (id: string | null) => cats.find((c) => c.id === id)?.name ?? '-';
  let labeled = 0, covered = 0, same = 0;
  const wrong: string[] = [];
  for (const t of txs) {
    if (t.categoryId === null) continue;
    labeled += 1;
    const r = evaluateRules(rules, { concept: t.concept, amountCents: t.amountCents, date: t.date, accountId: t.accountId, type: t.type, merchantId: null });
    if (!r.matched || r.setCategoryId === null) continue;
    covered += 1;
    if (r.setCategoryId === t.categoryId && (r.setSubcategoryId === null || r.setSubcategoryId === t.subcategoryId)) same += 1;
    else wrong.push(`${t.concept} | real ${nm(t.categoryId)}/${nm(t.subcategoryId)} | regla ${nm(r.setCategoryId)}/${nm(r.setSubcategoryId)}`);
  }
  console.log(label, JSON.stringify({ conCategoria: labeled, cubiertos: covered, aciertos: same }));
  return wrong;
}

test('reglas extra', async () => {
  const pid = (await backupService.restoreAsNewProfile(parseBackup(readFileSync(process.env.BACKUP ?? '', 'utf8')))).id;
  for (const name of (process.env.CUENTAS_NUEVAS ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    await accountService.createAccount(pid, { name, kind: 'bank', openingBalanceCents: 0 });
  }
  await importRules(pid, process.env.REGLAS ?? '', false);
  const accounts = await accountService.listAll(pid);
  const parsed = await importService.parseFile(fileFrom(process.env.FICHERO ?? ''));
  const preview = await importService.buildPreview(pid, parsed, importService.suggestConfig(parsed, accounts[0]!.id), accounts);
  for (const r of preview.rows) if (r.transaction) r.include = true;
  const { batch } = await importService.commit(pid, { parsed, preview, templateId: null });
  const all = await transactionService.list(pid);
  const nuevos = all.filter((t) => t.importBatchId === batch.id);
  const historico = all.filter((t) => t.importBatchId !== batch.id);

  await score(pid, historico, 'ANTES  historico');
  await score(pid, nuevos, 'ANTES  nuevos   ');
  const { created } = await importRules(pid, process.env.REGLAS_EXTRA ?? '', true);
  console.log('reglas extra importadas:', created);
  const wh = await score(pid, historico, 'DESPUES historico');
  const wn = await score(pid, nuevos, 'DESPUES nuevos   ');
  console.log('--- fallos en nuevos ---'); for (const w of wn) console.log('  ', w);
  console.log('--- fallos en historico (primeros 25) ---'); for (const w of wh.slice(0, 25)) console.log('  ', w);
});
