// Repositorio de decisiones de "no duplicado" (NoDuplicateDecision). Exige profileId. Ver
// DATA_MODEL seccion 15.2. Recuerda que una pareja concreta de movimientos NO es duplicado,
// para que el motor de duplicados (duplicateEngine) no vuelva a proponerla salvo cambio
// relevante (huellas distintas).
import { db } from './index';
import { createProfileRepo, isAlive } from './baseRepo';
import { requireProfileId } from '../lib/validation';

const base = createProfileRepo(db.noDuplicateDecisions, 'NoDuplicateDecision', 'noDuplicateDecision');

export const noDuplicateDecisionsRepo = {
  ...base,

  // Busca una decision existente para el PAR de huellas indicado, en cualquier orden (la
  // pareja es simetrica: A-no-duplicado-de-B es lo mismo que B-no-duplicado-de-A).
  async findForPair(
    profileId: string,
    fingerprintA: string,
    fingerprintB: string,
  ): Promise<boolean> {
    requireProfileId(profileId);
    const [byLeft, byRight] = await Promise.all([
      db.noDuplicateDecisions
        .where('[profileId+leftFingerprint]')
        .equals([profileId, fingerprintA])
        .filter(isAlive)
        .toArray(),
      db.noDuplicateDecisions
        .where('[profileId+leftFingerprint]')
        .equals([profileId, fingerprintB])
        .filter(isAlive)
        .toArray(),
    ]);
    const matchesAB = byLeft.some((d) => d.rightFingerprint === fingerprintB);
    const matchesBA = byRight.some((d) => d.rightFingerprint === fingerprintA);
    return matchesAB || matchesBA;
  },
};
