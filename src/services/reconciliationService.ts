// Servicio de conciliacion bancaria (ampliacion, fase 6). Ver DATA_MODEL seccion 17 y
// FINANCIAL_ALGORITHMS seccion 6 (formula, semantica de saldo, politica de pendientes).
import type { Reconciliation, ReconciliationStatus } from '../db/schema';
import { accountsRepo } from '../db/accountsRepo';
import { reconciliationsRepo } from '../db/reconciliationsRepo';
import { transactionsRepo } from '../db/transactionsRepo';
import { assertCents } from '../lib/money';
import {
  NotFoundError,
  ValidationError,
  isValidAccountingDate,
  requireId,
  requireProfileId,
} from '../lib/validation';

export interface ComputedBalanceResult {
  computedBalanceCents: number;
  // Movimientos pendientes de la cuenta EXCLUIDOS del calculo por defecto (politica de la
  // seccion 6: "un extracto refleja lo ya cargado"), listados para que el usuario los revise.
  excludedPendingIds: string[];
}

// computedBalanceCents(cuenta, statementDate) = openingBalanceCents + suma de amountCents de
// los movimientos CONFIRMADOS (pending=false, salvo los incluidos explicitamente en
// `includePendingIds`) con date <= statementDate (comparacion lexicografica YYYY-MM-DD, sin
// conversion de zona horaria). El saldo INCLUYE transferencias y movimientos con
// excludedFromStats: el saldo no es lo mismo que las estadisticas (FINANCIAL_ALGORITHMS 6).
// Se EXCLUYEN las lineas hijas de un split (parentId != null): el cargo real en la cuenta lo
// aporta el movimiento padre; sumar tambien las hijas duplicaria el importe (misma regla que
// exportService.computeAccountBalances, la funcion canonica de saldo de cuenta).
export async function computeBalance(
  profileId: string,
  accountId: string,
  statementDate: string,
  includePendingIds: readonly string[] = [],
): Promise<ComputedBalanceResult> {
  requireProfileId(profileId);
  requireId(accountId);
  if (!isValidAccountingDate(statementDate)) {
    throw new ValidationError('La fecha de extracto no es una fecha YYYY-MM-DD valida.');
  }
  const account = await accountsRepo.getById(profileId, accountId);
  if (!account) {
    throw new NotFoundError(`Account ${accountId} no existe en el perfil ${profileId}.`);
  }
  const includeSet = new Set(includePendingIds);
  const all = await transactionsRepo.list(profileId);
  let sum = 0;
  const excludedPendingIds: string[] = [];
  for (const tx of all) {
    if (tx.accountId !== accountId) continue;
    // Linea hija de split: no suma al saldo (el importe lo aporta el padre). Se descarta antes
    // que el filtro de pendientes para no listarla como pendiente excluido.
    if (tx.parentId !== null) continue;
    if (tx.date > statementDate) continue;
    if (tx.pending && !includeSet.has(tx.id)) {
      excludedPendingIds.push(tx.id);
      continue;
    }
    sum += tx.amountCents;
  }
  const computedBalanceCents = account.openingBalanceCents + sum;
  assertCents(computedBalanceCents);
  return { computedBalanceCents, excludedPendingIds };
}

function statusFor(differenceCents: number): ReconciliationStatus {
  return differenceCents === 0 ? 'balanced' : 'discrepancy';
}

export interface ReconcileInput {
  accountId: string;
  statementDate: string;
  statementBalanceCents: number;
  // Pendientes que el usuario decide incluir explicitamente en el calculo (por defecto los
  // pendientes se excluyen, FINANCIAL_ALGORITHMS seccion 6).
  includePendingIds?: string[];
  notes?: string | null;
  // Si es true y hay diferencia, se guarda como 'acceptedWithDifference' (deja constancia) en
  // vez de 'discrepancy'. Nunca se fuerza a 'balanced' cuando differenceCents != 0.
  acceptWithDifference?: boolean;
}

// Registra una conciliacion: calcula el saldo, la diferencia y persiste el resultado con
// historial por cuenta. `differenceCents = statementBalanceCents - computedBalanceCents`; 0 =
// cuadra. Continuar sin cuadrar deja constancia explicita (`acceptedWithDifference`), nunca se
// oculta la diferencia.
export async function reconcile(
  profileId: string,
  input: ReconcileInput,
): Promise<{ reconciliation: Reconciliation; excludedPendingIds: string[] }> {
  requireProfileId(profileId);
  assertCents(input.statementBalanceCents);
  const { computedBalanceCents, excludedPendingIds } = await computeBalance(
    profileId,
    input.accountId,
    input.statementDate,
    input.includePendingIds ?? [],
  );
  const differenceCents = input.statementBalanceCents - computedBalanceCents;
  const status: ReconciliationStatus =
    differenceCents !== 0 && input.acceptWithDifference === true
      ? 'acceptedWithDifference'
      : statusFor(differenceCents);
  const reconciliation = await reconciliationsRepo.create(profileId, {
    accountId: input.accountId,
    statementDate: input.statementDate,
    statementBalanceCents: input.statementBalanceCents,
    computedBalanceCents,
    differenceCents,
    status,
    notes: input.notes ?? null,
  });
  return { reconciliation, excludedPendingIds };
}

async function history(profileId: string, accountId: string): Promise<Reconciliation[]> {
  requireProfileId(profileId);
  requireId(accountId);
  return reconciliationsRepo.listByAccount(profileId, accountId);
}

async function listRecent(profileId: string): Promise<Reconciliation[]> {
  requireProfileId(profileId);
  return reconciliationsRepo.listRecent(profileId);
}

export const reconciliationService = {
  computeBalance,
  reconcile,
  history,
  listRecent,
};
