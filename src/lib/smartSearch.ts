// Busqueda con sintaxis sencilla en Movimientos (noviembre 2026). Convierte lo que escribes en
// filtros y te ensena como lo ha entendido, en vez de buscar solo texto literal:
//   "mercadona octubre"    -> concepto "mercadona" + octubre (del ano en curso o el anterior)
//   ">100 restaurantes"    -> importe mayor de 100 EUR + categoria Restaurantes
//   "sin categoria"        -> solo sin categorizar
//   "#viaje lisboa"        -> etiqueta "viaje lisboa"
//   "revolut 2025"         -> cuenta Revolut + ano 2025
//   "gastos", "ingresos"   -> tipo de movimiento
// Lo que no se reconoce sigue buscando en concepto y notas. Funcion PURA: recibe los nombres de
// categorias, cuentas y etiquetas del perfil ya cargados.
import type { Account, Category, Tag, TransactionType } from '../db/schema';
import { normalizeConcept } from './dedupe';
import { daysInMonth, toISO } from './dates';
import type { TxFilter } from './transactionFilters';

export interface SmartSearchContext {
  categories: Pick<Category, 'id' | 'name' | 'parentId' | 'archivedAt'>[];
  accounts: Pick<Account, 'id' | 'name' | 'archivedAt'>[];
  tags: Pick<Tag, 'id' | 'name'>[];
  today: string; // YYYY-MM-DD
}

export interface SmartSearchResult {
  filter: TxFilter; // solo las partes reconocidas + el texto restante en `search`
  chips: string[]; // como se ha interpretado, para ensenarlo
}

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MONTH_ALIASES: Record<string, number> = { setiembre: 9 };

function parseEuros(text: string): number | null {
  const n = Number(text.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

function formatEurosShort(cents: number): string {
  return `${(cents / 100).toLocaleString('es-ES', { maximumFractionDigits: 2 })} €`;
}

// Nombre que casa con la palabra: igual, o la palabra es un prefijo de al menos 4 letras de una
// palabra del nombre ("restaurante" -> "Restaurantes", "super" -> "Supermercado").
function nameMatches(name: string, words: string[]): boolean {
  const n = normalizeConcept(name);
  const phrase = words.join(' ');
  if (n === phrase) return true;
  if (phrase.length < 4) return false;
  return n.startsWith(phrase) || n.split(' ').some((w) => w.startsWith(phrase));
}

export function parseSmartSearch(text: string, ctx: SmartSearchContext): SmartSearchResult {
  // Se tokeniza el texto original (conserva >, <, #, que normalizeConcept quitaria).
  const raw = text.trim().toLowerCase().split(/\s+/).filter((t) => t.length > 0);
  const filter: TxFilter = {};
  const chips: string[] = [];
  const rest: string[] = [];
  const thisYear = Number(ctx.today.slice(0, 4));
  const thisMonth = Number(ctx.today.slice(5, 7));
  let month: number | null = null;
  let year: number | null = null;

  const used = new Set<number>(); // indices de `raw` ya interpretados
  for (let i = 0; i < raw.length; i++) {
    const t = raw[i]!;
    // Importe: >100, <50, >=20, <=20 (en euros, sobre la magnitud del movimiento).
    const amount = /^(>=|<=|>|<)(\d+(?:[.,]\d{1,2})?)$/.exec(t);
    if (amount) {
      const cents = parseEuros(amount[2]!);
      if (cents !== null) {
        if (amount[1]!.startsWith('>')) {
          filter.absAmountMinCents = amount[1] === '>' ? cents + 1 : cents;
          chips.push(`Importe ${amount[1]} ${formatEurosShort(cents)}`);
        } else {
          filter.absAmountMaxCents = amount[1] === '<' ? cents - 1 : cents;
          chips.push(`Importe ${amount[1]} ${formatEurosShort(cents)}`);
        }
        used.add(i);
        continue;
      }
    }
    // Etiqueta: #nombre (puede llevar varias palabras: se prueba la frase mas larga primero).
    if (t.startsWith('#') && t.length > 1) {
      let matched = false;
      for (let len = raw.length - i; len >= 1 && !matched; len--) {
        const words = normalizeConcept([t.slice(1), ...raw.slice(i + 1, i + len)].join(' ')).split(' ');
        const tag = ctx.tags.find((g) => nameMatches(g.name, words));
        if (tag) {
          filter.tagIds = [...(filter.tagIds ?? []), tag.id];
          chips.push(`Etiqueta: ${tag.name}`);
          for (let k = i; k < i + len; k++) used.add(k);
          i += len - 1;
          matched = true;
        }
      }
      if (matched) continue;
    }
  }

  // El resto se analiza con el texto normalizado, palabra a palabra, sin lo ya usado.
  const remaining = raw
    .map((t, idx) => (used.has(idx) ? null : t))
    .filter((t): t is string => t !== null)
    .flatMap((t) => normalizeConcept(t).split(' '))
    .filter((t) => t.length > 0);

  for (let i = 0; i < remaining.length; i++) {
    const w = remaining[i]!;
    const next = remaining[i + 1];
    if (w === 'sin' && (next === 'categoria' || next === 'categorizar')) {
      filter.onlyUncategorized = true;
      chips.push('Sin categoría');
      i++;
      continue;
    }
    const monthIdx = MONTHS.indexOf(w);
    if (monthIdx >= 0 || MONTH_ALIASES[w] !== undefined) {
      month = monthIdx >= 0 ? monthIdx + 1 : MONTH_ALIASES[w]!;
      continue;
    }
    if (/^(19|20)\d{2}$/.test(w)) {
      year = Number(w);
      continue;
    }
    if (w === 'gastos' || w === 'gasto' || w === 'ingresos' || w === 'ingreso' || w === 'transferencias') {
      const type: TransactionType = w.startsWith('gasto') ? 'expense' : w.startsWith('ingreso') ? 'income' : 'transfer';
      filter.types = [...new Set([...(filter.types ?? []), type])];
      chips.push(type === 'expense' ? 'Gastos' : type === 'income' ? 'Entradas' : 'Transferencias');
      continue;
    }
    // Categoria o subcategoria (frase de hasta 3 palabras, la mas larga primero).
    let matched = false;
    for (let len = Math.min(3, remaining.length - i); len >= 1 && !matched; len--) {
      const words = remaining.slice(i, i + len);
      const cat = ctx.categories.find((c) => c.archivedAt === null && nameMatches(c.name, words));
      if (cat) {
        if (cat.parentId === null) filter.categoryIds = [...(filter.categoryIds ?? []), cat.id];
        else filter.subcategoryIds = [...(filter.subcategoryIds ?? []), cat.id];
        chips.push(`Categoría: ${cat.name}`);
        i += len - 1;
        matched = true;
        break;
      }
      const acc = ctx.accounts.find((a) => a.archivedAt === null && nameMatches(a.name, words));
      if (acc) {
        filter.accountIds = [...(filter.accountIds ?? []), acc.id];
        chips.push(`Cuenta: ${acc.name}`);
        i += len - 1;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    rest.push(w);
  }

  if (month !== null) {
    // Sin ano: el mes mas reciente con ese nombre (si aun no ha llegado este ano, el pasado).
    const y = year ?? (month > thisMonth ? thisYear - 1 : thisYear);
    filter.dateFrom = toISO(y, month, 1);
    filter.dateTo = toISO(y, month, daysInMonth(y, month));
    chips.push(`${MONTHS[month - 1]![0]!.toUpperCase()}${MONTHS[month - 1]!.slice(1)} ${y}`);
  } else if (year !== null) {
    filter.dateFrom = toISO(year, 1, 1);
    filter.dateTo = toISO(year, 12, 31);
    chips.push(`Año ${year}`);
  }

  if (rest.length > 0) {
    filter.search = rest.join(' ');
    chips.unshift(`Texto: "${filter.search}"`);
  }
  return { filter, chips };
}

// Combina el filtro de la barra (paneles) con lo interpretado de la busqueda. Las condiciones se
// suman (interseccion): lo escrito afina lo elegido en los paneles, nunca lo amplia.
export function mergeSmartFilter(base: TxFilter, parsed: TxFilter): TxFilter {
  const pick = <T>(a: T[] | undefined, b: T[] | undefined): T[] | undefined => {
    if (!a || a.length === 0) return b;
    if (!b || b.length === 0) return a;
    const inter = a.filter((x) => b.includes(x));
    // Interseccion vacia: no hay ningun movimiento que cumpla ambas. Se representa con un id
    // imposible para que el filtro devuelva una lista vacia en vez de ignorar la condicion.
    return inter.length > 0 ? inter : (['__ninguno__'] as unknown as T[]);
  };
  const maxOf = (a?: string, b?: string) => (a && b ? (a > b ? a : b) : a ?? b);
  const minOf = (a?: string, b?: string) => (a && b ? (a < b ? a : b) : a ?? b);
  const maxN = (a?: number, b?: number) => (a !== undefined && b !== undefined ? Math.max(a, b) : a ?? b);
  const minN = (a?: number, b?: number) => (a !== undefined && b !== undefined ? Math.min(a, b) : a ?? b);
  return {
    ...base,
    search: parsed.search,
    accountIds: pick(base.accountIds, parsed.accountIds),
    categoryIds: pick(base.categoryIds, parsed.categoryIds),
    subcategoryIds: pick(base.subcategoryIds, parsed.subcategoryIds),
    tagIds: pick(base.tagIds, parsed.tagIds),
    types: pick(base.types, parsed.types),
    dateFrom: maxOf(base.dateFrom, parsed.dateFrom),
    dateTo: minOf(base.dateTo, parsed.dateTo),
    absAmountMinCents: maxN(base.absAmountMinCents, parsed.absAmountMinCents),
    absAmountMaxCents: minN(base.absAmountMaxCents, parsed.absAmountMaxCents),
    onlyUncategorized: base.onlyUncategorized || parsed.onlyUncategorized || undefined,
  };
}
