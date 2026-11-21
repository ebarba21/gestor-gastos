// Informe por etiqueta (noviembre 2026): cuanto costo un viaje o un proyecto marcado con una
// etiqueta ("Viaje Lisboa 2026"), aunque sus gastos esten repartidos en varias categorias
// (Vacaciones > Comida, Vacaciones > Alojamiento, Transporte...).
//
// Misma semantica de gasto neto que el dashboard (netExpenseContribution): los Bizum recibidos y
// reembolsos restan, lo apartado a ahorro no cuenta, las transferencias no cuentan. Un reembolso
// enlazado a un gasto etiquetado cuenta para la etiqueta aunque el reembolso no la lleve.
import type { Category, Tag, Transaction } from '../db/schema';
import { categoriesRepo } from '../db/categoriesRepo';
import { tagsRepo } from '../db/tagsRepo';
import { transactionsRepo } from '../db/transactionsRepo';
import { daysBetweenISO } from '../lib/dates';
import { requireProfileId } from '../lib/validation';
import { buildStatsContext, netExpenseContribution } from './statsService';

export interface TagReportLine {
  id: string | null; // categoria (o subcategoria) o comercio; null = sin categoria
  label: string;
  cents: number; // gasto neto
}

export interface TagReport {
  tagId: string;
  tagName: string;
  movementCount: number;
  netCents: number; // gasto neto total
  grossCents: number; // gasto bruto (antes de devoluciones y Bizum recibidos)
  returnedCents: number; // lo que restan reembolsos y Bizum recibidos (positivo)
  firstDate: string | null;
  lastDate: string | null;
  days: number; // dias entre el primer y el ultimo movimiento, ambos incluidos
  perDayCents: number | null;
  byCategory: TagReportLine[]; // por categoria raiz
  bySubcategory: TagReportLine[]; // por la categoria mas concreta (subcategoria si la hay)
  byMerchant: TagReportLine[]; // top 5 comercios o conceptos
  transactionIds: string[];
}

export function computeTagReport(
  tag: Pick<Tag, 'id' | 'name'>,
  transactions: Transaction[],
  categories: Category[],
  merchantNames: Map<string, string> = new Map(),
): TagReport {
  const ctx = buildStatsContext(categories, transactions);
  const names = new Map(categories.map((c) => [c.id, c.name]));
  const tagged = new Set(transactions.filter((t) => t.tagIds.includes(tag.id)).map((t) => t.id));
  const byId = new Map(transactions.map((t) => [t.id, t]));
  // Movimientos del informe: los etiquetados y los reembolsos enlazados a uno etiquetado.
  const members = transactions.filter((t) => tagged.has(t.id) || (t.refundOfId !== null && tagged.has(t.refundOfId)));

  let net = 0;
  let gross = 0;
  let returned = 0;
  let first: string | null = null;
  let last: string | null = null;
  const cat = new Map<string | null, number>();
  const sub = new Map<string | null, number>();
  const merch = new Map<string, { label: string; cents: number; id: string | null }>();
  const ids: string[] = [];
  for (const t of members) {
    const c = netExpenseContribution(t, ctx);
    if (!c) continue;
    ids.push(t.id);
    net += c.cents;
    if (c.cents > 0) gross += c.cents;
    else returned += -c.cents;
    if (first === null || t.date < first) first = t.date;
    if (last === null || t.date > last) last = t.date;
    cat.set(c.rootCategoryId, (cat.get(c.rootCategoryId) ?? 0) + c.cents);
    // Categoria mas concreta: la del propio movimiento o, en un reembolso, la del gasto original.
    const ref = t.refundOfId !== null ? byId.get(t.refundOfId) ?? t : t;
    const leaf = ref.subcategoryId ?? ref.categoryId;
    sub.set(leaf, (sub.get(leaf) ?? 0) + c.cents);
    const mKey = ref.merchantId !== null ? `m:${ref.merchantId}` : `c:${ref.normalizedConcept}`;
    const mLabel = ref.merchantId !== null ? merchantNames.get(ref.merchantId) ?? ref.concept : ref.concept;
    const m = merch.get(mKey) ?? { label: mLabel, cents: 0, id: ref.merchantId };
    m.cents += c.cents;
    merch.set(mKey, m);
  }
  const toLines = (m: Map<string | null, number>): TagReportLine[] =>
    [...m.entries()]
      .filter(([, v]) => v !== 0)
      .map(([id, cents]) => ({ id, label: id === null ? 'Sin categoría' : names.get(id) ?? 'Categoría', cents }))
      .sort((a, b) => b.cents - a.cents || a.label.localeCompare(b.label));
  const days = first !== null && last !== null ? daysBetweenISO(first, last) + 1 : 0;
  return {
    tagId: tag.id,
    tagName: tag.name,
    movementCount: ids.length,
    netCents: net,
    grossCents: gross,
    returnedCents: returned,
    firstDate: first,
    lastDate: last,
    days,
    perDayCents: days > 0 ? Math.round(net / days) : null,
    byCategory: toLines(cat),
    bySubcategory: toLines(sub),
    byMerchant: [...merch.values()]
      .filter((m) => m.cents > 0)
      .sort((a, b) => b.cents - a.cents || a.label.localeCompare(b.label))
      .slice(0, 5)
      .map((m) => ({ id: m.id, label: m.label, cents: m.cents })),
    transactionIds: ids,
  };
}

export const tagReportService = {
  async listTags(profileId: string): Promise<Tag[]> {
    requireProfileId(profileId);
    return tagsRepo.list(profileId);
  },
  async compute(profileId: string, tagId: string, merchantNames?: Map<string, string>): Promise<TagReport> {
    requireProfileId(profileId);
    const [tags, transactions, categories] = await Promise.all([
      tagsRepo.list(profileId),
      transactionsRepo.list(profileId),
      categoriesRepo.list(profileId),
    ]);
    const tag = tags.find((t) => t.id === tagId);
    if (!tag) throw new Error('La etiqueta no existe en este perfil.');
    return computeTagReport(tag, transactions, categories, merchantNames);
  },
};
