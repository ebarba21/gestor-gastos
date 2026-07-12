// Repositorio de reglas (Rule). Exige profileId. Ver DATA_MODEL 2.7.
// El motor de reglas es fase 4; aqui solo el acceso a datos (CRUD y orden por prioridad).
import type { Rule } from './schema';
import { db } from './index';
import { createProfileRepo, isAlive } from './baseRepo';
import { requireProfileId } from '../lib/validation';

const base = createProfileRepo<Rule>(db.rules, 'Rule', 'rule');

export const rulesRepo = {
  ...base,

  // Reglas activas ordenadas por prioridad (menor numero = mayor prioridad).
  async listEnabledByPriority(profileId: string): Promise<Rule[]> {
    requireProfileId(profileId);
    const all = await db.rules.where('profileId').equals(profileId).filter(isAlive).toArray();
    return all
      .filter((r) => r.enabled)
      .sort((a, b) => a.priority - b.priority);
  },

  // Todas las reglas del perfil ordenadas por prioridad.
  async listByPriority(profileId: string): Promise<Rule[]> {
    requireProfileId(profileId);
    const all = await db.rules.where('profileId').equals(profileId).filter(isAlive).toArray();
    return all.sort((a, b) => a.priority - b.priority);
  },
};
