// Logica de negocio de cuentas o fuentes de dinero (Account). Ver DATA_MODEL 2.3.
// Reglas de integridad al borrar: una cuenta con movimientos no se puede borrar (se
// ofrece archivar). El saldo actual NO se guarda: se calcula siempre como saldo inicial
// (openingBalanceCents) + suma de los movimientos de la cuenta (computeAccountBalances).
import type { Account, AccountKind, Transaction } from '../db/schema';
import { accountsRepo } from '../db/accountsRepo';
import { transactionsRepo } from '../db/transactionsRepo';
import { pickAccentColor } from '../lib/colors';
import { assertCents } from '../lib/money';
import { ValidationError, assert } from '../lib/validation';

export const MAX_ACCOUNT_NAME_LENGTH = 40;

// Etiquetas legibles de cada tipo de fuente (para selectores de la UI).
export const ACCOUNT_KIND_LABELS: Record<AccountKind, string> = {
  bank: 'Banco',
  card: 'Tarjeta',
  cash: 'Efectivo',
  wallet: 'Monedero',
  shared: 'Cuenta conjunta',
  other: 'Otra',
};

export const ACCOUNT_KINDS: readonly AccountKind[] = [
  'bank',
  'card',
  'cash',
  'wallet',
  'shared',
  'other',
];

export interface AccountInput {
  name: string;
  kind: AccountKind;
  openingBalanceCents: number;
  currency?: string;
  color?: string | null;
}

export function normalizeAccountName(name: string): string {
  const trimmed = (name ?? '').trim().replace(/\s+/g, ' ');
  if (trimmed.length === 0) {
    throw new ValidationError('El nombre de la cuenta no puede estar vacio.');
  }
  if (trimmed.length > MAX_ACCOUNT_NAME_LENGTH) {
    throw new ValidationError(
      `El nombre de la cuenta no puede superar ${MAX_ACCOUNT_NAME_LENGTH} caracteres.`,
    );
  }
  return trimmed;
}

// --- Saldos de cuenta (funcion canonica, compartida con exportacion y conciliacion) ---

// Saldo actual de cada cuenta = saldo inicial + suma de importes de sus movimientos. Se
// excluyen las lineas hijas de un split (parentId != null): el importe real en la cuenta lo
// aporta el movimiento padre; sumar tambien las hijas duplicaria el importe. Transferencias
// y movimientos excluidos de estadisticas SI afectan al saldo (DATA_MODEL seccion 6.4).
export function computeAccountBalances(
  accounts: Account[],
  transactions: Transaction[],
): Map<string, number> {
  const balance = new Map<string, number>();
  for (const a of accounts) balance.set(a.id, a.openingBalanceCents);
  for (const t of transactions) {
    if (t.parentId !== null) continue; // linea hija de split: no suma al saldo
    const current = balance.get(t.accountId);
    if (current === undefined) continue; // cuenta desconocida (no deberia ocurrir)
    balance.set(t.accountId, current + t.amountCents);
  }
  for (const v of balance.values()) assertCents(v);
  return balance;
}

// Total del dinero en las cuentas ACTIVAS (las archivadas quedan fuera: se consideran
// cerradas). Si una cuenta no tiene saldo calculado se usa su saldo inicial.
export function sumActiveBalances(accounts: Account[], balances: Map<string, number>): number {
  let total = 0;
  for (const a of accounts) {
    if (a.archivedAt !== null) continue;
    total += balances.get(a.id) ?? a.openingBalanceCents;
  }
  assertCents(total);
  return total;
}

export const accountService = {
  listAll(profileId: string): Promise<Account[]> {
    return accountsRepo.list(profileId);
  },

  // Cuentas ordenadas: primero activas, luego archivadas; alfabetico dentro de cada grupo.
  async listSorted(profileId: string): Promise<Account[]> {
    const all = await accountsRepo.list(profileId);
    return all.sort((a, b) => {
      const archA = a.archivedAt === null ? 0 : 1;
      const archB = b.archivedAt === null ? 0 : 1;
      return archA - archB || a.name.localeCompare(b.name);
    });
  },

  async createAccount(profileId: string, input: AccountInput): Promise<Account> {
    const name = normalizeAccountName(input.name);
    const existing = await accountsRepo.list(profileId);
    const color = input.color ?? pickAccentColor(existing.length);
    return accountsRepo.create(profileId, {
      name,
      kind: input.kind,
      currency: input.currency ?? 'EUR',
      color,
      openingBalanceCents: input.openingBalanceCents,
      archivedAt: null,
    });
  },

  async updateAccount(
    profileId: string,
    id: string,
    patch: Partial<Pick<Account, 'name' | 'kind' | 'color' | 'openingBalanceCents'>>,
  ): Promise<Account> {
    const clean = { ...patch };
    if (patch.name !== undefined) clean.name = normalizeAccountName(patch.name);
    return accountsRepo.update(profileId, id, clean);
  },

  // Saldo actual de todas las cuentas del perfil (activas y archivadas).
  async getBalances(profileId: string): Promise<Map<string, number>> {
    const [accounts, transactions] = await Promise.all([
      accountsRepo.list(profileId),
      transactionsRepo.list(profileId),
    ]);
    return computeAccountBalances(accounts, transactions);
  },

  countUsage(profileId: string, id: string): Promise<number> {
    return transactionsRepo.countByAccount(profileId, id);
  },

  // Borrado con regla de integridad: una cuenta con movimientos no se puede borrar.
  // Se ofrece archivar (conserva la cuenta y su historico, la oculta de los selectores).
  async deleteAccount(profileId: string, id: string): Promise<void> {
    const used = await accountService.countUsage(profileId, id);
    assert(
      used === 0,
      'La cuenta tiene movimientos. Archivala en su lugar para conservar el historico.',
    );
    await accountsRepo.remove(profileId, id);
  },

  archiveAccount(profileId: string, id: string): Promise<Account> {
    return accountsRepo.update(profileId, id, { archivedAt: Date.now() });
  },

  unarchiveAccount(profileId: string, id: string): Promise<Account> {
    return accountsRepo.update(profileId, id, { archivedAt: null });
  },
};
