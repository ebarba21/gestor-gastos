import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db/index';
import { accountsRepo } from '../db/accountsRepo';
import { transactionsRepo } from '../db/transactionsRepo';
import { importService, type ParsedFile } from './importService';
import { parseCsv } from '../lib/csvXlsx';
import type { Account } from '../db/schema';
import { NotFoundError, ValidationError } from '../lib/validation';

const PROFILE_A = 'profile-a';
const PROFILE_B = 'profile-b';

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

async function makeAccount(profileId: string, name = 'Banco'): Promise<Account> {
  return accountsRepo.create(profileId, {
    name,
    kind: 'bank',
    currency: 'EUR',
    color: null,
    openingBalanceCents: 0,
    archivedAt: null,
  });
}

function parsedFromCsv(csv: string, fileName = 'extracto.csv'): ParsedFile {
  const rows = parseCsv(csv);
  const columnCount = rows.reduce((max, r) => Math.max(max, r.length), 0);
  return { fileName, sourceFormat: 'csv', rows, columnCount };
}

const SAMPLE_CSV = [
  'Fecha;Concepto;Importe',
  '15/01/2026;COMPRA MERCADONA;-12,34',
  '16/01/2026;NOMINA EMPRESA;1.500,00',
  '17/01/2026;RECIBO LUZ;-45,67',
].join('\n');

describe('importService.suggestConfig', () => {
  it('detecta cabecera, estrategia con signo y formato espanol', async () => {
    const acc = await makeAccount(PROFILE_A);
    const parsed = parsedFromCsv(SAMPLE_CSV);
    const config = importService.suggestConfig(parsed, acc.id);
    expect(config.hasHeaderRow).toBe(true);
    expect(config.amountStrategy).toBe('signed');
    expect(config.columnMap.date).toBe(0);
    expect(config.columnMap.concept).toBe(1);
    expect(config.columnMap.amount).toBe(2);
    expect(config.decimalSeparator).toBe(',');
    expect(config.dateFormat).toBe('dd/MM/yyyy');
    expect(importService.configProblems(config, parsed.columnCount)).toEqual([]);
  });
});

describe('importService.buildPreview', () => {
  it('parsea filas correctas y respeta el signo por tipo', async () => {
    const acc = await makeAccount(PROFILE_A);
    const parsed = parsedFromCsv(SAMPLE_CSV);
    const config = importService.suggestConfig(parsed, acc.id);
    const preview = await importService.buildPreview(PROFILE_A, parsed, config, [acc]);

    expect(preview.summary.total).toBe(3);
    expect(preview.summary.ok).toBe(3);
    expect(preview.summary.errors).toBe(0);

    const [r1, r2] = preview.rows;
    expect(r1!.transaction!.amountCents).toBe(-1234);
    expect(r1!.transaction!.type).toBe('expense');
    expect(r1!.transaction!.categorizedBy).toBe('import');
    expect(r1!.transaction!.accountId).toBe(acc.id);
    expect(r2!.transaction!.amountCents).toBe(150000);
    expect(r2!.transaction!.type).toBe('income');
  });

  it('senala errores de parseo fila a fila sin abortar el resto', async () => {
    const acc = await makeAccount(PROFILE_A);
    const csv = [
      'Fecha;Concepto;Importe',
      '15/01/2026;COMPRA;-12,34',
      'no-fecha;SIN FECHA;-1,00',
      '17/01/2026;;-5,00',
      '18/01/2026;IMPORTE MALO;abc',
    ].join('\n');
    const parsed = parsedFromCsv(csv);
    const config = importService.suggestConfig(parsed, acc.id);
    const preview = await importService.buildPreview(PROFILE_A, parsed, config, [acc]);

    expect(preview.summary.ok).toBe(1);
    expect(preview.summary.errors).toBe(3);
    expect(preview.rows[1]!.errors[0]).toMatch(/fecha/i);
    expect(preview.rows[2]!.errors[0]).toMatch(/concepto/i);
    expect(preview.rows[3]!.errors[0]).toMatch(/importe/i);
    // Las filas con error no se seleccionan para importar.
    expect(preview.rows[1]!.include).toBe(false);
  });

  it('soporta columnas separadas de cargo y abono', async () => {
    const acc = await makeAccount(PROFILE_A);
    const csv = [
      'Fecha;Concepto;Cargo;Abono',
      '15/01/2026;COMPRA;12,34;',
      '16/01/2026;NOMINA;;1.500,00',
    ].join('\n');
    const parsed = parsedFromCsv(csv);
    const config = importService.suggestConfig(parsed, acc.id);
    expect(config.amountStrategy).toBe('debitCredit');
    const preview = await importService.buildPreview(PROFILE_A, parsed, config, [acc]);
    expect(preview.rows[0]!.transaction!.amountCents).toBe(-1234);
    expect(preview.rows[1]!.transaction!.amountCents).toBe(150000);
  });

  it('marca error (no crea movimiento) cuando el importe es cero', async () => {
    const acc = await makeAccount(PROFILE_A);
    const csv = ['Fecha;Concepto;Importe', '15/01/2026;AJUSTE;0,00'].join('\n');
    const parsed = parsedFromCsv(csv);
    const config = importService.suggestConfig(parsed, acc.id);
    const preview = await importService.buildPreview(PROFILE_A, parsed, config, [acc]);
    expect(preview.rows[0]!.status).toBe('error');
    expect(preview.rows[0]!.transaction).toBeNull();
    expect(preview.rows[0]!.errors[0]).toMatch(/cero/i);
  });

  it('rechaza previsualizar con cuentas de otro perfil (barrera de aislamiento)', async () => {
    const accA = await makeAccount(PROFILE_A);
    const accForeign = await makeAccount(PROFILE_B);
    const parsed = parsedFromCsv(SAMPLE_CSV);
    const config = importService.suggestConfig(parsed, accA.id);
    // Se cuela una cuenta de otro perfil en el array: debe rechazarse.
    await expect(
      importService.buildPreview(PROFILE_A, parsed, config, [accA, accForeign]),
    ).rejects.toThrow(ValidationError);
  });

  it('rechaza previsualizar sin cuenta destino', async () => {
    const acc = await makeAccount(PROFILE_A);
    const parsed = parsedFromCsv(SAMPLE_CSV);
    const config = importService.suggestConfig(parsed, null);
    await expect(importService.buildPreview(PROFILE_A, parsed, config, [acc])).rejects.toThrow(
      ValidationError,
    );
  });
});

describe('deteccion de duplicados', () => {
  it('marca como duplicado lo ya existente en el perfil al reimportar', async () => {
    const acc = await makeAccount(PROFILE_A);
    const parsed = parsedFromCsv(SAMPLE_CSV);
    const config = importService.suggestConfig(parsed, acc.id);

    const preview1 = await importService.buildPreview(PROFILE_A, parsed, config, [acc]);
    await importService.commit(PROFILE_A, { parsed, preview: preview1, templateId: null });

    // Segundo intento del mismo fichero: todas las filas son duplicados.
    const preview2 = await importService.buildPreview(PROFILE_A, parsed, config, [acc]);
    expect(preview2.summary.duplicates).toBe(3);
    expect(preview2.rows.every((r) => r.duplicate && r.duplicateOf === 'existing')).toBe(true);
    expect(preview2.rows.every((r) => r.include === false)).toBe(true);
  });

  it('detecta duplicados internos del propio fichero', async () => {
    const acc = await makeAccount(PROFILE_A);
    const csv = [
      'Fecha;Concepto;Importe',
      '15/01/2026;COMPRA MERCADONA;-12,34',
      '15/01/2026;COMPRA MERCADONA;-12,34',
    ].join('\n');
    const parsed = parsedFromCsv(csv);
    const config = importService.suggestConfig(parsed, acc.id);
    const preview = await importService.buildPreview(PROFILE_A, parsed, config, [acc]);
    expect(preview.rows[0]!.duplicate).toBe(false);
    expect(preview.rows[1]!.duplicate).toBe(true);
    expect(preview.rows[1]!.duplicateOf).toBe('batch');
  });

  it('el usuario puede reactivar un duplicado para importarlo igualmente', async () => {
    const acc = await makeAccount(PROFILE_A);
    const parsed = parsedFromCsv(SAMPLE_CSV);
    const config = importService.suggestConfig(parsed, acc.id);
    const preview1 = await importService.buildPreview(PROFILE_A, parsed, config, [acc]);
    await importService.commit(PROFILE_A, { parsed, preview: preview1, templateId: null });

    const preview2 = await importService.buildPreview(PROFILE_A, parsed, config, [acc]);
    // Reactivar una fila duplicada.
    preview2.rows[0]!.include = true;
    const { imported } = await importService.commit(PROFILE_A, {
      parsed,
      preview: preview2,
      templateId: null,
    });
    expect(imported).toBe(1);
  });
});

describe('commit y atomicidad', () => {
  it('crea el lote y los movimientos con importBatchId', async () => {
    const acc = await makeAccount(PROFILE_A);
    const parsed = parsedFromCsv(SAMPLE_CSV);
    const config = importService.suggestConfig(parsed, acc.id);
    const preview = await importService.buildPreview(PROFILE_A, parsed, config, [acc]);
    const { batch, imported } = await importService.commit(PROFILE_A, {
      parsed,
      preview,
      templateId: null,
    });

    expect(imported).toBe(3);
    expect(batch.rowsImported).toBe(3);
    expect(batch.rowsTotal).toBe(3);
    expect(batch.status).toBe('committed');

    const txs = await transactionsRepo.list(PROFILE_A);
    expect(txs).toHaveLength(3);
    expect(txs.every((t) => t.importBatchId === batch.id)).toBe(true);
    expect(txs.every((t) => t.categorizedBy === 'import')).toBe(true);
    expect(txs.every((t) => t.statsFlag === 0)).toBe(true);
  });

  it('es atomico: si una fila incluida es invalida, no escribe nada', async () => {
    const acc = await makeAccount(PROFILE_A);
    const parsed = parsedFromCsv(SAMPLE_CSV);
    const config = importService.suggestConfig(parsed, acc.id);
    const preview = await importService.buildPreview(PROFILE_A, parsed, config, [acc]);
    // Corrompe una fila incluida: gasto con importe positivo (viola la integridad).
    preview.rows[0]!.transaction!.amountCents = 999;
    preview.rows[0]!.transaction!.type = 'expense';

    await expect(
      importService.commit(PROFILE_A, { parsed, preview, templateId: null }),
    ).rejects.toThrow();

    // Rollback completo: ni movimientos ni lote.
    expect(await transactionsRepo.count(PROFILE_A)).toBe(0);
    expect(await importService.listBatches(PROFILE_A)).toHaveLength(0);
  });

  it('no importa si no hay ninguna fila seleccionada', async () => {
    const acc = await makeAccount(PROFILE_A);
    const parsed = parsedFromCsv(SAMPLE_CSV);
    const config = importService.suggestConfig(parsed, acc.id);
    const preview = await importService.buildPreview(PROFILE_A, parsed, config, [acc]);
    preview.rows.forEach((r) => (r.include = false));
    await expect(
      importService.commit(PROFILE_A, { parsed, preview, templateId: null }),
    ).rejects.toThrow(ValidationError);
  });
});

describe('deshacer un lote', () => {
  it('borra los movimientos del lote y lo marca como deshecho', async () => {
    const acc = await makeAccount(PROFILE_A);
    const parsed = parsedFromCsv(SAMPLE_CSV);
    const config = importService.suggestConfig(parsed, acc.id);
    const preview = await importService.buildPreview(PROFILE_A, parsed, config, [acc]);
    const { batch } = await importService.commit(PROFILE_A, {
      parsed,
      preview,
      templateId: null,
    });

    const removed = await importService.undo(PROFILE_A, batch.id);
    expect(removed).toBe(3);
    expect(await transactionsRepo.count(PROFILE_A)).toBe(0);
    const batches = await importService.listBatches(PROFILE_A);
    expect(batches[0]!.status).toBe('undone');
  });
});

describe('aislamiento por perfil', () => {
  it('los duplicados no cruzan perfiles', async () => {
    const accA = await makeAccount(PROFILE_A);
    const accB = await makeAccount(PROFILE_B);
    const parsed = parsedFromCsv(SAMPLE_CSV);

    const configA = importService.suggestConfig(parsed, accA.id);
    const previewA = await importService.buildPreview(PROFILE_A, parsed, configA, [accA]);
    await importService.commit(PROFILE_A, { parsed, preview: previewA, templateId: null });

    // El perfil B, con las mismas filas, no ve duplicados de A.
    const configB = importService.suggestConfig(parsed, accB.id);
    const previewB = await importService.buildPreview(PROFILE_B, parsed, configB, [accB]);
    expect(previewB.summary.duplicates).toBe(0);
  });

  it('no se puede deshacer un lote de otro perfil', async () => {
    const accA = await makeAccount(PROFILE_A);
    const parsed = parsedFromCsv(SAMPLE_CSV);
    const configA = importService.suggestConfig(parsed, accA.id);
    const previewA = await importService.buildPreview(PROFILE_A, parsed, configA, [accA]);
    const { batch } = await importService.commit(PROFILE_A, {
      parsed,
      preview: previewA,
      templateId: null,
    });

    await expect(importService.undo(PROFILE_B, batch.id)).rejects.toThrow(NotFoundError);
    // El lote de A sigue intacto.
    expect(await transactionsRepo.count(PROFILE_A)).toBe(3);
  });

  it('buildPreview rechaza una cuenta destino de otro perfil', async () => {
    const accA = await makeAccount(PROFILE_A);
    const accB = await makeAccount(PROFILE_B);
    const parsed = parsedFromCsv(SAMPLE_CSV);
    const config = importService.suggestConfig(parsed, accB.id);
    // Perfil A intenta usar la cuenta de B: se rechaza (solo se pasan las cuentas de A).
    await expect(
      importService.buildPreview(PROFILE_A, parsed, config, [accA]),
    ).rejects.toThrow(ValidationError);
  });
});

describe('plantillas de importacion', () => {
  it('guarda, aplica y borra una plantilla (round trip)', async () => {
    const acc = await makeAccount(PROFILE_A);
    const parsed = parsedFromCsv(SAMPLE_CSV);
    const config = importService.suggestConfig(parsed, acc.id);

    const tpl = await importService.saveTemplate(PROFILE_A, 'Banco X', 'csv', config);
    expect(tpl.name).toBe('Banco X');

    const templates = await importService.listTemplates(PROFILE_A);
    expect(templates).toHaveLength(1);

    const restored = importService.templateToConfig(tpl);
    expect(restored.columnMap).toEqual(config.columnMap);
    expect(restored.decimalSeparator).toBe(config.decimalSeparator);
    expect(restored.amountStrategy).toBe(config.amountStrategy);

    // La plantilla aplicada produce la misma previsualizacion.
    const preview = await importService.buildPreview(PROFILE_A, parsed, restored, [acc]);
    expect(preview.summary.ok).toBe(3);

    await importService.deleteTemplate(PROFILE_A, tpl.id);
    expect(await importService.listTemplates(PROFILE_A)).toHaveLength(0);
  });

  it('rechaza plantillas con nombre duplicado en el perfil', async () => {
    const acc = await makeAccount(PROFILE_A);
    const parsed = parsedFromCsv(SAMPLE_CSV);
    const config = importService.suggestConfig(parsed, acc.id);
    await importService.saveTemplate(PROFILE_A, 'Banco X', 'csv', config);
    await expect(
      importService.saveTemplate(PROFILE_A, 'Banco X', 'csv', config),
    ).rejects.toThrow(ValidationError);
  });

  it('las plantillas estan aisladas por perfil', async () => {
    const accA = await makeAccount(PROFILE_A);
    const parsed = parsedFromCsv(SAMPLE_CSV);
    const config = importService.suggestConfig(parsed, accA.id);
    await importService.saveTemplate(PROFILE_A, 'Banco X', 'csv', config);
    expect(await importService.listTemplates(PROFILE_B)).toHaveLength(0);
  });
});
