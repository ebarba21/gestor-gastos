// Primitivas de calculo financiero compartidas. Fuente unica de la semantica de que
// cuenta y como en estadisticas: las usan tanto los presupuestos (fase actual) como el
// dashboard (fase posterior). Mantener aqui la logica garantiza que "el consumo de un
// presupuesto coincide con la suma de movimientos que cuentan en estadisticas" (PRD 6).
//
// Reglas de negocio (DATA_MODEL seccion 6), aplicadas de forma centralizada:
//  - Exclusiones: solo cuentan los movimientos con excludedFromStats === false. Esto ya
//    deja fuera, por diseno del modelo, las dos patas de una transferencia interna y el
//    padre de un split (ambos se marcan excluidos al crearse).
//  - Splits: cuentan las lineas hijas (llevan la categoria real); el padre no (excluido).
//  - Reembolsos: un reembolso (movimiento con refundOfId != null) NO se cuenta como
//    ingreso; reduce el gasto NETO de la categoria del gasto original al que reembolsa.
//    Ver detalle en attributeRefundRefs.
//
// Todos los importes se manejan en centimos enteros (nunca floats). Las magnitudes de
// gasto se devuelven como enteros positivos.
import type { Budget, BudgetDirection, BudgetScope, Category, Transaction } from '../db/schema';

// --- Contexto de calculo ---
// Estructuras derivadas una sola vez y reutilizadas en la agregacion. txById permite
// resolver el gasto original de un reembolso aunque este en otro periodo; parentOf permite
// que un presupuesto de categoria raiz agregue tambien sus subcategorias.
export interface StatsContext {
  parentOf: Map<string, string | null>; // categoryId -> parentId (null para raices)
  txById: Map<string, Transaction>; // indice completo del perfil por id de movimiento
}

// Construye el contexto a partir de las categorias y de TODOS los movimientos del perfil.
// El indice completo de movimientos es necesario para atribuir reembolsos cuyo gasto
// original cae fuera del periodo evaluado.
export function buildStatsContext(
  categories: Category[],
  allTransactions: Transaction[],
): StatsContext {
  const parentOf = new Map<string, string | null>();
  for (const c of categories) parentOf.set(c.id, c.parentId);
  const txById = new Map<string, Transaction>();
  for (const t of allTransactions) txById.set(t.id, t);
  return { parentOf, txById };
}

// --- Predicados base ---

// Un movimiento cuenta en estadisticas si no esta excluido. Espejo de statsFlag === 0.
export function countsInStats(t: Transaction): boolean {
  return !t.excludedFromStats;
}

// Un movimiento es un reembolso si enlaza con un gasto original (refundOfId != null) y no
// es en si mismo un gasto (un gasto se computa como gasto, no como reduccion). En el modelo
// un reembolso es de tipo income; esta guarda evita dobles interpretaciones.
export function isRefund(t: Transaction): boolean {
  return t.refundOfId !== null && t.type !== 'expense';
}

// Magnitud de gasto (entero positivo) de un movimiento de gasto; 0 si no es gasto.
export function expenseMagnitude(t: Transaction): number {
  return t.type === 'expense' ? Math.abs(t.amountCents) : 0;
}

// --- Resolucion de la categoria/subcategoria a efectos de ambito (scope) ---

interface CategoryRefs {
  categoryId: string | null;
  subcategoryId: string | null;
}

// Referencias de categoria del propio movimiento.
function ownRefs(t: Transaction): CategoryRefs {
  return { categoryId: t.categoryId, subcategoryId: t.subcategoryId };
}

// Categoria a la que se atribuye la REDUCCION de un reembolso: la del gasto original
// (resuelto por refundOfId), porque es el gasto de esa categoria el que se esta devolviendo.
// Si el original no es resoluble en el perfil, se cae con seguridad a la categoria propia
// del reembolso. Asi un reembolso sin categoria pero enlazado sigue reduciendo la categoria
// correcta.
function attributeRefundRefs(t: Transaction, ctx: StatsContext): CategoryRefs {
  if (t.refundOfId !== null) {
    const original = ctx.txById.get(t.refundOfId);
    if (original) return { categoryId: original.categoryId, subcategoryId: original.subcategoryId };
  }
  return ownRefs(t);
}

// Conjunto de ids de categoria a los que pertenece un par de referencias, con acumulacion
// hacia la raiz: una subcategoria aporta tambien su categoria padre, de modo que un
// presupuesto de la categoria raiz agrega el gasto de sus subcategorias.
function rolledUpCategoryIds(refs: CategoryRefs, parentOf: Map<string, string | null>): Set<string> {
  const ids = new Set<string>();
  for (const c of [refs.categoryId, refs.subcategoryId]) {
    if (!c) continue;
    ids.add(c);
    const parent = parentOf.get(c);
    if (parent) ids.add(parent);
  }
  return ids;
}

// Comprueba si un movimiento cae dentro del ambito de un presupuesto. `asRefund` indica que
// se esta evaluando la reduccion de un reembolso, en cuyo caso la categoria se toma del
// gasto original (para category/subcategory). El ambito de cuenta usa siempre la cuenta
// fisica del movimiento (el dinero se mueve en su cuenta), tambien para reembolsos.
export function inScope(
  t: Transaction,
  scope: BudgetScope,
  scopeId: string | null,
  ctx: StatsContext,
  asRefund: boolean,
): boolean {
  switch (scope) {
    case 'overall':
      return true;
    case 'account':
      return t.accountId === scopeId;
    case 'subcategory': {
      const refs = asRefund ? attributeRefundRefs(t, ctx) : ownRefs(t);
      // Coincidencia exacta con la subcategoria (sin acumular hacia la raiz).
      return refs.categoryId === scopeId || refs.subcategoryId === scopeId;
    }
    case 'category': {
      const refs = asRefund ? attributeRefundRefs(t, ctx) : ownRefs(t);
      if (scopeId === null) return false;
      return rolledUpCategoryIds(refs, ctx.parentOf).has(scopeId);
    }
    default:
      return false;
  }
}

// --- Consumo de un ambito en un conjunto de movimientos (ya filtrado al periodo) ---

export interface Consumption {
  // Gasto o ingreso bruto del ambito (entero positivo, magnitud).
  grossCents: number;
  // Reembolsos atribuidos al ambito (entero positivo). Solo aplica a direccion 'expense'.
  refundCents: number;
  // Consumo neto: gasto bruto menos reembolsos (expense) o ingreso bruto (income).
  consumedCents: number;
}

// Calcula el consumo de un ambito y direccion sobre los movimientos de un periodo.
// Precondicion: `txsInPeriod` ya esta acotado a las fechas del periodo. Solo se consideran
// los movimientos que cuentan en estadisticas (countsInStats).
//
//  - direccion 'expense': suma la magnitud de los gastos del ambito y le resta los
//    reembolsos atribuidos a ese ambito (gasto neto). El neto puede ser negativo si en el
//    periodo se devuelve mas de lo gastado; se devuelve tal cual (la UI decide como pintarlo).
//  - direccion 'income': suma los ingresos del ambito, EXCLUYENDO reembolsos (un reembolso
//    no es un ingreso real; contarlo inflaria ingresos y ahorro).
export function computeConsumption(
  txsInPeriod: Transaction[],
  scope: BudgetScope,
  scopeId: string | null,
  direction: BudgetDirection,
  ctx: StatsContext,
): Consumption {
  let gross = 0;
  let refund = 0;

  for (const t of txsInPeriod) {
    if (!countsInStats(t)) continue;

    if (direction === 'expense') {
      if (t.type === 'expense' && inScope(t, scope, scopeId, ctx, false)) {
        gross += expenseMagnitude(t);
      } else if (isRefund(t) && inScope(t, scope, scopeId, ctx, true)) {
        refund += Math.abs(t.amountCents);
      }
    } else {
      // income: ingresos reales del ambito, sin reembolsos.
      if (t.type === 'income' && !isRefund(t) && inScope(t, scope, scopeId, ctx, false)) {
        gross += Math.abs(t.amountCents);
      }
    }
  }

  const consumed = direction === 'expense' ? gross - refund : gross;
  return { grossCents: gross, refundCents: refund, consumedCents: consumed };
}

// Conveniencia: consumo de un presupuesto sobre un conjunto de movimientos ya acotado al
// periodo del presupuesto.
export function computeBudgetConsumption(
  budget: Pick<Budget, 'scope' | 'scopeId' | 'direction'>,
  txsInPeriod: Transaction[],
  ctx: StatsContext,
): Consumption {
  return computeConsumption(txsInPeriod, budget.scope, budget.scopeId, budget.direction, ctx);
}
