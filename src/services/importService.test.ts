import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db/index';
import { accountsRepo } from '../db/accountsRepo';
import { transactionsRepo } from '../db/transactionsRepo';
import { noDuplicateDecisionsRepo } from '../db/noDuplicateDecisionsRepo';
import { importService, type ParsedFile } from './importService';
import { merchantService } from './merchantService';
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

let fileHashCounter = 0;
function parsedFromCsv(csv: string, fileName = 'extracto.csv'): ParsedFile {
  const rows = parseCsv(csv);
  const columnCount = rows.reduce((max, r) => Math.max(max, r.length), 0);
  fileHashCounter += 1;
  return {
    fileName,
    sourceFormat: 'csv',
    rows,
    columnCount,
    sourceFileHash: `hash-${fileHashCounter}`,
    sourceFileSize: csv.length,
  };
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
    expect(preview2.rows.every((r) => r.duplicateStatus === 'exact')).toBe(true);
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
    expect(preview.rows[0]!.duplicateStatus).toBe('unique');
    expect(preview.rows[1]!.duplicateStatus).toBe('exact');
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

// --- Fase 5: motor avanzado de duplicados (metadatos bancarios, decisiones, archivo repetido) ---

const BANKTX_CSV_HEADER = 'Fecha;Concepto;Importe;ID Operacion;Pendiente;Referencia bancaria';

function bankTxRow(
  date: string,
  concept: string,
  amount: string,
  bankId: string,
  pending: string,
  reference: string,
): string {
  return [date, concept, amount, bankId, pending, reference].join(';');
}

describe('fase 5: archivo repetido', () => {
  it('checkRepeatedFile detecta un lote previo con el mismo contenido, aunque el nombre cambie', async () => {
    const acc = await makeAccount(PROFILE_A);
    const parsed = parsedFromCsv(SAMPLE_CSV, 'enero.csv');
    const config = importService.suggestConfig(parsed, acc.id);
    const preview = await importService.buildPreview(PROFILE_A, parsed, config, [acc]);
    const { batch } = await importService.commit(PROFILE_A, { parsed, preview, templateId: null });

    // Mismo contenido, mismo hash (parsedFromCsv solo cambia el nombre), nombre distinto.
    const reimport: ParsedFile = { ...parsed, fileName: 'enero_copia.csv' };
    const repeated = await importService.checkRepeatedFile(PROFILE_A, reimport.sourceFileHash);
    expect(repeated.map((b) => b.id)).toEqual([batch.id]);
  });

  it('no avisa de archivo repetido si el contenido es distinto', async () => {
    const acc = await makeAccount(PROFILE_A);
    const parsed = parsedFromCsv(SAMPLE_CSV);
    const config = importService.suggestConfig(parsed, acc.id);
    const preview = await importService.buildPreview(PROFILE_A, parsed, config, [acc]);
    await importService.commit(PROFILE_A, { parsed, preview, templateId: null });

    const otherHash = await importService.checkRepeatedFile(PROFILE_A, 'un-hash-distinto');
    expect(otherHash).toEqual([]);
  });

  it('un lote deshecho ya no cuenta como "archivo repetido"', async () => {
    const acc = await makeAccount(PROFILE_A);
    const parsed = parsedFromCsv(SAMPLE_CSV);
    const config = importService.suggestConfig(parsed, acc.id);
    const preview = await importService.buildPreview(PROFILE_A, parsed, config, [acc]);
    const { batch } = await importService.commit(PROFILE_A, { parsed, preview, templateId: null });
    await importService.undo(PROFILE_A, batch.id);

    expect(await importService.checkRepeatedFile(PROFILE_A, parsed.sourceFileHash)).toEqual([]);
  });
});

describe('fase 5: identificador bancario y pendiente -> confirmado', () => {
  it('detecta nivel exact por identificador bancario aunque el concepto varie', async () => {
    const acc = await makeAccount(PROFILE_A);
    const csv1 = [BANKTX_CSV_HEADER, bankTxRow('15/01/2026', 'COMPRA A', '-12,34', 'OP-1', '', 'R1')].join('\n');
    const parsed1 = parsedFromCsv(csv1, 'lote1.csv');
    const config1 = importService.suggestConfig(parsed1, acc.id);
    const preview1 = await importService.buildPreview(PROFILE_A, parsed1, config1, [acc]);
    await importService.commit(PROFILE_A, { parsed: parsed1, preview: preview1, templateId: null });

    // Mismo identificador bancario, concepto de banco DISTINTO ("COMPRA B" vs "COMPRA A").
    const csv2 = [BANKTX_CSV_HEADER, bankTxRow('15/01/2026', 'COMPRA B', '-12,34', 'OP-1', '', 'R1')].join('\n');
    const parsed2 = parsedFromCsv(csv2, 'lote2.csv');
    const config2 = importService.suggestConfig(parsed2, acc.id);
    const preview2 = await importService.buildPreview(PROFILE_A, parsed2, config2, [acc]);
    expect(preview2.rows[0]!.duplicateStatus).toBe('exact');
    expect(preview2.rows[0]!.duplicateReasonCodes).toContain('sameBankTransactionId');
  });

  it('un confirmado sustituye a un pendiente: no duplica saldo y deshacer restaura el pendiente', async () => {
    const acc = await makeAccount(PROFILE_A);
    // Lote 1: alta pendiente.
    const csvPending = [
      BANKTX_CSV_HEADER,
      bankTxRow('15/01/2026', 'COMPRA MERCADONA', '-12,34', 'OP-42', 'pendiente', 'R42'),
    ].join('\n');
    const parsedPending = parsedFromCsv(csvPending, 'pendiente.csv');
    const configPending = importService.suggestConfig(parsedPending, acc.id);
    const previewPending = await importService.buildPreview(PROFILE_A, parsedPending, configPending, [acc]);
    expect(previewPending.rows[0]!.transaction!.pending).toBe(true);
    await importService.commit(PROFILE_A, {
      parsed: parsedPending,
      preview: previewPending,
      templateId: null,
    });
    const pendingTx = (await transactionsRepo.list(PROFILE_A))[0]!;
    expect(pendingTx.pending).toBe(true);

    // Lote 2: el banco confirma la misma operacion (mismo id, ya no pendiente).
    const csvConfirmed = [
      BANKTX_CSV_HEADER,
      bankTxRow('16/01/2026', 'COMPRA MERCADONA', '-12,34', 'OP-42', '', 'R42'),
    ].join('\n');
    const parsedConfirmed = parsedFromCsv(csvConfirmed, 'confirmado.csv');
    const configConfirmed = importService.suggestConfig(parsedConfirmed, acc.id);
    const previewConfirmed = await importService.buildPreview(
      PROFILE_A,
      parsedConfirmed,
      configConfirmed,
      [acc],
    );
    expect(previewConfirmed.rows[0]!.duplicateStatus).toBe('pendingReplaced');
    expect(previewConfirmed.rows[0]!.decision).toBe('replacePending');
    // Se incluye explicitamente: el usuario confirma la sustitucion.
    previewConfirmed.rows[0]!.include = true;

    const { batch: batch2 } = await importService.commit(PROFILE_A, {
      parsed: parsedConfirmed,
      preview: previewConfirmed,
      templateId: null,
    });

    // Solo queda UN movimiento vivo (el confirmado): no se duplica el saldo.
    const liveAfterReplace = await transactionsRepo.list(PROFILE_A);
    expect(liveAfterReplace).toHaveLength(1);
    expect(liveAfterReplace[0]!.pending).toBe(false);
    expect(liveAfterReplace[0]!.pendingReplacementId).toBe(pendingTx.id);

    // Deshacer el lote 2 restaura el pendiente con sus datos intactos (nunca se borro
    // fisicamente: se tombstoneo para permitir exactamente este undo).
    await importService.undo(PROFILE_A, batch2.id);
    const liveAfterUndo = await transactionsRepo.list(PROFILE_A);
    expect(liveAfterUndo).toHaveLength(1);
    expect(liveAfterUndo[0]!.id).toBe(pendingTx.id);
    expect(liveAfterUndo[0]!.pending).toBe(true);
  });

  it('pendiente y confirmado en el MISMO fichero: "sustituir pendiente" no se ofrece contra una fila aun sin persistir (evita duplicar saldo en silencio)', async () => {
    const acc = await makeAccount(PROFILE_A);
    // Una unica importacion con la fila pendiente y su confirmacion en el mismo lote.
    const csv = [
      BANKTX_CSV_HEADER,
      bankTxRow('15/01/2026', 'COMPRA MERCADONA', '-12,34', 'OP-99', 'pendiente', 'R99'),
      bankTxRow('16/01/2026', 'COMPRA MERCADONA', '-12,34', 'OP-99', '', 'R99'),
    ].join('\n');
    const parsed = parsedFromCsv(csv, 'mismo-lote.csv');
    const config = importService.suggestConfig(parsed, acc.id);
    const preview = await importService.buildPreview(PROFILE_A, parsed, config, [acc]);

    // La primera fila (pendiente) no tiene candidatos previos: se considera nueva.
    expect(preview.rows[0]!.duplicateStatus).toBe('unique');
    // La segunda fila coincide con la primera (candidato SINTETICO del propio fichero, aun
    // sin persistir): el nivel es pendingReplaced, pero 'replacePending' NO puede ofrecerse
    // (no hay nada real a lo que sustituir todavia) ni queda preseleccionado.
    expect(preview.rows[1]!.duplicateStatus).toBe('pendingReplaced');
    expect(preview.rows[1]!.availableDecisions).not.toContain('replacePending');
    expect(preview.rows[1]!.availableDecisions).not.toContain('link');
    expect(preview.rows[1]!.decision).toBe('import');

    // Si el usuario incluye ambas filas de forma explicita (decision transparente, visible),
    // se crean como dos movimientos independientes: nunca una sustitucion silenciosa.
    preview.rows[0]!.include = true;
    preview.rows[1]!.include = true;
    const { imported } = await importService.commit(PROFILE_A, { parsed, preview, templateId: null });
    expect(imported).toBe(2);
    expect(await transactionsRepo.count(PROFILE_A)).toBe(2);
  });

  it('commit() rechaza explicitamente una decision "sustituir pendiente" imposible de honrar, en vez de degradarla en silencio', async () => {
    const acc = await makeAccount(PROFILE_A);
    const parsed = parsedFromCsv(SAMPLE_CSV);
    const config = importService.suggestConfig(parsed, acc.id);
    const preview = await importService.buildPreview(PROFILE_A, parsed, config, [acc]);
    // Fuerza un estado inconsistente que la UI normal nunca produciria (defensa en
    // profundidad): decision 'replacePending' sin un candidato real.
    preview.rows[0]!.decision = 'replacePending';
    preview.rows[0]!.include = true;
    await expect(
      importService.commit(PROFILE_A, { parsed, preview, templateId: null }),
    ).rejects.toThrow(/sustituir pendiente/);
    expect(await transactionsRepo.count(PROFILE_A)).toBe(0);
  });
});

describe('fase 5: motor de duplicados usa el comercio resuelto en la propia previsualizacion', () => {
  it('activa el nivel strongNormalized por "mismo comercio" en una fila recien importada (no solo por concepto identico)', async () => {
    const acc = await makeAccount(PROFILE_A);
    const merchant = await merchantService.create(PROFILE_A, { canonicalName: 'Amazon' });
    await merchantService.createAlias(PROFILE_A, merchant.id, {
      rawAlias: 'AMZN',
      matchType: 'contains',
    });

    const csv1 = ['Fecha;Concepto;Importe', '15/01/2026;AMZN MKTP ES*A1;-30,00'].join('\n');
    const parsed1 = parsedFromCsv(csv1, 'lote1.csv');
    const config1 = importService.suggestConfig(parsed1, acc.id);
    const preview1 = await importService.buildPreview(PROFILE_A, parsed1, config1, [acc]);
    // El comercio ya se resolvio EN la previsualizacion (antes de puntuar duplicados).
    expect(preview1.rows[0]!.transaction!.merchantId).toBe(merchant.id);
    await importService.commit(PROFILE_A, { parsed: parsed1, preview: preview1, templateId: null });

    // Segunda compra: mismo comercio, importe y fecha (dentro de la ventana), pero un
    // concepto de banco DISTINTO (referencia de autorizacion distinta). Sin resolver el
    // comercio antes de puntuar, esto quedaria en 'possible' (sin senal de comercio); con la
    // correccion, sube a 'strongNormalized' por "mismo comercio".
    const csv2 = ['Fecha;Concepto;Importe', '16/01/2026;AMZN MKTP ES*B2;-30,00'].join('\n');
    const parsed2 = parsedFromCsv(csv2, 'lote2.csv');
    const config2 = importService.suggestConfig(parsed2, acc.id);
    const preview2 = await importService.buildPreview(PROFILE_A, parsed2, config2, [acc]);
    expect(preview2.rows[0]!.transaction!.merchantId).toBe(merchant.id);
    expect(preview2.rows[0]!.duplicateStatus).toBe('strongNormalized');
    expect(preview2.rows[0]!.duplicateReasonCodes).toContain('sameMerchant');
  });
});

describe('fase 5: decisiones vincular y marcar no duplicado', () => {
  it('"vincular" actualiza el movimiento existente sin crear uno nuevo', async () => {
    const acc = await makeAccount(PROFILE_A);
    const csv1 = [BANKTX_CSV_HEADER, bankTxRow('15/01/2026', 'COMPRA MERCADONA', '-12,34', 'OP-7', '', 'R-OLD')].join('\n');
    const parsed1 = parsedFromCsv(csv1, 'lote1.csv');
    const config1 = importService.suggestConfig(parsed1, acc.id);
    const preview1 = await importService.buildPreview(PROFILE_A, parsed1, config1, [acc]);
    await importService.commit(PROFILE_A, { parsed: parsed1, preview: preview1, templateId: null });
    const original = (await transactionsRepo.list(PROFILE_A))[0]!;

    const csv2 = [BANKTX_CSV_HEADER, bankTxRow('15/01/2026', 'COMPRA MERCADONA', '-12,34', 'OP-7', '', 'R-NEW')].join('\n');
    const parsed2 = parsedFromCsv(csv2, 'lote2.csv');
    const config2 = importService.suggestConfig(parsed2, acc.id);
    const preview2 = await importService.buildPreview(PROFILE_A, parsed2, config2, [acc]);
    expect(preview2.rows[0]!.availableDecisions).toContain('link');
    preview2.rows[0]!.decision = 'link';
    preview2.rows[0]!.include = true;

    const { imported, linked } = await importService.commit(PROFILE_A, {
      parsed: parsed2,
      preview: preview2,
      templateId: null,
    });
    expect(imported).toBe(0);
    expect(linked).toBe(1);

    const afterLink = await transactionsRepo.list(PROFILE_A);
    expect(afterLink).toHaveLength(1);
    expect(afterLink[0]!.id).toBe(original.id);
    expect(afterLink[0]!.bankReference).toBe('R-NEW');
  });

  it('"marcar no duplicado" registra la decision para la pareja concreta, sin silenciar duplicados reales de OTRAS filas', async () => {
    const acc = await makeAccount(PROFILE_A);
    const parsed1 = parsedFromCsv(SAMPLE_CSV, 'lote1.csv');
    const config1 = importService.suggestConfig(parsed1, acc.id);
    const preview1 = await importService.buildPreview(PROFILE_A, parsed1, config1, [acc]);
    await importService.commit(PROFILE_A, { parsed: parsed1, preview: preview1, templateId: null });
    const originals = await transactionsRepo.list(PROFILE_A);
    expect(originals).toHaveLength(3);

    // Reimportar el mismo fichero: todas las filas son "exact" contra el lote 1. Se marcan
    // como no duplicado (son compras reales repetidas, segun el usuario).
    const parsed2 = parsedFromCsv(SAMPLE_CSV, 'lote2.csv');
    const config2 = importService.suggestConfig(parsed2, acc.id);
    const preview2 = await importService.buildPreview(PROFILE_A, parsed2, config2, [acc]);
    for (const row of preview2.rows) {
      expect(row.duplicateStatus).toBe('exact');
      row.decision = 'markNotDuplicate';
      row.include = true;
    }
    const { imported } = await importService.commit(PROFILE_A, {
      parsed: parsed2,
      preview: preview2,
      templateId: null,
    });
    expect(imported).toBe(3);
    expect(await transactionsRepo.count(PROFILE_A)).toBe(6);

    // Se registro una decision por fila, referenciando el movimiento original concreto.
    const decisions = await noDuplicateDecisionsRepo.list(PROFILE_A);
    expect(decisions).toHaveLength(3);
    expect(decisions.map((d) => d.rightTxId).sort()).toEqual(originals.map((t) => t.id).sort());

    // Una tercera importacion identica: la pareja YA decidida (lote3 vs lote1) no reaparece,
    // pero SI se detecta como duplicado de las filas del lote2 (esa pareja nunca se revisó).
    // Esto es lo correcto: "no duplicado" cubre la pareja concreta decidida, no cualquier
    // fila futura que comparta la misma huella tolerante (evita silenciar un duplicado real).
    const parsed3 = parsedFromCsv(SAMPLE_CSV, 'lote3.csv');
    const config3 = importService.suggestConfig(parsed3, acc.id);
    const preview3 = await importService.buildPreview(PROFILE_A, parsed3, config3, [acc]);
    const originalIds = new Set(originals.map((t) => t.id));
    for (const row of preview3.rows) {
      expect(row.duplicateStatus).toBe('exact');
      expect(row.bestCandidateId).not.toBeNull();
      // El candidato detectado nunca es el de la pareja ya decidida (lote1); es alguna de
      // las filas de lote2, que nunca se marco como no-duplicado.
      expect(originalIds.has(row.bestCandidateId!)).toBe(false);
    }
  });

  it('commit() rechaza explicitamente que DOS filas del mismo fichero se vinculen al MISMO movimiento existente', async () => {
    const acc = await makeAccount(PROFILE_A);
    const merchant = await merchantService.create(PROFILE_A, { canonicalName: 'Mercadona' });
    await merchantService.createAlias(PROFILE_A, merchant.id, {
      rawAlias: 'MERCADONA',
      matchType: 'contains',
    });

    // Lote 1: alta original, con el comercio ya resuelto.
    const csv1 = ['Fecha;Concepto;Importe', '15/01/2026;COMPRA MERCADONA CENTRO;-12,34'].join('\n');
    const parsed1 = parsedFromCsv(csv1, 'lote1.csv');
    const config1 = importService.suggestConfig(parsed1, acc.id);
    const preview1 = await importService.buildPreview(PROFILE_A, parsed1, config1, [acc]);
    expect(preview1.rows[0]!.transaction!.merchantId).toBe(merchant.id);
    await importService.commit(PROFILE_A, { parsed: parsed1, preview: preview1, templateId: null });
    const original = (await transactionsRepo.list(PROFILE_A))[0]!;

    // Lote 2: dos filas DISTINTAS (conceptos de banco diferentes ENTRE SI, sin coincidir por
    // fecha entre ellas mas alla de la ventana estricta con la confianza mas alta), pero
    // ambas resuelven el MISMO comercio que el original y caen dentro de su ventana de fecha:
    // cada una, evaluada de forma independiente, elige a `original` como mejor candidato
    // (nivel strongNormalized por "mismo comercio"), no a la otra fila del propio fichero.
    const csv2 = [
      'Fecha;Concepto;Importe',
      '13/01/2026;COMPRA MERCADONA SUR;-12,34',
      '15/01/2026;COMPRA MERCADONA NORTE;-12,34',
    ].join('\n');
    const parsed2 = parsedFromCsv(csv2, 'lote2.csv');
    const config2 = importService.suggestConfig(parsed2, acc.id);
    const preview2 = await importService.buildPreview(PROFILE_A, parsed2, config2, [acc]);
    expect(preview2.rows[0]!.bestCandidateId).toBe(original.id);
    expect(preview2.rows[1]!.bestCandidateId).toBe(original.id);
    expect(preview2.rows[0]!.availableDecisions).toContain('link');
    for (const row of preview2.rows) {
      row.decision = 'link';
      row.include = true;
    }

    await expect(
      importService.commit(PROFILE_A, { parsed: parsed2, preview: preview2, templateId: null }),
    ).rejects.toThrow(/mismo movimiento existente/);
    // No se perdio la vinculacion de la primera fila en silencio: no se aplico ninguna.
    const afterReject = await transactionsRepo.list(PROFILE_A);
    expect(afterReject).toHaveLength(1);
    expect(afterReject[0]!.id).toBe(original.id);
  });
});

describe('fase 5: atomicidad del commit (un fallo parcial nunca deja el lote a medias)', () => {
  it('si la decision "vincular" falla (candidato borrado entre la previsualizacion y el commit), TODO el commit se revierte y un reintento no duplica nada', async () => {
    const acc = await makeAccount(PROFILE_A);
    const csv1 = [BANKTX_CSV_HEADER, bankTxRow('15/01/2026', 'COMPRA MERCADONA', '-12,34', 'OP-500', '', 'R-OLD')].join('\n');
    const parsed1 = parsedFromCsv(csv1, 'lote1.csv');
    const config1 = importService.suggestConfig(parsed1, acc.id);
    const preview1 = await importService.buildPreview(PROFILE_A, parsed1, config1, [acc]);
    await importService.commit(PROFILE_A, { parsed: parsed1, preview: preview1, templateId: null });
    const original = (await transactionsRepo.list(PROFILE_A))[0]!;

    // Lote 2: una fila NUEVA (createRow, valida) + una fila que se vincula al movimiento del
    // lote 1.
    const csv2 = [
      BANKTX_CSV_HEADER,
      bankTxRow('20/01/2026', 'COMPRA NUEVA', '-9,00', 'OP-501', '', 'R-501'),
      bankTxRow('15/01/2026', 'COMPRA MERCADONA', '-12,34', 'OP-500', '', 'R-NEW'),
    ].join('\n');
    const parsed2 = parsedFromCsv(csv2, 'lote2.csv');
    const config2 = importService.suggestConfig(parsed2, acc.id);
    const preview2 = await importService.buildPreview(PROFILE_A, parsed2, config2, [acc]);
    expect(preview2.rows[1]!.bestCandidateId).toBe(original.id);
    preview2.rows[1]!.decision = 'link';
    preview2.rows[1]!.include = true;

    // Se borra el candidato de "vincular" ENTRE la previsualizacion y el commit (simula otro
    // dispositivo/pestana borrandolo primero): la operacion "vincular" debe fallar DENTRO de
    // la transaccion atomica de commitBatch.
    await transactionsRepo.remove(PROFILE_A, original.id);

    // El error se propaga desde DENTRO de la transaccion Dexie: puede llegar reenvuelto (no
    // necesariamente la misma instancia de NotFoundError), asi que se comprueba el mensaje en
    // vez de la clase concreta.
    await expect(
      importService.commit(PROFILE_A, { parsed: parsed2, preview: preview2, templateId: null }),
    ).rejects.toThrow(/no existe en el perfil/);

    // Nada del lote 2 quedo a medias: ni el ImportBatch ni la fila "createRow" que si era
    // valida (antes de este fix se creaba igualmente, porque commitBatch ya habia confirmado
    // su propia transaccion antes de que fallara el bucle de "vincular").
    expect(await importService.listBatches(PROFILE_A)).toHaveLength(1); // solo el lote 1
    expect(await transactionsRepo.count(PROFILE_A)).toBe(0); // el original tambien se borro

    // Reintento tras corregir la fila imposible de honrar (se omite): un segundo commit()
    // sobre el MISMO objeto de previsualizacion no duplica la fila valida.
    preview2.rows[1]!.include = false;
    const { batch, imported } = await importService.commit(PROFILE_A, {
      parsed: parsed2,
      preview: preview2,
      templateId: null,
    });
    expect(imported).toBe(1);
    const finalTxs = await transactionsRepo.list(PROFILE_A);
    expect(finalTxs).toHaveLength(1);
    expect(finalTxs[0]!.bankReference).toBe('R-501');
    const batches = await importService.listBatches(PROFILE_A);
    expect(batches).toHaveLength(2);
    expect(batches.map((b) => b.id)).toContain(batch.id);
  });
});

describe('fase 5: rendimiento con miles de filas', () => {
  it('buildPreview procesa miles de filas en un tiempo razonable', async () => {
    const acc = await makeAccount(PROFILE_A);
    // 2000 movimientos existentes repartidos en un rango de fechas amplio.
    const existingRows: string[] = [];
    for (let i = 0; i < 500; i++) {
      const day = String((i % 27) + 1).padStart(2, '0');
      existingRows.push(`${day}/01/2026;GASTO EXISTENTE ${i};-${(i % 90) + 1},00`);
    }
    const parsedExisting = parsedFromCsv(['Fecha;Concepto;Importe', ...existingRows].join('\n'), 'base.csv');
    const configExisting = importService.suggestConfig(parsedExisting, acc.id);
    const previewExisting = await importService.buildPreview(PROFILE_A, parsedExisting, configExisting, [acc]);
    await importService.commit(PROFILE_A, {
      parsed: parsedExisting,
      preview: previewExisting,
      templateId: null,
    });

    // Fichero nuevo de 2000 filas: mezcla de nuevas y algunas que coinciden con lo existente.
    const newRows: string[] = [];
    for (let i = 0; i < 2000; i++) {
      const day = String((i % 27) + 1).padStart(2, '0');
      newRows.push(`${day}/01/2026;GASTO NUEVO ${i};-${(i % 120) + 1},00`);
    }
    const parsedNew = parsedFromCsv(['Fecha;Concepto;Importe', ...newRows].join('\n'), 'nuevo.csv');
    const configNew = importService.suggestConfig(parsedNew, acc.id);

    const start = Date.now();
    const previewNew = await importService.buildPreview(PROFILE_A, parsedNew, configNew, [acc]);
    const elapsedMs = Date.now() - start;

    expect(previewNew.summary.total).toBe(2000);
    // Umbral generoso: el objetivo es detectar una regresion de complejidad (O(n*m) sin
    // acotar), no fijar un presupuesto de rendimiento milimetrico dependiente de la maquina.
    expect(elapsedMs).toBeLessThan(15000);
  }, 30000);
});

describe('importService: fichero ya categorizado (Categoria/Subcategoria/Excluir/Cuenta)', () => {
  const CATEGORIZED_CSV = [
    'Fecha;Concepto;Importe;Cuenta;Categoria;Subcategoria;Excluir de estadisticas',
    '17/09/2026;Grab;-6,76;Revolut;Vacaciones;Transporte;No',
    '18/09/2026;Nusa Penida Dc;-245,83;Revolut;Vacaciones;Ocio y actividades;No',
    '19/09/2026;Recarga de *5019;300,00;Revolut;Transferencias internas;;Si',
    '20/09/2026;Mercadona;-12,00;Ibercaja;;;',
  ].join('\n');

  it('detecta las columnas, avisa de las categorias que se crearan y las respeta frente a las reglas', async () => {
    const { categoryService } = await import('./categoryService');
    const { ruleService } = await import('./ruleService');
    const revolut = await makeAccount(PROFILE_A, 'Revolut');
    const ibercaja = await makeAccount(PROFILE_A, 'Ibercaja');
    const vacaciones = await categoryService.createCategory(PROFILE_A, { name: 'Vacaciones', kind: 'expense' });
    await categoryService.createCategory(PROFILE_A, { name: 'Transporte', kind: 'expense', parentId: vacaciones.id });
    const supermercado = await categoryService.createCategory(PROFILE_A, { name: 'Supermercado', kind: 'expense' });
    const ocio = await categoryService.createCategory(PROFILE_A, { name: 'Ocio', kind: 'expense' });
    // Una regla que casaria con "Grab" no debe pisar la categoria del fichero.
    await ruleService.create(PROFILE_A, {
      name: 'grab -> ocio', enabled: true, matchMode: 'all', stopOnMatch: true,
      conditions: [{ field: 'concept', operator: 'contains', value: 'grab', value2: null, caseSensitive: false }],
      action: { setCategoryId: ocio.id, setSubcategoryId: null, addTagIds: [], setExcludedFromStats: null },
    });
    await ruleService.create(PROFILE_A, {
      name: 'mercadona', enabled: true, matchMode: 'all', stopOnMatch: true,
      conditions: [{ field: 'concept', operator: 'contains', value: 'mercadona', value2: null, caseSensitive: false }],
      action: { setCategoryId: supermercado.id, setSubcategoryId: null, addTagIds: [], setExcludedFromStats: null },
    });

    const parsed = parsedFromCsv(CATEGORIZED_CSV);
    const config = importService.suggestConfig(parsed, ibercaja.id);
    expect(config.columnMap).toMatchObject({ account: 3, category: 4, subcategory: 5, excludeFromStats: 6 });
    const preview = await importService.buildPreview(PROFILE_A, parsed, config, [revolut, ibercaja]);
    expect(preview.summary.errors).toBe(0);
    expect(preview.categoriesToCreate).toEqual([
      'Vacaciones > Ocio y actividades',
      'Transferencias internas',
    ]);

    await importService.commit(PROFILE_A, { parsed, preview, templateId: null });
    const txs = await transactionsRepo.list(PROFILE_A);
    const cats = await categoryService.listAll(PROFILE_A);
    const name = (id: string | null) => cats.find((c) => c.id === id)?.name ?? null;
    const byConcept = (c: string) => txs.find((t) => t.concept === c)!;

    expect(name(byConcept('Grab').categoryId)).toBe('Vacaciones');
    expect(name(byConcept('Grab').subcategoryId)).toBe('Transporte');
    expect(byConcept('Grab').categorizedBy).toBe('import');
    expect(name(byConcept('Nusa Penida Dc').subcategoryId)).toBe('Ocio y actividades');
    expect(byConcept('Recarga de *5019').excludedFromStats).toBe(true);
    expect(byConcept('Recarga de *5019').accountId).toBe(revolut.id);
    // Sin categoria en el fichero: actuan las reglas.
    expect(name(byConcept('Mercadona').categoryId)).toBe('Supermercado');
    expect(byConcept('Mercadona').categorizedBy).toBe('rule');
    expect(byConcept('Mercadona').accountId).toBe(ibercaja.id);
  });

  it('una cuenta del fichero que no existe es un error, no cae en la cuenta por defecto', async () => {
    const revolut = await makeAccount(PROFILE_A, 'Revolut');
    const csv = ['Fecha;Concepto;Importe;Cuenta', '01/09/2026;Cafe;-2,00;Revolut', '02/09/2026;Cine;-9,00;Revolut conjunta'].join('\n');
    const parsed = parsedFromCsv(csv);
    const config = importService.suggestConfig(parsed, revolut.id);
    const preview = await importService.buildPreview(PROFILE_A, parsed, config, [revolut]);
    expect(preview.summary.ok).toBe(1);
    expect(preview.summary.errors).toBe(1);
    expect(preview.rows[1]!.errors.join(' ')).toMatch(/Revolut conjunta/);
  });

  it('si la columna de cuenta no trae nombres conocidos (IBAN), todo va a la cuenta por defecto', async () => {
    const acc = await makeAccount(PROFILE_A, 'Banco');
    const csv = ['Fecha;Concepto;Importe;Cuenta', '01/09/2026;Cafe;-2,00;ES7620770024003102575766'].join('\n');
    const parsed = parsedFromCsv(csv);
    const preview = await importService.buildPreview(PROFILE_A, parsed, importService.suggestConfig(parsed, acc.id), [acc]);
    expect(preview.summary.errors).toBe(0);
    expect(preview.rows[0]!.transaction!.accountId).toBe(acc.id);
  });
});
