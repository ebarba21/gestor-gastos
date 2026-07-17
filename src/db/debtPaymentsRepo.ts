// Repositorio de pagos de deuda (DebtPayment). Exige profileId. Ver DATA_MODEL seccion 19.2.
import type { DebtPayment } from './schema';
import { db } from './index';
import { createProfileRepo, isAlive } from './baseRepo';
import { requireProfileId, requireId } from '../lib/validation';

const base = createProfileRepo(db.debtPayments, 'DebtPayment', 'debtPayment');

export const debtPaymentsRepo = {
  ...base,

  async listByDebt(profileId: string, debtId: string): Promise<DebtPayment[]> {
    requireProfileId(profileId);
    requireId(debtId);
    const rows = await db.debtPayments
      .where('[profileId+debtId]')
      .equals([profileId, debtId])
      .filter(isAlive)
      .toArray();
    return rows.sort((a, b) => a.date.localeCompare(b.date));
  },

  // Movimiento ya vinculado a un pago de deuda: evita doble conteo al proponer candidatos
  // (un mismo movimiento no se vincula dos veces, FINANCIAL_ALGORITHMS 12).
  async findByTransactionId(profileId: string, transactionId: string): Promise<DebtPayment | undefined> {
    requireProfileId(profileId);
    requireId(transactionId);
    const rows = await db.debtPayments
      .where('profileId')
      .equals(profileId)
      .filter((p) => isAlive(p) && p.transactionId === transactionId)
      .toArray();
    return rows[0];
  },
};
