// Sugerencia de regla al corregir la categoria de un movimiento (noviembre 2026): "¿Aplicar
// siempre esta regla?". Convierte una correccion repetitiva en una regla, con la palabra clave
// mas estable del concepto. No se sugiere para conceptos genericos (Bizum, transferencias),
// que por los criterios del perfil son un cajon de sastre y dependen del caso.
import type { Rule, Transaction } from '../db/schema';
import { normalizeConcept } from '../lib/dedupe';
import { ruleService } from './ruleService';
import { requireProfileId } from '../lib/validation';

export interface RuleSuggestion {
  keyword: string; // texto que debe contener el concepto (sin distinguir mayusculas)
  categoryId: string;
  subcategoryId: string | null;
  name: string;
}

// Palabras que hacen el concepto demasiado generico para una regla.
const GENERIC = new Set(['bizum', 'transferencia', 'traspaso', 'transfer']);
// Ruido habitual de los extractos.
const NOISE = new Set([
  'tarj', 'tarjeta', 'card', 'compra', 'pago', 'cargo', 'recibo', 'abono', 'com', 'www', 'es', 'sl', 'sa', 'en', 'de', 'la', 'el', 'y',
]);

export function suggestRule(
  tx: Pick<Transaction, 'rawConcept' | 'concept'>,
  merchantName: string | null,
  categoryId: string | null,
  subcategoryId: string | null,
  categoryLabel: string,
): RuleSuggestion | null {
  if (categoryId === null) return null;
  const tokens = normalizeConcept(tx.rawConcept || tx.concept)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
  if (tokens.some((t) => GENERIC.has(t))) return null;
  let keyword: string | null = null;
  if (merchantName !== null) {
    const m = normalizeConcept(merchantName).trim();
    if (m.length >= 3 && normalizeConcept(tx.rawConcept || tx.concept).includes(m)) keyword = m;
  }
  if (keyword === null) {
    const words = tokens.filter((t) => !/\d/.test(t) && !NOISE.has(t) && t.length >= 3).slice(0, 2);
    if (words.length === 0) return null;
    // Una sola palabra si es suficientemente distintiva; si no, las dos primeras seguidas.
    keyword = words[0]!.length >= 5 || words.length === 1 ? words[0]! : words.join(' ');
    if (!normalizeConcept(tx.rawConcept || tx.concept).includes(keyword)) keyword = words[0]!;
  }
  if (keyword.length < 3) return null;
  return { keyword, categoryId, subcategoryId, name: `${keyword} → ${categoryLabel}`.slice(0, 60) };
}

export const ruleSuggestionService = {
  // Crea la regla con la maxima prioridad (la correccion del usuario manda sobre reglas
  // genericas anteriores) y la aplica al historico sin tocar lo categorizado a mano.
  async accept(profileId: string, s: RuleSuggestion): Promise<{ rule: Rule; changed: number }> {
    requireProfileId(profileId);
    const rule = await ruleService.create(profileId, {
      name: s.name,
      enabled: true,
      matchMode: 'all',
      conditions: [{ field: 'concept', operator: 'contains', value: s.keyword, value2: null, caseSensitive: false }],
      action: { setCategoryId: s.categoryId, setSubcategoryId: s.subcategoryId, addTagIds: [], setExcludedFromStats: null },
      stopOnMatch: true,
    });
    const all = await ruleService.list(profileId);
    await ruleService.reorder(profileId, [rule.id, ...all.filter((r) => r.id !== rule.id).map((r) => r.id)]);
    const fresh = (await ruleService.list(profileId)).find((r) => r.id === rule.id) ?? rule;
    const { changed } = await ruleService.applyRetroactive(profileId, [fresh]);
    return { rule: fresh, changed };
  },
};
