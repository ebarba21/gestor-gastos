// Verifica un fichero de movimientos ya categorizado contra un backup real, con el importador
// de la app: restaura el backup, crea las cuentas que falten, importa las reglas (opcional) y
// previsualiza + importa el fichero. Informa de errores, duplicados y categorias creadas.
//
//   BACKUP=backup.json FICHERO=movs.xlsx [REGLAS=reglas.xlsx] [CUENTAS_NUEVAS="Revolut conjunta"] \
//     npx vitest run --config vitest.gen.config.ts scripts/verificarImportacion.gen.ts
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { backupService, parseBackup } from '../src/services/backupService';
import { importService } from '../src/services/importService';
import { guessRuleColumnMap, ruleColumnLabels, ruleImportService } from '../src/services/ruleImportService';
import { categoryService } from '../src/services/categoryService';
import { tagService } from '../src/services/tagService';
import { accountService } from '../src/services/accountService';
import { transactionService } from '../src/services/transactionService';

function fileFrom(path: string): File {
  return new File([readFileSync(path)], path.split('/').pop() ?? 'fichero.xlsx');
}

test('fichero categorizado importable', async () => {
  const backup = parseBackup(readFileSync(process.env.BACKUP ?? '', 'utf8'));
  const pid = (await backupService.restoreAsNewProfile(backup)).id;
  for (const name of (process.env.CUENTAS_NUEVAS ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    await accountService.createAccount(pid, { name, kind: 'bank', openingBalanceCents: 0 });
  }
  if (process.env.REGLAS) {
    const parsedRules = await importService.parseFile(fileFrom(process.env.REGLAS));
    const ctx = {
      categories: await categoryService.listAll(pid),
      tags: await tagService.listTags(pid),
      accounts: await accountService.listAll(pid),
    };
    const rp = ruleImportService.buildPreview(pid, parsedRules, { columnMap: guessRuleColumnMap(ruleColumnLabels(parsedRules, true)), hasHeaderRow: true }, ctx);
    await ruleImportService.commit(pid, rp);
  }
  const accounts = await accountService.listAll(pid);
  const parsed = await importService.parseFile(fileFrom(process.env.FICHERO ?? ''));
  const config = importService.suggestConfig(parsed, accounts[0]!.id);
  console.log('mapeo', JSON.stringify(config.columnMap), config.dateFormat, config.decimalSeparator);
  const preview = await importService.buildPreview(pid, parsed, config, accounts);
  for (const r of preview.rows.filter((r) => r.status !== 'ok')) {
    console.log(r.status, r.rowIndex + 2, r.displayConcept, r.displayAmountCents, r.errors.join(' '), r.duplicateReasonCodes.join(','));
  }
  console.log('resumen', JSON.stringify(preview.summary), 'categorias nuevas:', JSON.stringify(preview.categoriesToCreate));
  expect(preview.summary.errors).toBe(0);
  const before = (await transactionService.list(pid)).length;
  // Se importan tambien las filas marcadas como posible duplicado (se revisan arriba).
  for (const r of preview.rows) if (r.transaction) r.include = true;
  const res = await importService.commit(pid, { parsed, preview, templateId: null });
  const after = await transactionService.list(pid);
  const cats = await categoryService.listAll(pid);
  const name = (id: string | null) => cats.find((c) => c.id === id)?.name ?? '-';
  const fresh = after.filter((t) => t.importBatchId === res.batch.id);
  const sinCategoria = fresh.filter((t) => t.categoryId === null);
  const porRegla = fresh.filter((t) => t.categorizedBy === 'rule');
  console.log('importados', res.imported, 'antes', before, 'despues', after.length, 'sin categoria', sinCategoria.length, 'por regla', porRegla.length);
  for (const t of porRegla) console.log('  regla:', t.concept, '->', name(t.categoryId), name(t.subcategoryId));
  const saldo = new Map<string, number>();
  for (const t of after) if (t.parentId === null) saldo.set(t.accountId, (saldo.get(t.accountId) ?? 0) + t.amountCents);
  for (const a of await accountService.listAll(pid)) console.log('saldo', a.name, ((saldo.get(a.id) ?? 0) / 100).toFixed(2));
});
