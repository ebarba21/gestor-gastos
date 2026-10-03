// Convierte una exportacion de movimientos en Excel (hoja "Movimientos", el mismo formato que
// genera la seccion Exportar de la app) en un BACKUP de perfil restaurable desde Ajustes.
//
// A diferencia de la importacion bancaria (que solo lee fecha, concepto e importe), conserva
// tipo, categoria, subcategoria, cuenta, estado, notas, etiquetas y la exclusion de estadisticas.
// Se ejecuta en local con la propia logica de la app (servicios + IndexedDB simulada), asi que
// el backup pasa por las mismas validaciones que un alta normal. Ningun dato sale del equipo.
//
// Uso:
//   EXCEL=ruta/al/historico.xlsx SALIDA=backup.json PERFIL="Eric" \
//     npx vitest run --config vitest.gen.config.ts scripts/excelABackup.gen.ts
import { readFileSync, writeFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { expect, test } from 'vitest';
import type { CategoryKind, TransactionStatus, TransactionType } from '../src/db/schema';
import { profileService } from '../src/services/profileService';
import { accountService } from '../src/services/accountService';
import { categoryService } from '../src/services/categoryService';
import { tagService } from '../src/services/tagService';
import { transactionService } from '../src/services/transactionService';
import { transactionsRepo } from '../src/db/transactionsRepo';
import { createBackup, serializeBackup, parseBackup } from '../src/services/backupService';

const EXCEL = process.env.EXCEL ?? '';
const SALIDA = process.env.SALIDA ?? 'backup-historico.json';
const PERFIL = process.env.PERFIL ?? 'Principal';

// Cabeceras sin tildes ni mayusculas, para aceptar "Categoría" y "Categoria".
function key(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}

const TYPE_BY_LABEL: Record<string, TransactionType> = {
  gasto: 'expense',
  ingreso: 'income',
  transferencia: 'transfer',
};
const STATUS_BY_LABEL: Record<string, TransactionStatus> = {
  confirmado: 'cleared',
  pendiente: 'pending',
  conciliado: 'reconciled',
};

function text(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s;
}

// Euros (numero o texto con coma/punto) a centimos enteros, sin redondeos silenciosos.
function toCents(v: unknown, row: number): number {
  const n = typeof v === 'number' ? v : Number(String(v).replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n)) throw new Error(`Fila ${row}: importe no numerico "${String(v)}".`);
  const scaled = n * 100;
  const cents = Math.round(scaled);
  if (Math.abs(scaled - cents) > 1e-6) {
    throw new Error(`Fila ${row}: el importe "${String(v)}" tiene mas de dos decimales.`);
  }
  return cents;
}

function toDate(v: unknown, row: number): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = text(v);
  if (s && /^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s?.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  throw new Error(`Fila ${row}: fecha no reconocida "${String(v)}".`);
}

interface Row {
  date: string;
  concept: string;
  rawConcept: string | null;
  amountCents: number;
  type: TransactionType;
  category: string | null;
  subcategory: string | null;
  account: string;
  tags: string[];
  status: TransactionStatus;
  notes: string | null;
  excluded: boolean;
  categorizedLabel: string;
}

function readRows(path: string): Row[] {
  const wb = XLSX.read(readFileSync(path), { cellDates: true });
  const sheetName = wb.SheetNames.find((n) => key(n) === 'movimientos') ?? wb.SheetNames[0];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], {
    defval: null,
    raw: true,
  });
  return raw.map((r, i) => {
    const row = i + 2;
    const get = (name: string): unknown => {
      const k = Object.keys(r).find((h) => key(h) === key(name));
      return k === undefined ? null : r[k];
    };
    const typeLabel = key(text(get('Tipo')) ?? '');
    const type = TYPE_BY_LABEL[typeLabel];
    if (!type) throw new Error(`Fila ${row}: tipo desconocido "${String(get('Tipo'))}".`);
    const concept = text(get('Concepto'));
    if (!concept) throw new Error(`Fila ${row}: concepto vacio.`);
    const account = text(get('Cuenta'));
    if (!account) throw new Error(`Fila ${row}: cuenta vacia.`);
    return {
      date: toDate(get('Fecha'), row),
      concept,
      rawConcept: text(get('Concepto original')),
      amountCents: toCents(get('Importe (EUR)') ?? get('Importe'), row),
      type,
      category: text(get('Categoria')),
      subcategory: text(get('Subcategoria')),
      account,
      tags: (text(get('Etiquetas')) ?? '')
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      status: STATUS_BY_LABEL[key(text(get('Estado')) ?? 'confirmado')] ?? 'cleared',
      notes: text(get('Notas')),
      excluded: key(text(get('Excluido de estadisticas')) ?? 'no') === 'si',
      categorizedLabel: key(text(get('Categorizado por')) ?? ''),
    };
  });
}

function kindFor(types: Set<TransactionType>): CategoryKind {
  const hasExp = types.has('expense');
  const hasInc = types.has('income');
  if (hasExp && !hasInc) return 'expense';
  if (hasInc && !hasExp) return 'income';
  return 'both';
}

test('Excel de movimientos -> backup de perfil', async () => {
  expect(EXCEL, 'Indica el Excel con EXCEL=ruta.xlsx').not.toBe('');
  const rows = readRows(EXCEL);
  expect(rows.length).toBeGreaterThan(0);

  const profile = await profileService.createProfile({ name: PERFIL });
  const pid = profile.id;

  // El perfil nuevo trae categorias de ejemplo: se quitan para dejar solo las del historico.
  const seeded = await categoryService.listAll(pid);
  for (const c of seeded.filter((c) => c.parentId !== null)) {
    await categoryService.deleteCategory(pid, c.id);
  }
  for (const c of seeded.filter((c) => c.parentId === null)) {
    await categoryService.deleteCategory(pid, c.id);
  }

  // Cuentas (saldo inicial 0: el Excel solo trae movimientos; se ajusta luego en Cuentas).
  const accountIds = new Map<string, string>();
  for (const name of [...new Set(rows.map((r) => r.account))].sort()) {
    const acc = await accountService.createAccount(pid, {
      name,
      kind: 'bank',
      openingBalanceCents: 0,
    });
    accountIds.set(name, acc.id);
  }

  // Categorias raiz y subcategorias. El tipo (gasto/ingreso/ambos) se deduce del uso real.
  const rootTypes = new Map<string, Set<TransactionType>>();
  const subs = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.category) continue;
    if (!rootTypes.has(r.category)) rootTypes.set(r.category, new Set());
    rootTypes.get(r.category)!.add(r.type);
    if (r.subcategory) {
      if (!subs.has(r.category)) subs.set(r.category, new Set());
      subs.get(r.category)!.add(r.subcategory);
    }
  }
  const rootIds = new Map<string, string>();
  const subIds = new Map<string, string>();
  for (const name of [...rootTypes.keys()].sort((a, b) => a.localeCompare(b, 'es'))) {
    const kind = kindFor(rootTypes.get(name)!);
    const root = await categoryService.createCategory(pid, { name, kind });
    rootIds.set(name, root.id);
    for (const sub of [...(subs.get(name) ?? [])].sort((a, b) => a.localeCompare(b, 'es'))) {
      const child = await categoryService.createCategory(pid, {
        name: sub,
        kind,
        parentId: root.id,
      });
      subIds.set(`${name}\u0000${sub}`, child.id);
    }
  }

  // Etiquetas.
  const tagIds = new Map<string, string>();
  for (const name of [...new Set(rows.flatMap((r) => r.tags))]) {
    const tag = await tagService.createTag(pid, { name });
    tagIds.set(name, tag.id);
  }

  // Movimientos (orden cronologico).
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const toImport: string[] = [];
  const rawPatches = new Map<string, string>();
  for (const r of sorted) {
    const categoryId = r.category ? rootIds.get(r.category)! : null;
    const tx = await transactionService.create(pid, {
      date: r.date,
      amountCents: r.amountCents,
      type: r.type,
      concept: r.concept,
      notes: r.notes,
      accountId: accountIds.get(r.account)!,
      categoryId,
      subcategoryId:
        r.category && r.subcategory ? subIds.get(`${r.category}\u0000${r.subcategory}`)! : null,
      tagIds: r.tags.map((t) => tagIds.get(t)!),
      status: r.status,
      excludedFromStats: r.excluded,
    });
    // Las categorias vienen del historico (antes asignadas por reglas o a mano): se marcan como
    // "importacion" para no confundirlas con una edicion manual hecha en esta app. Las reglas
    // originales no viajan en el Excel, asi que no se inventa un ruleId.
    if (categoryId !== null && r.categorizedLabel !== 'manual') toImport.push(tx.id);
    if (r.rawConcept && r.rawConcept !== r.concept) rawPatches.set(tx.id, r.rawConcept);
  }
  await transactionsRepo.applyToMany(pid, toImport, () => ({ categorizedBy: 'import' }));
  await transactionsRepo.applyToMany(pid, [...rawPatches.keys()], (t) => ({
    rawConcept: rawPatches.get(t.id)!,
  }));

  const backup = await createBackup(pid);
  const json = serializeBackup(backup);

  // --- Comprobaciones: el backup cuadra con el Excel ---
  const parsed = parseBackup(json);
  const txs = parsed.data.transactions;
  expect(txs).toHaveLength(rows.length);
  const sumExcel = rows.reduce((s, r) => s + r.amountCents, 0);
  const sumBackup = txs.reduce((s, t) => s + t.amountCents, 0);
  expect(sumBackup).toBe(sumExcel);
  for (const [name, id] of accountIds) {
    const a = rows.filter((r) => r.account === name).reduce((s, r) => s + r.amountCents, 0);
    const b = txs.filter((t) => t.accountId === id).reduce((s, t) => s + t.amountCents, 0);
    expect(b, `saldo de ${name}`).toBe(a);
  }
  for (const [name, id] of rootIds) {
    expect(txs.filter((t) => t.categoryId === id)).toHaveLength(
      rows.filter((r) => r.category === name).length,
    );
  }
  expect(txs.filter((t) => t.excludedFromStats)).toHaveLength(rows.filter((r) => r.excluded).length);

  writeFileSync(SALIDA, json);
  const byType = (t: TransactionType) => rows.filter((r) => r.type === t).length;
  console.log(
    [
      `Backup generado: ${SALIDA}`,
      `  Perfil: ${PERFIL}`,
      `  Movimientos: ${rows.length} (gastos ${byType('expense')}, ingresos ${byType('income')}, transferencias ${byType('transfer')})`,
      `  Periodo: ${sorted[0].date} a ${sorted[sorted.length - 1].date}`,
      `  Cuentas: ${[...accountIds.keys()].join(', ')}`,
      `  Categorias: ${rootIds.size} raiz + ${subIds.size} subcategorias`,
      `  Suma total: ${(sumExcel / 100).toFixed(2)} EUR`,
    ].join('\n'),
  );
});
