// Logica de negocio de movimientos (Transaction). Ver DATA_MODEL 2.6 y seccion 6.
// Orquesta transactionsRepo. En esta fase toda categorizacion es MANUAL (categorizedBy
// = 'manual' cuando hay categoria, 'none' cuando no). El motor de reglas es fase posterior.
//
// Responsabilidades:
//  - CRUD individual con dedupeHash y coherencia type<->signo.
//  - Edicion y borrado masivo (atomicos, con recuento de afectados).
//  - Movimientos especiales: transferencia interna (par enlazado), reembolso (enlace al
//    gasto), exclusion de estadisticas y split (reparto cuya suma = total del padre).
import type {
  CategorizedBy,
  Transaction,
  TransactionStatus,
  TransactionType,
} from '../db/schema';
import { transactionsRepo } from '../db/transactionsRepo';
import type { NewTransaction, TransactionPatch } from '../db/transactionsRepo';
import { computeDedupeHash } from '../lib/dedupe';
import { normalizeConceptV1, NORMALIZATION_VERSION } from '../lib/normalization';
import {
  computeFingerprints,
  computeSyntheticRowHash,
  FINGERPRINT_VERSION,
} from '../lib/duplicateFingerprint';
// Moneda por defecto cuando no se conoce la del perfil (coherente con Setting.currency,
// DATA_MODEL seccion 1). Los movimientos de alta manual, transferencia y split no vienen de
// un extracto bancario, por lo que no traen moneda propia.
const DEFAULT_CURRENCY = 'EUR';
import { assert, ValidationError, requireId, requireProfileId } from '../lib/validation';
import { assertCents } from '../lib/money';

export const MAX_CONCEPT_LENGTH = 140;
export const MAX_NOTES_LENGTH = 500;

// Datos que aporta la UI al crear/editar un movimiento normal. El servicio deriva el
// resto (dedupeHash, categorizedBy, statsFlag via repo, flags de especiales).
export interface TransactionInput {
  date: string;
  amountCents: number; // con signo, coherente con type
  type: TransactionType;
  concept: string;
  notes?: string | null;
  accountId: string;
  categoryId?: string | null;
  subcategoryId?: string | null;
  tagIds?: string[];
  status?: TransactionStatus;
  excludedFromStats?: boolean;
}

export function normalizeConceptText(concept: string): string {
  const trimmed = (concept ?? '').trim().replace(/\s+/g, ' ');
  if (trimmed.length === 0) {
    throw new ValidationError('El concepto no puede estar vacio.');
  }
  if (trimmed.length > MAX_CONCEPT_LENGTH) {
    throw new ValidationError(`El concepto no puede superar ${MAX_CONCEPT_LENGTH} caracteres.`);
  }
  return trimmed;
}

function normalizeNotes(notes: string | null | undefined): string | null {
  if (notes === null || notes === undefined) return null;
  const trimmed = notes.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_NOTES_LENGTH) {
    throw new ValidationError(`Las notas no pueden superar ${MAX_NOTES_LENGTH} caracteres.`);
  }
  return trimmed;
}

// Ajusta el signo del importe (en centimos) al tipo de movimiento. La UI captura la
// magnitud; aqui se fija el signo canonico (gasto negativo, ingreso positivo). Para
// 'transfer' el signo lo fija el flujo de transferencia, no esta funcion.
export function signedAmountFor(type: TransactionType, magnitudeCents: number): number {
  assertCents(magnitudeCents);
  const magnitude = Math.abs(magnitudeCents);
  if (type === 'expense') return -magnitude;
  if (type === 'income') return magnitude;
  // transfer: no se normaliza aqui (cada pata define su signo).
  return magnitudeCents;
}

// categorizedBy en fase manual: 'manual' si hay categoria asignada, 'none' si no.
function categorizedByFor(categoryId: string | null): CategorizedBy {
  return categoryId !== null ? 'manual' : 'none';
}

// Construye el NewTransaction completo de un movimiento normal (no especial).
function buildNewTransaction(profileId: string, input: TransactionInput): NewTransaction {
  const concept = normalizeConceptText(input.concept);
  const notes = normalizeNotes(input.notes);
  const categoryId = input.categoryId ?? null;
  const subcategoryId = input.subcategoryId ?? null;
  assert(input.accountId.length > 0, 'El movimiento debe tener una cuenta.');
  // Una subcategoria requiere su categoria raiz.
  if (subcategoryId !== null) {
    assert(categoryId !== null, 'Una subcategoria requiere tambien su categoria raiz.');
  }
  const excludedFromStats = input.excludedFromStats ?? false;
  const normalizedConcept = normalizeConceptV1(concept);
  const { exactFingerprint, normalizedFingerprint } = computeFingerprints({
    accountId: input.accountId,
    date: input.date,
    amountCents: input.amountCents,
    currency: DEFAULT_CURRENCY,
    normalizedConcept,
    merchantId: null,
  });
  return {
    date: input.date,
    amountCents: input.amountCents,
    type: input.type,
    concept,
    notes,
    accountId: input.accountId,
    categoryId,
    subcategoryId,
    tagIds: input.tagIds ?? [],
    status: input.status ?? 'cleared',
    categorizedBy: categorizedByFor(categoryId),
    ruleId: null,
    transferGroupId: null,
    parentId: null,
    isSplitParent: false,
    refundOfId: null,
    excludedFromStats,
    importBatchId: null,
    dedupeHash: computeDedupeHash({
      profileId,
      accountId: input.accountId,
      date: input.date,
      amountCents: input.amountCents,
      concept,
    }),
    // Alta manual: no hay concepto bancario distinto del editado por el usuario.
    rawConcept: concept,
    normalizedConcept,
    normalizationVersion: NORMALIZATION_VERSION,
    merchantId: null,
    merchantMatchSource: 'none',
    merchantMatchConfidence: 0,
    // Alta manual: sin metadatos bancarios (fase 5, DATA_MODEL 15.1). Las huellas se calculan
    // igualmente para que el motor de duplicados pueda cruzar altas manuales con
    // importaciones futuras (p. ej. la misma compra dada de alta a mano y luego importada).
    bankTransactionId: null,
    bookingDate: null,
    valueDate: null,
    pending: false,
    currency: DEFAULT_CURRENCY,
    balanceAfterCents: null,
    bankReference: null,
    operationType: null,
    sourceRowHash: computeSyntheticRowHash({
      date: input.date,
      amountCents: input.amountCents,
      concept,
      accountId: input.accountId,
    }),
    exactFingerprint,
    normalizedFingerprint,
    fingerprintVersion: FINGERPRINT_VERSION,
    sourceFileHash: null,
    sourceFileSize: null,
    duplicateStatus: 'unique',
    duplicateConfidence: 0,
    duplicateReasonCodes: [],
    duplicateCandidateIds: [],
    pendingReplacementId: null,
  };
}

// --- Edicion masiva ---

export interface BulkTagOp {
  mode: 'add' | 'remove' | 'replace';
  tagIds: string[];
}

// Cada campo presente se aplica; los ausentes se dejan intactos. setCategory con
// categoryId=null limpia la categoria (y la subcategoria).
export interface BulkEdit {
  setAccountId?: string;
  setCategory?: { categoryId: string | null; subcategoryId: string | null };
  setStatus?: TransactionStatus;
  setExcludedFromStats?: boolean;
  tags?: BulkTagOp;
}

export function isEmptyBulkEdit(edit: BulkEdit): boolean {
  return (
    edit.setAccountId === undefined &&
    edit.setCategory === undefined &&
    edit.setStatus === undefined &&
    edit.setExcludedFromStats === undefined &&
    (edit.tags === undefined || edit.tags.tagIds.length === 0 && edit.tags.mode !== 'replace')
  );
}

function applyTagOp(current: string[], op: BulkTagOp): string[] {
  if (op.mode === 'replace') return [...new Set(op.tagIds)];
  if (op.mode === 'add') return [...new Set([...current, ...op.tagIds])];
  // remove
  const toRemove = new Set(op.tagIds);
  return current.filter((t) => !toRemove.has(t));
}

// Deriva el patch de un movimiento a partir de una edicion masiva. Recalcula dedupeHash
// si cambia la cuenta y categorizedBy si cambia la categoria.
function patchFromBulkEdit(t: Transaction, edit: BulkEdit): TransactionPatch {
  const patch: TransactionPatch = {};
  if (edit.setAccountId !== undefined && edit.setAccountId !== t.accountId) {
    patch.accountId = edit.setAccountId;
    patch.dedupeHash = computeDedupeHash({
      profileId: t.profileId,
      accountId: edit.setAccountId,
      date: t.date,
      amountCents: t.amountCents,
      concept: t.concept,
    });
  }
  if (edit.setCategory !== undefined) {
    patch.categoryId = edit.setCategory.categoryId;
    patch.subcategoryId = edit.setCategory.categoryId === null ? null : edit.setCategory.subcategoryId;
    patch.categorizedBy = categorizedByFor(edit.setCategory.categoryId);
    patch.ruleId = null;
  }
  if (edit.setStatus !== undefined) patch.status = edit.setStatus;
  if (edit.setExcludedFromStats !== undefined) {
    patch.excludedFromStats = edit.setExcludedFromStats;
  }
  if (edit.tags !== undefined) {
    patch.tagIds = applyTagOp(t.tagIds, edit.tags);
  }
  return patch;
}

// --- Splits ---

export interface SplitPart {
  amountCents: number; // con signo, mismo signo que el padre
  concept?: string; // opcional; por defecto hereda el del padre
  categoryId: string | null;
  subcategoryId?: string | null;
  tagIds?: string[];
  notes?: string | null;
  // Exclusion de estadisticas de ESTA linea. Opcional: si se omite, hereda el comportamiento
  // historico (todas las hijas comparten la exclusion "heredada" del padre). Un llamante que
  // necesite mezclar hijas que cuentan con hijas excluidas dentro del MISMO split (p. ej. fase 8:
  // separar el principal de una cuota de deuda, que no es consumo, del interes, que si lo es)
  // puede fijarlo por parte. Aditivo: no cambia el comportamiento de ningun llamante existente.
  excludedFromStats?: boolean;
}

// Valida el reparto: cada parte con importe no nulo, mismo signo que el padre y suma
// exacta = importe del padre (invariante DATA_MODEL 6.2). Lanza ValidationError si no.
export function assertSplitBalances(parentAmountCents: number, parts: SplitPart[]): void {
  assert(parts.length >= 2, 'Un split necesita al menos dos partes.');
  let sum = 0;
  for (const part of parts) {
    assertCents(part.amountCents);
    assert(part.amountCents !== 0, 'Ninguna parte de un split puede ser de importe cero.');
    // El signo de cada parte debe coincidir con el del padre (no se mezclan gasto/ingreso).
    assert(
      Math.sign(part.amountCents) === Math.sign(parentAmountCents),
      'Cada parte del split debe tener el mismo signo que el movimiento original.',
    );
    if (part.subcategoryId != null) {
      assert(part.categoryId !== null, 'Una subcategoria de split requiere su categoria raiz.');
    }
    sum += part.amountCents;
  }
  assert(
    sum === parentAmountCents,
    `La suma de las partes (${sum}) debe ser igual al importe del movimiento (${parentAmountCents}).`,
  );
}

export const transactionService = {
  list(profileId: string): Promise<Transaction[]> {
    return transactionsRepo.list(profileId);
  },

  getById(profileId: string, id: string): Promise<Transaction | undefined> {
    return transactionsRepo.getById(profileId, id);
  },

  async create(profileId: string, input: TransactionInput): Promise<Transaction> {
    requireProfileId(profileId);
    return transactionsRepo.create(profileId, buildNewTransaction(profileId, input));
  },

  // Edicion individual de un movimiento normal. Recalcula dedupeHash y categorizedBy.
  // No toca los campos de especiales (transferGroupId, parentId, isSplitParent, refundOfId).
  async update(profileId: string, id: string, input: TransactionInput): Promise<Transaction> {
    requireProfileId(profileId);
    requireId(id);
    const concept = normalizeConceptText(input.concept);
    const notes = normalizeNotes(input.notes);
    const categoryId = input.categoryId ?? null;
    const subcategoryId = input.subcategoryId ?? null;
    if (subcategoryId !== null) {
      assert(categoryId !== null, 'Una subcategoria requiere tambien su categoria raiz.');
    }
    const patch: TransactionPatch = {
      date: input.date,
      amountCents: input.amountCents,
      type: input.type,
      concept,
      notes,
      accountId: input.accountId,
      categoryId,
      subcategoryId,
      tagIds: input.tagIds ?? [],
      status: input.status ?? 'cleared',
      categorizedBy: categorizedByFor(categoryId),
      ruleId: null,
      excludedFromStats: input.excludedFromStats ?? false,
      dedupeHash: computeDedupeHash({
        profileId,
        accountId: input.accountId,
        date: input.date,
        amountCents: input.amountCents,
        concept,
      }),
    };
    return transactionsRepo.update(profileId, id, patch);
  },

  // Edicion "segura" de campos no financieros (fecha, concepto, notas, estado, etiquetas)
  // valida para CUALQUIER movimiento, incluidos los especiales (transferencia, padre o
  // linea de split): no toca importe, tipo, cuenta, categoria ni los flags de especiales,
  // por lo que preserva sus invariantes. Recalcula dedupeHash si cambian fecha o concepto.
  async updateDetails(
    profileId: string,
    id: string,
    fields: {
      date?: string;
      concept?: string;
      notes?: string | null;
      status?: TransactionStatus;
      tagIds?: string[];
    },
  ): Promise<Transaction> {
    requireProfileId(profileId);
    requireId(id);
    const existing = await transactionsRepo.getById(profileId, id);
    assert(existing !== undefined, 'El movimiento no existe en el perfil.');
    const current = existing!;
    const patch: TransactionPatch = {};
    const nextDate = fields.date ?? current.date;
    const nextConcept =
      fields.concept !== undefined ? normalizeConceptText(fields.concept) : current.concept;
    if (fields.date !== undefined) patch.date = nextDate;
    if (fields.concept !== undefined) patch.concept = nextConcept;
    if (fields.notes !== undefined) patch.notes = normalizeNotes(fields.notes);
    if (fields.status !== undefined) patch.status = fields.status;
    if (fields.tagIds !== undefined) patch.tagIds = fields.tagIds;
    if (fields.date !== undefined || fields.concept !== undefined) {
      patch.dedupeHash = computeDedupeHash({
        profileId,
        accountId: current.accountId,
        date: nextDate,
        amountCents: current.amountCents,
        concept: nextConcept,
      });
    }
    return transactionsRepo.update(profileId, id, patch);
  },

  // Reune los ids que se borrarian junto a los seleccionados. Un split se borra siempre
  // entero (padre + todas sus hijas): borrar una hija suelta dejaria un split parcial que
  // violaria la invariante "suma de hijas = importe del padre" (DATA_MODEL 6.2). Igual con
  // las dos patas de una transferencia. Devuelve un conjunto sin duplicados, para mostrar
  // un recuento fiel en la confirmacion antes de borrar.
  async collectDeletionIds(profileId: string, ids: string[]): Promise<string[]> {
    requireProfileId(profileId);
    const result = new Set<string>();
    // Padres de split ya expandidos, para no repetir la consulta de hijas.
    const expandedParents = new Set<string>();

    const addSplitFamily = async (parentId: string): Promise<void> => {
      if (expandedParents.has(parentId)) return;
      expandedParents.add(parentId);
      result.add(parentId);
      const children = await transactionsRepo.listChildren(profileId, parentId);
      children.forEach((c) => result.add(c.id));
    };

    for (const id of ids) {
      const tx = await transactionsRepo.getById(profileId, id);
      if (!tx) continue;
      result.add(tx.id);
      // Padre de split: arrastra sus hijas.
      if (tx.isSplitParent) await addSplitFamily(tx.id);
      // Linea hija de split: arrastra su padre y todas las hermanas (split completo).
      if (tx.parentId !== null) await addSplitFamily(tx.parentId);
      // Transferencia: arrastra la pata espejo.
      if (tx.transferGroupId !== null) {
        const legs = await transactionsRepo.listByTransferGroup(profileId, tx.transferGroupId);
        legs.forEach((l) => result.add(l.id));
      }
    }
    return [...result];
  },

  // Borrado individual. Arrastra las patas de transferencia y las lineas de split
  // enlazadas para no dejar movimientos huerfanos. Devuelve cuantos se borraron.
  async remove(profileId: string, id: string): Promise<number> {
    requireProfileId(profileId);
    requireId(id);
    const ids = await transactionService.collectDeletionIds(profileId, [id]);
    return transactionsRepo.removeMany(profileId, ids);
  },

  // Borrado masivo. La UI confirma con el recuento (usar collectDeletionIds para el
  // recuento fiel). Devuelve cuantos se borraron realmente.
  async removeMany(profileId: string, ids: string[]): Promise<number> {
    requireProfileId(profileId);
    const all = await transactionService.collectDeletionIds(profileId, ids);
    return transactionsRepo.removeMany(profileId, all);
  },

  // Edicion masiva atomica. Aplica la misma edicion a todos los ids. Devuelve cuantos
  // movimientos se modificaron.
  async bulkEdit(profileId: string, ids: string[], edit: BulkEdit): Promise<number> {
    requireProfileId(profileId);
    assert(!isEmptyBulkEdit(edit), 'La edicion masiva no contiene ningun cambio.');
    return transactionsRepo.applyToMany(profileId, ids, (t) => patchFromBulkEdit(t, edit));
  },

  // --- Movimientos especiales ---

  // Marca un movimiento como excluido (o incluido) de estadisticas. El repo mantiene
  // statsFlag sincronizado.
  setExcludedFromStats(profileId: string, id: string, excluded: boolean): Promise<Transaction> {
    return transactionsRepo.update(profileId, id, { excludedFromStats: excluded });
  },

  // Marca un movimiento como reembolso de un gasto anterior (enlace simple refundOfId).
  // El reembolso debe existir, ser de otro movimiento y el original ser un gasto.
  async markAsRefund(profileId: string, id: string, refundOfId: string): Promise<Transaction> {
    requireProfileId(profileId);
    assert(id !== refundOfId, 'Un movimiento no puede ser reembolso de si mismo.');
    const original = await transactionsRepo.getById(profileId, refundOfId);
    assert(original !== undefined, 'El gasto original del reembolso no existe en el perfil.');
    assert(
      original!.type === 'expense',
      'Un reembolso debe enlazar con un movimiento de gasto (expense).',
    );
    return transactionsRepo.update(profileId, id, { refundOfId });
  },

  // Quita el enlace de reembolso.
  unmarkRefund(profileId: string, id: string): Promise<Transaction> {
    return transactionsRepo.update(profileId, id, { refundOfId: null });
  },

  // Crea una transferencia interna como par enlazado (DATA_MODEL 6.1): pata de salida
  // (negativa, cuenta origen) y pata de entrada (positiva, cuenta destino). Ambas
  // type='transfer' y excluidas de estadisticas. Devuelve las dos patas creadas.
  async createTransfer(
    profileId: string,
    input: {
      fromAccountId: string;
      toAccountId: string;
      amountCents: number; // magnitud positiva
      date: string;
      concept?: string;
      notes?: string | null;
      status?: TransactionStatus;
    },
  ): Promise<[Transaction, Transaction]> {
    requireProfileId(profileId);
    assertCents(input.amountCents);
    assert(input.amountCents > 0, 'El importe de la transferencia debe ser positivo.');
    assert(
      input.fromAccountId !== input.toAccountId,
      'La cuenta origen y destino de una transferencia deben ser distintas.',
    );
    const concept = normalizeConceptText(input.concept ?? 'Transferencia interna');
    const notes = normalizeNotes(input.notes);
    const status = input.status ?? 'cleared';
    const transferGroupId = crypto.randomUUID();
    const magnitude = Math.abs(input.amountCents);

    const normalizedConcept = normalizeConceptV1(concept);
    const commonBase = {
      type: 'transfer' as const,
      concept,
      notes,
      categoryId: null,
      subcategoryId: null,
      tagIds: [] as string[],
      status,
      categorizedBy: 'none' as const,
      ruleId: null,
      transferGroupId,
      parentId: null,
      isSplitParent: false,
      refundOfId: null,
      excludedFromStats: true, // una transferencia no es gasto ni ingreso
      importBatchId: null,
      date: input.date,
      // Una transferencia no tiene comercio: mueve dinero propio, no es una compra.
      rawConcept: concept,
      normalizedConcept,
      normalizationVersion: NORMALIZATION_VERSION,
      merchantId: null,
      merchantMatchSource: 'none' as const,
      merchantMatchConfidence: 0,
      // Sin metadatos bancarios (alta manual de transferencia, fase 5).
      bankTransactionId: null,
      bookingDate: null,
      valueDate: null,
      pending: false,
      currency: DEFAULT_CURRENCY,
      balanceAfterCents: null,
      bankReference: null,
      operationType: null,
      fingerprintVersion: FINGERPRINT_VERSION,
      sourceFileHash: null,
      sourceFileSize: null,
      duplicateStatus: 'unique' as const,
      duplicateConfidence: 0,
      duplicateReasonCodes: [] as string[],
      duplicateCandidateIds: [] as string[],
      pendingReplacementId: null,
    };

    const outFingerprints = computeFingerprints({
      accountId: input.fromAccountId,
      date: input.date,
      amountCents: -magnitude,
      currency: DEFAULT_CURRENCY,
      normalizedConcept,
      merchantId: null,
    });
    const out: NewTransaction = {
      ...commonBase,
      amountCents: -magnitude,
      accountId: input.fromAccountId,
      dedupeHash: computeDedupeHash({
        profileId,
        accountId: input.fromAccountId,
        date: input.date,
        amountCents: -magnitude,
        concept,
      }),
      sourceRowHash: computeSyntheticRowHash({
        date: input.date,
        amountCents: -magnitude,
        concept,
        accountId: input.fromAccountId,
      }),
      ...outFingerprints,
    };
    const incomeFingerprints = computeFingerprints({
      accountId: input.toAccountId,
      date: input.date,
      amountCents: magnitude,
      currency: DEFAULT_CURRENCY,
      normalizedConcept,
      merchantId: null,
    });
    const income: NewTransaction = {
      ...commonBase,
      amountCents: magnitude,
      accountId: input.toAccountId,
      dedupeHash: computeDedupeHash({
        profileId,
        accountId: input.toAccountId,
        date: input.date,
        amountCents: magnitude,
        concept,
      }),
      sourceRowHash: computeSyntheticRowHash({
        date: input.date,
        amountCents: magnitude,
        concept,
        accountId: input.toAccountId,
      }),
      ...incomeFingerprints,
    };
    const [a, b] = await transactionsRepo.createMany(profileId, [out, income]);
    return [a!, b!];
  },

  // Vincula DOS movimientos EXISTENTES (p. ej. detectados como "transferencia candidata" por
  // la bandeja de revision, ampliacion fase 6) como las dos patas de una transferencia interna.
  // A diferencia de createTransfer (que crea un par nuevo desde cero), esto NUNCA reescribe
  // concept/fecha/importe/comercio de los movimientos originales: solo los reclasifica
  // (type='transfer', excludedFromStats=true, sin categoria) y les asigna un transferGroupId
  // compartido (DATA_MODEL 6.1). Revalida los mismos requisitos duros que el motor de
  // deteccion (cuentas distintas, importe absoluto igual, signos opuestos, ninguno ya
  // vinculado): la sugerencia pudo quedar desactualizada entre la deteccion y la confirmacion.
  async linkAsTransfer(profileId: string, idA: string, idB: string): Promise<[Transaction, Transaction]> {
    requireProfileId(profileId);
    assert(idA !== idB, 'Un movimiento no puede formar una transferencia consigo mismo.');
    const [a, b] = await Promise.all([
      transactionsRepo.getById(profileId, idA),
      transactionsRepo.getById(profileId, idB),
    ]);
    assert(a !== undefined && b !== undefined, 'Alguno de los movimientos no existe en el perfil.');
    assert(
      a!.transferGroupId === null && b!.transferGroupId === null,
      'Alguno de los movimientos ya pertenece a una transferencia.',
    );
    assert(a!.accountId !== b!.accountId, 'Una transferencia debe unir cuentas distintas.');
    assert(
      Math.abs(a!.amountCents) === Math.abs(b!.amountCents),
      'El importe absoluto de las dos patas debe coincidir.',
    );
    assert(
      (a!.amountCents > 0) !== (b!.amountCents > 0),
      'Las dos patas de una transferencia deben tener signos opuestos.',
    );
    const transferGroupId = crypto.randomUUID();
    const patch = {
      type: 'transfer' as const,
      transferGroupId,
      categoryId: null,
      subcategoryId: null,
      excludedFromStats: true,
    };
    const updatedA = await transactionsRepo.update(profileId, idA, patch);
    const updatedB = await transactionsRepo.update(profileId, idB, patch);
    return [updatedA, updatedB];
  },

  // Convierte un movimiento existente en una transferencia interna: lo enlaza como una
  // pata y crea la pata espejo en la cuenta indicada. El movimiento pasa a type='transfer'
  // y excluido de estadisticas; pierde categoria. No aplica a splits ni a lo ya enlazado.
  async markAsTransfer(
    profileId: string,
    id: string,
    counterAccountId: string,
  ): Promise<[Transaction, Transaction]> {
    requireProfileId(profileId);
    const tx = await transactionsRepo.getById(profileId, id);
    assert(tx !== undefined, 'El movimiento no existe en el perfil.');
    const current = tx!;
    assert(current.transferGroupId === null, 'El movimiento ya es una transferencia.');
    assert(!current.isSplitParent, 'Un movimiento dividido (split) no puede marcarse como transferencia.');
    assert(current.parentId === null, 'Una linea de split no puede marcarse como transferencia.');
    assert(current.amountCents !== 0, 'Un movimiento de importe cero no puede ser transferencia.');
    assert(
      counterAccountId !== current.accountId,
      'La cuenta espejo debe ser distinta de la cuenta del movimiento.',
    );

    const transferGroupId = crypto.randomUUID();
    const updated = await transactionsRepo.update(profileId, id, {
      type: 'transfer',
      transferGroupId,
      excludedFromStats: true,
      categoryId: null,
      subcategoryId: null,
      categorizedBy: 'none',
      ruleId: null,
      refundOfId: null,
    });

    const mirrorAmount = -current.amountCents;
    const mirror: NewTransaction = {
      date: current.date,
      amountCents: mirrorAmount,
      type: 'transfer',
      concept: current.concept,
      notes: current.notes,
      accountId: counterAccountId,
      categoryId: null,
      subcategoryId: null,
      tagIds: [],
      status: current.status,
      categorizedBy: 'none',
      ruleId: null,
      transferGroupId,
      parentId: null,
      isSplitParent: false,
      refundOfId: null,
      excludedFromStats: true,
      importBatchId: null,
      dedupeHash: computeDedupeHash({
        profileId,
        accountId: counterAccountId,
        date: current.date,
        amountCents: mirrorAmount,
        concept: current.concept,
      }),
      // La pata espejo no es una compra: sin comercio, aunque conserva el concepto original.
      rawConcept: current.rawConcept,
      normalizedConcept: current.normalizedConcept,
      normalizationVersion: current.normalizationVersion,
      merchantId: null,
      merchantMatchSource: 'none',
      merchantMatchConfidence: 0,
      // Sin metadatos bancarios (pata espejo generada localmente, fase 5).
      bankTransactionId: null,
      bookingDate: null,
      valueDate: null,
      pending: false,
      currency: current.currency,
      balanceAfterCents: null,
      bankReference: null,
      operationType: null,
      sourceRowHash: computeSyntheticRowHash({
        date: current.date,
        amountCents: mirrorAmount,
        concept: current.concept,
        accountId: counterAccountId,
      }),
      ...computeFingerprints({
        accountId: counterAccountId,
        date: current.date,
        amountCents: mirrorAmount,
        currency: current.currency,
        normalizedConcept: current.normalizedConcept,
        merchantId: null,
      }),
      fingerprintVersion: FINGERPRINT_VERSION,
      sourceFileHash: null,
      sourceFileSize: null,
      duplicateStatus: 'unique',
      duplicateConfidence: 0,
      duplicateReasonCodes: [],
      duplicateCandidateIds: [],
      pendingReplacementId: null,
    };
    const [created] = await transactionsRepo.createMany(profileId, [mirror]);
    return [updated, created!];
  },

  // Deshace una transferencia: borra la pata espejo y restaura el movimiento a gasto o
  // ingreso segun su signo, incluyendolo de nuevo en estadisticas. Recibe el id de
  // cualquiera de las dos patas y conserva la que se indica.
  async unmarkTransfer(profileId: string, keepId: string): Promise<Transaction> {
    requireProfileId(profileId);
    const tx = await transactionsRepo.getById(profileId, keepId);
    assert(tx !== undefined, 'El movimiento no existe en el perfil.');
    const current = tx!;
    assert(current.transferGroupId !== null, 'El movimiento no es una transferencia.');
    const legs = await transactionsRepo.listByTransferGroup(profileId, current.transferGroupId!);
    const others = legs.filter((l) => l.id !== keepId).map((l) => l.id);
    if (others.length > 0) await transactionsRepo.removeMany(profileId, others);
    // Restaura el tipo segun el signo del importe (gasto negativo, ingreso positivo).
    const restoredType: TransactionType = current.amountCents < 0 ? 'expense' : 'income';
    return transactionsRepo.update(profileId, keepId, {
      type: restoredType,
      transferGroupId: null,
      excludedFromStats: false,
    });
  },

  // Divide un movimiento en partes (split). Valida que la suma de partes = importe del
  // padre. El padre queda isSplitParent=true y excluido de estadisticas; las hijas
  // cuentan (llevan la categoria real). Reemplaza cualquier split previo del movimiento.
  async splitTransaction(
    profileId: string,
    parentId: string,
    parts: SplitPart[],
  ): Promise<Transaction[]> {
    requireProfileId(profileId);
    const parent = await transactionsRepo.getById(profileId, parentId);
    assert(parent !== undefined, 'El movimiento a dividir no existe en el perfil.');
    const p = parent!;
    assert(p.parentId === null, 'Una linea de split no puede volver a dividirse.');
    assert(p.transferGroupId === null, 'Una transferencia no puede dividirse.');
    assertSplitBalances(p.amountCents, parts);

    // Las hijas heredan la exclusion del padre para que dividir sea neutro respecto a las
    // estadisticas: si el padre ya estaba excluido, las hijas tambien lo estan (el neto no
    // cambia); si contaba, las hijas cuentan con su categoria real y el padre se excluye
    // para no duplicar. Al re-dividir, se toma la exclusion "original" de una hija previa
    // (el padre ya esta forzado a excluido por el split anterior).
    const previous = await transactionsRepo.listChildren(profileId, parentId);
    const inheritedExcluded =
      previous.length > 0 ? previous.every((c) => c.excludedFromStats) : p.excludedFromStats;

    // Reemplaza hijas previas si el movimiento ya estaba dividido.
    if (previous.length > 0) {
      await transactionsRepo.removeMany(
        profileId,
        previous.map((c) => c.id),
      );
    }

    const children: NewTransaction[] = parts.map((part) => {
      const concept = normalizeConceptText(part.concept ?? p.concept);
      const categoryId = part.categoryId ?? null;
      const subcategoryId = part.subcategoryId ?? null;
      return {
        date: p.date,
        amountCents: part.amountCents,
        type: p.type,
        concept,
        notes: normalizeNotes(part.notes),
        accountId: p.accountId,
        categoryId,
        subcategoryId,
        tagIds: part.tagIds ?? [],
        status: p.status,
        categorizedBy: categorizedByFor(categoryId),
        ruleId: null,
        transferGroupId: null,
        parentId,
        isSplitParent: false,
        refundOfId: null,
        // Las hijas cuentan en estadisticas salvo que el padre estuviera excluido (herencia),
        // salvo que esta parte concreta fije su propia exclusion (ver SplitPart.excludedFromStats).
        excludedFromStats: part.excludedFromStats ?? inheritedExcluded,
        importBatchId: null,
        dedupeHash: computeDedupeHash({
          profileId,
          accountId: p.accountId,
          date: p.date,
          amountCents: part.amountCents,
          concept,
        }),
        // Las lineas de split son porciones del MISMO movimiento bancario original: heredan
        // el concepto original inmutable y la asociacion de comercio del padre.
        rawConcept: p.rawConcept,
        normalizedConcept: p.normalizedConcept,
        normalizationVersion: p.normalizationVersion,
        merchantId: p.merchantId,
        merchantMatchSource: p.merchantMatchSource,
        merchantMatchConfidence: p.merchantMatchConfidence,
        // Metadatos bancarios (fase 5): las hijas heredan lo que describe el extracto original
        // (fechas, moneda, referencia, pendiente, fichero de origen). bankTransactionId NUNCA
        // se copia a varias filas: la unicidad remota es (profile_id, account_id,
        // bank_transaction_id) y el padre ya lo conserva; duplicarlo en las hijas rechazaria
        // la insercion remota.
        bankTransactionId: null,
        bookingDate: p.bookingDate,
        valueDate: p.valueDate,
        pending: p.pending,
        currency: p.currency,
        balanceAfterCents: null,
        bankReference: p.bankReference,
        operationType: p.operationType,
        sourceRowHash: computeSyntheticRowHash({
          date: p.date,
          amountCents: part.amountCents,
          concept,
          accountId: p.accountId,
        }),
        ...computeFingerprints({
          accountId: p.accountId,
          date: p.date,
          amountCents: part.amountCents,
          currency: p.currency,
          normalizedConcept: p.normalizedConcept,
          merchantId: p.merchantId,
        }),
        fingerprintVersion: FINGERPRINT_VERSION,
        sourceFileHash: p.sourceFileHash,
        sourceFileSize: null,
        duplicateStatus: 'unique',
        duplicateConfidence: 0,
        duplicateReasonCodes: [],
        duplicateCandidateIds: [],
        pendingReplacementId: null,
      };
    });

    // El padre se marca dividido y se excluye del computo para no duplicar (las hijas ya
    // aportan). No se toca su categoria: deja de contar por estar excluido.
    await transactionsRepo.update(profileId, parentId, {
      isSplitParent: true,
      excludedFromStats: true,
    });
    return transactionsRepo.createMany(profileId, children);
  },

  // Deshace un split: borra las hijas y devuelve el padre a estado no dividido. Restaura la
  // exclusion original del padre (deducida de las hijas: si estaban excluidas, el padre lo
  // estaba antes de dividir) para que el ciclo dividir/deshacer sea neutro en estadisticas.
  async unsplitTransaction(profileId: string, parentId: string): Promise<Transaction> {
    requireProfileId(profileId);
    const parent = await transactionsRepo.getById(profileId, parentId);
    assert(parent !== undefined, 'El movimiento no existe en el perfil.');
    const children = await transactionsRepo.listChildren(profileId, parentId);
    const restoredExcluded =
      children.length > 0 ? children.every((c) => c.excludedFromStats) : false;
    if (children.length > 0) {
      await transactionsRepo.removeMany(
        profileId,
        children.map((c) => c.id),
      );
    }
    return transactionsRepo.update(profileId, parentId, {
      isSplitParent: false,
      excludedFromStats: restoredExcluded,
    });
  },
};
