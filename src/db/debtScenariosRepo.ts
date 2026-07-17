// Repositorio de escenarios de deuda (DebtScenario). Exige profileId. Ver DATA_MODEL seccion
// 19.3. Un escenario NUNCA modifica deudas reales; es una simulacion guardada.
import type { DebtScenario, DebtScenarioStrategy } from './schema';
import { db } from './index';
import { createProfileRepo, isAlive } from './baseRepo';
import { requireProfileId } from '../lib/validation';

const base = createProfileRepo(db.debtScenarios, 'DebtScenario', 'debtScenario');

export const debtScenariosRepo = {
  ...base,

  async listByStrategy(profileId: string, strategy: DebtScenarioStrategy): Promise<DebtScenario[]> {
    requireProfileId(profileId);
    return db.debtScenarios
      .where('[profileId+strategy]')
      .equals([profileId, strategy])
      .filter(isAlive)
      .toArray();
  },
};
