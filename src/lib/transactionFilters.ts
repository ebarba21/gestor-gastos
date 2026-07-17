// Filtrado, busqueda y orden de movimientos. Funciones PURAS (sin acceso a datos), para
// poder testearlas de forma aislada y reutilizarlas en la UI. Operan sobre arrays ya
// cargados de un unico perfil (el aislamiento lo garantiza la capa de repositorios).
import type { Transaction, TransactionStatus, TransactionType } from '../db/schema';
import { normalizeConcept } from './dedupe';

// Como tratar los movimientos excluidos de estadisticas al filtrar.
//  - 'all': no filtra por exclusion.
//  - 'only': solo los excluidos.
//  - 'exclude': solo los que SI cuentan.
export type ExcludedFilter = 'all' | 'only' | 'exclude';

export interface TxFilter {
  // Texto libre: busca en concepto y notas (sin acentos, sin mayusculas).
  search?: string;
  accountIds?: string[];
  categoryIds?: string[];
  subcategoryIds?: string[];
  tagIds?: string[]; // coincide si el movimiento lleva ALGUNA de estas etiquetas
  types?: TransactionType[];
  statuses?: TransactionStatus[];
  dateFrom?: string; // YYYY-MM-DD inclusive
  dateTo?: string; // YYYY-MM-DD inclusive
  amountMinCents?: number; // rango sobre el importe con signo (centimos)
  amountMaxCents?: number;
  excluded?: ExcludedFilter;
  onlyUncategorized?: boolean; // solo movimientos sin categoria
  // Ocultar las lineas hijas de un split (por defecto la lista muestra el padre).
  hideSplitChildren?: boolean;
  // Filtra por lote de importacion de origen (ampliacion fase 6: enlace desde el resumen de
  // importacion al dashboard de movimientos filtrado por ese lote).
  importBatchId?: string;
}

export type SortField =
  | 'date'
  | 'concept'
  | 'amount'
  | 'category'
  | 'subcategory'
  | 'account'
  | 'type'
  | 'status';
export type SortDir = 'asc' | 'desc';

export interface TxSort {
  field: SortField;
  dir: SortDir;
}

// Mapas de nombre para ordenar por categoria/cuenta (la UI los provee). Opcionales:
// si faltan, esos campos se ordenan por id como respaldo estable.
export interface SortNameLookups {
  categoryNames?: Map<string, string>;
  accountNames?: Map<string, string>;
}

function matchesAnyTag(txTagIds: string[], wanted: string[]): boolean {
  if (wanted.length === 0) return true;
  return txTagIds.some((t) => wanted.includes(t));
}

// Aplica un filtro a un array de movimientos. No muta la entrada.
export function filterTransactions(txs: Transaction[], filter: TxFilter): Transaction[] {
  const search = filter.search ? normalizeConcept(filter.search) : '';
  const hasSearch = search.length > 0;

  return txs.filter((t) => {
    if (filter.hideSplitChildren && t.parentId !== null) return false;

    if (hasSearch) {
      const inConcept = normalizeConcept(t.concept).includes(search);
      const inNotes = t.notes ? normalizeConcept(t.notes).includes(search) : false;
      if (!inConcept && !inNotes) return false;
    }

    if (filter.accountIds && filter.accountIds.length > 0) {
      if (!filter.accountIds.includes(t.accountId)) return false;
    }
    if (filter.categoryIds && filter.categoryIds.length > 0) {
      if (t.categoryId === null || !filter.categoryIds.includes(t.categoryId)) return false;
    }
    if (filter.subcategoryIds && filter.subcategoryIds.length > 0) {
      if (t.subcategoryId === null || !filter.subcategoryIds.includes(t.subcategoryId)) {
        return false;
      }
    }
    if (filter.tagIds && filter.tagIds.length > 0) {
      if (!matchesAnyTag(t.tagIds, filter.tagIds)) return false;
    }
    if (filter.types && filter.types.length > 0) {
      if (!filter.types.includes(t.type)) return false;
    }
    if (filter.statuses && filter.statuses.length > 0) {
      if (!filter.statuses.includes(t.status)) return false;
    }
    // Fechas: comparacion lexicografica valida por el formato YYYY-MM-DD.
    if (filter.dateFrom && t.date < filter.dateFrom) return false;
    if (filter.dateTo && t.date > filter.dateTo) return false;

    if (filter.amountMinCents !== undefined && t.amountCents < filter.amountMinCents) return false;
    if (filter.amountMaxCents !== undefined && t.amountCents > filter.amountMaxCents) return false;

    if (filter.excluded === 'only' && !t.excludedFromStats) return false;
    if (filter.excluded === 'exclude' && t.excludedFromStats) return false;

    if (filter.onlyUncategorized && t.categoryId !== null) return false;

    if (filter.importBatchId && t.importBatchId !== filter.importBatchId) return false;

    return true;
  });
}

// Comparador estable segun el campo y direccion. Devuelve un array nuevo (no muta).
export function sortTransactions(
  txs: Transaction[],
  sort: TxSort,
  lookups: SortNameLookups = {},
): Transaction[] {
  const dir = sort.dir === 'asc' ? 1 : -1;
  const catNames = lookups.categoryNames;
  const accNames = lookups.accountNames;

  const compare = (a: Transaction, b: Transaction): number => {
    let primary = 0;
    switch (sort.field) {
      case 'date':
        primary = a.date.localeCompare(b.date);
        break;
      case 'concept':
        primary = a.concept.localeCompare(b.concept, 'es', { sensitivity: 'base' });
        break;
      case 'amount':
        primary = a.amountCents - b.amountCents;
        break;
      case 'type':
        primary = a.type.localeCompare(b.type);
        break;
      case 'status':
        primary = a.status.localeCompare(b.status);
        break;
      case 'category':
        primary = nameOf(catNames, a.categoryId).localeCompare(
          nameOf(catNames, b.categoryId),
          'es',
          { sensitivity: 'base' },
        );
        break;
      case 'subcategory':
        primary = nameOf(catNames, a.subcategoryId).localeCompare(
          nameOf(catNames, b.subcategoryId),
          'es',
          { sensitivity: 'base' },
        );
        break;
      case 'account':
        primary = nameOf(accNames, a.accountId).localeCompare(
          nameOf(accNames, b.accountId),
          'es',
          { sensitivity: 'base' },
        );
        break;
    }
    if (primary !== 0) return primary * dir;
    // Desempate estable: fecha descendente y luego createdAt para orden reproducible.
    const byDate = b.date.localeCompare(a.date);
    if (byDate !== 0) return byDate;
    return b.createdAt - a.createdAt;
  };

  return [...txs].sort(compare);
}

// Nombre de una entidad para ordenar; si no hay id o no esta en el mapa, cadena vacia
// (las entidades sin categoria/cuenta quedan agrupadas al principio en asc).
function nameOf(map: Map<string, string> | undefined, id: string | null): string {
  if (id === null) return '';
  return map?.get(id) ?? id;
}
